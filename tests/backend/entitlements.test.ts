import {spawnSync} from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {grantEntitlement,entitlementView} from '../../server/entitlements.ts'
import {createApp} from '../../server/http.ts'
import type {Engine} from '../../server/agent.ts'

test('manual access uses transactional PostgreSQL reservations, completion and replay (no paid provider)',async t=>{
 const previous=config.entitlementsEnabled;config.entitlementsEnabled=true
 const user='access-'+randomUUID(),other='access-'+randomUUID(),chats=[randomUUID(),randomUUID()]
 const expires=()=>new Date(Date.now()+86400000).toISOString()
 const staged=()=>({candidates:[],audit:[]})
 try{
  for(const id of [user,other])await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[id,id+'@example.invalid'])
  for(const id of chats)await store.createConversation(user,{id,title:'Synthetic access'})
  await t.test('unopened, expired and exhausted users make no run/message write',async()=>{
   for(const code of ['ACCESS_NOT_ENABLED','ACCESS_EXPIRED','ACCESS_LIMIT_REACHED']){
    if(code==='ACCESS_EXPIRED'){await grantEntitlement(user,1,expires());await pool.query("UPDATE lifeos_entitlements SET expires_at=now()-interval '1 second' WHERE user_id=$1",[user])}
    if(code==='ACCESS_LIMIT_REACHED')await grantEntitlement(user,0,expires())
    await assert.rejects(store.startRun(user,chats[0],randomUUID(),'Synthetic text'),(e:any)=>e.code===code)
   }
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE user_id=$1',[user])).rows[0].n,0)
  })
  await t.test('one remaining turn cannot be reserved concurrently in different conversations',async()=>{
   await grantEntitlement(user,1,expires())
   const results=await Promise.allSettled(chats.map(id=>store.startRun(user,id,randomUUID(),'Synthetic simultaneous')))
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
   const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult
   assert.equal(rejected.reason.code,'ACCESS_LIMIT_REACHED')
   const value=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value
   assert.equal((await entitlementView(user) as any).reserved,1)
   assert.equal((await entitlementView(user) as any).remaining,0)
   assert.equal((await store.startRun(user,value.run.conversation_id,value.run.request_id,'Synthetic simultaneous')).replay,true)
   await assert.rejects(store.startRun(user,value.run.conversation_id,value.run.request_id,'Different text'),(e:any)=>e.code==='IDEMPOTENCY_KEY_REUSED')
   await store.terminateRun(user,value.run.request_id,'cancelled','SYNTHETIC_CANCEL')
   assert.equal((await entitlementView(user) as any).remaining,1)
   assert.equal((await entitlementView(user) as any).used,0)
  })
  await t.test('legal completion deducts one regardless of repair count; completed replay deducts nothing',async()=>{
   const {run}=await store.startRun(user,chats[0],randomUUID(),'Synthetic repaired turn')
   const usage={llmCallCount:2,repairCalls:1}
   await store.finishRun(run,staged(),'Synthetic complete',usage,new AbortController().signal,'direct',2)
   assert.equal((await entitlementView(user) as any).used,1)
   assert.equal((await entitlementView(user) as any).reserved,0)
   const replay=await store.startRun(user,chats[0],run.request_id,'Synthetic repaired turn')
   assert.equal(replay.replay,true);assert.equal(replay.run.status,'completed')
   await store.terminateRun(user,run.request_id,'cancelled','LATE_DISCONNECT')
   assert.equal((await entitlementView(user) as any).used,1)
   await assert.rejects(store.finishRun(run,staged(),'Duplicate',usage,new AbortController().signal),(e:any)=>e.code==='RUN_NO_LONGER_ACTIVE')
   await assert.rejects(grantEntitlement(user,0,expires()),/GRANT_BELOW/)
  })
  await t.test('failure, cancellation, recovery and stale access leave no charge; regrant never resets consumption',async()=>{
   await grantEntitlement(user,2,expires())
   for(const status of ['failed','cancelled'] as const){const {run}=await store.startRun(user,chats[0],randomUUID(),'Synthetic failed');await store.terminateRun(user,run.request_id,status,'SYNTHETIC');assert.equal((await entitlementView(user) as any).remaining,1)}
   const {run}=await store.startRun(user,chats[0],randomUUID(),'Synthetic revoked during response')
   await pool.query('UPDATE lifeos_entitlements SET enabled=false WHERE user_id=$1',[user])
   await assert.rejects(store.finishRun(run,staged(),'Not committed',null,new AbortController().signal),(e:any)=>e.code==='ACCESS_CHANGED')
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,run.request_id])).rows[0].n,0)
   await store.terminateRun(user,run.request_id,'failed','ACCESS_CHANGED')
   await grantEntitlement(user,2,expires());assert.equal((await entitlementView(user) as any).used,1)
   const crashed=await store.startRun(user,chats[0],randomUUID(),'Synthetic crash')
   await pool.query("UPDATE runs SET status='failed',error_code='SERVER_RESTARTED',finished_at=now() WHERE user_id=$1 AND request_id=$2 AND status='running'",[user,crashed.run.request_id])
   assert.equal((await entitlementView(user) as any).remaining,1)
   assert.equal((await entitlementView(other) as any).enabled,false)
  })
  await t.test('trusted account CLI creates a usable auth account and grants/revokes without exposing a password or token',async()=>{
   const email='access-cli-'+randomUUID()+'@example.invalid',password='Synthetic-'+randomUUID()
   const args=['--import','tsx','--import','./scripts/backend-test-preload.ts','scripts/manage-access.ts']
   const invoke=(operation:string,rest:string[]=[],input?:string)=>spawnSync(process.execPath,[...args,operation,...rest],{env:{...process.env,LIFEOS_ISOLATED_TEST_DATABASE_URL:config.databaseUrl},input,encoding:'utf8',timeout:15000,windowsHide:true})
   const created=invoke('create',[],JSON.stringify({email,password,limit:2,expiresAt:expires()}))
   assert.equal(created.status,0,created.stderr)
   assert.ok(!created.stdout.includes(password));assert.ok(!created.stdout.includes('"token"'))
   const value=JSON.parse(created.stdout);assert.equal(value.access.limit,2)
   try{
    const {auth}=await import('../../server/auth.ts')
    const login=await auth.api.signInEmail({body:{email,password}})
    assert.equal(login.user.id,value.userId)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM account WHERE "userId"=$1 AND "providerId"=$2',[value.userId,'credential'])).rows[0].n,1)
    const revoked=invoke('revoke',[value.userId]);assert.equal(revoked.status,0,revoked.stderr)
    assert.equal(JSON.parse(revoked.stdout).access.enabled,false)
    const grant=invoke('grant',[value.userId,'3',expires()]);assert.equal(grant.status,0,grant.stderr)
    assert.equal(JSON.parse(grant.stdout).access.limit,3)
   }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[value.userId])}
  })
  await t.test('actual auth/HTTP denies unopened generation and preserves browsing and authenticated remaining amount',async()=>{
   let calls=0
   const engine:Engine=async()=>{calls++;return {text:'Synthetic HTTP response',usage:null}}
   const app=createApp(engine);await new Promise<void>(r=>app.listen(0,'127.0.0.1',r))
   const base='http://127.0.0.1:'+(app.address() as any).port
   const request=(path:string,cookie='',body?:unknown)=>fetch(base+path,{method:body?'POST':'GET',headers:{Origin:config.origin,Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})
   let id:string|undefined
   try{
    const signup=await request('/api/auth/sign-up/email','',{email:'access-http-'+randomUUID()+'@example.invalid',name:'Synthetic',password:'Synthetic-'+randomUUID()})
    assert.equal(signup.status,200)
    const cookie=signup.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
    id=(await (await request('/api/session',cookie)).json()).id
    assert.equal((await request('/api/access')).status,401)
    assert.equal((await (await request('/api/access',cookie)).json()).enabled,false)
    const chat=randomUUID();assert.equal((await request('/api/conversations',cookie,{id:chat,title:'Synthetic HTTP'})).status,201)
    const rejected=await request('/api/conversations/'+chat+'/messages',cookie,{requestId:randomUUID(),text:'Synthetic blocked'})
    assert.equal(rejected.status,403);assert.equal(calls,0)
    await grantEntitlement(id!,1,expires())
    const requestId=randomUUID(),body={requestId,text:'Synthetic allowed'}
    const first=await request('/api/conversations/'+chat+'/messages',cookie,body);assert.equal(first.status,200);await first.text()
    assert.equal(calls,1)
    const replay=await request('/api/conversations/'+chat+'/messages',cookie,body);assert.match(await replay.text(),/replayed/);assert.equal(calls,1)
    assert.equal((await (await request('/api/access',cookie)).json()).used,1)
    assert.equal((await request('/api/conversations',cookie)).status,200)
    assert.equal((await request('/api/conversations/'+chat+'/messages',cookie,{requestId:randomUUID(),text:'Synthetic exhausted'})).status,429)
   }finally{await app.drain();await new Promise<void>(r=>app.close(()=>r()));if(id){await pool.query('DELETE FROM conversations WHERE user_id=$1',[id]);await pool.query('DELETE FROM "user" WHERE id=$1',[id])}}
  })
 }finally{
  config.entitlementsEnabled=previous
  await pool.query('DELETE FROM conversations WHERE user_id=ANY($1::text[])',[[user,other]])
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[[user,other]])
 }
})
