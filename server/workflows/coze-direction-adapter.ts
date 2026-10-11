import {createHash} from 'node:crypto'
import {readFileSync,mkdirSync,writeFileSync,appendFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {Value} from 'typebox/value'
import {CoachProviderBudget,activeCoachFunding,type CoachCallReceipt} from '../../scripts/coach-provider-budget.ts'
import {CozeCreditBudget} from '../../scripts/coze-credit-budget.ts'
import {reserveCozeHostPermit,verifyCozeHostPermit,deriveCozePermitSecret,settleCozeHostReceipt,retainUnknownCozeGraph,type CozeHostPermit} from '../../scripts/coze-host-permit.ts'
import {assertCoachSourceFreeze} from '../../scripts/coach-source-freeze.ts'
import {validateCodeEndpoint} from '../coze-code-workflow.ts'
import {workflowRuntimeVersion} from './runtime-version.ts'
import {WorkflowError,parseProposal,reviewIssueSchema,type WorkflowRequest,type WorkflowReceipt,type EvidenceReader,type ReviewIssue} from './contracts.ts'
import {validateEvidence,validateProposal} from './evidence-gate.ts'
import {validateReviewedFields} from './reviewed-fields.ts'
import type {DecisionAdapter} from './direction-decision.ts'

type Binding=Parameters<typeof reserveCozeHostPermit>[0]['binding']
type Approval=Parameters<typeof reserveCozeHostPermit>[0]['approval']
export type CozeDirectionConfig={projectId:'7693388932939300905';endpoint:string;token:string;binding:Binding;approval:Approval;creditsLedgerPath:string;maxCreditsPerGraph:number;journalDirectory:string}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const unavailable=async()=>{throw new WorkflowError('unavailable')}

export function parseCozeDirectionReceipt(body:unknown,r:WorkflowRequest,records:Awaited<ReturnType<EvidenceReader>>):WorkflowReceipt{
 const value=body as any
 if(!value||value.schemaVersion!==2||value.requestId!==r.requestId||value.traceId!==r.traceId||value.executionKind!=='real_provider'||value.receiptIncomplete||value.workerFinishedAtReturn===false||!Array.isArray(value.suggestedStateChanges)||value.suggestedStateChanges.length)throw new WorkflowError('invalid_contract')
 if(value.status!=='proposed'||value.failure)throw new WorkflowError(['cancelled','timeout','source_invalid','budget_exceeded','constraint_conflict','invalid_contract'].includes(value.failure)?value.failure:'unavailable')
 if(!Number.isSafeInteger(value.providerCalls)||value.providerCalls<1||value.providerCalls>r.modelBudget.maxProviderCalls||!Number.isFinite(value.reservedCostCny)||value.reservedCostCny<0||value.reservedCostCny>r.modelBudget.maxCostCny||!(value.costCny===null||Number.isFinite(value.costCny)&&value.costCny>=0&&value.costCny<=value.reservedCostCny))throw new WorkflowError('invalid_contract')
 const proposal=parseProposal(value.proposal)
 validateProposal(r,proposal,records)
 const paths=r.directions.filter(d=>!r.controls.forbiddenDirections.includes(d.id))
 if(proposal.alternatives.length!==paths.length||paths.some(d=>!proposal.alternatives.some(a=>a.directionId===d.id)))throw new WorkflowError('invalid_contract')
 const reviewed=value.reviewedProposalFields
 if(!reviewed||!Array.isArray(reviewed.alternatives)||!Array.isArray(reviewed.nextActions))throw new WorkflowError('source_invalid')
 // Reuse the proposal schema to check each actual reviewed field, rather than
 // accepting a remote role name as proof of review.
 if(reviewed.alternatives.length>3||reviewed.nextActions.length>48)throw new WorkflowError('invalid_contract')
 const checked={hypotheses:[],alternatives:reviewed.alternatives.map((a:unknown)=>parseProposal({...proposal,alternatives:[a],nextActions:[],hypotheses:[]}).alternatives[0]),nextActions:reviewed.nextActions.map((a:unknown)=>parseProposal({...proposal,alternatives:[],nextActions:[a],hypotheses:[]}).nextActions[0])}
 validateReviewedFields(proposal,checked)
 const issues:ReviewIssue[]=(value.reviewIssues??[]).map((raw:any)=>{
  const issue={...raw,...(raw.resolution==='waiting_user'?{resolution:raw.severity==='needs_clarification'?'ask_user':'keep_unknown'}:{})}
  if(!Value.Check(reviewIssueSchema,issue))throw new WorkflowError('invalid_contract')
  validateEvidence(r,issue.evidenceRefs,records)
  return issue
 })
 if(issues.some(x=>x.severity==='blocker'))throw new WorkflowError('constraint_conflict')
 const actual=value.skills
 if(!Array.isArray(actual)||actual.length===0)throw new WorkflowError('source_invalid')
 const names=actual.map((s:any)=>s.name)
 for(const name of ['lifeos-direction-analysis','lifeos-experience-evidence']){
  const loaded=actual.find((s:any)=>s.name===name),expected=workflowRuntimeVersion.skills.find(s=>s.name===name)
  if(!expected||!loaded||![true,'True'].includes(loaded.loaded)||loaded.sha256!==expected.sha256||loaded.version!==expected.version)throw new WorkflowError('source_invalid')
 }
 return {schemaVersion:2,traceId:r.traceId,status:'proposed',proposal,reviewIssues:issues,providerCalls:value.providerCalls,costCny:value.costCny,reservedCostCny:value.reservedCostCny,executionKind:'real_provider',skills:names,adoptionVersionDigest:r.hostSnapshot?.adoptionVersionDigest,verifiedRuntimeBinding:Object.fromEntries(['hostSourceDigest','cloudCommit','cloudSourceDigest','canonicalContentHash','canonicalSourceRegistryHash','canonicalEvidenceHash','approvedSubsetHash','fullCorpusHash','candidateRelease','skillsDigest'].filter(k=>typeof value.runtime?.[k]==='string').map(k=>[k,value.runtime[k]])),fallback:'none'}
}

export function createCozeDirectionAdapter(input:{readEvidence:EvidenceReader;readMethods:(r:WorkflowRequest)=>Promise<Record<string,unknown>[]>;freezePath:string;config:CozeDirectionConfig;budget?:CoachProviderBudget;credits?:CozeCreditBudget;fetchImpl?:typeof fetch;syntheticTransport?:boolean;audit?:(r:WorkflowRequest,row:Record<string,unknown>)=>Promise<void>}):DecisionAdapter{
 const cfg=input.config,target=validateCodeEndpoint(cfg.endpoint),budget=input.budget??new CoachProviderBudget(),credits=input.credits??new CozeCreditBudget(cfg.creditsLedgerPath),fetchImpl=input.fetchImpl??fetch
 if(cfg.projectId!=='7693388932939300905'||!Number.isSafeInteger(cfg.maxCreditsPerGraph)||cfg.maxCreditsPerGraph<=0||cfg.token.length<20||cfg.binding.hostSourceDigest!==workflowRuntimeVersion.sourceDigest||cfg.binding.contentHash!==workflowRuntimeVersion.contentHash)throw new WorkflowError('unavailable')
 if(!input.syntheticTransport&&(budget.path!==new CoachProviderBudget().path||credits.path!==resolve('.local/coze-launch/credits-ledger.jsonl'))||input.syntheticTransport&&!input.fetchImpl)throw new WorkflowError('scope_denied')
 const secret=deriveCozePermitSecret(cfg.token),maxCost=0.02
 const canonical=JSON.parse(readFileSync('.planning/research/workflow-integration/COZE_CANONICAL_PUBLIC_ASSETS.json','utf8'))
 if(canonical.canonicalFullCorpusHash!==workflowRuntimeVersion.contentHash||canonical.canonicalSourceRegistryHash!==workflowRuntimeVersion.sourceRegistryHash||canonical.canonicalEvidenceHash!==workflowRuntimeVersion.contentEvidenceHash||!Array.isArray(canonical.cards)||canonical.cards.some((c:any)=>c.guide?.reviewStatus!=='approved'))throw new WorkflowError('source_invalid')
 const approvedSubsetHash=createHash('sha256').update(canonical.cards.map((c:any)=>createHash('sha256').update(String(c.claim??'')+'\n'+String(c.excerpt??'')+'\n'+(c.mechanisms??[]).map(String).join(' ')+'\n'+String(c.limitations??'')).digest('hex')).sort().join('')).digest('hex')
 const contentBinding={canonicalContentHash:workflowRuntimeVersion.contentHash,canonicalSourceRegistryHash:workflowRuntimeVersion.sourceRegistryHash,canonicalEvidenceHash:workflowRuntimeVersion.contentEvidenceHash,approvedSubsetHash,fullCorpusHash:workflowRuntimeVersion.contentHash,candidateRelease:'0.2.0-candidate'}
 async function post(wire:CozeHostPermit,requestId:string,operation?:'cancel'|'readback',signal?:AbortSignal){
  const response=await fetchImpl(target.url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+cfg.token,'Content-Type':'application/json'},body:JSON.stringify({session_id:requestId,message:'',host_request:{...wire,...(operation?{operation}:{})}}),signal})
  if(!response.ok)throw new WorkflowError('unavailable')
  const reader=response.body?.getReader();if(!reader)throw new WorkflowError('invalid_contract')
  let bytes=0,text='';const decoder=new TextDecoder()
  while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>512000){await reader.cancel();throw new WorkflowError('invalid_contract')};text+=decoder.decode(chunk.value,{stream:true})}
  text+=decoder.decode();const output=JSON.parse(text)
  // The existing GraphOutput exposes host_receipt, not a legacy workflow data
  // string. Unknown envelopes fail closed without another paid request.
  if(!output||typeof output.host_receipt!=='object')throw new WorkflowError('invalid_contract')
  return output.host_receipt
 }
 return {executionKind:'real_provider',maxCostPerCallCny:maxCost,analyze:unavailable,critic:unavailable,synthesize:unavailable,
  async runRemoteGraph(r,journal,signal){
   if(!r.synthetic||r.controls.listeningOnly||r.controls.refuseAdvice||r.controls.memoryControl||!journal.durable)throw new WorkflowError('scope_denied')
   const end=Date.now()+r.modelBudget.deadlineMs
   let claim=await journal.claim(r,hash(r))
   while(!claim.owned&&!claim.receipt){
    if(signal?.aborted)throw new WorkflowError('cancelled')
    if(Date.now()>=end)throw new WorkflowError('timeout')
    await new Promise(resolve=>setTimeout(resolve,50));claim=await journal.claim(r,hash(r))
   }
   if(claim.receipt)return claim.receipt
   let wire:CozeHostPermit|undefined,settled=false,creditReserved=false,posted=false,knownReceipt:any,cancelSent=false,polling=false,cancelAcknowledged=false,stopPromise:Promise<void>|undefined
   const directions=r.directions.filter(d=>!r.controls.forbiddenDirections.includes(d.id)),nodeIds=[...directions.map(d=>'path:'+d.id),'critic','synthesize'],path=resolve(cfg.journalDirectory,r.requestId+'.jsonl'),responseController=new AbortController()
   let cancelPoll:ReturnType<typeof setInterval>|undefined,timer:ReturnType<typeof setTimeout>|undefined,pollPromise:Promise<void>|undefined
   const stop=():Promise<void>=>{
    if(stopPromise)return stopPromise
    if(!wire||!posted)return Promise.resolve()
    cancelSent=true
    stopPromise=(async()=>{
    // One authenticated stop request; leave the original wire connected to
    // receive actual usage. A stop acknowledgement never settles that usage.
    appendFileSync(path,JSON.stringify({type:'signed_cancel_requested',requestId:r.requestId,at:new Date().toISOString()})+'\n')
    try{const ack=await post(wire!,r.requestId,'cancel',AbortSignal.timeout(10000));cancelAcknowledged=ack.status==='cancel_requested'&&ack.receiptIncomplete===true&&ack.workerFinishedAtReturn===false;appendFileSync(path,JSON.stringify({type:'signed_cancel_readback',requestId:r.requestId,cancelAcknowledged,workerFinishedAtReturn:false,at:new Date().toISOString()})+'\n');await input.audit?.(r,{kind:'coze_cancel_ack',status:ack.status,workerFinishedAtReturn:ack.workerFinishedAtReturn})}catch{appendFileSync(path,JSON.stringify({type:'signed_cancel_unconfirmed',requestId:r.requestId,reservationRetained:true,at:new Date().toISOString()})+'\n')}
    })().catch(()=>{cancelAcknowledged=false})
    return stopPromise
   }
   const onAbort=()=>{void stop()}
   let receipt:WorkflowReceipt={schemaVersion:2,traceId:r.traceId,status:'unavailable',failure:'unavailable',providerCalls:0,costCny:0,reservedCostCny:0,executionKind:'real_provider',skills:[],fallback:'existing_single_agent'}
   try{
    assertCoachSourceFreeze(input.freezePath)
    if(signal?.aborted||await journal.cancelled(r))throw new WorkflowError('cancelled')
    const records=await input.readEvidence(r);validateEvidence(r,r.authorizedEvidenceRefs,records)
    const funding=activeCoachFunding(budget.snapshot())
    if(!funding||funding.paused||funding.remainingCny<nodeIds.length*maxCost||credits.balance().availableCredits<cfg.maxCreditsPerGraph)throw new WorkflowError('budget_exceeded')
    const methods=await input.readMethods(r);if(methods.length>2)throw new WorkflowError('invalid_contract')
    const remainingMs=end-Date.now()
    if(remainingMs<1)throw new WorkflowError('timeout')
    const payload={...r,directions,modelBudget:{...r.modelBudget,deadlineMs:remainingMs},businessRole:'growth',syntheticAdult:true,evidenceRecords:records,canonicalMethods:methods,contentBinding}
    mkdirSync(cfg.journalDirectory,{recursive:true})
    wire=reserveCozeHostPermit({payload,binding:cfg.binding,nodeIds,maxCostPerCallCny:maxCost,secret,approval:cfg.approval,budget,journalPath:path})
    credits.reserve({requestId:r.requestId,projectId:'7693388932939300905',purpose:'business',reservedCredits:cfg.maxCreditsPerGraph,payloadDigest:hash(payload),sourceDigest:cfg.binding.hostSourceDigest});creditReserved=true
    const {claims}=verifyCozeHostPermit(wire,secret,cfg.binding)
    for(const slot of claims.slots)await journal.startNode(r,{id:slot.nodeId,role:slot.nodeId.startsWith('path:')?'path_analyst':slot.nodeId==='critic'?'independent_critic':'decision_synthesizer',dependencies:[],executionKind:'real_provider',maxCostCny:slot.reservedCostCny,callId:slot.callId,invoke:unavailable})
    if(signal?.aborted||await journal.cancelled(r))throw new WorkflowError('cancelled')
    posted=true;signal?.addEventListener('abort',onAbort,{once:true})
    cancelPoll=setInterval(()=>{if(polling)return;polling=true;pollPromise=journal.cancelled(r).then(async cancelled=>{if(cancelled)await stop()}).catch(async()=>{await stop()}).finally(()=>{polling=false})},100)
    timer=setTimeout(()=>{void stop();responseController.abort('bounded_cleanup_timeout')},Math.max(1,end-Date.now())+15000)
    try{knownReceipt=await post(wire,r.requestId,undefined,responseController.signal)}catch(firstError){
     // This is an authenticated, explicitly zero-dispatch readback operation,
     // never a retry of the paid graph. Preserve the first transport failure.
     appendFileSync(path,JSON.stringify({type:'first_graph_transport_failure',requestId:r.requestId,paidGraphReissued:false,at:new Date().toISOString()})+'\n')
     if(stopPromise)await stopPromise
     try{knownReceipt=await post(wire,r.requestId,'readback',AbortSignal.timeout(10000));if(knownReceipt.receiptIncomplete||knownReceipt.workerFinishedAtReturn!==true)throw firstError}catch{throw firstError}
    }
    writeFileSync(path+'.receipt.json',JSON.stringify(knownReceipt)+'\n',{flag:'wx',mode:0o600})
    settleCozeHostReceipt({wire,secret,binding:cfg.binding,budget,receipt:knownReceipt,journalPath:path});settled=true
    receipt={...receipt,providerCalls:knownReceipt.providerCalls,costCny:knownReceipt.costCny,reservedCostCny:knownReceipt.reservedCostCny,receiptIncomplete:false,workerFinishedAtReturn:true}
    for(const row of knownReceipt.trace){const accounting=budget.snapshot().calls.find((c:CoachCallReceipt)=>c.callId===row.callId)!;await journal.finishNode(r,row.nodeId,null,typeof accounting.estimatedCostCny==='number'?accounting.estimatedCostCny:null,row.started===null?0:1,row.status==='ok'?undefined:row.failure??'unavailable');await input.audit?.(r,{kind:'coze_actual_slot',...row})}
    receipt={...receipt,providerCalls:knownReceipt.providerCalls,costCny:knownReceipt.costCny,reservedCostCny:knownReceipt.reservedCostCny}
    if(signal?.aborted||cancelSent||await journal.cancelled(r))throw new WorkflowError('cancelled')
    assertCoachSourceFreeze(input.freezePath);await input.readMethods(r)
    receipt=parseCozeDirectionReceipt(knownReceipt,r,await input.readEvidence(r))
   }catch(error){
    if(wire&&!settled){
     if(posted){
      const {claims}=verifyCozeHostPermit(wire,secret,cfg.binding,Date.parse(JSON.parse(Buffer.from(wire.claimsB64,'base64').toString()).issuedAt)),calls=budget.snapshot().calls as CoachCallReceipt[]
      const current=claims.slots.map(s=>calls.find(c=>c.callId===s.callId)!)
      // A journal write can fail after the atomic ledger settlement. Never
      // settle those already-finished entries a second time.
      if(current.every(c=>c?.status==='finished')){settled=true;receipt={...receipt,providerCalls:knownReceipt?.providerCalls??nodeIds.length,providerCallsAreUpperBound:!knownReceipt,costCny:knownReceipt?.costCny===null||current.some(c=>typeof c.estimatedCostCny!=='number')?null:current.reduce((n,c)=>n+(c.estimatedCostCny as number),0),reservedCostCny:nodeIds.length*maxCost}}
      else{retainUnknownCozeGraph(wire,secret,cfg.binding,budget,signal?.aborted?'cancelled':'failed',path);receipt={...receipt,providerCalls:nodeIds.length,providerCallsAreUpperBound:true,costCny:null,reservedCostCny:nodeIds.length*maxCost}}
     }else{
      const {claims}=verifyCozeHostPermit(wire,secret,cfg.binding)
      budget.finishGraphReceipts(claims.slots.map(s=>({callId:s.callId,outcome:'not_sent',usage:{providerCalls:0},estimatedCostCny:0,providerResponseId:null})))
      appendFileSync(path,JSON.stringify({type:'host_confirmed_no_cloud_post',requestId:r.requestId,providerCalls:0})+'\n')
      receipt={...receipt,providerCalls:0,costCny:0,reservedCostCny:nodeIds.length*maxCost}
     }
     for(const id of nodeIds)await journal.finishNode(r,id,null,posted?null:0,posted?1:0,signal?.aborted?'cancelled':'unavailable')
    }
    receipt={...receipt,proposal:undefined,status:'unavailable',failure:signal?.aborted||cancelSent?'cancelled':error instanceof WorkflowError?error.code:'unavailable',fallback:'existing_single_agent'}
   }finally{
    if(timer)clearTimeout(timer);if(cancelPoll)clearInterval(cancelPoll);signal?.removeEventListener('abort',onAbort)
    if(pollPromise)await pollPromise
    if(stopPromise)await stopPromise
    if(posted){receipt={...receipt,receiptIncomplete:!settled||knownReceipt?.receiptIncomplete===true,workerFinishedAtReturn:settled&&knownReceipt?.workerFinishedAtReturn!==false,...(cancelSent?{cancelAcknowledged}:{} )};appendFileSync(path,JSON.stringify({type:'host_terminal_observation',requestId:r.requestId,workerFinishedAtReturn:receipt.workerFinishedAtReturn,receiptIncomplete:receipt.receiptIncomplete,cancelAcknowledged:receipt.cancelAcknowledged??null,at:new Date().toISOString()})+'\n')}
    if(creditReserved){try{credits.finishUnknown(r.requestId,receipt.failure==='cancelled'?'cancelled':receipt.status==='proposed'?'completed':'failed',receipt.providerCallsAreUpperBound?null:receipt.providerCalls,r.requestId)}catch{receipt={...receipt,proposal:undefined,status:'unavailable',failure:'budget_exceeded',fallback:'existing_single_agent'};appendFileSync(path,JSON.stringify({type:'credit_attempt_finalization_failed',requestId:r.requestId,reservationRetained:true})+'\n')}}
   }
   await journal.finish(r,receipt);return receipt
  }
 }
}

export function configuredCozeDirectionAdapter(input:Omit<Parameters<typeof createCozeDirectionAdapter>[0],'config'>){
 const path=process.env.LIFEOS_COZE_GROWTH_CONFIG
 if(!path)throw new WorkflowError('unavailable')
 const config=JSON.parse(readFileSync(path,'utf8')) as CozeDirectionConfig
 return createCozeDirectionAdapter({...input,config})
}
