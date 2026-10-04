import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {seedCoachHistoryFixture} from '../../scripts/coach-history-fixture.ts'
import {stageCoachEvent,coachEventView} from '../../server/action-coach-events.ts'
import {checkMessageLimit} from '../../server/operations.ts'

test('A07 synthetic distractors actually displace old roles while authorized event sources remain',async()=>{
  const user='history-fixture-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  try{
    await store.createConversation(user,{id:chat,title:'SYNTHETIC A07 history'})
    const text='上次把资料通过网盘发给同学，同学说手机打不开。'
    const original=(await store.startRun(user,chat,randomUUID(),text)).run
    const coach=await stageCoachEvent(original,{target:{operation:'create',title:'网盘资料交付',source:{messageId:original.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:original.source_message_id,quote:text}}]},'你当时怎样联系这位同学？')
    const saved=await store.finishRun(original,{candidates:[],audit:[],coach},'你当时怎样联系这位同学？',null,signal)
    const seeded=await seedCoachHistoryFixture(user,chat)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM runs WHERE user_id=$1 AND request_id=ANY($2::uuid[]) AND status='completed'",[user,seeded.requestIds])).rows[0].n,45)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=ANY($2::uuid[])',[user,seeded.requestIds])).rows[0].n,90)
    const ordered=(await pool.query('SELECT role,run_request_id FROM messages WHERE user_id=$1 AND run_request_id=ANY($2::uuid[]) ORDER BY created_at,id',[user,seeded.requestIds])).rows
    for(let i=0;i<45;i++){
      assert.equal(ordered[i*2].role,'user');assert.equal(ordered[i*2+1].role,'assistant')
      assert.equal(ordered[i*2].run_request_id,seeded.requestIds[i]);assert.equal(ordered[i*2+1].run_request_id,seeded.requestIds[i])
    }
    await assert.rejects(checkMessageLimit(user),(e:any)=>e.code==='USER_MESSAGE_LIMIT','synthetic completed runs do not silently bypass default request limits')
    const before=(await pool.query('SELECT count(*)::int AS n FROM messages WHERE user_id=$1',[user])).rows[0].n
    await assert.rejects(seedCoachHistoryFixture(user,randomUUID()))
    await assert.rejects(seedCoachHistoryFixture(user,chat,44),/FROZEN_A07_DISTRACTOR_COUNT_CHANGED/)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE user_id=$1',[user])).rows[0].n,before,'invalid setup leaves no partial history')
    const current=(await store.startRun(user,chat,randomUUID(),'回来继续上次网盘交付的事。')).run
    const context=await store.contextForRun(current)
    assert.ok(!context.some(m=>m.id===original.source_message_id),'old source must actually leave the bounded role history')
    assert.ok(context.some(m=>seeded.messageIds.includes(m.id)),'synthetic distractors must be visible through the real store query')
    assert.ok(saved.event)
    const event=await coachEventView(user,chat,saved.event.id)
    assert.equal(event!.nodes[0].source!.messageId,original.source_message_id)
    assert.equal(event!.nodes[0].source!.quote,text)
    await store.terminateRun(user,current.request_id,'cancelled','SYNTHETIC_HISTORY_DONE')
  }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})
