import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createApp} from '../../server/http.ts'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import type {Engine} from '../../server/agent.ts'
import {loadSnapshot} from '../../server/memory.ts'

test.after(async()=>{await localEmbedding.close();await pool.end()})

test('independent snapshot reads overlap without bypassing conversation ownership',async()=>{
 const actor=randomUUID(),conversation=randomUUID(),query=pool.query.bind(pool)
 await query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',[actor,'Synthetic latency',actor+'@example.invalid'])
 await query('INSERT INTO conversations(id,user_id,title) VALUES($1,$2,$3)',[conversation,actor,'Synthetic read timing'])
 let pending=0,peak=0
 try{
  pool.query=((...args:any[])=>{
   const sql=typeof args[0]==='string'?args[0]:''
   if(sql.startsWith('SELECT source_message_id,key FROM memory_suppressions')||sql.startsWith('SELECT source_message_id FROM experiences')||sql.startsWith('SELECT e.user_id,e.id,e.revision,e.content')){
    pending++;peak=Math.max(peak,pending)
    return new Promise(ok=>setTimeout(ok,20)).then(()=>query(...args as [any])).finally(()=>pending--)
   }
   return query(...args as [any])
  }) as typeof pool.query
  const snapshot=await loadSnapshot(actor,conversation,'只讨论，不修改档案。')
  assert.equal(peak,3,'independent reads were serialized before first model output')
  assert.deepEqual(snapshot.profile,[]);assert.deepEqual(snapshot.confirmedExperiences,[])
  await assert.rejects(loadSnapshot(randomUUID(),conversation,'test'),(e:any)=>e.code==='NOT_FOUND')
 }finally{pool.query=query as typeof pool.query;await query('DELETE FROM "user" WHERE id=$1',[actor])}
})

test('committed full streamed reply reaches client before health telemetry completes',async()=>{
 const full='### 个人依据\n'+('完整内容与仍未知的条件。\n'.repeat(240))
 const engine:Engine=async({staged,emit})=>{
  emit({type:'draft',text:full.slice(0,120),draftKind:'stream_reply',saved:false})
  emit({type:'draft',text:full,draftKind:'stream_reply',saved:false})
  staged.upstreamCalls=1
  return {text:full,usage:{source:'simulated',llmCallCount:0}}
 }
 engine.modelManaged=true;engine.modelReadiness=()=>true
 const oldOrigin=config.origin,oldAccess=config.entitlementsEnabled,oldSignup=config.signupEnabled
 const app=createApp(engine)
 await new Promise<void>(ok=>app.listen(0,'127.0.0.1',ok))
 const origin='http://127.0.0.1:'+(app.address() as {port:number}).port
 config.origin=origin;config.entitlementsEnabled=false;config.signupEnabled=true
 const query=pool.query.bind(pool)
 let release!:()=>void,started!:()=>void
 const gate=new Promise<void>(ok=>release=ok),telemetryStarted=new Promise<void>(ok=>started=ok)
 let actor:string|undefined
 try{
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic latency',email:randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID()})})
  assert.equal(signup.status,200);actor=(await signup.json() as any).user.id
  const headers={Cookie:signup.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),Origin:origin,'Content-Type':'application/json'}
  const id=randomUUID(),requestId=randomUUID()
  assert.equal((await fetch(origin+'/api/conversations',{method:'POST',headers,body:JSON.stringify({id,title:'Synthetic latency'})})).status,201)
  pool.query=((...args:any[])=>{
   if(typeof args[0]==='string'&&args[0].startsWith('UPDATE lifeos_model_state SET error_code=NULL')){started();return gate.then(()=>query(...args as [any]))}
   return query(...args as [any])
  }) as typeof pool.query
  const response=await fetch(origin+'/api/conversations/'+id+'/messages',{method:'POST',headers,body:JSON.stringify({requestId,text:'只讨论，不修改档案。'})})
  const body=response.text()
  await telemetryStarted
  // The gate cannot be released by successful telemetry: completion must be
  // owned by the committed business transaction, not this unrelated update.
  let timer:ReturnType<typeof setTimeout>|undefined
  const result=await Promise.race([body,new Promise<null>(ok=>{timer=setTimeout(()=>ok(null),500)})])
  clearTimeout(timer);release()
  assert.notEqual(result,null,'saved SSE stream is blocked by health telemetry')
  const frames=result!.split('\n').filter(s=>s.startsWith('data: ')).map(s=>JSON.parse(s.slice(6)))
  assert.equal(frames.find(f=>f.type==='delta').text,full)
  assert.equal(frames.filter(f=>f.type==='draft').length,2)
  assert.ok(frames.some(f=>f.type==='done'))
  const rows=await query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[actor,requestId])
  assert.equal(rows.rows[0]?.content,full)
 }finally{
  release();pool.query=query as typeof pool.query
  await new Promise<void>(ok=>app.close(()=>ok()))
  config.origin=oldOrigin;config.entitlementsEnabled=oldAccess;config.signupEnabled=oldSignup
  if(actor)await query('DELETE FROM "user" WHERE id=$1',[actor])
 }
})
