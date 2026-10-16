import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool,transaction} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {stageCoachEvent,invalidateCoachSources} from '../../server/action-coach-events.ts'
import {searchCoachEvents} from '../../server/coach-retrieval.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {setMemorySettings} from '../../server/memory.ts'

test('a fresh cross-session continuation can read an authorized event before indexing, with memory and source boundaries intact',async()=>{
 const user='pending-'+randomUUID(),foreign='pending-foreign-'+randomUUID(),first=randomUUID(),next=randomUUID(),foreignChat=randomUUID(),signal=new AbortController().signal
 try{
  await localEmbedding.start()
  for(const owner of [user,foreign])await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[owner,owner+'@example.invalid'])
  for(const [owner,id] of [[user,first],[user,next],[foreign,foreignChat]])await store.createConversation(owner,{id,title:'Synthetic pending continuation'})
  await setMemorySettings(user,{enabled:true,expectedRevision:0,requestId:randomUUID()})
  const text='我通过校内邮箱发了消息，他还没有回复。',run=(await store.startRun(user,first,randomUUID(),text)).run
  const coach=await stageCoachEvent(run,{target:{operation:'create',title:'向学长请教实习方向',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},'仍未回复，原因未知。')
  const saved=await store.finishRun(run,{candidates:[],audit:[],coach},coach.reply,null,signal),eventId=saved.event!.id
  assert.equal((await pool.query('SELECT 1 FROM coach_semantic_index WHERE user_id=$1',[user])).rowCount,0)
  const jobsBefore=(await pool.query('SELECT event_id,revision,generation,status FROM coach_index_jobs WHERE user_id=$1',[user])).rows
  const input={query:'接着上次请教学长的事，仍然没收到回复。'}
  const found=await searchCoachEvents(user,next,input,signal)
  assert.ok(found.events.some(event=>event.id===eventId),'the not-yet-indexed original matter must be available for continuation')
  assert.equal(found.indexPending,1)
  assert.deepEqual((await pool.query('SELECT event_id,revision,generation,status FROM coach_index_jobs WHERE user_id=$1',[user])).rows,jobsBefore,'read-time fallback must not consume or create indexing jobs')
  assert.equal((await pool.query('SELECT 1 FROM coach_semantic_index WHERE user_id=$1',[user])).rowCount,0)
  assert.equal((await searchCoachEvents(foreign,foreignChat,input,signal)).events.length,0)
  const anotherRun=(await store.startRun(user,first,randomUUID(),'另一位学长也还没有回复。')).run
  const another=await stageCoachEvent(anotherRun,{target:{operation:'create',title:'向学长请教实习方向',source:{messageId:anotherRun.source_message_id,quote:'另一位学长也还没有回复。'}}},'两件事情分别保留。')
  await store.finishRun(anotherRun,{candidates:[],audit:[],coach:another},another.reply,null,signal)
  const competing=await searchCoachEvents(user,next,input,signal)
  assert.equal(competing.events.length,2)
  assert.equal(competing.ambiguous,true,'equal-title pending events remain ambiguous candidates, not a chosen identity')
  await setMemorySettings(user,{enabled:false,expectedRevision:1,requestId:randomUUID()})
  assert.equal((await searchCoachEvents(user,next,input,signal)).events.length,0)
  await setMemorySettings(user,{enabled:true,expectedRevision:2,requestId:randomUUID()})
  await transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings']);await invalidateCoachSources(c,user,[run.source_message_id],true)})
  assert.ok(!(await searchCoachEvents(user,next,input,signal)).events.some(event=>event.id===eventId))
 }finally{await localEmbedding.close();for(const owner of [user,foreign])await pool.query('DELETE FROM "user" WHERE id=$1',[owner]);await pool.end()}
})
