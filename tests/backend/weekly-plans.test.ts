import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool, transaction } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { growthContext, stageGrowthUpdates, growthSnapshotKey, type GrowthWriteResult } from '../../server/growth.ts'
import { validateWeeklyPlanShape, stageWeeklyPlan, persistWeeklyPlan, type WeeklyPlanInput } from '../../server/weekly-plans.ts'
import type { GrowthItem } from '../../src/features/growth/types.ts'

// N2.1-N2.3 weekly-plan regressions (isolated PG, no provider): plans persist
// as proposed growth priorities with real budget/basis refs, blocked scopes are
// refused, updateIndex binds through the provider's original positions, and
// old-budget corrections stale the plan instead of patching it.
const user='weekly-plans-'+randomUUID(),chat=randomUUID()
const plan=(over:Partial<WeeklyPlanInput>={}):WeeklyPlanInput=>({
  target:{operation:'create'},
  availableMinutes:180,
  period:'current',
  budgetRef:{updateIndex:0},
  basis:[{updateIndex:0}],
  items:[{action:'整理作品集第一页',minutes:90,directionScopes:[]},{action:'联系一位招聘方',minutes:60,directionScopes:['employment']}],
  ...over,
})

test('weekly plans persist on growth items with real evidence (N2.1/N2.2)',async t=>{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC weekly plans'})
  const prepare=async(text:string)=>{
    await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_TEST_CLEANUP',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[user,chat])
    const run=(await store.startRun(user,chat,randomUUID(),text)).run
    return {run,growth:await growthContext(user,chat)}
  }
  try{
    let writes:GrowthWriteResult|null=null
    let planRow:{itemId:string;revision:number;budgetRef:{id:string;revision:number}}|null=null
    await t.test('shape validation: zero-budget plans stay empty, totals fit, bad scopes refused',()=>{
      validateWeeklyPlanShape(plan())
      assert.throws(()=>validateWeeklyPlanShape(plan({availableMinutes:0})),/WEEKLY_PLAN_INVALID/,'0-budget must have no items')
      assert.throws(()=>validateWeeklyPlanShape(plan({items:[...Array(13)].map(()=>({action:'x',minutes:10,directionScopes:[]}))})),/WEEKLY_PLAN_INVALID/)
      assert.throws(()=>validateWeeklyPlanShape(plan({items:[{action:'x',minutes:999999,directionScopes:[]}]})),/WEEKLY_PLAN_INVALID/,'items exceed budget')
      assert.throws(()=>validateWeeklyPlanShape(plan({basis:[]})),/WEEKLY_PLAN_INVALID/,'basis needs at least the budget ref')
      assert.throws(()=>validateWeeklyPlanShape(plan({period:'someday'} as unknown as WeeklyPlanInput)),/WEEKLY_PLAN_INVALID/)
      assert.throws(()=>validateWeeklyPlanShape(plan({items:[{action:'x',minutes:10,directionScopes:['nonsense'] as never}]})),/WEEKLY_PLAN_INVALID/)
    })
    await t.test('plan persists as proposed priority bound to the 3h budget by original index',async()=>{
      const input=await prepare('最近课程变多了，每周只有3小时了，安排帮我改一下。')
      const staged=await stageGrowthUpdates(input.run,[
        {target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'每周只有3小时了'}},
      ],input.growth)
      const response=await store.finishRun(input.run,{candidates:[],audit:[],growth:staged},'已更新时间。',null,new AbortController().signal)
      writes=response.growthWrite as GrowthWriteResult
      assert.equal(writes.createdIds.length,1)
      const facts=await growthContext(user,chat)
      const prepared=await stageWeeklyPlan(input.run,plan(),{user,expectedControlSnapshotKey:'none',effectiveBlockedScopes:[]})
      const persisted=await transaction(async c=>persistWeeklyPlan(c,input.run,prepared,writes,facts))
      planRow=persisted
      const row=(await pool.query('SELECT kind,assertion,status,structured_plan,direction_scopes,dependencies FROM growth_items WHERE user_id=$1 AND id=$2',[user,persisted.itemId])).rows[0]
      assert.equal(row.kind,'priority');assert.equal(row.assertion,'ai_observation');assert.equal(row.status,'proposed')
      assert.deepEqual(row.direction_scopes,['employment'])
      const structured=row.structured_plan
      assert.equal(structured.availableMinutes,180)
      assert.deepEqual(structured.budgetRef,persisted.budgetRef,'budget resolved to a real id/revision')
      assert.deepEqual(row.dependencies,[persisted.budgetRef],'dependencies carry the same real refs — no updateIndex objects persisted')
      assert.ok(persisted.content.includes('每周3小时'))
      assert.ok((await growthContext(user,chat)).some(item=>item.id===persisted.itemId&&item.status==='proposed'))
    })
    await t.test('blocked direction scopes are refused in stage and persist',async()=>{
      const input=await prepare('继续帮我看看这周做什么。')
      const facts=await growthContext(user,chat)
      await assert.rejects(stageWeeklyPlan(input.run,plan({items:[{action:'刷考研真题',minutes:60,directionScopes:['postgraduate_exam']}]}),{user,expectedControlSnapshotKey:'none',effectiveBlockedScopes:['postgraduate_exam']}),{code:'WEEKLY_PLAN_SCOPE_BLOCKED'})
      const blockedPlan=plan({items:[{action:'刷考研真题',minutes:60,directionScopes:['postgraduate_exam']}]})
      const prepared=await stageWeeklyPlan(input.run,blockedPlan,{user,expectedControlSnapshotKey:'none',effectiveBlockedScopes:[]})
      prepared.effectiveBlockedScopes.push('postgraduate_exam')
      await assert.rejects(transaction(async c=>persistWeeklyPlan(c,input.run,prepared,writes,facts)),{code:'WEEKLY_PLAN_SCOPE_BLOCKED'})
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
    })
    await t.test('an observation or a third-person time can never be the budget',async()=>{
      const input=await prepare('AI观察说我很积极。')
      const facts=await growthContext(user,chat)
      const prepared=await stageWeeklyPlan(input.run,plan(),{user,expectedControlSnapshotKey:'none',effectiveBlockedScopes:[]})
      const observation=await (async()=>{
        const staged=await stageGrowthUpdates(input.run,[{target:{operation:'create'},kind:'observation',assertion:'ai_observation',text:'尝试更主动',source:{messageId:input.run.source_message_id,quote:'AI观察说我很积极'},dependencies:[{id:planRow!.budgetRef.id,revision:planRow!.budgetRef.revision}],limitation:'仅一次观察'}],await growthContext(user,chat))
        await store.finishRun(input.run,{candidates:[],audit:[],growth:staged},'记录观察。',null,new AbortController().signal)
        return (await growthContext(user,chat)).find(item=>item.assertion==='ai_observation')!
      })()
      assert.ok(observation)
      const bad=await stageWeeklyPlan(input.run,plan({budgetRef:{id:observation.id,revision:observation.revision},basis:[{id:observation.id,revision:observation.revision}]}),{user,expectedControlSnapshotKey:'none',effectiveBlockedScopes:[]})
      await assert.rejects(transaction(async c=>persistWeeklyPlan(c,input.run,bad,writes,await growthContext(user,chat))),{code:'WEEKLY_PLAN_BUDGET_INVALID'})
    })
    await t.test('correcting the budget stales the old plan instead of patching refs',async()=>{
      const input=await prepare('改成每周只有2小时。')
      const before=await growthContext(user,chat)
      const timeItem=before.find(item=>item.id===planRow!.budgetRef.id)!
      const stagedAmend=await stageGrowthUpdates(input.run,[{target:{operation:'amend',itemId:timeItem.id,expectedRevision:timeItem.revision,beforeQuote:timeItem.text},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'每周只有2小时'}}],before)
      await store.finishRun(input.run,{candidates:[],audit:[],growth:stagedAmend},'已改为2小时。',null,new AbortController().signal)
      const after=await (await import('../../server/growth.ts')).growthView(user,chat)
      const planView=after.items.find(item=>item.id===planRow!.itemId)
      assert.equal(planView?.unavailableReason,'dependency_changed','old plan goes stale via its real dependency')
      assert.equal(planView!.status,'stale','view marks it stale; the row itself is kept, never deleted')
    })
  }finally{
    await pool.query('DELETE FROM growth_item_lineage WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_items WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_revisions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM runs WHERE user_id=$1',[user])
    await pool.query('DELETE FROM messages WHERE user_id=$1',[user])
    await pool.query('DELETE FROM conversations WHERE user_id=$1',[user])
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
  }
})

test.after(async()=>{await pool.end()})
