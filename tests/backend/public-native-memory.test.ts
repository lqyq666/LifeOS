import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {growthView,actOnGrowthItem} from '../../server/growth.ts'
const fixture=JSON.parse(readFileSync(new URL('../fixtures/public-native-memory-failure.json',import.meta.url),'utf8'))
test.after(async()=>{await localEmbedding.close();await pool.end()})

test('a teacher response retires only that report, preserving another actor and a different material',async()=>{
 const {createGrowthItem,growthView}=await import('../../server/growth.ts')
 const {sameReportedResponseSubject}=await import('../../server/turn-contract.ts')
 assert.equal(sameReportedResponseSubject('老师没回复','老师后来回复说这周忙'),true)
 assert.equal(sameReportedResponseSubject('同学未回复','老师后来回复说这周忙'),false)
 assert.equal(sameReportedResponseSubject('导师未回复作品集链接','导师确认已经读到PDF'),false)
 const actor='scoped-response-'+randomUUID(),chat=randomUUID()
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
 await store.createConversation(actor,{id:chat,title:'SYNTHETIC scoped response'})
 const items:Awaited<ReturnType<typeof createGrowthItem>>[]=[]
 for(const text of ['老师没回复','同学未回复','导师未回复作品集链接'])items.push(await createGrowthItem(actor,{requestId:randomUUID(),conversationId:chat,kind:'context',text}))
 const run=(await store.startRun(actor,chat,randomUUID(),'老师后来回复说这周忙，下周再看。')).run
 await store.finishRun(run,{candidates:[],audit:[]},'老师已回复；其他事项保留。',null,new AbortController().signal)
 const view=(await growthView(actor,chat)).items
 assert.equal(view.find(item=>item.id===items[0].id)?.status,'stale')
 assert.equal(view.find(item=>item.id===items[1].id)?.status,'active')
 assert.equal(view.find(item=>item.id===items[2].id)?.status,'active')
})

