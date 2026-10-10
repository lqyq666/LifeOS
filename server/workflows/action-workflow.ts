import {WorkflowError,parseRequest,type WorkflowRequest,type EvidenceReader,type WorkflowReceipt,type EvidenceRef} from './contracts.ts'
import {validateProposal} from './evidence-gate.ts'
import {createOrchestrator,type WorkflowNode} from './orchestrator.ts'
import {resolveActionCase,reviewAction,type ActionCase,type ActionReview} from './action-review.ts'
import {proposalReceipt} from './receipts.ts'
import {loadBusinessSkill} from './skills.ts'
import {routeWorkflow} from './router.ts'
import type {TraceRow} from './trace.ts'
import type {TaskJournal} from './task-journal.ts'
export function createActionWorkflow(readEvidence:EvidenceReader,sink?:(row:TraceRow)=>void,journal?:TaskJournal){
 const runner=createOrchestrator({readEvidence,traceSink:sink,journal})
 const reviews=new Map<string,ActionReview>()
 async function run(raw:WorkflowRequest,cases:ActionCase[],current:EvidenceRef,signal?:AbortSignal):Promise<{receipt:WorkflowReceipt;review:ActionReview|null}>{
  const request=structuredClone(parseRequest(raw)),authorizedCases=structuredClone(cases),feedbackSource=structuredClone(current)
  if(request.mode!=='action_review'||routeWorkflow(request).route!=='candidate')throw new WorkflowError('scope_denied')
  const skill=loadBusinessSkill('lifeos-action-review',request.traceId,runner.trace)
  // A closure belongs to this invocation only; the receipt is the idempotent result.
  let actionCase:ActionCase|undefined,review:ActionReview|null=null
  const node=(id:string,role:WorkflowNode['role'],dependencies:string[],fn:()=>Promise<unknown>):WorkflowNode=>({id,role,dependencies,maxCostCny:0,executionKind:'local_deterministic',invoke:async()=>({result:await fn(),providerCalls:0,costCny:0})})
  const nodes=[node('case','case_resolver',[],async()=>{actionCase=resolveActionCase(request,authorizedCases);return {evidenceRefs:request.authorizedEvidenceRefs.filter(x=>x.type==='event'),summary:'已定位同一授权事件',issues:[]}}),node('review','action_reviewer',['case'],async()=>{review=reviewAction(request,actionCase!,feedbackSource);return {evidenceRefs:review.proposal.evidenceRefs,summary:review.reply,issues:[],proposal:review.proposal}})]
  const receipt=await runner.run(request,nodes,async r=>{
   if(!review)throw new WorkflowError('unavailable')
   validateProposal(r,review.proposal,await readEvidence(r))
   return proposalReceipt(r,review.proposal,{providerCalls:0,costCny:0,reservedCostCny:0,executionKind:'local_deterministic',skills:[skill.name]})
  },signal)
  const key=request.internalActorKey+':'+request.requestId
  if(receipt.status==='proposed'&&review)reviews.set(key,structuredClone(review))
  return {receipt,review:receipt.status==='proposed'?structuredClone(reviews.get(key)??null):null}
 }
 return {run,trace:runner.trace}
}
