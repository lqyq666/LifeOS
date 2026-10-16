import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { growthContext, stageGrowthUpdates, growthSnapshotKey } from '../../server/growth.ts'
import { parseActionCoachTurn } from '../../server/action-coach-contracts.ts'
import { deriveTurnObligations, verifyTurnObligations, weeklyTimeIntent } from '../../server/turn-obligations.ts'
import type { GrowthDelta } from '../../server/growth-model-contracts.ts'

// PC07: the remaining-this-week budget persists as a WEEK-SCOPED constraint.
// The week marker naturally sits in an earlier clause of the same sentence
// (这周课程赶，只剩两小时) — the calendar-week evidence inherits at sentence
// level, while an open-ended context item never satisfies the obligation.
test('remaining-this-week budget lands as a week-scoped constraint, never open-ended context',async t=>{
  const user='remaining-time-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC PC07 remaining budget'})
  const prepare=async(text:string)=>{
    await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_TEST_CLEANUP',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[user,chat])
    const run=(await store.startRun(user,chat,randomUUID(),text)).run
    return {run,growth:await growthContext(user,chat)}
  }
  const text='这周课程赶，只剩两小时能用了，剩下的怎么安排？'
  try{
    const obligations=deriveTurnObligations(text)
    // P2 (B02): 怎么安排 is an explicit plan request — remaining budget AND a this-week plan bound to it.
    assert.deepEqual(obligations.requiredEffects.map(effect=>effect.type),['remaining_time','weekly_plan'],'只剩N小时+本周标记产生剩余预算义务+计划义务')
    const planEffect=obligations.requiredEffects.find(effect=>effect.type==='weekly_plan')
    assert.equal(planEffect&&planEffect.type==='weekly_plan'?planEffect.minutes+'@'+planEffect.period:'','120@this_week')
    await t.test('an open-ended context item never satisfies the remaining obligation',async()=>{
      const attempt=await prepare(text)
      const staged=await stageGrowthUpdates(attempt.run,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:attempt.run.source_message_id,quote:'只剩两小时能用了'}}],attempt.growth)
      assert.throws(()=>verifyTurnObligations(obligations,{growth:staged,controls:undefined,currentText:text,reply:'好的。'}),(error:unknown)=>(error as {code?:string}).code==='GROWTH_REQUIRED_UPDATE_MISSING')
      await store.terminateRun(user,attempt.run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
    })
    await t.test('a week-scoped constraint with sentence-inherited calendar evidence passes and commits',async()=>{
      const attempt=await prepare(text)
      const staged=await stageGrowthUpdates(attempt.run,[{target:{operation:'create'},kind:'constraint',assertion:'user_reported',source:{messageId:attempt.run.source_message_id,quote:'只剩两小时能用了'},timeEvidence:{kind:'calendar_week',which:'this',quote:'这周'}}],attempt.growth)
      const planInput={availableMinutes:120,period:'this_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[],target:{operation:'create'}}
      verifyTurnObligations(obligations,{growth:staged,controls:undefined,weeklyPlan:{input:planInput},currentText:text,reply:'这周剩下的两小时先做一件最小的事。'})
      const saved=await store.finishRun(attempt.run,{candidates:[],audit:[],growth:staged,turnObligations:obligations},'这周剩下的两小时先做一件最小的事。',null,new AbortController().signal)
      assert.equal(saved.stateChange.growth.status,'applied')
      const item=(await growthContext(user,chat)).find(row=>row.kind==='constraint'&&/两小时/.test(row.text))
      assert.ok(item&&item.validUntil,'the remaining budget persists with an expiry')
      const until=Date.parse(item!.validUntil as unknown as string)
      assert.ok(until>Date.now()&&until<=Date.now()+8*86400000,'the window ends within this calendar week')
    })
    await t.test('a next-week marker never scopes this-week remaining evidence',async()=>{
      const attempt=await prepare(text)
      // A mismatched calendar_week (which:next with a this-week quote) can never
      // verify; since P1 the bogus constraint is skipped rather than failing
      // the turn — nothing with an invented window is ever saved.
      const staged=await stageGrowthUpdates(attempt.run,[{target:{operation:'create'},kind:'constraint',assertion:'user_reported',source:{messageId:attempt.run.source_message_id,quote:'只剩两小时能用了'},timeEvidence:{kind:'calendar_week',which:'next',quote:'这周'}}],attempt.growth)
      assert.equal(staged.changes.length,0)
      assert.equal(staged.skipped?.some(skip=>skip.reason==='unverifiable_constraint_time'),true)
      await store.terminateRun(user,attempt.run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
    })
    await t.test('a constraint with SUPPLIED-but-unverifiable evidence is skipped, not a turn failure (P1)',async()=>{
      const attempt=await prepare('每周10小时。')
      const staged=await stageGrowthUpdates(attempt.run,[
        {target:{operation:'create'},kind:'constraint',assertion:'user_reported',source:{messageId:attempt.run.source_message_id,quote:'每周10小时'},timeEvidence:{kind:'calendar_week',which:'this',quote:'每周'}},
        {target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:attempt.run.source_message_id,quote:'每周10小时'}},
      ],attempt.growth)
      assert.equal(staged.skipped?.some(skip=>skip.reason==='unverifiable_constraint_time'&&skip.quote==='每周10小时'),true,'the bogus-evidence constraint is dropped')
      assert.ok(staged.changes.some(delta=>delta.kind==='context'&&delta.assertion==='user_reported'),'the sibling context fact survives')
      await store.terminateRun(user,attempt.run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
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

// P5 required-effect regressions (isolated PG, no provider). OBL-02 replays the
// two REAL C10 time-update failures from coach-b2dd4d6c: the model answered the
// old delivery topic while the required 3h update was absent. Even with the
// optional candidate/event removed, the missing main-task update must fail.
test('required weekly-time updates must exist; real C10 failures replay as FAIL (OBL-01..04)',async t=>{
  const user='required-effects-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC required effects'})
  const prepare=async(text:string)=>{
    await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_TEST_CLEANUP',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[user,chat])
    const run=(await store.startRun(user,chat,randomUUID(),text)).run
    return {run,growth:await growthContext(user,chat)}
  }
  const fixturePath='tests/fixtures/campus-acceptance-regressions.json'
  const fixture=JSON.parse(readFileSync(fixturePath,'utf8')) as {input:string;compositePrior:string;failures:{code:string;rawOutput:string}[]}
  const stageDeltas=async(text:string,deltas:any[],authorized:Awaited<ReturnType<typeof growthContext>>)=>stageGrowthUpdates((await prepare(text)).run,deltas,authorized)
  try{
    let compositeId=''
    await t.test('C10 prior state: composite works/6h/leaning fact exists',async()=>{
      const first=await prepare(fixture.compositePrior)
      const staged=await stageGrowthUpdates(first.run,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:first.run.source_message_id,quote:fixture.compositePrior}}],first.growth)
      await store.finishRun(first.run,{candidates:[],audit:[],growth:staged},'已记录。',null,new AbortController().signal)
      compositeId=(await growthContext(user,chat)).find(row=>row.text===fixture.compositePrior)!.id
      assert.ok(compositeId)
    })
    await t.test('OBL-02 both REAL failure outputs fail, and removing the optional lanes does not rescue them',async()=>{
      // The original turn's own prior message, so the old-feedback candidate
      // points at a real older message exactly as in the real run.
      const priorRun=await prepare('我把清单发给两个招聘方了，还没有回复，感觉没什么效果。')
      await store.finishRun(priorRun.run,{candidates:[],audit:[]},'收到反馈。',null,new AbortController().signal)
      const priorMessageId=priorRun.run.source_message_id
      const obligations=deriveTurnObligations(fixture.input)
      assert.equal(obligations.kind,'mixed','N2.3: 改时间+改安排产生时间与计划双义务')
      for(const failure of fixture.failures){
        // Real historical outputs predate the clauseId protocol, so they no
        // longer parse against the current wire schema — exactly the
        // unrepresentable-quote guarantee. The lane guards are inspected from
        // the raw JSON directly, the way the recording captured them.
        let parsed:any
        try{parsed=parseActionCoachTurn(failure.rawOutput)}
        catch{parsed=JSON.parse(failure.rawOutput.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1'))}
        // With the full original output the offending lane is refused by its
        // own source guard: the old-feedback candidate re-binds a prior quote
        // (SOURCE_QUOTE_MISMATCH), the old-event output quotes old turns for
        // new nodes (COACH_SOURCE_INVALID shape).
        const attempt=await prepare(fixture.input)
        if(parsed.experienceCandidate){
          await assert.rejects(store.stageCandidate(attempt.run,{candidates:[],audit:[]},{sourceMessageId:priorMessageId,quote:parsed.experienceCandidate.source.quote,links:[]}),(error:unknown)=>error instanceof Error&&['SOURCE_QUOTE_MISMATCH','EXPERIENCE_SOURCE_NOT_CURRENT_MESSAGE','CAMPUS_SOURCE_INVALID'].includes((error as {code?:string}).code??''),failure.code+': the old-feedback candidate must be refused by a source guard')
        }else{
          const nodes=parsed.event?.nodes??[]
          assert.ok(nodes.length>0&&nodes.some((node:{source?:{quote:string}})=>node.source&&!fixture.input.includes(node.source.quote)),failure.code+': the original output binds old-turn quotes as current')
        }
        await store.terminateRun(user,attempt.run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
        // With the optional candidate/event lanes removed and no growth update
        // at all, the turn still fails on the missing main task — the absence
        // of a source error is not success (OBL-01 semantics on real output).
        const stripped=(JSON.parse(JSON.stringify(parsed)) as any)
        delete stripped.experienceCandidate
        delete stripped.event
        delete stripped.growthUpdates
        const replay=await prepare(fixture.input)
        const staged=await stageGrowthUpdates(replay.run,[],replay.growth)
        assert.equal(staged.changes.length,0)
        assert.throws(()=>verifyTurnObligations(obligations,{growth:staged,controls:undefined,currentText:fixture.input,reply:stripped.reply}),(error:unknown)=>(error as {code?:string}).code==='GROWTH_REQUIRED_UPDATE_MISSING',failure.code+': stripped replay must fail for the missing main task')
      }
    })
    await t.test('OBL-01 a legit amend carrying the 3h fact passes the obligation check',async()=>{
      const input=await prepare(fixture.input)
      const staged=await stageGrowthUpdates(input.run,[
        {target:{operation:'amend',itemId:compositeId,expectedRevision:1,beforeQuote:'每周能投入6小时'},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'每周只有3小时了'}},
      ],input.growth)
      const obligations=deriveTurnObligations(fixture.input)
      const stagedPlan={input:{availableMinutes:180,period:'current',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[],target:{operation:'create'}}}
      verifyTurnObligations(obligations,{growth:staged,controls:undefined,weeklyPlan:stagedPlan,currentText:fixture.input,reply:'已按每周3小时更新。'})
      const saved=await store.finishRun(input.run,{candidates:[],audit:[],growth:staged,turnObligations:obligations},'已按每周3小时更新。',null,new AbortController().signal)
      assert.equal(saved.stateChange.growth.status,'applied')
      assert.equal(saved.stateChange.growth.changedIds.length,1)
      assert.equal(saved.stateChange.growth.retainedIds.length,2)
    })
    await t.test('OBL-03 mixed input: time update AND real feedback both stand',async()=>{
      const text='改成每周3小时吧，昨天我已经把清单发给两个招聘方了。'
      const obligations=deriveTurnObligations(text)
      assert.equal(obligations.kind,'update_weekly_time')
      const input=await prepare(text)
      const staged=await stageGrowthUpdates(input.run,[
        {target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'改成每周3小时吧'}},
      ],input.growth)
      // The staged fact text carries the stated hours; real reported behaviour
      // (昨天已投递) stays eligible for its own event/candidate lanes.
      const checked=staged.changes.some(delta=>delta.assertion==='user_reported'&&text.includes(delta.source.quote)&&/3小时/.test(delta.text))
      assert.ok(checked,'the time fact with 3h is staged alongside real feedback eligibility')
      verifyTurnObligations(obligations,{growth:staged,controls:undefined,currentText:text,reply:'已更新并接住反馈。'})
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
    })
    await t.test('OBL-04 small talk creates no growth obligation',async()=>{
      const text='好的，先这样。'
      const obligations=deriveTurnObligations(text)
      assert.equal(obligations.kind,'ordinary')
      assert.equal(obligations.requiredEffects.length,0)
      assert.equal(weeklyTimeIntent(text),null)
      const input=await prepare(text)
      const staged=await stageGrowthUpdates(input.run,[],input.growth)
      assert.equal(staged.changes.length,0)
      verifyTurnObligations(obligations,{growth:undefined,controls:undefined,currentText:text,reply:'好的。'})
      const saved=await store.finishRun(input.run,{candidates:[],audit:[],turnObligations:obligations},'好的。',null,new AbortController().signal)
      assert.equal(saved.stateChange.growth.status,'not_requested')
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
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