test('actual NR create-envelope output commits once through canonical source authority',async()=>{
 const capture=JSON.parse(readFileSync(new URL('../fixtures/nr-output-envelope-failure.json',import.meta.url),'utf8'))
 const encode=localEmbedding.encode.bind(localEmbedding),base=model.baseUrl,key=config.apiKey
 localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
 const requests:any[]=[],outputs:any[]=capture.turns.map((turn:any)=>turn.raw)
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  requests.push(JSON.parse(Buffer.concat(chunks).toString()));const output=outputs.shift();assert.ok(output,'no second paid-style attempt')
  const envelope={id:'synthetic-nr-envelope-replay',object:'chat.completion.chunk',created:1,model:model.id};res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:40,total_tokens:160,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
 })});await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-nr-replay-key'
 const actor='native-nr-'+randomUUID(),chats=[randomUUID(),randomUUID()],engine=createTurnEngine({capabilityVerified:()=>true})
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
  await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  for(const id of chats)await store.createConversation(actor,{id,title:'SYNTHETIC actual NR envelope regression'})
  let last:store.Staged|undefined,sourceId=''
  for(const [index,turn]of capture.turns.entries()){
   const run=(await store.startRun(actor,chats[index===2?1:0]!,randomUUID(),turn.user)).run,staged:store.Staged={candidates:[],audit:[]},controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000)
   try{const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:controller.signal,emit:()=>{}});await store.finishRun(run,staged,result.text,result.usage,controller.signal);last=staged;sourceId=run.source_message_id
    if(index===1)assert.ok((await growthView(actor,chats[0])).items.some(item=>item.text==='我还不知道这是否只是一次偶然'&&item.sources.some(source=>source.type==='message'&&source.id===run.source_message_id)),'the owned uncertainty is persisted without making the underlying proposition true or false')
   }finally{clearTimeout(timer)}
  }
  assert.equal(requests.length,3);assert.equal(outputs.length,0)
  assert.ok(last!.audit.some(entry=>(entry as {phase?:string;kind?:string}).phase==='coach_output_normalized'&&(entry as {kind?:string}).kind==='explicit_reported_create_envelope'))
  const items=(await growthView(actor,chats[1])).items.filter(item=>!item.unavailableReason)
  assert.ok(items.some(item=>item.text==='最近一次我先定了三条分类规则'&&item.sources.some(source=>source.type==='message'&&source.id===sourceId&&source.quote===item.text)),'the host clause, not the model-authored combined text, owns the fact')
  for(const item of items.filter(item=>item.text===capture.turns[2].raw.growthUpdates.create[0].text))assert.ok(item.sources.some(source=>source.type==='message'&&source.id===sourceId&&source.quote===item.text),'any independently supplemented full report must have its own exact current source')
  assert.ok(items.some(item=>item.kind==='goal'),'the previously owned goal survives the new conversation')
  const nextPayload=JSON.parse(requests[2].messages.find((message:any)=>message.role==='user').content)
  assert.ok(nextPayload.currentTask.responseScope.reportedEvidence.sourceBounds.some((bound:any)=>bound.kind==='explicit_uncertainty'&&bound.quote==='我还不知道这是否只是一次偶然'&&bound.source.type==='growth'),'the next session receives the original uncertainty beside its known goal')
 }finally{model.baseUrl=base;config.apiKey=key;localEmbedding.encode=encode;await new Promise<void>(ok=>fake.close(()=>ok()))}
})
test('saved real nm outputs preserve preferences and requested actions through the full commit path',async()=>{
 const evidence=JSON.parse(readFileSync(new URL('../fixtures/nm-semantic-failures.json',import.meta.url),'utf8'))
 const outputs=evidence.turns.map((row:any)=>row.raw),requests:any[]=[]
 const encode=localEmbedding.encode.bind(localEmbedding),base=model.baseUrl,key=config.apiKey
 localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  requests.push(JSON.parse(Buffer.concat(chunks).toString()));const output=outputs.shift();assert.ok(output,'no extra model call')
  const envelope={id:'saved-nm-failure-replay',object:'chat.completion.chunk',created:1,model:model.id};res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:40,total_tokens:160,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
 })});await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-nm-replay-not-a-real-key'
 const actor='nm-replay-'+randomUUID(),chats=Array.from({length:4},()=>randomUUID()),engine=createTurnEngine({capabilityVerified:()=>true})
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
  await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  for(const id of chats)await store.createConversation(actor,{id,title:'SYNTHETIC saved nm semantic failure'})
  for(let index=0;index<evidence.turns.length;index++){
   const row=evidence.turns[index],chat=chats[[0,1,1,2,3,3][index]!]!,run=(await store.startRun(actor,chat,randomUUID(),row.text)).run,staged:store.Staged={candidates:[],audit:[]},controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000)
   try{
    const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:controller.signal,emit:()=>{}})
    await store.finishRun(run,staged,result.text,result.usage,controller.signal)
    if(index===0)assert.ok((await growthView(actor,chat)).items.some(i=>i.kind==='preference'&&i.text==='我并不享受考试本身'&&i.sources.some(s=>s.type==='message'&&s.id===run.source_message_id)))
    if(index===1)assert.ok(JSON.stringify(requests[index].messages).includes('我并不享受考试本身'),'next-session actual payload retains the reported experience')
    if(index===2){assert.match(result.text,/用公开渠道查3个该方向的真实招聘帖/);assert.match(result.text,/做完即停/)}
    if(index===3){assert.doesNotMatch(result.text,/它测的是：导师手机/);assert.match(result.text,/今天不发送/)}
    if(index===5){assert.match(result.text,/减少反复找东西时间的偏好/);assert.doesNotMatch(result.text,/是否减少反复找东西时间的偏好仍不能确认/)}
   }finally{clearTimeout(timer)}
  }
  assert.equal(requests.length,6);assert.equal(outputs.length,0)
  // A real prior contact instruction is evidence, not current permission.
  const history=(await store.startRun(actor,chats[2]!,randomUUID(),'请通过公开渠道联系三位HR。')).run
  await store.finishRun(history,{candidates:[],audit:[]},'历史联系计划。',null,new AbortController().signal)
  outputs.push({reply:'通过公开渠道联系三位HR，发送简历。'})
  const blocked=(await store.startRun(actor,chats[2]!,randomUUID(),'现在只用公开渠道查招聘帖，不联系任何人。请给一个四小时内的小验证。')).run
  const storeContext=await store.contextForRun(blocked)
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000)
  try{await assert.rejects(()=>engine({run:blocked,staged:{candidates:[],audit:[]},context:storeContext,decision:null,signal:controller.signal,emit:()=>{}}),/REPLY_UNSUPPORTED_CONTACT_CHANNEL/)}finally{clearTimeout(timer)}
  assert.equal(requests.length,7);assert.equal(outputs.length,0)
  const committed=await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[actor,blocked.request_id])
  assert.equal(committed.rows[0].n,0,'unsafe all-contact response must not commit an assistant reply')
  const unsafeReplies=['停止','停','不再继续'].map(stop=>`把PDF导出到本地用于验证导师手机能否打开并在导师确认后${stop}。今天不发送。`)
  unsafeReplies.push('把PDF导出到本地并发给导师用于验证导师手机能否打开。今天不发送。')
  for(const [index,reply] of unsafeReplies.entries()){
   const other=actor+'-measurement-'+index,chat=randomUUID()
   await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[other,other+'@example.invalid'])
   await store.createConversation(other,{id:chat,title:'SYNTHETIC incompatible measurement stop'})
   outputs.push({reply})
   const unsafe=(await store.startRun(other,chat,randomUUID(),'我可以导出PDF。请给能开始的一步，并说明何时停止。')).run
   const unsafeContext=await store.contextForRun(unsafe),abort=new AbortController(),deadline=setTimeout(()=>abort.abort(),20000)
   try{await assert.rejects(()=>engine({run:unsafe,staged:{candidates:[],audit:[]},context:unsafeContext,decision:null,signal:abort.signal,emit:()=>{}}),/REPLY_ACCESS_MEASUREMENT_UNBOUNDED/)}finally{clearTimeout(deadline)}
   assert.equal(requests.length,8+index);assert.equal(outputs.length,0)
   const uncommitted=await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[other,unsafe.request_id])
   assert.equal(uncommitted.rows[0].n,0,'an incompatible stop must fail once without committing an unsafe action')
  }
 }finally{model.baseUrl=base;config.apiKey=key;localEmbedding.encode=encode;await new Promise<void>(ok=>fake.close(()=>ok()))}
})
test('public failure replay persists background across sessions and isolates a time correction with reply-only provider output',async()=>{
 const encode=localEmbedding.encode.bind(localEmbedding),base=model.baseUrl,key=config.apiKey
 localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
 const requests:any[]=[],outputs=[{reply:'今天先用15分钟查看一个入门岗位的公开要求，记录已做过与仍未知的部分，到时就停。'},
  {reply:'你是大三软件工程学生，会一点Python，做过CSV整理练习；仍在比较就业与考研，还未选定。每周上限两小时；岗位和院校的具体要求仍未知。'},
  {reply:'这次查看的是一个本地初级岗位，花了15分钟；课程练习不证明达到岗位要求，另一项技能仍未核实。'},
  {reply:'考研暂缓，本周剩余一小时；查看岗位的事实保留，技能门槛仍未知，等你主动回来。'}]
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  requests.push(JSON.parse(Buffer.concat(chunks).toString()));const output=outputs.shift();assert.ok(output,'no extra provider call is allowed')
  const envelope={id:'native-memory-replay',object:'chat.completion.chunk',created:1,model:model.id};res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:40,total_tokens:160,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
 })});await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-native-memory-replay-key'
 const actor='native-public-'+randomUUID(),chats=[randomUUID(),randomUUID(),randomUUID()],engine=createTurnEngine({capabilityVerified:()=>true})
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
  await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  for(const id of chats)await store.createConversation(actor,{id,title:'SYNTHETIC native public failure replay'})
  async function turn(chat:string,text:string){const run=(await store.startRun(actor,chat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]},controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000)
   try{const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:controller.signal,emit:()=>{}});await store.finishRun(run,staged,result.text,result.usage,controller.signal);return run}finally{clearTimeout(timer)}}
  const first=await turn(chats[0]!,fixture.firstText)
  const afterFirst=(await growthView(actor,chats[0])).items.filter(i=>!i.unavailableReason)
  for(const fact of ['大三','软件工程专业','会一点Python','做过CSV整理练习','想比较就业和考研','还没选定'])assert.ok(afterFirst.some(i=>i.text.includes(fact)&&i.sources.some(s=>s.type==='message'&&s.id===first.source_message_id&&fixture.firstText.includes(s.quote))))
  await turn(chats[1]!,'换了一个会话，接着刚才的就业和考研取舍：你记得我的哪些本人信息？依据是什么、还有什么未知？先不安排新任务。')
  const sent=JSON.stringify(requests[1].messages)
  for(const fact of ['大三','软件工程专业','Python','CSV','还没选定'])assert.ok(sent.includes(fact),'actual next-session provider context includes '+fact)
  const feedback='回来反馈：我今天花了15分钟查看一个本地初级岗位，发现要求两项技能，其中一项做过课程练习，另一项还没核实。这只是一条个例，不代表我已经满足岗位要求。请记录实际反馈，更新仍未知的地方。'
  await turn(chats[1]!,feedback)
  const execution=(await growthView(actor,chats[1])).items.find(i=>!i.unavailableReason&&i.text.includes('花了15分钟查看一个本地初级岗位'))
  assert.ok(execution)
  await turn(chats[2]!,fixture.correctionText)
  const after=(await growthView(actor,chats[2])).items,retained=after.find(i=>i.id===execution.id)
  assert.equal(retained?.status,'active');assert.equal(retained?.unavailableReason,null);assert.equal(retained?.text,execution.text);assert.equal(retained?.revision,execution.revision)
  assert.ok(after.some(i=>!i.unavailableReason&&i.text.includes('这周剩余时间是一小时')))
  assert.equal(requests.length,4);assert.equal(outputs.length,0)
 }finally{model.baseUrl=base;config.apiKey=key;localEmbedding.encode=encode;await new Promise<void>(ok=>fake.close(()=>ok()))}
})


