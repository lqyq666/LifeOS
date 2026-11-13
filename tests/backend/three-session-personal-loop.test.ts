import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import {actionWriteRestrictions,assistantRequestClause,responseRequestScope} from '../../server/user-command-spans.ts'
import {timeBudget} from '../../server/workflows/task-sources.ts'
import {matchesAcceptedPartialAction,reportedPartialActionOutcomes} from '../../server/workflows/action-review.ts'
import {deriveThemeCandidates} from '../../server/user-themes.ts'
import {coachEventView,coachEventViewWithSources,coachMaterialVisibility,deliverableIntent,readOnlyCoachMaterial,stageCoachEvent} from '../../server/action-coach-events.ts'
import {growthView} from '../../server/growth.ts'
import {detectForgetIntentClauses} from '../../server/forget-intent.ts'
import {buildTurnPrompt,turnSystemPrompt} from '../../server/turn-prompt.ts'
import {deriveTurnContract} from '../../server/turn-contract.ts'
import type {ProfileFact} from '../../server/dialogue.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'

const choice='我在考研和就业之间拿不定主意，这周只能拿出一小时。我先选就业，今天用十分钟看一个岗位。'
const blocked='我看了一个岗位四分钟，只核对了三列标题，没有完成，也没帮我判断方向。今天没时间了。'
const refocus='先把重点改成就业探索。下次有半小时，再帮我只核对一个岗位，资料不全就先问我。'

test('partial scope does not close feedback without an explicit outcome',()=>{
 assert.deepEqual(reportedPartialActionOutcomes('我看了一个岗位四分钟，只核对了三列标题。'),[])
 assert.deepEqual(reportedPartialActionOutcomes(blocked).map(outcome=>outcome.quote),['只核对了三列标题，没有完成，也没帮我判断方向'])
 assert.equal(matchesAcceptedPartialAction('我看了一个岗位四分钟',['我接受先看一个岗位这个步骤']),true)
 assert.equal(matchesAcceptedPartialAction('我看了一个岗位说明四分钟',['我接受先看一个岗位这个步骤']),false)
})

test('refusing new actions leaves an existing requested edit available',()=>{
 assert.deepEqual(actionWriteRestrictions('请把现有就业探索行动的截止时间改到周五，但不要创建新的行动。'),{create:true,modify:false,plan:false})
 assert.deepEqual(actionWriteRestrictions('请展示岗位模板，但请你不要为我生成或保存任何新的步骤、行动或计划。'),{create:true,modify:false,plan:true})
 assert.deepEqual(actionWriteRestrictions('请创建一个周五核对岗位的行动，但不要生成计划。'),{create:false,modify:false,plan:true})
 assert.deepEqual(actionWriteRestrictions('请创建一个周五核对岗位的行动，但不要生成计划了。'),{create:false,modify:false,plan:true})
 assert.deepEqual(actionWriteRestrictions('我这周有两小时。请创建一个周五核对岗位的行动，但不要生成计划了吧。'),{create:false,modify:false,plan:true})
 assert.deepEqual(actionWriteRestrictions('我这周有两小时。请安排本周计划，但不要生成计划了哦。'),{create:false,modify:false,plan:true})
 assert.deepEqual(actionWriteRestrictions('请安排本周学习计划，但不要记录计划外开支。'),{create:false,modify:false,plan:false})
 assert.deepEqual(actionWriteRestrictions('不要修改现有行动的正文，只把该行动的截止时间改到周五。'),{create:false,modify:false,plan:false})
 assert.deepEqual(actionWriteRestrictions('同学说“不要创建新的行动”。'),{create:false,modify:false,plan:false})
})

test('a view-only artifact has its own authority and does not block a separate action',()=>{
 const action='请创建一个周五核对岗位的行动'
 const template='请生成一份只读的岗位申请记录，字段包括岗位名称、公司名称、职责、地点、截止日期、申请状态和备注的模板'
 assert.equal(deliverableIntent(action,'create'),true)
 assert.equal(readOnlyCoachMaterial(`${action}。${template}。`),false)
 assert.equal(readOnlyCoachMaterial(`${template}，但不要创建新的行动。`),true)
 assert.equal(readOnlyCoachMaterial(`${action}。${template}。`,'请生成一份只读的岗位申请记录'),true)
 const ordinaryTemplate='请生成一份岗位申请记录模板'
 assert.equal(readOnlyCoachMaterial(`${ordinaryTemplate}并只在回复中展示，但不要创建新的行动。`),true)
 assert.equal(readOnlyCoachMaterial(`${ordinaryTemplate}并只在回复中展示一下。`),true)
 assert.equal(readOnlyCoachMaterial(`${action}。${ordinaryTemplate}，字段包括岗位名称、公司名称、职责和备注。只在回复中展示。`,ordinaryTemplate),true)
 assert.equal(readOnlyCoachMaterial(`${action}。${ordinaryTemplate}。字段包括岗位名称、公司名称、职责和备注。只在回复中展示。`,ordinaryTemplate),true)
 assert.equal(readOnlyCoachMaterial(`${ordinaryTemplate}。只在回复中展示。`),true)
 assert.equal(readOnlyCoachMaterial(`${action}。${ordinaryTemplate}。只在回复中展示。`,ordinaryTemplate),true)
 assert.equal(readOnlyCoachMaterial(`${action}。${ordinaryTemplate}。只在回复中展示。`,action),false)
 assert.equal(readOnlyCoachMaterial(`${ordinaryTemplate}。同学说“只在回复中展示”。`),false)
})

test('past cleanup grants no authority to forget a record',()=>{
 for(const report of [
  '昨天我独立清洗了社团问卷数据，去掉了3条重复问卷。',
  '我已经删除了文件里的重复问卷。',
  '昨天我删除了旧记录并删了备份。',
  '我昨天删除了不想再保留的三条重复问卷。',
  '我昨天删除过重复问卷。',
  '上周我删除过旧记录。',
  '上周删除过三条重复问卷。',
  '整理课程材料时，删除过期末总结。',
  '删除旧记录后我又去掉了备份。',
  '删除旧记录后我又去掉了那段经历。',
  '把海报那条记录千万别给我删了。',
  '把海报那条记录不要再帮我删了。',
  '请不要替我把旧记录删除。',
  '把那段旧记录删除了之后我又删了。',
  '昨天整理了不想再保留的经历。',
  '把显示我忘记了那段经历的记录按钮删掉。',
  '把写着不要删除那段经历的记录按钮删掉。',
  '把显示我忘记了那段经历的记录卡片删掉。',
  '把写着不要删除那段经历的记录卡片删掉。',
  '删除我忘记了的那段经历了。',
  '删除我没有删除旧记录的那段经历了。',
  '删除旧记录了。',
  '删除我忘记了的那段经历了啊。',
  '删除我没有删除旧记录的那段经历了呀。',
  '我昨天删了3条重复问卷。',
 ])assert.deepEqual(detectForgetIntentClauses(report),[],report)
 for(const command of [
  '请去掉我会用SQL这条记录。',
  '请删除我昨天去掉了3条重复问卷的经历。',
  '删除我昨天去掉了3条重复问卷的经历。',
  '删除我整理后又去掉了3条重复问卷的经历。',
  '请删除我没有删除旧记录的那段经历。',
  '请删除我忘记了的那段经历。',
  '请删除我说先不删的那段经历。',
  '请把去掉了3条重复问卷这段经历删除。',
  '把去掉了3条重复问卷这段经历删除。',
  '把我昨天删除了3条重复问卷的那段经历也删掉。',
  '把我选择的不是删除而是归档这一偏好清除。',
  '把界面里那段经历删除。',
  '把我忘记了那段经历的记录内容删掉。',
  '把我忘记了的那段经历从档案里删除。',
  '删除那段经历并保留界面。',
  '请删除过期的课程报名记录。',
  '请删除过期记录。',
  '删除过往记录。',
  '删除过去的课堂记录。',
  '顺便删除过去的课堂记录。',
  '把海报那条记录删了吧。',
  '把海报那条记录删了。',
  '这些记录不用保留了。',
  '那段上周删除过三条重复问卷的经历不用保留。',
  '那段没有删除旧记录的经历不用保留。',
 ])assert.deepEqual(detectForgetIntentClauses(command).map(clause=>clause.kind),['forget'],command)
})

