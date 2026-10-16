import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { growthContext, growthView, stageGrowthUpdates, actOnGrowthItem, growthSnapshotKey } from '../../server/growth.ts'
import { growthQuoteSuppressed } from '../../server/growth-privacy.ts'
import type { GrowthDelta, ResolvedGrowthDelta } from '../../server/growth-model-contracts.ts'

// P1 amendment regressions (isolated PG, no provider): correcting one clause of
// a composite user-reported fact must preserve its untouched sibling facts with
// their original provenance, split only under evidence, and stay CAS-safe.
test('amend corrects one clause of a composite fact without erasing siblings (SRC-01/02/03/04/05/06/07)',async t=>{
  const user='growth-amend-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC amendment conversation'})
  const prepare=async(text:string)=>{
    // A conversation allows one running run at a time; retire orphaned runs
    // from earlier subtests the way a device losing its connection would.
    await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_TEST_CLEANUP',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[user,chat])
    const run=(await store.startRun(user,chat,randomUUID(),text)).run
    const growth=await growthContext(user,chat)
    return {run,growth,source:{messageId:run.source_message_id,quote:text}}
  }
  const finish=async(input:Awaited<ReturnType<typeof prepare>>,changes:ResolvedGrowthDelta[],signal:AbortSignal=new AbortController().signal)=>{
    const staged=await stageGrowthUpdates(input.run,changes,input.growth)
    return store.finishRun(input.run,{candidates:[],audit:[],growth:staged,usedGrowthRefs:input.growth.map(row=>({id:row.id,revision:row.revision})),growthSnapshotKey:growthSnapshotKey(input.growth)},'已按你的新时间更新安排。',null,signal)
  }
  try{
    const COMPOSITE='我有三个数字媒体作品，每周能投入6小时，倾向就业但想看看真实反馈。'
    let compositeId='',changedId=''
    await t.test('SRC-01 composite 6h→3h keeps works and leaning, splits with lineage',async()=>{
      const first=await prepare(COMPOSITE)
      await finish(first,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:first.source}])
      const composite=(await growthContext(user,chat)).find(row=>row.text===COMPOSITE)!
      compositeId=composite.id
      assert.equal(composite.revision,1)

      const second=await prepare('最近课程变多了，每周只有3小时了，安排帮我改一下。')
      const saved=await finish(second,[{target:{operation:'amend',itemId:compositeId,expectedRevision:1,beforeQuote:'每周能投入6小时'},kind:'context',assertion:'user_reported',source:{messageId:second.run.source_message_id,quote:'每周只有3小时了'}}])
      assert.equal(saved.growthChangedIds.length,1)
      changedId=saved.growthChangedIds[0]!
      assert.equal(saved.growthRetainedIds.length,2)
      const view=await growthView(user,chat)
      const parent=view.items.find(row=>row.id===compositeId)!
      assert.equal(parent.status,'stale','the superseded composite stays as history, never deleted')
      assert.equal(parent.text,COMPOSITE)
      const works=view.items.find(row=>row.text==='我有三个数字媒体作品')!
      const leaning=view.items.find(row=>row.text==='倾向就业但想看看真实反馈')!
      const time=view.items.find(row=>row.text==='每周只有3小时了')!
      assert.ok(works&&leaning&&time,'retained siblings and the new clause are all active facts')
      assert.equal(works.sources[0].type,'message')
      assert.ok(works.sources[0].type==='message'&&works.sources[0].id===first.run.source_message_id,'retained clauses keep their ORIGINAL message provenance')
      assert.ok(time.sources[0].type==='message'&&time.sources[0].id===second.run.source_message_id)
      assert.equal((await growthContext(user,chat)).filter(row=>row.text.includes('6小时')).length,0,'the old 6h clause is not a current basis anymore')
      const lineage=(await pool.query('SELECT child_id,fragment_role,superseded_quote FROM growth_item_lineage WHERE user_id=$1 AND parent_id=$2 ORDER BY fragment_role',[user,compositeId])).rows
      assert.equal(lineage.length,3)
      const changedRow=lineage.find(row=>row.fragment_role==='changed')!
      assert.equal(changedRow.child_id,changedId)
      assert.equal(changedRow.superseded_quote,'每周能投入6小时')
      assert.deepEqual(lineage.filter(row=>row.fragment_role==='retained').map(row=>row.superseded_quote),[null,null])
    })
    await t.test('SRC-02 amending the new single-clause time fact again stays in place (3h→2h)',async()=>{
      const third=await prepare('最近实习定了，每周只有2小时了。')
      const before=await growthContext(user,chat)
      const saved=await finish(third,[{target:{operation:'amend',itemId:changedId,expectedRevision:1,beforeQuote:'每周只有3小时了'},kind:'context',assertion:'user_reported',source:{messageId:third.run.source_message_id,quote:'每周只有2小时了'}}])
      assert.equal(saved.growthChangedIds.length,1)
      assert.equal(saved.growthChangedIds[0],changedId,'a single full clause is exchanged in place, not re-split')
      assert.equal(saved.growthRetainedIds.length,0)
      const after=await growthContext(user,chat)
      assert.equal(after.find(row=>row.id===changedId)!.text,'每周只有2小时了')
      assert.equal(after.find(row=>row.id===changedId)!.revision,2)
      for(const row of before.filter(row=>row.id!==changedId&&row.id!==compositeId))
        assert.equal(after.find(entry=>entry.id===row.id)!.revision,row.revision,'untouched facts keep their revisions')
      assert.ok(after.some(row=>row.text==='我有三个数字媒体作品')&&after.some(row=>row.text==='倾向就业但想看看真实反馈'),'works and leaning survive the second correction')
    })
    await t.test('SRC-03 concurrent amendments on one parent: exactly one commits, the other gets 409',async()=>{
      const growth=await growthContext(user,chat)
      const current=growth.find(row=>row.text==='每周只有2小时了')!
      const first=await prepare('计划又变了，每周只有1小时了。')
      const stagedA=await stageGrowthUpdates(first.run,[{target:{operation:'amend',itemId:current.id,expectedRevision:current.revision,beforeQuote:'每周只有2小时了'},kind:'context',assertion:'user_reported',source:{messageId:first.run.source_message_id,quote:'每周只有1小时了'}}],growth)
      const committed=await store.finishRun(first.run,{candidates:[],audit:[],growth:stagedA,usedGrowthRefs:growth.map(row=>({id:row.id,revision:row.revision})),growthSnapshotKey:growthSnapshotKey(growth)},'已更新为每周1小时。',null,new AbortController().signal)
      assert.equal(committed.growthChangedIds.length,1)
      // The second device staged from the SAME pre-turn snapshot; its commit is
      // rejected by CAS (409) instead of writing a second correction.
      const second=await prepare('再变一次，每周只有5小时了。')
      const stagedB=await stageGrowthUpdates(second.run,[{target:{operation:'amend',itemId:current.id,expectedRevision:current.revision,beforeQuote:'每周只有2小时了'},kind:'context',assertion:'user_reported',source:{messageId:second.run.source_message_id,quote:'每周只有5小时了'}}],growth)
      await assert.rejects(store.finishRun(second.run,{candidates:[],audit:[],growth:stagedB,usedGrowthRefs:growth.map(row=>({id:row.id,revision:row.revision})),growthSnapshotKey:growthSnapshotKey(growth)},'失败的并发更正。',null,new AbortController().signal),{code:'GROWTH_SNAPSHOT_INVALIDATED'})
      const items=(await growthView(user,chat)).items.filter(row=>row.status==='active')
      assert.equal(items.filter(row=>row.text.includes('小时')).length,1,'no partial writes: exactly one time fact is current')
      assert.equal(items.find(row=>row.text.includes('小时'))!.text,'每周只有1小时了')
    })
    await t.test('SRC-04 same-batch observation updateIndex resolves to the changed item, not a sibling',async()=>{
      const input=await prepare('时间又要改了，每周只有4小时，顺便记个观察。')
      const growth=await growthContext(user,chat)
      const current=growth.find(row=>row.text==='每周只有1小时了')!
      const saved=await finish(input,[
        {target:{operation:'amend',itemId:current.id,expectedRevision:current.revision,beforeQuote:'每周只有1小时了'},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'每周只有4小时'}},
        {target:{operation:'create'},kind:'priority',assertion:'ai_observation',text:'新时间预算下的阶段重点',source:input.source,dependencies:[{updateIndex:0}],limitation:'仅基于本人时间陈述，尚未验证安排可行性。'},
      ])
      assert.equal(saved.growthChangedIds.length,1)
      const observationId=saved.growthIds.find(id=>id!==saved.growthChangedIds[0]&&id!==current.id)!
      const observation=(await growthView(user,chat)).items.find(row=>row.id===observationId)!
      assert.deepEqual(observation.dependencies,[{id:saved.growthChangedIds[0]!,revision:current.revision+1}],'the observation depends on the changed time fact itself')
    })
    await t.test('SRC-06 two identical time clauses with unclear subject are ambiguous, not guessed',async()=>{
      const input=await prepare('我每周有6小时，舍友说他每周有6小时，先都记着；如果要说我的，我改成每周有5小时。')
      const twin='我每周有6小时，他说他每周有6小时，其余照旧。'
      const created=await prepare(twin)
      await finish(created,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:created.source}])
      const twinId=(await growthContext(user,chat)).find(row=>row.text===twin)!.id
      await assert.rejects(stageGrowthUpdates(input.run,[{target:{operation:'amend',itemId:twinId,expectedRevision:1,beforeQuote:'每周有6小时'},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'我改成每周有5小时'}}],await growthContext(user,chat)),{code:'GROWTH_AMENDMENT_AMBIGUOUS'})
      assert.equal((await growthView(user,chat)).items.find(row=>row.id===twinId)!.revision,1,'an ambiguous correction never writes')
    })
    await t.test('amend guards: wrong kind, supplied text, unknown target, observation target, off-message quote',async()=>{
      const input=await prepare('我把时间改为每周7小时。')
      const growth=await growthContext(user,chat)
      const current=growth.find(row=>row.text==='每周只有4小时')!
      await assert.rejects(stageGrowthUpdates(input.run,[{target:{operation:'amend',itemId:current.id,expectedRevision:current.revision,beforeQuote:current.text},kind:'goal',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'每周7小时'}}],growth),{code:'GROWTH_TARGET_INVALID'})
      await assert.rejects(stageGrowthUpdates(input.run,[{target:{operation:'amend',itemId:current.id,expectedRevision:current.revision,beforeQuote:current.text},kind:'context',assertion:'user_reported',text:'拼好的整句',source:{messageId:input.run.source_message_id,quote:'每周7小时'}}],growth),{code:'GROWTH_SOURCE_INVALID'})
      await assert.rejects(stageGrowthUpdates(input.run,[{target:{operation:'amend',itemId:randomUUID(),expectedRevision:1,beforeQuote:'随便'},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'每周7小时'}}],growth),{code:'GROWTH_TARGET_INVALID'})
      const offMessage=await stageGrowthUpdates(input.run,[{target:{operation:'amend',itemId:current.id,expectedRevision:current.revision,beforeQuote:current.text},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'这句话我根本没说过'}}],growth)
      assert.equal(offMessage.changes.length,0)
      assert.equal(offMessage.skipped?.[0].reason,'unverified_span','an off-message quote is dropped, never amended')
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
    })
    await t.test('SRC-07 cancelled amendment writes nothing; same requestId never double-writes',async()=>{
      const input=await prepare('改成每周9小时吧。')
      const growth=await growthContext(user,chat)
      const current=growth.find(row=>row.text==='每周只有4小时')!
      const before=await growthView(user,chat)
      const staged=await stageGrowthUpdates(input.run,[{target:{operation:'amend',itemId:current.id,expectedRevision:current.revision,beforeQuote:current.text},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'每周9小时'}}],growth)
      const aborted=new AbortController();aborted.abort()
      await assert.rejects(store.finishRun(input.run,{candidates:[],audit:[],growth:staged},'取消的更新。',null,aborted.signal))
      const afterCancel=await growthView(user,chat)
      assert.equal(afterCancel.items.length,before.items.length,'a cancelled turn leaves the growth state untouched')
      const replay=await store.startRun(user,chat,input.run.request_id,'改成每周9小时吧。')
      assert.equal(replay.replay,true,'the same requestId replays instead of starting a second run')
    })
    await t.test('withdrawn original sources fail the whole amendment',async()=>{
      const fresh='我每周有8小时，想先把作品整理好。'
      const created=await prepare(fresh)
      await finish(created,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:created.source}])
      const itemId=(await growthContext(user,chat)).find(row=>row.text===fresh)!.id
      await pool.query('INSERT INTO coach_source_withdrawals(user_id,conversation_id,message_id,reason) VALUES($1,$2,$3,\'corrected\')',[user,chat,created.run.source_message_id])
      const input=await prepare('改成每周6小时。')
      const growth=await growthContext(user,chat)
      assert.ok(!growth.some(row=>row.id===itemId),'a withdrawn original removes the item from the authorized snapshot')
      await assert.rejects(stageGrowthUpdates(input.run,[{target:{operation:'amend',itemId,expectedRevision:1,beforeQuote:'我每周有8小时'},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'每周6小时'}}],growth),{code:'GROWTH_TARGET_INVALID'})
      assert.equal((await pool.query('SELECT text FROM growth_items WHERE user_id=$1 AND id=$2',[user,itemId])).rows[0].text,fresh,'a withdrawn source blocks the correction')
    })
    await t.test('SRC-05 forgetting the new time fact keeps works and leaning and retires the old fragment precisely',async()=>{
      const view=await growthView(user,chat)
      const timeItem=view.items.find(row=>row.text==='每周只有4小时')!
      const works=view.items.find(row=>row.text==='我有三个数字媒体作品')!
      const forgotten=await actOnGrowthItem(user,timeItem.id,{requestId:randomUUID(),expectedRevision:timeItem.revision,action:'forget'})
      assert.equal(forgotten.status,'forgotten')
      const after=await growthView(user,chat)
      assert.ok(after.items.some(row=>row.id===works.id&&row.status==='active'),'forgetting the time fact never erases the works fact')
      assert.ok(!(await growthContext(user,chat)).some(row=>row.text==='每周只有4小时'||row.text==='每周能投入6小时'),'no current time budget from the corrected lineage remains — the old 6h does not silently come back')
      const messageRow=(await pool.query('SELECT id FROM messages WHERE user_id=$1 AND conversation_id=$2 AND content=$3',[user,chat,COMPOSITE])).rows[0]!
      assert.equal(await growthQuoteSuppressed(pool,user,messageRow.id,'每周能投入6小时'),true,'the exact superseded old fragment is suppressed')
      assert.equal(await growthQuoteSuppressed(pool,user,messageRow.id,'我有三个数字媒体作品'),false,'the retained works clause is not suppressed')
      const lineage=(await pool.query('SELECT superseded_quote,source_redacted FROM growth_item_lineage WHERE user_id=$1 AND fragment_role=\'changed\'',[user])).rows
      assert.ok(lineage.every(row=>row.source_redacted===true&&row.superseded_quote===null),'lineage audit is redacted, not a privacy bypass')
    })
  }finally{
    await pool.query('DELETE FROM growth_source_suppressions WHERE user_id=$1',[user])
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