test('an omitted native goal delta survives an actual cross-session payload and Memory OFF prevents supplementation',async()=>{
 const encode=localEmbedding.encode.bind(localEmbedding),base=model.baseUrl,key=config.apiKey
 localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
 const requests:any[]=[],outputs=[{reply:'这是你表达的目标，实际查找用时尚未测量。'},{reply:'你希望更快看出关键信息，并减少反复查找时间；实际效果仍未知。'},{reply:'可以先聊你希望了解的内容。'}]
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  requests.push(JSON.parse(Buffer.concat(chunks).toString()));const output=outputs.shift();assert.ok(output,'no extra provider call')
  const envelope={id:'synthetic-nn-goal-replay',object:'chat.completion.chunk',created:1,model:model.id};res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:40,total_tokens:160,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
 })});await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-goal-replay-key'
 const actor='native-goal-'+randomUUID(),chats=[randomUUID(),randomUUID(),randomUUID()],engine=createTurnEngine({capabilityVerified:()=>true})
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
  await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  for(const id of chats)await store.createConversation(actor,{id,title:'SYNTHETIC owned goal persistence'})
  async function turn(chat:string,text:string){const run=(await store.startRun(actor,chat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]},controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000)
   try{const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:controller.signal,emit:()=>{}});await store.finishRun(run,staged,result.text,result.usage,controller.signal);return run}finally{clearTimeout(timer)}}
  const text='不是因为老师要求；我会主动继续整理，主要想更快看出哪些信息关键，减少自己反复找东西的时间。我还不知道这是否只是一次偶然。'
  const first=await turn(chats[0]!,text),after=(await growthView(actor,chats[0])).items.filter(i=>!i.unavailableReason)
  for(const quote of ['主要想更快看出哪些信息关键','减少自己反复找东西的时间']){
   const item=after.find(i=>i.text===quote);assert.ok(item,'explicit goal persisted despite reply-only provider output: '+quote)
   assert.equal(item.kind,'goal');assert.equal(item.assertion,'user_reported')
   assert.ok(item.sources.some(s=>s.type==='message'&&s.id===first.source_message_id&&s.quote===quote))
  }
  await turn(chats[1]!,'换一个会话，接着整理资料的探索。请说明我的已知目标和还没有测量的效果，不新增任务。')
  const sent=JSON.stringify(requests[1].messages)
  for(const quote of ['主要想更快看出哪些信息关键','减少自己反复找东西的时间'])assert.ok(sent.includes(quote),'actual new-session provider context includes '+quote)
  const beforeOff=(await pool.query('SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1',[actor])).rows[0].n
  await setMemorySettings(actor,{requestId:randomUUID(),enabled:false,expectedRevision:1})
  await turn(chats[2]!,'我希望弄清哪些课程需要先修，避免自己重复报名。')
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1',[actor])).rows[0].n,beforeOff,'Memory OFF does not append implicit goal facts')
  assert.equal((await growthView(actor,chats[2])).items.length,0,'Memory OFF hides stored personal context')
  assert.equal(requests.length,3);assert.equal(outputs.length,0)
 }finally{model.baseUrl=base;config.apiKey=key;localEmbedding.encode=encode;await new Promise<void>(ok=>fake.close(()=>ok()))}
})


