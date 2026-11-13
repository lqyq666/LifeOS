import test from 'node:test'
import assert from 'node:assert/strict'
import {decisionComparisonRequest,requestsMatterDecision} from '../../server/user-command-spans.ts'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {stageCoachEvent,coachEventView,invalidateCoachSources,type CoachEvent} from '../../server/action-coach-events.ts'
import {growthView} from '../../server/growth.ts'
import {pool,transaction} from '../../server/db.ts'
import {readPriorDecision} from '../../server/coach-retrieval.ts'
import {importKnowledge,type KnowledgeCard} from '../../server/campus-knowledge.ts'
import {buildClauseCatalogue} from '../../server/clause-catalogue.ts'
import {bindDecisionProposalSchema,compileDecisionConditions,projectDecisionCases} from '../../server/decision-comparison.ts'
import {buildTurnPrompt,providerTurnMessages} from '../../server/turn-prompt.ts'
import {readDirectionControls} from '../../server/growth-controls.ts'
import {listControlRequests} from '../../server/memory-controls.ts'
const metadata=(payload:any)=>JSON.parse(payload.messages.find((m:any)=>m.role==='user'&&m.content.startsWith('{')).content)
const assertTimeScope=(payload:any)=>{
 const boundary=/把分钟写成这次可投入的上限。投入变少时缩小实际起步范围。最低起步耗时只按本人报告/
 const system=payload.messages.find((message:any)=>message.role==='system').content
 const reply=payload.response_format.json_schema.schema.properties.reply
 assert.match(system,boundary)
 assert.match(reply.description,boundary)
 assert.match(reply.description,/零投入事项，只按相对优先级、本人明确暂停或已知资源限制/)
}


test('low energy instructions only apply to items allocated time',()=>{
 const low=compileDecisionConditions('','我现在有10分钟，精力很低。')
 const open={id:randomUUID(),title:'课程报告',nodes:[
  {kind:'unknown',status:'active',content:'报告主题和需要论证的核心观点是什么？'},
  {kind:'unknown',status:'resolved',content:'报告日期是什么？'},
  {kind:'unknown',status:'declined',content:'是否需要联系老师？'},
  {kind:'unknown',status:'active',supersededByActionCorrection:true,content:'已更正的旧问题。'},
 ],matterProgress:{state:'unattempted'}} as unknown as CoachEvent
 assert.deepEqual(projectDecisionCases([open],low)[0]?.unresolvedQuestions,['报告主题和需要论证的核心观点是什么？'])
 const paused={...open,matterProgress:{...open.matterProgress!,state:'paused' as const}}
 const description=(event:CoachEvent,minutes:number)=>{
  const conditions={...low,minutes}
  return bindDecisionProposalSchema({properties:{reply:{type:'string'}}},projectDecisionCases([event],conditions),conditions).properties.reply.description
 }
 assert.match(description(open,10),/workScope为smallest_substep且确有投入时/)
 assert.match(description(open,10),/未接受的只称建议/)
 assert.doesNotMatch(description(open,0),/smallest_substep/)
 assert.doesNotMatch(description(paused,10),/smallest_substep/)
})

test('condition comparison is an owned reversible request, not a hypothetical fact or ordinary question',()=>{
 for(const text of ['请试算：如果我只有10分钟，手头这些事的优先级怎么变？','我现在精力很低，请按这个条件重新比较刚才的取舍。','暂时不能联系任何人，帮我重新比较这些事。'])assert.equal(decisionComparisonRequest(text,true),'compare',text)
 assert.equal(decisionComparisonRequest('那如果我只剩10分钟呢？',true),'compare')
 for(const prefix of ['仍','仍然','这轮','剩余'])assert.equal(decisionComparisonRequest('那如果我'+prefix+'只有2分钟呢？',true),'compare',prefix)
 assert.equal(decisionComparisonRequest('我的这些事，如果只剩2分钟呢？',true),'compare')
 assert.equal(decisionComparisonRequest('我的这些事如果只剩2分钟呢？',true),'compare')
 for(const activity of ['做完报告后只剩','看完材料后只有','完成答辩后只剩'])assert.equal(decisionComparisonRequest('那如果我'+activity+'2分钟呢？',true),'compare',activity)
 assert.equal(decisionComparisonRequest('那如果我做完报告后大概只剩2分钟呢？',true),'compare')
 assert.equal(decisionComparisonRequest('我现在只有2分钟。那如果精力也很低呢？',true),'compare')
 assert.equal(decisionComparisonRequest('我现在只有2分钟。那如果老师精力也很低呢？',true),null)
 for(const activity of ['看前两页','写前言','写前端代码','做前端开发','做后端开发'])assert.equal(decisionComparisonRequest('那如果我'+activity+'只有2分钟呢？',true),null,activity)
 assert.equal(decisionComparisonRequest('那如果我忙完报告，现在只剩2分钟呢？',true),'compare')
 assert.equal(decisionComparisonRequest('那如果我只剩2分钟呢，用来写报告怎么办？',true),null)
 for(const scope of ['当前任务','本次任务','这轮任务'])assert.equal(decisionComparisonRequest('那如果我'+scope+'只有2分钟呢？',true),null,scope)
 assert.equal(decisionComparisonRequest('那如果我只剩2分钟呢？只改变可用时间，其余仍按刚才真实基线。请说明比上次哪些步骤和投入范围变了、哪些不变，不保证到点完成。',true),'compare')
 assert.equal(decisionComparisonRequest('那如果我只剩10分钟呢？',false),null)
 assert.equal(decisionComparisonRequest('如果网络断了，TCP连接会怎样？',true),null)
 assert.equal(decisionComparisonRequest('我只有2分钟用来写报告。那如果我改天再看电影呢？',true),null)
 assert.equal(decisionComparisonRequest('我只有2分钟用来写报告。那如果我看电影只有2分钟呢？',true),null)
 assert.equal(decisionComparisonRequest('我不想再试算10分钟条件了。',true),null)
 assert.equal(decisionComparisonRequest('不要重新比较之前的取舍。',true),null)
 assert.equal(decisionComparisonRequest('恢复真实条件后不用比较。',true),null)
 assert.equal(decisionComparisonRequest('请比较时间管理和精力管理有什么区别？',true),null)
 for(const text of ['我现在只有10分钟看视频，该看哪个？','如果我只有10分钟看视频会怎样？'])assert.equal(decisionComparisonRequest(text,true),null)
 assert.equal(decisionComparisonRequest('取消试算，回到原来的真实条件重新比较。',true),'restore')
 assert.equal(decisionComparisonRequest('请恢复真实条件重新比较。',true),'restore')
 assert.equal(decisionComparisonRequest('请恢复真实条件重新比较。',false),'restore')
 assert.equal(decisionComparisonRequest('请回到现实条件重新比较。',true),'restore')
 assert.equal(requestsMatterDecision('请比较苹果和香蕉。'),false)
 assert.equal(requestsMatterDecision('我现在应该怎么办？'),false)
 assert.equal(decisionComparisonRequest('不用试算了，恢复真实条件重新比较。',true),'restore')
 assert.equal(decisionComparisonRequest('不要恢复真实条件，继续按上次10分钟试算。',true),'compare')
 assert.equal(decisionComparisonRequest('恢复真实条件，不用比较了。',true),null)
 assert.equal(requestsMatterDecision('报告和表格权限，我现在应该先做哪个？'),true)
 assert.equal(requestsMatterDecision('报告和表格权限应该先做哪个？'),true)
 assert.equal(requestsMatterDecision('我在考研和就业之间该选哪个？'),true)
 assert.equal(decisionComparisonRequest('重比一下我只剩10分钟的情况。',true),'compare')
 assert.equal(decisionComparisonRequest('重新比较之前的取舍。',false),'compare')
 assert.equal(decisionComparisonRequest('重新比较一下我只剩10分钟的情况。',true),'compare')
 for(const text of ['那如果我不能给老师发消息呢？','那如果我不能打电话、不能见面呢？','要是我手机没网呢？'])assert.equal(decisionComparisonRequest(text,true),'compare',text)
 assert.equal(decisionComparisonRequest('我现在时间不够，建议怎么调整？'),null,'an ordinary real-condition consultation is not a trial')
 assert.equal(decisionComparisonRequest('假设我没有电脑，请重新比较之前的取舍。',true),'compare')
 assert.equal(decisionComparisonRequest('请试算：如果我只剩10分钟，优先级怎么变？另外我接受上次建议的报告步骤。',true),'compare')
 for(const text of ['如果我只有10分钟会怎样？','同学说如果我只有10分钟就重新比较。','“请试算：如果我只有10分钟，优先级怎么变？”','```请试算：如果我只有10分钟，优先级怎么变？```','帮我排查条件判断的Bug。','我接受这个步骤。','帮我重新比较这些事。算了，不用比较了。'])assert.equal(decisionComparisonRequest(text),null,text)
})

