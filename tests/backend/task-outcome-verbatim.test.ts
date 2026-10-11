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
import {boundedOrdinaryReply,boundedPlanningReply} from '../../server/bounded-reply.ts'
import {growthView} from '../../server/growth.ts'
import {knowledgeIntent} from '../../server/evergreen-guide.ts'
import {deriveTurnContract} from '../../server/turn-contract.ts'

test('omitted read/response/adoption reports persist independently and remain in new-session authorized context',async()=>{
 await localEmbedding.start()
 const requests:any[]=[],outputs:any[]=[],engine=createTurnEngine({capabilityVerified:()=>true})
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{requests.push(JSON.parse(Buffer.concat(chunks).toString()));const value=outputs.shift();res.writeHead(200,{'Content-Type':'text/event-stream'});const base={id:'synthetic-outcome',object:'chat.completion.chunk',created:1,model:model.id};res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(value)},finish_reason:null}]})+'\n\n');res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:80,total_tokens:280}})+'\n\ndata: [DONE]\n\n')})})
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r))
 const oldUrl=model.baseUrl,oldKey=config.apiKey;model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-outcome-key'
 const user='outcome-'+randomUUID(),chat=randomUUID()
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1)',[user])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC outcome'})
  const opening='我想探索自由职业接单。',openRun=(await store.startRun(user,chat,randomUUID(),opening)).run,openStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:'可以先说一个想核对的接单问题。',growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c0'}}]})
  const openResult=await engine({run:openRun,staged:openStaged,context:await store.contextForRun(openRun),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(openRun,openStaged,openResult.text,openResult.usage,new AbortController().signal)
  const goals=(await pool.query("SELECT id,text FROM growth_items WHERE user_id=$1 AND kind='goal' AND status='active'",[user])).rows
  assert.equal(goals.length,1,'model fact plus server capture produce one actual goal')
  const defer=(await store.startRun(user,chat,randomUUID(),'实习稍后再看，也不要给我别的方法。')).run,deferStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:'先保留实习延后的安排，也不追加方法。',growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c0'}},{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c1'}}]})
  const deferred=await engine({run:defer,staged:deferStaged,context:await store.contextForRun(defer),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(defer,deferStaged,deferred.text,deferred.usage,new AbortController().signal)
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1 AND kind='goal' AND (text LIKE '%稍后%' OR text LIKE '%别的方法%')",[user])).rows[0].n,0)
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_themes WHERE user_id=$1 AND (title LIKE '%实习%' OR title LIKE '%方法%')",[user])).rows[0].n,0)
  const text='我通过学校邮箱请教学长甲，原请求是了解项目课。对方已经读了，但没有回复，也没有采用。'
  const run=(await store.startRun(user,chat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]}
  const bounded=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!
  outputs.push({reply:bounded.choices[0]})
  const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(run,staged,result.text,result.usage,new AbortController().signal)
  const facts=(await pool.query('SELECT text FROM growth_items WHERE user_id=$1 AND status=\'active\'',[user])).rows.map(r=>r.text)
  for(const quote of ['对方已经读了','但没有回复','也没有采用'])assert.ok(facts.includes(quote),quote)
  const next=randomUUID();await store.createConversation(user,{id:next,title:'SYNTHETIC correction'})
  const correction='我更正，对方是否采用我不知道。',second=(await store.startRun(user,next,randomUUID(),correction)).run,secondStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:boundedOrdinaryReply({text:correction,intent:knowledgeIntent(correction),contract:deriveTurnContract({text:correction,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]})
  const revised=await engine({run:second,staged:secondStaged,context:await store.contextForRun(second),decision:null,signal:new AbortController().signal,emit:()=>{}})
  const sent=JSON.parse(requests.at(-1).messages.find((m:any)=>m.role==='user').content)
  assert.ok(JSON.stringify(sent.growth).includes('对方已经读了')||JSON.stringify(sent.growthBackground).includes('对方已经读了'))
  await store.finishRun(second,secondStaged,revised.text,revised.usage,new AbortController().signal)
  const after=(await pool.query('SELECT text FROM growth_items WHERE user_id=$1 AND status=\'active\'',[user])).rows.map(r=>r.text)
  assert.ok(after.includes('对方已经读了'));assert.ok(after.includes('但没有回复'))
  assert.ok(after.some(t=>t.includes('是否采用我不知道')))
  assert.ok(!after.includes('也没有采用'),'a narrow correction must supersede the earlier negative outcome')
  const stopped=(await store.startRun(user,next,randomUUID(),'我改变方向，我决定本阶段就业优先，不再把自由职业作为主线。')).run,stopStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:boundedOrdinaryReply({text:'我改变方向，我决定本阶段就业优先，不再把自由职业作为主线。',intent:knowledgeIntent('我改变方向，我决定本阶段就业优先，不再把自由职业作为主线。'),contract:deriveTurnContract({text:'我改变方向，我决定本阶段就业优先，不再把自由职业作为主线。',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]})
  const stopResult=await engine({run:stopped,staged:stopStaged,context:await store.contextForRun(stopped),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(stopped,stopStaged,stopResult.text,stopResult.usage,new AbortController().signal)
  assert.equal((await pool.query('SELECT state FROM growth_direction_controls WHERE user_id=$1 AND scope=$2',[user,'freelance'])).rows[0].state,'paused')
  assert.equal((await pool.query('SELECT status FROM growth_items WHERE user_id=$1 AND id=$2',[user,goals[0].id])).rows[0].status,'paused')
  assert.equal((await pool.query("SELECT status FROM user_themes WHERE user_id=$1 AND source_refs @> $2::jsonb",[user,JSON.stringify([{growthItemId:goals[0].id}])])).rows[0].status,'paused')
  const budget=(await store.startRun(user,next,randomUUID(),'我本周只剩九十分钟可用，请帮我安排本周课程与备考。')).run,budgetStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:boundedPlanningReply({minutes:90,period:'this_week'}).choices[0],growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}],weeklyPlan:{target:{operation:'create'},availableMinutes:90,period:'this_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'课程复习',minutes:90,directionScopes:[]}]}})
  const budgetResult=await engine({run:budget,staged:budgetStaged,context:await store.contextForRun(budget),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(budget,budgetStaged,budgetResult.text,budgetResult.usage,new AbortController().signal)
  const earlier=(await pool.query("SELECT id FROM growth_items WHERE user_id=$1 AND kind='constraint' AND status='active' AND text LIKE '%九十分钟%'",[user])).rows[0]
  const zero=(await store.startRun(user,next,randomUUID(),'本周已经没有能用的时间了，可用时间是零，请帮我安排本周课程与备考。')).run,zeroStaged:store.Staged={candidates:[],audit:[]},beforeZero=requests.length
  const zeroResult=await engine({run:zero,staged:zeroStaged,context:await store.contextForRun(zero),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(zero,zeroStaged,zeroResult.text,zeroResult.usage,new AbortController().signal)
  assert.equal(requests.length,beforeZero)
  assert.equal((await pool.query('SELECT status FROM growth_items WHERE user_id=$1 AND id=$2',[user,earlier.id])).rows[0].status,'paused')
  const future=(await store.startRun(user,next,randomUUID(),'下周我有六小时可用。')).run,futureStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:'下周的可用时间与你这周的零时间分开保留。'})
  const futureResult=await engine({run:future,staged:futureStaged,context:await store.contextForRun(future),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(future,futureStaged,futureResult.text,futureResult.usage,new AbortController().signal)
  const upcoming=(await growthView(user,next)).items.find(i=>i.text==='下周我有六小时可用')!
  assert.equal(upcoming.status,'active');assert.equal(upcoming.unavailableReason,'not_yet_active')
  const listen=(await store.startRun(user,next,randomUUID(),'我请教导师的邮件已经发出去了，对方看过但没有回应。我现在只想聊聊感受，别建议我催。')).run,listenStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:'看过之后仍没有回应，心里悬着的感受可以慢慢说。'})
  const listened=await engine({run:listen,staged:listenStaged,context:await store.contextForRun(listen),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(listen,listenStaged,listened.text,listened.usage,new AbortController().signal)
  const listeningFacts=(await growthView(user,next)).items.map(i=>i.text)
  assert.ok(listeningFacts.includes('我请教导师的邮件已经发出去了'))
  assert.ok(listeningFacts.includes('对方看过但没有回应'))
  const editText='我想把访谈问题改成“你最近一次遇到这件事，最后怎么处理的？”',edit=(await store.startRun(user,next,randomUUID(),editText)).run,editStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:boundedOrdinaryReply({text:editText,intent:knowledgeIntent(editText),contract:deriveTurnContract({text:editText,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]})
  const edited=await engine({run:edit,staged:editStaged,context:await store.contextForRun(edit),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(edit,editStaged,edited.text,edited.usage,new AbortController().signal)
  assert.ok((await growthView(user,next)).items.some(i=>i.kind==='context'&&i.text===editText))
  await pool.query('UPDATE user_memory_settings SET enabled=false, revision=revision+1 WHERE user_id=$1',[user])
  const off=(await store.startRun(user,next,randomUUID(),'我问了导师乙，对方已经读了。我现在只想聊聊。')).run,offStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:'可以慢慢说。'})
  const offResult=await engine({run:off,staged:offStaged,context:await store.contextForRun(off),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(off,offStaged,offResult.text,offResult.usage,new AbortController().signal)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1 AND sources @> $2::jsonb',[user,JSON.stringify([{type:'message',id:off.source_message_id}])])).rows[0].n,0)
 }finally{model.baseUrl=oldUrl;config.apiKey=oldKey;fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()));await localEmbedding.close();await pool.end()}
})