test('actual NQ reply-only outputs cannot omit send/feedback memory or an executable rejected-label boundary',async()=>{
 const capture=JSON.parse(readFileSync(new URL('../fixtures/nq-persistence-failures.json',import.meta.url),'utf8'))
 const encode=localEmbedding.encode.bind(localEmbedding),base=model.baseUrl,key=config.apiKey
 localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
 const requests:any[]=[],outputs:any[]=capture.turns.slice(0,3).map((turn:any)=>turn.raw)
 outputs.push({lead:'你确实喜欢销售。',reply:'你确实喜欢销售。这是根据这些经历形成的判断。'})
 outputs.push({reply:'这是你刚刚直接确认的偏好，保留独立经历。'})
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  requests.push(JSON.parse(Buffer.concat(chunks).toString()));const output=outputs.shift();assert.ok(output,'no extra provider call')
  const envelope={id:'synthetic-nq-persistence-replay',object:'chat.completion.chunk',created:1,model:model.id};res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:40,total_tokens:160,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
 })});await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-nq-persistence-replay-key'
 const actor='native-nq-'+randomUUID(),chats=[randomUUID(),randomUUID(),randomUUID()],engine=createTurnEngine({capabilityVerified:()=>true})
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
  await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  for(const id of chats)await store.createConversation(actor,{id,title:'SYNTHETIC actual NQ memory regression'})
  const frames:any[]=[];let failedRequest:string|null=null
  async function turn(chat:string,text:string){const run=(await store.startRun(actor,chat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]},controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000)
   try{const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:controller.signal,emit:f=>frames.push(f)});await store.finishRun(run,staged,result.text,result.usage,controller.signal);return {run,result,staged}}catch(error){failedRequest=run.request_id;await store.terminateRun(actor,run.request_id,'failed',(error as {code?:string}).code??'SYNTHETIC_ENGINE_FAILURE');throw error}finally{clearTimeout(timer)}}
  const first=await turn(chats[0]!,capture.turns[0].text)
  const initial=(await growthView(actor,chats[0])).items.filter(i=>!i.unavailableReason)
  for(const quote of ['方向暂定找产品实习','我把作品集链接发给导师了'])assert.ok(initial.some(i=>i.text===quote&&i.sources.some(source=>source.type==='message'&&source.id===first.run.source_message_id&&source.quote===quote)),quote)
  await turn(chats[0]!,capture.turns[1].text)
  const feedback=await turn(chats[0]!,capture.turns[2].text)
  const feedbackPayload=JSON.parse(requests[2].messages.find((message:any)=>message.role==='user').content)
  assert.ok(feedbackPayload.currentTask.responseScope.reportedEvidence.sourceBounds.some((bound:any)=>bound.kind==='reported_observation'&&bound.quote.includes('导师回复说手机打不开链接')&&bound.source.id===feedback.run.source_message_id),'a reported access failure is projected as an observation, not a confirmed cause')
  const afterFeedback=(await growthView(actor,chats[0])).items.filter(i=>!i.unavailableReason)
  assert.ok(afterFeedback.some(i=>i.text.includes('导师回复说手机打不开链接')&&i.text.includes('没有评价内容')&&i.sources.some(source=>source.type==='message'&&source.id===feedback.run.source_message_id)))
  const action=afterFeedback.find(i=>i.text==='我把作品集链接发给导师了')!;assert.ok(action)
  const controlResult=await turn(chats[1]!,capture.turns[3].text)
  assert.equal((controlResult.result.usage as any).llmCallCount,0)
  assert.equal(requests.length,3,'the pure label control commits without provider generation')
  const afterControl=(await growthView(actor,chats[1])).items,control=afterControl.find(i=>i.inferenceBoundary?.active)
  assert.ok(control,'the exact source instructions must decode into an executable inference boundary')
  assert.equal(control.inferenceBoundary!.label,'我喜欢销售');assert.equal(control.inferenceBoundary!.instructionQuotes.length,2)
  assert.equal(afterControl.find(i=>i.id===action.id)?.revision,action.revision,'independent sent-action history is not forgotten')
  await actOnGrowthItem(actor,control.id,{requestId:randomUUID(),expectedRevision:control.revision,action:'pause'})
  assert.ok((await growthView(actor,chats[1])).items.find(i=>i.id===control.id)?.inferenceBoundary?.active,'pausing ordinary use of a control record does not authorize recreating its rejected label')
  const beforeBad=frames.length
  await assert.rejects(()=>turn(chats[2]!,'接着刚才的边界，只更新理解，不新增标签。'),/REPLY_RECREATES_REJECTED_LABEL/)
  const actualContext=JSON.stringify(requests[3].messages)
  assert.ok(actualContext.includes('inferenceBoundary')&&actualContext.includes('do_not_infer_label'),'new-session actual provider payload includes the typed control')
  for(const quote of ['方向暂定找产品实习','我把作品集链接发给导师了','导师回复说手机打不开链接'])assert.ok(actualContext.includes(quote),'cross-session actual provider payload retains '+quote)
  assert.ok(!frames.slice(beforeBad).some(f=>f.type==='draft'&&f.text?.includes('你确实喜欢销售')),'unsafe label is not exposed in a provisional frame')
  assert.equal(requests.length,4,'single attempt; pure controls do not generate; no automatic repair generation')
  assert.ok(failedRequest);assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[actor,failedRequest])).rows[0].n,0,'a blocked label cannot commit an assistant message')
  await turn(chats[2]!,'我现在确实喜欢销售。')
  const confirmed=(await growthView(actor,chats[2])).items
  assert.ok(confirmed.some(i=>i.inferenceBoundary&&!i.inferenceBoundary.active),'later direct confirmation is controlled by the user')
  assert.ok(confirmed.some(i=>i.id===action.id&&i.revision===action.revision))
  await turn(chats[2]!,capture.turns[3].text)
  const rejectedAgain=(await growthView(actor,chats[2])).items
  assert.ok(rejectedAgain.some(i=>i.inferenceBoundary?.active),'a renewed explicit rejection overrides the later confirmation without a stale-source dedup skip')
  assert.ok(rejectedAgain.some(i=>i.id===action.id&&i.revision===action.revision))
  assert.equal(requests.length,5);assert.equal(outputs.length,0)
 }finally{model.baseUrl=base;config.apiKey=key;localEmbedding.encode=encode;await new Promise<void>(ok=>fake.close(()=>ok()))}
})


