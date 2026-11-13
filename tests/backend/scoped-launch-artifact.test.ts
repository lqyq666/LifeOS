import test from 'node:test'
import {createServer} from 'node:http'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {Value} from 'typebox/value'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {stageGrowthUpdates,growthContext} from '../../server/growth.ts'
import {coachEventView} from '../../server/action-coach-events.ts'

test('R4 actual failures: fully supplied questions and unique sourced contributions persist through the current zero-or-one-call normal contract',async()=>{
 const old={url:model.baseUrl,key:config.apiKey};let calls=0
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  calls++;const p=JSON.parse(Buffer.concat(chunks).toString()),ctx=JSON.parse(p.messages[1].content),text=p.messages.at(-1).content.split('\n\n本轮来源边界')[0],schema=p.response_format.json_schema.schema
  const reply=text.includes('排课信息')?'你上一次查排课信息时，用了什么具体办法？':'课程项目如何呈现实习所需能力？'
  const clause=ctx.currentUserMessage.clauses.find((candidate:any)=>text.includes(candidate.text))??ctx.currentUserMessage.clauses[0]
  const target={operation:'create',title:'合成材料',source:{clauseId:clause.id}}
  const candidates=[{reply},{reply,event:{target,action:{operation:'create',draft:{fromReply:true}}}},{reply:'',event:{target,action:{operation:'create',draft:{content:reply}}}},{reply,event:{target,action:{operation:'create',draft:{content:reply}}}}]
  const output=candidates.find(candidate=>Value.Check(schema,candidate));if(!output){console.error('SYNTHETIC_SCHEMA',JSON.stringify(candidates.map(candidate=>[...Value.Errors(schema,candidate)].map(x=>({path:x.instancePath,message:x.message}))))) ;res.writeHead(500);res.end('SYNTHETIC_SCHEMA_MISMATCH');return}
  const frame={id:'synthetic-artifact',object:'chat.completion.chunk',created:1,model:model.id};res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({...frame,choices:[{index:0,delta:{content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...frame,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}})+'\n\ndata: [DONE]\n\n')
 })});await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));model.baseUrl='http://127.0.0.1:'+(fake.address() as any).port;config.apiKey='synthetic-loopback-only'
 try{
 await localEmbedding.start();const user='artifact-'+randomUUID(),chat=randomUUID()
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0});await store.createConversation(user,{id:chat,title:'SYNTHETIC artifact'})
 const seed=(await store.startRun(user,chat,randomUUID(),'我负责文字和排版。')).run
 const growth=await stageGrowthUpdates(seed,[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{messageId:seed.source_message_id,quote:'我负责文字和排版'}}],[],{})
 await store.finishRun(seed,{candidates:[],audit:[],growth},'本人分工报告。',null,new AbortController().signal)
 const turn=async(text:string)=>{const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC new artifact session'});const run=(await store.startRun(user,conversation,randomUUID(),text)).run,input={run,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}};const before=calls;const r=await createTurnEngine({capabilityVerified:()=>true})(input);await store.finishRun(run,input.staged,r.text,r.usage,input.signal);assert.equal((r.usage as {llmCallCount:number}).llmCallCount,calls-before);assert.ok(calls-before<=1);const event=await coachEventView(user,conversation);if(event?.actions[0]?.draft)assert.equal(event.actions[0].draft.content,r.text.split('\n\n').at(-1));assert.equal((await store.listConversations(user)).find(x=>x.id===conversation)!.messages.at(-1)!.content,r.text);return {r,conversation}}
 const question=await turn('把这个问题压成一句：我想了解课程项目如何呈现实习所需能力。')
 assert.match(question.r.text,/课程项目如何呈现实习所需能力？/);assert.ok(!question.r.text.includes('学长您好'))
 const edited=await turn('把这个问题改成：你上一次查排课信息时，用了什么具体办法？不要代替同学回答。')
 assert.match(edited.r.text,/你上一次查排课信息时，用了什么具体办法？/)
 const own=await turn('把我负责的文字和排版写成一句实习作品描述，不添加插画能力。')
 assert.match(own.r.text,/我负责文字和排版。/);assert.ok(!own.r.text.includes('视觉呈现'))
 assert.ok((await growthContext(user,own.conversation)).some(x=>x.text==='我负责文字和排版'))
 }finally{model.baseUrl=old.url;config.apiKey=old.key;fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()))}
})
test.after(async()=>{await localEmbedding.close();await pool.end()})
