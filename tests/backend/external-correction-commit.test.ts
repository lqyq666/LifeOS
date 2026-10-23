import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {stageCoachEvent,coachEventView} from '../../server/action-coach-events.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test.after(async()=>{await pool.end()})
test('the captured wrong-node family correction preserves the original preference through commit',async()=>{
 const actor='external-correction-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
 const previous={url:model.baseUrl,key:config.apiKey,budget:config.providerBudgetEnabled,encode:localEmbedding.encode}
 localEmbedding.encode=async texts=>texts.map(()=>Array(512).fill(0));config.providerBudgetEnabled=false
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
 await store.createConversation(actor,{id:chat,title:'SYNTHETIC external correction scope'})
 const old='我并不享受考试本身',seed=(await store.startRun(actor,chat,randomUUID(),old)).run
 const staged=await stageCoachEvent(seed,{target:{operation:'create',title:'读研选择',source:{messageId:seed.source_message_id,quote:old}},nodes:[{kind:'fact',source:{messageId:seed.source_message_id,quote:old}}]},'保留你的考试偏好。')
 await store.finishRun(seed,{candidates:[],audit:[],coach:staged},'保留你的考试偏好。',null,signal)
 const event=(await coachEventView(actor,chat))!,node=event.nodes.find(n=>n.content===old)!
 const run=(await store.startRun(actor,chat,randomUUID(),'更正：家里没有要求我必须本校读研，只是希望稳定。请只重开受这条更正影响的判断，并给一个四小时内的小验证。')).run
 const quote='更正：家里没有要求我必须本校读研'
 const delta={target:{operation:'continue' as const,eventId:event.id,expectedRevision:event.revision},corrections:[{nodeId:node.id,source:{messageId:run.source_message_id,quote}}]}
 await assert.rejects(()=>stageCoachEvent(run,delta,'已更正。'),(error:any)=>error.code==='COACH_CORRECTION_SUBJECT_MISMATCH')
 let calls=0
 const fake=createServer((req,res)=>{req.on('data',()=>{});req.on('end',()=>{
  calls++;const raw=JSON.stringify({reply:'家里的本校要求已更正；不享受考试本身这一点不变。先核对一个公开院校的招生要求，总投入不超过四小时。',event:delta})
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'synthetic-scope',object:'chat.completion.chunk',created:1,model:model.id,choices:[{index:0,delta:{content:raw},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(done=>fake.listen(0,'127.0.0.1',done));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-scope-only'
 try{
  const pending:store.Staged={candidates:[],audit:[]}
  const reply=await createTurnEngine({capabilityVerified:()=>true})({run,staged:pending,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
  await store.finishRun(run,pending,reply.text,reply.usage,signal)
  const saved=(await coachEventView(actor,chat))!
  assert.equal(saved.nodes.find(n=>n.id===node.id)?.content,old)
  assert.ok(saved.nodes.some(n=>n.content===quote&&n.id!==node.id))
  assert.equal(calls,1,'normalization uses no retry')
 }finally{
  fake.closeAllConnections();await new Promise<void>(done=>fake.close(()=>done()))
  model.baseUrl=previous.url;config.apiKey=previous.key;config.providerBudgetEnabled=previous.budget;localEmbedding.encode=previous.encode
 }
})
