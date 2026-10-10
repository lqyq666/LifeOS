import type {PoolClient} from 'pg'
import {pool} from '../db.ts'
import {growthQuoteSuppressed} from '../growth-privacy.ts'
import {growthView} from '../growth.ts'
import type {GrowthItem} from '../../src/features/growth/types.ts'
import {growthDiff,type GrowthSnapshotItem,type GrowthDelta} from './growth-diff.ts'
import type {WorkflowRequest,EvidenceRecord} from './contracts.ts'
import type {TraceRow} from './trace.ts'
export const growthSnapshot=(items:GrowthItem[]):GrowthSnapshotItem[]=>items.filter(x=>!x.unavailableReason&&['active','proposed'].includes(x.status)&&['user_reported','user_edit','ai_observation'].includes(x.assertion)).map(x=>({ref:{type:'growth',id:x.id,revision:x.revision},text:x.text,status:x.status as 'active'|'proposed',assertion:x.assertion as GrowthSnapshotItem['assertion'],kind:x.kind==='observation'?'observation':x.kind==='constraint'||x.kind==='context'?'constraint':'goal'}))
export async function committedSnapshot(c:Pick<PoolClient,'query'>,actor:string,conversationId:string):Promise<GrowthSnapshotItem[]>{
 const result=growthSnapshot((await growthView(actor,conversationId,c)).items)
 const rows=(await c.query(`SELECT e.id,e.revision,e.content,e.source_message_id,e.source_quote FROM experiences e
 JOIN messages m ON m.user_id=e.user_id AND m.id=e.source_message_id
 WHERE e.user_id=$1 AND e.status='confirmed' AND (e.conversation_id=$2 OR EXISTS(SELECT 1 FROM user_memory_settings WHERE user_id=$1 AND enabled=true))
 AND m.role='user' AND btrim(e.source_quote)<>'' AND strpos(m.content,e.source_quote)>0`,[actor,conversationId])).rows
 for(const row of rows)if(!await growthQuoteSuppressed(c,actor,row.source_message_id,row.source_quote))result.push({ref:{type:'experience',id:row.id,revision:row.revision},text:row.content.summary,kind:'experience',status:'active',assertion:'user_reported'})
 return result
}
// Called under finishRun's transaction after snapshot assertions and real writes.
// This projection has no write or model tool. The run commits or rolls back with it.
export async function committedGrowthDiff(c:PoolClient,actor:string,conversationId:string,requestId:string,before:GrowthSnapshotItem[],changedIds:string[],sink:(row:TraceRow)=>void){
 if(!changedIds.length)return []
 const after=await committedSnapshot(c,actor,conversationId),refs=after.filter(x=>changedIds.includes(x.ref.id)).map(x=>x.ref)
 const request:WorkflowRequest={schemaVersion:2,traceId:requestId,requestId,mode:'growth_diff',internalActorKey:actor,conversationId,currentIntent:'已授权事务中的实际成长变化',authorizedEvidenceRefs:refs,consent:{continueReview:false,deepAnalysis:false},controls:{memoryEnabled:true,listeningOnly:false,refuseAdvice:false,memoryControl:false,recommendationsPaused:false,forbiddenDirections:[]},budget:null,modelBudget:{maxProviderCalls:0,maxCostCny:0,deadlineMs:1000},directions:[],synthetic:false}
 const records:EvidenceRecord[]=after.map(x=>({ref:x.ref,owner:actor,conversationId,role:'user',status:'active',text:x.text}))
 return growthDiff(request,{traceId:requestId,requestId,committed:true,changedIds},before,after,records,sink)
}
export async function validGrowthDiff(actor:string,conversationId:string,deltas:GrowthDelta[]):Promise<GrowthDelta[]>{
 const current=await committedSnapshot(pool,actor,conversationId)
 return deltas.map(delta=>{
  if(delta.change==='withdrawn')return delta
  const ref=delta.evidenceRefs[0],item=current.find(x=>x.ref.id===ref?.id&&x.ref.type===ref?.type)
  if(item&&['active','proposed'].includes(item.status)&&item.ref.revision===ref?.revision)return delta
  return {...delta,before:'此前存在的一条记录',now:'原依据已改变或撤回，之前的解释停止使用。',evidenceRefs:[],unknowns:[],needsConfirmation:false,change:'withdrawn' as const}
 })
}
