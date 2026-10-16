import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { growthContext, growthView, stageGrowthUpdates, growthSnapshotKey, type GrowthWriteResult } from '../../server/growth.ts'
import type { ResolvedGrowthDelta } from '../../server/growth-model-contracts.ts'

// N1.3/N1.6 integration regressions (isolated PG, no provider): composite
// replace is blocked, write results distinguish created/changed/retained with
// original-index bindings, time columns follow every correction, and receipts
// come from the same transaction's real results.
test('growth write wiring: composite guards, exact write results, time columns (N1.3)',async t=>{
  const user='growth-r2-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC r2 integration'})
  const prepare=async(text:string)=>{
    await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_TEST_CLEANUP',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[user,chat])
    const run=(await store.startRun(user,chat,randomUUID(),text)).run
    return {run,growth:await growthContext(user,chat)}
  }
  const commit=async(input:Awaited<ReturnType<typeof prepare>>,changes:ResolvedGrowthDelta[])=>{
    const staged=await stageGrowthUpdates(input.run,changes,input.growth)
    const signal=new AbortController().signal
    const response=await store.finishRun(input.run,{candidates:[],audit:[],growth:staged,usedGrowthRefs:input.growth.map(row=>({id:row.id,revision:row.revision})),growthSnapshotKey:growthSnapshotKey(input.growth)},'合成回复。',null,signal)
    return {staged,response}
  }
  const writeResultOf=(response:unknown):GrowthWriteResult=>(response as {growthWrite:GrowthWriteResult}).growthWrite
  try{
    const COMPOSITE='我有三个数字媒体作品，每周能投入6小时，倾向就业但想看看真实反馈。'
    let compositeId=''
    await t.test('setup: composite fact exists',async()=>{
      const first=await prepare(COMPOSITE)
      const saved=await commit(first,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:first.run.source_message_id,quote:COMPOSITE}}])
      compositeId=saved.response.growthIds[0]!
      assert.ok(compositeId)
    })
    await t.test('model replace shrinking a composite is refused (GROWTH_COMPOSITE_REQUIRES_REVIEW)',async()=>{
      const input=await prepare('改成每周只有3小时了。')
      await assert.rejects(
        stageGrowthUpdates(input.run,[{target:{operation:'replace',itemId:compositeId,expectedRevision:1},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'改成每周只有3小时了'}}],input.growth),
        {code:'GROWTH_COMPOSITE_REQUIRES_REVIEW'},
        '旧记录包含多个独立事实时，replace必须走amend或用户整项改写')
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
    })
    await t.test('write results separate created/changed/retained and bind original input indexes',async()=>{
      const input=await prepare('最近课程变多了，每周只有3小时了，安排帮我改一下。另外我对视觉设计有兴趣。')
      const {staged,response}=await commit(input,[
        {target:{operation:'amend',itemId:compositeId,expectedRevision:1,beforeQuote:'每周能投入6小时'},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'每周只有3小时了'}},
        {target:{operation:'create'},kind:'preference',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'另外我对视觉设计有兴趣'}},
      ])
      const result=writeResultOf(response)
      assert.equal(result.changedIds.length,1,'amend produced the changed time fact')
      assert.equal(result.createdIds.length,1,'create produced a created fact')
      assert.equal(result.retainedIds.length,2,'split retained both siblings')
      // byInputIndex maps the PROVIDER's original array positions to the
      // changed facts — index 0 → the corrected time child, never a sibling.
      const bound=result.byInputIndex.get(0)
      assert.ok(bound,'original index 0 is bound')
      assert.equal(bound.id,result.changedIds[0])
      const created=result.byInputIndex.get(1)
      assert.ok(created)
      assert.equal(created.id,result.createdIds[0])
      assert.equal(created.revision,1)
      // bindings survive through the staged structure too
      assert.equal(staged.inputIndexBindings.get(0),0)
      assert.equal(staged.inputIndexBindings.get(1),1)
      const view=await growthView(user,chat)
      const changed=view.items.find(row=>row.id===result.changedIds[0])!
      assert.equal(changed.text,'每周只有3小时了')
      const created2=view.items.find(row=>row.id===result.createdIds[0])!
      assert.equal(created2.text,'另外我对视觉设计有兴趣')
    })
    await t.test('a later windowless correction clears the old time basis',async()=>{
      const before=(await growthView(user,chat)).items
      const timeItem=before.find(row=>row.text==='每周只有3小时了')!
      const timed=(await pool.query('SELECT valid_from,time_basis FROM growth_items WHERE user_id=$1 AND id=$2',[user,timeItem.id])).rows[0]
      assert.ok(timed.valid_from===null&&timed.time_basis===null,'windowless amend carries no stale basis (none was set)')
      const input=await prepare('这周考试密集，时间改成每周只有2小时。')
      const {response}=await commit(input,[
        {target:{operation:'amend',itemId:timeItem.id,expectedRevision:timeItem.revision,beforeQuote:'每周只有3小时了'},kind:'context',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'每周只有2小时'}},
      ])
      const result=writeResultOf(response)
      assert.equal(result.changedIds[0],timeItem.id,'single-clause amend keeps the same item')
      const after=(await pool.query('SELECT valid_from,valid_until,time_basis FROM growth_items WHERE user_id=$1 AND id=$2',[user,timeItem.id])).rows[0]
      assert.ok(after.valid_from===null&&after.valid_until===null&&after.time_basis===null,'windowless correction cleared any stale window columns')
    })
    await t.test('time evidence cannot borrow a date from another fact in the same message',async()=>{
      const input=await prepare('考试安排：截至2026年12月31日交作品。每周只有4小时。')
      // P1: an unverifiable constraint is skipped item-wise (never saved with a
      // borrowed date) instead of failing the whole turn.
      const borrowedStaged=await stageGrowthUpdates(input.run,[{target:{operation:'create'},kind:'constraint',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'每周只有4小时'},timeEvidence:{kind:'date_inclusive',date:'2026-12-31',quote:'截至2026年12月31日'}}],input.growth)
      assert.equal(borrowedStaged.changes.length,0,'证据quote与事实quote不在同一分句，不能借用日期')
      assert.equal(borrowedStaged.skipped?.some(skip=>skip.reason==='unverifiable_constraint_time'),true)
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
    })
    await t.test('time evidence inside the fact clause binds correctly',async()=>{
      const input=await prepare('接下来2周每周只有4小时，先这样。')
      const staged=await stageGrowthUpdates(input.run,[{target:{operation:'create'},kind:'constraint',assertion:'user_reported',source:{messageId:input.run.source_message_id,quote:'接下来2周每周只有4小时'},timeEvidence:{kind:'duration',count:2,unit:'week',quote:'接下来2周'}}],input.growth)
      const signal=new AbortController().signal
      const response=await store.finishRun(input.run,{candidates:[],audit:[],growth:staged},'已保存。',null,signal)
      const result=writeResultOf(response)
      const row=(await pool.query('SELECT valid_from,valid_until,time_basis FROM growth_items WHERE user_id=$1 AND id=$2',[user,result.createdIds[0]])).rows[0]
      assert.ok(row.valid_until,'window stored')
      assert.ok(row.time_basis,'basis stored')
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

import { readDirectionControls, stageDirectionControls, persistDirectionControls, directionControlsSnapshotKey, redactDirectionControlsForMessages } from '../../server/growth-controls.ts'
import { transaction } from '../../server/db.ts'

test('N1.4 control snapshot discipline: pre-generation key, zero-dep pure control, resume after redaction',async t=>{
  const user='growth-r2-ctl-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC r2 controls'})
  const prepare=async(text:string)=>{
    await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_TEST_CLEANUP',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[user,chat])
    return (await store.startRun(user,chat,randomUUID(),text)).run
  }
  try{
    await t.test('repeat same-state pause is a true no-op with empty effects',async()=>{
      const first=await prepare('先别推考研建议。')
      const staged1=await stageDirectionControls(first,[{scopes:['postgraduate_exam'],operation:'pause',quote:'先别推考研建议'}])
      const saved1=await store.finishRun(first,{candidates:[],audit:[],directionControls:staged1,directionControlSnapshotKey:staged1.expectedSnapshotKey},'已暂停考研建议。',null,new AbortController().signal)
      assert.equal(saved1.stateChange.controls.changedScopes.length,1)
      const second=await prepare('先别推考研建议，不要变。')
      const staged2=await stageDirectionControls(second,[{scopes:['postgraduate_exam'],operation:'pause',quote:'先别推考研建议'}])
      const saved2=await store.finishRun(second,{candidates:[],audit:[],directionControls:staged2,directionControlSnapshotKey:staged2.expectedSnapshotKey},'保持不变。',null,new AbortController().signal)
      assert.deepEqual(saved2.stateChange.controls.changedScopes,[],'same-state repeat is a real no-op')
      assert.deepEqual(saved2.stateChange.controls.effects,[])
    })
    await t.test('snapshot conflict rolls back on turns without control changes too',async()=>{
      const before=(await readDirectionControls(user)).map(row=>[row.scope,row.state,row.revision])
      const innocent=await prepare('帮我看看作品怎么改进。')
      const staleKey='deadbeef'.repeat(8)
      await assert.rejects(store.finishRun(innocent,{candidates:[],audit:[],directionControlSnapshotKey:staleKey},'不应提交。',null,new AbortController().signal),{code:'DIRECTION_CONTROL_CONFLICT'})
      const after=(await readDirectionControls(user)).map(row=>[row.scope,row.state,row.revision])
      assert.deepEqual(after,before,'no partial writes from the conflicting turn')
    })
    await t.test('resume after source redaction satisfies the 019 paired-id CHECK',async()=>{
      const pauseRun=await prepare('先别推考公相关的建议。')
      const staged=await stageDirectionControls(pauseRun,[{scopes:['public_service'],operation:'pause',quote:'先别推考公相关的建议'}])
      await store.finishRun(pauseRun,{candidates:[],audit:[],directionControls:staged,directionControlSnapshotKey:staged.expectedSnapshotKey},'已暂停考公建议。',null,new AbortController().signal)
      // Forget the source message (redaction path).
      await transaction(async c=>{await redactDirectionControlsForMessages(c,user,[pauseRun.source_message_id])})
      const redacted=(await readDirectionControls(user)).find(row=>row.scope==='public_service')!
      assert.equal(redacted.sourceRedacted,true)
      // Resuming writes new provenance and resets the flag — no CHECK violation.
      const resumeRun=await prepare('恢复考公建议。')
      const stagedResume=await stageDirectionControls(resumeRun,[{scopes:['public_service'],operation:'resume',quote:'恢复考公建议'}])
      const saved=await store.finishRun(resumeRun,{candidates:[],audit:[],directionControls:stagedResume,directionControlSnapshotKey:stagedResume.expectedSnapshotKey},'已恢复考公建议。',null,new AbortController().signal)
      const resumed=(await readDirectionControls(user)).find(row=>row.scope==='public_service')!
      assert.equal(resumed.state,'enabled')
      assert.equal(resumed.sourceRedacted,false)
      assert.ok(resumed.sourceMessageId)
      assert.equal(saved.stateChange.controls.changedScopes.length,1,'resume appears as a change')
    })
  }finally{
    await pool.query('DELETE FROM growth_direction_control_revisions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_direction_controls WHERE user_id=$1',[user])
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
