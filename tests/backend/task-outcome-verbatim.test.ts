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
import {readWorkflowEvidence} from '../../server/workflows/task-sources.ts'

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
  const task='我把海报交给客户了。客户已经用了，费用还没付。',delivered=(await store.startRun(user,chat,randomUUID(),task)).run,deliveredStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:boundedOrdinaryReply({text:task,intent:knowledgeIntent(task),contract:deriveTurnContract({text:task,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]})
  const deliveredResult=await engine({run:delivered,staged:deliveredStaged,context:await store.contextForRun(delivered),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(delivered,deliveredStaged,deliveredResult.text,deliveredResult.usage,new AbortController().signal)
  assert.ok((await store.cognitionGraph(user)).nodes.some((n:any)=>n.type==='value'&&n.title==='自由职业'),'positive clauses ending in 了 never retire a pursuit')
  const defer=(await store.startRun(user,chat,randomUUID(),'实习稍后再看，也不要给我别的方法。')).run,deferStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:'我在听。你接着说，按你想说的节奏来。',growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c0'}},{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c1'}}]})
  const deferred=await engine({run:defer,staged:deferStaged,context:await store.contextForRun(defer),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(defer,deferStaged,deferred.text,deferred.usage,new AbortController().signal)
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1 AND kind='goal' AND (text LIKE '%稍后%' OR text LIKE '%别的方法%')",[user])).rows[0].n,0)
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_themes WHERE user_id=$1 AND (title LIKE '%实习%' OR title LIKE '%方法%')",[user])).rows[0].n,0)
  const sentText='我已经通过学校邮箱向学长甲发了项目课能否提供实习作品的问题，发出已经三天，没有回复。',sentRun=(await store.startRun(user,chat,randomUUID(),sentText)).run,sentStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:boundedOrdinaryReply({text:sentText,intent:knowledgeIntent(sentText),contract:deriveTurnContract({text:sentText,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]})
  const sentResult=await engine({run:sentRun,staged:sentStaged,context:await store.contextForRun(sentRun),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(sentRun,sentStaged,sentResult.text,sentResult.usage,new AbortController().signal)
  const text='我通过学校邮箱请教学长甲，原请求是了解项目课。对方已经读了，但没有回复，也没有采用。'
  const run=(await store.startRun(user,chat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]}
  const bounded=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!
  outputs.push({reply:bounded.choices[0]})
  const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(run,staged,result.text,result.usage,new AbortController().signal)
  const facts=(await pool.query('SELECT text FROM growth_items WHERE user_id=$1 AND status=\'active\'',[user])).rows.map(r=>r.text)
  for(const quote of ['对方已经读了','但没有回复','也没有采用'])assert.ok(facts.includes(quote),quote)
  const observed=(await store.cognitionGraph(user)).nodes.find((n:any)=>n.type==='experience'&&n.sourceMessageId===sentRun.source_message_id) as any
  assert.ok(observed,'the actual sent event remains the same record')
  assert.equal(observed.taskOutcomes.read.status,'reported_read')
  assert.equal(observed.taskOutcomes.adoption.status,'reported_not_used')
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
  const correctedMap=(await store.cognitionGraph(user)).nodes.find((n:any)=>n.type==='experience'&&n.sourceMessageId===sentRun.source_message_id) as any
  assert.equal(correctedMap.taskOutcomes.read.status,'reported_read')
  assert.equal(correctedMap.taskOutcomes.adoption.status,'unknown')
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
  const earlier=(await pool.query("SELECT id,revision FROM growth_items WHERE user_id=$1 AND kind='constraint' AND status='active' AND text LIKE '%九十分钟%'",[user])).rows[0]
  const currentPlan=(await growthView(user,next)).items.find(i=>i.structuredPlan)!
  const repeat=(await store.startRun(user,next,randomUUID(),'这周我只有九十分钟可用。')).run,repeatStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:'当前时段仍按九十分钟理解。'})
  const repeated=await engine({run:repeat,staged:repeatStaged,context:await store.contextForRun(repeat),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(repeat,repeatStaged,repeated.text,repeated.usage,new AbortController().signal)
  assert.equal((await pool.query('SELECT status,revision FROM growth_items WHERE user_id=$1 AND id=$2',[user,earlier.id])).rows[0].revision,earlier.revision,'equivalent restatement preserves original revision')
  assert.equal((await growthView(user,next)).items.find(i=>i.id===currentPlan.id)!.status,'proposed','equivalent availability must not stale a plan')
  const ref={type:'message' as const,id:repeat.source_message_id,revision:1,quote:'这周我只有九十分钟可用'}
  const evidenceRequest={internalActorKey:user,conversationId:next,authorizedEvidenceRefs:[ref]} as any
  assert.deepEqual((await readWorkflowEvidence(evidenceRequest))[0].ref,ref,'verified authorized quote is not dropped before cloud signing')
  assert.equal((await readWorkflowEvidence({...evidenceRequest,authorizedEvidenceRefs:[{...ref,revision:2}]})).length,0,'immutable message rejects wrong revision')
  const wish=(await store.startRun(user,next,randomUUID(),'我想探索自由职业接单，先确认需求与交付范围，怎么开始？')).run
  await assert.rejects(store.stageCandidate(wish,{candidates:[],audit:[]},{sourceMessageId:wish.source_message_id,quote:'先确认需求与交付范围',links:[],content:{action:'先确认需求与交付范围',result:'先确认需求与交付范围',occurredAt:''}}),/PLANNED_ACTION_IS_NOT_EXPERIENCE/)
  await store.finishRun(wish,{candidates:[],audit:[]},'先把需求范围作为拟核对事项。',null,new AbortController().signal)
  const zero=(await store.startRun(user,next,randomUUID(),'本周没有可用时间，可用时间是零，请帮我安排本周课程与备考。')).run,zeroStaged:store.Staged={candidates:[],audit:[]},beforeZero=requests.length
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
  outputs.push({reply:'我在听。你接着说，按你想说的节奏来。'})
  const listened=await engine({run:listen,staged:listenStaged,context:await store.contextForRun(listen),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(listen,listenStaged,listened.text,listened.usage,new AbortController().signal)
  const listeningFacts=(await growthView(user,next)).items.map(i=>i.text)
  assert.ok(listeningFacts.includes('我请教导师的邮件已经发出去了'))
  assert.ok(listeningFacts.includes('对方看过但没有回应'))
  const graph=await store.cognitionGraph(user)
  const email=graph.nodes.find((n:any)=>n.type==='experience'&&n.action?.includes('邮件')) as any
  assert.ok(email,'own completed contact persists while listening')
  assert.equal(email.result,'对方看过但没有回应')
  assert.equal(email.insight.nextStep,'')
  assert.equal(email.taskOutcomes.read.status,'reported_read')
  assert.equal(email.taskOutcomes.response.status,'reported_no_response')
  for(const key of ['adoption','payment','effect'])assert.equal(email.taskOutcomes[key].status,'unknown')
  const editText='我想把访谈问题改成“你最近一次遇到这件事，最后怎么处理的？”',edit=(await store.startRun(user,next,randomUUID(),editText)).run,editStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:boundedOrdinaryReply({text:editText,intent:knowledgeIntent(editText),contract:deriveTurnContract({text:editText,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]})
  const edited=await engine({run:edit,staged:editStaged,context:await store.contextForRun(edit),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(edit,editStaged,edited.text,edited.usage,new AbortController().signal)
  assert.ok((await growthView(user,next)).items.some(i=>i.kind==='context'&&i.text===editText))
  const stoppedInterview=(await store.startRun(user,next,randomUUID(),'这次访谈我暂时不继续，也不要给我其他方法。')).run,stopInterviewStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:'我在听。你接着说，按你想说的节奏来。'})
  const pausedInterview=await engine({run:stoppedInterview,staged:stopInterviewStaged,context:await store.contextForRun(stoppedInterview),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(stoppedInterview,stopInterviewStaged,pausedInterview.text,pausedInterview.usage,new AbortController().signal)
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM growth_recommendation_controls WHERE user_id=$1 AND state='stopped' AND source_message_id=$2",[user,stoppedInterview.source_message_id])).rows[0].n,1)
  const advance=async(text:string)=>{
   const run=(await store.startRun(user,next,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]}
   outputs.push({reply:boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]})
   const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}})
   const oldAdvanced=process.env.LIFEOS_ADVANCED_WORKFLOWS
   process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
   try{await store.finishRun(run,staged,result.text,result.usage,new AbortController().signal)}
   finally{if(oldAdvanced===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=oldAdvanced}
   return run
  }
  await advance('我本周把课程放在前面，课程优先，只有九十分钟可用。')
  assert.ok((await growthView(user,next)).items.some(i=>i.kind==='goal'&&i.text==='课程优先'&&i.status==='active'))
  await advance('我还没有开始这次课程复习，老师给的资料链接打不开。')
  const attemptedRun=await advance('我已经尝试这次课程复习，但遇到第一道题卡住了。')
  const editRun=await advance('我想把验证问题改成上一次遇到什么困难，不再问愿不愿意用。')
  assert.ok((await growthView(user,next)).items.some(i=>i.kind==='context'&&i.text==='我想把验证问题改成上一次遇到什么困难'))
  const refuseRun=await advance('按上次办法，我不想继续了。')
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM growth_recommendation_controls WHERE user_id=$1 AND state='stopped' AND source_message_id=$2",[user,refuseRun.source_message_id])).rows[0].n,1)
  assert.ok((await growthView(user,next)).items.some(i=>i.text==='我不想继续了'&&i.recommendationStopped))
  const experienceCount=(await pool.query('SELECT count(*)::int AS n FROM experiences WHERE user_id=$1',[user])).rows[0].n
  await advance('还是上次那件请教的事，我先只想说说近况。')
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM experiences WHERE user_id=$1',[user])).rows[0].n,experienceCount)
  assert.ok(!(await growthView(user,next)).items.some(i=>i.text==='我先只想说说近况'),'ephemeral conversation preference is neither growth nor a pursuit')
  const advancedFacts=(await growthView(user,next)).items
  assert.equal(advancedFacts.find(i=>i.text==='我还没有开始这次课程复习')!.status,'paused')
  const attemptReceipt=(await pool.query('SELECT response FROM runs WHERE user_id=$1 AND request_id=$2',[user,attemptedRun.request_id])).rows[0].response
  assert.ok(attemptReceipt.stateChange.growth.changedIds.includes(advancedFacts.find(i=>i.text==='我还没有开始这次课程复习')!.id))
  assert.ok(attemptReceipt.stateChange.growthDiff.some((d:any)=>d.change==='withdrawn'&&d.itemId===advancedFacts.find(i=>i.text==='我还没有开始这次课程复习')!.id))
  assert.ok(advancedFacts.some(i=>i.text==='我已经尝试这次课程复习'&&i.status==='active'))
  assert.ok((await store.cognitionGraph(user)).nodes.some((n:any)=>n.type==='experience'&&n.action==='我已经尝试这次课程复习'))
  const zeroListen=await advance('我这周零分钟可用，先别分析创业了，只想说说最近的压力。')
  assert.ok((await growthView(user,next)).items.some(i=>i.kind==='constraint'&&i.text==='我这周零分钟可用'&&i.status==='active'))
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM experiences WHERE user_id=$1 AND source_message_id=$2',[user,zeroListen.source_message_id])).rows[0].n,0)
  await pool.query('UPDATE user_memory_settings SET enabled=false, revision=revision+1 WHERE user_id=$1',[user])
  const off=(await store.startRun(user,next,randomUUID(),'我问了导师乙，对方已经读了。我现在只想聊聊。')).run,offStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:'我在听。你接着说，按你想说的节奏来。'})
  const offResult=await engine({run:off,staged:offStaged,context:await store.contextForRun(off),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(off,offStaged,offResult.text,offResult.usage,new AbortController().signal)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1 AND sources @> $2::jsonb',[user,JSON.stringify([{type:'message',id:off.source_message_id}])])).rows[0].n,0)
  const contactUser='generic-contact-'+randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[contactUser,contactUser+'@example.invalid'])
  await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1)',[contactUser])
  for(const text of ['我想向学长丙请教项目课对实习的帮助。','按上次办法，我已经发了消息，四天还没有回复。','我通过学校邮箱请教学长丙，原请求是想知道项目课能否提供实习作品。对方已经读了，但没有回复。']){
   const conversation=randomUUID();await store.createConversation(contactUser,{id:conversation,title:'synthetic contact continuity'})
   const run=(await store.startRun(contactUser,conversation,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]}
   outputs.push({reply:boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})?.choices[0]??'先保留当前请教目标。'})
   const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}})
   await store.finishRun(run,staged,result.text,result.usage,new AbortController().signal)
   if(text.includes('四天'))assert.equal(((await store.cognitionGraph(contactUser)).nodes.find((n:any)=>n.type==='experience') as any).taskOutcomes.response.status,'reported_no_response','intermediate no-response report is not delayed until later reading')
  }
  const genericExperience=(await store.cognitionGraph(contactUser)).nodes.find((n:any)=>n.type==='experience') as any
  assert.equal(genericExperience.taskOutcomes.read.status,'reported_read')
  assert.equal(genericExperience.taskOutcomes.response.status,'reported_no_response')
  for(const outcome of ['adoption','payment','effect'])assert.equal(genericExperience.taskOutcomes[outcome].status,'unknown')
  const interviewUser='interview-'+randomUUID(),interviewChat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[interviewUser,interviewUser+'@example.invalid'])
  await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1)',[interviewUser])
  await store.createConversation(interviewUser,{id:interviewChat,title:'synthetic interview source guards'})
  const interviewStart='我想探索校园项目，先了解同学实际遇到的麻烦，怎么开始？'
  const interviewOpen=(await store.startRun(interviewUser,interviewChat,randomUUID(),interviewStart)).run,interviewStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:boundedOrdinaryReply({text:interviewStart,intent:knowledgeIntent(interviewStart),contract:deriveTurnContract({text:interviewStart,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0],growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c0'}},{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c2'}}]})
  const interviewOpened=await engine({run:interviewOpen,staged:interviewStaged,context:await store.contextForRun(interviewOpen),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(interviewOpen,interviewStaged,interviewOpened.text,interviewOpened.usage,new AbortController().signal)
  assert.ok(!(await growthView(interviewUser,interviewChat)).items.some(i=>i.text==='怎么开始'))
  assert.ok((await growthView(interviewUser,interviewChat)).items.some(i=>i.text==='我想探索校园项目'))
  const interviewDone='我已经访谈了一名同学，他说有兴趣，但尚未采用，也没有付款。'
  const interviewRun=(await store.startRun(interviewUser,interviewChat,randomUUID(),interviewDone)).run,interviewDoneStaged:store.Staged={candidates:[],audit:[]}
  outputs.push({reply:boundedOrdinaryReply({text:interviewDone,intent:knowledgeIntent(interviewDone),contract:deriveTurnContract({text:interviewDone,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]})
  const interviewResult=await engine({run:interviewRun,staged:interviewDoneStaged,context:await store.contextForRun(interviewRun),decision:null,signal:new AbortController().signal,emit:()=>{}})
  await store.finishRun(interviewRun,interviewDoneStaged,interviewResult.text,interviewResult.usage,new AbortController().signal)
  const interviewExperience=(await store.cognitionGraph(interviewUser)).nodes.find((n:any)=>n.type==='experience') as any
  assert.equal(interviewExperience.taskOutcomes.response.status,'reported_response')
  for(const dimension of ['read','effect'])assert.equal(interviewExperience.taskOutcomes[dimension].status,'unknown')
 }finally{model.baseUrl=oldUrl;config.apiKey=oldKey;fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()));await localEmbedding.close();await pool.end()}
})
