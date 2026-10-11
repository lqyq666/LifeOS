import {WorkflowError,type WorkflowProposal} from './contracts.ts'

// Both the native and remote runners apply the same final synthesis boundary.
// The final reply may select reviewed fields; it cannot introduce new claims.
export function validateReviewedFields(proposal:WorkflowProposal,reviewed:Pick<WorkflowProposal,'alternatives'|'nextActions'|'hypotheses'>){
 for(const alternative of proposal.alternatives){
  const candidates=reviewed.alternatives.filter(x=>x.directionId===alternative.directionId)
  if(!candidates.some(x=>x.title===alternative.title&&x.weeklyMinutes===alternative.weeklyMinutes&&JSON.stringify(x.evidenceRefs)===JSON.stringify(alternative.evidenceRefs)))throw new WorkflowError('source_invalid')
  for(const field of ['pros','tradeoffs','unknowns'] as const)if(alternative[field].some(value=>!candidates.some(x=>x[field].includes(value))))throw new WorkflowError('source_invalid')
 }
 for(const field of ['nextActions','hypotheses'] as const)if(proposal[field].some(value=>!reviewed[field].some(y=>JSON.stringify(y)===JSON.stringify(value))))throw new WorkflowError('source_invalid')
}
