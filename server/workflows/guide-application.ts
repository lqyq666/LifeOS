import {WorkflowError,emptyProposal,type WorkflowRequest,type EvidenceRecord} from './contracts.ts'
import {validateEvidence,validateProposal} from './evidence-gate.ts'
import {createTrace,type TraceRow} from './trace.ts'
import {loadBusinessSkill} from './skills.ts'
export type ApprovedGuideInput={guideId:string;revision:number;sourceHash:string;reviewStatus:'approved'|'needs_review';current:boolean;branch:string;stepId:string;description:string;minutes:number;stopCondition:string;support:'source_supported'|'lifeos_adaptation'}
// The caller must read the full authenticated host card. This does not create another KB.
export function applyGuide(request:WorkflowRequest,guide:ApprovedGuideInput,records:EvidenceRecord[],sink?:(row:TraceRow)=>void){
 if(guide.reviewStatus!=='approved'||!guide.current||!/^[a-f0-9]{64}$/.test(guide.sourceHash))throw new WorkflowError('source_invalid')
 if(request.controls.refuseAdvice||request.controls.listeningOnly||request.controls.recommendationsPaused||request.controls.memoryControl)throw new WorkflowError('scope_denied')
 const ref={type:'knowledge' as const,id:guide.guideId,revision:guide.revision}
 validateEvidence(request,[ref],records)
 const trace=createTrace(sink);loadBusinessSkill('lifeos-guide-application',request.traceId,trace)
 const p=emptyProposal(request);p.evidenceRefs=[ref]
 p.nextActions=[{description:guide.description,estimatedMinutes:guide.minutes,stopCondition:guide.stopCondition,evidenceRefs:[ref]}]
 validateProposal(request,p,records)
 return {proposal:p,guideUsageCandidate:{guideId:guide.guideId,revision:guide.revision,branch:guide.branch,stepId:guide.stepId,status:'suggested' as const,eventId:request.eventId},support:guide.support}
}
