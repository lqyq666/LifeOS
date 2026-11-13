import {transaction,HttpError} from '../db.ts'
import {readCoachEventWithSources,assertCoachEvidence,coachSourceControlKey,type CoachEvent} from '../action-coach-events.ts'
import {readGuideUsageWithin} from '../guide-usage.ts'
import {checkMessageSource} from '../growth-privacy.ts'
import {lockGrowth} from '../growth.ts'
import {WorkflowError,type WorkflowRequest,type EvidenceRecord} from './contracts.ts'
import type {ActionCase} from './action-review.ts'
type BoundMessageSource={messageId:string;quote:string;conversationId:string;range?:{start:number;end:number}}
const uniqueBoundSources=(sources:readonly BoundMessageSource[])=>[...new Map(sources.map(source=>[JSON.stringify([source.messageId,source.quote,source.conversationId,source.range?.start??null,source.range?.end??null]),source])).values()]
// Existing host APIs enforce ownership, Memory OFF, partial forgetting and withdrawals.
// There is deliberately no DB write tool or Coze/private-profile transport here.
export async function readActionEnvelope(request:WorkflowRequest):Promise<{event:CoachEvent;actionCase:ActionCase;records:EvidenceRecord[]}>{
 if(!request.eventId)throw new WorkflowError('ambiguous_event')
 const {event,rootSource,nodeSources,processSources,sourceControlKey}=await transaction(async c=>{
  const {event,bindings}=await readCoachEventWithSources(c,request.internalActorKey,request.conversationId,request.eventId!)
  return {event,rootSource:bindings.titleSource,nodeSources:new Map<string,BoundMessageSource>(bindings.nodeSources.map(row=>[row.nodeId,row.source])),processSources:bindings.processSources,sourceControlKey:await coachSourceControlKey(c,request.internalActorKey,event.id)}
 })
 let usage:Awaited<ReturnType<typeof readGuideUsageWithin>>=[]
 const requestedMessages=request.authorizedEvidenceRefs.filter(ref=>ref.type==='message')
 // One EvidenceRecord is keyed by message id in the workflow contract. Refuse
 // conflicting fragments for the same id instead of silently keeping whichever
 // node happens to be first in the event array.
 const authorizedByMessage=new Map<string,(typeof requestedMessages)[number]>()
 for(const ref of requestedMessages){
  const previous=authorizedByMessage.get(ref.id)
  if(!ref.quote||previous&&previous.quote!==ref.quote)throw new WorkflowError('source_invalid')
  if(!previous)authorizedByMessage.set(ref.id,ref)
 }
 const authorizedMessages=[...authorizedByMessage.values()]
 const sourceNodes=event.nodes.filter(n=>n.kind==='fact'&&n.status==='active'&&!n.supersededByActionCorrection&&n.source)
 if(!rootSource?.quote)throw new WorkflowError('source_invalid')
 const records:EvidenceRecord[]=[{ref:{type:'event',id:event.id,revision:event.revision},owner:request.internalActorKey,conversationId:event.conversationId,status:'active',role:'user',text:event.title,eventId:event.id}]
 const recordSources=new Map<string,BoundMessageSource>()
 for(const ref of authorizedMessages){
  const nodeMatches=sourceNodes.flatMap(node=>{
   const source=nodeSources.get(node.id)
   return node.source!.messageId===ref.id&&node.source!.quote===ref.quote&&source?.messageId===ref.id&&source.quote===ref.quote?[source]:[]
  })
  const processMatches=processSources.filter(source=>source.messageId===ref.id&&source.quote===ref.quote)
  const matches=uniqueBoundSources([...nodeMatches,...processMatches])
  if(matches.length>1)throw new WorkflowError('source_invalid')
  const source=matches[0]
  if(source){records.push({ref:{type:'message',id:ref.id,revision:1},owner:request.internalActorKey,conversationId:source.conversationId,status:'active',role:'user',text:source.quote,eventId:event.id});recordSources.set(ref.id,source)}
 }
 // Current user messages may not yet be event nodes. Read only the server-authorized
 // exact fragment, with the same host suppressions, never arbitrary account history.
 const pending=authorizedMessages.filter(ref=>!records.some(record=>record.ref.type==='message'&&record.ref.id===ref.id))
 const currentRows=pending.length?await transaction(async c=>(await c.query("SELECT id,conversation_id FROM messages WHERE user_id=$1 AND id=ANY($2::uuid[]) AND role='user'",[request.internalActorKey,pending.map(ref=>ref.id)])).rows):[]
 const currentById=new Map(currentRows.map(row=>[String(row.id),String(row.conversation_id)]))
 for(const ref of pending){
  const conversationId=currentById.get(ref.id)
  if(!conversationId||!ref.quote||!request.controls.memoryEnabled&&conversationId!==request.conversationId)continue
  const source:BoundMessageSource={messageId:ref.id,quote:ref.quote,conversationId}
  records.push({ref:{type:'message',id:ref.id,revision:1},owner:request.internalActorKey,conversationId,status:'active',role:'user',text:ref.quote,eventId:event.id})
  recordSources.set(ref.id,source)
 }
 // Revalidate every returned fragment once through the shared source gate. A
 // native event node keeps its private exact range here even though the public
 // event/API source shape deliberately omits that coordinate.
 await transaction(async c=>{
  // Source controls mutate memory, growth projections and raw interview
  // chronology in this canonical order. Holding the same account locks until
  // commit turns all checks below into one serialized authority snapshot.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[request.internalActorKey+':memory-settings'])
  await lockGrowth(c,request.internalActorKey)
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[request.internalActorKey+':interview-chronology'])
  try{
   const eventConversationVisible=(await c.query('SELECT 1 FROM conversations c WHERE c.user_id=$1 AND c.id=$2 AND NOT EXISTS (SELECT 1 FROM deleted_conversations d WHERE d.user_id=c.user_id AND d.conversation_id=c.id)',[request.internalActorKey,event.conversationId])).rowCount
   if(!eventConversationVisible)throw new HttpError(409,'COACH_SNAPSHOT_INVALIDATED')
   await assertCoachEvidence(c,request.internalActorKey,request.conversationId,[{eventId:event.id,revision:event.revision,generation:event.generation,sourceControlKey}])
   for(const source of uniqueBoundSources([rootSource,...nodeSources.values(),...processSources]))await checkMessageSource(c,request.internalActorKey,source.conversationId,{id:source.messageId,quote:source.quote,range:source.range})
  }
  catch(error){if(error instanceof HttpError)throw new WorkflowError('source_invalid');throw error}
  for(let i=records.length-1;i>=0;i--){
   const record=records[i]
   if(record.ref.type!=='message')continue
   const source=recordSources.get(record.ref.id)
   try{if(!source)throw new HttpError(400,'CAMPUS_SOURCE_INVALID');await checkMessageSource(c,request.internalActorKey,source.conversationId,{id:source.messageId,quote:source.quote,range:source.range})}
   catch(error){if(error instanceof HttpError){records.splice(i,1);continue}throw error}
  }
  // Guide-only feedback is source-derived too. Read it on this same locked
  // snapshot instead of carrying a value cached before source-control writers.
  usage=await readGuideUsageWithin(c,request.internalActorKey,request.conversationId,request.eventId!)
 })
 const actionCase:ActionCase={eventId:event.id,revision:event.revision,object:event.title,request:String(event.actions.find(a=>a.status==='proposed')?.draft?.goal??'原先的问题'),known:event.actionStages??{sent:null,read:null,replied:null,used:null,effect:null},usage:usage.slice().reverse().map(row=>({status:row.status,source:{type:'message' as const,id:row.source_message_id??'unavailable',revision:1,...(row.source_quote?{quote:row.source_quote}:{})}})),answeredQuestions:event.asked}
 return {event,actionCase,records}
}
