import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import {coachEventView} from '../../server/action-coach-events.ts'
import {growthView,applyGrowthAction} from '../../server/growth.ts'
import {pool,transaction} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {slimActionCoachSchema} from '../../server/turn-contract.ts'
import {buildClauseCatalogue,resolveProcessSourceHandles,reportedContribution} from '../../server/clause-catalogue.ts'

test('disabled canonical memory does not open or synthesize semantic facts',()=>{
 const schema=slimActionCoachSchema({growth:false,event:true,material:false,plan:false,candidate:false,citations:false}) as any
 assert.equal(schema.properties.event.properties.matterReports,undefined)
 assert.ok(!schema.properties.event.required.includes('matterReports'))
 const text='这次岗位探索我接下来了',turn:any={event:{target:{operation:'create',title:'岗位探索',source:{clauseId:'c0'}},matterReports:[{state:'accepted',choice:'accepted',resumed:false,source:{clauseId:'c0'}}]}}
 resolveProcessSourceHandles(turn,{messageId:randomUUID(),catalogue:buildClauseCatalogue(text),text,canonicalFacts:false})
 assert.equal(turn.event.nodes,undefined)
 assert.equal(turn.growthUpdates,undefined)
})

test('an invalid optional result link does not erase the verified action',()=>{
 const text='我整理了课程报告'
 const context={messageId:randomUUID(),catalogue:buildClauseCatalogue(text),text}
 const input={reply:'先检查报告的第一段是否交代了问题。',growthUpdates:[{
  target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'attempted',
  source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:'我整理了课程报告',resultRef:0},
 }]}
 assert.throws(()=>resolveProcessSourceHandles(structuredClone(input),context),/CONTRIBUTION_RESULT_REFERENCE_INVALID/)
 const output=structuredClone(input)
 resolveProcessSourceHandles(output,{...context,optionalContributions:true})
 assert.equal(output.reply,input.reply)
 const contribution=reportedContribution(output.growthUpdates[0]!)
 assert.equal(contribution?.actionQuote,text)
 assert.equal(contribution?.result,undefined)
})

test('an optional contribution without an action cannot replace a complete answer or another fact',()=>{
 const text='我会用Excel。我试过做变式题，但还没找出问题。'
 const context={messageId:randomUUID(),catalogue:buildClauseCatalogue(text),text,canonicalFacts:true}
 const input={reply:'先遮住答案，独立完成一道原题和一道变式。',growthUpdates:[
  {target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'attempted',source:{clauseId:'c1'},contribution:{actor:'self',actionQuote:''}},
  {target:{operation:'create'},kind:'ability',assertion:'user_reported',source:{clauseId:'c0'}},
 ],event:{target:{operation:'create',title:'核对变式题',source:{clauseId:'c1'}},factRefs:[1],matterReports:[]}}
 assert.throws(()=>resolveProcessSourceHandles(structuredClone(input),context),/CONTRIBUTION_ACTION_MISSING/)
 const output=structuredClone(input),normalized:string[]=[]
 resolveProcessSourceHandles(output,{...context,optionalContributions:true},kind=>normalized.push(kind))
 assert.equal(output.reply,input.reply)
 assert.deepEqual(output.growthUpdates.map(fact=>fact.kind),['ability'])
 assert.ok(normalized.includes('unsupported_optional_contribution_dropped'))
 const required={...structuredClone(input),weeklyPlan:{basis:[{updateIndex:0}]}}
 assert.throws(()=>resolveProcessSourceHandles(required,{...context,optionalContributions:true}),/CONTRIBUTION_ACTION_MISSING/)
})

