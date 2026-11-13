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
test('ordinary progressive replies do not generate a hidden duplicate lead before reply',async()=>{
 const base=model.baseUrl,key=config.apiKey,encode=localEmbedding.encode.bind(localEmbedding)
 localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
 const payloads:any[]=[]
 const reply='先把探索和最终选择分开。\n\n**已有依据与未知**\n'+('可从一次实际体验获取选择证据，未报告的条件仍需保留未知。'.repeat(12))
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  payloads.push(JSON.parse(Buffer.concat(chunks).toString()));res.writeHead(200,{'Content-Type':'text/event-stream'})
  const env={id:'synthetic-no-hidden-lead',object:'chat.completion.chunk',created:1,model:model.id}
  const text=JSON.stringify({reply});let offset=0
  const timer=setInterval(()=>{if(offset<text.length){res.write('data: '+JSON.stringify({...env,choices:[{index:0,delta:{content:text.slice(offset,offset+40)},finish_reason:null}]})+'\n\n');offset+=40}else{clearInterval(timer);res.end('data: '+JSON.stringify({...env,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n')}},90)
 })})
 await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-fast-first-reply'
 const actor='fast-'+randomUUID(),chat=randomUUID()
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
  await store.createConversation(actor,{id:chat,title:'SYNTHETIC fast reply'})
  const text='我想探索接下来可能的发展方向，请给我一些分析和建议。只讨论，不修改档案，不创建任务或经历。'
  const run=(await store.startRun(actor,chat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]},events:any[]=[]
  const signal=AbortSignal.timeout(20000),result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:e=>events.push(e)})
  assert.equal(payloads.length,1)
  const schema=payloads[0].response_format.json_schema.schema
  assert.deepEqual(Object.keys(schema.properties),['reply'],'explicit analysis-only requests must not transmit discarded write protocols')
  assert.equal(Object.hasOwn(schema.properties,'lead'),false,'hidden lead delays first actual reply and duplicates its first sentence')
  assert.ok(!payloads[0].messages.filter((m:any)=>m.role==='system').map((m:any)=>m.content).join('').includes('先输出lead，逐字作为reply首句'))
  assert.ok(schema.properties.reply.maxLength>=reply.length,'do not speed up by truncating answers')
  const drafts=events.filter(e=>e.type==='draft');assert.ok(drafts.length>=2)
  for(let i=1;i<drafts.length;i++)assert.ok(drafts[i].text.startsWith(drafts[i-1].text))
  await store.finishRun(run,staged,result.text,result.usage,signal)
  assert.equal((await store.listConversations(actor,false))[0].messages.at(-1).content,reply)
  for(const table of ['experiences','growth_items','memory_items','user_themes'])assert.equal((await pool.query('SELECT count(*) FROM '+table+' WHERE user_id=$1',[actor])).rows[0].count,'0')
 }finally{model.baseUrl=base;config.apiKey=key;localEmbedding.encode=encode;await pool.query('DELETE FROM "user" WHERE id=$1',[actor]);await new Promise<void>(ok=>fake.close(()=>ok()))}
})