async function verifyComparisonFactWrites(h:Awaited<ReturnType<typeof residualHarness>>){
  const {user,chat}=await h.account(),title='课程报告',sourceText='我接受课程报告步骤。报告还没有开始。'
  const openQuestion='报告主题和需要论证的核心观点是什么？'
  const first=(await store.startRun(user,chat,randomUUID(),sourceText)).run
  const saved=await store.finishRun(first,{candidates:[],audit:[],coach:await stageCoachEvent(first,{target:{operation:'create',title,source:{messageId:first.source_message_id,quote:sourceText}},nodes:[{kind:'fact',source:{messageId:first.source_message_id,quote:sourceText}},{kind:'unknown',question:openQuestion}]},'按你的原话保留。')},'按你的原话保留。',null,new AbortController().signal)
  await h.execute(user,chat,'我有60分钟，帮我把手头这些事排个优先级。',{},'先以课程报告作为可开始的事项。')
  const budget='我现在每周实际只有2小时',major='我的专业实际上是信息管理',trial='请试算：如果我只有10分钟'
  const mixed=budget+'；'+trial+'，重新比较之前的取舍。'+major+'。'
  const handle=(text:string)=>buildClauseCatalogue(mixed).find(clause=>clause.text===text)!.clauseId
  await h.execute(user,chat,mixed,{growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:handle(major)}},{target:{operation:'create'},kind:'ability',assertion:'user_reported',source:{clauseId:handle(trial)}}]},'按十分钟试算课程报告的起点。真实每周两小时的约束单独保留。')
  const state=()=>growthView(user,chat).then(value=>value.items.filter(item=>item.status==='active'&&!item.unavailableReason))
  const recorded=await state()
  assert.ok(recorded.some(item=>item.text===budget),'an explicit recurring budget remains available')
  assert.ok(recorded.some(item=>item.text===major),'an independent profile fact is available after the trial')
  assert.ok(!recorded.some(item=>item.text.includes(trial)),'the optional model write cannot persist a trial handle')
  assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,10,'the current allocation still respects the trial')
  assert.equal((await coachEventView(user,chat,saved.event!.id))!.revision,saved.event!.revision,'the report is not a matter transition')
  await h.execute(user,chat,'更正一下，我的专业不是信息管理，是软件工程，请按五分钟试算重新比较之前的取舍。',{},'专业按你的更正处理。五分钟只用于这一轮的比较。')
  const updated=await state()
  assert.ok(!updated.some(item=>item.text===major),'the old major is no longer active')
  assert.ok(updated.some(item=>item.text.includes('软件工程')))
  assert.ok(updated.some(item=>item.text===budget),'the correction leaves the independent budget intact')
  const actualTime='我现在有45分钟'
  await h.execute(user,chat,actualTime+'；假设我不能联网，重新比较之前的取舍。',{},'在实际四十五分钟内比较假设断网时能独立做的部分。')
  assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,45)
  assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.network,false)
  await h.execute(user,chat,'恢复真实条件重新比较。',{},'回到实际四十五分钟，联网情况保持未知。')
  const restoredWire=h.requests.at(-1)
  assert.equal(metadata(restoredWire).decisionPlanContract.conditions.minutes,45,'the mixed turn’s actual source is still authorized after restoring')
  assert.equal(metadata(restoredWire).decisionPlanContract.conditions.network,null)
  assert.deepEqual(metadata(restoredWire).decisionPlanContract.cases.find((item:any)=>item.title===title).unresolvedQuestions,[openQuestion])
  const materialBoundary=/材料是否可用按已知来源判断。尚未确认时，先说明材料可用时才起步。恢复真实条件也适用。/
  assert.match(restoredWire.messages.at(-1).content,materialBoundary)
  assert.match(restoredWire.messages.at(-1).content,/恢复后仍未确认：[^。]*能否联网/)
  assert.match(restoredWire.messages.at(-1).content,/依赖未确认条件的动作写明前提/)
  assert.match(restoredWire.response_format.json_schema.schema.properties.reply.description,/缺少该前提时只做初步整理或给出条件式起步/)
  assert.match(restoredWire.response_format.json_schema.schema.properties.reply.description,materialBoundary)
  assertTimeScope(restoredWire)
  const later=randomUUID()
  await store.createConversation(user,{id:later,title:'SYNTHETIC cross-session actual reports'})
  await h.execute(user,later,'按已保存的实际资料，说明我的专业和每周时间。',{},'软件工程，每周实际两小时。')
  const laterContext=JSON.stringify(metadata(h.requests.at(-1)))
  assert.ok(laterContext.includes('软件工程')&&laterContext.includes(budget))
  assert.ok(!laterContext.includes(trial))
  const transition='另外我接受课程报告步骤',duplicate='“'+transition+'”。如果只是在演练，'+transition+'。'+transition+'。'+trial+'，重新比较之前的取舍。'
  const event=(await coachEventView(user,chat,saved.event!.id))!
  const target={operation:'continue',eventId:event.id,expectedRevision:event.revision}
  await assert.rejects(h.execute(user,chat,duplicate,run=>({event:{target,nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:transition}}]}}),'这次只按十分钟试算。'),/COACH_OUTPUT_INVALID|TRIAL_SOURCE_NOT_WRITABLE/,'a duplicated literal cannot select the real occurrence')
  await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_AMBIGUOUS_SOURCE',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[user,chat])
  const selected=buildClauseCatalogue(duplicate).find(clause=>clause.text===transition&&!clause.quoted&&!clause.conditional)!
  const clauseId=selected.clauseId
  await h.execute(user,chat,duplicate,{event:{target,nodes:[{kind:'fact',source:{clauseId}}]}},'按十分钟试算；你另外确认接受报告步骤，是否执行还未知。')
  const updatedEvent=(await coachEventView(user,chat,event.id))!
  assert.ok(updatedEvent.nodes.some(node=>node.content===transition),'a server-owned clause handle keeps the real matter update')
  const sourceRows=(await pool.query('SELECT source FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND content=$3',[user,event.id,transition])).rows
  assert.ok(sourceRows.some(row=>row.source?.range?.start===selected.start&&row.source?.range?.end===selected.end))
}

