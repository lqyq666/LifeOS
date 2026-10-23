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
import {stageGrowthUpdates,growthContext} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'
test.after(async()=>{await localEmbedding.close();await pool.end()})
async function account(){
 const user='material-transform-'+randomUUID(),chat=randomUUID()
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await store.createConversation(user,{id:chat,title:'SYNTHETIC material transform'})
 return {user,chat}
}
for(const verb of ['改成','压成','写成'])test('the explicit UI rewrite modifies one existing artifact: '+verb,async()=>{
 const {user,chat}=await account(),signal=new AbortController().signal
 const previous={url:model.baseUrl,key:config.apiKey,budget:config.providerBudgetEnabled,encode:localEmbedding.encode}
 localEmbedding.encode=async texts=>texts.map(()=>Array(512).fill(0));config.providerBudgetEnabled=false
 const engine=createTurnEngine({capabilityVerified:()=>true})
 const seed=(await store.startRun(user,chat,randomUUID(),'我在课程小组里负责整理资料和排版，代码是队友做的。只帮我写一段本人贡献描述，不要替我发送。')).run
 const first:store.Staged={candidates:[],audit:[]}
 const opening=await engine({run:seed,staged:first,context:await store.contextForRun(seed),decision:null,signal,emit:()=>{}})
 await store.finishRun(seed,first,opening.text,opening.usage,signal)
 const event=(await coachEventView(user,chat))!,action=event.actions.find(a=>a.status==='proposed')!
 let calls=0,payload:any
 const reply='我负责资料整理和排版。'
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  calls++;payload=JSON.parse(Buffer.concat(chunks).toString())
  const output={reply,event:{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,draft:{fromReply:true}}}}
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'synthetic-material-transform',object:'chat.completion.chunk',created:1,model:model.id,choices:[{index:0,delta:{content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(done=>fake.listen(0,'127.0.0.1',done));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-transform-only'
 try{
  const run=(await store.startRun(user,chat,randomUUID(),'把刚才的本人贡献描述'+verb+'一句更短的第一人称，保留资料整理和排版，不添加其他技能，也不要发送。')).run
  const staged:store.Staged={candidates:[],audit:[]}
  const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
  assert.ok(payload.response_format.json_schema.schema.required.includes('event'),'generation must require the material commit')
  const committed=await store.finishRun(run,staged,result.text,result.usage,signal)
  const saved=(await coachEventView(user,chat))!.actions.find(a=>a.id===action.id)!
  assert.equal(saved.draft?.content,reply);assert.equal(saved.revision,action.revision+1)
  assert.equal(committed.event?.actions.find(a=>a.id===action.id)?.draft?.content,reply)
  assert.equal((await store.runStatus(user,run.request_id)).response.event.actions.find((a:any)=>a.id===action.id).draft.content,reply)
  assert.equal(calls,1)
 }finally{
  fake.closeAllConnections();await new Promise<void>(done=>fake.close(()=>done()))
  model.baseUrl=previous.url;config.apiKey=previous.key;config.providerBudgetEnabled=previous.budget;localEmbedding.encode=previous.encode
 }
})

test('the final receipt includes automatic unknown resolution from the same transaction',async()=>{
 const {user,chat}=await account(),signal=new AbortController().signal,text='老师没有回复。'
 const seed=(await store.startRun(user,chat,randomUUID(),text)).run
 const staged=await stageCoachEvent(seed,{target:{operation:'create',title:'老师邮件',source:{messageId:seed.source_message_id,quote:text}},nodes:[{kind:'unknown',question:'是否约定过回复时间？',reason:'核对等待边界',affects:'判断是否需要下一步'}]},'是否约定过回复时间？')
 await store.finishRun(seed,{candidates:[],audit:[],coach:staged},'是否约定过回复时间？',null,signal)
 const event=(await coachEventView(user,chat))!,run=(await store.startRun(user,chat,randomUUID(),'没有约定回复时间。')).run
 const update=await stageCoachEvent(run,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:'没有约定回复时间'}}]},'记下了。')
 const receipt=await store.finishRun(run,{candidates:[],audit:[],coach:update},'记下了。',null,signal)
 const current=(await coachEventView(user,chat))!,unknown=current.nodes.find(n=>n.kind==='unknown')!
 assert.equal(unknown.status,'resolved')
 assert.deepEqual(receipt.event?.nodes.find(n=>n.id===unknown.id),unknown,'completion receipt must include the final committed status')
})

