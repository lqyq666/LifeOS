import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createApp } from '../../server/http.ts'
import { createTurnEngine } from '../../server/agent.ts'
import { model } from '../../server/model.ts'
import { config } from '../../server/config.ts'
import { pool, HttpError } from '../../server/db.ts'
import { checkMessageLimit, clientIP } from '../../server/operations.ts'
import * as store from '../../server/store.ts'
import { verifySchema } from '../../server/schema.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test('installed Pi + real auth/PG propagate simulated provider rate limits, persist cooldown and preserve business state',async()=>{
  const original=await pool.query('SELECT * FROM lifeos_model_state WHERE id=1')
  const oldURL=model.baseUrl,oldKey=config.apiKey,oldProxy=config.trustedProxy
  config.trustedProxy='127.0.0.1'
  const fixtureIP='198.18.'+Math.floor(Math.random()*256)+'.'+Math.floor(Math.random()*256)
  let calls=0,user=''
  const upstream=createServer((_req,res)=>{calls++;res.writeHead(429,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'1302',message:'simulated rate limit'}}))})
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve))
  model.baseUrl='http://127.0.0.1:'+(upstream.address() as {port:number}).port
  config.apiKey='synthetic-test-key-for-local-upstream'
  const server=createApp(createTurnEngine({capabilityVerified:()=>true}));await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port
  let cookie=''
  const request=(path:string,data?:unknown)=>fetch(base+path,{method:data?'POST':'GET',headers:{Origin:config.origin,Cookie:cookie,'X-Real-IP':fixtureIP,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined})
  try{
    await pool.query('UPDATE lifeos_model_state SET retry_until=NULL,error_code=NULL WHERE id=1')
    const signup=await request('/api/auth/sign-up/email',{email:'lifeos-ops-'+randomUUID()+'@example.invalid',name:'运维边界模拟验收',password:'Synthetic-'+randomUUID()})
    assert.equal(signup.status,200)
    cookie=signup.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
    user=(await (await request('/api/session')).json()).id
    const chat=randomUUID(),id=randomUUID();await store.createConversation(user,{id:chat,title:'模拟上游故障'})
    const first=await request('/api/conversations/'+chat+'/messages',{requestId:id,text:'这是模拟限流验收，不是个人经历。'})
    const stream=await first.text();assert.match(stream,/MODEL_RATE_LIMITED/);assert.match(stream,/"retryAfter":60/)
    assert.equal(calls,1);assert.equal((await store.decisionVersions(user,chat)).length,0);assert.equal((await store.listExperiences(user,chat)).length,0)
    const second=await request('/api/conversations/'+chat+'/messages',{requestId:randomUUID(),text:'第二条模拟消息'})
    assert.equal(second.status,503);assert.ok(Number(second.headers.get('Retry-After'))>0);assert.equal(calls,1)
    assert.equal((await request('/api/conversations/'+chat+'/messages',{requestId:id,text:'这是模拟限流验收，不是个人经历。'})).status,409)
    const state=await (await request('/api/health')).json();assert.equal(state.provider.lastOutcome,'MODEL_RATE_LIMITED');assert.equal(state.providerCheckedByHealth,false)
    assert.equal((await (await request('/api/ready')).json()).modelLiveVerified,false)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM runs WHERE user_id=$1',[user])).rows[0].n,1)
    for(let i=1;i<config.messagesPerMinute;i++){const {run}=await store.startRun(user,chat,randomUUID(),'模拟配额计数');await store.terminateRun(user,run.request_id,'failed','SIMULATED')}
    await assert.rejects(()=>checkMessageLimit(user),e=>e instanceof HttpError&&e.code==='USER_MESSAGE_LIMIT')
    config.trustedProxy='127.0.0.1'
    assert.equal(clientIP('203.0.113.9','198.51.100.2'),'203.0.113.9')
    assert.equal(clientIP('::ffff:127.0.0.1','198.51.100.2'),'198.51.100.2')
    assert.equal(clientIP('127.0.0.1','198.51.100.2, 203.0.113.2'),'127.0.0.1')
    const client=await pool.connect();try{await verifySchema(client)}finally{client.release()}
    await server.drain()
    assert.equal((await request('/api/conversations')).status,503)
  }finally{
    await localEmbedding.close()
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))
    upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()))
    model.baseUrl=oldURL;config.apiKey=oldKey;config.trustedProxy=oldProxy
    if(user){await pool.query('DELETE FROM runs WHERE user_id=$1',[user]);await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
    const old=original.rows[0];await pool.query('UPDATE lifeos_model_state SET retry_until=$1,error_code=$2,last_success_at=$3,last_failure_at=$4 WHERE id=1',[old.retry_until,old.error_code,old.last_success_at,old.last_failure_at])
    await pool.end()
  }
})