test('changing a trial condition reuses canonical matters without committing a choice or leaking the trial into later facts',async t=>{
 const h=await residualHarness();try{
 await t.test('independent facts and corrections survive the comparison and carry into later help',()=>verifyComparisonFactWrites(h))
 const failedAccount=await h.account(),failed=(await store.startRun(failedAccount.user,failedAccount.chat,randomUUID(),'报告和表格权限，我现在应该先做哪个？')).run
 await store.terminateRun(failedAccount.user,failed.request_id,'failed','SYNTHETIC_BEFORE_GENERATION')
 await h.execute(failedAccount.user,failedAccount.chat,'那如果我只剩10分钟呢？',{},'此前尚未完成有效取舍，不能假设原来的建议是什么。')
 assert.equal(metadata(h.requests.at(-1)).decisionComparison,undefined,'failed runs are never completed decision baselines')
 const privacy=await h.account(),privacyText='我在核对自律安排。我接受这个步骤。尚未执行。',privacySource=(await store.startRun(privacy.user,privacy.chat,randomUUID(),privacyText)).run
 const privacyEvent=(await store.finishRun(privacySource,{candidates:[],audit:[],coach:await stageCoachEvent(privacySource,{target:{operation:'create',title:'自律',source:{messageId:privacySource.source_message_id,quote:privacyText}},nodes:[{kind:'fact',source:{messageId:privacySource.source_message_id,quote:privacyText}}]},'合成来源，未调用模型。')},'合成来源，未调用模型。',null,new AbortController().signal)).event!
 await h.execute(privacy.user,privacy.chat,'我有60分钟，帮我把手头这些事排个优先级。',{},'只讨论自律事项的暂定取舍。')
 const privacyBefore=await coachEventView(privacy.user,privacy.chat,privacyEvent.id)
 await h.execute(privacy.user,privacy.chat,'忘掉“我不自律”这个从未由我确认的错误标签；不要从这些经历重新推出来；请试算：如果我只有10分钟，重新比较之前的取舍。',{},'只按十分钟试算，自律事项不被隐私控制改写。')
 assert.deepEqual(await coachEventView(privacy.user,privacy.chat,privacyEvent.id),privacyBefore,'privacy-control text never becomes a fact even when it matches the sole matter title')
 assert.ok((await growthView(privacy.user,privacy.chat)).items.some(x=>x.inferenceBoundary?.active),'the actual privacy boundary still takes effect')
 const overlap=await h.account(),overlapEvents=[]
 for(const title of ['报告','报告权限']){
  const text='我接受'+title+'步骤。尚未执行。',run=(await store.startRun(overlap.user,overlap.chat,randomUUID(),text)).run
  overlapEvents.push((await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},'合成来源。')},'合成来源。',null,new AbortController().signal)).event!)
 }
 await h.execute(overlap.user,overlap.chat,'我有60分钟，帮我把手头这些事排个优先级。',{},'讨论报告与报告权限的取舍。')
 const overlapBefore=await Promise.all(overlapEvents.map(e=>coachEventView(overlap.user,overlap.chat,e.id))),overlapCalls=h.requests.length
 await assert.rejects(h.execute(overlap.user,overlap.chat,'请按10分钟试算；另外我先暂停报告权限这件事。',{},'不应发生生成。'),/TRIAL_ACTUAL_MATTER_TARGET_UNRESOLVED/)
 assert.equal(h.requests.length,overlapCalls);assert.deepEqual(await Promise.all(overlapEvents.map(e=>coachEventView(overlap.user,overlap.chat,e.id))),overlapBefore)
 const {user,chat}=await h.account(),events:CoachEvent[]=[]
 for(const [title,text] of [['报告','我接受这个步骤。报告还没有开始，截止明晚。'],['表格权限','我接受这个步骤。我完成了表格，但小陈打不开。我能修改权限，只同意小陈账号查看。'],['竞赛','竞赛报名准备先放下。我先暂停这件事。']]){
  const conversation=randomUUID();await store.createConversation(user,{id:conversation,title})
  const run=(await store.startRun(user,conversation,randomUUID(),text)).run
  events.push((await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},'按本人报告保留状态。')},'按本人报告保留状态。',null,new AbortController().signal)).event!)
 }
 const orphanChat=randomUUID();await store.createConversation(user,{id:orphanChat,title:'synthetic long baseline'})
 await h.execute(user,orphanChat,'我有60分钟，精力充足。帮我把手头这些事排个优先级。',{},'先做报告。')
 assert.ok(h.requests.at(-1).response_format.json_schema.schema.required.includes('decisionProposal'),'ordinary first comparison creates the before proposal, not only trials')
 // Reproduce the actual bounded context shape (prior user absent, assistant
 // retained) without sending an artificial over-budget prompt to the model.
 await h.execute(user,orphanChat,'那如果我只剩2分钟呢？',{},'只做报告的一个小起点。',rows=>rows.filter(row=>row.role!=='user'||row.id===rows.at(-1)!.id))
 assert.equal(metadata(h.requests.at(-1)).decisionComparison.mode,'compare','orphaned ordinary assistant still identifies an immediately preceding decision')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,2)
 assert.ok(metadata(h.requests.at(-1)).decisionComparison.realConditionComparison.conditionsText.includes('60分钟'))
 const gapChat=randomUUID();await store.createConversation(user,{id:gapChat,title:'synthetic trimmed topic change'})
 await h.execute(user,gapChat,'我有60分钟。帮我把手头这些事排个优先级。',{},'先做报告。')
 const unrelated=await h.execute(user,gapChat,'普通问题：一加一是多少？',{},'2。')
 // Isolate historical trimming without paying for or sending an oversized
 // prompt: only this disposable synthetic prior user body is lengthened.
 await pool.query("UPDATE messages SET content=repeat('x',12500) WHERE user_id=$1 AND run_request_id=$2 AND role='user'",[user,unrelated.request_id])
 await h.execute(user,gapChat,'那如果我只剩2分钟呢？',{},'当前缺少比较对象，不能套用之前已换话题的事项。')
 assert.equal(metadata(h.requests.at(-1)).decisionComparison,undefined,'an omitted unrelated user turn still closes implicit reference')
 const supplementChat=randomUUID();await store.createConversation(user,{id:supplementChat,title:'synthetic latest actual conditions'})
 const microChat=randomUUID();await store.createConversation(user,{id:microChat,title:'synthetic exact microsecond condition order'})
 const microBaseline=await h.execute(user,microChat,'我实际有60分钟。帮我把手头这些事排个优先级。',{},'先做报告。')
 const microCorrection=await h.execute(user,microChat,'更正一下我现在实际只有30分钟。',{},'实际改为三十分钟。')
 await pool.query("UPDATE messages SET created_at=CASE WHEN id=$2 THEN '2001-01-01 00:00:00.000100+00'::timestamptz ELSE '2001-01-01 00:00:00.000900+00'::timestamptz END WHERE user_id=$1 AND id=ANY($3::uuid[])",[user,microBaseline.source_message_id,[microBaseline.source_message_id,microCorrection.source_message_id]])
 await h.execute(user,microChat,'恢复真实条件重新比较。',{},'按最新实际三十分钟讨论报告。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,30,'PostgreSQL microseconds are preserved when ordering actual condition supplements')
 const sourceKindChat=randomUUID();await store.createConversation(user,{id:sourceKindChat,title:'synthetic real vs trial source authority'})
 const realSource=await h.execute(user,sourceKindChat,'我有60分钟。精力充足。帮我把手头这些事排个优先级。',{},'先做报告。')
 await h.execute(user,sourceKindChat,'我有60分钟。请按这个条件重新比较之前的取舍，假设我精力很低。',{},'本轮六十分钟与低精力是试算。')
 await pool.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4)',[user,sourceKindChat,realSource.source_message_id,'我有60分钟'])
 await h.execute(user,sourceKindChat,'恢复真实条件重新比较。',{},'原真实时间来源已停止使用，不能用试算重新证明六十分钟。报告只能按当前未知时间讨论。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,null,'an identical trial quote cannot re-authorize a withdrawn real condition')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.energy,'adequate','unrelated real conditions retain their own source')
 const inheritedActual=randomUUID();await store.createConversation(user,{id:inheritedActual,title:'synthetic inherited actual condition invalidated'})
 await h.execute(user,inheritedActual,'我有60分钟。精力充足。帮我把手头这些事排个优先级。',{},'先做报告。')
 await h.execute(user,inheritedActual,'假设我精力很低，重新比较之前的取舍。',{},'本轮只改精力，报告只做小步。')
 const changedActual=await h.execute(user,inheritedActual,'更正一下我现在实际只有30分钟。',{},'真实时间三十分钟。')
 await pool.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4)',[user,inheritedActual,changedActual.source_message_id,'我现在实际只有30分钟'])
 await h.execute(user,inheritedActual,'假设我不能联网，重新比较之前的取舍。',{},'仍按低精力讨论报告，真实时间当前未知，不回退旧预算。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,null,'a continued scenario must not inherit a superseded real budget from its earlier proposal')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.energy,'low','the independently authorized low-energy assumption is retained')
 const invalidatedChat=randomUUID();await store.createConversation(user,{id:invalidatedChat,title:'synthetic withdrawn newest real correction'})
 await h.execute(user,invalidatedChat,'我有60分钟。精力充足。帮我把手头这些事排个优先级。',{},'先做报告。')
 const latestReal=await h.execute(user,invalidatedChat,'更正一下我现在实际只有30分钟。',{},'实际三十分钟。')
 await pool.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4)',[user,invalidatedChat,latestReal.source_message_id,'我现在实际只有30分钟'])
 await h.execute(user,invalidatedChat,'恢复真实条件重新比较。',{},'最新时间来源已停止使用，不能回退到更早的六十分钟。报告按未知时间讨论。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,null,'withdrawing the newest correction cannot resurrect a superseded earlier value')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.energy,'adequate')
 const deferred=randomUUID();await store.createConversation(user,{id:deferred,title:'synthetic deferred actual correction'})
 await h.execute(user,deferred,'我实际有60分钟，精力充足。帮我把手头这些事排个优先级。',{},'先做报告。')
 await h.execute(user,deferred,'更正一下我现在实际只有30分钟。',{},'以实际三十分钟为准。')
 for(let i=0;i<9;i++)await h.execute(user,deferred,'普通问题：一加一是多少？',{},'2。')
 await h.execute(user,deferred,'恢复真实条件重新比较。',{},'以最新实际三十分钟讨论报告。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,30,'actual corrections survive without any intervening proposal')
 const failedBoundary=randomUUID();await store.createConversation(user,{id:failedBoundary,title:'synthetic failed topic boundary'})
 await h.execute(user,failedBoundary,'我实际有60分钟。帮我把手头这些事排个优先级。',{},'先做报告。')
 const boundaryRun=(await store.startRun(user,failedBoundary,randomUUID(),'牛顿第二定律是什么？')).run
 await store.terminateRun(user,boundaryRun.request_id,'failed','SYNTHETIC_TOPIC_BOUNDARY_FAILURE')
 await h.execute(user,failedBoundary,'补充一下：我现在实际只有10分钟。',{},'按本轮新话题说明。')
 for(let i=0;i<9;i++)await h.execute(user,failedBoundary,'谢谢。',{},'收到。')
 await h.execute(user,failedBoundary,'恢复真实条件重新比较。',{},'恢复原事项六十分钟，失败的问题仍然关闭了旧承接。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,60)
 const middle=randomUUID();await store.createConversation(user,{id:middle,title:'synthetic correction between history windows'})
 await h.execute(user,middle,'我实际有60分钟。帮我把手头这些事排个优先级。',{},'先做报告。')
 for(let i=0;i<50;i++)await h.execute(user,middle,i===34?'再补充一下：我现在实际只有20分钟。':'补充一下：报告仍然明晚截止。',{},'保留本轮补充。')
 await h.execute(user,middle,'恢复真实条件重新比较。',{},'按最新实际二十分钟讨论报告。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,20,'latest field sources in a long supplement sequence cannot fall into an unmarked history gap')
 await h.execute(user,supplementChat,'我实际有60分钟，精力充足。帮我把手头这些事排个优先级。',{},'先做报告。')
 await h.execute(user,supplementChat,'谢谢，补充一下：我现在实际只有30分钟。',{},'这次实际时间以三十分钟为准。')
 await h.execute(user,supplementChat,'那如果我精力很低呢？',{},'只降低精力，报告只做可停止的一小步。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,30,'actual supplements update the basis of subsequent trials')
 await h.execute(user,supplementChat,'请恢复真实条件重新比较。',{},'回到实际三十分钟、精力充足的报告取舍。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,30)
 for(let i=0;i<9;i++)await h.execute(user,supplementChat,'普通问题：一加一是多少？',{},'2。')
 await h.execute(user,supplementChat,'请恢复真实条件重新比较。',{},'仍以本人最新实际三十分钟讨论报告，先前低精力只是试算。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,30,'authorized latest real condition references survive beyond the raw history window')
 const topicChat=randomUUID();await store.createConversation(user,{id:topicChat,title:'synthetic unrelated available time'})
 await h.execute(user,topicChat,'我实际有60分钟。帮我把手头这些事排个优先级。',{},'先做报告。')
 await h.execute(user,topicChat,'换个话题。我现在只有10分钟玩游戏。',{},'只讨论这次娱乐安排。')
 await h.execute(user,topicChat,'重新比较之前的取舍。',{},'回到报告和权限的原比较，不把游戏时长套用过来。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,60,'explicit topic change ends inheritance of unrelated activity-specific time')
 const prefixedTopic=randomUUID();await store.createConversation(user,{id:prefixedTopic,title:'synthetic prefixed explicit topic close'})
 await h.execute(user,prefixedTopic,'我有60分钟，帮我把手头这些事排个优先级。',{},'先做报告。')
 await h.execute(user,prefixedTopic,'补充一下：换个话题，聊聊牛顿第二定律。',{},'仅回答牛顿第二定律。')
 await h.execute(user,prefixedTopic,'那如果我只剩10分钟呢？',{},'当前已换话题，不能套用旧事项。')
 assert.equal(metadata(h.requests.at(-1)).decisionComparison,undefined)
 for(const unrelated of [['牛顿第二定律是什么？','我现在只有10分钟看视频。'],['我现在有10分钟玩游戏。'],['补充一下：我现在只有10分钟玩游戏。']]){
  const other=randomUUID();await store.createConversation(user,{id:other,title:'synthetic closed topic conditions'})
  await h.execute(user,other,'我实际有60分钟。帮我把手头这些事排个优先级。',{},'先做报告。')
  for(const text of unrelated)await h.execute(user,other,text,{},'只回答本轮内容。')
  await h.execute(user,other,'恢复真实条件重新比较。',{},'恢复原报告与权限取舍的六十分钟。')
  assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,60,'an ordinary unrelated turn closes later condition replay')
 }
 const emptyChat=randomUUID();await store.createConversation(user,{id:emptyChat,title:'synthetic missing prior'})
 const unscopedChat=randomUUID();await store.createConversation(user,{id:unscopedChat,title:'synthetic first trial missing matters'})
 await h.execute(user,unscopedChat,'请试算：如果我只有10分钟，优先级怎么变？',{},'还缺要比较的事项范围，不能从其他近期事项替你补。')
 assert.equal(metadata(h.requests.at(-1)).matterOverview.entries.length,0)
 for(let i=0;i<2;i++){
  await h.execute(user,emptyChat,'请试算：如果我只有10分钟，重新比较之前的取舍。',{},'原来的比较不可用，不能替换成其他近期事项。')
  assert.equal(metadata(h.requests.at(-1)).matterOverview.entries.length,0,'empty prior comparisons never fall back to unrelated existing matters')
 }
 await h.execute(user,chat,'我现在有60分钟，精力充足。帮我把手头这些事排个优先级。',{},'建议先处理报告，权限另留可控的一步；竞赛暂停。')
 assertTimeScope(h.requests.at(-1))
 await h.execute(user,chat,'补充一下，报告仍然是明晚截止。',{},'报告截止的补充只影响该事项。')
 await h.execute(user,chat,'谢谢，这很有帮助。',{},'可以继续按原事项讨论。')
 const before=await Promise.all(events.map(e=>coachEventView(user,chat,e.id)))
 const trial='那如果我只剩10分钟呢？只改变可用时间，其余仍按刚才真实基线。请说明比上次哪些步骤和投入范围变了、哪些不变，不保证到点完成。'
 await h.execute(user,chat,trial,{},'按十分钟试算，报告只做一段起步，不保证完成；竞赛仍不恢复。这不是本人接受新安排。')
 assertTimeScope(h.requests.at(-1))
 const p=metadata(h.requests.at(-1))
 assert.equal(p.decisionComparison.mode,'compare');assert.equal(p.decisionComparison.persistence,'TURN_ONLY_NOT_USER_FACTS')
 assert.equal(p.decisionPlanContract.conditions.minutes,10)
 assert.ok(p.decisionComparison.realConditionComparison.conditionsText.includes('60分钟'))
 assert.ok(!h.requests.at(-1).messages.some((message:any)=>message.role==='assistant'),'appended delivery instructions cannot return trial generation to old assistant prose')
 assert.equal(p.matterOverview.entries.length,3,'a short follow-up uses the same canonical working set')
 assert.equal(p.matterOverview.comparisonBasis,true,'original event refs survive a condition-only query')
 assert.ok(p.decisionComparison.previousComparison,'comparison can identify the previous considered conditions')
 await h.execute(user,chat,'我再做一次报告，继续沿用上次的试算条件。',{},'仍按十分钟条件讨论报告，不把另做报告当作重置试算。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,10)
 await h.execute(user,chat,'请不要另做一次试算，按上次的10分钟条件重新比较之前的取舍。',{},'继续原十分钟条件讨论报告，不新开试算。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,10)
 const schema=h.requests.at(-1).response_format.json_schema.schema.properties
 for(const name of ['growthUpdates','event','weeklyPlan','experienceCandidate','background'])assert.equal(schema[name],undefined,'trial has no '+name+' write lane')
 await h.execute(user,chat,'我现在精力很低，请按这个条件重新比较刚才的取舍。',{},'本轮精力低时只考虑负担较小的起步，允许休息；报告仍有原截止，竞赛仍暂停。这是试算。')
 assert.equal(metadata(h.requests.at(-1)).decisionComparison.mode,'compare')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.minutes,10,'a continued trial changes energy while retaining the preceding time assumption')
 await h.execute(user,chat,'暂时不能联网，也不能联系任何人，帮我重新比较这些事。',{},'本轮权限操作需要联网，先改为本地报告的一段准备；不联系任何人，也不恢复竞赛。')
 assert.equal(metadata(h.requests.at(-1)).decisionComparison.mode,'compare')
 await h.execute(user,chat,'取消试算，回到原来的真实条件重新比较。',{},'回到本人明确报告的六十分钟、精力充足条件；报告优先，竞赛暂停。')
 assert.equal(metadata(h.requests.at(-1)).decisionComparison.mode,'restore')
 assert.deepEqual(await Promise.all(events.map(e=>coachEventView(user,chat,e.id))),before,'comparison and restoration leave all canonical matter states unchanged')
 await h.execute(user,chat,'请根据已保存的实际记录说明情况，不把假设当作我现在的时间。',{},'仅使用本人真实报告和授权记录，十分钟假设不作为当前事实。')
 const actual=metadata(h.requests.at(-1))
 assert.equal(actual.decisionComparison,undefined)
 assert.ok(!JSON.stringify(actual).includes(trial),'trial dialogue is not future factual history')
 // contextForRun is bounded. Persisted non-fact trial marks must also work
 // when its initiating comparison has fallen out of that context window.
 await h.execute(user,chat,'帮我把手头这些事排个优先级。',{},'按真实事项先后讨论，暂停竞赛不恢复。')
 await h.execute(user,chat,'那如果我只有2分钟呢？',{},'仅按两分钟试算起步，不能保证做完。')
 for(let i=0;i<7;i++)await h.execute(user,chat,'这轮只回答一个普通问题：一加一是多少？',{},'2。')
 await h.execute(user,chat,'请试算：如果我只有3分钟，重新比较之前的取舍。',{},'按三分钟比较可控起步；原暂停不恢复，旧试算不是现实。')
 assert.equal(metadata(h.requests.at(-1)).matterOverview.comparisonBasis,true,'an orphaned trial assistant still carries canonical event refs at the 16-message boundary')
 assert.ok(metadata(h.requests.at(-1)).decisionComparison.previousComparison.hasCompletedReply)
 assert.equal(metadata(h.requests.at(-1)).decisionComparison.previousComparison.assistantProseExcluded,true)
 await h.execute(user,chat,'请根据真实记录说明当前条件。',{},'使用真实记录，先前试算不作为现实条件。')
 assert.ok(!JSON.stringify(metadata(h.requests.at(-1))).includes('那如果我只有2分钟呢？'))
 await h.execute(user,chat,'我会使用Excel整理表格。',{growthUpdates:[{target:{operation:'create'},kind:'ability',assertion:'user_reported',source:{clauseId:'c0'}}]},'这项本人报告的基础已保留，未推断水平。')
 await h.execute(user,chat,'请忘掉我会使用Excel整理表格这条记录；另外请试算：如果我只有10分钟，手头这些事优先级怎么变？',{},'按十分钟只读比较；遗忘指令按原记录单独处理。')
 assert.equal(metadata(h.requests.at(-1)).decisionComparison.mode,'compare')
 assert.ok(!(await growthView(user,chat)).items.some(x=>x.status==='active'&&x.text==='我会使用Excel整理表格'))
 const actualQuote='另外我接受报告步骤',mixed='请试算：如果我只有10分钟，手头这些事优先级怎么变？'+actualQuote+'。'
 const callsBefore=h.requests.length,statesBefore=await Promise.all(events.map(e=>coachEventView(user,chat,e.id)))
 await assert.rejects(h.execute(user,chat,'请按10分钟试算，重新比较之前的取舍；另外我先暂停报告这件事；另外我先暂停竞赛这件事。',{},'不应发生生成。'),/MULTIPLE_MATTER_UPDATES_REQUIRE_SEPARATE_TURNS/)
 assert.equal(h.requests.length,callsBefore,'multiple actual writes are rejected before any provider call rather than silently dropped')
 assert.deepEqual(await Promise.all(events.map(e=>coachEventView(user,chat,e.id))),statesBefore)
 await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_REJECTION_CLEANUP',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[user,chat])
 const revision=(await coachEventView(user,chat,events[0].id))!.revision
 await assert.rejects(h.execute(user,chat,mixed,{event:{target:{operation:'continue',eventId:events[1].id,expectedRevision:(await coachEventView(user,chat,events[1].id))!.revision},nodes:[{kind:'fact',source:{get messageId(){return metadata(h.requests.at(-1)).currentUserMessage.id},quote:actualQuote}}]}},'报告是本次接受的步骤；权限另按条件比较。'),/TRIAL_ACTUAL_TARGET_MISMATCH/,'an actual acceptance must target its named matter, just like a pause')
 await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_REJECTION_CLEANUP',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[user,chat])
 await h.execute(user,chat,mixed,{event:{target:{operation:'continue',eventId:events[0].id,expectedRevision:revision},nodes:[{kind:'fact',source:{get messageId(){return metadata(h.requests.at(-1)).currentUserMessage.id},quote:actualQuote}}]}},'只按十分钟比较；本人另外明确接受的报告步骤保留为真实选择，未执行。')
 const accepted=await coachEventView(user,chat,events[0].id)
 assert.ok(accepted!.nodes.some(x=>x.content===actualQuote),'separate actual acceptance survives the trial')
 assert.ok(!accepted!.nodes.some(x=>x.content.includes('10分钟')))
 const boundary='忘掉“我不自律”这个从未由我确认的错误标签；不要从这些经历重新推出来'
 await h.execute(user,chat,boundary+'；请试算：如果我只有10分钟，重新比较之前的取舍。',{},'本轮尊重这项推断边界，仅按假设条件比较。')
 const controlled=(await growthView(user,chat)).items.find(x=>x.inferenceBoundary?.active&&x.inferenceBoundary.label.includes('不自律'))
 assert.ok(controlled,'real inference rejection is saved even alongside a trial')
 assert.ok(!controlled!.text.includes('10分钟'),'privacy boundary cannot promote the accompanying trial condition')
 const pauseQuote='另外我先暂停报告这件事'
 await assert.rejects(h.execute(user,chat,'请试算：如果我只有10分钟，手头这些事怎么取舍？'+pauseQuote+'。',{event:{target:{operation:'continue',eventId:events[1].id,expectedRevision:(await coachEventView(user,chat,events[1].id))!.revision},nodes:[{kind:'fact',source:{get messageId(){return metadata(h.requests.at(-1)).currentUserMessage.id},quote:pauseQuote}}]}},'报告暂停，权限按本轮条件讨论。'),/TRIAL_ACTUAL_TARGET_MISMATCH/,'an actual report pause can never be redirected to a different matter')
 await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_REJECTION_CLEANUP',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[user,chat])
 await h.execute(user,chat,'请试算：如果我只有10分钟，手头这些事怎么取舍？'+pauseQuote+'。',{},'报告按本人刚刚的明确暂停处理；假设时间不记为现实。')
 assert.equal((await coachEventView(user,chat,events[0].id))!.matterProgress!.state,'paused','native actual pause survives without requiring a model mutation')
 for(let i=0;i<9;i++)await h.execute(user,chat,'普通问题：一加一是多少？',{},'2。')
 await h.execute(user,chat,'请试算：如果我只有3分钟，重新比较之前的取舍。',{},'沿用原事项再比较，报告与竞赛保持暂停，假设时间不是实际执行。')
 assert.equal(metadata(h.requests.at(-1)).matterOverview.comparisonBasis,true,'explicit prior comparison survives beyond the raw history window')
 assert.equal(metadata(h.requests.at(-1)).matterOverview.entries.length,3)
 await h.execute(user,chat,'我现在精力很低，请按这个条件重新比较刚才的取舍。',{},'沿用三分钟，只降低精力，报告与竞赛仍暂停。')
 for(let i=0;i<9;i++)await h.execute(user,chat,'普通问题：一加一是多少？',{},'2。')
 await h.execute(user,chat,'重新比较之前的取舍，假设我不能联网。',{},'沿用三分钟和低精力，只改联网限制；报告与竞赛仍暂停。')
  const offlineRequest=h.requests.at(-1)
  const offlineConditions=metadata(offlineRequest).decisionPlanContract.conditions
  assert.equal(offlineConditions.minutes,3,'an authorized earlier trial source can be re-read beyond the raw window without becoming a real fact')
  assert.equal(offlineConditions.network,false)
  assert.equal(offlineConditions.energy,'low')
  assert.match(offlineRequest.response_format.json_schema.schema.properties.reply.description,/本地材料能否打开未知时/)
  assert.doesNotMatch(JSON.stringify(offlineRequest.messages),/报告使用老师的公式、脚本或检查表/)
  assert.doesNotMatch(offlineRequest.response_format.json_schema.schema.properties.reply.description,/smallest_substep/)
  assert.match(offlineRequest.response_format.json_schema.schema.properties.reply.description,/未报告的截止与紧迫性保持未知/)
  assert.ok(metadata(offlineRequest).decisionPlanContract.cases.every((item:any)=>item.networkBlocked!==false))
  assert.ok(metadata(offlineRequest).decisionPlanContract.cases.every((item:any)=>item.candidateKinds.join(',')==='none'))
  assert.ok(metadata(offlineRequest).decisionPlanContract.cases.some((item:any)=>item.deadlineStatus==='no_known_date'))
 await h.execute(user,chat,'请重新试算：如果我只有10分钟，重新比较之前的取舍。',{},'本次从真实六十分钟基线另做十分钟试算，网络与精力的旧假设不沿用。')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.network,null,'a fresh trial does not inherit a prior no-network assumption when the actual network is unknown')
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.conditions.energy,'unknown','fresh trial returns to this comparison baseline, whose actual energy was not reported')
 await assert.rejects(h.execute(user,chat,mixed,{event:{target:{operation:'continue',eventId:events[0].id,expectedRevision:accepted!.revision},resolveUnknowns:[randomUUID()],nodes:[{kind:'fact',source:{get messageId(){return metadata(h.requests.at(-1)).currentUserMessage.id},quote:actualQuote}}]}},'十分钟仅用于比较，另行接受仍未执行。'),/TRIAL_EVENT_MUTATION_NOT_AUTHORIZED/,'trial cannot close an unknown through a source-free field')
 await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_REJECTION_CLEANUP',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[user,chat])
 const growthBefore=(await growthView(user,chat)).items
 const mixedRun=await h.execute(user,chat,mixed,{growthUpdates:[{target:{operation:'create'},kind:'ability',assertion:'user_reported',source:{clauseId:'c0'}}]},'只比较条件，不能把请求句写成长久事实。')
 const mixedAudit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,mixedRun.request_id])).rows[0].tool_audit
 assert.ok(mixedAudit.some((entry:any)=>entry.phase==='decision_comparison_read_only'))
 assert.deepEqual((await growthView(user,chat)).items,growthBefore,'mixed comparison leaves growth unchanged: '+mixedAudit.map((entry:any)=>entry.phase).join(','))
 const mixedLow='请试算：如果我只有10分钟且精力低，重新比较之前的取舍；另外我现在决定恢复继续报告。'
 const reportBeforeResume=(await coachEventView(user,chat,events[0].id))!
 await h.execute(user,chat,mixedLow,{},'报告按本人明确恢复处理，十分钟与低精力仍只是本轮试算。')
 const resumedWire=h.requests.at(-1),resumedContext=metadata(resumedWire)
 const resumedCase=resumedContext.decisionPlanContract.cases.find((c:any)=>c.eventId===events[0].id)
 assert.ok(resumedCase.candidateKinds.includes('advance'),'a separately actual native resumption is visible to this same proposal')
 assert.equal(resumedCase.matterProgress.recommendationStopped,false)
 assert.equal(resumedCase.currentReport,'另外我现在决定恢复继续报告')
 assert.ok(resumedCase.sourceFacts.includes(pauseQuote),'older pause remains historical evidence')
 assert.match(resumedWire.response_format.json_schema.schema.properties.reply.description,/优先承接本轮实际报告/)
 assert.equal(resumedContext.decisionPlanContract.conditions.energy,'low')
 const resumedWorkspace=[resumedContext.readOnlyEventWorkspace,...resumedContext.readOnlyRelatedEventWorkspaces??[]].find(workspace=>workspace?.eventRef?.id===events[0].id)
 const expectedWire=providerTurnMessages(buildTurnPrompt({
  currentMessageId:resumedContext.currentMessageId,
  messages:[
   ...resumedContext.messages.map((message:{id:string;role:'user'|'assistant'},index:number)=>({...message,content:resumedWire.messages[index+2].content})),
   {id:resumedContext.currentMessageId,role:'user',content:mixedLow,created_at:resumedContext.requestTimeUtc},
  ],
  currentEvent:reportBeforeResume,
 }),{provider:'openai',id:'qwen3.8-flash'})
 assert.deepEqual(resumedWorkspace,JSON.parse(expectedWire[0]!.content as string).readOnlyEventWorkspace,'a mixed trial retains the full normalized workspace')
 assert.equal((await coachEventView(user,chat,events[0].id))!.matterProgress!.recommendationStopped,false)
 const canonicalSnapshot=async()=>({
  events:await Promise.all(events.map(event=>coachEventView(user,chat,event.id))),
  growth:await growthView(user,chat),directionControls:await readDirectionControls(user),
  privacyControls:await listControlRequests(user,chat),
 })
 const beforeReduced=await canonicalSnapshot()
 await h.execute(user,chat,'请按假设只剩10分钟、精力低而且不能联网的情况，重新比较之前的取舍。',{},'低精力试算中，报告只推进可停的一小步，竞赛继续暂停。')
 assert.deepEqual(await canonicalSnapshot(),beforeReduced,'pure trial leaves canonical matters, growth and controls intact')
 const reducedWire=h.requests.at(-1)
 const reducedContext=metadata(reducedWire)
 const reducedCase=reducedContext.decisionPlanContract.cases.find((c:any)=>c.eventId===events[0].id)
 assert.equal(reducedCase.workScope,'smallest_substep')
 assert.equal(reducedCase.currentStart.maximumUnits,1)
 assert.equal(reducedContext.decisionPlanContract.conditions.network,false)
 const startScope=/原步骤含多个对象时，只处理原动作的第一个对象。原步骤只有一个对象时，推进它的第一个有价值部分。/
 assert.match(reducedWire.messages.at(-1).content,startScope)
 assert.match(reducedWire.messages.at(-1).content,/如果材料能离线打开/)
 const reportWorkspace=[reducedContext.readOnlyEventWorkspace,...reducedContext.readOnlyRelatedEventWorkspaces??[]].find(workspace=>workspace?.eventRef?.id===events[0].id)
 assert.ok(reducedCase.sourceFacts.length>0)
 const storedEvent=beforeReduced.events[0]!
 const {state,choice,recommendationStopped}=storedEvent.matterProgress!
 assert.deepEqual(reducedCase.matterProgress,{state,choice,recommendationStopped})
 assert.equal(reducedCase.currentReport,undefined,'a pure trial provides no new actual matter report')
 assert.deepEqual(reportWorkspace?.reportedNodes,storedEvent.nodes.filter(node=>!node.supersededByActionCorrection))
 assert.deepEqual(reportWorkspace?.reportedMatterProgress,storedEvent.matterProgress)
 assert.match(reducedWire.messages.find((m:any)=>m.role==='system').content,startScope)
 assert.match(reducedWire.response_format.json_schema.schema.properties.reply.description,startScope)
 const unaffectedBefore=await Promise.all([coachEventView(user,chat,events[0].id),coachEventView(user,chat,events[2].id)])
 assert.ok(await readPriorDecision(user,chat))
 await transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings']);await invalidateCoachSources(c,user,[events[1].nodes[0].source!.messageId],true)})
 const remainderRun=await h.execute(user,chat,'重新比较之前的取舍。',{},'被撤回的权限不再参与；报告和竞赛仍以当前授权记录为准。')
 assert.equal(metadata(h.requests.at(-1)).matterOverview.entries.length,2,'canonical withdrawal removes only its own matter from the current re-read')
 assert.ok(metadata(h.requests.at(-1)).matterOverview.entries.every((entry:any)=>entry.eventId!==events[1].id))
 assert.equal(metadata(h.requests.at(-1)).decisionPlanContract.previousProposal.scopeChanged,true)
 assert.deepEqual(await Promise.all([coachEventView(user,chat,events[0].id),coachEventView(user,chat,events[2].id)]),unaffectedBefore,'withdrawing one source does not delete other canonical matters')
 const knowledge=randomUUID()
 const card:KnowledgeCard={id:knowledge,revision:1,kind:'method',status:'verified',synthetic:true,title:'SYNTHETIC 来源版本',url:'https://example.invalid/lineage',publisher:'SYNTHETIC',publishedYear:'2026',verifiedAt:new Date().toISOString(),validUntil:null,excerpt:'仅验证方法来源的版本承接，不证明任务效果。',claim:'仅验证方法来源的版本承接',scope:'合成来源控制',limitations:'不证明任务效果',mechanisms:['source-check'],sourceHash:'a'.repeat(64)}
 await importKnowledge([card],true)
 await pool.query('INSERT INTO coach_reply_sources(user_id,request_id,source_id,revision) VALUES($1,$2,$3,1)',[user,remainderRun.request_id,knowledge])
 assert.ok(await readPriorDecision(user,chat))
 const inherited=await h.execute(user,chat,'按十分钟继续重比之前的取舍。',{},'只比较当前仍授权的报告和竞赛，保留方法来源版本。')
 assert.equal(Number((await pool.query('SELECT count(*) AS n FROM coach_reply_sources WHERE user_id=$1 AND request_id=$2 AND source_id=$3',[user,inherited.request_id,knowledge])).rows[0].n),1,'derived comparisons inherit the complete prior knowledge dependency')
 await pool.query("UPDATE campus_knowledge SET status='revoked' WHERE id=$1",[knowledge])
 assert.equal(await readPriorDecision(user,chat),null,'invalid knowledge provenance cannot be restored through persistent comparison lookup or skipped in favor of an older plan')
 await h.execute(user,chat,'重新比较之前的取舍。',{},'原比较引用的方法已失效，不能恢复或用无关事项替代。')
 assert.equal(metadata(h.requests.at(-1)).matterOverview.entries.length,0)
 }finally{await h.close()}
})
