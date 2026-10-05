import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { growthContext, growthBoundaryContext, growthView, stageGrowthUpdates, actOnGrowthItem, growthSnapshotKey, assertGrowthSnapshot } from '../../server/growth.ts'
import { transaction } from '../../server/db.ts'
import { buildTurnPrompt } from '../../server/turn-prompt.ts'
import { redactGrowthHistory, growthQuoteSuppressed } from '../../server/growth-privacy.ts'
import type { GrowthDelta } from '../../server/growth-model-contracts.ts'

test('conversation growth changes are grounded, atomic and selectively forgettable (isolated PG, no provider)',async t=>{
  const user='growth-model-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC adult campus conversation'})
  const prepare=async(text:string)=>{
    const run=(await store.startRun(user,chat,randomUUID(),text)).run
    const growth=await growthContext(user,chat)
    return {run,growth,source:{messageId:run.source_message_id,quote:text}}
  }
  const finish=async(input:Awaited<ReturnType<typeof prepare>>,changes:GrowthDelta[])=>{
    const staged=await stageGrowthUpdates(input.run,changes,input.growth)
    return store.finishRun(input.run,{candidates:[],audit:[],growth:staged,usedGrowthRefs:input.growth.map(row=>({id:row.id,revision:row.revision})),growthSnapshotKey:growthSnapshotKey(input.growth)},'先保留明确情况，未知再核对。',null,new AbortController().signal)
  }
  try{
    let goalId='',interestId='',observationId=''
    let first!:Awaited<ReturnType<typeof prepare>>
    await t.test('one message saves independent exact facts; short and question-form boundaries survive',async()=>{
      first=await prepare('先探索就业。我喜欢绘画。仅两小时，先不联系，可以吗？')
      const changes:GrowthDelta[]=[
        {target:{operation:'create'},kind:'goal',assertion:'user_reported',text:'先探索就业',source:first.source},
        {target:{operation:'create'},kind:'preference',assertion:'user_reported',text:'我喜欢绘画',source:first.source},
        {target:{operation:'create'},kind:'preference',assertion:'user_reported',text:'先不联系',source:first.source},
      ]
      const saved=await finish(first,changes)
      assert.equal(saved.growthIds.length,3)
      const context=await growthContext(user,chat)
      goalId=context.find(row=>row.text==='先探索就业')!.id
      interestId=context.find(row=>row.text==='我喜欢绘画')!.id
      assert.equal(context.find(row=>row.id===interestId)!.sources[0].quote,'我喜欢绘画','source span is the independent fact, not the compound message')
      assert.ok(context.some(row=>row.text==='先不联系'))
    })
    await t.test('unsupported facts, missing time bounds and guessed feedback states are refused',async()=>{
      const input=await prepare('我这周只有两小时，还没投递。')
      const base={target:{operation:'create' as const},assertion:'user_reported' as const,source:input.source}
      await assert.rejects(stageGrowthUpdates(input.run,[{...base,kind:'ability',text:'我有丰富实习经验'}],input.growth),{code:'GROWTH_SOURCE_INVALID'})
      // @ts-expect-error Deliberately malformed input must also fail at the runtime boundary.
      await assert.rejects(stageGrowthUpdates(input.run,[{...base,kind:'constraint',text:'只有两小时'}],input.growth),{code:'GROWTH_TIME_REQUIRED'})
      // @ts-expect-error Intentionally omit required state to verify the runtime guard independently of parsing.
      await assert.rejects(stageGrowthUpdates(input.run,[{...base,kind:'feedback',text:'还没投递'}],input.growth),{code:'GROWTH_FEEDBACK_INVALID'})
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
    })
    await t.test('observations remain proposed with limits; adoption does not turn an inference into proven ability',async()=>{
      const input=await prepare('想先试一个绘画相关的小项目。')
      const saved=await finish(input,[{target:{operation:'create'},kind:'direction',assertion:'ai_observation',text:'尝试小型视觉项目',source:input.source,dependencies:[{id:interestId,revision:1}],limitation:'仅有本人兴趣陈述，尚无交付或专业能力证据。'}])
      observationId=saved.growthIds[0]
      let row=(await growthView(user,chat)).items.find(row=>row.id===observationId)!
      assert.equal(row.status,'proposed');assert.equal(row.assertion,'ai_observation');assert.ok(row.limitation)
      row=await actOnGrowthItem(user,row.id,{requestId:randomUUID(),expectedRevision:row.revision,action:'accept'})
      assert.equal(row.status,'active');assert.equal(row.assertion,'ai_observation');assert.ok(row.limitation)
    })
    await t.test('explicit goal correction changes only that goal and retains independent interests',async()=>{
      const input=await prepare('更正：现在优先准备考研。')
      await finish(input,[{target:{operation:'replace',itemId:goalId,expectedRevision:1},kind:'goal',assertion:'user_reported',text:'现在优先准备考研',source:input.source}])
      const context=await growthContext(user,chat)
      assert.equal(context.find(row=>row.id===goalId)!.revision,2)
      assert.ok(!context.some(row=>row.text==='先探索就业'))
      assert.ok(context.some(row=>row.id===interestId))
    })
    await t.test('an unchanged short fragment cannot erase details from an existing goal',async()=>{
      const input=await prepare('准备考研')
      await assert.rejects(stageGrowthUpdates(input.run,[{target:{operation:'replace',itemId:goalId,expectedRevision:2},kind:'goal',assertion:'user_reported',text:'准备考研',source:input.source}],input.growth),{code:'GROWTH_UNCHANGED'})
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
    })
    await t.test('a same-batch replacement cannot underpin an observation with its superseded revision in either order',async()=>{
      const input=await prepare('更正：先探索就业，想看看绘画项目的反馈。')
      const replacement={target:{operation:'replace' as const,itemId:goalId,expectedRevision:2},kind:'goal' as const,assertion:'user_reported' as const,source:input.source,text:'先探索就业'}
      const observation={target:{operation:'create' as const},kind:'observation' as const,assertion:'ai_observation' as const,source:input.source,text:'绘画项目可能帮助就业探索',dependencies:[{id:goalId,revision:2}],limitation:'仅为待核对的探索线索，未有实际反馈'}
      for(const changes of [[replacement,observation],[observation,replacement]])await assert.rejects(stageGrowthUpdates(input.run,changes,input.growth),{code:'GROWTH_DEPENDENCY_INVALID'})
      const after=await growthView(user,chat)
      assert.equal(after.items.find(row=>row.id===goalId)!.revision,2)
      assert.ok(!after.items.some(row=>row.text===observation.text),'neither ordering may save an immediately stale observation')
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
    })
    await t.test('rejected observations remain separate decision boundaries; changing them invalidates an in-flight boundary snapshot',async()=>{
      const row=(await growthView(user,chat)).items.find(row=>row.id===observationId)!
      const rejected=await actOnGrowthItem(user,row.id,{requestId:randomUUID(),expectedRevision:row.revision,action:'reject'})
      const growth=await growthContext(user,chat),boundaries=await growthBoundaryContext(user,chat),id=randomUUID()
      assert.ok(!growth.some(row=>row.id===observationId))
      const prompt=JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:'换一个探索方向吧。'}],growth,growthBoundaries:boundaries}))
      assert.ok(prompt.growthBoundaries.some((row:any)=>row.id===observationId&&row.status==='rejected'))
      assert.ok(prompt.growth.some((row:any)=>row.id===interestId))
      await actOnGrowthItem(user,rejected.id,{requestId:randomUUID(),expectedRevision:rejected.revision,action:'correct',text:'自己决定改为探索小型动画项目'})
      await assert.rejects(transaction(c=>assertGrowthSnapshot(c,user,chat,[],undefined,growthSnapshotKey(boundaries))),{code:'GROWTH_SNAPSHOT_INVALIDATED'})
    })
    await t.test('cancelled completion cannot write a reply or growth record',async()=>{
      const input=await prepare('还没开始投递。'),growth=await stageGrowthUpdates(input.run,[{target:{operation:'create'},kind:'feedback',assertion:'user_reported',text:'还没开始投递',source:input.source,progressState:'unattempted'}],input.growth)
      const cancel=new AbortController();cancel.abort()
      await assert.rejects(store.finishRun(input.run,{candidates:[],audit:[],growth},'继续核对卡点。',null,cancel.signal))
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1 AND origin_request_id=$2',[user,input.run.request_id])).rows[0].n,0)
      await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_TEST_CLEANUP')
    })
    await t.test('forgetting one exact span removes dependent inference and future history use, preserving the other facts',async()=>{
      await actOnGrowthItem(user,interestId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
      const context=await growthContext(user,chat)
      assert.ok(context.some(row=>row.id===goalId&&row.text==='现在优先准备考研'))
      assert.ok(context.some(row=>row.text==='先不联系'))
      assert.ok(!context.some(row=>row.id===interestId||row.id===observationId))
      assert.equal(await growthQuoteSuppressed(pool,user,first.run.source_message_id,'我喜欢绘画'),true)
      assert.equal(await growthQuoteSuppressed(pool,user,first.run.source_message_id,'先不联系'),false)
      const history=await redactGrowthHistory(user,await store.contextForRun(first.run))
      const original=history.find(row=>row.id===first.run.source_message_id)!
      assert.ok(!original.content.includes('我喜欢绘画'));assert.ok(original.content.includes('先不联系'))
      const retained=(await pool.query('SELECT snapshot FROM growth_revisions WHERE user_id=$1 AND item_id=ANY($2::uuid[])',[user,[interestId,observationId]])).rows
      assert.ok(!JSON.stringify(retained).includes('绘画'))
    })
  }finally{
    await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end()
  }
})
