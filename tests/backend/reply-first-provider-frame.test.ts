import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {Value} from 'typebox/value'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import {configureProviderPayload} from '../../server/model-payload.ts'
import {streamingReplyText} from '../../server/reply-stream.ts'
import {parseActionCoachTurn} from '../../server/action-coach-contracts.ts'
import {boundedDistinctionReply} from '../../server/review-repairs.ts'
import {model} from '../../server/model.ts'
import {buildTurnPrompt,DIRECT_ORDINARY_REPLY_RULES,GROUNDED_ORDINARY_STREAMING_RULE,MATTER_REPORT_RULE,MATTER_FEEDBACK_RULE,PERSISTENCE_RECEIPT_RULE,ORDINARY_REPLY_FIELD,SEMANTIC_DELIVERY_RULES,providerTurnMessages,REPLY_FIRST_STREAMING_RULE} from '../../server/turn-prompt.ts'
import {directOrdinaryPolicy,mainCompanionPolicy} from '../../server/companion-policy.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {pool} from '../../server/db.ts'
import {growthView} from '../../server/growth.ts'
import * as store from '../../server/store.ts'

function plainReplySchema(schema:any){return schema.properties.answer?.anyOf[0]?.properties.deliver??schema.properties.reply}

test('ordinary semantic closure streams reply before hidden facts in the same provider frame',async()=>{
 const h=await residualHarness()
 try{
  const {user,chat}=await h.account()
  const input='我是21岁的大三数学专业学生。我会用Excel。现在我想核对已保存的考研资料，今天我只有十分钟，没法联网。请先帮我选一个今天能开始的小步骤。'
  const frame={
   reply:'先在Excel列出一份本地资料的文件名，十分钟到点就停；是否有遗漏仍未知。',
   growthUpdates:[
    {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c1'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'goal',source:{clauseId:'c2'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c4'}},
   ],
   event:{target:{operation:'create',title:'核对已保存的考研资料',source:{clauseId:'c2'}},factRefs:[0,1,2,3],matterReports:[]},
  }
  await h.execute(user,chat,input,{growthUpdates:frame.growthUpdates,event:frame.event},frame.reply)
  assert.equal(h.requests.length,1,'reply and semantic extraction stay in one provider call')
  const schema=h.requests[0].response_format.json_schema.schema
  assert.equal(Object.keys(schema.properties)[0],'answer','the single answer precedes persistence metadata')
  assert.equal(Value.Check(schema,{answer:{deliver:frame.reply},growthUpdates:frame.growthUpdates,event:frame.event}),true,'the wire retains the complete fact and event contract')
  assert.equal(streamingReplyText(JSON.stringify({answer:{deliver:frame.reply}}).slice(0,-1)+',"growthUpdates":[',['c0']),frame.reply,'the host can surface the full reply while the same JSON frame is still generating metadata')
  const descriptions:string[]=[]
  const visit=(value:unknown)=>{
   if(!value||typeof value!=='object')return
   if(typeof (value as {description?:unknown}).description==='string')descriptions.push((value as {description:string}).description)
   for(const child of Object.values(value))visit(child)
  }
  visit(schema)
  assert.deepEqual(descriptions,[ORDINARY_REPLY_FIELD],'the reply field retains its concise delivery contract without duplicating the system policy')
  assert.ok(JSON.stringify(schema).length<12000,'the ordinary native frame must not resend a second prose policy inside JSON Schema')

  const direct=await h.account()
  await h.execute(direct.user,direct.chat,'小组项目的任务描述太含糊，我想先把交付标准问清楚。你建议我从哪一点开始？',{},'先问负责人怎样判断交付合格。把对方确认的一项标准写进交付说明。')
  const directRequest=h.requests.at(-1)
  assert.equal(directRequest.response_format.type,'json_schema')
  const directSystem=directRequest.messages.find((message:any)=>message.role==='system').content
  assert.ok(directSystem.includes(directOrdinaryPolicy.instructions))
  assert.ok(!directSystem.includes('missing with【】placeholders'))
  assert.ok(!directSystem.includes(mainCompanionPolicy.grilling.instructions))
  assert.ok(!directSystem.includes('lifeos-understanding-gaps/1.0.3'))
  assert.ok(directSystem.includes('建议、选择、执行、反馈和效果各自独立'))
  assert.deepEqual(Object.keys(directRequest.response_format.json_schema.schema.properties).slice(0,1),['answer'])
  assert.ok(directSystem.includes(DIRECT_ORDINARY_REPLY_RULES))
  assert.equal(directSystem.split(DIRECT_ORDINARY_REPLY_RULES).length,2)
  assert.ok(directSystem.indexOf(directOrdinaryPolicy.instructions)<directSystem.indexOf(DIRECT_ORDINARY_REPLY_RULES))
  assert.ok(!directSystem.includes(SEMANTIC_DELIVERY_RULES))
  assert.ok(directSystem.includes(MATTER_FEEDBACK_RULE))
  assert.ok(directSystem.includes(PERSISTENCE_RECEIPT_RULE))
  if(directRequest.response_format.json_schema.schema.properties.event?.properties.matterReports)assert.ok(directSystem.includes(MATTER_REPORT_RULE))
  assert.ok(directSystem.indexOf(DIRECT_ORDINARY_REPLY_RULES)<directSystem.indexOf(GROUNDED_ORDINARY_STREAMING_RULE))
  assert.ok(directSystem.indexOf(DIRECT_ORDINARY_REPLY_RULES)<directSystem.lastIndexOf('只输出符合原生Schema的实际数据'))
  assert.ok(!JSON.stringify(directRequest.response_format).includes('普通短问先交付'))
  assert.equal(directRequest.response_format.json_schema.schema.properties.answer.description,ORDINARY_REPLY_FIELD)
  assert.equal(directRequest.enable_thinking,false)
  assert.equal(directRequest.thinking_budget,undefined)

  const observedCheck='第一次找齐需要的信息用了几秒。'
  for(const [input,reply,goal] of [
   ['我用过彩色标签复习，分了四种颜色，后来反而找不到想看的重点。下次怎么调整？','下次只用一种标签标出要回看的内容，再用同一份笔记核对找重点的时间。','adjust'],
   ['我试着把讲题视频倍速看完，题型记住了，遇到变形题仍不会。有什么小办法验证问题在哪里？','盖住答案，各做一道原题和变式题，记录各自最先卡住的一步。','locate'],
   ['上次项目讨论我记了满页结论，回来才发现没有记录谁负责。下次记录要改哪一项？','每条需要执行的结论旁加一栏负责人，当场核对。','adjust'],
  ] as const){
   const account=await h.account()
   const output=goal==='locate'?{answer:{locate:{baseline:'盖住答案，独立做一道原题。',comparison:'盖住答案，独立做一道变式题。',record:{lastStep:'各自最后完成的一步',firstStop:'各自最先卡住的一步',firstDifference:'最早差异，没有就写无'}}}}:{answer:{adjust:{change:reply,check:observedCheck}}}
   const run=await h.execute(account.user,account.chat,input,JSON.stringify(output))
   const request=h.requests.at(-1)
   const schema=request.response_format.json_schema.schema
   assert.deepEqual(Object.keys(schema.properties).slice(0,1),['answer'],input)
   assert.equal(Value.Check(schema,output),true)
   assert.equal(Value.Check(schema,{answer:{...output.answer,deliver:'重复的正文'}}),false)
   assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[account.user,run.request_id])).rows,[{content:goal==='locate'?'盖住答案，独立做一道原题。\n\n保持第一次的其他条件，做第二次尝试：盖住答案，独立做一道变式题。\n\n记录项：\n- 各自最后完成的一步\n- 各自最先卡住的一步\n- 最早差异，没有就写无':reply+'\n\n这次记录：'+observedCheck}])
  }

  for(const [text,reply] of [
   ['我和队友分头写一份报告，已经撞了两个小节。怎样在下次碰头时把分工理顺？','先把重叠的两节圈出来。碰头时逐节确认谁主写、谁提供已有材料，并在共享大纲记下结果。'],
   ['组会前我能改图也能补分析，但听众第一次接触这个项目。你会优先怎么改？','先改图。把首次接触项目的人需要知道的一个结论写成图标题。'],
  ]){
   const account=await h.account()
   const run=await h.execute(account.user,account.chat,text,{},reply)
   const request=h.requests.at(-1)
   const schema=request.response_format.json_schema.schema
   const audit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[account.user,run.request_id])).rows[0].tool_audit
   assert.deepEqual(Object.keys(schema.properties).slice(0,1),['answer'],JSON.stringify(audit.map(({phase,mode,reason}:any)=>({phase,mode,reason}))))
   assert.ok(request.messages.find((message:any)=>message.role==='system').content.includes(directOrdinaryPolicy.instructions),text)
   if(text.includes('听众第一次接触')){
    const rules=request.messages.find((message:any)=>message.role==='system').content
    assert.match(rules,/首次接触等背景只能决定先核对什么/)
    assert.match(rules,/首句给判据或条件式取舍/)
   }
   assert.equal(Value.Check(plainReplySchema(schema),reply),true,JSON.stringify(plainReplySchema(schema)))
  }

  const malformed=await h.account()
  const choice='下午要决定是否报名社团活动。我感兴趣，但它和固定的实验课撞了半小时。帮我理清这次选择。'
  const choiceFields={check:'社团是否允许只参加不冲突的部分？',ifYes:'在实验课以外参加。',ifNo:'本次不报名，保留实验课。'}
  const exactReply='先核对：社团是否允许只参加不冲突的部分？\n\n如果是：在实验课以外参加。\n\n如果不是：本次不报名，保留实验课。'
  const beforeMalformed=h.requests.length
  const firstEvent=h.emitted.length
  const brokenOptional=(reply:string)=>'{"answer":'+JSON.stringify(reply===exactReply?{choose:choiceFields}:{deliver:reply})+',"growthUpdates":[{"source":'
  const reported='我是大三学生'
  const recovered=await h.execute(malformed.user,malformed.chat,reported+'。'+choice,brokenOptional(exactReply))
  assert.equal(h.requests.length,beforeMalformed+1)
  const recoverySchema=h.requests.at(-1).response_format.json_schema.schema
  assert.deepEqual(recoverySchema.required,['answer'])
  assert.ok(Object.hasOwn(recoverySchema.properties,'growthUpdates'))
  const persisted=await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[malformed.user,recovered.request_id])
  assert.deepEqual(persisted.rows,[{content:exactReply}])
  const events=h.emitted.slice(firstEvent)
  assert.ok(!events.some(event=>event.type==='draft_discarded'))
  const streamed=events.filter(event=>event.type==='draft'&&event.draftKind==='stream_reply').map(event=>event.text)
  assert.equal(streamed.at(-1),exactReply)
  assert.equal(streamed.filter(text=>text===exactReply).length,1)
  const rejection=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[malformed.user,recovered.request_id])).rows[0].tool_audit
  assert.ok(rejection.some((entry:any)=>entry.phase==='ordinary_reply_preserved_after_optional_json_error'))
  assert.ok(rejection.some((entry:any)=>entry.phase==='verbatim_task_fact_server_staged'))
  const savedFacts=(await growthView(malformed.user)).items.filter(item=>item.text===reported)
  assert.equal(savedFacts.length,1)
  assert.equal(savedFacts[0]?.assertion,'user_reported')
  assert.ok(savedFacts[0]?.sources.some(source=>source.type==='message'&&source.id===recovered.source_message_id))

  const prefix='{"answer":'+JSON.stringify({choose:choiceFields})
  for(const raw of [
   '{"answer":{"choose":"还没写完',
   JSON.stringify({reply:exactReply}),
   JSON.stringify({answer:{explain:exactReply}}),
   prefix+',"answer":{}}',
   prefix+',"\u0061nswer":{"deliver":"另一份正文"}}',
   prefix+',"\u0072eply":"另一份正文"}',
   prefix+',"growthUpdates":[],"growthUpdates":[]}',
   '{"answer":{"choose":"一","\u0063hoose":"二"}}',
   prefix+',"growthUpdates":[]],"reply":"另一份正文",',
   brokenOptional(exactReply)+'null}],"reply":"另一份正文",',
   brokenOptional(exactReply)+'null}],"\u0072e\u0070\u006Cy":"另一份正文",',
   brokenOptional(exactReply)+'null}],"a\u006eswer":{"deliver":"另一份正文"},',
  ]){
   const account=await h.account()
   await assert.rejects(h.execute(account.user,account.chat,choice,raw),/COACH_OUTPUT_INVALID/)
  }
  assert.equal(streamingReplyText('{"answer":{"locate":{}}}',[]),null)
  assert.equal(streamingReplyText('{"answer":{"unknown":"某个原因"},"reply":"'+exactReply+'"}',[]),null)
  assert.equal(streamingReplyText(prefix+',"event":',[]),exactReply)
  assert.equal(streamingReplyText(prefix+',"answer":',[]),null)
  const sections=[
   {sources:['c1'],content:'当前设备不能放映。'},
   {kind:'explanation',sources:['c0'],content:'设备没电，所以暂时无法放映。'},
   {kind:'hypothesis',content:'备用电源尚未接上。',check:'核对插接状态。'},
  ]
  const explain={observations:sections.slice(0,1),reasons:sections.slice(1)}
  const explanationWire=JSON.stringify({answer:{explain}})
  const explained='观察：当前设备不能放映。\n\n有依据的解释：设备没电，所以暂时无法放映。\n\n待验证假设：备用电源尚未接上。\n验证办法：核对插接状态。'
  assert.equal(streamingReplyText(explanationWire.replace('"explain"','"locate"'),['c0','c1']),null)
  assert.throws(()=>parseActionCoachTurn(explanationWire.replace('"explain"','"locate"'),{ordinaryAnswerSourceIds:['c0','c1']}),/ACTION_COACH_OUTPUT_INVALID/)
  assert.equal(streamingReplyText(JSON.stringify({answer:{explain:{observations:explain.observations,reasons:[]}}}),['c1']),null)
  assert.equal(streamingReplyText(explanationWire,['c1']),null)
  assert.throws(()=>parseActionCoachTurn(explanationWire,{ordinaryAnswerSourceIds:['c1']}),/ACTION_COACH_OUTPUT_INVALID/)
  assert.equal(streamingReplyText(explanationWire,['c0','c1']),explained)
  assert.deepEqual(parseActionCoachTurn(explanationWire,{ordinaryAnswerSourceIds:['c0','c1']}),{reply:explained})
  const historyContext=JSON.stringify({currentUserMessage:{id:'now',role:'user',text:'为什么？'},messages:[
   {id:'prior',role:'user',text:'设备没电，无法放映。老师说“是电缆坏了”。如果有电我再试。请用一句话回复。'},{id:'old-reply',role:'assistant',text:'可能是备用电源的问题。'},{id:'now',role:'user',text:'为什么？'},
  ]})
  const historyMetadata=JSON.parse(String(providerTurnMessages(historyContext,model,undefined,false,'',true)[0]!.content))
  assert.deepEqual(historyMetadata.messages,[{id:'prior',role:'user',answerSources:[{id:'h0_0',text:'设备没电'},{id:'h0_1',text:'无法放映'}]},{id:'old-reply',role:'assistant'},{id:'now',role:'user'}])
  const historyExplanation=explanationWire.replace('"c0"','"h0_0"')
  assert.equal(parseActionCoachTurn(historyExplanation,{ordinaryAnswerSourceIds:['c1','h0_0']}).reply,explained)
  assert.throws(()=>parseActionCoachTurn(historyExplanation.replace('"h0_0"','"h0_2"'),{ordinaryAnswerSourceIds:['c1','h0_0']}),/ACTION_COACH_OUTPUT_INVALID/)
  const historyAccount=await h.account()
  const historyText='投影仪已断电，幕布没有画面。'
  await h.execute(historyAccount.user,historyAccount.chat,historyText,{},'我知道了，当前幕布没有画面。')
  const historyOutput={observations:[{sources:['h0_1'],content:'幕布没有画面。'}],reasons:[{kind:'explanation',sources:['h0_0'],content:'投影仪断电，因此无法放映。'}]}
  const historyReply='观察：幕布没有画面。\n\n有依据的解释：投影仪断电，因此无法放映。'
  const historyCalls=h.requests.length,historyEvents=h.emitted.length
  const historyRun=await h.execute(historyAccount.user,historyAccount.chat,'为什么幕布没有画面？按上句解释。',JSON.stringify({answer:{explain:historyOutput}}))
  assert.equal(h.requests.length,historyCalls+1)
  assert.ok(h.emitted.slice(historyEvents).some(event=>event.type==='draft'&&Object.values(event).includes(historyReply)))
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[historyAccount.user,historyRun.request_id])).rows,[{content:historyReply}])
  const unlabeled=JSON.stringify({answer:{explain,deliver:'另一个未分类的原因。'}})
  assert.equal(streamingReplyText(unlabeled,['c0','c1']),null)
  assert.throws(()=>parseActionCoachTurn(unlabeled,{ordinaryAnswerSourceIds:['c0','c1']}),/ACTION_COACH_OUTPUT_INVALID/)
  const observationTest=JSON.stringify({answer:{locate:{baseline:'遮住答案，独立做原题。',comparison:'同样遮住答案，独立做变式。',record:{lastStep:'各次最后完成的一步',firstStop:'每题第一次停下的位置',firstDifference:'最早差异'}}}})
  assert.equal(streamingReplyText(observationTest.slice(0,observationTest.indexOf(',"comparison"')),['c0']),'遮住答案，独立做原题。')
  assert.equal(streamingReplyText(observationTest.slice(0,observationTest.indexOf(',"record"')),['c0']),'遮住答案，独立做原题。\n\n保持第一次的其他条件，做第二次尝试：同样遮住答案，独立做变式。')
  assert.equal(streamingReplyText(observationTest,['c0']),'遮住答案，独立做原题。\n\n保持第一次的其他条件，做第二次尝试：同样遮住答案，独立做变式。\n\n记录项：\n- 各次最后完成的一步\n- 每题第一次停下的位置\n- 最早差异')
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({answer:{locate:{baseline:exactReply,record:{lastStep:'最后一步',firstStop:'首次停点',firstDifference:'无差异'}}}}),{ordinaryAnswerSourceIds:['c0']}),/ACTION_COACH_OUTPUT_INVALID/)
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({answer:{locate:exactReply}}),{ordinaryAnswerSourceIds:['c0']}),/ACTION_COACH_OUTPUT_INVALID/)
  const partialAdjustment=JSON.stringify({answer:{adjust:{change:exactReply}}})
  assert.equal(streamingReplyText(partialAdjustment,[]),exactReply)
  assert.throws(()=>parseActionCoachTurn(partialAdjustment,{ordinaryAnswerSourceIds:[]}),/ACTION_COACH_OUTPUT_INVALID/)
  const measurement=JSON.stringify({answer:{adjust:{change:exactReply,check:'本次找到需要的信息用了几秒。'}}})
  assert.equal(streamingReplyText(measurement,[]),exactReply+'\n\n这次记录：本次找到需要的信息用了几秒。')
  assert.equal(parseActionCoachTurn(measurement,{ordinaryAnswerSourceIds:[]}).reply,exactReply+'\n\n这次记录：本次找到需要的信息用了几秒。')
  const partialChoice=JSON.stringify({answer:{choose:{check:choiceFields.check}}})
  assert.equal(streamingReplyText(partialChoice,[]),'先核对：社团是否允许只参加不冲突的部分？')
  assert.throws(()=>parseActionCoachTurn(partialChoice,{ordinaryAnswerSourceIds:[]}),/ACTION_COACH_OUTPUT_INVALID/)
  for(const goal of ['deliver','choose'])for(const reply of [undefined,'','   ']){
   const empty=JSON.stringify({answer:{[goal]:reply}})
   assert.equal(streamingReplyText(empty,[]),null)
   assert.throws(()=>parseActionCoachTurn(empty,{ordinaryAnswerSourceIds:[],allowEmptyReplyWithCompleteDraft:true}),/ACTION_COACH_OUTPUT_INVALID/)
  }
  const reordered=await h.account()
  const reorderedRun=await h.execute(reordered.user,reordered.chat,choice,JSON.stringify({answer:{choose:choiceFields}}))
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[reordered.user,reorderedRun.request_id])).rows,[{content:exactReply}])
  for(const claim of [
   '已保存你的活动安排。',
   '我已将安排加入成长档案。',
   '我把这项安排记到成长档案里了。',
   '我把你的安排保存到成长档案了。',
   '我把你的安排记在那儿了。',
   '资料已同步。',
   '根据你上次提过的计划，照原安排。',
   "I've saved that to your memory.",
  ]){
   const account=await h.account()
   const firstEvent=h.emitted.length
   await assert.rejects(h.execute(account.user,account.chat,choice,brokenOptional(claim)),/COACH_OUTPUT_INVALID/)
   assert.ok(!h.emitted.slice(firstEvent).some(event=>event.type==='draft'),claim)
   const saved=await pool.query("SELECT count(*)::int AS count FROM messages WHERE user_id=$1 AND role='assistant'",[account.user])
   assert.equal(saved.rows[0].count,0)
  }

  const noUsage=await h.account()
  const noUsageBefore=h.requests.length
  await assert.rejects(h.execute(noUsage.user,noUsage.chat,choice,brokenOptional(exactReply),undefined,undefined,{includeUsage:false}),/COACH_OUTPUT_INVALID/)
  assert.equal(h.requests.length,noUsageBefore+1)
  const truncated=await h.account()
  const truncatedBefore=h.requests.length
  await assert.rejects(h.execute(truncated.user,truncated.chat,choice,brokenOptional(exactReply),undefined,undefined,{finishReason:'length'}),/MODEL_OUTPUT_TRUNCATED/)
  assert.equal(h.requests.length,truncatedBefore+1)

  const discussion=await h.account()
  await assert.rejects(h.execute(discussion.user,discussion.chat,'只讨论，不要更新我的个人档案。'+choice,brokenOptional(exactReply)),/COACH_OUTPUT_INVALID/)
  assert.ok(!Object.hasOwn(h.requests.at(-1).response_format.json_schema.schema.properties,'growthUpdates'))

  const planned=await h.account()
  await assert.rejects(h.execute(planned.user,planned.chat,'我每周能拿出六小时，但这周只剩两小时，请帮我安排本周课程与备考。',brokenOptional(exactReply)),/COACH_OUTPUT_INVALID/)
  assert.ok(h.requests.at(-1).response_format.json_schema.schema.required.includes('weeklyPlan'))

  const detailed=await h.account()
  const detailedInput='小组任务为什么要先问清交付标准？请给三个理由，并分别说明适用情况。'
  const detailedReply='一是对齐交付物形态，适合一开始需求含糊时。二是明确验收证据，适合多个成果都能满足表面要求时。三是划清分工边界，适合多人并行容易做重时。'
  const detailedRun=await h.execute(detailed.user,detailed.chat,detailedInput,{},detailedReply)
  assert.doesNotMatch(plainReplySchema(h.requests.at(-1).response_format.json_schema.schema).description,/普通短问先交付/)
  assert.doesNotMatch(h.requests.at(-1).messages.at(-1).content,/本轮交付要求（内部）/)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[detailed.user,detailedRun.request_id])).rows,[{content:detailedReply}])

  const selfCheck=await h.account()
  const selfCheckReply='今晚你选择复习，放弃朋友约的电影。问自己：放弃的最佳替代有什么价值？用电影本能带给你的净收益核对答案。'
  await h.execute(selfCheck.user,selfCheck.chat,'课堂讲完了机会成本。我以为懂了，怎样用一个日常情境验证自己是真的懂？',{},selfCheckReply)
  const selfCheckRequest=h.requests.at(-1)
  const selfCheckSystem=selfCheckRequest.messages.find((message:any)=>message.role==='system').content
  assert.match(selfCheckSystem,/先给完整情境和判断题，再给简短核对依据/)
  assert.match(selfCheckSystem,/自测默认用一道开放判断题；用户要求单选时先核对只有一个正确选项/)
  assert.match(selfCheckSystem,/核对依据只给正确答案及判断条件，不主动列误答或把同义回答判错/)
  assert.match(selfCheckSystem,/核对只使用题设明确给出的资源与条件/)
  assert.match(selfCheckSystem,/不能据此推出放弃的收益必然增减/)
  assert.match(selfCheckSystem,/已选项省下的资源不算放弃的收益/)
  assert.match(selfCheckSystem,/保留原句的动作、对象、状态和不确定程度/)
  assert.match(selfCheckSystem,/不追加变体、额外方案或追问/)
  assert.match(selfCheckSystem,/用户要求更多例子、完整步骤或详细说明时，按其范围完整交付/)
  assert.match(selfCheckSystem,/显式要求优先于下面的普通短问默认/)
  assert.ok(selfCheckSystem.includes(GROUNDED_ORDINARY_STREAMING_RULE))
  assert.ok(!selfCheckRequest.messages.at(-1).content.includes(SEMANTIC_DELIVERY_RULES))
  assert.equal(selfCheckRequest.max_completion_tokens,8192)

  const tradeoff=await h.account()
  const tradeoffInput='我两次彩排都超时，删概念定义还是删第二个例子比较合适？帮我找一个判断依据。'
  await h.execute(tradeoff.user,tradeoff.chat,tradeoffInput,{},'先试拿掉第二个例子。只剩一个例子仍能讲清定义，就删第二个；少了它就讲不清时保留这个例子，改为缩短定义。')
  const tradeoffRequest=h.requests.at(-1)
  const tradeoffRules=tradeoffRequest.messages.find((message:any)=>message.role==='system').content
  assert.ok(tradeoffRules.includes(DIRECT_ORDINARY_REPLY_RULES))
  assert.match(tradeoffRules,/删前删后能否达到同一目标/)
  assert.match(tradeoffRules,/卡壳、走神或提问只作观察，不能据此断定内容冗余/)
  assert.match(tradeoffRules,/判据足以决定时，不追加第二套标准/)
  assert.match(tradeoffRules,/删掉一部分后若达不到目标，保留这部分并用同一标准核对另一删法/)
  assert.match(tradeoffRules,/不能据此断定另一部分写得不清楚或补猜原因/)
  assert.ok(tradeoffRequest.messages.at(-1).content.startsWith(tradeoffInput))
  assert.equal(plainReplySchema(tradeoffRequest.response_format.json_schema.schema).pattern,undefined)

  const evidenceOnly=await h.account()
  await h.execute(evidenceOnly.user,evidenceOnly.chat,'有人说课后打卡能改善记忆。我想核实这个说法。帮我找一个判断依据。',{},'找一项控制其他学习条件、只改变是否打卡的研究，看两组是否用同一种记忆测验。')
  assert.ok(h.requests.at(-1).messages.find((message:any)=>message.role==='system').content.includes(DIRECT_ORDINARY_REPLY_RULES))

  const trimming=await h.account()
  const trimmingInput='汇报彩排还超了半分钟。缩短背景介绍还是第二个案例更合适？'
  await h.execute(trimming.user,trimming.chat,trimmingInput,{},'缩短介绍后仍能听懂核心结论，就先缩介绍。介绍是理解案例的必要前提、第二个案例又没有新信息时，先压缩第二个案例。')
  const trimmingRequest=h.requests.at(-1)
  assert.ok(trimmingRequest.messages.at(-1).content.startsWith(trimmingInput))
  const trimmingSystem=trimmingRequest.messages.find((message:any)=>message.role==='system').content
  assert.ok(trimmingSystem.includes(DIRECT_ORDINARY_REPLY_RULES))
  assert.match(trimmingSystem,/删改文字不自定句数或字数/)
  assert.match(trimmingSystem,/数字前后一致/)
  assert.match(trimmingSystem,/用同一标准比较原表现与新做法的表现/)
  assert.equal(plainReplySchema(trimmingRequest.response_format.json_schema.schema).pattern,undefined)

  const fileCleanup=await h.account()
  await h.execute(fileCleanup.user,fileCleanup.chat,'本机有两个文件，分别叫定义和例子。删掉定义还是删掉例子更合适？',{},'先确认两个文件是否还在使用、是否可以恢复。保留有依赖或无法补回的文件，优先清理确认可恢复且用不上的文件。')
  assert.ok(h.requests.at(-1).messages.find((message:any)=>message.role==='system').content.includes(DIRECT_ORDINARY_REPLY_RULES))

  const semanticGuidance=(request:typeof h.requests[number],source:string)=>{
   const content=request.messages.at(-1).content
   assert.ok(content.startsWith(source))
   assert.ok(!content.includes(SEMANTIC_DELIVERY_RULES))
   const schema=request.response_format.json_schema.schema
   const guidance=schema.properties.answer?GROUNDED_ORDINARY_STREAMING_RULE:SEMANTIC_DELIVERY_RULES
   assert.equal(request.messages.filter((message:any)=>message.content.includes(guidance)).length,1)
   assert.ok(request.messages.find((message:any)=>message.role==='system').content.includes(guidance))
   return guidance
  }
  const closingProject=await h.account()
  const projectChoice={check:'这个问题会卡住使用者的主要流程吗？',ifYes:'先修。',ifNo:'先补一份最短可用说明，并在其中记下已知限制。'}
  const closingProjectReply='先核对：这个问题会卡住使用者的主要流程吗？\n\n如果是：先修。\n\n如果不是：先补一份最短可用说明，并在其中记下已知限制。'
  const beforeClosingProject=h.requests.length
  const closingProjectRun=await h.execute(closingProject.user,closingProject.chat,'课程项目要收尾，我分不清该修一个偶发的小问题，还是先把使用说明补上。怎样取舍？',{answer:{choose:projectChoice}},closingProjectReply)
  assert.equal(h.requests.length,beforeClosingProject+1)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[closingProject.user,closingProjectRun.request_id])).rows,[{content:closingProjectReply}])
  const closingProjectRequest=h.requests.at(-1)
  assert.equal(closingProjectRequest.max_completion_tokens,8192)
  const projectFrame=closingProjectRequest.response_format.json_schema.schema
  assert.deepEqual(Object.keys(projectFrame.properties).slice(0,1),['answer'])
  assert.ok(projectFrame.required.includes('answer'))
  const closingProjectSchema=projectFrame.properties.answer.anyOf[1].properties.choose
  semanticGuidance(closingProjectRequest,'课程项目要收尾，我分不清该修一个偶发的小问题，还是先把使用说明补上。怎样取舍？')
  assert.equal(Value.Check(closingProjectSchema,projectChoice),true)
  assert.equal(Value.Check(closingProjectSchema,{...projectChoice,anotherCriterion:'难不难复现'}),false)

  const scheduleChoice=await h.account()
  const scheduleInput='下午要决定是否报名社团活动。我感兴趣，但它和固定的实验课撞了半小时。帮我理清这次选择。'
  const scheduleReply='先确认社团能否错开与实验课重叠的半小时。如果允许，保留实验课再报名；如果必须全程参加，这次先不报。'
  const beforeSchedule=h.requests.length
  const scheduleRun=await h.execute(scheduleChoice.user,scheduleChoice.chat,scheduleInput,{},scheduleReply)
  assert.equal(h.requests.length,beforeSchedule+1)
  semanticGuidance(h.requests.at(-1),scheduleInput)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[scheduleChoice.user,scheduleRun.request_id])).rows,[{content:scheduleReply}])

  const sourceDecision=await h.account()
  const sourceDecisionInput='课程作业已经找到三篇文章，我总被新资料分心。怎么判断现在该停搜开始写？'
  await h.execute(sourceDecision.user,sourceDecision.chat,sourceDecisionInput,{},'先用已有三篇文章列出核心论点和各自依据。核心论点已有能引用的依据就先动笔，只有遇到具体证据缺口时再补搜。')
  const sourceDecisionRequest=h.requests.at(-1)

  const adjustment=await h.account()
  const adjustmentInput='我用过彩色标签复习，分了四种颜色，后来反而找不到想看的重点。下次怎么调整？'
  const adjustmentReply='下一页先只留一种颜色标每段最想找的那个关键词，其余用普通笔迹。'
  await h.execute(adjustment.user,adjustment.chat,adjustmentInput,{},adjustmentReply)
  const adjustmentRequest=h.requests.at(-1)
  const adjustmentSchema=plainReplySchema(adjustmentRequest.response_format.json_schema.schema)
  assert.equal(Value.Check(adjustmentSchema,adjustmentReply),true)
  assert.equal(adjustmentSchema.not,undefined)
  semanticGuidance(adjustmentRequest,adjustmentInput)
  assert.equal(adjustmentRequest.max_completion_tokens,8192)

  const meetingRecord=await h.account()
  const meetingInput='上次项目讨论我记了满页结论，回来才发现没有记录谁负责。下次记录要改哪一项？'
  const meetingReply='每条结论后面加一个“负责人”字段。'
  const meetingRun=await h.execute(meetingRecord.user,meetingRecord.chat,meetingInput,{},meetingReply)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[meetingRecord.user,meetingRun.request_id])).rows,[{content:meetingReply}])

  const speech=await h.account()
  const speechInput='社团开会时我有个想法没讲清，怎样在下次发言前把它理顺？'
  const speechReply='发言前先写一句“我提议大家做什么”，再用一个亲历例子把提议说具体。'
  const beforeSpeech=h.requests.length
  const speechRun=await h.execute(speech.user,speech.chat,speechInput,{},speechReply)
  assert.equal(h.requests.length,beforeSpeech+1)
  semanticGuidance(h.requests.at(-1),speechInput)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[speech.user,speechRun.request_id])).rows,[{content:speechReply}])

  const multipleAdjustments=await h.account()
  const multipleInput='这次开会没讲清。下次怎么调整？请给两个做法并分别给理由。'
  const multipleReply='一，先写一句提议和一条依据，发言时更容易说清要大家决定什么。二，提前读给一位同学听，请他复述提议，借此发现哪句话需要改。'
  const multipleRun=await h.execute(multipleAdjustments.user,multipleAdjustments.chat,multipleInput,{},multipleReply)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[multipleAdjustments.user,multipleRun.request_id])).rows,[{content:multipleReply}])
  const multipleRequest=h.requests.at(-1)
  assert.equal(plainReplySchema(multipleRequest.response_format.json_schema.schema).not,undefined)
  assert.equal(plainReplySchema(multipleRequest.response_format.json_schema.schema).pattern,undefined)
  const multipleFirst=await h.account()
  await h.execute(multipleFirst.user,multipleFirst.chat,'给两种做法。下次怎么调整？',{},multipleReply)
  assert.equal(plainReplySchema(h.requests.at(-1).response_format.json_schema.schema).pattern,undefined)

  const otherLanguage=await h.account()
  const otherLanguageInput='用日语回答。下次怎么调整？'
  const otherLanguageReply='次は、最初に要点を一つだけ書き出してみてください。'
  const otherLanguageRun=await h.execute(otherLanguage.user,otherLanguage.chat,otherLanguageInput,{},otherLanguageReply)
  assert.equal(plainReplySchema(h.requests.at(-1).response_format.json_schema.schema).pattern,undefined)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[otherLanguage.user,otherLanguageRun.request_id])).rows,[{content:otherLanguageReply}])

  const tableReport=await h.account()
  await h.execute(tableReport.user,tableReport.chat,'我用表格还是找不到重点。下次怎么调整？',{},'先把最想找的关键词放到表格第一列，再用相同的词搜索。')
  assert.equal(plainReplySchema(h.requests.at(-1).response_format.json_schema.schema).pattern,undefined)

  const tableRequest=await h.account()
  const tableReply='| 要调整的项 | 做法 |\n| --- | --- |\n| 标签 | 每段只标一个关键词 |'
  await h.execute(tableRequest.user,tableRequest.chat,'用表格回答。下次怎么调整？',{},tableReply)
  assert.equal(plainReplySchema(h.requests.at(-1).response_format.json_schema.schema).pattern,undefined)

  for(const [text,reply] of [
   ['请用表格回答：下次怎么调整？',tableReply],
   ['麻烦用日语回答：下次怎么调整？',otherLanguageReply],
   ['怎样在下次发言前用表格把它理顺？',tableReply],
   ['怎样在下次发言前用日语把它理顺？',otherLanguageReply],
  ]){
   const customFormat=await h.account()
   await h.execute(customFormat.user,customFormat.chat,text!,{},reply!)
   assert.equal(plainReplySchema(h.requests.at(-1).response_format.json_schema.schema).pattern,undefined,text)
  }

  const mixedAdjustment=await h.account()
  const mixedAdjustmentInput='我是大三学生。我用彩色标签还是找不到重点。下次怎么调整？'
  const mixedAdjustmentRun=await h.execute(mixedAdjustment.user,mixedAdjustment.chat,mixedAdjustmentInput,{
   growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}}],
  },adjustmentReply)
  assert.equal(plainReplySchema(h.requests.at(-1).response_format.json_schema.schema).pattern,undefined)
  assert.deepEqual((await pool.query("SELECT text FROM growth_items WHERE user_id=$1 AND origin_request_id=$2",[mixedAdjustment.user,mixedAdjustmentRun.request_id])).rows,[{text:'我是大三学生'}])

  for(const text of [
   '下次怎么调整。这个小标题自然吗？',
   '复盘标题是“下次怎么调整”。这句标题表达的是什么意思？',
   '同桌说：下次怎么调整？我只是记录了他的提问，请把语气讲清楚。',
  ]){
   const title=await h.account()
   await h.execute(title.user,title.chat,text,{},'这句话表示接下来讨论可以改变的做法。')
   const titleWire=h.requests.at(-1).messages.at(-1).content
  }

  const reason=await h.account()
  const reasonInput='开会前我想先写一句核心观点，给我一个这样做的理由。'
  const reasonReply='先写一句能让你在开口前确定听众最需要听到的结论。'
  const requestsBeforeReason=h.requests.length
  const reasonRun=await h.execute(reason.user,reason.chat,reasonInput,{},reasonReply)
  assert.equal(h.requests.length,requestsBeforeReason+1)
  const reasonWire=h.requests.at(-1).messages.at(-1).content
  assert.ok(reasonWire.startsWith(reasonInput))
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[reason.user,reasonRun.request_id])).rows,[{content:reasonReply}])

  const diagnosis=await h.account()
  const diagnosticInput='我试着把讲题视频倍速看完，题型记住了，遇到变形题仍不会。有什么小办法验证问题在哪里？'
  const diagnosticBaseline='先遮住答案，独立做一道原题。'
  const diagnosticComparison='同样遮住答案，独立做一道只改一处条件的变式。'
  const diagnosticRecord=['各题最后完成的一步','各题首次停点','最早出现差异的位置，或记无差异']
  const diagnosticReply=diagnosticBaseline+'\n\n保持第一次的其他条件，做第二次尝试：'+diagnosticComparison+'\n\n记录项：\n'+diagnosticRecord.map(item=>'- '+item).join('\n')
  const requestsBeforeDiagnosis=h.requests.length
  const diagnosticRun=await h.execute(diagnosis.user,diagnosis.chat,diagnosticInput,{answer:{locate:{baseline:diagnosticBaseline,comparison:diagnosticComparison,record:{lastStep:diagnosticRecord[0],firstStop:diagnosticRecord[1],firstDifference:diagnosticRecord[2]}}}},'')
  assert.equal(h.requests.length,requestsBeforeDiagnosis+1)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[diagnosis.user,diagnosticRun.request_id])).rows,[{content:diagnosticReply}])
  const diagnosticRequest=h.requests.at(-1)
  const diagnosticSystem=diagnosticRequest.messages.filter((message:any)=>message.role==='system').map((message:any)=>message.content).join('\n')
  assert.doesNotMatch(diagnosticSystem,/解释若超出本人原话，应明确它是可被后续反馈推翻的假设/)
  semanticGuidance(diagnosticRequest,diagnosticInput)
  const diagnosticSchema=plainReplySchema(diagnosticRequest.response_format.json_schema.schema)
  assert.equal(Value.Check(diagnosticSchema,diagnosticReply),true)
  assert.equal(diagnosticSchema.pattern,undefined)

  const reportedAttempt=await h.account()
  const reportedAttemptInput='我跟着原例题做过，换一个条件就停住了。有什么小办法验证问题在哪里？'
  const reportedAttemptReply='先独立做一次原例题，再独立做一次只改一处条件的题，把两次实际停下的第一个步骤分别记下来。'
  const beforeReportedAttempt=h.requests.length
  const reportedAttemptRun=await h.execute(reportedAttempt.user,reportedAttempt.chat,reportedAttemptInput,{},reportedAttemptReply)
  assert.equal(h.requests.length,beforeReportedAttempt+1)
  const reportedAttemptWire=h.requests.at(-1).messages.at(-1).content
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[reportedAttempt.user,reportedAttemptRun.request_id])).rows,[{content:reportedAttemptReply}])

  const diagnosticMany=await h.account()
  const diagnosticManyInput='遇到变形题还是不会。有什么小办法验证问题在哪里？请给两种方法并分别说明理由。'
  const diagnosticManyReply='一，闭卷做原题和只改变一个条件的变式，记录首次停下的动作，理由是便于对照条件变化。二，先口头解释变式中每个条件的作用，再写第一步，理由是可以分别记录读条件和落笔时的卡点。'
  const diagnosticManyRun=await h.execute(diagnosticMany.user,diagnosticMany.chat,diagnosticManyInput,{},diagnosticManyReply)
  const diagnosticManyRequest=h.requests.at(-1)
  semanticGuidance(diagnosticManyRequest,diagnosticManyInput)
  assert.equal(plainReplySchema(diagnosticManyRequest.response_format.json_schema.schema).pattern,undefined)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[diagnosticMany.user,diagnosticManyRun.request_id])).rows,[{content:diagnosticManyReply}])


  const rewrite=await h.account()
  await h.execute(rewrite.user,rewrite.chat,'请把“同学们应该都懂这个要求了”改成不替别人下结论的一句话。',{},'大家对这个要求还有哪些地方需要确认？')
  const rewriteRequest=h.requests.at(-1)
  const rewriteRules=rewriteRequest.messages.find((message:any)=>message.role==='system').content
  assert.match(rewriteRules,/明确要求移除的判断或承诺直接去掉，不用推测或引导问句带回/)
  assert.match(rewriteRules,/只要一句或一版就只交付所要文本/)
  assert.match(rewriteRules,/保留原句的动作、对象、状态和不确定程度/)
  const edit=JSON.parse(rewriteRequest.messages.at(-1).content)
  assert.equal(edit.sourceText,'同学们应该都懂这个要求了')
  assert.equal(edit.requestedChanges,'改成不替别人下结论的一句话。')
  assert.deepEqual(Object.keys(edit).sort(),['delivery','requestedChanges','sourceText'])
  assert.match(edit.delivery,/邀请对方指出哪里需要澄清/)
  assert.equal(rewriteRequest.max_completion_tokens,8192)
  const neutralRewriteSchema=plainReplySchema(rewriteRequest.response_format.json_schema.schema)
  assert.equal(Value.Check(neutralRewriteSchema,'这个要求大家可能都清楚了，如果有哪里需要澄清，欢迎指出来。'),false)
  assert.equal(Value.Check(neutralRewriteSchema,'这个要求大家可能还有不清楚的地方，欢迎随时提出来。'),false)
  assert.equal(Value.Check(neutralRewriteSchema,'如果对这个要求有疑问，欢迎指出来。'),true)
  assert.equal(Value.Check(neutralRewriteSchema,'如果大家还有不清楚的地方，欢迎指出来。'),true)
  assert.equal(Value.Check(neutralRewriteSchema,'大家还有不清楚的地方吗？'),true)
  assert.equal(Value.Check(neutralRewriteSchema,'大家对这个要求还有哪些地方需要确认？'),true)
  assert.equal(Value.Check(neutralRewriteSchema,'大家都理解这个要求了吗？'),true)
  assert.equal(Value.Check(neutralRewriteSchema,'如果大家都理解了，就可以开始。'),true)

  const styleOnly=await h.account()
  await h.execute(styleOnly.user,styleOnly.chat,'请把“同学们应该都懂这个要求了”改成一句自然的话。',{},'大家应该都明白这个要求了。')
  assert.equal(plainReplySchema(h.requests.at(-1).response_format.json_schema.schema).not,undefined)

  const progressEdit=await h.account()
  const progressInput='请把“材料有点乱，可能要等几天再发”改成一句清楚的进度说明。保留时间不确定。'
  const progressReply='材料还在整理，可能要过几天才能发出。'
  const beforeProgressEdit=h.requests.length
  const progressRun=await h.execute(progressEdit.user,progressEdit.chat,progressInput,{},progressReply)
  assert.equal(h.requests.length,beforeProgressEdit+1)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[progressEdit.user,progressRun.request_id])).rows,[{content:progressReply}])
  const progressRequest=h.requests.at(-1)
  assert.equal(progressRequest.enable_thinking,false)
  assert.equal(progressRequest.thinking_budget,undefined)
  const progressSource=JSON.parse(progressRequest.messages.at(-1).content)
  assert.equal(progressSource.sourceText,'材料有点乱，可能要等几天再发')
  assert.equal(progressSource.currentProgress,'材料有点乱')
  assert.equal(progressSource.requestedChanges,'改成一句清楚的进度说明。保留时间不确定。')
  assert.match(progressSource.meaningBoundary,/可能性保持原程度/)
  const progressSchema=plainReplySchema(progressRequest.response_format.json_schema.schema)
  assert.equal(progressSchema.pattern,undefined)
  assert.equal(progressSchema.allOf,undefined)
  assert.equal(progressSchema.not,undefined)
  assert.equal(progressSource.deliveryObject,'材料')
  assert.equal(progressSource.clarifyPreparation,true)
  assert.match(progressSource.delivery,/一句话同时写清 currentProgress 原先报告的状态/)
  assert.match(progressSource.delivery,/把原句随口说的杂乱改成清楚的准备进度/)
  assert.match(progressSource.delivery,/交付对象明确写作“材料”/)
  assert.match(progressSource.delivery,/写明原句明确的动作对象，包括前文提及、后文省略的对象/)
  for(const supported of [
   '我目前还在整理材料，预计几天后再发出。',
   '材料还需整理，可能要等几天才能发出。',
   '材料仍在整理，可能要等几天才能把材料发出去。',
   '材料还在整理，预计还需等几天才能发出。',
   '材料还在整理：预计几天后再发出。',
   '目前预计在几天后发出，材料还在整理。',
  ]){
   const account=await h.account()
   await h.execute(account.user,account.chat,progressInput,{},supported)
  }
  const assertProgressReplyRejected=async(input:string,output:string,error:RegExp)=>{
   const account=await h.account()
   const progressEvents=h.emitted.length
   const progressCalls=h.requests.length
   await assert.rejects(h.execute(account.user,account.chat,input,{},output),error)
   assert.equal(h.requests.length,progressCalls+1)
   assert.ok(!h.emitted.slice(progressEvents).some(event=>event.type==='draft'))
   const saved=await pool.query("SELECT count(*)::int AS count FROM messages WHERE user_id=$1 AND role='assistant'",[account.user])
   assert.equal(saved.rows[0].count,0)
  }
  for(const unsupported of [
   '材料还在整理，预计几天内发出。',
   '材料还在整理，几天后发出。',
   '材料可能要等几天再发，最晚三天内发出。',
   '也许不用等几天，预计几天内发出。',
   '不可能要等几天再发。',
   '材料仍在整理，但并非预计几天后发出。',
   '材料可能要等几天再发，周五前会发出去。',
   '材料还在整理，预计几天后再决定。',
   '材料可能要等几天再确认。',
   '材料还在整理，预计几天后再发出决定。',
   '材料还在整理，预计几天后再发出确认。',
   '材料还在整理，预计几天后再把决定发出。',
  ])await assertProgressReplyRejected(progressInput,unsupported,/REPLY_PROGRESS_(?:TIMING_CHANGED|OBJECT_MISSING)/)
  for(const output of [
   '目前可能等上几天再发。',
   '文件可能等上几天再发。',
   '原材料还在整理，目前可能等上几天再发。',
   '材料清单还在整理，目前可能等上几天再发。',
   '研发材料，目前可能等上几天再发。',
   '整理开发材料，目前可能等上几天再发。',
   '材料尚未确认，预计几天后再发出文件。',
   '材料尚未确认，可能要等几天才能把文件发出去。',
   '材料尚未确认，文件仍在整理，可能要等几天再发出。',
  ])await assertProgressReplyRejected(progressInput,output,/REPLY_PROGRESS_OBJECT_MISSING/)

  await assertProgressReplyRejected(progressInput,'预计几天后再发出材料。',/REPLY_PROGRESS_STATE_MISSING/)
  await assertProgressReplyRejected(progressInput,'材料目前有点乱，可能要等几天再发。',/REPLY_PROGRESS_STATE_MISSING/)
  await assertProgressReplyRejected(progressInput,'材料并不杂乱，预计几天后再发出。',/REPLY_PROGRESS_STATE_MISSING/)
  await assertProgressReplyRejected(progressInput,'材料不是有点乱，预计几天后再发出。',/REPLY_PROGRESS_STATE_MISSING/)
  await assertProgressReplyRejected(progressInput,'材料还在整理，保证三天后发出，预计还要等几天才能发出。',/REPLY_PROGRESS_STATE_MISSING/)
  const confirmationInput='请把“材料尚未确认，可能要等几天再发”改成一句清楚的进度说明。保留时间不确定。'
  await assertProgressReplyRejected(confirmationInput,'材料，预计几天后再发出。',/REPLY_PROGRESS_STATE_MISSING/)
  const awaitingConfirmation=await h.account()
  await h.execute(awaitingConfirmation.user,awaitingConfirmation.chat,confirmationInput,{},'材料尚未确认，预计几天后再发出。')
  const checkingInput='请把“资料还在核对，目前可能要等几天再发”改成一句清楚的进度说明。保留时间不确定。'
  await assertProgressReplyRejected(checkingInput,'目前可能还要等几天才能把资料发出去。',/REPLY_PROGRESS_STATE_MISSING/)
  await assertProgressReplyRejected(checkingInput,'资料仍在合并，可能还要等几天才能发出。',/REPLY_PROGRESS_STATE_MISSING/)
  await assertProgressReplyRejected(checkingInput,'资料已经核对完成，不是还在核对，可能还要等几天才能发出。',/REPLY_PROGRESS_STATE_MISSING/)
  await assertProgressReplyRejected(checkingInput,'资料仍在核对，但已经核对完成，可能还要等几天才能发出。',/REPLY_PROGRESS_STATE_MISSING/)
  const checking=await h.account()
  await h.execute(checking.user,checking.chat,checkingInput,{},'资料尚未核对完成，可能还要等几天才能发出。')
  const checkingInProgress=await h.account()
  await h.execute(checkingInProgress.user,checkingInProgress.chat,checkingInput,{},'资料目前仍在核对，可能还要等几天才能发出。')

  for(const [object,other] of [['文件夹','文件'],['文件','文件夹']]){
   const account=await h.account()
   const input='请把“'+object+'还在整理，可能要等几天再发”改成一句清楚的进度说明。保留时间不确定。'
   const reply=object+'仍在整理，可能过几天才能发出。'
   await h.execute(account.user,account.chat,input,{},reply)
   const schema=plainReplySchema(h.requests.at(-1).response_format.json_schema.schema)
   assert.equal(Value.Check(schema,reply),true)
   await assertProgressReplyRejected(input,other+'仍在整理，可能过几天才能发出。',/REPLY_PROGRESS_OBJECT_MISSING/)
  }

  for(const [source,reply] of [
   ['还在整理，可能要等几天再发','还在整理，可能过几天才能发出。'],
   ['研发材料，可能要等几天再发','研发材料仍在整理，预计几天后再发出。'],
   ['保留开发文件，可能要等几天再发','请保留开发文件，预计几天后再发出。'],
   ['附件还在整理，资料还在整理，可能要等几天再发','资料仍在整理，可能要等几天才能发出，附件也还在整理。'],
  ]){
   const account=await h.account()
   const input='请把“'+source+'”改成一句清楚的进度说明。保留时间不确定。'
   await h.execute(account.user,account.chat,input,{},reply)
   const request=h.requests.at(-1)
   const schema=plainReplySchema(request.response_format.json_schema.schema)
   const current=request.messages.at(-1).content
   if(current!==input)assert.equal(JSON.parse(current).deliveryObject,undefined)
   assert.equal(Value.Check(schema,reply),true)
  }

  const compoundMention=await h.account()
  const compoundSource='请把“材料还在整理，原文件需要留存，目前可能要等几天再发”改成一句清楚的进度说明。保留时间不确定。'
  await h.execute(compoundMention.user,compoundMention.chat,compoundSource,{},'材料仍在整理，原文件需要留存，目前可能过几天才能发出。')
  const compoundMentionSchema=plainReplySchema(h.requests.at(-1).response_format.json_schema.schema)
  assert.equal(Value.Check(compoundMentionSchema,'材料仍在整理，原文件需要留存，目前可能过几天才能发出。'),true)
  await assertProgressReplyRejected(compoundSource,'原文件需要留存，目前可能过几天才能发出。',/REPLY_PROGRESS_OBJECT_MISSING/)
  const developmentFiles=await h.account()
  await h.execute(developmentFiles.user,developmentFiles.chat,'请把“保留开发文件，材料还在整理，可能要等几天再发”改成一句清楚的进度说明。保留时间不确定。',{},'保留开发文件，材料仍在整理，预计几天后再发出。')

  const boundedProgress=await h.account()
  const boundedProgressReply='材料正在整理，可能要等几天再发，最晚周五发出。'
  const boundedProgressRun=await h.execute(boundedProgress.user,boundedProgress.chat,'请把“材料有点乱，可能要等几天再发，最晚周五发出”改成一句清楚的进度说明。保留时间不确定。',{},boundedProgressReply)
  const boundedProgressRequest=h.requests.at(-1)
  const boundedProgressSource=JSON.parse(boundedProgressRequest.messages.at(-1).content)
  assert.equal(boundedProgressSource.sourceText,'材料有点乱，可能要等几天再发，最晚周五发出')
  assert.match(boundedProgressSource.meaningBoundary,/原句已给出的时间范围或最晚时间须保留/)
  assert.equal(plainReplySchema(boundedProgressRequest.response_format.json_schema.schema).pattern,undefined)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[boundedProgress.user,boundedProgressRun.request_id])).rows,[{content:boundedProgressReply}])

  const negatedProgress=await h.account()
  await h.execute(negatedProgress.user,negatedProgress.chat,'请把“材料有点乱，不可能要等几天再发”改成一句清楚的进度说明。保留时间不确定。',{},'材料还在整理，具体发出时间待定，但不会需要等好几天。')
  assert.equal(plainReplySchema(h.requests.at(-1).response_format.json_schema.schema).pattern,undefined)

  const reviewProgress=await h.account()
  await h.execute(reviewProgress.user,reviewProgress.chat,'请把“材料有点乱，可能要等几天再确认”改成一句清楚的进度说明。保留时间不确定。',{},'材料仍在整理，可能过几天才能确认。')
  assert.equal(plainReplySchema(h.requests.at(-1).response_format.json_schema.schema).pattern,undefined)

  const dateEdit=await h.account()
  const dateInput='请把这句改得自然一点：“烦请您于方便时确认周五是否有空。”给一版即可。'
  const dateReply='方便时请告诉我您周五有没有空。'
  const beforeDateEdit=h.requests.length
  const dateRun=await h.execute(dateEdit.user,dateEdit.chat,dateInput,{},dateReply)
  assert.equal(h.requests.length,beforeDateEdit+1)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[dateEdit.user,dateRun.request_id])).rows,[{content:dateReply}])
  const dateRequest=h.requests.at(-1)
  const dateSource=JSON.parse(dateRequest.messages.at(-1).content)
  assert.equal(dateSource.sourceText,'烦请您于方便时确认周五是否有空。')
  assert.match(dateSource.requestedChanges,/改得自然一点/)
  assert.match(dateSource.requestedChanges,/给一版即可/)
  assert.match(dateSource.meaningBoundary,/时间仍修饰原动作或状态/)
  assert.match(dateRequest.messages.find((message:any)=>message.role==='system').content,/原日期仍修饰同一事项，不改成另一动作的时间/)

  const mixedRewrite=await h.account()
  const mixedInput='我是大三学生。请把“我们都懂了”改成一句不替别人判断的话。'
  await h.execute(mixedRewrite.user,mixedRewrite.chat,mixedInput,{
   growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}}],
  },'大家对这里还有哪些疑问？')
  const mixedRequest=h.requests.at(-1)
  assert.equal(mixedRequest.messages.at(-1).content,mixedInput,'a mixed turn must retain the raw current request and its source catalogue')

  const boundedAccount=await h.account()
  const boundedInput='接着羽毛球那次体验。我想保留这种不被评价的陪伴，但不确定是运动本身还是这个室友带来的。请给暂定理解和一个很小的区分办法。'
  const boundedReply=boundedDistinctionReply(boundedInput)
  assert.ok(boundedReply)
  await h.execute(boundedAccount.user,boundedAccount.chat,boundedInput,{},boundedReply)
  const boundedSchema=h.requests.at(-1).response_format.json_schema.schema
  assert.deepEqual(boundedSchema.properties.reply.enum,[boundedReply])
  assert.equal(Object.keys(boundedSchema.properties).at(-1),'reply','a server-bounded reply must retain the existing metadata-first contract')

  const controlAccount=await h.account()
  const controlInput='先暂停考研方向，这周不安排任务。我自己更在意留在目前城市。请说明当前理解，不删除事实。'
  await h.execute(controlAccount.user,controlAccount.chat,controlInput,{},'你更在意留在目前城市；考研建议已暂停，本周不安排任务，是否适合继续读研仍未知。')
  const controlSchema=h.requests.at(-1).response_format.json_schema.schema
  assert.equal(Object.keys(controlSchema.properties).at(-1),'reply','a transactional control receipt must remain withheld until commit')

  const previewAccount=await h.account()
  const previewInput='回来反馈：我把奖学金材料按三条规则整理了一次，第二天大约20秒找到通知，但目前只发生过一次。不要把一次成功当成职业适合。请根据这次反馈更新理解和下一次帮助。'
  await h.execute(previewAccount.user,previewAccount.chat,previewInput,{},'这次只证明你在这一条材料上按规则整理后找到了通知；稳定效果和职业适合仍未知，下一次帮助会继续用单次个例边界。')
  const previewSchema=h.requests.at(-1).response_format.json_schema.schema
  assert.equal(Object.keys(previewSchema.properties).at(-1),'reply','an existing verified preview must keep the model frame metadata-first')

  const provisionalStateAccount=await h.account()
  const provisionalStateInput='老师邮件还没回复，结果未知；同学表格先暂停。我今天只有十分钟，请说明当前暂定理解并给一个小步骤。'
  await h.execute(provisionalStateAccount.user,provisionalStateAccount.chat,provisionalStateInput,{},'暂定理解：老师邮件未回复，结果未知；同学表格已暂停。你今天可先用十分钟核对邮件地址，到点就停。')
  const provisionalStateSchema=h.requests.at(-1).response_format.json_schema.schema
  assert.equal(Object.keys(provisionalStateSchema.properties).at(-1),'reply','a source-verified provisional state must not start a second model preview lane')

  const emptyDecisionAccount=await h.account()
  await h.execute(emptyDecisionAccount.user,emptyDecisionAccount.chat,'请比较手头这些事的取舍。',{},'当前没有可读的事项，尚不能据此排序。')
  const emptyDecisionSchema=h.requests.at(-1).response_format.json_schema.schema
  assert.equal(Object.keys(emptyDecisionSchema.properties).at(-1),'reply','a decision request without proposal cases must still wait for its complete decision frame')

  const correctionAccount=await h.account()
  await h.execute(correctionAccount.user,correctionAccount.chat,'我是大二学生。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}}]},'你目前是大二学生。')
  await h.execute(correctionAccount.user,correctionAccount.chat,'更正：我是大三，不是大二。请说明当前理解。',{},'你现在是大三；大二这条理解已更正，其他事实不变。')
  const correctionSchema=h.requests.at(-1).response_format.json_schema.schema
  assert.equal(Object.keys(correctionSchema.properties).at(-1),'reply','a correction success receipt must remain withheld until commit')

  const tailAccount=await h.account(),harnessUrl=model.baseUrl,tailEvents:any[]=[]
  const tailServer=createServer((req,res)=>{const body:Buffer[]=[];req.on('data',chunk=>body.push(Buffer.from(chunk)));req.on('end',()=>{
   const payload=JSON.parse(Buffer.concat(body).toString()),order=Object.keys(payload.response_format.json_schema.schema.properties)
   const groundedFrame:Record<string,unknown>={answer:{deliver:frame.reply},growthUpdates:frame.growthUpdates,event:frame.event}
   const ordered=Object.fromEntries(order.filter(key=>Object.hasOwn(groundedFrame,key)).map(key=>[key,groundedFrame[key]])),encoded=JSON.stringify(ordered)
   const split=encoded.indexOf(frame.reply)+Math.floor(frame.reply.length/2),base={id:'synthetic-tail-flush',object:'chat.completion.chunk',created:1,model:model.id}
   const delta=(content:string)=>'data: '+JSON.stringify({...base,choices:[{index:0,delta:{content},finish_reason:null}]})+'\n\n'
   res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(delta(encoded.slice(0,split)));res.write(delta(encoded.slice(split)))
   res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
  })})
  try{
   await new Promise<void>(resolve=>tailServer.listen(0,'127.0.0.1',resolve));model.baseUrl='http://127.0.0.1:'+(tailServer.address() as {port:number}).port
   const {run}=await store.startRun(tailAccount.user,tailAccount.chat,randomUUID(),input),staged:store.Staged={candidates:[],audit:[]},signal=new AbortController().signal
   const result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:event=>tailEvents.push(event)})
   await store.finishRun(run,staged,result.text,result.usage,signal)
   const streamed=tailEvents.filter(event=>event.type==='draft'&&event.draftKind==='stream_reply')
   assert.ok(streamed.length>0)
   assert.equal(streamed.at(-1).text,frame.reply,'the final complete reply must flush even when the closing provider chunks arrive inside the throttle window')
  }finally{model.baseUrl=harnessUrl;tailServer.closeAllConnections();await new Promise<void>(resolve=>tailServer.close(()=>resolve()))}

  const originalModel={id:model.id,name:model.name}
  try{
   model.id='deepseek-v4.1-flash';model.name='deepseek-v4.1-flash'
   const jsonObjectAccount=await h.account()
   await h.execute(jsonObjectAccount.user,jsonObjectAccount.chat,'我这周只有十分钟。请给我一个现在能开始的小步骤。',{},'先用十分钟列出当前最重要的一件事，到点就停；结果仍未知。')
   const jsonObjectRequest=h.requests.at(-1)
   assert.equal(jsonObjectRequest.response_format.type,'json_object')
   const jsonObjectSystem=jsonObjectRequest.messages.find((message:any)=>message.role==='system').content
   assert.ok(jsonObjectSystem.includes(GROUNDED_ORDINARY_STREAMING_RULE))
   assert.match(jsonObjectSystem,/sources引用本轮currentUserMessage\.clauses或历史用户消息的answerSources子句编号/)
   const jsonObjectContext=jsonObjectRequest.messages.filter((message:any)=>message.role==='user').map((message:any)=>{
    try{return JSON.parse(message.content)}catch{return null}
   }).find((content:any)=>content?.currentUserMessage?.clauses?.length)
   assert.ok(jsonObjectContext?.currentUserMessage.clauses.some(({id,text}:any)=>typeof id==='string'&&text.includes('十分钟')))
   assert.equal(JSON.stringify(jsonObjectRequest.messages).includes(REPLY_FIRST_STREAMING_RULE),false,'providers without native strict schema must retain the canonical metadata-first prompt')
  }finally{model.id=originalModel.id;model.name=originalModel.name}
 }finally{await h.close()}
})