test('actual NU first refusal is committed before later model turns and survives a new session',async()=>{
 const capture=JSON.parse(readFileSync(new URL('../fixtures/nu-modal-control-failures.json',import.meta.url),'utf8'))
 const nw=JSON.parse(readFileSync(new URL('../fixtures/nw-preference-scope-failure.json',import.meta.url),'utf8'))
 const replay=[...capture.turns.slice(0,3),{user:nw.user,raw:nw.raw}]
 const outputs=replay.map((turn:any)=>turn.raw),requests:any[]=[],base=model.baseUrl,key=config.apiKey,encode=localEmbedding.encode.bind(localEmbedding)
 localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  requests.push(JSON.parse(Buffer.concat(chunks).toString()));const output=outputs.shift();assert.ok(output,'no extra generation')
  const envelope={id:'synthetic-nu-source-replay',object:'chat.completion.chunk',created:1,model:model.id};res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:40,total_tokens:160,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
 })});await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-nu-replay-key'
 const actor='native-nu-'+randomUUID(),chats=[randomUUID(),randomUUID()],engine=createTurnEngine({capabilityVerified:()=>true})
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
  await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  for(const id of chats)await store.createConversation(actor,{id,title:'SYNTHETIC actual NU initial refusal'})
  for(let i=0;i<4;i++){
   const run=(await store.startRun(actor,chats[i>=2?1:0]!,randomUUID(),replay[i].user)).run,staged:store.Staged={candidates:[],audit:[]},controller=new AbortController()
   const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:controller.signal,emit:()=>{}})
   const committed=await store.finishRun(run,staged,result.text,result.usage,controller.signal)
   if(i===0)assert.deepEqual(committed.stateChange.controls.changedScopes,['entrepreneurship'])
  }
  const {readDirectionControls}=await import('../../server/growth-controls.ts'),controls=await readDirectionControls(actor)
  assert.equal(controls.find(item=>item.scope==='entrepreneurship')?.state,'paused')
  assert.ok(!controls.some(item=>item.scope==='freelance'),'neutral boss identity does not pause another direction')
  const next=JSON.parse(requests[2].messages.find((message:any)=>message.role==='user').content)
  assert.ok(next.blockedDirectionScopes.includes('entrepreneurship'))
  assert.ok(next.currentTask.responseScope.reportedEvidence.sourceBounds.some((item:any)=>item.kind==='nonpriority_not_refusal'&&item.quote==='不在意当老板'))
  assert.equal(requests.length,4);assert.equal(outputs.length,0)
 }finally{model.baseUrl=base;config.apiKey=key;localEmbedding.encode=encode;await new Promise<void>(ok=>fake.close(()=>ok()))}
})


