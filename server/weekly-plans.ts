import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { HttpError } from './db.ts'
import type { DirectionScope } from './growth-controls.ts'
import type { GrowthWriteResult } from './growth.ts'
import type { Run } from './store.ts'
import { applicableTimeBudget } from './turn-obligations.ts'
import type { GrowthItem } from '../src/features/growth/types.ts'

// N2.1/N2.2: weekly plans reuse growth_items (kind 'priority', assertion
// 'ai_observation', status 'proposed') with structured evidence — no second
// task platform. The budget must be the student's own verified time fact in
// the same period/window; every basis resolves to real id/revision at commit.

export type InputGrowthRef={id:string;revision:number}|{updateIndex:number}
export type WeeklyPlanInput={
  target:{operation:'create'}|{operation:'replace';itemId:string;expectedRevision:number}
  availableMinutes:number
  period:'current'|'this_week'|'next_week'
  budgetRef:InputGrowthRef
  basis:InputGrowthRef[]
  items:{action:string;minutes:number;directionScopes:DirectionScope[]}[]
}
export type PreparedWeeklyPlan={
  input:WeeklyPlanInput
  expectedControlSnapshotKey:string
  effectiveBlockedScopes:DirectionScope[]
}
export type PlanValidationContext={
  user:string
  expectedControlSnapshotKey:string
  effectiveBlockedScopes:readonly DirectionScope[]
}

const allScopes:DirectionScope[]=['employment','postgraduate_recommendation','postgraduate_exam','public_service','entrepreneurship','overseas_study','undergraduate_upgrade']
const validMinutes=(value:number)=>Number.isSafeInteger(value)&&value>=0&&value<=10080
const validScopeList=(scopes:unknown):scopes is DirectionScope[]=>Array.isArray(scopes)&&scopes.length<=7&&scopes.every(scope=>allScopes.includes(scope as DirectionScope))

export function renderProposedWeeklyPlan(input:WeeklyPlanInput):string{
  validateWeeklyPlanShape(input)
  const windowLabel=input.period==='next_week'?'下周':input.period==='this_week'?'本周':'当前时段'
  if(input.availableMinutes===0)return windowLabel+'没有可用时间，先不安排任务；等可用时间改变后再调整。'
  return windowLabel+'建议安排（可用'+input.availableMinutes+'分钟；尚未采纳或执行）：\n'+input.items.map(item=>'- '+item.action+'（'+item.minutes+'分钟）').join('\n')
}

// Pure shape validation: integer minutes, 0-budget ⇒ no items, totals within
// budget, bounded item/basis counts. Authorization and fact matching happen in
// stage/persist — the two SQL CHECKs never replace this.
export function validateWeeklyPlanShape(input:WeeklyPlanInput):void{
  if(!validMinutes(input.availableMinutes))throw new HttpError(400,'WEEKLY_PLAN_INVALID')
  if(input.availableMinutes===0&&input.items.length>0)throw new HttpError(400,'WEEKLY_PLAN_INVALID')
  if(input.availableMinutes>0&&!input.items.length)throw new HttpError(400,'WEEKLY_PLAN_INVALID')
  if(input.items.length>12)throw new HttpError(400,'WEEKLY_PLAN_INVALID')
  const total=input.items.reduce((sum,item)=>sum+item.minutes,0)
  if(total>input.availableMinutes)throw new HttpError(400,'WEEKLY_PLAN_INVALID')
  for(const item of input.items){
    if(!Number.isSafeInteger(item.minutes)||item.minutes<=0||item.minutes>10080)throw new HttpError(400,'WEEKLY_PLAN_INVALID')
    if(typeof item.action!=='string'||!item.action.trim()||item.action.length>200)throw new HttpError(400,'WEEKLY_PLAN_INVALID')
    if(!validScopeList(item.directionScopes))throw new HttpError(400,'WEEKLY_PLAN_INVALID')
  }
  if(input.basis.length>12||!input.basis.length)throw new HttpError(400,'WEEKLY_PLAN_INVALID')
  if(!['current','this_week','next_week'].includes(input.period))throw new HttpError(400,'WEEKLY_PLAN_INVALID')
}

// Resolve one provider ref to a real fact: an updateIndex must map through the
// PROVIDER's original array position to a persisted user_reported fact; an
// id/revision must match an authorized item exactly.
function resolveRef(ref:InputGrowthRef,writes:GrowthWriteResult|null,facts:readonly GrowthItem[]):{id:string;revision:number}{
  if('updateIndex'in ref){
    const binding=writes?writes.byInputIndex.get(ref.updateIndex):undefined
    if(!binding)throw new HttpError(400,'WEEKLY_PLAN_BASIS_INVALID')
    return binding
  }
  const found=facts.find(item=>item.id===ref.id&&item.revision===ref.revision&&!item.unavailableReason&&['active','proposed'].includes(item.status))
  if(!found)throw new HttpError(400,'WEEKLY_PLAN_BASIS_INVALID')
  return {id:found.id,revision:found.revision}
}

export async function stageWeeklyPlan(run:Run,input:WeeklyPlanInput,context:PlanValidationContext):Promise<PreparedWeeklyPlan>{
  validateWeeklyPlanShape(input)
  if(context.user!==run.user_id)throw new HttpError(400,'WEEKLY_PLAN_BASIS_INVALID')
  // Item scopes may not intersect the EFFECTIVE blocked set (including this
  // turn's pending pause).
  for(const item of input.items)for(const scope of item.directionScopes)
    if(context.effectiveBlockedScopes.includes(scope))throw new HttpError(400,'WEEKLY_PLAN_SCOPE_BLOCKED')
  return {input,expectedControlSnapshotKey:context.expectedControlSnapshotKey,effectiveBlockedScopes:[...context.effectiveBlockedScopes]}
}

