import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createApp} from '../../server/http.ts'
import {config} from '../../server/config.ts'
import {collectReplyMemoryReferences} from '../../server/reply-memory-references.ts'

test.after(async()=>{await pool.end()})
test('saved per-reply references survive refresh but never expose another owner or forgotten facts',async()=>{
 const app=createApp();await new Promise<void>(resolve=>app.listen(0,'127.0.0.1',resolve))
 const origin='http://127.0.0.1:'+(app.address() as {port:number}).port,oldOrigin=config.origin;config.origin=origin
 async function signup(){const response=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic source owner',email:randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID()})});assert.equal(response.status,200);return {id:(await response.json()).user.id,cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')}}
 try{
  const one=await signup(),two=await signup(),chat=randomUUID(),memoryId=randomUUID()
  await store.createConversation(one.id,{id:chat,title:'Synthetic reference receipt'})
  const run=(await store.startRun(one.id,chat,randomUUID(),'我的专业是电气相关专业。这次只讨论，不修改档案。')).run
  await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1)',[one.id])
  await pool.query(`INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','education.major',$3,'user_reported','user',$4,now(),now(),'active')`,[memoryId,one.id,JSON.stringify('电气相关专业'),JSON.stringify([{type:'message',conversationId:chat,messageId:run.source_message_id,quote:'我的专业是电气相关专业'}])])
  const refs=collectReplyMemoryReferences(JSON.stringify({knownProfile:[{id:memoryId,revision:1}],confirmedExperiences:[],growth:[],growthBackground:[]}));assert.equal(refs.length,1)
  await store.finishRun(run,{candidates:[],audit:[],memoryReferences:refs},'**已有依据**\n专业背景已知，研究兴趣仍待验证。',{},new AbortController().signal)
  const saved=(await store.listConversations(one.id,false))[0].messages.find((m:any)=>m.role==='assistant');assert.ok(saved);assert.equal(saved.memory_reference_count,1)
  const path='/api/messages/'+saved.id+'/memory-references'
  const request=(cookie:string)=>fetch(origin+path,{headers:{Cookie:cookie}})
  assert.equal((await request(two.cookie)).status,404)
  const view=await(await request(one.cookie)).json();assert.equal(view.items.length,1);assert.equal(view.items[0].text,'电气相关专业')
  await pool.query("UPDATE memory_items SET status='superseded',revision=2 WHERE id=$1",[memoryId])
  const changed=await(await request(one.cookie)).json();assert.deepEqual(changed.items,[]);assert.equal(changed.unavailableCount,1);assert.ok(!JSON.stringify(changed).includes('电气相关专业'))
  await pool.query('UPDATE user_memory_settings SET enabled=false,revision=2 WHERE user_id=$1',[one.id])
  assert.deepEqual((await(await request(one.cookie)).json()).items,[])
  await pool.query("UPDATE runs SET response=response-'memoryReferences' WHERE request_id=$1",[run.request_id])
  const historical=await(await request(one.cookie)).json();assert.equal(historical.recorded,false);assert.deepEqual(historical.items,[])
  await store.deleteConversation(one.id,chat)
  assert.equal((await request(one.cookie)).status,404)
 }finally{config.origin=oldOrigin;app.closeAllConnections();await new Promise<void>(resolve=>app.close(()=>resolve()))}
})
