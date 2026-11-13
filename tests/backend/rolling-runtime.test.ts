import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { pool } from '../../server/db.ts'
import { config } from '../../server/config.ts'
import { RuntimeCoordination } from '../../server/runtime-coordination.ts'
import { createApp } from '../../server/http.ts'
import type { Engine } from '../../server/agent.ts'
import * as store from '../../server/store.ts'
import {grantEntitlement} from '../../server/entitlements.ts'

test.after(async()=>{await pool.end()})
async function coordinator(){
  const client=await pool.connect()
  await client.query("SET application_name='lifeos-runtime-v2'")
  return {client,runtime:new RuntimeCoordination(client),async close(){await client.query('SELECT pg_advisory_unlock_all()');client.release()}}
}
async function waitFor(check:()=>Promise<boolean>,ms=4000){
  const start=Date.now()
  while(!await check()){if(Date.now()-start>ms)throw new Error('condition timed out');await delay(25)}
}
async function listen(app:ReturnType<typeof createApp>){await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+(app.address() as {port:number}).port}
async function close(app:ReturnType<typeof createApp>){await app.drain();await new Promise<void>(r=>app.close(()=>r()))}

test('37s SSE survives route switch and drain, stays live through recovery, saves/bills exactly once, replays from peer', {timeout:60000},async()=>{
  const a=await coordinator(),b=await coordinator()
  const oldEntitlements=config.entitlementsEnabled;config.entitlementsEnabled=true
  let entered=false,calls=0,aborted=false
  const text='合成完整长回复：'+ '保留原文和最后一句。'.repeat(60)
  const engine:Engine=async input=>{
    calls++;entered=true
    try{await delay(37000,undefined,{signal:input.signal})}catch(error){aborted=true;throw error}
    return {text,usage:null}
  }
  const oldApp=createApp(engine,55000,undefined,a.runtime),newApp=createApp(engine,55000,undefined,b.runtime)
  const oldBase=await listen(oldApp),newBase=await listen(newApp)
  let user='',cookie=''
  const post=(base:string,path:string,data:unknown)=>fetch(base+path,{method:'POST',headers:{Origin:config.origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(data)})
  try{
    assert.equal(await a.runtime.maintain(),true)
    const signup=await post(oldBase,'/api/auth/sign-up/email',{email:randomUUID()+'@example.invalid',name:'Synthetic rolling adult',password:'Synthetic-password-123456'})
    assert.equal(signup.status,200)
    cookie=signup.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')
    user=(await (await fetch(oldBase+'/api/session',{headers:{Cookie:cookie}})).json()).id
    await grantEntitlement(user,10,new Date(Date.now()+86400000).toISOString())
    const chat=randomUUID(),id=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC rolling'})
    const stream=await post(oldBase,'/api/conversations/'+chat+'/messages',{requestId:id,text:'合成测试，请保留完整最后一句。'})
    assert.equal(stream.status,200)
    const reading=stream.text()
    await waitFor(async()=>entered)
    assert.equal(await b.runtime.maintain(),false,'second runtime coexists without stealing leader')
    await a.runtime.maintain()
    assert.equal((await store.runStatus(user,id)).status,'running','startup/recovery did not mark live owner restarted')
    assert.equal((await fetch(newBase+'/api/runs/'+id,{headers:{Cookie:cookie}})).status,200,'new route reads old request')
    assert.equal((await post(newBase,'/api/conversations/'+chat+'/messages',{requestId:id,text:'合成测试，请保留完整最后一句。'})).status,409)
    let drained=false;const draining=oldApp.drain().then(()=>{drained=true})
    await delay(150)
    assert.equal(drained,false,'drain waits for full reply and transaction')
    assert.equal((await fetch(oldBase+'/api/conversations',{headers:{Cookie:cookie}})).status,503)
    const body=await reading;await draining
    assert.equal(aborted,false);assert.equal(calls,1)
    assert.equal((body.match(/"type":"done"/g)??[]).length,1)
    assert.ok(body.includes(text));assert.doesNotMatch(body,/SERVER_RESTARTED|SERVER_SHUTTING_DOWN|draft_discarded/)
    const replay=await post(newBase,'/api/conversations/'+chat+'/messages',{requestId:id,text:'合成测试，请保留完整最后一句。'})
    assert.match(await replay.text(),/"replayed":true/);assert.equal(calls,1)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,id])).rows[0].n,1)
    assert.equal((await store.runStatus(user,id)).status,'completed')
    assert.equal((await pool.query('SELECT used_turns FROM lifeos_entitlements WHERE user_id=$1',[user])).rows[0].used_turns,1,'one entitlement consumed across save/replay')
  }finally{await close(oldApp);await close(newApp);await a.close();await b.close();config.entitlementsEnabled=oldEntitlements;if(user)await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('legacy lock prevents false recovery; peer owns request/account/slot; only ownerless runs recovered after handover',async()=>{
  const legacy=await pool.connect(),a=await coordinator(),b=await coordinator()
  const user='rolling-'+randomUUID(),chat=randomUUID(),id=randomUUID()
  try{
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
    await store.createConversation(user,{id:chat,title:'SYNTHETIC legacy'})
    const {run}=await store.startRun(user,chat,id,'合成遗留请求')
    await legacy.query("SET application_name='legacy-lifeos'")
    await legacy.query('SELECT pg_advisory_lock(6100102)')
    assert.equal(await a.runtime.maintain(),false);assert.equal((await store.runStatus(user,id)).status,'running')
    const waiting=new AbortController()
    const blocked=a.runtime.acquireGeneration(user,2,waiting.signal)
    let granted=false;void blocked.then(()=>{granted=true},()=>{})
    await delay(160);assert.equal(granted,false,'same-account legacy work serializes across release boundary')
    waiting.abort();await assert.rejects(blocked)
    const release=await b.runtime.claimRun(user,id);assert.ok(release)
    assert.equal(await a.runtime.claimRun(user,id),null)
    await legacy.query('SELECT pg_advisory_unlock(6100102)')
    assert.equal(await a.runtime.maintain(),true)
    assert.equal((await store.runStatus(user,run.request_id)).status,'running','new peer owner preserved')
    await release();await a.runtime.maintain()
    assert.equal((await store.runStatus(user,id)).error_code,'SERVER_RESTARTED')
    const releaseSlot=await a.runtime.acquireGeneration(user,1,new AbortController().signal)
    const sameAccountCancel=new AbortController();const sameAccount=a.runtime.acquireGeneration(user,2,sameAccountCancel.signal)
    let sameAccountGranted=false;void sameAccount.then(()=>{sameAccountGranted=true},()=>{})
    await delay(160);assert.equal(sameAccountGranted,false,'session lock reentrancy cannot bypass same-instance chat/workflow serialization')
    sameAccountCancel.abort();await assert.rejects(sameAccount)
    const cancel=new AbortController();const second=b.runtime.acquireGeneration('another-account',1,cancel.signal)
    let secondGranted=false;void second.then(()=>{secondGranted=true},()=>{})
    await delay(160);assert.equal(secondGranted,false,'global slot bound applies across processes')
    cancel.abort();await assert.rejects(second);await releaseSlot()
    const next=await b.runtime.acquireGeneration(user,1,new AbortController().signal);await next()
  }finally{await legacy.query('SELECT pg_advisory_unlock_all()');legacy.release();await a.close();await b.close();await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('cancellation sent to peer stops owning SSE before save without another engine dispatch',async()=>{
  const a=await coordinator(),b=await coordinator();let entered=false,aborted=false
  const engine:Engine=async input=>{entered=true;try{await delay(10000,undefined,{signal:input.signal})}catch(error){aborted=true;throw error}return {text:'不应保存',usage:null}}
  const appA=createApp(engine,15000,undefined,a.runtime),appB=createApp(engine,15000,undefined,b.runtime)
  const baseA=await listen(appA),baseB=await listen(appB);let user='',cookie=''
  const post=(base:string,path:string,data:unknown)=>fetch(base+path,{method:'POST',headers:{Origin:config.origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(data)})
  try{
    const signup=await post(baseA,'/api/auth/sign-up/email',{email:randomUUID()+'@example.invalid',name:'Synthetic cancel adult',password:'Synthetic-password-123456'})
    cookie=signup.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')
    user=(await (await fetch(baseA+'/api/session',{headers:{Cookie:cookie}})).json()).id
    const chat=randomUUID(),id=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC cancel'})
    const stream=await post(baseA,'/api/conversations/'+chat+'/messages',{requestId:id,text:'合成等待请求'})
    const reading=stream.text();await waitFor(async()=>entered)
    assert.equal((await post(baseB,'/api/runs/'+id+'/cancel',{})).status,200)
    assert.doesNotMatch(await reading,/"type":"done"/);assert.equal(aborted,true)
    assert.equal((await store.runStatus(user,id)).status,'cancelled')
    assert.equal((await pool.query("SELECT 1 FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,id])).rowCount,0)
  }finally{await close(appA);await close(appB);await a.close();await b.close();if(user)await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})
