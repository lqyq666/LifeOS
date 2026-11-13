import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool, transaction } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { coachHistoryView } from '../../server/coach-history.ts'
import { invalidateCoachSources } from '../../server/action-coach-events.ts'

test('legacy read adapter preserves valid saved records and hides withdrawn sources without planning',async()=>{
  const user='coach-history-'+randomUUID(),conversation=randomUUID(),sourceConversation=randomUUID(),text='我完成了历史记录的整理。',crossText='我曾在另一段对话里确认过历史目标。'
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  try{
    await store.createConversation(user,{id:conversation,title:'Synthetic legacy history'})
    await store.createConversation(user,{id:sourceConversation,title:'Synthetic deleted legacy source'})
    await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1)',[user])
    const run=(await store.startRun(user,conversation,randomUUID(),text)).run
    await store.finishRun(run,{candidates:[],audit:[]},'历史记录。',null,new AbortController().signal)
    // Seed a saved legacy row, rather than keeping a retired generator to manufacture one.
    await pool.query('INSERT INTO decision_versions(user_id,conversation_id,version,request_id,payload) VALUES($1,$2,1,$3,$4)',[user,conversation,run.request_id,{conditions:[{text,quote:text,sourceMessageId:run.source_message_id}],unknowns:[],recommendation:{title:'历史建议',text:'这只是保留的旧建议，不会重新生成方案。'},actions:[]}])
    const repeated='请继续求职访谈；请继续创业访谈'
    const repeatedRun=(await store.startRun(user,conversation,randomUUID(),repeated)).run
    await store.finishRun(repeatedRun,{candidates:[],audit:[]},'收到。',null,new AbortController().signal)
    await pool.query('INSERT INTO decision_versions(user_id,conversation_id,version,request_id,payload) VALUES($1,$2,2,$3,$4)',[user,conversation,repeatedRun.request_id,{conditions:[{text:'请继续',quote:'请继续',sourceMessageId:repeatedRun.source_message_id}],unknowns:[],recommendation:{title:'模糊旧建议',text:'重复引文不能成为权威来源。'},actions:[]}])
    const crossRun=(await store.startRun(user,sourceConversation,randomUUID(),crossText)).run
    await store.finishRun(crossRun,{candidates:[],audit:[]},'收到。',null,new AbortController().signal)
    await pool.query('INSERT INTO decision_versions(user_id,conversation_id,version,request_id,payload) VALUES($1,$2,3,$3,$4)',[user,conversation,crossRun.request_id,{conditions:[{text:crossText,quote:crossText,sourceMessageId:crossRun.source_message_id}],unknowns:[],recommendation:{title:'跨会话历史建议',text:'仅在来源仍可见时保留。'},actions:[]}])
    await pool.query('INSERT INTO campus_inquiries(id,user_id,conversation_id,payload) VALUES($1,$2,$3,$4)',[randomUUID(),user,conversation,{domain:'life_goal',question:'旧资料整理',questionSource:{type:'message',id:run.source_message_id,quote:text},criteria:[],readiness:'act',questions:[],studentContext:[],pathways:[],opportunities:[],evidence:[],hypotheses:[],experiments:[{id:randomUUID(),status:'accepted',action:'旧材料文字',createdAt:new Date().toISOString()}],changes:[]}])
    const before=await coachHistoryView(user,conversation)
    assert.equal(before.decisions.find(row=>row.version===1)?.payload?.recommendation.title,'历史建议')
    assert.equal(before.decisions.find(row=>row.version===2)?.payload,null,'a range-free quote repeated in one message is not an authoritative saved source')
    assert.equal(before.decisions.find(row=>row.version===3)?.payload?.recommendation.title,'跨会话历史建议')
    assert.equal(before.inquiries[0].payload?.experiments[0].action,'旧材料文字')
    await assert.rejects(coachHistoryView('another-user',conversation),(error:any)=>error.code==='NOT_FOUND')
    await store.deleteConversation(user,sourceConversation)
    const afterDeleted=await coachHistoryView(user,conversation)
    assert.equal(afterDeleted.decisions.find(row=>row.version===3)?.payload,null,'a deleted cross-conversation source cannot remain legacy decision authority')
    assert.ok(!JSON.stringify(afterDeleted).includes(crossText))
    await transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings']);await invalidateCoachSources(c,user,[run.source_message_id],true)})
    const after=await coachHistoryView(user,conversation)
    assert.equal(after.decisions.length,3);assert.ok(after.decisions.every(row=>row.payload===null))
    assert.equal(after.inquiries[0].payload,null)
    assert.ok(!JSON.stringify(after).includes('旧材料文字'))
    assert.ok(!JSON.stringify(after).includes(text));assert.ok(!JSON.stringify(after).includes('旧建议'))
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM decision_versions WHERE user_id=$1',[user])).rows[0].n,3)
  }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end()}
})