test('actual NV reply-only feedback retains whole reported episodes and inference limits in a new session',async()=>{
 const capture=JSON.parse(readFileSync(new URL('../fixtures/nv-feedback-scope-failures.json',import.meta.url),'utf8'))
 const outputs=capture.turns.slice(0,4).flatMap((turn:any)=>[turn.raw,null]),requests:any[]=[],base=model.baseUrl,key=config.apiKey,encode=localEmbedding.encode.bind(localEmbedding)
 localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  requests.push(JSON.parse(Buffer.concat(chunks).toString()));assert.ok(outputs.length,'no automatic generation retry');const output=outputs.shift()
  if(output===null){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'SYNTHETIC_CAPTURE_ONLY_NO_RESPONSE'}}));return}
  const envelope={id:'synthetic-nv-episode-replay',object:'chat.completion.chunk',created:1,model:model.id};res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:40,total_tokens:160,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
 })});await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-nv-replay-key'
 const engine=createTurnEngine({capabilityVerified:()=>true})
 try{
  for(const [i,turn]of capture.turns.slice(0,4).entries()){
   const actor='native-nv-'+randomUUID(),chats=[randomUUID(),randomUUID()]
   await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
   await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
   for(const id of chats)await store.createConversation(actor,{id,title:'SYNTHETIC actual NV episode'})
   const run=(await store.startRun(actor,chats[0]!,randomUUID(),turn.user)).run,staged:store.Staged={candidates:[],audit:[]},controller=new AbortController()
   const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:controller.signal,emit:()=>{}})
   await store.finishRun(run,staged,result.text,result.usage,controller.signal)
   const whole=turn.user.replace(/[。！!]$/,'')
   assert.ok((await growthView(actor,chats[1])).items.some(item=>item.text===whole&&item.sources.some(source=>source.type==='message'&&source.id===run.source_message_id&&source.quote===whole)),'the observation and its limitation share the exact original source')
   const next=(await store.startRun(actor,chats[1]!,randomUUID(),'接着刚才的反馈，只更新已有理解，不新增行动。')).run
   const nextContext=await store.contextForRun(next)
   await assert.rejects(()=>engine({run:next,staged:{candidates:[],audit:[]},context:nextContext,decision:null,signal:controller.signal,emit:()=>{}}))
   // Capture the real next-session provider payload, then deliberately fail;
   // no invented successful follow-up answer is used as semantic evidence.
   if(requests.length!==2*(i+1))throw Error('EXPECTED_SINGLE_CAPTURE_ONLY_REQUEST')
   const payload=JSON.parse(requests.at(-1).messages.find((message:any)=>message.role==='user').content)
   assert.ok(JSON.stringify(payload.growth).includes(whole)||JSON.stringify(payload.growthBackground).includes(whole),'whole episode reaches a new-session native payload')
   if(i===3)assert.ok(payload.currentTask.responseScope.reportedEvidence.sourceBounds.some((item:any)=>item.kind==='inference_limit'&&item.source.type==='growth'))
   await store.terminateRun(actor,next.request_id,'failed','SYNTHETIC_CAPTURE_ONLY')
  }
  assert.equal(outputs.length,0);assert.equal(requests.length,8)
 }finally{model.baseUrl=base;config.apiKey=key;localEmbedding.encode=encode;await new Promise<void>(ok=>fake.close(()=>ok()))}
})


test('actual NX complete comparison survives ordinary prose processing without another model call',async()=>{
 const capture=JSON.parse(readFileSync(new URL('../fixtures/nx-comparison-transform-failure.json',import.meta.url),'utf8'))
 const {comparisonReplyAccepts}=await import('../../server/turn-contract.ts')
 assert.equal(comparisonReplyAccepts(capture.turns[2].raw.reply),true,'the actual provider comparison is structurally complete before processing')
 const outputs=capture.turns.map((turn:any)=>turn.raw),requests:any[]=[],base=model.baseUrl,key=config.apiKey,encode=localEmbedding.encode.bind(localEmbedding)
 localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  requests.push(JSON.parse(Buffer.concat(chunks).toString()));const output=outputs.shift();assert.ok(output,'no extra generation')
  const envelope={id:'synthetic-nx-transform-replay',object:'chat.completion.chunk',created:1,model:model.id};res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:40,total_tokens:160,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
 })});await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-nx-replay-key'
 const actor='native-nx-'+randomUUID(),chats=[randomUUID(),randomUUID()],engine=createTurnEngine({capabilityVerified:()=>true})
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
  await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  for(const id of chats)await store.createConversation(actor,{id,title:'SYNTHETIC actual NX comparison'})
  for(let i=0;i<3;i++){
   const run=(await store.startRun(actor,chats[i===2?1:0]!,randomUUID(),capture.turns[i].user)).run,staged:store.Staged={candidates:[],audit:[]},controller=new AbortController()
   const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:controller.signal,emit:()=>{}})
   await store.finishRun(run,staged,result.text,result.usage,controller.signal)
   if(i===2)assert.ok(comparisonReplyAccepts(result.text),'the requested comparison presentation remains present at commit')
  }
  assert.equal(requests.length,3);assert.equal(outputs.length,0)
 }finally{model.baseUrl=base;config.apiKey=key;localEmbedding.encode=encode;await new Promise<void>(ok=>fake.close(()=>ok()))}
})

