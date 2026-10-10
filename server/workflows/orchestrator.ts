import {createHash} from 'node:crypto'
import {parseRequest,parseAgentResult,normalizeReviewIssue,WorkflowError,type WorkflowRequest,type WorkflowReceipt,type AgentResult,type EvidenceReader,type FailureCode} from './contracts.ts'
import {validateEvidence} from './evidence-gate.ts'
import {createTrace,type AgentRole,type TraceRow} from './trace.ts'
import {simulationJournal,type TaskJournal} from './task-journal.ts'

export type NodeContext={request:WorkflowRequest;signal:AbortSignal;results:ReadonlyMap<string,AgentResult>;callId?:string}
export type WorkflowNode={id:string;role:AgentRole;dependencies:string[];executionKind:WorkflowReceipt['executionKind'];maxCostCny:number;callId?:string;invoke:(context:NodeContext)=>Promise<{result:unknown;costCny:number|null;providerCalls:number}>}
type Entry={digest:string;promise:Promise<WorkflowReceipt>}
export function createOrchestrator(options:{readEvidence:EvidenceReader;traceSink?:(row:TraceRow)=>void;maxEntries?:number;journal?:TaskJournal;prepareGraph?:(r:WorkflowRequest,nodes:WorkflowNode[])=>Promise<void>;finishGraph?:(r:WorkflowRequest)=>Promise<void>;readNodeAccounting?:(r:WorkflowRequest,nodeId:string)=>{costCny:number;providerCalls:number}|null}){
 const requests=new Map<string,Entry>(),trace=createTrace(options.traceSink),journal=options.journal??simulationJournal()
 const run=(raw:unknown,nodes:WorkflowNode[],build:(r:WorkflowRequest,results:ReadonlyMap<string,AgentResult>)=>Promise<WorkflowReceipt>,signal?:AbortSignal):Promise<WorkflowReceipt>=>{
  const request=structuredClone(parseRequest(raw)),key=request.internalActorKey+':'+request.requestId
  const digest=createHash('sha256').update(JSON.stringify(request)).digest('hex')
  const existing=requests.get(key)
  if(existing){if(existing.digest!==digest)return Promise.reject(new WorkflowError('request_conflict'));return existing.promise.then(value=>replay(value,request,signal))}
  if(nodes.some(n=>n.executionKind==='real_provider')&&(!journal.durable||!options.prepareGraph))return Promise.reject(new WorkflowError('unavailable'))
  // Capacity bounds live promises; the journal, rather than this cache, owns idempotency.
  if(requests.size>=(options.maxEntries??256))return Promise.reject(new WorkflowError('unavailable'))
  const promise=(async()=>{
   const end=Date.now()+request.modelBudget.deadlineMs
   let claimed=await journal.claim(request,digest)
   while(!claimed.owned&&!claimed.receipt){
    if(signal?.aborted)throw new WorkflowError('cancelled')
    if(Date.now()>=end)throw new WorkflowError('timeout')
    await new Promise(resolve=>setTimeout(resolve,25));claimed=await journal.claim(request,digest)
   }
   if(claimed.receipt)return replay(claimed.receipt,request,signal)
   const receipt=await execute(request,nodes,build,signal)
   await options.finishGraph?.(request)
   await journal.finish(request,receipt);return receipt
  })()
  requests.set(key,{digest,promise})
  void promise.finally(()=>requests.delete(key)).catch(()=>{})
  return promise.then(value=>structuredClone(value))
 }
 async function replay(receipt:WorkflowReceipt,request:WorkflowRequest,signal?:AbortSignal):Promise<WorkflowReceipt>{
  if(receipt.status!=='proposed')return structuredClone(receipt)
  let timer:ReturnType<typeof setTimeout>|undefined,onAbort:()=>void=()=>{}
  try{
   if(signal?.aborted)throw new WorkflowError('cancelled')
   const records=await Promise.race([options.readEvidence(structuredClone(request)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new WorkflowError('timeout')),request.modelBudget.deadlineMs);onAbort=()=>reject(new WorkflowError('cancelled'));signal?.addEventListener('abort',onAbort,{once:true})})])
   validateEvidence(request,request.authorizedEvidenceRefs,records)
   return structuredClone(receipt)
  }catch(error){return {...receipt,proposal:undefined,status:'unavailable',failure:error instanceof WorkflowError?error.code:'unavailable',fallback:'existing_single_agent'}}
  finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',onAbort)}
 }
 async function execute(request:WorkflowRequest,nodes:WorkflowNode[],build:(r:WorkflowRequest,results:ReadonlyMap<string,AgentResult>)=>Promise<WorkflowReceipt>,signal?:AbortSignal):Promise<WorkflowReceipt>{
  const controller=new AbortController(),results=new Map<string,AgentResult>()
  let timedOut=false,providerCalls=0,reservedCalls=0,reserved=0,cost=0,unknownCost=false,firstFailure:WorkflowError|undefined
  const kinds=new Set(nodes.filter(x=>x.executionKind!=='local_deterministic').map(x=>x.executionKind))
  const executionKind:WorkflowReceipt['executionKind']=kinds.has('real_provider')?'real_provider':kinds.has('simulated_provider')?'simulated_provider':'local_deterministic'
  const forward=()=>controller.abort('cancelled')
  if(signal?.aborted)forward();else signal?.addEventListener('abort',forward,{once:true})
  const timer=setTimeout(()=>{timedOut=true;controller.abort('timeout')},request.modelBudget.deadlineMs)
  let polling=false
  const cancelPoll=journal.durable?setInterval(()=>{if(polling)return;polling=true;void journal.cancelled(request).then(cancelled=>{if(cancelled)controller.abort('cancelled')}).catch(()=>controller.abort('unavailable')).finally(()=>{polling=false})},100):undefined
  const check=()=>{if(controller.signal.aborted)throw new WorkflowError(timedOut?'timeout':'cancelled')}
  const usage=()=>({providerCalls,costCny:unknownCost?null:cost,reservedCostCny:reserved,executionKind,skills:[] as string[]})
  async function bounded<T>(fn:()=>Promise<T>):Promise<T>{
   check()
   let onAbort:()=>void=()=>{}
   try{return await Promise.race([Promise.resolve().then(fn),new Promise<never>((_,reject)=>{onAbort=()=>reject(new WorkflowError(timedOut?'timeout':'cancelled'));controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted)onAbort()})])}
   finally{controller.signal.removeEventListener('abort',onAbort)}
  }
  const read=()=>bounded(async()=>{if(await journal.cancelled(request)){controller.abort('cancelled');check()};return options.readEvidence(structuredClone(request))})
  try{
   check()
   const byId=new Map(nodes.map(x=>[x.id,x]))
   if(byId.size!==nodes.length||nodes.some(x=>!x.id||x.dependencies.some(d=>!byId.has(d))||!Number.isFinite(x.maxCostCny)||x.maxCostCny<0)||kinds.size>1)throw new WorkflowError('invalid_contract')
   if(nodes.filter(x=>x.executionKind!=='local_deterministic').length>request.modelBudget.maxProviderCalls||nodes.reduce((n,x)=>n+x.maxCostCny,0)>request.modelBudget.maxCostCny+1e-9)throw new WorkflowError('budget_exceeded')
   const initial=await read();validateEvidence(request,request.authorizedEvidenceRefs,initial)
   await bounded(async()=>{await options.prepareGraph?.(request,nodes)})
   const pending=new Set(nodes.map(x=>x.id))
   while(pending.size){
    check()
    const ready=nodes.filter(x=>pending.has(x.id)&&x.dependencies.every(d=>results.has(d)))
    if(!ready.length)throw new WorkflowError('invalid_contract')
    const batchCalls=ready.filter(x=>x.executionKind!=='local_deterministic').length
    const batchCost=ready.reduce((n,x)=>n+x.maxCostCny,0)
    if(reservedCalls+batchCalls>request.modelBudget.maxProviderCalls||reserved+batchCost>request.modelBudget.maxCostCny+1e-9)throw new WorkflowError('budget_exceeded')
    // Reserve the entire parallel wave synchronously before any invocation.
    reservedCalls+=batchCalls;reserved+=batchCost
    const wave=await Promise.allSettled(ready.map(async node=>{
     const started=performance.now(),calls=node.executionKind==='local_deterministic'?0:1
     let nodeCost:number|null=0,invoked=false
     const base={workflowId:'lifeos-workflows' as const,version:2 as const,traceId:request.traceId,agentRole:node.role,inputRefDigest:trace.digest({refs:request.authorizedEvidenceRefs,node:node.id}),outputRefDigest:trace.digest(null),usedEvidenceIds:[] as string[],providerCalls:0,reservedCostCny:node.maxCostCny,executionKind:node.executionKind}
     trace.append({...base,latencyMs:0,costCny:0,status:'started'})
     try{
      check()
      // An opaque provider invocation may have incurred its entire reserved cost even if it times out.
      const callId=await bounded(()=>journal.startNode(request,node))
      const output=await bounded(()=>{check();invoked=true;if(calls){providerCalls++;nodeCost=null};return node.invoke({request:structuredClone(request),signal:controller.signal,results:structuredClone(results),callId})})
      nodeCost=output.costCny
      if(nodeCost!==null&&Number.isFinite(nodeCost)&&nodeCost>=0)cost+=nodeCost
      else unknownCost=true
      if(output.providerCalls!==calls||nodeCost===null||!Number.isFinite(nodeCost)||nodeCost<0||nodeCost>node.maxCostCny+1e-9||!calls&&nodeCost!==0)throw new WorkflowError('budget_exceeded')
      const result=parseAgentResult(output.result)
      // Independent server validation uses freshly authorized records, never the Agent's labels.
      validateEvidence(request,result.evidenceRefs,await read())
      check();await journal.finishNode(request,node.id,result,nodeCost,invoked?calls:0);results.set(node.id,structuredClone(result));pending.delete(node.id)
      trace.append({...base,providerCalls:invoked?calls:0,outputRefDigest:trace.digest(result),usedEvidenceIds:result.evidenceRefs.map(x=>trace.digest(x)),latencyMs:performance.now()-started,costCny:nodeCost,status:'succeeded'})
     }catch(error){
      // A completed paid response can fail a later selector/evidence check.
      // Read its actual unique ledger receipt instead of losing known usage.
      if(invoked&&nodeCost===null&&options.readNodeAccounting){
       try{const paid=options.readNodeAccounting(request,node.id);if(paid&&paid.providerCalls===calls&&Number.isFinite(paid.costCny)&&paid.costCny>=0&&paid.costCny<=node.maxCostCny){nodeCost=paid.costCny;cost+=nodeCost}}catch{/* unavailable accounting keeps full unknown reservation */}
      }
      if(calls&&nodeCost===null)unknownCost=true
      const code=error instanceof WorkflowError?error.code:'unavailable'
      await journal.finishNode(request,node.id,null,nodeCost,invoked?calls:0,code)
      trace.append({...base,providerCalls:invoked?calls:0,latencyMs:performance.now()-started,costCny:nodeCost,status:code==='cancelled'?'cancelled':code==='timeout'?'timeout':'failed',error:code})
      // Abort siblings before subsequent waves; drain the promises to prevent unhandled rejections.
      firstFailure??=new WorkflowError(code);controller.abort(code);throw new WorkflowError(code)
     }
    }))
    const failed=wave.find(x=>x.status==='rejected')
    if(failed?.status==='rejected')throw firstFailure??failed.reason
   }
   check();validateEvidence(request,request.authorizedEvidenceRefs,await read())
   const result=await bounded(()=>build(request,results));check()
   return {...result,...usage(),skills:result.skills}
  }catch(error){
   const failure:FailureCode=error instanceof WorkflowError?error.code:'unavailable'
   return {schemaVersion:2,traceId:request.traceId,status:'unavailable',failure,fallback:'existing_single_agent',...usage(),reviewIssues:results.get('critic')?.issues.map(normalizeReviewIssue)}
  }finally{clearTimeout(timer);if(cancelPoll)clearInterval(cancelPoll);signal?.removeEventListener('abort',forward)}
 }
 return {run,trace}
}
