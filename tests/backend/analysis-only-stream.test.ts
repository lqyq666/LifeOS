import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {createApp} from '../../server/http.ts'
test.after(async()=>{await localEmbedding.close();await pool.end()})
test('analysis-only turns persist chat and progressive drafts without mutating personal records',async()=>{
 const base=model.baseUrl,key=config.apiKey,encode=localEmbedding.encode.bind(localEmbedding)
 localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
 let calls=0
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  const payload=JSON.parse(Buffer.concat(chunks).toString());assert.deepEqual(Object.keys(payload.response_format.json_schema.schema.properties),['reply']);calls++;res.writeHead(200,{'Content-Type':'text/event-stream'})
  const env={id:'synthetic-analysis-stream',object:'chat.completion.chunk',created:1,model:model.id}
  const text=JSON.stringify({reply:'先把三条道路作为比较对象。\n\n**值得验证的条件**\n独立产品需要真实需求证据；实习就业需要协作体验；科研探索需要过程兴趣。它们都还不是你的最终选择。示例编号：'+calls+'。'})
  let offset=0
  const timer=setInterval(()=>{if(offset<text.length){res.write('data: '+JSON.stringify({...env,choices:[{index:0,delta:{content:text.slice(offset,offset+24)},finish_reason:null}]})+'\n\n');offset+=24}else{clearInterval(timer);res.end('data: '+JSON.stringify({...env,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n')}},100)
 })})
 await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok))
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-analysis-only'
 const actor='analysis-'+randomUUID(),chat=randomUUID()
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
  await store.createConversation(actor,{id:chat,title:'SYNTHETIC analysis only'})
  for(const text of ['请完整写一份大学生比较独立AI产品、AI相关实习、专业与AI交叉科研三条道路的说明。只分析，不修改档案，不创建任务或经历。','请写一份完整、可读的说明：大学生如何比较三条道路。这只是分析，不修改档案，不创建任务或经历。','我想认真想一想，未来该往哪里走。为什么值得我考虑，依据我说过的哪件事。不修改档案或创建任务。','只分析，不修改我的目标或创建任务。','只给建议，不代表我已经接受、执行或完成，不创建任务或经历。','不要把建议记录成我的行动或经历，不修改档案。']){
   const run=(await store.startRun(actor,chat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]},events:any[]=[]
   const signal=AbortSignal.timeout(20000),result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:e=>events.push(e)})
   await store.finishRun(run,staged,result.text,result.usage,signal)
   const drafts=events.filter(e=>e.type==='draft'&&e.draftKind==='stream_reply')
   assert.ok(drafts.length>=2,'multiple live draft updates, not one opening sentence')
   assert.ok(drafts.at(-1).text.length>drafts[0].text.length)
   const visibleDrafts=events.filter(e=>e.type==='draft');for(let i=1;i<visibleDrafts.length;i++)assert.ok(visibleDrafts[i].text.startsWith(visibleDrafts[i-1].text),'ordinary reply never retracts a separate lead preview')
   for(const table of ['experiences','growth_items','memory_items','user_themes'])assert.equal((await pool.query('SELECT count(*) FROM '+table+' WHERE user_id=$1',[actor])).rows[0].count,'0',table)
  }
  assert.equal(calls,6)
  const fast=await store.listConversations(actor,false),full=await store.listConversations(actor)
  assert.deepEqual(fast[0].messages.map((m:any)=>m.content),full[0].messages.map((m:any)=>m.content))
  assert.equal(fast[0].messages.length,12)
  const oldOrigin=config.origin,oldAccess=config.entitlementsEnabled
  const app=createApp(createTurnEngine({capabilityVerified:()=>true}));await new Promise<void>(ok=>app.listen(0,'127.0.0.1',ok))
  const origin='http://127.0.0.1:'+(app.address() as {port:number}).port;config.origin=origin;config.entitlementsEnabled=false
  try{
   const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic stream',email:randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID()})})
   assert.equal(signup.status,200)
   const cookie=signup.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),id=randomUUID()
   const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json'}
   assert.equal((await fetch(origin+'/api/conversations',{method:'POST',headers,body:JSON.stringify({id,title:'Synthetic HTTP stream'})})).status,201)
   const response=await fetch(origin+'/api/conversations/'+id+'/messages',{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),text:'只分析三条道路，不修改档案，不创建任务或经历。'})})
   const frames=(await response.text()).split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)))
   assert.ok(frames.filter(e=>e.type==='draft').length>=2,'progressive reply crosses real HTTP SSE boundary')
   for(const stage of ['context','generating','validating','saving'])assert.ok(frames.some(e=>e.type==='progress'&&e.stage===stage),stage)
   assert.ok(frames.some(e=>e.type==='done'))
   assert.equal(calls,7)
  }finally{config.origin=oldOrigin;config.entitlementsEnabled=oldAccess;await new Promise<void>(ok=>app.close(()=>ok()))}
 }finally{model.baseUrl=base;config.apiKey=key;localEmbedding.encode=encode;await pool.query('DELETE FROM "user" WHERE id=$1',[actor]);await new Promise<void>(ok=>fake.close(()=>ok()))}
})