test('actual NY/NZ native reports retain source continuity and normalize only a quoted reply literal',async()=>{
 const capture=JSON.parse(readFileSync(new URL('../fixtures/ny-semantic-failures.json',import.meta.url),'utf8'))
 const quoted=JSON.parse(readFileSync(new URL('../fixtures/nz-quoted-reply-failure.json',import.meta.url),'utf8'))
 const {coachEventView}=await import('../../server/action-coach-events.ts')
 const base=model.baseUrl,key=config.apiKey,encode=localEmbedding.encode.bind(localEmbedding)
 localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
 const outputs:any[]=[],requests:any[]=[]
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  requests.push(JSON.parse(Buffer.concat(chunks).toString()));const output=outputs.shift();assert.ok(output,'one output per first attempt')
  const envelope={id:'synthetic-ny-native-replay',object:'chat.completion.chunk',created:1,model:model.id};res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{role:'assistant',content:typeof output==='string'?output:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:40,total_tokens:160,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
 })});await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-ny-native-key'
 try{
  for(const chain of ['no-direction','action-review','refusal-correction']){
   const actor='native-ny-'+randomUUID(),chats=[randomUUID(),randomUUID()],ids=new Map<string,string>(),engine=createTurnEngine({capabilityVerified:()=>true})
   await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
   await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
   for(const id of chats)await store.createConversation(actor,{id,title:'SYNTHETIC actual NY source replay'})
   for(const turn of (chain==='refusal-correction'?quoted:capture).turns.filter((t:any)=>t.chain===chain)){
    const chat=chats[turn.index>=2?1:0]!,run=(await store.startRun(actor,chat,randomUUID(),turn.user)).run
    for(const id of turn.currentSourceIds)ids.set(id,run.source_message_id)
    // Only synthetic identity bindings change. All source quotes, model prose,
    // native operations and field selections are the actual failed output.
    const remap=(value:any):any=>typeof value==='string'?(ids.get(value)??value):Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)])):value
    outputs.push(remap(turn.raw))
    const staged:store.Staged={candidates:[],audit:[]},controller=new AbortController()
    const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:controller.signal,emit:()=>{}})
    await store.finishRun(run,staged,result.text,result.usage,controller.signal)
    const view=await growthView(actor,chat)
    for(const old of turn.memoryAfter){const item=view.items.find(item=>item.kind===old.kind&&item.text===old.text);if(item)ids.set(old.id,item.id)}
    if(turn.index===2&&chain==='no-direction'){
     const whole='最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次'
     assert.ok((await growthView(actor,chats[0])).items.some(item=>item.text===whole&&item.sources.some(s=>s.type==='message'&&s.id===run.source_message_id&&s.quote===whole)),'method, observation and count remain one exact owned source in another session')
    }
    if(turn.index===2&&chain==='action-review'){
     const event=await coachEventView(actor,chat)
     assert.equal(event?.actionStages?.replied,true,'the direct participant response is not unknown')
     assert.equal(event?.actionStages?.read,null,'an access-error reply does not prove the portfolio was read')
     assert.equal(event?.actionStages?.used,null,'an access-error reply does not prove adoption')
     assert.ok(event?.actionStageEvidence?.replied?.evidenceQuotes.some(q=>turn.user.includes(q)&&q.includes('导师回复说')))
    }
    if(turn.index===3&&chain==='refusal-correction'){
     assert.equal(result.text,turn.raw.slice('{"reply":"'.length,-2),'no synthesized or truncated answer replaces the actual model body')
     assert.ok(staged.audit.some((a:any)=>a.phase==='coach_output_normalized'&&a.kind==='quoted_reply_literal'))
     assert.ok((await growthView(actor,chats[0])).items.some(item=>item.taskBoundary?.kind==='pause'&&item.taskBoundary.quote.includes('同学表格那件事先暂停')),'normalization still passes through ordinary pause persistence')
    }
   }
  }
  assert.equal(requests.length,10);assert.equal(outputs.length,0)
 }finally{model.baseUrl=base;config.apiKey=key;localEmbedding.encode=encode;await new Promise<void>(ok=>fake.close(()=>ok()))}
})

test('event stage projection keeps two participant reports scoped without merging their stages',async()=>{
 const {stageCoachEvent,coachEventView}=await import('../../server/action-coach-events.ts')
 const actor='native-ny-actors-'+randomUUID(),chat=randomUUID(),other=randomUUID(),signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
 await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
 for(const id of [chat,other])await store.createConversation(actor,{id,title:'SYNTHETIC distinct participants'})
 let event:any
 for(const text of ['接着作品集的事：导师回复说手机打不开链接','另一位同学没有回复']){
  const run=(await store.startRun(actor,chat,randomUUID(),text)).run,source={messageId:run.source_message_id,quote:text}
  const target=event?{operation:'continue' as const,eventId:event.id,expectedRevision:event.revision}:{operation:'create' as const,title:'不同参与者的报告',source}
  const coach=await stageCoachEvent(run,{target,nodes:[{kind:'fact',source}]},'保留各自报告。')
  event=(await store.finishRun(run,{candidates:[],audit:[],coach},'保留各自报告。',null,signal)).event
  if(text.startsWith('接着'))assert.equal(event.actionStages.replied,true)
 }
 const readback=await coachEventView(actor,other,event.id)
 assert.deepEqual(readback?.actionStages,{sent:null,read:null,replied:false,used:null,effect:null},'the latest vector describes only the latest report, with no earlier actor stages')
 assert.equal(readback?.actionStageScope?.basis,'latest_source_report_only')
 assert.ok(readback?.actionStageEvidence?.replied?.evidenceQuotes.includes('另一位同学没有回复'))
 assert.equal(readback?.actionProgressReports?.length,2,'both independent reports retain their own stages and sources')
 assert.equal(readback?.nodes.filter(node=>node.kind==='fact').length,2,'the separate source reports themselves remain available')
})

test('actual OB sending delta is source-verified in GET, refresh and another session without inventing reading',async()=>{
 const capture=JSON.parse(readFileSync(new URL('../fixtures/ob-semantic-failures.json',import.meta.url),'utf8'))
 const actual=capture.turns.find((t:any)=>t.chain==='action-review'&&t.index===0)
 const {stageCoachEvent,coachEventView}=await import('../../server/action-coach-events.ts')
 const actor='native-ob-sent-'+randomUUID(),chat=randomUUID(),other=randomUUID(),signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
 await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
 for(const id of [chat,other])await store.createConversation(actor,{id,title:'SYNTHETIC actual OB delivery source'})
 const run=(await store.startRun(actor,chat,randomUUID(),actual.user)).run
 const old=actual.raw.event.target.source.messageId
 const remap=(value:any):any=>typeof value==='string'?(value===old?run.source_message_id:value):Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)])):value
 const coach=await stageCoachEvent(run,remap(actual.raw.event),actual.raw.reply)
 const result=await store.finishRun(run,{candidates:[],audit:[],coach},actual.raw.reply,null,signal)
 for(const [conversation,eventId] of [[chat,undefined],[chat,result.event!.id],[other,result.event!.id]] as const){
  const event=await coachEventView(actor,conversation,eventId)
  assert.deepEqual(event?.actionStages,{sent:true,read:null,replied:false,used:null,effect:null})
  assert.equal(event?.actionStageEvidence?.sent?.sourceMessageId,run.source_message_id)
  assert.ok(event?.actionStageEvidence?.sent?.evidenceQuotes.includes('我把作品集链接发给导师了'))
 }
})

