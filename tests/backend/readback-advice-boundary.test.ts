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
import {setMemorySettings} from '../../server/memory.ts'
import {createGrowthItem,growthView} from '../../server/growth.ts'

test.after(async()=>{await localEmbedding.close();await pool.end()})
test('public failure: refusing advice does not replace a cross-session factual readback with listening',async()=>{
 const encode=localEmbedding.encode.bind(localEmbedding),base=model.baseUrl,key=config.apiKey
 localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
 const requests:any[]=[],reply='你现在读信息管理，小组里负责资料整理和排版；代码由队友完成，不计在你名下。'
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  requests.push(JSON.parse(Buffer.concat(chunks).toString()))
  const envelope={id:'synthetic-public-readback',object:'chat.completion.chunk',created:1,model:model.id}
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify({reply})},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:40,total_tokens:160,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok))
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-public-readback-key'
 const actor='readback-boundary-'+randomUUID(),chats=[randomUUID(),randomUUID()]
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
  await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  for(const id of chats)await store.createConversation(actor,{id,title:'SYNTHETIC public readback boundary'})
  for(const text of ['我读的是信息管理','我负责资料整理和排版','代码由队友完成'])await createGrowthItem(actor,{requestId:randomUUID(),conversationId:chats[0]!,kind:'context',text})
  const before=JSON.stringify((await growthView(actor,chats[1]!)).items)
  for(const text of ['请只读回我现在的专业，以及我本人负责的小组工作；不要给建议或更改记录。','不要给建议，请读回我之前报告的专业。','这是一个全新对话。请从你已经保存的资料里简短说出：我的学校、年级、专业，我在做什么产品，以及我最看重的三件事。没有依据的不要猜，也先别给建议。','这是另一个新会话。请只读回我现在的学校、年级、专业类别，以及LifeOS演示准备的最新进展：我本人提供了什么，哪些由Codex代执行，视频和真实学生效果是否已经完成验证。不要修改档案。']){
  const run=(await store.startRun(actor,chats[1]!,randomUUID(),text)).run
  const staged:store.Staged={candidates:[],audit:[]},signal=AbortSignal.timeout(20000)
  const result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
  await store.finishRun(run,staged,result.text,result.usage,signal)
  assert.ok(result.text.endsWith(reply),'the final answer must contain the requested factual readback')
  assert.doesNotMatch(result.text,/我在听|你接着说/,'refusing advice must not turn a factual request into listening')
  const properties=requests.at(-1).response_format.json_schema.schema.properties
  for(const field of ['growthUpdates','event','experienceCandidate','weeklyPlan'])assert.equal(properties[field],undefined,'read-only schema excludes '+field)
  const sent=JSON.stringify(requests[0].messages)
  for(const fact of ['信息管理','资料整理和排版','代码由队友完成'])assert.ok(sent.includes(fact))
  assert.equal(JSON.stringify((await growthView(actor,chats[1]!)).items),before,'readback does not change personal facts')
  assert.equal((await pool.query('SELECT count(*) FROM experiences WHERE user_id=$1',[actor])).rows[0].count,'0','a readback question must never become a completed experience')
  const messages=(await store.listConversations(actor)).find(c=>c.id===chats[1])!.messages
  assert.equal(messages.filter((m:{role:string;content:string;run_request_id:string})=>m.role==='assistant'&&m.content===result.text&&m.run_request_id===run.request_id).length,1)
  }
  assert.equal(requests.length,4)
 }finally{model.baseUrl=base;config.apiKey=key;localEmbedding.encode=encode;await new Promise<void>(ok=>fake.close(()=>ok()))}
})
