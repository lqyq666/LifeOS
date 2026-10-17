import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {stageCoachEvent} from '../../server/action-coach-events.ts'

test('grilling unknowns retain a short dependency audit and do not ask downstream questions early',async()=>{
  const user='grilling-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  try{
    await store.createConversation(user,{id:chat,title:'SYNTHETIC grilling dependency'})
    const opening=(await store.startRun(user,chat,randomUUID(),'大家都考研，我也在考虑，但还不知道自己想得到什么。')).run
    const staged=await stageCoachEvent(opening,{target:{operation:'create',title:'是否跟随考研',source:{messageId:opening.source_message_id,quote:'大家都考研，我也在考虑'}},nodes:[{kind:'unknown',question:'如果不考虑同学选择，你希望读研改变哪一部分生活？',affects:'是否把考研保留为当前路径',reason:'目的会改变后续比较标准'}]},'先问一个关键的：如果不考虑同学选择，你希望读研改变哪一部分生活？')
    let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:staged},staged.reply,null,signal)).event!
    const purpose=event.nodes.find(node=>node.kind==='unknown')!
    assert.deepEqual(purpose.inquiryContext,{affects:'是否把考研保留为当前路径',reason:'目的会改变后续比较标准',dependsOn:[]})

    const early=(await store.startRun(user,chat,randomUUID(),'我还没想清楚。')).run
    await assert.rejects(stageCoachEvent(early,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'unknown',question:'你准备报哪所学校？',affects:'院校范围',reason:'用于选择学校',dependsOn:[purpose.id]}]},'你准备报哪所学校？'),(error:any)=>error.code==='COACH_UNKNOWN_PREREQUISITE_OPEN')
    await store.terminateRun(user,early.request_id,'cancelled','EXPECTED_DEPENDENCY_BLOCK')

    const answer=(await store.startRun(user,chat,randomUUID(),'我更想获得深入研究一个问题的时间，先不急着定学校。')).run
    const continued=await stageCoachEvent(answer,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:answer.source_message_id,quote:'我更想获得深入研究一个问题的时间'}},{kind:'unknown',question:'你想深入研究的具体问题是什么？',affects:'是否值得用读研验证这个方向',reason:'具体问题比学校名单更早影响路径判断',dependsOn:[purpose.id]}],resolveUnknowns:[purpose.id]},'你想深入研究的具体问题是什么？')
    event=(await store.finishRun(answer,{candidates:[],audit:[],coach:continued},continued.reply,null,signal)).event!
    const next=event.nodes.find(node=>node.content==='你想深入研究的具体问题是什么？')!
    assert.deepEqual(next.inquiryContext?.dependsOn,[purpose.id])
    assert.equal(event.nodes.find(node=>node.id===purpose.id)?.status,'resolved')
    assert.deepEqual(event.processTurns?.at(-1)?.introducedUnknownNodeIds,[next.id])
  }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})
