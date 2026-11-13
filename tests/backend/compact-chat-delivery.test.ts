import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createApp} from '../../server/http.ts'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import type {Engine} from '../../server/agent.ts'
import {committedTurn} from '../../src/backend/client.ts'
import {emptyConversation} from '../../src/features/conversation/flow.ts'

test.after(async()=>{await localEmbedding.close();await pool.end()})

test('normal HTTP streaming preserves long replies and committed IDs with less wire data',async()=>{
 const full='### 完整依据\n'+('**条件**：保留全部信息、引号“未知”和🙂。\n'.repeat(160))
 const engine:Engine=async({context,emit})=>{
  if(context.at(-1)?.content.includes('重组')){
   emit({type:'draft',text:'第一种临时表述。',draftKind:'stream_reply',saved:false})
   emit({type:'draft',text:'重组后的临时表述。',draftKind:'stream_reply',saved:false})
   emit({type:'draft_discarded'})
  }
  for(let i=1;i<=80;i++)emit({type:'draft',text:full.slice(0,Math.ceil(full.length*i/80)),draftKind:'stream_reply',saved:false})
  return {text:full,usage:{source:'simulated',llmCallCount:0}}
 }
 engine.modelManaged=true;engine.modelReadiness=()=>true
 const oldOrigin=config.origin,oldAccess=config.entitlementsEnabled,oldSignup=config.signupEnabled
 const app=createApp(engine);await new Promise<void>(ok=>app.listen(0,'127.0.0.1',ok))
 const origin='http://127.0.0.1:'+(app.address() as {port:number}).port
 config.origin=origin;config.entitlementsEnabled=false;config.signupEnabled=true
 let actor:string|undefined
 try{
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic delivery',email:randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID()})})
  assert.equal(signup.status,200);actor=(await signup.json() as any).user.id
  const headers={Cookie:signup.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),Origin:origin,'Content-Type':'application/json'}
  const sizes:number[]=[]
  for(const mode of ['legacy','incremental','重组','normal-write-capable']){
   const conversationId=randomUUID(),requestId=randomUUID(),input=mode==='normal-write-capable'?'你好。':mode+'：只讨论，不修改档案。'
   assert.equal((await fetch(origin+'/api/conversations',{method:'POST',headers,body:JSON.stringify({id:conversationId,title:'完整长回复验证'})})).status,201)
   const response=await fetch(origin+'/api/conversations/'+conversationId+'/messages',{method:'POST',headers:{...headers,...(mode!=='legacy'?{'X-LifeOS-Draft-Deltas':'1'}:{})},body:JSON.stringify({requestId,text:input})})
   const wire=await response.text(),frames=wire.split('\n').filter(s=>s.startsWith('data: ')).map(s=>JSON.parse(s.slice(6)))
   sizes.push(Buffer.byteLength(wire));let preview=''
   for(const frame of frames){if(frame.type==='draft')preview=frame.append?preview+frame.text:frame.text;if(frame.type==='draft_discarded')preview=''}
   assert.equal(preview,full);assert.equal(frames.find(e=>e.type==='delta')?.text,full)
   const done=frames.find(e=>e.type==='done');assert.ok(done)
   if(mode==='legacy')assert.ok(!frames.some(e=>e.append));else assert.ok(frames.some(e=>e.append===true))
   const messages=(await pool.query('SELECT id,role,content FROM messages WHERE user_id=$1 AND run_request_id=$2',[actor,requestId])).rows
   assert.equal(messages.find(m=>m.role==='assistant')?.content,full)
   assert.equal(done.commitReceipt.assistantMessageId,messages.find(m=>m.role==='assistant')?.id)
   const sourceId=messages.find(m=>m.role==='user')?.id
   assert.equal(done.commitReceipt.userMessageId,sourceId)
   const accepted=committedTurn(emptyConversation(),{conversationId,requestId,sourceId,text:input,reply:full,savedDelta:true},done)
   if(mode==='normal-write-capable'){assert.equal(done.commitReceipt.refreshRequired,true);assert.equal(accepted,null)}else{assert.equal(done.commitReceipt.refreshRequired,false);assert.equal(accepted?.conversation.messages[1].text,full)}
  }
  assert.ok(sizes[1]!<sizes[0]!*.12,'transfer is smaller while final content and DB state are identical')
  console.info(JSON.stringify({scope:'SIMULATED_IDENTICAL_LONG_REPLY_HTTP',legacyBytes:sizes[0],incrementalBytes:sizes[1],replyChars:full.length}))
 }finally{await new Promise<void>(ok=>app.close(()=>ok()));config.origin=oldOrigin;config.entitlementsEnabled=oldAccess;config.signupEnabled=oldSignup;if(actor)await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
})