export type PersistedWeeklyPlan={itemId:string;revision:number;budgetRef:{id:string;revision:number};content:string}

export async function persistWeeklyPlan(c:PoolClient,run:Run,prepared:PreparedWeeklyPlan,writes:GrowthWriteResult|null,facts:readonly GrowthItem[]):Promise<PersistedWeeklyPlan>{
  const input=prepared.input
  validateWeeklyPlanShape(input)
  if(prepared.expectedControlSnapshotKey!==undefined){
    // Caller (finishRun) already compared the control snapshot under the same
    // transaction; here we re-assert the effective blocked set captured at
    // generation time stays what the plan was built against.
    for(const item of input.items)for(const scope of item.directionScopes)
      if(prepared.effectiveBlockedScopes.includes(scope))throw new HttpError(400,'WEEKLY_PLAN_SCOPE_BLOCKED')
  }
  // Budget: the student's OWN verified time fact (user_reported context or
  // constraint) — not someone else's time, a spent duration or an observation.
  const budget=resolveRef(input.budgetRef,writes,facts)
  const budgetItem=facts.find(item=>item.id===budget.id)
  if(!budgetItem||budgetItem.assertion!=='user_reported'||!['context','constraint'].includes(budgetItem.kind))
    throw new HttpError(400,'WEEKLY_PLAN_BUDGET_INVALID')
  // P3 (F06): the budget fact must carry THIS plan's semantics - its own
  // parsed minutes equal availableMinutes, and a week-scoped constraint only
  // feeds a plan of the matching period. A same-numbered fact from another
  // task or another week never satisfies this.
  const budgetScope=budgetItem.timeBasis as {kind?:string;which?:string;anchor?:string}|null
  const budgetContext=budgetScope?.kind==='calendar_week'?{period:budgetScope.which==='next'?'next_week' as const:'this_week' as const,question:'本人可用或剩余时间',anchor:budgetScope.anchor??new Date().toISOString()}:undefined
  const selectedBudget=applicableTimeBudget(budgetItem.text,budgetContext,input.period==='next_week'?'next_week':input.period==='this_week'?'this_week':undefined)
  const budgetMinutes=selectedBudget?.amountMinutes??null
  if(budgetMinutes===null||budgetMinutes!==input.availableMinutes)
    throw new HttpError(400,'WEEKLY_PLAN_BUDGET_MISMATCH')
  const budgetBasis=budgetItem.timeBasis as {kind?:string;which?:string}|null
  const budgetWindow=budgetItem.kind==='constraint'&&budgetBasis?.kind==='calendar_week'?budgetBasis.which:null
  if(budgetWindow==='this'&&!['this_week','current'].includes(input.period))
    throw new HttpError(400,'WEEKLY_PLAN_BUDGET_MISMATCH')
  if(budgetWindow==='next'&&input.period!=='next_week')
    throw new HttpError(400,'WEEKLY_PLAN_BUDGET_MISMATCH')
  const basis=input.basis.map(ref=>resolveRef(ref,writes,facts))
  const dependencies=[budget,...basis.filter(ref=>ref.id!==budget.id)].map(ref=>({id:ref.id,revision:ref.revision}))
  const hours=input.availableMinutes/60
  const hoursText=Number.isInteger(hours)?String(hours):hours.toFixed(2)
  // P3 (F05/F06): the label names the budget's OWN window - a this-week
  // remainder is never presented as the recurring weekly amount.
  const windowLabel=input.period==='next_week'?'下周':input.period==='this_week'?'本周剩余':budgetWindow==='this'?'本周剩余':budgetWindow==='next'?'下周':'每周'
  const content=windowLabel+'安排（依据已核对的'+windowLabel+hoursText+'小时）：\n'+input.items.map(item=>'- '+item.action+'（'+(item.minutes>=60&&item.minutes%60===0?item.minutes/60+'小时':item.minutes+'分钟')+'）').join('\n')
  const structured={
    schemaVersion:1,
    availableMinutes:input.availableMinutes,
    period:input.period,
    budgetRef:budget,
    basis,
    items:input.items.map(item=>({action:item.action,minutes:item.minutes,directionScopes:item.directionScopes})),
  }
  const scopes=[...new Set(input.items.flatMap(item=>item.directionScopes))]
  if(input.target.operation==='replace'){
    const updated=(await c.query(`UPDATE growth_items SET text=$4,structured_plan=$5,direction_scopes=$6,dependencies=$7,revision=revision+1,updated_at=now()
      WHERE user_id=$1 AND id=$2 AND revision=$3 AND kind='priority' AND assertion='ai_observation' RETURNING id,revision`,
      [run.user_id,input.target.itemId,input.target.expectedRevision,content,JSON.stringify(structured),scopes,JSON.stringify(dependencies)])).rows[0] as {id:string;revision:number}|undefined
    if(!updated)throw new HttpError(409,'GROWTH_SNAPSHOT_INVALIDATED')
    return {itemId:updated.id,revision:updated.revision,budgetRef:budget,content}
  }
  const inserted=(await c.query(`INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,valid_until,limitation,progress_state,origin_request_id,structured_plan,direction_scopes)
    VALUES($1,$2,$3,'priority',$4,'ai_observation','proposed','[]'::jsonb,$5::jsonb,NULL,$6,NULL,$7,$8,$9) RETURNING id,revision`,
    [randomUUID(),run.user_id,run.conversation_id,content,JSON.stringify(dependencies),'计划由AI依据本人核对时间生成，属建议；本人采用前可调整。',run.request_id,JSON.stringify(structured),scopes])).rows[0] as {id:string;revision:number}
  return {itemId:inserted.id,revision:inserted.revision,budgetRef:budget,content}
}
