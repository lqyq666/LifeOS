import {knowledgeIntent,methodPromptContext} from '../evergreen-guide.ts'
import {retrieveCoachKnowledge,readApprovedGuide} from '../coach-knowledge.ts'
import type {WorkflowRequest} from './contracts.ts'
import type {KnowledgeCard} from '../campus-knowledge.ts'
import {WorkflowError} from './contracts.ts'
// One existing corpus/cache, at most two cards per task; never a provider-owned guide library.
export function workflowMethodReader(){
 const cache=new Map<string,KnowledgeCard[]>()
 return async(r:WorkflowRequest)=>{
  if(r.controls.listeningOnly||r.controls.refuseAdvice||r.controls.memoryControl)return []
  const intent=knowledgeIntent(r.currentIntent);if(['NONE','CLARIFY'].includes(intent.decision))return []
  const key=r.internalActorKey+':'+r.requestId
  if(!cache.has(key)){if(cache.size>=64)cache.delete(cache.keys().next().value!);cache.set(key,await retrieveCoachKnowledge(intent.query,undefined,intent))}
  const cards:KnowledgeCard[]=[];for(const card of cache.get(key)!){try{cards.push(await readApprovedGuide(card.id,card.revision))}catch{cache.delete(key);throw new WorkflowError('source_invalid')}}
  return methodPromptContext(cards,r.currentIntent,intent).knowledge
 }
}
