import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import type {PoolClient} from 'pg'
import {pool,providerDispatchPool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import * as store from '../../server/store.ts'

test.after(async()=>{await Promise.all([providerDispatchPool.end(),pool.end()])})

test('provider dispatch capacity matches the configured generation scheduler',()=>{
 assert.equal(providerDispatchPool.options.max,config.generationConcurrency,'an admitted generation must not time out waiting for a smaller dispatch pool')
})

test('pool-sized provider fences do not starve ordinary database work',async()=>{
 const fixtures:{user:string;run:store.Run}[]=[],fences:store.ProviderDispatchFence[]=[]
 try{
  for(let index=0;index<providerDispatchPool.options.max;index++){
   const user='dispatch-pool-'+index+'-'+randomUUID(),conversation=randomUUID()
   await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
   await store.createConversation(user,{id:conversation,title:'SYNTHETIC dispatch pool isolation'})
   fixtures.push({user,run:(await store.startRun(user,conversation,randomUUID(),'请给我一个建议')).run})
  }
  for(const fixture of fixtures)fences.push(await store.acquireProviderDispatchFence(fixture.run,{candidates:[],audit:[]}))
  assert.equal(providerDispatchPool.idleCount,0,'the dedicated long-stream pool is actually saturated')
  const ordinary=await Promise.race([pool.query('SELECT 1 AS ok'),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('PRIMARY_POOL_STARVED')),250))])
  assert.equal(ordinary.rows[0].ok,1)
 }finally{
  await Promise.all(fences.map(fence=>fence.release()))
  for(const fixture of fixtures){await store.terminateRun(fixture.user,fixture.run.request_id,'cancelled','SYNTHETIC_CLEANUP');await pool.query('DELETE FROM "user" WHERE id=$1',[fixture.user])}
 }
})

test('an aborted provider-fence waiter releases its dispatch client before the blocking writer',async()=>{
 const user='dispatch-abort-'+randomUUID(),conversation=randomUUID(),controller=new AbortController()
 let blocker:PoolClient|undefined,pending:Promise<store.ProviderDispatchFence>|undefined,requestId:string|undefined
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:conversation,title:'SYNTHETIC abortable dispatch fence'})
  const run=(await store.startRun(user,conversation,randomUUID(),'请给我一个建议')).run;requestId=run.request_id
  blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])
  pending=store.acquireProviderDispatchFence(run,{candidates:[],audit:[]},controller.signal)
  await new Promise(resolve=>setTimeout(resolve,10))
  controller.abort()
  await assert.rejects(Promise.race([pending,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('FENCE_ABORT_TIMEOUT')),500))]),(error:any)=>error?.name==='AbortError','abort must win while the writer still owns the source lock')
  for(let i=0;i<100&&(providerDispatchPool.waitingCount!==0||providerDispatchPool.idleCount!==providerDispatchPool.totalCount);i++)await new Promise(resolve=>setTimeout(resolve,5))
  assert.equal(providerDispatchPool.waitingCount,0)
  assert.equal(providerDispatchPool.idleCount,providerDispatchPool.totalCount,'the cancelled waiter returns every checked-out dispatch client')
 }finally{
  if(blocker){await blocker.query('ROLLBACK');blocker.release();blocker=undefined}
  const fence=await pending?.catch(()=>undefined);await fence?.release()
  if(requestId)await store.terminateRun(user,requestId,'cancelled','SYNTHETIC_CLEANUP').catch(()=>{})
  await pool.query('DELETE FROM "user" WHERE id=$1',[user])
 }
})
