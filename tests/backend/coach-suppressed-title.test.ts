import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool,transaction} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {stageCoachEvent,readCoachEvent,assertCoachEvidence} from '../../server/action-coach-events.ts'
import {searchCoachEvents} from '../../server/coach-retrieval.ts'

test('a partially withdrawn event title is excluded before provider dispatch while commit protection stays strict',async()=>{
 const user='suppressed-title-'+randomUUID(),chat=randomUUID(),other=randomUUID()
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC title suppression'})
  await store.createConversation(user,{id:other,title:'SYNTHETIC readback'})
  await pool.query('INSERT INTO user_memory_settings(user_id,enabled) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET enabled=true',[user])
  const text='我做了一个产品演示。',run=(await store.startRun(user,chat,randomUUID(),text)).run
  const source={messageId:run.source_message_id,quote:text}
  const staged=await stageCoachEvent(run,{target:{operation:'create',title:'产品演示',source},nodes:[{kind:'fact',source}]},'记录演示。')
  const saved=await store.finishRun(run,{candidates:[],audit:[],coach:staged},staged.reply,null,new AbortController().signal)
  const event=saved.event!
  assert.ok(await transaction(c=>readCoachEvent(c,user,other,event.id)))
  await pool.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4)',[user,chat,run.source_message_id,'产品演示'])
  await assert.rejects(transaction(c=>readCoachEvent(c,user,other,event.id)),(e:any)=>e.code==='COACH_SOURCE_REVOKED')
  assert.deepEqual((await searchCoachEvents(user,other,{query:'',eventId:event.id})).events,[])
  await assert.rejects(transaction(c=>assertCoachEvidence(c,user,other,[{eventId:event.id,revision:event.revision,generation:event.generation}])),(e:any)=>e.code==='COACH_SNAPSHOT_INVALIDATED','commit protection remains strict')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})
