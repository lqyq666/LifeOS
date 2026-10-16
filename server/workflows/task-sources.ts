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
type HistoricalGrowthSnapshot={text?:unknown;assertion?:unknown;status?:unknown;conversationId?:unknown;sources?:unknown;dependencies?:unknown}
async function committedGrowthEvidence(r:WorkflowRequest,ref:Extract<WorkflowRequest['authorizedEvidenceRefs'][number],{type:'growth'}>,memoryEnabled:boolean,c:DB):Promise<EvidenceRecord|undefined>{
 const current=(await c.query('SELECT text,assertion,status FROM growth_items WHERE user_id=$1 AND id=$2',[r.internalActorKey,ref.id])).rows[0] as {text:string;assertion:string;status:string}|undefined
 const revision=(await c.query('SELECT snapshot FROM growth_revisions WHERE user_id=$1 AND item_id=$2 AND revision=$3',[r.internalActorKey,ref.id,ref.revision])).rows[0] as {snapshot:HistoricalGrowthSnapshot}|undefined
 const snapshot=revision?.snapshot
 if(!current||!snapshot||!['active','proposed'].includes(String(snapshot.status))||!['active','proposed','paused','completed'].includes(current.status))return
 if(!['user_reported','user_edit'].includes(String(snapshot.assertion))||current.text!==snapshot.text||current.assertion!==snapshot.assertion)return
 if(typeof snapshot.conversationId!=='string'||!Array.isArray(snapshot.sources)||!Array.isArray(snapshot.dependencies))return
 if(ref.quote!==undefined&&!current.text.includes(ref.quote))return
 // The exact committed revision remains historical evidence only while its
 // original user-owned sources are still readable. A correction, rejection,
 // forget, redaction or revoked message continues to invalidate the task.
 for(const source of snapshot.sources){
  if(!source||typeof source!=='object')return
  const value=source as {type?:unknown;id?:unknown;quote?:unknown}
  if(value.type==='user_edit')continue
  try{await checkCampusSource(c,r.internalActorKey,snapshot.conversationId,memoryEnabled,value as Parameters<typeof checkCampusSource>[4])}catch(error){if(error instanceof HttpError)return;throw error}
  if(value.type==='message'&&typeof value.id==='string'&&typeof value.quote==='string'&&await growthQuoteSuppressed(c,r.internalActorKey,value.id,value.quote))return
 }
 const growth=await growthView(r.internalActorKey,r.conversationId,c)
 for(const dependency of snapshot.dependencies){
  if(!dependency||typeof dependency!=='object')return
  const value=dependency as {id?:unknown;revision?:unknown}
  if(typeof value.id!=='string'||typeof value.revision!=='number'||!growth.items.some(x=>x.id===value.id&&x.revision===value.revision&&!x.unavailableReason&&['active','proposed'].includes(x.status)))return
 }
 const budget=applicableTimeBudget(current.text,undefined,r.hostSnapshot?.budgetQuestion?.period)
 return {ref:{...ref},owner:r.internalActorKey,conversationId:snapshot.conversationId,status:'active',role:'user',text:current.text,...(budget?{budget}:{})}
}
export async function workflowControls(user:string,c:DB=pool){
 const memory=(await c.query('SELECT enabled,revision FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]??{enabled:false,revision:0}
 const directions=await readDirectionControls(user,c),stopped=await readRecommendationControls(user,c)
 const pending=(await c.query("SELECT id,kind,candidates FROM growth_control_requests WHERE user_id=$1 AND status='pending' ORDER BY id",[user])).rows
 // A normal time clarification supersedes older time constraints by pausing
 // them before the workflow resume request arrives. Those constraint rows are
 // evidence lifecycle, not recommendation/privacy controls; including them in
 // the control digest makes the advertised waiting_user -> supplement flow
 // invalidate itself. Other paused/rejected/forgotten growth boundaries still
 // invalidate the graph, as do memory, direction and recommendation controls.
 const boundaries=(await c.query("SELECT id,revision,status FROM growth_items WHERE user_id=$1 AND kind<>'constraint' AND status IN ('paused','rejected','forgotten') ORDER BY id",[user])).rows
 return {memory,directions,stopped,pending,digest:createHash('sha256').update(JSON.stringify({memory,directions,stopped,pending,boundaries})).digest('hex'),directionKey:directionControlsSnapshotKey(directions)}
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
export async function readWorkflowEvidence(r:WorkflowRequest,c:DB=pool,options:{historicalCommit?:boolean}={}):Promise<EvidenceRecord[]>{
 const controls=await workflowControls(r.internalActorKey,c)
 // A committed selection is an immutable historical fact. Later memory or
 // recommendation settings must not erase it, while the source records below
 // still have to remain owned, visible and unwithdrawn.
 if(!options.historicalCommit&&r.hostSnapshot&&controls.digest!==r.hostSnapshot.controlsDigest)throw new WorkflowError('stale_snapshot')
 const growth=await growthView(r.internalActorKey,r.conversationId,c),records:EvidenceRecord[]=[]
 for(const ref of r.authorizedEvidenceRefs){
  if(ref.type==='growth'){
   const found=growth.items.find(x=>x.id===ref.id)
   if(!found||found.revision!==ref.revision||found.unavailableReason||!['active','proposed'].includes(found.status)||found.recommendationStopped){
    if(options.historicalCommit){const historical=await committedGrowthEvidence(r,ref,controls.memory.enabled,c);if(historical)records.push(historical)}
    continue
   }
   // AI observations remain candidates; never label them student facts.
   if(!['user_reported','user_edit'].includes(found.assertion))continue
   if(ref.quote!==undefined&&!found.text.includes(ref.quote))continue
   const budget=applicableTimeBudget(found.text,undefined,r.hostSnapshot?.budgetQuestion?.period)
   records.push({ref:{...ref},owner:r.internalActorKey,conversationId:found.conversationId,status:'active',role:'user',text:found.text,...(budget?{budget}:{})})
  }else if(ref.type==='message'){
   const row=(await c.query("SELECT content,conversation_id,created_at FROM messages WHERE user_id=$1 AND id=$2 AND role='user'",[r.internalActorKey,ref.id])).rows[0]
   if(!row||ref.revision!==1||!controls.memory.enabled&&row.conversation_id!==r.conversationId)continue
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
   records.push({ref:{...ref},owner:r.internalActorKey,conversationId:row.conversation_id,status:'active',role:'user',text:quote,...(budget?{budget}:{})})
  }
 }
 return records
}
