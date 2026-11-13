import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool,transaction} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {searchCoachEvents} from '../../server/coach-retrieval.ts'
import {stageCoachEvent,invalidateCoachSources} from '../../server/action-coach-events.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test.after(async()=>{await localEmbedding.close();await pool.end()})
test('empty event scope avoids embedding while pending history, ownership and memory controls stay enforced',async()=>{
 const user='empty-retrieval-'+randomUUID(),foreign='foreign-'+randomUUID(),chat=randomUUID(),second=randomUUID(),foreignChat=randomUUID()
 const original=localEmbedding.encode.bind(localEmbedding);let calls=0
 localEmbedding.encode=async texts=>{calls++;return texts.map(()=>[1,...Array(511).fill(0)])}
 for(const owner of [user,foreign])await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[owner,owner+'@example.invalid'])
 try{
  for(const [owner,id] of [[user,chat],[user,second],[foreign,foreignChat]])await store.createConversation(owner,{id,title:'SYNTHETIC event retrieval boundary'})
  const create=async(owner:string,conversation:string)=>{
   const text='我给同学整理过复习材料，同学还没有回复。',run=(await store.startRun(owner,conversation,randomUUID(),text)).run
   const reply='这次材料的实际采用和效果仍未知。',coach=await stageCoachEvent(run,{target:{operation:'create',title:'SYNTHETIC 复习材料',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},reply)
   const saved=await store.finishRun(run,{candidates:[],audit:[],coach},reply,null,new AbortController().signal)
   return {id:saved.event!.id,source:run.source_message_id}
  }
  await create(foreign,foreignChat)
  const empty=await searchCoachEvents(user,chat,{query:'复习材料与反馈'.repeat(300)})
  assert.deepEqual(empty,{events:[],ambiguous:false,indexPending:0});assert.equal(calls,0,'an empty owner scope must not encode a long query')
  await assert.rejects(searchCoachEvents(foreign,chat,{query:'资料'}),(e:any)=>e.code==='NOT_FOUND')
  await assert.rejects(searchCoachEvents(user,chat,{query:'资料',after:'bad'}),(e:any)=>e.code==='RETRIEVAL_DATE_INVALID')
  await assert.rejects(searchCoachEvents(user,chat,{query:'长'.repeat(16001)}),(e:any)=>e.code==='RETRIEVAL_INPUT_LIMIT')
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(searchCoachEvents(user,chat,{query:'资料'},cancelled.signal));assert.equal(calls,0)
  const own=await create(user,chat),pending=await searchCoachEvents(user,chat,{query:'复习材料反馈'})
  assert.ok(calls>0);assert.equal(pending.events[0]?.id,own.id);assert.equal(pending.indexPending,1)
  assert.equal((await searchCoachEvents(user,second,{query:'复习材料反馈'})).events.length,0)
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  assert.equal((await searchCoachEvents(user,second,{query:'复习材料反馈'})).events[0]?.id,own.id)
  await transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings']);await invalidateCoachSources(c,user,[own.source],true)})
  calls=0;assert.deepEqual(await searchCoachEvents(user,second,{query:'复习材料反馈'}),{events:[],ambiguous:false,indexPending:0});assert.equal(calls,0)
 }finally{localEmbedding.encode=original;for(const owner of [user,foreign])await pool.query('DELETE FROM "user" WHERE id=$1',[owner])}
})