test('the natural third-session request shares one budget, request boundary and current focus',()=>{
 assert.deepEqual(timeBudget('下次有半小时'),{period:'current',amountMinutes:30})
 for(const text of ['如果下次有半小时','同学下次有半小时','下次有半小时吗？','“下次有半小时”','下次花了半小时'])assert.equal(timeBudget(text),undefined,text)
 const scope=responseRequestScope(refocus)
 assert.equal(scope.singleJobRequested,true)
 assert.equal(assistantRequestClause('再帮我只核对一个岗位'),true)
 assert.equal(assistantRequestClause('资料不全就先问我'),true)
 const focus=deriveThemeCandidates([{id:'focus',kind:'direction',text:'先把重点改成就业探索',assertion:'user_reported',status:'active'}])
 assert.equal(focus.length,1)
 assert.equal(focus[0]!.title,'就业')
 assert.equal(focus[0]!.status,'active')
})

test('one task survives three conversations from choice through blocked feedback to later help',async t=>{
 const h=await residualHarness()
 try{
  const {user,chat:first}=await h.account()
  await h.execute(user,first,choice,{
   growthUpdates:[
    {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'constraint',source:{clauseId:'c1'},timeEvidence:{kind:'calendar_week',which:'this',clauseId:'c1'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'direction',source:{clauseId:'c2'}},
   ],
   event:{
    target:{operation:'create',title:'就业岗位初次探索',source:{clauseId:'c2'}},
    factRefs:[0,1,2],
    nodes:[
     {kind:'unknown',question:'查看岗位后的具体反馈是什么？',affects:'决定后续核对重点',reason:'计划尚未产生实际反馈'},
     {kind:'unknown',question:'这个岗位的具体职责是什么？',affects:'理解该岗位',reason:'目前没有岗位原文'},
    ],
    action:{operation:'create',draft:{content:'用十分钟打开一份岗位说明，只核对一项具体要求；资料不全就停。'}},
   },
  },'先按你当前选择的就业方向，用十分钟看一个岗位；到点就停，这还不是已完成经历。')
  const initial=(await coachEventView(user,first))!
  assert.ok(initial)
  assert.equal(initial.revision,1)
  assert.equal((await store.listExperiences(user)).length,0,'the proposed ten-minute action is not an experience')
  assert.ok(!(await growthView(user,first)).items.some(item=>item.text==='今天用十分钟看一个岗位'))

  const second=randomUUID()
  await store.createConversation(user,{id:second,title:'SYNTHETIC blocked feedback'})
  const openUnknown=initial.nodes.find(node=>node.kind==='unknown'&&node.content==='查看岗位后的具体反馈是什么？')!
  const specificUnknown=initial.nodes.find(node=>node.kind==='unknown'&&node.content==='这个岗位的具体职责是什么？')!
  const feedbackReply='收到。今天时间到了就停，不再安排新动作。\n\n这次四分钟只核对了三列标题、没读完也没形成判断，这只是一次未完成的具体经历；它既不能证明你不适合看岗位，也不能说明就业方向本身有问题，只是这次十分钟里实际发生的情况。\n\n【待补】下次有整块时间时再说，现在不追问原因或感受。'
  const feedbackRun=await h.execute(user,second,blocked,{
   growthUpdates:[
    {target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'attempted',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:'我完整阅读了这个岗位'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'attempted',source:{clauseId:'c1'},contribution:{actor:'self',actionQuote:'只核对了三列标题'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c2'},contribution:{actor:'self',actionQuote:'完成'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c3'},contribution:{actor:'self',actionQuote:'判断方向'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c4'}},
   ],
   event:{target:{operation:'create',title:'另一项岗位事务',source:{clauseId:'c0'}},factRefs:[0,1,2,3,4,7]},
  },feedbackReply)
  assert.doesNotMatch(JSON.stringify(h.requests.at(-1).messages),/报告使用老师的公式、脚本或检查表/)
  const savedReply=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,feedbackRun.request_id])).rows
  assert.deepEqual(savedReply,[{content:feedbackReply}],'a complete feedback reply is saved verbatim once')
  const afterFeedback=(await coachEventView(user,second,initial.id))!
  assert.equal(afterFeedback.id,initial.id)
  assert.equal(afterFeedback.revision,2)
  assert.equal(afterFeedback.matterProgress?.state,'partial','the actual limited execution changes the matter state')
  assert.equal(afterFeedback.matterProgress?.recommendationStopped,false,'no time today is not a durable pause')
  assert.deepEqual(afterFeedback.matterProgress?.reports.at(-1)?.quotes,['我看了一个岗位四分钟','只核对了三列标题'])
  assert.equal(afterFeedback.nodes.find(node=>node.id===openUnknown.id)?.status,'resolved')
  assert.equal(afterFeedback.nodes.find(node=>node.id===specificUnknown.id)?.status,'active')
  const experiences=await store.listExperiences(user)
  assert.equal(experiences.length,1)
  assert.equal(experiences[0]!.status,'confirmed')
  assert.equal(experiences[0]!.content.action,'我看了一个岗位四分钟')
  const reportedResult='只核对了三列标题，没有完成，也没帮我判断方向'
  assert.equal(experiences[0]!.content.result,reportedResult)
  const resultProof=(await pool.query("SELECT snapshot->'resultSource' AS source FROM experience_revisions WHERE user_id=$1 AND experience_id=$2 AND action='propose'",[user,experiences[0]!.id])).rows[0]?.source
  assert.deepEqual(resultProof,{messageId:feedbackRun.source_message_id,quote:reportedResult,range:{start:blocked.indexOf(reportedResult),end:blocked.indexOf(reportedResult)+reportedResult.length}})

  const third=randomUUID()
  await store.createConversation(user,{id:third,title:'SYNTHETIC refocused next help'})
  const thirdRun=await h.execute(user,third,refocus,{
   growthUpdates:[
    {target:{operation:'create'},assertion:'user_reported',kind:'direction',source:{clauseId:'c0'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'goal',source:{clauseId:'c2'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c3'}},
   ],
   event:{target:{operation:'continue',eventId:initial.id,expectedRevision:afterFeedback.revision},factRefs:[0,1,2,3]},
  },'重点改成就业探索。下次三十分钟只核对一个岗位；请先给我岗位链接或JD，资料不全我会先问，不会补造。')

  const finalEvent=(await coachEventView(user,third,initial.id))!
  assert.equal(finalEvent.id,initial.id)
  assert.equal(finalEvent.revision,3)
  assert.equal(finalEvent.matterProgress?.reports.find(report=>report.eventRevision===2)?.state,'partial')
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_events WHERE user_id=$1',[user])).rows[0].n,1)
  for(const fact of ['我先选就业','我看了一个岗位四分钟','只核对了三列标题','也没帮我判断方向','先把重点改成就业探索','下次有半小时'])assert.ok(finalEvent.nodes.some(node=>node.kind==='fact'&&node.content===fact),fact)
  for(const request of ['再帮我只核对一个岗位','资料不全就先问我'])assert.ok(!finalEvent.nodes.some(node=>node.kind==='fact'&&node.content===request),request)

  const growth=(await growthView(user,third)).items.filter(item=>!item.unavailableReason)
  assert.equal(growth.filter(item=>item.text==='先把重点改成就业探索').length,1)
  assert.equal(growth.filter(item=>item.text==='下次有半小时').length,1)
  assert.deepEqual(timeBudget(growth.find(item=>item.text==='下次有半小时')!.text),{period:'current',amountMinutes:30})
  for(const request of ['再帮我只核对一个岗位','资料不全就先问我'])assert.ok(!growth.some(item=>item.text===request),request)

  const graph=await store.cognitionGraph(user)
  assert.equal(graph.nodes.filter(node=>node.type==='value'&&node.title==='就业').length,1,'the changed focus updates the existing employment theme')
  assert.ok(graph.nodes.some(node=>node.id==='exp-'+experiences[0]!.id),'the real attempt reaches the star map')
  assert.match(graph.starmapNextStep,/当前重点：就业/)
  assert.deepEqual(graph.nodes.find(node=>node.type==='self')?.skillTags,[],'one attempt does not become a stable skill claim')

  const supplied=JSON.parse(h.requests.at(-1).messages.find((message:any)=>message.role==='user'&&message.content.startsWith('{')).content)
  const context=supplied.authorizedContext??supplied
  assert.ok([context.readOnlyEventWorkspace,...context.readOnlyRelatedEventWorkspaces??[]].some((workspace:any)=>workspace?.eventRef?.id===initial.id),'the third conversation receives the same event identity')
  assert.ok(JSON.stringify(context.growth).includes('我看了一个岗位四分钟'),'later help receives the actual attempt')
  assert.equal(h.requests.length,3,'one provider-shaped generation per natural message, without repair calls')
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,thirdRun.request_id])).rows[0].n,1)
  await t.test('a provider action and its reported cleanup outcome share one correctable experience',async()=>{
   const {user,chat}=await h.account()
   const action='我独立清洗了社团问卷数据',outcome='去掉了3条重复问卷'
   await h.execute(user,chat,action+'，'+outcome+'。',{
    growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:action}}],
   },'已记录这次清洗和去重数量。')
   const experiences=await store.listExperiences(user)
   assert.equal(experiences.length,1)
   const experience=experiences[0]!
   assert.equal(experience.content.source,'基于用户原话提取')
   assert.equal(experience.content.action,action)
   assert.equal(experience.content.result,outcome)
   const resultProof=(await pool.query("SELECT snapshot->'resultSource' AS source FROM experience_revisions WHERE user_id=$1 AND experience_id=$2 AND action='propose'",[user,experience.id])).rows[0]?.source
   assert.deepEqual(resultProof?.range,{start:action.length+1,end:action.length+1+outcome.length})
   assert.equal(resultProof?.quote,outcome)
   const graphExperience=(await store.cognitionGraph(user)).nodes.find(node=>node.id==='exp-'+experience.id)
   assert.equal(graphExperience?.asReported?.result,outcome,'the graph uses the same verified outcome source')
  })
  await t.test('an authorized feedback event cannot close a second unanswered question',async()=>{
   const {user,chat}=await h.account()
   await h.execute(user,chat,choice,{
    event:{target:{operation:'create',title:'岗位探索',source:{clauseId:'c2'}},nodes:[
     {kind:'unknown',question:'查看岗位后的具体反馈是什么？'},
     {kind:'unknown',question:'这个岗位的具体职责是什么？'},
    ]},
   },'先用十分钟看看一个岗位。')
   const event=(await coachEventView(user,chat))!
   const generic=event.nodes.find(node=>node.content==='查看岗位后的具体反馈是什么？')!
   const specific=event.nodes.find(node=>node.content==='这个岗位的具体职责是什么？')!
   await h.execute(user,chat,blocked,{
    growthUpdates:[{target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'unattempted',source:{clauseId:'c2'},contribution:{actor:'unknown',actionQuote:''}}],
    event:{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},resolveUnknowns:[specific.id]},
   },'这次只核对了三列标题，没完成也没帮你判断方向。岗位职责仍需查看。今天到这里。')
   const read=await coachEventView(user,chat,event.id)
   assert.equal(read?.nodes.find(node=>node.id===generic.id)?.status,'resolved')
   assert.equal(read?.nodes.find(node=>node.id===specific.id)?.status,'active')
   assert.ok(!(await growthView(user,chat)).items.some(item=>item.progressState==='unattempted'&&item.text==='没有完成'))
  })
  await t.test('an exact accepted step binds partial feedback from another conversation',async()=>{
   const {user,chat}=await h.account()
   await h.execute(user,chat,'我先选就业探索。我接受先看一个岗位这个步骤，今天用十分钟试。',{
    event:{target:{operation:'create',title:'就业探索',source:{clauseId:'c0'}},nodes:[
     {kind:'unknown',question:'这个岗位的具体职责是什么？'},
    ]},
   },'先用十分钟看看一个岗位。')
   const event=(await coachEventView(user,chat))!
   assert.equal(event.matterProgress?.choice,'accepted')
   const next=randomUUID()
   await store.createConversation(user,{id:next,title:'SYNTHETIC partial feedback'})
    const separate='昨天我独立清洗了社团问卷数据，去掉了3条重复问卷。'
    const run=await h.execute(user,next,blocked+separate,{
     growthUpdates:[
      {target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'attempted',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:'我完整阅读了这个岗位'}},
      {target:{operation:'create'},kind:'ability',assertion:'user_reported',source:{clauseId:'c0'}},
      {target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c4'}},
      {target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'completed',source:{clauseId:'c5'},contribution:{actor:'self',actionQuote:'独立清洗了社团问卷数据',resultRef:4}},
      {target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c6'}},
     ],
    },'这次四分钟只核对了三列标题，没完成，也没帮你判断方向。原因未知。另外，你独立清洗问卷并去掉了三条重复问卷。')
    const feedbackRequest=h.requests.at(-1)
    assert.match(JSON.stringify(feedbackRequest.messages),/报告使用老师的公式、脚本或检查表/)
    const feedbackSystem=feedbackRequest.messages.filter((message:any)=>message.role==='system').map((message:any)=>message.content).join('\n')
    assert.doesNotMatch(feedbackSystem,/解释若超出本人原话|可能原因以待核实问题表达/)
    assert.match(feedbackSystem,/今天没空只限制今天/)
   const read=await coachEventView(user,chat,event.id)
   assert.equal(read?.matterProgress?.state,'partial')
   assert.equal(read?.matterProgress?.reports.at(-1)?.sourceMessageId,run.source_message_id)
   assert.ok(read?.nodes.some(node=>node.content==='这个岗位的具体职责是什么？'&&node.status==='active'))
   assert.equal((await pool.query('SELECT count(*)::int AS count FROM coach_events WHERE user_id=$1',[user])).rows[0]?.count,1)
    const results=(await store.listExperiences(user)).map(item=>item.content.result).sort()
    assert.deepEqual(results,['去掉了3条重复问卷','只核对了三列标题，没有完成，也没帮我判断方向'])
    const facts=(await growthView(user,next)).items.filter(item=>item.status==='active')
    assert.ok(facts.some(item=>item.text==='独立清洗了社团问卷数据'&&item.progressState==='completed'))
    assert.deepEqual(facts.filter(item=>item.text==='我看了一个岗位四分钟').map(item=>item.kind),['feedback'])
   const follow=randomUUID(),text='接着上次的就业探索，我周五有半小时。这次请按上次的实际反馈帮我改一个可开始的步骤。'
   await store.createConversation(user,{id:follow,title:'SYNTHETIC next help'})
   const reply='周五打开一份岗位说明，只读一条具体职责，记下岗位实际要求做什么。半小时是上限。上次只核对标题，没帮你判断方向，原因未知。'
   const nextHelp=await h.execute(user,follow,text,{
    growthUpdates:[
     {target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'attempted',source:{clauseId:'c2'},contribution:{actor:'self',actionQuote:'已完成一个岗位匹配分析'}},
     {target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c1'}},
    ],event:{target:{operation:'continue',eventId:event.id,expectedRevision:read!.revision},factRefs:[0,1]},
   },reply)
   assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,nextHelp.request_id])).rows,[{content:reply}])
   const wireMessages=h.requests.at(-1).messages
   const context=JSON.parse(wireMessages.find((message:any)=>message.role==='user'&&message.content.startsWith('{')).content)
   assert.equal(context.currentTask.responseScope.actionLimit,1)
   assert.equal(context.currentTask.priorFeedback.sourceMessageId,run.source_message_id)
   assert.ok(context.currentTask.priorFeedback.reportedFacts.includes('只核对了三列标题'))
   assert.ok(context.currentTask.priorFeedback.reportedFacts.includes('也没帮我判断方向'))
   assert.equal(wireMessages.filter((message:any)=>message.content.includes('本轮语义与交付约定')).length,1)
   const replyDescription=h.requests.at(-1).response_format.json_schema.schema.properties.reply.description
   assert.match(replyDescription,/先回应本轮新增内容与实际诉求/)
   assert.doesNotMatch(JSON.stringify(wireMessages),/报告使用老师的公式、脚本或检查表/)
    assert.equal((await store.listExperiences(user)).length,2)
   assert.ok((await growthView(user,follow)).items.some(item=>item.status==='active'&&item.text==='我周五有半小时'))
   const requestsBeforeExamples=h.requests.length
   await h.execute(user,follow,'一般的岗位记录表有哪些列？请给常见字段的例子。',{},'通用示例可以包含岗位名称、主要职责和信息来源。')
   assert.equal(h.requests.length,requestsBeforeExamples+1)
   assert.doesNotMatch(JSON.stringify(h.requests.at(-1).messages),/方法是否有效仍未知，不作正负定性/)
   await h.execute(user,follow,blocked+'一般的岗位记录表有哪些列？请给常见字段的例子。',{},'这次只核对了三列标题。通用示例可以包含岗位名称、主要职责和信息来源。')
   assert.equal(h.requests.length,requestsBeforeExamples+2)
  })
  await t.test('a named due matter and unattempted choice survive an invalid provider sidecar',async()=>{
   const {user,chat}=await h.account()
   const text='我在准备课程报告，截止明晚。我接受先整理两条证据这个步骤，还没开始。'
   const reply='课程报告明晚截止。你已经接受先整理两条证据，这一步还没有开始。'
   const run=await h.execute(user,chat,text,{
    growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'unattempted',source:{clauseId:'c2'},contribution:{actor:'self',actionQuote:'整理两条证据'}}],
    event:{target:{operation:'create',title:'课程报告',source:{clauseId:'c0'}},factRefs:[0]},
   },reply)
   const event=await coachEventView(user,chat)
   const saved=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,run.request_id])).rows[0]?.content
   const audit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,run.request_id])).rows[0]?.tool_audit
   assert.ok(audit.some((entry:{phase:string;kind?:string})=>entry.phase==='coach_output_normalized'&&entry.kind==='reported_step_choice_without_execution'))
   assert.deepEqual({title:event?.title??null,choice:event?.matterProgress?.choice??null,state:event?.matterProgress?.state??null,deadline:event?.nodes.some(node=>node.kind==='fact'&&node.source?.quote==='截止明晚')??false,saved},
    {title:'课程报告',choice:'accepted',state:'unattempted',deadline:true,saved:reply})
   assert.equal((await store.listExperiences(user)).length,0)
   const contest='换一件事，我还考虑参加校内创新赛。我接受先看报名要求，但这次完全没执行。竞赛先暂停，当前重点改成课程报告。'
   const contestReply='「校内创新赛」按你的决定暂停。你已接受「先看报名要求」，这一步还没执行。当前重点仍是「课程报告」。'
   const requestsBeforeSwitch=h.requests.length
   const eventsBeforeSwitch=h.emitted.length
   const contestRun=await h.execute(user,chat,contest)
   assert.equal(h.requests.length,requestsBeforeSwitch,'an exact source-owned switch needs no model call')
   assert.ok(!h.emitted.slice(eventsBeforeSwitch).some(event=>event.type==='draft'),'the receipt waits for commit')
   const contestStatus=await store.runStatus(user,contestRun.request_id)
   assert.equal(contestStatus.usage.llmCallCount,0)
   assert.deepEqual(contestStatus.usage.calls,[])
   assert.equal(contestStatus.usage.estimatedCostCny,0)
   const switchAudit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,contestRun.request_id])).rows[0].tool_audit
   assert.ok(switchAudit.some((entry:{phase:string})=>entry.phase==='explicit_state_readback_without_generation'))
   const contestId=contestStatus.response.event.id
   const recordedContest=await coachEventView(user,chat,contestId)
   assert.deepEqual({title:recordedContest?.title,choice:recordedContest?.matterProgress?.choice,state:recordedContest?.matterProgress?.state,stopped:recordedContest?.matterProgress?.recommendationStopped},{title:'校内创新赛',choice:'accepted',state:'paused',stopped:true})
   assert.ok(recordedContest?.matterProgress?.reports.some(report=>report.quotes.includes('但这次完全没执行')))
   const savedContest=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,contestRun.request_id])).rows
   assert.deepEqual(savedContest,[{content:contestReply}])
   const course=await coachEventView(user,chat)
   assert.equal(course?.id,event!.id,'the explicit returned focus is the conversation default')
   assert.equal(course?.title,'课程报告')
   assert.equal(course?.matterProgress?.state,'unattempted')
   assert.ok(course?.nodes.some(node=>node.kind==='fact'&&node.source?.quote==='截止明晚'))
   await h.execute(user,chat,'接着当前重点，给我一个现在能做的小动作。',{},'先整理你已接受的两条证据，用于明晚截止的课程报告。')
   const continuation=JSON.parse(h.requests.at(-1).messages.find((message:any)=>message.role==='user'&&message.content.startsWith('{')).content)
   assert.equal(continuation.readOnlyEventWorkspace?.eventRef?.id,event!.id)
   assert.match(JSON.stringify(continuation.readOnlyEventWorkspace),/截止明晚/)
   assert.equal((await coachEventView(user,chat,contestId))?.revision,recordedContest?.revision,'generic course help does not resume or change the contest')
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_events WHERE user_id=$1',[user])).rows[0].n,2)
  })
  await t.test('a source-backed legacy title keeps the report focus without receiving the contest outcome',async()=>{
   const {user,chat}=await h.account()
   const task='我在准备课程报告'
   const input=(await store.startRun(user,chat,randomUUID(),task+'，截止明晚。我接受先整理两条证据这个步骤，还没开始。')).run
   const source={messageId:input.source_message_id,quote:task}
   const coach=await stageCoachEvent(input,{
    target:{operation:'create',title:'准备课程报告',source},
    nodes:[{kind:'fact',source},{kind:'fact',source:{...source,quote:'截止明晚'}}],
   },'记录课程报告。')
   await store.finishRun(input,{candidates:[],audit:[],coach},'记录课程报告。',null,new AbortController().signal)
   const report=await coachEventView(user,chat)
   assert.equal(report?.title,'准备课程报告')
   const switched=await h.execute(user,chat,'换一件事，我还考虑参加校内创新赛。我接受先看报名要求，但这次完全没执行。竞赛先暂停，当前重点改成课程报告。',{},'竞赛先暂停，课程报告仍是当前重点。')
   const result=await store.runStatus(user,switched.request_id)
   const contest=await coachEventView(user,chat,result.response.event.id)
   assert.equal(contest?.title,'校内创新赛')
   assert.equal(contest?.matterProgress?.state,'paused')
   assert.equal(contest?.matterProgress?.choice,'accepted')
   assert.ok(contest?.matterProgress?.reports.some(item=>item.quotes.includes('但这次完全没执行')))
   assert.deepEqual(await coachEventView(user,chat),report,'the existing report keeps its original source and revision')
  })
  await t.test('an accepted job remains one job in the response and in its later feedback',async()=>{
   const input='我在考研和就业之间拿不定主意，这周只能拿出一小时。我先选就业探索，我接受先看一个岗位这个步骤，今天用十分钟试。'
   for(const quote of ['我现在接受先看一个岗位这个步骤','我已经接受先看一个岗位这个步骤','我已同意先看一个岗位这个步骤','我决定接受先看一个岗位这个步骤']){
    assert.equal(matchesAcceptedPartialAction('我看了一个岗位四分钟',[quote]),true,quote)
   }
   const {user,chat}=await h.account()
   const reply='今天只查看一个岗位，在同一份说明里核对三条岗位职责、三个岗位描述字段和三个JD要求，十分钟到就停。'
   await h.execute(user,chat,input,{},reply)
   assert.match(h.requests.at(-1).messages.at(-1).content,/原对象和数量就是范围/)
   const event=(await coachEventView(user,chat))!
   assert.equal(event.matterProgress?.choice,'accepted')
   const feedback=await h.account()
   await h.execute(feedback.user,feedback.chat,input,{},reply)
   const feedbackReply='这次看了一个岗位四分钟，只核对了三列标题，未完成，也没形成方向判断。方法是否有效和卡在哪一步仍未知。你说今天没时间，就先停在这里。'
   const feedbackRun=await h.execute(feedback.user,feedback.chat,blocked,{},feedbackReply)
   const feedbackMessages=h.requests.at(-1).messages
   assert.ok(feedbackMessages.some((message:any)=>message.role==='user'&&message.content.includes('这周只能拿出一小时')))
   assert.match(feedbackMessages.find((message:any)=>message.role==='system').content,/时间引用保留原话的适用时段/)
   assert.match(feedbackMessages.find((message:any)=>message.role==='system').content,/本周可用量只属于本周/)
   assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[feedback.user,feedbackRun.request_id])).rows,[{content:feedbackReply}])
   const combined=await h.account()
   await h.execute(combined.user,combined.chat,input,{},reply)
   const combinedEvent=(await coachEventView(combined.user,combined.chat))!
   const revisionInput=blocked+'我周五有半小时。这次请按上次的实际反馈帮我改一个可开始的步骤。'
   await h.execute(combined.user,combined.chat,revisionInput,{},'周五打开一个可查看的岗位，记下一项实际职责及它能回答的问题。上次只核对标题，没能判断方向，原因未知。')
   assert.match(h.requests.at(-1).messages.at(-1).content,/本轮建议是可选的调整/)
   assert.equal((await coachEventView(combined.user,combined.chat,combinedEvent.id))?.matterProgress?.state,'partial')
  })
  await t.test('a newly named accepted step survives an invalid provider action',async()=>{
   const {user,chat}=await h.account()
   const input='我在考研和就业之间拿不定主意，这周只能拿出一小时。我先选就业探索，我接受先看一个岗位这个步骤，今天用十分钟试。'
   const reply='今天先找一个岗位，看看具体职责。十分钟到就停。'
   const run=await h.execute(user,chat,input,{
     growthUpdates:[
      {target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'attempted',source:{clauseId:'c3'},contribution:{actor:'self',actionQuote:'完整读完岗位并核对职责'}},
      {target:{operation:'create'},kind:'constraint',assertion:'user_reported',source:{clauseId:'c1'},timeEvidence:{kind:'calendar_week',which:'this',clauseId:'c1'}},
     ],
   },reply)
   const event=await coachEventView(user,chat)
   assert.equal(event?.title,'就业探索')
   assert.equal(event?.matterProgress?.state,'accepted')
   assert.equal(event?.matterProgress?.choice,'accepted')
   assert.deepEqual(await store.listExperiences(user),[])
    assert.ok((await growthView(user,chat)).items.some(item=>item.kind==='constraint'&&item.text==='这周只能拿出一小时'))
    assert.ok(!(await growthView(user,chat)).items.some(item=>item.text.includes('完整读完岗位')))
   assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,run.request_id])).rows,[{content:reply}])
   const choiceSidecar={target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'attempted',source:{clauseId:'c3'},contribution:{actor:'self',actionQuote:'接受先看一个岗位这个步骤'}}
   for(const step of ['我接受先看一个岗位这个步骤','我先接受先看一个岗位这个步骤','不过我明确接受先看一个岗位这个步骤']){
    const literal=await h.account()
    await h.execute(literal.user,literal.chat,input.replace('我接受先看一个岗位这个步骤',step),{growthUpdates:[choiceSidecar]},reply)
    const choices=(await growthView(literal.user,literal.chat)).items.filter(item=>item.text.includes('接受先看一个岗位这个步骤'))
    assert.ok(choices.some(item=>item.text===step),step)
    assert.ok(choices.every(item=>item.kind==='context'&&item.progressState===null),step)
    assert.equal((await coachEventView(literal.user,literal.chat))?.matterProgress?.choice,'accepted')
    assert.deepEqual(await store.listExperiences(literal.user),[])
   }
   const both=await h.account()
   await h.execute(both.user,both.chat,input+'昨天我独立清洗了社团问卷数据，去掉了3条重复问卷。',{growthUpdates:[
    choiceSidecar,
    {target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'completed',source:{clauseId:'c5'},contribution:{actor:'self',actionQuote:'独立清洗了社团问卷数据',resultRef:2}},
    {target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c6'}},
   ]},reply)
   const actualExperiences=await store.listExperiences(both.user)
   assert.deepEqual(actualExperiences.map(item=>item.content.result),['去掉了3条重复问卷'])
   const independent=await h.account()
   const material='岗位职责核对清单\n- 打开一份岗位说明，只核对一项具体职责。\n- 十分钟到点就停。'
   await h.execute(independent.user,independent.chat,input+'请帮我写一份岗位职责核对清单。',{
    event:{target:{operation:'create',title:'模型给出的主题',source:{clauseId:'c0'}},nodes:[
     {kind:'fact',source:{clauseId:'c0'}},{kind:'unknown',question:'另一条方向的收入如何？'},
    ],action:{operation:'create',draft:{content:material}}},
   },material)
   const exact=await coachEventView(independent.user,independent.chat)
   assert.equal(exact?.title,'就业探索')
   assert.deepEqual(exact?.nodes.map(node=>node.source?.quote).sort(),['我先选就业探索','我接受先看一个岗位这个步骤'].sort())
   assert.ok(exact?.actions.some(action=>action.status==='proposed'&&action.draft?.content===material))
    const previous=exact!.actions[0]!
    const edit='请帮我把这份清单的正文改为周五前核对'
    const revised='岗位职责核对清单\n- 周五前，打开一份岗位说明，只核对一项具体职责。\n- 十分钟到点就停。'
    await h.execute(independent.user,independent.chat,`${edit}，但不要创建新的行动。`,run=>({
     event:{target:{operation:'continue',eventId:exact!.id,expectedRevision:exact!.revision},action:{operation:'modify',actionId:previous.id,expectedRevision:previous.revision,source:{messageId:run.source_message_id,quote:edit},draft:{content:revised}}},
    }),revised)
    const afterEdit=await coachEventView(independent.user,independent.chat,exact!.id)
    assert.deepEqual(afterEdit?.actions.map(action=>({id:action.id,content:action.draft?.content})),[{id:previous.id,content:revised}])
    const preview='请生成一份只读的岗位记录模板'
    const formPreview='岗位记录模板\n岗位名称：____\n具体职责：____'
    const previewRun=await h.execute(independent.user,independent.chat,`现有行动保持不变。${preview}，但不要创建新的行动。`,{viewOnlyDrafts:[formPreview]},'可以查看这份模板。')
    assert.equal((await coachEventView(independent.user,independent.chat,exact!.id))?.actions[0]?.draft?.content,revised)
    assert.equal((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[independent.user,previewRun.request_id])).rows[0]?.content,'可以查看这份模板。\n\n'+formPreview)
    const beforeDeadline=(await coachEventView(independent.user,independent.chat,exact!.id))!
    const deadline='只把该行动的截止时间改到周五'
    await h.execute(independent.user,independent.chat,`不要修改岗位职责核对清单行动的正文，${deadline}。`,run=>({
     event:{target:{operation:'continue',eventId:exact!.id,expectedRevision:beforeDeadline.revision},action:{operation:'modify',actionId:previous.id,expectedRevision:beforeDeadline.actions[0]!.revision,source:{messageId:run.source_message_id,quote:deadline},draft:{content:revised,stopWhen:'周五'}}},
    }),'截止时间调整为周五。\n\n'+revised)
    const afterDeadline=(await coachEventView(independent.user,independent.chat,exact!.id))!
    assert.deepEqual(afterDeadline.actions[0]?.draft,{content:revised,stopWhen:'周五'})
    const nextDeadline='只把该行动的截止时间改到下周一'
    await assert.rejects(h.execute(independent.user,independent.chat,`不要修改岗位职责核对清单行动的正文，${nextDeadline}。`,run=>({
     event:{target:{operation:'continue',eventId:exact!.id,expectedRevision:afterDeadline.revision},action:{operation:'modify',actionId:previous.id,expectedRevision:afterDeadline.actions[0]!.revision,source:{messageId:run.source_message_id,quote:nextDeadline},draft:{content:'模型重写了正文。',stopWhen:'下周一'}}},
    }),'模型重写了正文。'),{code:'COACH_ACTION_SOURCE_REQUIRED'})
    const readOnly=await h.account()
    const form='岗位记录模板\n岗位名称：____\n具体职责：____'
    const request='我先选就业探索。我接受先看一个岗位这个步骤。请生成一份只读的岗位记录模板，但请你不要为我生成或保存任何新的步骤、行动或计划。'
    const preface='岗位记录模板已整理。'
    const readOnlyRun=await h.execute(readOnly.user,readOnly.chat,request,()=>({
     viewOnlyDrafts:[form],event:{target:{operation:'create',title:'就业探索',source:{clauseId:'c0'}}},
    }),preface)
    const readOnlyEvent=await coachEventView(readOnly.user,readOnly.chat)
    assert.equal(readOnlyEvent?.matterProgress?.choice,'accepted')
    assert.deepEqual(readOnlyEvent?.actions,[])
    assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[readOnly.user,readOnlyRun.request_id])).rows,[{content:preface+'\n\n'+form}])
  })
   await t.test('an invalid optional actor does not discard an independent weekly plan',async()=>{
    const {user,chat}=await h.account()
    const input='我的复习笔记全是整段抄书，考前翻不动。这周还剩两小时，帮我安排课程作业，留一些余量。'
    const reply='先花30分钟核对课程作业要求，截止时间仍待核对。'
    const run=await h.execute(user,chat,input,{
     growthUpdates:[
      {target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:'整段抄书'}},
      {target:{operation:'create'},kind:'constraint',assertion:'user_reported',source:{clauseId:'c2'},timeEvidence:{kind:'calendar_week',which:'this',clauseId:'c2'}},
     ],
     weeklyPlan:{target:{operation:'create'},availableMinutes:120,period:'this_week',budgetRef:{updateIndex:1},basis:[{updateIndex:1}],items:[{action:'核对课程作业要求',minutes:30,directionScopes:[]}]},
    },reply)
    const planFormat=h.requests.at(-1).response_format
    assert.equal(planFormat.type,'json_schema')
    assert.ok(planFormat.json_schema.schema.required.includes('weeklyPlan'))
    const saved=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,run.request_id])).rows
    assert.equal(saved.length,1)
    assert.ok(saved[0]?.content.startsWith(reply)&&saved[0]?.content.includes('未安排：90分钟'))
    assert.ok(!(await growthView(user,chat)).items.some(item=>item.kind==='feedback'&&item.text.includes('抄书')))
   })
   await t.test('a view-only template remains separate from an explicitly created action',async()=>{
    const {user,chat}=await h.account()
    const action='请创建一个周五核对岗位的行动',template='请生成一份岗位记录模板'
    const content='周五核对一个岗位的具体职责。',templateBody='岗位记录模板\n岗位名称：____\n具体职责：____',reply=templateBody+'\n\n'+content
    const mixed=`岗位探索事项。${action}。${template}。只在回复中展示。`
    const frame=()=>({
     event:{target:{operation:'create',title:'岗位探索事项',source:{clauseId:'c0'}},action:{operation:'create',source:{clauseId:'c1'},draft:{content}}},
    })
    const omitted=await h.account()
    await assert.rejects(h.execute(omitted.user,omitted.chat,mixed,frame,'已创建周五核对岗位行动，岗位记录模板稍后提供。'),{code:'COACH_MATERIAL_NOT_VISIBLE'})
    assert.equal(await coachEventView(omitted.user,omitted.chat),null)
    await h.execute(user,chat,mixed,{...frame(),viewOnlyDrafts:[templateBody]},'')
    assert.deepEqual((await coachEventView(user,chat))?.actions.map(item=>item.draft?.content),[content])
    assert.equal((await store.listConversations(user)).find(item=>item.id===chat)?.messages.at(-1)?.content,reply)
    const rejectedTemplate=await h.account(),requested=await h.account()
    const single=`岗位探索事项。${template}。只在回复中展示。`
    await assert.rejects(h.execute(rejectedTemplate.user,rejectedTemplate.chat,single,{viewOnlyDrafts:['状态：已生成岗位记录模板。']},''),{code:'COACH_MATERIAL_NOT_VISIBLE'})
    const viewOnlyRun=await h.execute(requested.user,requested.chat,single,{viewOnlyDrafts:[templateBody]},'可以查看这份模板。')
    assert.deepEqual((await coachEventView(requested.user,requested.chat))?.actions??[],[])
    assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[requested.user,viewOnlyRun.request_id])).rows,[{content:'可以查看这份模板。\n\n'+templateBody}])
    const incomplete=await h.account(),complete=await h.account()
    const fields=`${template}。字段包括：**岗位名称**、**公司名称**、**职责**和**备注**。只在回复中展示。`
    const fullTemplate='岗位记录模板\n岗位名称：____\n公司名称：____\n职责：____\n备注：____'
    await assert.rejects(h.execute(incomplete.user,incomplete.chat,fields,{viewOnlyDrafts:[templateBody]},''),{code:'COACH_MATERIAL_NOT_VISIBLE'})
    await h.execute(complete.user,complete.chat,fields,{viewOnlyDrafts:[fullTemplate]},'')
    assert.equal((await store.listConversations(complete.user)).find(item=>item.id===complete.chat)?.messages.at(-1)?.content,fullTemplate)
    assert.deepEqual((await coachEventView(complete.user,complete.chat))?.actions??[],[])
    const suffix=await h.account()
    await h.execute(suffix.user,suffix.chat,'请生成一份只读的岗位申请记录，字段包括岗位名称、公司名称、职责和备注的模板。',{viewOnlyDrafts:[fullTemplate]},'')
    assert.equal((await store.listConversations(suffix.user)).find(item=>item.id===suffix.chat)?.messages.at(-1)?.content,fullTemplate)
    const duplicate=await h.account()
    await h.execute(duplicate.user,duplicate.chat,`岗位探索事项。${template}。${template}。只在回复中展示。`,{
     event:{target:{operation:'create',title:'岗位探索事项',source:{clauseId:'c0'}},action:{operation:'create',source:{clauseId:'c1'},draft:{content:templateBody+'\n备注：____'}}},viewOnlyDrafts:[templateBody],
    },'')
    assert.deepEqual((await coachEventView(duplicate.user,duplicate.chat))?.actions.map(item=>item.draft?.content),[templateBody+'\n备注：____'])
    const adjacent=`岗位探索事项。${action}。请生成一份只读的联系人模板。字段包括姓名、备注，在此之后请生成一份只读的岗位模板，字段包括公司、岗位。`
    const visibility=coachMaterialVisibility(adjacent)
    assert.deepEqual(visibility.viewOnly.map(request=>request.requiredFields),[['姓名','备注'],['公司','岗位']])
    assert.deepEqual(visibility.writable.map(request=>request.quote),[action])
    const ordered=await h.account(),wrongOrder=await h.account()
    const contactBody='联系人模板\n姓名：____\n备注：____',positionBody='岗位模板\n公司：____\n岗位：____'
    await assert.rejects(h.execute(wrongOrder.user,wrongOrder.chat,adjacent,{...frame(),viewOnlyDrafts:[positionBody,contactBody]},''),{code:'COACH_MATERIAL_NOT_VISIBLE'})
    assert.equal(await coachEventView(wrongOrder.user,wrongOrder.chat),null)
    await h.execute(ordered.user,ordered.chat,adjacent,{...frame(),viewOnlyDrafts:[contactBody,positionBody]},'')
    assert.deepEqual((await coachEventView(ordered.user,ordered.chat))?.actions.map(item=>item.draft?.content),[content])
    assert.equal((await store.listConversations(ordered.user)).find(item=>item.id===ordered.chat)?.messages.at(-1)?.content,[contactBody,positionBody,content].join('\n\n'))
   })
  await t.test('a natural major change supplies only its current value to a fresh conversation',async()=>{
   const {user,chat}=await h.account()
   const text='我的专业是信息管理。昨天我独立清洗了社团问卷数据，去掉了3条重复问卷。我也会用SQL写基础查询。'
   const initialRun=await h.execute(user,chat,text,{
    growthUpdates:[
     {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}},
     {target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c1'},contribution:{actor:'self',actionQuote:'独立完成社团问卷清洗并去重'}},
     {target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c2'},contribution:{actor:'self',actionQuote:'去除了3条重复的问卷'}},
     {target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c3'}},
    ],event:{target:{operation:'create',title:'社团问卷清洗',source:{clauseId:'c1'}},factRefs:[0,1,2,3]},
   },'已保留你报告的专业、问卷去重和查询能力。')
   const questionnaire=await coachEventView(user,chat)
   const initialAudit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,initialRun.request_id])).rows[0].tool_audit
   assert.ok(initialAudit.some((entry:any)=>entry.kind==='reported_cleanup_action_resolved_from_source'))
   assert.ok(initialAudit.some((entry:any)=>entry.kind==='reported_cleanup_outcome_kept_as_fact'))
   assert.ok(questionnaire?.nodes.some(node=>node.source?.quote==='我的专业是信息管理'))
   const recallChat=randomUUID()
   await store.createConversation(user,{id:recallChat,title:'SYNTHETIC direct outcome readback'})
   await h.execute(user,recallChat,'接着上次的问卷经历，我做过的部分是什么？还有哪一项需要核实？',{},
    '你报告独立清洗了社团问卷数据，去掉了3条重复问卷。还可核实清洗后数据有没有用于分析。')
   const recallRequest=h.requests.at(-1)
   const recallPrompt=JSON.parse(recallRequest.messages.find((message:any)=>message.role==='user'&&message.content.startsWith('{')).content)
   assert.deepEqual(recallPrompt.currentTask.recordedVerificationPoints,[],'a reported skill does not become a pending check')
   const recalled=recallPrompt.confirmedExperiences[0]
   assert.equal(recalled.content.result,'去掉了3条重复问卷')
   assert.match(recalled.readbackText,/问卷/)
   assert.equal(recalled.quote,undefined,'a displayed or corrected experience summary is not a literal source quote')
   assert.equal(recalled.source_quote,undefined)
   assert.match(recallRequest.messages.find((message:any)=>message.role==='system').content,/直接结果和后续用途、反馈及效果分别说明/)
    assert.doesNotMatch(JSON.stringify(recallRequest.messages),/报告使用老师的公式、脚本或检查表/)
    for(const rule of [/仅在本人明确报告独立完成时保留这项事实/,/不因分工或工具未报告而重新质疑独立完成/,/否则独立程度未确认/,/没有已存的待核实项时，把新核验明确写成建议/]){
     assert.match(recallRequest.messages.find((message:any)=>message.role==='system').content,rule)
     assert.match(recallRequest.response_format.json_schema.schema.properties.reply.description,rule)
    }
   const correction='我的专业从信息管理改成软件工程。保留问卷经历和其他已保存的事实。'
   const unrelatedQuestion='清洗和去重操作具体使用的工具或方法是什么？'
   const correctionReply='已把当前专业更新为软件工程，问卷经历和查询能力保留。'
   const correctionRun=await h.execute(user,recallChat,correction,{
    event:{target:{operation:'continue',eventId:questionnaire!.id,expectedRevision:questionnaire!.revision},nodes:[{kind:'unknown',question:unrelatedQuestion}]},
   },correctionReply)
   assert.match(h.requests.at(-1).messages.find((message:any)=>message.role==='system').content,/不为说明保留而复述上一轮的事实或问题/)
   const correctionRequest=h.requests.at(-1)
   assert.deepEqual(Object.keys(correctionRequest.response_format.json_schema.schema.properties),['reply'])
   assert.deepEqual(correctionRequest.messages.map((message:any)=>message.role),['system','user','user'])
   assert.equal(correctionRequest.messages.at(-1).content,correction)
   assert.doesNotMatch(correctionRequest.messages[1].content,/需要核实|清洗了社团问卷数据/)
   assert.ok(!(await coachEventView(user,chat,questionnaire!.id))?.nodes.some(node=>node.content===unrelatedQuestion))
   assert.equal((await store.listConversations(user)).find(item=>item.id===recallChat)?.messages.at(-1)?.content,correctionReply)
   const current=await pool.query("SELECT id,text,sources FROM growth_items WHERE user_id=$1 AND kind='context' AND status='active' AND strpos(text,'专业')>0",[user])
   assert.equal(current.rows.length,1)
   const major=current.rows[0]!
   assert.equal(major.text,'我的专业改成软件工程')
   assert.deepEqual(major.sources.map((source:{id:string;quote:string;range:{start:number;end:number}})=>{
    assert.equal(source.id,correctionRun.source_message_id)
    assert.equal(correction.slice(source.range.start,source.range.end),source.quote)
    return source.quote
   }),['我的专业','改成软件工程'])
   const {event:eventAfter,bindings}=await coachEventViewWithSources(user,chat,questionnaire!.id)
   assert.ok(!eventAfter.nodes.some(node=>node.content?.includes('信息管理')||node.source?.quote?.includes('信息管理')))
   for(const retained of ['昨天我独立清洗了社团问卷数据','去掉了3条重复问卷','我也会用SQL写基础查询']){
    const node=eventAfter.nodes.find(node=>node.source?.quote===retained)
    const source=bindings.nodeSources.find(binding=>binding.nodeId===node?.id)?.source
    assert.ok(source?.range,retained)
    assert.equal(source.messageId,initialRun.source_message_id)
    assert.equal(text.slice(source.range.start,source.range.end),retained)
   }
   const fresh=randomUUID()
   await store.createConversation(user,{id:fresh,title:'SYNTHETIC current major readback'})
   const readback='只根据仍然保存的事实，说明我的专业、问卷经历，以及下次该如何验证清洗结果。'
   const readbackReply='你现在的专业是软件工程。上次独立清洗了社团问卷数据并去掉了3条重复问卷。下次可先比较原始与清洗后的条数。'
   await h.execute(user,chat,readback,{},readbackReply)
   const sameSessionPrompt=h.requests.at(-1).messages.find((message:any)=>message.role==='user'&&message.content.startsWith('{')).content
   assert.doesNotMatch(sameSessionPrompt,/信息管理/,'the model sees scoped redaction of historical messages in the same conversation')
   assert.match(sameSessionPrompt,/去掉了3条重复问卷/)
   const beforeReadback=h.requests.length
   const readbackRun=await h.execute(user,fresh,readback,{
    growthUpdates:[{target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'completed',source:{clauseId:'c1'},contribution:{actor:'self',actionQuote:'已经核实了新的问卷数据'}}],
    event:{target:{operation:'create',title:'未发生的验证',source:{clauseId:'c1'}},factRefs:[0]},
    additionalProviderSidecar:{unsupported:true},
   },readbackReply)
   assert.equal(h.requests.length,beforeReadback+1)
   assert.deepEqual((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,readbackRun.request_id])).rows,[{content:readbackReply}])
   const audit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,readbackRun.request_id])).rows[0]?.tool_audit
   assert.ok(audit.some((entry:{phase:string;kind?:string})=>entry.phase==='coach_output_normalized'&&entry.kind==='read_only_reply_sidecars_removed'))
   assert.equal((await coachEventView(user,chat,questionnaire!.id))?.revision,eventAfter.revision)
   assert.equal((await pool.query('SELECT count(*)::int AS count FROM coach_events WHERE user_id=$1',[user])).rows[0]?.count,1)
   const readbackSchema=h.requests.at(-1).response_format?.json_schema?.schema?.properties??{}
   assert.ok(!Object.hasOwn(readbackSchema,'growthUpdates')&&!Object.hasOwn(readbackSchema,'event'))
    const readbackSystem=h.requests.at(-1).messages.find((message:any)=>message.role==='system').content
    for(const rule of [/不把其中一个环节写成整件事完成/,/核验步骤直接给出/,/影响核验的未知写成陈述/,/正文结束后不追加追问/,/用户明确索要核对问题时按要求提供/]){
     assert.match(readbackSchema.reply.description,rule)
     assert.match(readbackSystem,rule)
    }
   const prompt=JSON.parse(h.requests.at(-1).messages.find((message:any)=>message.role==='user'&&message.content.startsWith('{')).content)
   const oldValuePaths:string[]=[]
   function locateOldValue(value:unknown,path:string){
    if(typeof value==='string'&&value.includes('信息管理'))oldValuePaths.push(path)
    else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))locateOldValue(child,path+'.'+key)
   }
   locateOldValue(prompt,'prompt')
   assert.deepEqual(oldValuePaths,[],'the superseded value is outside the new conversation model context')
   assert.match(JSON.stringify(prompt),/软件工程/)
   assert.match(JSON.stringify(prompt),/去掉了3条重复问卷/)
   const currentMajor=[...prompt.growth,...prompt.growthBackground].find((item:any)=>item.id===major.id)
   assert.deepEqual(currentMajor?.currentProfileFact,{field:'education.major',value:'软件工程'})
   assert.equal(currentMajor?.text,undefined)
   assert.ok(!JSON.stringify(prompt).includes(major.text),'do not offer stitched text as a quotable source')
   assert.equal((await store.listExperiences(user)).length,1)
   const currentFact=(await growthView(user,fresh)).items.find(item=>item.id===major.id)!
   const at=Date.parse(currentFact.updatedAt)
   const legacy:ProfileFact={id:randomUUID(),key:'education.major',value:'数据科学',scope:'user',taskType:null,observedAt:new Date(at+60_000).toISOString(),validUntil:null,revision:2,status:'active',source:{type:'message',messageId:randomUUID(),quote:'我的专业不是信息管理，而是数据科学'}}
   const promptFor=(profile:ProfileFact)=>buildTurnPrompt({currentMessageId:fresh,messages:[{id:fresh,role:'user',content:'说一下我的当前专业',created_at:new Date(at+120_000).toISOString()}],growth:[currentFact],growthBackground:[currentFact],profile:[profile]})
   const newer=promptFor(legacy)
   assert.match(newer,/数据科学/)
   assert.doesNotMatch(newer,/信息管理|软件工程/)
   const older=promptFor({...legacy,observedAt:new Date(at-60_000).toISOString()})
   assert.match(older,/软件工程/)
   assert.doesNotMatch(older,/信息管理|数据科学/)
   const denied='我的专业不是信息管理，而是软件工程'
   const singleSource={...currentFact,text:denied,assertion:'user_edit' as const,sources:[{type:'user_edit' as const,quote:denied}]}
   const staleCopy={...currentFact,revision:currentFact.revision-1,updatedAt:new Date(at-60_000).toISOString(),text:'我的专业是信息管理'}
   const merged=buildTurnPrompt({currentMessageId:fresh,messages:[{id:fresh,role:'user',content:'说明当前专业',created_at:new Date(at+120_000).toISOString()}],growth:[singleSource],growthBackground:[staleCopy]})
   assert.doesNotMatch(merged,/信息管理|不是软件工程/)
   assert.equal([...JSON.parse(merged).growth,...JSON.parse(merged).growthBackground].filter(item=>item.currentProfileFact?.field==='education.major').length,1)
   assert.match(merged,/软件工程/)
   for(const latest of [
    {...currentFact,status:'forgotten' as const,text:'',sources:[],unavailableReason:'source_revoked'},
    {...currentFact,unavailableReason:'source_revoked'},
   ]){
    const revoked=buildTurnPrompt({currentMessageId:fresh,messages:[{id:fresh,role:'user',content:'说明当前专业',created_at:new Date(at+120_000).toISOString()}],growth:[staleCopy],growthBackground:[latest]})
    assert.doesNotMatch(revoked,/信息管理|软件工程|currentProfileFact/,'a newer unavailable revision bars its older active copy')
    const acrossOwners=buildTurnPrompt({currentMessageId:fresh,messages:[{id:fresh,role:'user',content:'说明当前专业',created_at:new Date(at+120_000).toISOString()}],growth:[staleCopy],growthBackground:[latest,{...staleCopy,id:randomUUID()}],profile:[{...legacy,observedAt:new Date(at-90_000).toISOString()}]})
    assert.doesNotMatch(acrossOwners,/信息管理|软件工程|数据科学|currentProfileFact/,'an older major in a different projection cannot beat the withdrawal')
   }
   await h.execute(user,fresh,'我的专业改成计算机科学。',{},'已把专业更新为计算机科学。')
   const after=await growthView(user,fresh)
   assert.equal(after.items.find(item=>item.id===major.id)?.text,'我的专业改成计算机科学')
   assert.ok(after.items.some(item=>item.kind==='ability'&&item.status==='active'&&item.text.includes('SQL')))
   const legacyQuestion=randomUUID(),retainedQuestion=randomUUID()
   const prior=(await coachEventView(user,chat,questionnaire!.id))!
   await h.execute(user,chat,'我下周准备参加SQL入门课。',{
    event:{target:{operation:'continue',eventId:prior.id,expectedRevision:prior.revision},nodes:[{kind:'fact',source:{clauseId:'c0'}}]},
   },'已知道你下周准备参加SQL入门课。')
   // Earlier releases could save an inferred question with no tool-source binding.
   await pool.query("INSERT INTO coach_nodes(id,user_id,event_id,kind,content) VALUES($1,$3,$4,'unknown',$5),($2,$3,$4,'unknown',$6)",
    [legacyQuestion,retainedQuestion,user,questionnaire!.id,'本次清洗是否实际使用了SQL？','问卷查询结果是否交付？'])
   const withQuestions=(await coachEventView(user,chat,questionnaire!.id))!
   assert.ok(withQuestions.nodes.some(node=>node.id===legacyQuestion&&node.status==='active'))
   await h.execute(user,fresh,'接着上次的问卷经历，我做过的部分是什么？还有哪一项需要核实？',{
    event:{target:{operation:'continue',eventId:withQuestions.id,expectedRevision:withQuestions.revision},nodes:[{kind:'unknown',question:'是否还使用了其他工具？'}]},
   },'你独立清洗了社团问卷数据，并去掉了3条重复问卷。还有一项可核实，清洗结果是否交付。')
   const historicalReadback=h.requests.at(-1).response_format?.json_schema?.schema?.properties??{}
   const pending=JSON.parse(h.requests.at(-1).messages.find((message:any)=>message.role==='user'&&message.content.startsWith('{')).content)
    .currentTask.recordedVerificationPoints.map((point:{question:string})=>point.question)
   assert.deepEqual(pending.sort(),['本次清洗是否实际使用了SQL？','问卷查询结果是否交付？'].sort())
   assert.ok(!Object.hasOwn(historicalReadback,'growthUpdates')&&!Object.hasOwn(historicalReadback,'event'))
   assert.equal((await coachEventView(user,chat,questionnaire!.id))?.revision,withQuestions.revision)
   const previousProviderCalls=h.requests.length
   await h.execute(user,chat,'请忘掉我会用SQL写基础查询这条记录。')
   assert.equal(h.requests.length,previousProviderCalls)
   const forgotten=await coachEventView(user,chat,questionnaire!.id)
   assert.doesNotMatch(JSON.stringify(forgotten),/本次清洗是否实际使用了SQL|SQL写基础查询/)
   assert.ok(forgotten?.nodes.some(node=>node.kind==='unknown'&&node.content==='问卷查询结果是否交付？'&&node.status==='active'))
   assert.ok(forgotten?.nodes.some(node=>node.kind==='fact'&&node.content==='我下周准备参加SQL入门课'))
   assert.deepEqual((await pool.query('SELECT status,content FROM coach_nodes WHERE user_id=$1 AND id=$2',[user,legacyQuestion])).rows,[{status:'withdrawn',content:null}])
   await h.execute(user,fresh,readback,{},readbackReply)
   const afterForget=h.requests.at(-1).messages.find((message:any)=>message.role==='user'&&message.content.startsWith('{')).content
   assert.doesNotMatch(afterForget,/本次清洗是否实际使用了SQL|SQL写基础查询/)
   assert.match(afterForget,/去掉了3条重复问卷/)
  })
 }finally{await h.close()}
})
