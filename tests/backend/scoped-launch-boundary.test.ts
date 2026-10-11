import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {config} from '../../server/config.ts'
import {model} from '../../server/model.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {growthContext,createGrowthItem} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {listControlRequests} from '../../server/memory-controls.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test('persisted V19 natural boundary failures repair authoritative state across three sessions',async()=>{
 await localEmbedding.start()
 const user='scoped-v19-'+randomUUID(),chats=[randomUUID(),randomUUID(),randomUUID()],oldURL=model.baseUrl,oldKey=config.apiKey
 let calls=0
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',x=>chunks.push(Buffer.from(x)));req.on('end',()=>{
  calls++;const payload=JSON.parse(Buffer.concat(chunks).toString()),ctx=JSON.parse(payload.messages[1].content),goal=ctx.clauses?.find((c:any)=>c.text==='我想完成课程作业')
  const output={reply:ctx.boundedReply?.choices[0]??'先保留你刚说的实际情况。',...(goal?{growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:goal.id}}]}:{})}
  const base={id:'synthetic-v19',object:'chat.completion.chunk',created:1,model:model.id}
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r))
 try{
  model.baseUrl='http://127.0.0.1:'+(fake.address() as any).port;config.apiKey='synthetic-local-only'
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  for(const id of chats)await store.createConversation(user,{id,title:'SYNTHETIC V19 scoped boundary'})
  const turn=async(chat:string,text:string)=>{const run=(await store.startRun(user,chat,randomUUID(),text)).run,input={run,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}};const r=await createTurnEngine({capabilityVerified:()=>true})(input);return store.finishRun(run,input.staged,r.text,r.usage,input.signal)}
  await turn(chats[0]!,'我想完成课程作业。我平常每周能拿出六小时，这周还剩两小时。')
  const original=await growthContext(user,chats[0]!),goal=original.find(x=>x.kind==='goal')!,budget=original.find(x=>x.text==='这周还剩两小时')!
  await turn(chats[1]!,'我已经把没完成的题列出来了，第五题还是不知道从哪里下手。')
  assert.ok((await growthContext(user,chats[1]!)).some(x=>x.text==='第五题还是不知道从哪里下手'&&x.kind==='context'))
  await turn(chats[1]!,'这周剩余时间要改成三十分钟。考试复习这周先停一下。')
  const corrected=await growthContext(user,chats[1]!),current=corrected.find(x=>x.status==='active'&&x.text.includes('三十分钟'))!
  assert.ok(current);assert.equal(current.kind,'constraint');assert.equal(current.timeBasis?.kind,'calendar_week')
  const retired=(await pool.query('SELECT status,text,revision FROM growth_items WHERE user_id=$1 AND id=$2',[user,budget.id])).rows[0]
  assert.equal(retired?.status,'paused');assert.equal(retired?.text,budget.text);assert.ok(retired.revision>budget.revision)
  const pause=corrected.find(x=>x.text==='考试复习这周先停一下')!.taskBoundary!
  assert.equal(pause.scope,'current_matter');assert.equal(pause.matterBinding,'needs_same_matter_confirmation');assert.ok(pause.expiresAt)
  await pool.query("UPDATE lifeos_model_state SET error_code='MODEL_REQUEST_FAILED',retry_until=now()+interval '15 seconds' WHERE id=1")
  const before=calls;await turn(chats[2]!,'上次那件作业的事我现在不打算接着做，先别再给它排任务了。');assert.equal(calls,before,'pure natural refusal remains available during provider cooldown without a generation')
  assert.equal((await pool.query('SELECT error_code FROM lifeos_model_state WHERE id=1')).rows[0].error_code,'MODEL_REQUEST_FAILED','zero-generation control must not pretend the provider recovered')
  await pool.query('UPDATE lifeos_model_state SET error_code=NULL,retry_until=NULL WHERE id=1')
  assert.ok((await listControlRequests(user)).some(x=>x.status==='pending'&&x.candidates.some(c=>c.itemId===goal.id)))
  await turn(chats[2]!,'你记得这周剩余多少时间吗？只按我报告的情况回答。')
  await turn(chats[2]!,'暂停考试复习这一周，是不是等于我永久放弃考试方向？')
  assert.ok((await listControlRequests(user)).some(x=>x.status==='pending'),'read-only questions retain the pending stop confirmation')
  assert.ok(!(await growthContext(user,chats[2]!)).some(x=>x.kind==='goal'&&/是不是|只按我报告/.test(x.text)),'read-only and hypothetical questions cannot become pursuits')
  await turn(chats[2]!,'我只是想说说卡在那道题的烦躁，今天请先听我说。')
  const final=await growthContext(user,chats[2]!);assert.ok(final.some(x=>x.id===goal.id&&x.text==='我想完成课程作业'));assert.ok(!final.some(x=>x.kind==='goal'&&/不想接着做|只是想说说/.test(x.text)));assert.ok(final.some(x=>x.text.includes('每周能拿出六小时')))
  const other='scoped-context-'+randomUUID(),otherChat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[other,other+'@example.invalid'])
  await setMemorySettings(other,{requestId:randomUUID(),enabled:true,expectedRevision:0});await store.createConversation(other,{id:otherChat,title:'SYNTHETIC context target'})
  const originalContext=await createGrowthItem(other,{requestId:randomUUID(),conversationId:otherChat,kind:'context',text:'想用校内邮箱请教学长课程项目如何整理成实习作品'})
  const stopRun=(await store.startRun(other,otherChat,randomUUID(),'之前那件请教学长的事我暂时不打算继续做，别再给它安排任务了。')).run
  const stopInput={run:stopRun,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(stopRun),decision:null,signal:new AbortController().signal,emit:()=>{}}
  const stopReply=await createTurnEngine({capabilityVerified:()=>true})(stopInput);await store.finishRun(stopRun,stopInput.staged,stopReply.text,stopReply.usage,stopInput.signal)
  assert.ok((await listControlRequests(other)).some(x=>x.status==='pending'&&x.candidates.some(c=>c.itemId===originalContext.id)),'an owned matter recorded as context still receives a durable target confirmation')
 }finally{model.baseUrl=oldURL;config.apiKey=oldKey;fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()))}
})
test.after(async()=>{await localEmbedding.close();await pool.end()})
