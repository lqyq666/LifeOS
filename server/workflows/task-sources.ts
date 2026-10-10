import {createHash} from 'node:crypto'
import type {PoolClient} from 'pg'
import {pool,HttpError} from '../db.ts'
import {growthView} from '../growth.ts'
import {growthQuoteSuppressed} from '../growth-privacy.ts'
import {checkCampusSource} from '../campus.ts'
import {readDirectionControls,directionControlsSnapshotKey} from '../growth-controls.ts'
import {readRecommendationControls} from '../memory-controls.ts'
import {applicableTimeBudget,type BudgetContext} from '../turn-obligations.ts'
import {resolveTimeWindow} from '../growth-time.ts'
import {WorkflowError,type WorkflowRequest,type EvidenceRecord} from './contracts.ts'
type DB=Pick<PoolClient,'query'>
export async function workflowControls(user:string,c:DB=pool){
 const memory=(await c.query('SELECT enabled,revision FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]??{enabled:false,revision:0}
 const directions=await readDirectionControls(user,c),stopped=await readRecommendationControls(user,c)
 const boundaries=(await c.query("SELECT id,revision,status FROM growth_items WHERE user_id=$1 AND status IN ('paused','rejected','forgotten') ORDER BY id",[user])).rows
 return {memory,directions,stopped,digest:createHash('sha256').update(JSON.stringify({memory,directions,stopped,boundaries})).digest('hex'),directionKey:directionControlsSnapshotKey(directions)}
}
export function timeBudget(text:string,context?:BudgetContext):EvidenceRecord['budget']|undefined{
 const selected=applicableTimeBudget(text,context)
 return selected?{period:selected.period,amountMinutes:selected.amountMinutes}:undefined
}
export function selectWorkflowBudget(r:WorkflowRequest,records:EvidenceRecord[]):WorkflowRequest['budget']{
 const target=r.hostSnapshot?.budgetQuestion?.period
 const eligible=records.filter(x=>x.budget&&(x.budget.period==='current'||!target||x.budget.period===target))
 // A newly authorized scoped answer updates this week's actual availability.
 // An older remainder cannot override it merely because it says "remaining".
 const scopedMessage=eligible.filter(x=>x.ref.type==='message'&&x.budget?.period!=='current').at(-1)
 if(scopedMessage?.budget)return {...scopedMessage.budget,source:scopedMessage.ref}
 const rank=(x:EvidenceRecord)=>x.budget?.period==='current'?1:x.budget?.scope==='remaining'?3:2
 const strongest=eligible.filter(x=>rank(x)===Math.max(...eligible.map(rank)))
 // A current authorized message is an explicit new value; otherwise conflicting
 // contemporaneous facts stay unresolved instead of choosing the smaller number.
 const current=strongest.filter(x=>x.ref.type==='message'),chosen=current.at(-1)??strongest[0]
 if(!chosen?.budget||!current.length&&new Set(strongest.map(x=>x.budget!.amountMinutes)).size>1)return null
 return {...chosen.budget,source:chosen.ref}
}
export async function readWorkflowEvidence(r:WorkflowRequest,c:DB=pool):Promise<EvidenceRecord[]>{
 const controls=await workflowControls(r.internalActorKey,c)
 if(r.hostSnapshot&&controls.digest!==r.hostSnapshot.controlsDigest)throw new WorkflowError('stale_snapshot')
 const growth=await growthView(r.internalActorKey,r.conversationId,c),records:EvidenceRecord[]=[]
 for(const ref of r.authorizedEvidenceRefs){
  if(ref.type==='growth'){
   const found=growth.items.find(x=>x.id===ref.id)
   if(!found||found.unavailableReason||!['active','proposed'].includes(found.status)||found.recommendationStopped)continue
   // AI observations remain candidates; never label them student facts.
   if(!['user_reported','user_edit'].includes(found.assertion))continue
   const budget=applicableTimeBudget(found.text,undefined,r.hostSnapshot?.budgetQuestion?.period)
   records.push({ref:{type:'growth',id:found.id,revision:found.revision},owner:r.internalActorKey,conversationId:found.conversationId,status:'active',role:'user',text:found.text,...(budget?{budget}:{})})
  }else if(ref.type==='message'){
   const row=(await c.query("SELECT content,conversation_id,created_at FROM messages WHERE user_id=$1 AND id=$2 AND role='user'",[r.internalActorKey,ref.id])).rows[0]
   if(!row||!controls.memory.enabled&&row.conversation_id!==r.conversationId)continue
   const quote=ref.quote??row.content
   try{await checkCampusSource(c,r.internalActorKey,r.conversationId,controls.memory.enabled,{type:'message',id:ref.id,quote})}catch(error){if(error instanceof HttpError)continue;throw error}
   if(await growthQuoteSuppressed(c,r.internalActorKey,ref.id,quote))continue
   const question=r.hostSnapshot?.budgetQuestion
   const context=question&&ref.id!==r.authorizedEvidenceRefs[0]?.id?question:undefined
   let budget=applicableTimeBudget(quote,context,question?.period)
   if(budget&&budget.period!=='current'){
    const token=budget.period==='next_week'?'下周':'这周',window=resolveTimeWindow({kind:'calendar_week',which:budget.period==='next_week'?'next':'this',quote:token},token,new Date(row.created_at).toISOString(),'Asia/Shanghai')
    if(Date.now()>=Date.parse(window.validUntil))budget=undefined
   }
   records.push({ref:{type:'message',id:ref.id,revision:1},owner:r.internalActorKey,conversationId:row.conversation_id,status:'active',role:'user',text:quote,...(budget?{budget}:{})})
  }
 }
 return records
}
