import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import type {PoolClient} from 'pg'
import {pool,providerDispatchPool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {actOnGrowthItem} from '../../server/growth.ts'

const waitFor=async(check:()=>Promise<boolean>,label:string)=>{
 const deadline=Date.now()+2500
 while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,20))}
 throw new Error('WAIT_TIMEOUT:'+label)
}

test.after(async()=>{await Promise.all([providerDispatchPool.end(),pool.end()])})

test('growth correction takes memory-settings before growth so a provider fence cannot deadlock it',async()=>{
 const user='growth-provider-order-'+randomUUID(),conversation=randomUUID(),fact='我的专业是软件工程',itemId=randomUUID(),signal=new AbortController().signal
 let blocker:PoolClient|undefined,fence:store.ProviderDispatchFence|undefined,correction:Promise<any>|undefined,fencePending:Promise<store.ProviderDispatchFence>|undefined,generation:store.Run|undefined
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:conversation,title:'SYNTHETIC growth/provider lock order'})
  const sourceRun=(await store.startRun(user,conversation,randomUUID(),fact)).run
  await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
  const source={type:'message',id:sourceRun.source_message_id,quote:fact,range:{start:0,end:fact.length}}
  await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]')",[itemId,user,conversation,fact,JSON.stringify([source])])
  await pool.query("INSERT INTO growth_revisions(user_id,item_id,revision,action,snapshot) VALUES($1,$2,1,'create',$3)",[user,itemId,JSON.stringify({id:itemId,revision:1,conversationId:conversation,kind:'context',text:fact,assertion:'user_reported',status:'active',sources:[source],dependencies:[]})])
  generation=(await store.startRun(user,conversation,randomUUID(),'请继续分析')).run
  blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['growth:'+user])
  correction=actOnGrowthItem(user,itemId,{requestId:randomUUID(),expectedRevision:1,action:'correct',text:'我的专业是计算机科学'})
  const waiters=async()=>Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event='advisory'")).rows[0].n)
  await waitFor(async()=>await waiters()>=1,'correction_waits_for_growth')
  const probe=await pool.connect()
  try{await probe.query('BEGIN');const acquired=(await probe.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[user+':memory-settings'])).rows[0].acquired;assert.equal(acquired,false,'the waiting correction already owns memory-settings before requesting growth');await probe.query('ROLLBACK')}finally{probe.release()}
  fencePending=store.acquireProviderDispatchFence(generation,{candidates:[],audit:[]})
  await waitFor(async()=>await waiters()>=2,'provider_waits_behind_correction')
  await blocker.query('COMMIT');blocker.release();blocker=undefined
  const corrected=await correction
  assert.equal(corrected.text,'我的专业是计算机科学')
  fence=await fencePending
  await fence.release();fence=undefined
 }finally{
  if(blocker){await blocker.query('ROLLBACK').catch(()=>{});blocker.release()}
  const settled=await Promise.allSettled([correction,fencePending].filter(Boolean) as Promise<unknown>[])
  const acquired=settled.find(result=>result.status==='fulfilled'&&result.value&&typeof result.value==='object'&&'release' in result.value) as PromiseFulfilledResult<store.ProviderDispatchFence>|undefined
  await fence?.release().catch(()=>{});await acquired?.value.release().catch(()=>{})
  if(generation)await store.terminateRun(user,generation.request_id,'cancelled','SYNTHETIC_CLEANUP').catch(()=>{})
  await pool.query('DELETE FROM "user" WHERE id=$1',[user])
 }
})
