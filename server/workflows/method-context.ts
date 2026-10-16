import {knowledgeIntent,methodPromptContext} from '../evergreen-guide.ts'
import {retrieveCoachKnowledgeCandidates,readApprovedGuide} from '../coach-knowledge.ts'
import type {WorkflowRequest} from './contracts.ts'
import type {KnowledgeCard} from '../campus-knowledge.ts'
import {WorkflowError} from './contracts.ts'
import {selectJevMethodCandidates,type JevMethodFitTrace} from '../jev-method-fit.ts'
// One existing corpus/cache, at most two cards per task; never a provider-owned guide library.
export function workflowMethodReader(audit?:(r:WorkflowRequest,trace:JevMethodFitTrace)=>void|Promise<void>){
 const cache=new Map<string,Promise<Awaited<ReturnType<typeof selectJevMethodCandidates>>>>()
 return async(r:WorkflowRequest)=>{
  if(r.controls.listeningOnly||r.controls.refuseAdvice||r.controls.memoryControl)return []
  const intent=knowledgeIntent(r.currentIntent);if(['NONE','CLARIFY'].includes(intent.decision))return []
  const key=r.internalActorKey+':'+r.requestId
  let retrieval=cache.get(key)
  if(!retrieval){if(cache.size>=64)cache.delete(cache.keys().next().value!);retrieval=retrieveCoachKnowledgeCandidates(intent.query,undefined,intent).then(result=>selectJevMethodCandidates(result.candidates,r.controls.memoryEnabled?intent.query:r.currentIntent,intent));cache.set(key,retrieval)}
  let selected:Awaited<typeof retrieval>
  try{selected=await retrieval;await audit?.(r,selected.trace)}catch(error){if(cache.get(key)===retrieval)cache.delete(key);throw error}
  // Share only retrieval work. Each caller still checks live approval/revision.
  const cards:KnowledgeCard[]=[];for(const card of selected.cards){try{cards.push(await readApprovedGuide(card.id,card.revision))}catch{if(cache.get(key)===retrieval)cache.delete(key);throw new WorkflowError('source_invalid')}}
  return methodPromptContext(cards,r.currentIntent,intent).knowledge
 }
}
