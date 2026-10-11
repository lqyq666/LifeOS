import {WorkflowError,parseRequest,parseProposal,normalizeReviewIssue,type WorkflowRequest,type WorkflowReceipt,type EvidenceReader,type AgentResult} from './contracts.ts'
import {validateEvidence,validateProposal} from './evidence-gate.ts'
import {createOrchestrator,type WorkflowNode,type NodeContext} from './orchestrator.ts'
import {proposalReceipt} from './receipts.ts'
import {loadBusinessSkill} from './skills.ts'
import {routeWorkflow} from './router.ts'
import type {TraceRow} from './trace.ts'
import type {TaskJournal} from './task-journal.ts'
import {validateReviewedFields} from './reviewed-fields.ts'

export type DecisionAdapter={executionKind:'simulated_provider'|'real_provider';maxCostPerCallCny:number;runRemoteGraph?:(request:WorkflowRequest,journal:TaskJournal,signal?:AbortSignal)=>Promise<WorkflowReceipt>;prepareGraph?:(request:WorkflowRequest,nodes:WorkflowNode[])=>Promise<void>;finishGraph?:(request:WorkflowRequest)=>Promise<void>;readNodeAccounting?:(request:WorkflowRequest,nodeId:string)=>{costCny:number;providerCalls:number}|null;analyzeTogether?:(c:NodeContext,directions:{id:string;title:string}[],skill:string)=>ReturnType<WorkflowNode['invoke']>;analyze:(c:NodeContext,direction:{id:string;title:string},skill:string)=>ReturnType<WorkflowNode['invoke']>;critic:(c:NodeContext,analyses:AgentResult[],skill:string)=>ReturnType<WorkflowNode['invoke']>;synthesize:(c:NodeContext,analyses:AgentResult[],critic:AgentResult,skill:string)=>ReturnType<WorkflowNode['invoke']>}
export function createDirectionWorkflow(readEvidence:EvidenceReader,adapter:DecisionAdapter,sink?:(row:TraceRow)=>void,journal?:TaskJournal){
 const runner=createOrchestrator({readEvidence,traceSink:sink,journal,prepareGraph:adapter.prepareGraph,finishGraph:adapter.finishGraph,readNodeAccounting:adapter.readNodeAccounting})
 async function run(raw:WorkflowRequest,signal?:AbortSignal,comparisonMode:'single'|'multi'='multi'):Promise<WorkflowReceipt>{
  const request=structuredClone(parseRequest(raw))
  if(routeWorkflow(request).route!=='candidate'||request.mode!=='direction_decision')throw new WorkflowError('scope_denied')
  const paths=request.directions.filter(x=>!request.controls.forbiddenDirections.includes(x.id))
  if(paths.length<2)throw new WorkflowError('constraint_conflict')
  if(new Set(paths.map(x=>x.id)).size!==paths.length)throw new WorkflowError('invalid_contract')
  if(adapter.executionKind==='real_provider'&&(!adapter.prepareGraph&&!adapter.runRemoteGraph||!journal?.durable))throw new WorkflowError('unavailable')
  const skill=loadBusinessSkill('lifeos-direction-analysis',request.traceId,runner.trace)
  // One remote graph already contains 4/5 paid calls. Never wrap it in the
  // native per-node graph, which would duplicate dispatch and accounting.
  if(adapter.runRemoteGraph){
   if(comparisonMode!=='multi'||!journal)throw new WorkflowError('unavailable')
   return adapter.runRemoteGraph(request,journal,signal)
  }
  const paid=(id:string,role:WorkflowNode['role'],dependencies:string[],invoke:WorkflowNode['invoke']):WorkflowNode=>({id,role,dependencies,invoke,executionKind:adapter.executionKind,maxCostCny:adapter.maxCostPerCallCny})
  if(comparisonMode==='single'){
   if(!adapter.analyzeTogether)throw new WorkflowError('unavailable')
   const nodes=[paid('single_decision','decision_synthesizer',[],c=>adapter.analyzeTogether!(c,paths,skill.instructions))]
   return runner.run(request,nodes,async(r,results)=>{
    const proposal=parseProposal(results.get('single_decision')?.proposal),records=await readEvidence(r)
    validateProposal(r,proposal,records)
    if(proposal.alternatives.length!==paths.length||paths.some(p=>!proposal.alternatives.some(a=>a.directionId===p.id)))throw new WorkflowError('invalid_contract')
    return {...proposalReceipt(r,proposal,{providerCalls:0,costCny:0,reservedCostCny:0,executionKind:adapter.executionKind,skills:[skill.name]}),reviewIssues:[]}
   },signal)
  }
  const analyses=(results:ReadonlyMap<string,AgentResult>)=>paths.map(x=>results.get('path:'+x.id)!)
  const nodes:WorkflowNode[]=paths.map(path=>paid('path:'+path.id,'path_analyst',[],c=>adapter.analyze(c,path,skill.instructions)))
  nodes.push({id:'constraints',role:'constraint_validator',dependencies:paths.map(x=>'path:'+x.id),executionKind:'local_deterministic',maxCostCny:0,invoke:async c=>{
   const records=await readEvidence(c.request)
   for(const result of analyses(c.results)){
    validateEvidence(c.request,result.evidenceRefs,records)
    if(!result.proposal)throw new WorkflowError('invalid_contract')
    validateProposal(c.request,parseProposal(result.proposal),records)
   }
   return {result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'来源、时间预算与禁止方向校验通过',issues:[]},costCny:0,providerCalls:0}
  }})
  nodes.push(paid('critic','independent_critic',['constraints'],c=>adapter.critic(c,analyses(c.results),skill.instructions)))
  nodes.push({id:'critic_check',role:'evidence_guardian',dependencies:['critic'],executionKind:'local_deterministic',maxCostCny:0,invoke:async c=>{
   const critic=c.results.get('critic')!
   if(critic.issues.some(x=>typeof x!=='string'&&x.severity==='blocker'))throw new WorkflowError('constraint_conflict')
   return {result:{evidenceRefs:critic.evidenceRefs,summary:'独立审阅未报告结构冲突；仍保留未知',issues:[]},providerCalls:0,costCny:0}
  }})
  nodes.push(paid('synthesis','decision_synthesizer',['critic_check'],c=>adapter.synthesize(c,analyses(c.results),c.results.get('critic')!,skill.instructions)))
  return runner.run(request,nodes,async (r,results)=>{
   const raw=results.get('synthesis')?.proposal
   const proposal=parseProposal(raw),records=await readEvidence(r)
   validateProposal(r,proposal,records)
   // Synthesis selects independently reviewed content. It cannot author new facts,
   // even while citing a valid ID. Compare every visible field, not a keyword blacklist.
   const reviewed=analyses(results).map(x=>parseProposal(x.proposal))
   validateReviewedFields(proposal,{alternatives:reviewed.flatMap(x=>x.alternatives),nextActions:reviewed.flatMap(x=>x.nextActions),hypotheses:reviewed.flatMap(x=>x.hypotheses)})
   if(proposal.alternatives.length!==paths.length||paths.some(p=>!proposal.alternatives.some(a=>a.directionId===p.id)))throw new WorkflowError('invalid_contract')
   const reviewIssues=results.get('critic')!.issues.map(normalizeReviewIssue)
   return {...proposalReceipt(r,proposal,{providerCalls:0,costCny:0,reservedCostCny:0,executionKind:adapter.executionKind,skills:[skill.name]}),reviewIssues}
  },signal)
 }
 return {run,trace:runner.trace}
}
