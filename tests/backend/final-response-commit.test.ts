import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {repairReviewedDefects} from '../../server/review-repairs.ts'

test('final79 zero-time response commits the same complete reply after the final boundary',async()=>{
 const captured=readFileSync(new URL('../fixtures/final79-zero-time-mismatch.json',import.meta.url),'utf8').replace(/^\uFEFF/,'')
 const user='final79-replay-'+randomUUID(),chat=randomUUID()
 const previous={url:model.baseUrl,key:config.apiKey,budget:config.providerBudgetEnabled,encode:localEmbedding.encode}
 localEmbedding.encode=async texts=>texts.map(()=>Array(512).fill(0))
 config.providerBudgetEnabled=false
 let calls=0,currentSource=''
 const fake=createServer((req,res)=>{req.on('data',()=>{});req.on('end',()=>{
  calls++
  const content=captured.replaceAll('23e6eab0-5996-4833-8f41-7f2452b81ffc',currentSource)
  const base={id:'synthetic-final79-replay',object:'chat.completion.chunk',created:1,model:model.id}
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(done=>fake.listen(0,'127.0.0.1',done))
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-final79-only'
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC final response commit'})
  const run=(await store.startRun(user,chat,randomUUID(),'现在我愿意厘清一点，但本周可用时间是零。老师没回复只是结果未知，不等于拒绝我。')).run
  currentSource=run.source_message_id
  const staged:store.Staged={candidates:[],audit:[]},signal=new AbortController().signal
  const result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
  assert.equal(calls,1)
  assert.ok(staged.coach,'the captured failure must exercise the event commit lane')
  assert.doesNotMatch(result.text,/[？?]/)
  assert.match(result.text,/未知/)
  const committed=await store.finishRun(run,staged,result.text,result.usage,signal)
  assert.equal(committed.requestId,run.request_id)
  const messages=(await store.listConversations(user))[0].messages
  assert.equal(messages.find((message:{role:string;content:string})=>message.role==='assistant')?.content,result.text)
 }finally{
  fake.closeAllConnections();await new Promise<void>(done=>fake.close(()=>done()))
  model.baseUrl=previous.url;config.apiKey=previous.key;config.providerBudgetEnabled=previous.budget;localEmbedding.encode=previous.encode
  await pool.end()
 }
})

test('an explicit one-position request bounds position-description counts and the stop condition',()=>{
 const user='我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。给一个边界清楚的小行动。'
 const reply='挑3个职位描述，只看沟通频率和交付节奏。做完这3个就停。'
 const fixed=repairReviewedDefects(reply,user)?.reply??reply
 assert.doesNotMatch(fixed,/3个/)
 assert.match(fixed,/一个岗位描述/)
 const multiple='我愿意看3个职位描述，比较会议节奏。'
 assert.equal(repairReviewedDefects(reply,multiple)?.reply??reply,reply)
})