for(const oldQuote of ['老师没回复只是结果未知','老师没有回复只是结果未知'])test('the cross-session later teacher response retires only its linked state: '+oldQuote,async()=>{
 await localEmbedding.start()
 const {user,chat}=await account(),signal=new AbortController().signal,other=randomUUID(),latest=randomUUID()
 await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
 for(const id of [other,latest])await store.createConversation(user,{id,title:'SYNTHETIC teacher follow-up'})
 const seed=(await store.startRun(user,chat,randomUUID(),oldQuote+'，不等于拒绝我。')).run
 const coach=await stageCoachEvent(seed,{target:{operation:'create',title:'老师邮件未回复，结果未知',source:{messageId:seed.source_message_id,quote:oldQuote}},nodes:[{kind:'fact',source:{messageId:seed.source_message_id,quote:oldQuote}}]},'先保留未知。')
 const growth=await stageGrowthUpdates(seed,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:seed.source_message_id,quote:oldQuote}}],[],{})
 await store.finishRun(seed,{candidates:[],audit:[],coach,growth},'先保留未知。',null,signal)
 const original=(await coachEventView(user,chat))!,oldGrowth=(await growthContext(user,chat)).find(i=>i.text===oldQuote)!
 const second=(await store.startRun(user,other,randomUUID(),'更正并区分两件事：老师那封邮件是未回复；另一位同学试过我做的表格后明确说不适合他。')).run
 const table='另一位同学试过我做的表格后明确说不适合他'
 const secondCoach=await stageCoachEvent(second,{target:{operation:'continue',eventId:original.id,expectedRevision:original.revision},nodes:[{kind:'fact',source:{messageId:second.source_message_id,quote:table}}]},'老师邮件与同学表格分开保留。')
 const secondGrowth=await stageGrowthUpdates(second,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:second.source_message_id,quote:'更正并区分两件事：老师那封邮件是未回复'}},{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:second.source_message_id,quote:table}}],await growthContext(user,other),{})
 await store.finishRun(second,{candidates:[],audit:[],coach:secondCoach,growth:secondGrowth},'老师邮件与同学表格分开保留。',null,signal)
 const previous={url:model.baseUrl,key:config.apiKey,budget:config.providerBudgetEnabled};let calls=0
 const fake=createServer((req,res)=>{calls++;res.writeHead(500);res.end()})
 await new Promise<void>(done=>fake.listen(0,'127.0.0.1',done));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-no-generation-only';config.providerBudgetEnabled=false
 try{
  const run=(await store.startRun(user,latest,randomUUID(),'回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。请只更新各自相关状态。')).run
  const staged:store.Staged={candidates:[],audit:[]}
  const result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
  assert.equal(calls,0,'verified source update adds no model call')
  assert.ok(staged.audit.some((entry:any)=>entry.phase==='verified_response_bound_to_existing_event'))
  const receipt=await store.finishRun(run,staged,result.text,result.usage,signal)
  assert.equal((await pool.query('SELECT status FROM growth_items WHERE user_id=$1 AND id=$2',[user,oldGrowth.id])).rows[0].status,'stale')
  assert.ok(receipt.event?.nodes.some(n=>n.id===original.nodes[0]!.id&&n.status==='resolved'))
  assert.ok(receipt.event?.nodes.some(n=>/老师后来回复说这周忙/.test(n.content)))
  assert.ok((await growthContext(user,latest)).some(i=>i.text===table&&i.status==='active'),'the other participants feedback remains active')
  const mixedChat=randomUUID();await store.createConversation(user,{id:mixedChat,title:'SYNTHETIC mixed participant follow-up'})
  const mixed=(await store.startRun(user,mixedChat,randomUUID(),'回来反馈：老师后来回复说这周忙，下周再看；同学回复说表格仍不适合他。请只更新各自相关状态。')).run
  const mixedStaged:store.Staged={candidates:[],audit:[]}
  const mixedReply=await createTurnEngine({capabilityVerified:()=>true})({run:mixed,staged:mixedStaged,context:await store.contextForRun(mixed),decision:null,signal,emit:()=>{}})
  assert.equal(calls,0)
  const mixedReceipt=await store.finishRun(mixed,mixedStaged,mixedReply.text,mixedReply.usage,signal)
  const mixedNodes=mixedReceipt.event!.nodes.filter(n=>n.source?.messageId===mixed.source_message_id)
  assert.ok(mixedNodes.some(n=>/老师/.test(n.content)))
  assert.ok(!mixedNodes.some(n=>/同学/.test(n.content)),'another actors response is not attached merely because it shares the current message')
  // A second workspace for the same role makes the next bare continuation
  // ambiguous even if semantic retrieval happens to return only one match.
  const another=randomUUID(),last=randomUUID()
  for(const id of [another,last])await store.createConversation(user,{id,title:'SYNTHETIC second teacher matter'})
  const uncertain=(await store.startRun(user,another,randomUUID(),'老师没回复只是结果未知。')).run
  const unrelated=await stageCoachEvent(uncertain,{target:{operation:'create',title:'另一件老师事项',source:{messageId:uncertain.source_message_id,quote:'老师没回复只是结果未知'}},nodes:[{kind:'fact',source:{messageId:uncertain.source_message_id,quote:'老师没回复只是结果未知'}}]},'保留这件事。')
  const unrelatedReceipt=await store.finishRun(uncertain,{candidates:[],audit:[],coach:unrelated},'保留这件事。',null,signal)
  const next=(await store.startRun(user,last,randomUUID(),'回来反馈：老师后来回复说这周忙，下周再看。请只更新相关状态。')).run
  const ambiguous:store.Staged={candidates:[],audit:[]}
  const readback=await createTurnEngine({capabilityVerified:()=>true})({run:next,staged:ambiguous,context:await store.contextForRun(next),decision:null,signal,emit:()=>{}})
  assert.equal(calls,0)
  assert.ok(!ambiguous.coach,'a bare role must not select among two workspaces')
  await store.finishRun(next,ambiguous,readback.text,readback.usage,signal)
  const untouched=await coachEventView(user,another,unrelatedReceipt.event!.id)
  assert.equal(untouched!.nodes[0]!.status,'active')
 }finally{
  fake.closeAllConnections();await new Promise<void>(done=>fake.close(()=>done()))
  model.baseUrl=previous.url;config.apiKey=previous.key;config.providerBudgetEnabled=previous.budget
 }
})

