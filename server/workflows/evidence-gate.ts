import {WorkflowError,type EvidenceRecord,type EvidenceRef,type WorkflowRequest,type WorkflowProposal} from './contracts.ts'
export const refKey=(ref:EvidenceRef)=>`${ref.type}:${ref.id}:${ref.revision}`
export function validateEvidence(request:WorkflowRequest,refs:EvidenceRef[],records:EvidenceRecord[]){
 const authorized=new Map(request.authorizedEvidenceRefs.map(x=>[refKey(x),x]))
 if(new Set(records.map(x=>`${x.ref.type}:${x.ref.id}`)).size!==records.length)throw new WorkflowError('source_invalid')
 for(const ref of refs){
  const allowed=authorized.get(refKey(ref))
  if(!allowed)throw new WorkflowError('scope_denied')
  const record=records.find(x=>x.ref.type===ref.type&&x.ref.id===ref.id)
  if(!record||record.status!=='active')throw new WorkflowError('source_invalid')
  if(record.ref.revision!==ref.revision)throw new WorkflowError('stale_snapshot')
  if(record.role==='public'){if(ref.type!=='knowledge'||record.owner!==null||record.approved!==true)throw new WorkflowError('source_invalid')}
  else{
   if(record.owner!==request.internalActorKey)throw new WorkflowError('scope_denied')
   if(!request.controls.memoryEnabled&&record.conversationId!==request.conversationId)throw new WorkflowError('scope_denied')
   if(record.role==='assistant')throw new WorkflowError('source_invalid')
  }
  if(record.eventId&&request.eventId&&record.eventId!==request.eventId)throw new WorkflowError('scope_denied')
  if(ref.quote&&(!record.text.includes(ref.quote)||allowed.quote&&allowed.quote!==ref.quote))throw new WorkflowError('source_invalid')
 }
}
export function validateProposal(request:WorkflowRequest,proposal:WorkflowProposal,records:EvidenceRecord[]){
 if(proposal.traceId!==request.traceId||proposal.suggestedStateChanges.length)throw new WorkflowError('invalid_contract')
 validateEvidence(request,[...proposal.evidenceRefs,...proposal.alternatives.flatMap(x=>x.evidenceRefs),...proposal.nextActions.flatMap(x=>x.evidenceRefs)],records)
 if(!proposal.evidenceRefs.length)throw new WorkflowError('source_invalid')
 const allowed=new Set(request.directions.map(x=>x.id))
 if(proposal.alternatives.some(x=>!allowed.has(x.directionId)||request.controls.forbiddenDirections.includes(x.directionId))||proposal.nextActions.some(x=>x.directionId&&(!allowed.has(x.directionId)||request.controls.forbiddenDirections.includes(x.directionId))))throw new WorkflowError('constraint_conflict')
 if(new Set(proposal.alternatives.map(x=>x.directionId)).size!==proposal.alternatives.length)throw new WorkflowError('invalid_contract')
 if(request.budget){
  validateEvidence(request,[request.budget.source],records)
  const source=records.find(r=>refKey(r.ref)===refKey(request.budget!.source))
  // The host resolves this structure from its authorized time/constraint record.
  // An Agent citing the right message but inventing its amount/period is rejected.
  if(!source?.budget||source.role==='public'||source.budget.amountMinutes!==request.budget.amountMinutes||source.budget.period!==request.budget.period)throw new WorkflowError('constraint_conflict')
  // Each alternative is standalone. Only the proposed stage's combined actions are summed.
  if(proposal.alternatives.some(x=>x.weeklyMinutes!==null&&x.weeklyMinutes>request.budget!.amountMinutes)||proposal.nextActions.some(x=>x.estimatedMinutes===null)||proposal.nextActions.reduce((n,x)=>n+(x.estimatedMinutes??0),0)>request.budget.amountMinutes)throw new WorkflowError('constraint_conflict')
 }
 if(proposal.nextActions.some(x=>!x.evidenceRefs.length)||proposal.alternatives.some(x=>!x.evidenceRefs.length))throw new WorkflowError('source_invalid')
}
