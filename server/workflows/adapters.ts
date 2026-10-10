import {transaction} from '../db.ts'
import {readCoachEvent,type CoachEvent} from '../action-coach-events.ts'
import {readGuideUsage} from '../guide-usage.ts'
import {growthQuoteSuppressed} from '../growth-privacy.ts'
import {WorkflowError,type WorkflowRequest,type EvidenceRecord} from './contracts.ts'
import type {ActionCase} from './action-review.ts'
// Existing host APIs enforce ownership, Memory OFF, partial forgetting and withdrawals.
// There is deliberately no DB write tool or Coze/private-profile transport here.
export async function readActionEnvelope(request:WorkflowRequest):Promise<{event:CoachEvent;actionCase:ActionCase;records:EvidenceRecord[]}>{
 if(!request.eventId)throw new WorkflowError('ambiguous_event')
 const event=await transaction(c=>readCoachEvent(c,request.internalActorKey,request.conversationId,request.eventId!))
 const usage=await readGuideUsage(request.internalActorKey,request.conversationId,request.eventId)
 const sourceNodes=[] as CoachEvent['nodes']
 for(const n of event.nodes)if(n.kind==='fact'&&n.status==='active'&&!n.supersededByActionCorrection&&n.source&&!await transaction(c=>growthQuoteSuppressed(c,request.internalActorKey,n.source!.messageId,n.source!.quote)))sourceNodes.push(n)
 const rootSource=await transaction(async c=>(await c.query('SELECT title_source FROM coach_events WHERE user_id=$1 AND id=$2',[request.internalActorKey,event.id])).rows[0]?.title_source)
 if(!rootSource||await transaction(c=>growthQuoteSuppressed(c,request.internalActorKey,rootSource.messageId,rootSource.quote)))throw new WorkflowError('source_invalid')
 const records:EvidenceRecord[]=[{ref:{type:'event',id:event.id,revision:event.revision},owner:request.internalActorKey,conversationId:event.conversationId,status:'active',role:'user',text:event.title,eventId:event.id}]
 for(const ref of request.authorizedEvidenceRefs.filter(x=>x.type==='message')){
  const node=sourceNodes.find(n=>n.source!.messageId===ref.id)
  if(node)records.push({ref:{type:'message',id:ref.id,revision:1},owner:request.internalActorKey,conversationId:node.source!.conversationId,status:'active',role:'user',text:node.source!.quote,eventId:event.id})
 }
 // Process sources returned by readCoachEvent also pass the host suppression checks.
 const sources=(event.processTurns??[]).flatMap(t=>t.inputSources??[])
 for(const ref of request.authorizedEvidenceRefs.filter(x=>x.type==='message')){
  if(records.some(x=>x.ref.type==='message'&&x.ref.id===ref.id))continue
  const source=sources.find(x=>x.messageId===ref.id)
  if(source)records.push({ref:{type:'message',id:ref.id,revision:1},owner:request.internalActorKey,conversationId:source.conversationId,status:'active',role:'user',text:source.quote,eventId:event.id})
 }
 // Current user messages may not yet be event nodes. Read only the server-authorized
 // exact fragment, with the same host suppressions, never arbitrary account history.
 for(const ref of request.authorizedEvidenceRefs.filter(x=>x.type==='message')){
  if(records.some(x=>x.ref.type==='message'&&x.ref.id===ref.id))continue
  const record=await transaction(async c=>{
   const row=(await c.query(`SELECT m.content,m.conversation_id FROM messages m WHERE m.user_id=$1 AND m.id=$2 AND m.role='user'
    AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE s.user_id=m.user_id AND s.source_message_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM experiences e WHERE e.user_id=m.user_id AND e.source_message_id=m.id AND e.status='deleted')`,[request.internalActorKey,ref.id])).rows[0]
   if(!row||!ref.quote||!row.content.includes(ref.quote)||!request.controls.memoryEnabled&&row.conversation_id!==request.conversationId||await growthQuoteSuppressed(c,request.internalActorKey,ref.id,ref.quote))return null
   return {ref:{type:'message' as const,id:ref.id,revision:1},owner:request.internalActorKey,conversationId:row.conversation_id,status:'active' as const,role:'user' as const,text:ref.quote,eventId:event.id}
  })
  if(record)records.push(record)
 }
 // Returned historical fragments are filtered again for partial forgetting.
 for(let i=records.length-1;i>=0;i--){const r=records[i];if(r.ref.type==='message'&&await transaction(c=>growthQuoteSuppressed(c,request.internalActorKey,r.ref.id,r.text)))records.splice(i,1)}
 const actionCase:ActionCase={eventId:event.id,revision:event.revision,object:event.title,request:String(event.actions.find(a=>a.status==='proposed')?.draft?.goal??'原先的问题'),known:event.actionStages??{sent:null,read:null,replied:null,used:null,effect:null},usage:usage.slice().reverse().map(row=>({status:row.status,source:{type:'message' as const,id:row.source_message_id??'unavailable',revision:1,...(row.source_quote?{quote:row.source_quote}:{})}})),answeredQuestions:event.asked}
 return {event,actionCase,records}
}