test('one model interpretation survives refresh and another conversation',async()=>{
 const h=await residualHarness()
 try{
  const {user,chat}=await h.account()
  const title='技术支持岗位探索'
  await h.execute(user,chat,'这次岗位探索我接下来了',{
   growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}],
   event:{target:{operation:'create',title,source:{clauseId:'c0'}},factRefs:[0],matterReports:[{state:'accepted',choice:'accepted',resumed:false,source:{clauseId:'c0'}}]},
  },'先按你选定的这件事继续。')
  let event=(await coachEventView(user,chat))!
  assert.equal(event.matterProgress?.state,'accepted')
  const eventId=event.id
  const fresh=randomUUID()
  await store.createConversation(user,{id:fresh,title:'SYNTHETIC semantic continuation'})
  const replies=[
   {text:'我连第一步都还没迈出去',state:'unattempted',resumed:false},
   {text:'这次我只扫到几个栏目名字就收起来了',state:'partial',resumed:false},
   {text:'我把问题交给对方了且答复还在路上',state:'waiting_result',resumed:false},
   {text:'这个探索先搁在架子上吧',state:'paused',resumed:false},
   {text:'这个探索现在可以重新拿出来往下走了',state:'adjusted',resumed:true},
  ] as const
  for(const report of replies){
   const before=h.requests.length
   const run=await h.execute(user,fresh,report.text,{
    growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}],
    event:{target:{operation:'continue',eventId,expectedRevision:event.revision},factRefs:[0],matterReports:[{state:report.state,choice:null,resumed:report.resumed,source:{clauseId:'c0'}}]},
   },'这次报告已经收到，后续帮助按这次进展调整。')
   assert.equal(h.requests.length,before+1)
   event=(await coachEventView(user,fresh,eventId))!
   assert.equal(event.matterProgress?.state,report.state)
   assert.equal(event.matterProgress?.choice,'accepted')
   assert.equal(event.matterProgress?.recommendationStopped,report.state==='paused')
   assert.deepEqual(event.matterProgress?.reports.at(-1)?.quotes,[report.text])
   const raw=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND request_id=$3',[user,eventId,run.request_id])).rows[0].snapshot
   assert.equal(raw.matterReports[0].state,report.state)
   assert.equal(raw.matterReportVersion,1)
   assert.equal(raw.matterReports[0].source.messageId,run.source_message_id)
   const saved=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,run.request_id])).rows
   assert.equal(saved.length,1)
  }
  const last=(await growthView(user)).items.find(item=>item.text===replies.at(-1)!.text)!
  await transaction(c=>applyGrowthAction(c,user,last.id,{requestId:randomUUID(),expectedRevision:last.revision,action:'forget'}))
  const after=(await coachEventView(user,fresh,eventId))!
  assert.equal(after.matterProgress?.state,'paused')
  assert.equal(after.matterProgress?.recommendationStopped,true)
  const snapshots=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2',[user,eventId])).rows
  assert.ok(!JSON.stringify(snapshots).includes(replies.at(-1)!.text))
  assert.ok((await growthView(user)).items.some(item=>item.text===replies[0].text))
  const paused=(await growthView(user)).items.find(item=>item.text===replies[3].text)!
  await transaction(c=>applyGrowthAction(c,user,paused.id,{requestId:randomUUID(),expectedRevision:paused.revision,action:'correct',text:'我说的是暂时放下别的事情'}))
  const corrected=(await coachEventView(user,fresh,eventId))!
  assert.equal(corrected.matterProgress?.state,'waiting_result')
  assert.equal(corrected.matterProgress?.recommendationStopped,false)
  assert.ok(!corrected.matterProgress?.reports.some(report=>report.quotes.includes(replies[3].text)))
  assert.ok((await growthView(user)).items.some(item=>item.text===replies[0].text))
  const unchanged=await h.execute(user,fresh,'这次我暂停这件事',{
   growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}],
   event:{target:{operation:'continue',eventId,expectedRevision:corrected.revision},factRefs:[0],matterReports:[]},
  })
  assert.equal((await coachEventView(user,fresh,eventId))?.matterProgress?.state,'waiting_result','modern empty interpretation must not fall through to lexical inference')
  const emptySnapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND request_id=$2',[user,unchanged.request_id])).rows[0].snapshot
  assert.equal(emptySnapshot.matterReportVersion,1)
  assert.deepEqual(emptySnapshot.matterReports,[])
  for(const invalid of [
   {state:'paused',choice:null,resumed:true,withFact:true,error:/COACH_MATTER_REPORT_TRANSITION_INVALID/},
  ]){
   const isolated=await h.account()
   await assert.rejects(h.execute(isolated.user,isolated.chat,'这次岗位探索我接下来了',{
    ...(invalid.withFact?{growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]}:{}),
    event:{target:{operation:'create',title:'状态来源',source:{clauseId:'c0'}},...(invalid.withFact?{factRefs:[0]}:{}),matterReports:[{state:invalid.state,choice:invalid.choice,resumed:invalid.resumed,source:{clauseId:'c0'}}]},
   }),invalid.error)
   assert.equal((await pool.query('SELECT count(*)::int AS count FROM coach_event_revisions WHERE user_id=$1',[isolated.user])).rows[0].count,0)
  }
  for(const text of ['同学说“这次岗位探索我接下来了”','如果我完成了这件事就去休息']){
   const unowned=await h.account()
   await assert.rejects(h.execute(unowned.user,unowned.chat,text,{
    event:{target:{operation:'create',title:'来源隔离',source:{clauseId:'c0'}},matterReports:[{state:'completed',choice:null,resumed:false,source:{clauseId:'c0'}}]},
   }),/COACH_OUTPUT_INVALID/)
   assert.equal((await pool.query('SELECT count(*)::int AS count FROM coach_events WHERE user_id=$1',[unowned.user])).rows[0].count,0)
   assert.equal((await pool.query("SELECT count(*)::int AS count FROM messages WHERE user_id=$1 AND role='assistant'",[unowned.user])).rows[0].count,0)
  }
  const partial=await h.account()
  await h.execute(partial.user,partial.chat,'我在考研和就业之间拿不定主意，这周只能拿出一小时。我先选就业探索，我接受先看一个岗位这个步骤，今天用十分钟试。',{
   growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c1'}},
    {target:{operation:'create'},kind:'feedback',assertion:'user_reported',source:{clauseId:'c2'},progressState:'completed',contribution:{actor:'self',actionQuote:'我先选就业探索'}}],
   event:{target:{operation:'create',title:'就业探索',source:{clauseId:'c2'}},factRefs:[0],matterReports:[{state:'attempted',choice:'accepted',resumed:false,source:{clauseId:'c4'}}]},
  })
  const chosen=(await coachEventView(partial.user,partial.chat))!
  const acceptedText=h.requests.at(-1).messages.at(-1).content
  assert.match(acceptedText,/今天用十分钟试/)
  assert.match(acceptedText,/按可见内容找与目标有关的实际信息/)
  assert.match(acceptedText,/未知的栏目、标题和位置不作入口/)
  assert.equal(chosen.matterProgress?.choice,'accepted')
  assert.equal(chosen.matterProgress?.state,'unknown','acceptance alone is not a report of execution')
  assert.deepEqual(chosen.matterProgress?.reports.find(report=>report.choice==='accepted')?.quotes,['我接受先看一个岗位这个步骤'])
  assert.ok(!(await store.listExperiences(partial.user)).some(item=>item.content.action==='我先选就业探索'))
  const feedbackReply='这次只核对了三列标题，未完成，也没帮你判断方向。原因仍未知。今天先到这里。'
  const feedbackRun=await h.execute(partial.user,partial.chat,'我看了一个岗位四分钟，只核对了三列标题，没有完成，也没帮我判断方向。今天没时间了。',{
   growthUpdates:[{target:{operation:'create'},kind:'feedback',assertion:'user_reported',source:{clauseId:'c0'},progressState:'completed',contribution:{actor:'self',actionQuote:'我看了一个岗位四分钟',resultRef:0}},
    {target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c4'}}],
   event:{target:{operation:'continue',eventId:chosen.id,expectedRevision:chosen.revision},factRefs:[0,1],nodes:[{kind:'unknown',question:'中断原因和方法效果仍未知'}],matterReports:[{state:'partial',choice:null,resumed:false,source:{clauseId:'c2'}}]},
  },feedbackReply)
  assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[partial.user,feedbackRun.request_id])).rows,[{content:feedbackReply}])
  assert.ok((await growthView(partial.user)).items.some(item=>item.text==='今天没时间了'))
  const retained=(await coachEventView(partial.user,partial.chat,chosen.id))!
  const feedbackRequest=h.requests.at(-1)
  const feedbackSchema=feedbackRequest.response_format.json_schema.schema
  assert.equal(Object.keys(feedbackSchema.properties)[0],'reply')
  assert.ok(!feedbackSchema.required.includes('event'))
  const eventSchema=feedbackSchema.properties.event
  const eventBranches=eventSchema.anyOf??[eventSchema]
  assert.ok(eventBranches.length>0)
  assert.ok(eventBranches.every((branch:any)=>branch.required.includes('matterReports')&&branch.properties.matterReports.minItems!==1))
  assert.ok(feedbackSchema.properties.growthUpdates)
  assert.ok(feedbackSchema.properties.event)
  assert.equal(feedbackRequest.response_format.json_schema.strict,true)
  assert.doesNotMatch(feedbackRequest.messages.find((message:any)=>message.role==='system').content,/本轮输出格式定义：/)
  const feedbackText=feedbackRequest.messages.at(-1).content
  assert.ok(feedbackText.startsWith('我看了一个岗位四分钟'))
  assert.match(feedbackText,/先前的可用时间/)
  assert.match(feedbackText,/原时限由本人选择，不是助手安排/)
  assert.match(feedbackText,/实际用时不证明原时限够或不够/)
  assert.match(feedbackText,/本轮来源边界/)
  assert.doesNotMatch(feedbackSchema.properties.reply.description??'',/先前的可用时间/)
  assert.equal(retained.matterProgress?.state,'partial')
  assert.equal(retained.matterProgress?.choice,'accepted')
  assert.equal(retained.nodes.filter(node=>node.kind==='fact'&&node.source?.quote==='我看了一个岗位四分钟').length,1)
  assert.ok((await growthView(partial.user)).items.some(item=>item.text==='只核对了三列标题'))
  assert.ok((await growthView(partial.user)).items.some(item=>item.text==='我看了一个岗位四分钟'&&item.progressState==='attempted'))
  assert.ok((await growthView(partial.user)).items.some(item=>item.text==='也没帮我判断方向'))
  assert.ok((await store.listExperiences(partial.user)).some(item=>item.content.action==='我看了一个岗位四分钟'))
  const gap=retained.nodes.find(node=>node.kind==='unknown'&&node.content==='中断原因和方法效果仍未知')!
  assert.equal(gap.status,'active')
  const nextChat=randomUUID()
  await store.createConversation(partial.user,{id:nextChat,title:'SYNTHETIC semantic feedback adjustment'})
  const next=await h.execute(partial.user,nextChat,'接着上次的就业探索，我周五有半小时。这次请按上次的实际反馈帮我改一个可开始的步骤。',{
   growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c1'}}],
   event:{target:{operation:'continue',eventId:chosen.id,expectedRevision:retained.revision},resolveUnknowns:[gap.id],factRefs:[0],matterReports:[{state:'partial',choice:null,resumed:false,source:{clauseId:'c0'}},{state:null,choice:null,resumed:false,source:{clauseId:'c1'}},{state:'adjusted',choice:null,resumed:false,source:{clauseId:'c2'}}]},
  },'周五打开能访问的一个岗位页面，找一条实际要求做什么的具体信息并记录，到半小时就停。上次只核对了标题，这次先补一条实际内容。')
  const revisionRequest=h.requests.at(-1)
  assert.equal(Object.keys(revisionRequest.response_format.json_schema.schema.properties)[0],'reply')
  const revisionText=revisionRequest.messages.at(-1).content
  assert.ok(revisionText.startsWith('接着上次的就业探索，我周五有半小时。'))
  assert.match(revisionText,/只核对了三列标题/)
  assert.match(revisionText,/按可见内容找与目标有关的实际信息/)
  assert.match(revisionText,/未知的栏目、标题和位置不作入口/)
  assert.match(revisionText,/实际用时不证明原时限够或不够/)
  assert.match(revisionText,/是否留下旧记录未报告就保持未知/)
  assert.match(revisionText,/独立请求和通用示例照常完整交付/)
  assert.match(revisionText,/仅记录本次查找的结果/)
  assert.doesNotMatch(revisionText,/"sourceMessageId"/,'provider delivery needs the feedback quotes only')
  const revisionContext=JSON.parse(revisionRequest.messages.find((message:any)=>message.role==='user').content)
  assert.equal(revisionContext.currentTask.priorFeedback,undefined,'the same sourced feedback must travel once in the request envelope')
  assert.ok(revisionContext.currentUserMessage.clauses.every(({text}:any)=>!text.includes('仅记录本次查找的结果')),'server delivery instructions cannot become source evidence')
  const revised=await coachEventView(partial.user,nextChat,chosen.id)
  assert.equal(revised?.matterProgress?.state,'partial')
  assert.equal(revised?.nodes.find(node=>node.id===gap.id)?.status,'active')
  const noop=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND request_id=$2',[partial.user,next.request_id])).rows[0].snapshot
  assert.equal(noop.matterReportVersion,1)
  assert.deepEqual(noop.matterReports,[])
  assert.ok((await growthView(partial.user,nextChat)).items.some(item=>item.status==='active'&&item.text==='我周五有半小时'))
  assert.ok(!(await growthView(partial.user,nextChat)).items.some(item=>item.text.includes('帮我改一个可开始的步骤')))
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[partial.user,next.request_id])).rows[0].count,1)
  await h.execute(partial.user,nextChat,'我看了一个岗位五分钟，只核对了两个标题，没有完成，也没帮我判断方向。今天没时间了。',{
   event:{target:{operation:'create',title:'另建重复岗位探索',source:{clauseId:'c0'}},matterReports:[]},
  },'这次看了五分钟，只核对了两个标题，没有完成，也没帮你判断方向。下次可以只找一条实际工作内容。')
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM coach_events WHERE user_id=$1',[partial.user])).rows[0].count,1)
  const retried=(await coachEventView(partial.user,nextChat,chosen.id))!
  assert.equal(retried.matterProgress?.state,'partial')
  assert.ok(retried.nodes.some(node=>node.kind==='fact'&&node.source?.quote==='我看了一个岗位五分钟'))
  const ordinary=await h.account()
  const ordinaryReply='会前写下一句你希望大家记住的主张，再补一句实际依据。'
  const ordinaryRun=await h.execute(ordinary.user,ordinary.chat,'社团开会时我有个想法没讲清，怎样在下次发言前把它理顺？',{
   growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}],
   event:{target:{operation:'create',title:'社团发言',source:{clauseId:'c0'}},matterReports:[{state:'partial',choice:null,resumed:false,source:{clauseId:'c1'}}]},
  },ordinaryReply)
  const ordinarySaved=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[ordinary.user,ordinaryRun.request_id])).rows
  assert.deepEqual(ordinarySaved,[{content:ordinaryReply}])
  const ordinaryFacts=(await growthView(ordinary.user)).items
  assert.ok(ordinaryFacts.some(item=>item.text==='社团开会时我有个想法没讲清'))
  assert.ok(!ordinaryFacts.some(item=>item.text.includes('怎样在下次发言前')))
  assert.ok(!(await coachEventView(ordinary.user,ordinary.chat))?.matterProgress?.reports.length)
  const reportOnly=await h.account()
  await h.execute(reportOnly.user,reportOnly.chat,'这次岗位探索我接下来了',{
   event:{target:{operation:'create',title:'岗位探索',source:{clauseId:'c0'}},matterReports:[{state:'accepted',choice:'accepted',resumed:false,source:{clauseId:'c0'}}]},
  })
  assert.equal((await coachEventView(reportOnly.user,reportOnly.chat))?.matterProgress?.choice,'accepted')
  const facts=(await growthView(reportOnly.user)).items.filter(item=>item.text==='这次岗位探索我接下来了')
  assert.equal(facts.length,1,'a report source enters the canonical fact path once')
  await transaction(c=>applyGrowthAction(c,reportOnly.user,facts[0].id,{requestId:randomUUID(),expectedRevision:facts[0].revision,action:'forget'}))
  const visible=await coachEventView(reportOnly.user,reportOnly.chat)
  assert.ok(!visible?.matterProgress?.reports.some(report=>report.choice==='accepted'))
 }finally{await h.close()}
})
