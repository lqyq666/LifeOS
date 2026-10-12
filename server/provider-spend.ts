import {maximumProviderCallCostCny} from './cost-workload.ts'
import {randomUUID} from 'node:crypto'
import {pool,transaction,HttpError} from './db.ts'
import {config} from './config.ts'
import type {ModelPricing} from './model.ts'
import type {PoolClient} from 'pg'

// Reserve the full allowed context and output at the greater input/cache rate.
// This is a configured-price upper bound, not a provider invoice or balance.
export function providerReservationCny(contextWindow:number,outputLimit:number,pricing:ModelPricing|null){
 const cost=maximumProviderCallCostCny(contextWindow,outputLimit,pricing)
 if(cost==='unknown')throw new HttpError(503,'PROVIDER_PRICE_REQUIRED')
 return cost
}
export async function reserveProviderSpend(input:{user:string;requestId:string;callIndex:number;provider:string;model:string;ceilingCny:number;workflow?:true;workflowPrepared?:true}){
 if(!config.providerBudgetEnabled)return undefined
 if(!Number.isFinite(input.ceilingCny)||input.ceilingCny<=0)throw new HttpError(503,'PROVIDER_PRICE_REQUIRED')
 return transaction(async c=>{
  if(input.workflowPrepared){
   if(!input.workflow)throw new HttpError(503,'WORKFLOW_PRODUCTION_BUDGET_REQUIRED')
   await c.query("SET LOCAL statement_timeout='15s'");await c.query("SET LOCAL lock_timeout='5s'")
   const task=(await c.query('SELECT status,cancel_requested,deadline_at<=now() AS expired FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2 FOR UPDATE',[input.user,input.requestId])).rows[0]
   if(!task||task.status!=='running'||task.cancel_requested||task.expired)throw new HttpError(409,'WORKFLOW_PREPARATION_STOPPED')
  }
  const row=(await c.query('SELECT enabled FROM lifeos_provider_budgets WHERE id=$1 FOR UPDATE',[config.providerBudgetId])).rows[0]
  if(!row?.enabled)throw new HttpError(503,'PROVIDER_BUDGET_NOT_ENABLED')
  // Lock serializes every reservation and settlement, including different users.
  const fits=(await c.query(`SELECT limit_cny >= $2::numeric + COALESCE((SELECT sum(COALESCE(settled_cny,reserved_cny)) FROM lifeos_provider_spend WHERE budget_id=$1),0) AS fits FROM lifeos_provider_budgets WHERE id=$1`,[config.providerBudgetId,input.ceilingCny.toFixed(8)])).rows[0].fits
  if(!fits)throw new HttpError(503,'PROVIDER_BUDGET_EXHAUSTED')
  const id=randomUUID()
  await c.query(`INSERT INTO lifeos_provider_spend(id,budget_id,user_id,request_id,call_index,provider,model,reserved_cny,status,workflow_request_id,workflow_dispatch_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'reserved',$9,$10)`,[id,config.providerBudgetId,input.user,input.requestId,input.callIndex,input.provider,input.model,input.ceilingCny.toFixed(8),input.workflow?input.requestId:null,input.workflowPrepared?'prepared':null])
  return id
 })
}
// Caller owns a transaction. The task lock serializes this proof with startNode;
// NULL legacy state or a started boundary can never be inferred not sent.
export async function releasePreparedWorkflowSpend(c:PoolClient,user:string,requestId:string){
 await c.query("SET LOCAL statement_timeout='15s'");await c.query("SET LOCAL lock_timeout='5s'")
 await c.query('SELECT request_id FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2 FOR UPDATE',[user,requestId])
 const budgets=(await c.query("SELECT DISTINCT budget_id FROM lifeos_provider_spend WHERE user_id=$1 AND workflow_request_id=$2 AND workflow_dispatch_state='prepared' AND status='reserved' ORDER BY budget_id",[user,requestId])).rows
 for(const row of budgets)await c.query('SELECT id FROM lifeos_provider_budgets WHERE id=$1 FOR UPDATE',[row.budget_id])
 await c.query("UPDATE lifeos_provider_spend SET status='not_sent',settled_cny=0,finished_at=now() WHERE user_id=$1 AND workflow_request_id=$2 AND workflow_dispatch_state='prepared' AND status='reserved'",[user,requestId])
}
export async function settleProviderSpend(id:string|undefined,cost:number|'unknown',notSent=false){
 if(!id)return
 if(cost!=='unknown'&&(!Number.isFinite(cost)||cost<0))cost='unknown'
 return transaction(async c=>{
  const found=(await c.query('SELECT budget_id FROM lifeos_provider_spend WHERE id=$1',[id])).rows[0]
  if(!found)throw new Error('PROVIDER_SPEND_MISSING')
  await c.query('SELECT id FROM lifeos_provider_budgets WHERE id=$1 FOR UPDATE',[found.budget_id])
  const row=(await c.query('SELECT status,reserved_cny,workflow_request_id,workflow_dispatch_state FROM lifeos_provider_spend WHERE id=$1 FOR UPDATE',[id])).rows[0]
  if(row.status!=='reserved')throw new Error('PROVIDER_SPEND_ALREADY_SETTLED')
  const retainedUnknown=notSent&&row.workflow_request_id!==null&&row.workflow_dispatch_state!=='prepared'
  if(retainedUnknown){cost='unknown';notSent=false}
  const overrun=typeof cost==='number'&&cost>Number(row.reserved_cny)
  await c.query('UPDATE lifeos_provider_spend SET settled_cny=$2,status=$3,finished_at=now() WHERE id=$1',[id,notSent?'0':cost==='unknown'?null:cost.toFixed(8),notSent?'not_sent':cost==='unknown'?'unknown':overrun?'overrun':'known'])
  if(overrun)await c.query('UPDATE lifeos_provider_budgets SET enabled=false,revision=revision+1,updated_at=now() WHERE id=$1',[found.budget_id])
  return {overrun,retainedUnknown}
 })
}
export async function providerBudgetView(id=config.providerBudgetId){
 const row=(await pool.query(`SELECT b.id,b.enabled,b.limit_cny,b.revision,
  COALESCE(sum(COALESCE(s.settled_cny,s.reserved_cny)),0)::text AS accounted_cny,
  count(s.id) FILTER (WHERE s.status IN ('reserved','unknown'))::int AS unknown_or_active_calls
  FROM lifeos_provider_budgets b LEFT JOIN lifeos_provider_spend s ON s.budget_id=b.id WHERE b.id=$1 GROUP BY b.id`,[id])).rows[0]
 return row??null
}
export async function setProviderBudget(id:string,amount:number){
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||!Number.isFinite(amount)||amount<0||amount>1000000)throw new Error('INVALID_PROVIDER_BUDGET')
 await transaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id+':provider-budget'])
  await c.query('SELECT id FROM lifeos_provider_budgets WHERE id=$1 FOR UPDATE',[id])
  const usage=(await c.query('SELECT COALESCE(sum(COALESCE(settled_cny,reserved_cny)),0) <= $2::numeric AS fits FROM lifeos_provider_spend WHERE budget_id=$1',[id,amount.toFixed(8)])).rows[0]
  if(!usage.fits)throw new Error('BUDGET_BELOW_ACCOUNTED_SPEND')
  await c.query('INSERT INTO lifeos_provider_budgets(id,limit_cny) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET enabled=true,limit_cny=$2,revision=lifeos_provider_budgets.revision+1,updated_at=now()',[id,amount.toFixed(8)])
 })
}