test('source-scoped progress never carries an old link or later PDF stage between reports',async()=>{
 const {stageCoachEvent,coachEventView}=await import('../../server/action-coach-events.ts')
 const actor='artifact-report-'+randomUUID(),chat=randomUUID(),second=randomUUID(),signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
 await setMemorySettings(actor,{enabled:true,expectedRevision:0,requestId:randomUUID()})
 for(const id of [chat,second])await store.createConversation(actor,{id,title:'SYNTHETIC separate delivery reports'})
 let event:any
 const ids:string[]=[]
 for(const text of ['我把作品集链接发给导师了，对方还没回复。','导师回复说手机打不开链接。','我发了PDF，导师确认已经读到。']){
  const run=(await store.startRun(actor,chat,randomUUID(),text)).run,source={messageId:run.source_message_id,quote:text};ids.push(run.source_message_id)
  const target=event?{operation:'continue' as const,eventId:event.id,expectedRevision:event.revision}:{operation:'create' as const,title:'作品集原链接',source}
  const coach=await stageCoachEvent(run,{target,nodes:[{kind:'fact',source}]},'分别保留当时报告。')
  event=(await store.finishRun(run,{candidates:[],audit:[],coach},'分别保留当时报告。',null,signal)).event
 }
 const view=await coachEventView(actor,second,event.id)
 assert.equal(view?.title,'作品集原链接')
 assert.equal(view?.actionStageScope?.basis,'latest_source_report_only')
 assert.equal(view?.actionStageScope?.sourceMessageId,ids[2])
 const reports=view!.actionProgressReports!
 assert.equal(reports.find(r=>r.sourceMessageId===ids[0])!.stages.read,null)
 assert.equal(reports.find(r=>r.sourceMessageId===ids[0])!.stages.replied,false)
 assert.equal(reports.find(r=>r.sourceMessageId===ids[1])!.stages.read,null)
 assert.equal(reports.find(r=>r.sourceMessageId===ids[1])!.stages.sent,null,'no send stage inherited from the previous source')
 assert.equal(reports.find(r=>r.sourceMessageId===ids[2])!.stages.read,true)
 assert.ok(reports.find(r=>r.sourceMessageId===ids[2])!.sourceQuotes.some(q=>q.includes('PDF')))
 assert.ok(!view!.nodes.some(n=>n.source?.messageId===ids[0]&&n.supersededByActionCorrection),'a later distinct delivery cannot invalidate the old report')
 assert.deepEqual((await coachEventView(actor,chat,event.id))?.actionProgressReports,reports)
 const ambiguous=(await store.startRun(actor,chat,randomUUID(),'导师已经读到，同学还没有读到。')).run,source={messageId:ambiguous.source_message_id,quote:'导师已经读到，同学还没有读到。'}
 const coach=await stageCoachEvent(ambiguous,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source}]},'这条报告对象不同，分别核对。')
 const committed=await store.finishRun(ambiguous,{candidates:[],audit:[],coach},'这条报告对象不同，分别核对。',null,signal)
 assert.deepEqual(committed.event!.actionStages,{sent:null,read:null,replied:null,used:null,effect:null})
 assert.equal(committed.event!.actionStageScope!.sourceMessageId,ambiguous.source_message_id)
 assert.ok(committed.event!.actionProgressReports!.some(r=>r.sourceMessageId===ambiguous.source_message_id&&r.sourceQuotes.includes(source.quote)))
 event=committed.event
 for(let index=0;index<8;index++){
  const run=(await store.startRun(actor,chat,randomUUID(),'按上次，我已经发了消息，对方已经读了。第'+index+'次补充报告。')).run
  // A process-only revision must remain in the API after falling outside the
  // short prompt history; no fact node supplies an alternate source pointer.
  const coach=await stageCoachEvent(run,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision}},'分别保留这次报告。')
  event=(await store.finishRun(run,{candidates:[],audit:[],coach},'分别保留这次报告。',null,signal)).event
 }
 const complete=await coachEventView(actor,second,event.id)
 assert.equal(complete!.actionProgressReports!.length,12)
 assert.equal(complete!.actionProgressReports![0].sourceMessageId,ids[0])
 assert.equal(complete!.actionProgressReports![3].sourceMessageId,ambiguous.source_message_id)
 assert.deepEqual((await coachEventView(actor,chat,event.id))!.actionProgressReports,complete!.actionProgressReports)
 const mixedText='导师没有回复作品集链接；后来导师已经读了PDF。',mixed=(await store.startRun(actor,chat,randomUUID(),mixedText)).run
 const mixedCoach=await stageCoachEvent(mixed,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:mixed.source_message_id,quote:mixedText}}]},'这条来源含不同材料，分别保留原话。')
 const mixedResult=await store.finishRun(mixed,{candidates:[],audit:[],coach:mixedCoach},'这条来源含不同材料，分别保留原话。',null,signal)
 assert.deepEqual(mixedResult.event!.actionStages,{sent:null,read:null,replied:null,used:null,effect:null})
 assert.ok(mixedResult.event!.actionProgressReports!.at(-1)!.scopeAmbiguities!.includes('multiple_material_forms'))
 assert.ok(mixedResult.event!.actionProgressReports!.at(-1)!.sourceQuotes.includes(mixedText),'ambiguous fields never delete the original report')
})