test('wire description compaction preserves business fields and literal data named description',()=>{
 const schema={
  type:'object',
  properties:{
   reply:{type:'string',description:'visible reply guidance'},
   growthUpdates:{
    type:'array',
    items:{
    type:'object',
    properties:{
     description:{type:'string',description:'schema annotation only'},
     choice:{type:'object',enum:[{description:'literal value'}]},
    },
    required:['description','choice'],
    additionalProperties:false,
    },
   },
  },
  required:['reply','growthUpdates'],
  additionalProperties:false,
 }
 const wire=(configureProviderPayload({},{provider:'bailian',id:'qwen3.8-flash'},'default',schema) as any).response_format.json_schema.schema
 assert.ok(wire.properties.growthUpdates.items.properties.description,'a property named description is data shape, not a schema annotation')
 assert.deepEqual(wire.properties.growthUpdates.items.properties.choice.enum,[{description:'literal value'}],'enum members are literal data and must remain byte-equivalent')
 assert.equal(Value.Check(wire,{reply:'ok',growthUpdates:[{description:'kept',choice:{description:'literal value'}}]}),true)
})

test('a quote-first edit preserves separate commands in the raw provider request',()=>{
 for(const input of [
  '请把“我们都懂了”改成不替别人判断的一句话。给一版我的考研计划。',
  '请把“我们都懂了”改写。请保留我之前明确说过的不考研决定。',
  '请把“我们都懂了”改成不替别人判断的一句话，并删除我保存的考研方向。',
  '请把“我们都懂了”改成一句话并更新我的长期记忆。',
  '请把“我们都懂了”改成一句话。我是大三学生。',
  '请把“我们都懂了”改成一句不替别人判断还要删除我保存的考研方向的话。',
  '请把“我们都懂了”改成中性表达还要保留我之前明确说过的不考研决定的一句话。',
  '请把“我们都懂了”改成中性表达还要记住我是大三学生的一句话。',
  '请把这句改得自然一点：“烦请您确认周五是否有空。”给一版即可。请记住我改了专业。',
  '请把“材料可能要等几天再发”改成一句清楚的进度说明。保留时间不确定。请总结我以前的经历。',
  '请把这句改得自然一点：`confirmFriday()`给一版即可。',
 ]){
  const id=randomUUID()
  const serialized=buildTurnPrompt({directOrdinary:true,currentMessageId:id,messages:[{id,role:'user',content:input,created_at:new Date().toISOString()}]})
  assert.equal(providerTurnMessages(serialized,{provider:'bailian',id:'qwen3.8-flash'}).at(-1)?.content,input)
 }
})
