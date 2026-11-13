import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import {config,validateConfig} from '../../server/config.ts'
import {checkMessageLimit} from '../../server/operations.ts'
import {reserveEntitlement,entitlementView} from '../../server/entitlements.ts'
import * as store from '../../server/store.ts'

test.after(async()=>{await pool.end()})
test('public users need no invitation and zero daily quota permits continued conversation while minute protection remains',async()=>{
 const old={production:config.production,entitlementsEnabled:config.entitlementsEnabled,messagesPerDay:config.messagesPerDay,messagesPerMinute:config.messagesPerMinute}
 const user='public-'+randomUUID(),other='other-'+randomUUID(),chat=randomUUID()
 for(const id of [user,other])await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[id,id+'@example.invalid'])
 try{
  config.entitlementsEnabled=false;config.messagesPerDay=0;config.messagesPerMinute=3
  assert.equal(await reserveEntitlement(pool as any,user),false)
  assert.deepEqual(await entitlementView(user),{required:false})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC public signup'})
  for(let i=0;i<60;i++){
   const run=(await store.startRun(user,chat,randomUUID(),'SYNTHETIC quota history')).run
   await store.terminateRun(user,run.request_id,'cancelled','SYNTHETIC_DONE')
  }
  await pool.query("UPDATE runs SET started_at=now()-interval '2 minutes' WHERE user_id=$1",[user])
  await checkMessageLimit(user)
  const graph=await store.cognitionGraph(user)
  assert.ok(graph.nodes.some(n=>n.type==='self'))
  await assert.rejects(store.startRun(other,chat,randomUUID(),'不能访问别人的对话'))
  await pool.query("UPDATE runs SET started_at=now() WHERE request_id IN (SELECT request_id FROM runs WHERE user_id=$1 LIMIT 3)",[user])
  await assert.rejects(checkMessageLimit(user),(e:any)=>e.code==='USER_MESSAGE_LIMIT')
  config.messagesPerMinute=0;await checkMessageLimit(user)
  config.messagesPerDay=-1;assert.throws(validateConfig)
 }finally{Object.assign(config,old);await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[[user,other]])}
})
