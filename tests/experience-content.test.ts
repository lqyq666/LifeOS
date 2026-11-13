import test from 'node:test'
import assert from 'node:assert/strict'
import { buildClauseCatalogue } from '../server/clause-catalogue.ts'
import { clauseExpressesFuturePlan, clauseReportsCompleted, clauseReportsPastAction, deriveStructuralLinks, personalActionClauses, personalActionText, requiresExperienceCandidate, resolveCandidateContent, selectStructuralCandidate } from '../server/experience-content.ts'
import {reportsInterviewOccurrence} from '../server/turn-contract.ts'

const ANCHOR='2026-10-08T12:00:00.000Z' // Thursday 20:00 Shanghai

test('a quantified cleanup result is retained with the same owned past action',()=>{
 const text='我的专业是信息管理。昨天我独立清洗了社团问卷数据，去掉了3条重复问卷。我也会用SQL写基础查询。'
 const candidate=selectStructuralCandidate(text,buildClauseCatalogue(text),ANCHOR)
 assert.match(candidate?.content.action??'',/独立清洗了社团问卷数据$/)
 assert.equal(candidate?.content.result,'去掉了3条重复问卷')
 for(const other of ['同学去掉了3条重复问卷','如果去掉了3条重复问卷','计划去掉3条重复问卷']){
  const input='我清洗了社团问卷数据，'+other+'。'
  assert.equal(selectStructuralCandidate(input,buildClauseCatalogue(input),ANCHOR)?.content.result,'',other)
 }
})

test('mixed quoted/code words and protected first-person siblings cannot manufacture a performed experience',()=>{
  for(const text of ['我正在看“我写完了申请书”这段例句。','我正在看`我完成了作业`这个测试字符串。','📝我正在看“我写完了申请书”这段例句。','“我”，完成了社团推文。','上次那件事的例句是“后来对方用了”。']){
    const clauses=buildClauseCatalogue(text)
    assert.equal(requiresExperienceCandidate(clauses),false,text)
    assert.equal(selectStructuralCandidate(text,clauses,ANCHOR),null,text)
  }
  const real='我写了标题为“完成了作业”的推文，老师说写得不错。'
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(real)),true,'real work outside quotes remains usable')
})

test('the saved campus wish to clarify delivery scope is not a completed experience',()=>{
 assert.equal(clauseReportsCompleted('先确认需求与交付范围'),false,'instruction fragment is not performed delivery')
 assert.equal(clauseReportsCompleted('不要把这个模板记为已经完成的行动'),false,'classification instruction is not a completion report')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我仍未开始查岗位。不要把这个模板记为已经完成的行动。')),false,'negated template state cannot enter the star map')
 const listening='还是上次那件请教的事，我先只想说说近况。'
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue(listening)),false,'conversational preference does not become a back-reference result')
 assert.equal(clauseReportsCompleted('我先只想说说近况'),false)
 const wishes=['我是成年大学生，想探索自由职业接单。我想先确认需求与交付范围，怎么开始？','我想交付一张海报。','我想先上线作品。']
 for(const text of wishes){const clauses=buildClauseCatalogue(text);assert.equal(requiresExperienceCandidate(clauses),false,text);assert.equal(selectStructuralCandidate(text,clauses,ANCHOR),null,text)}
 assert.equal(clauseReportsCompleted('我考虑完成报告'),false,'considering an action is not completed work')
 assert.equal(selectStructuralCandidate('我考虑完成报告。',buildClauseCatalogue('我考虑完成报告。'),ANCHOR),null)
 assert.equal(clauseExpressesFuturePlan('我还在认真考虑访谈完三位学生后再反馈。'),true,'a bounded manner adverb inside progressive consideration stays prospective')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我还在认真考虑访谈完三位学生后再反馈。')),false,'considered interview work is not a completed occurrence')
 assert.equal(clauseExpressesFuturePlan('我还在优先考虑访谈完三位学生后再反馈。'),true,'open bounded wording before consideration stays prospective')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我还在优先考虑访谈完三位学生后再反馈。')),false,'open consideration wording cannot manufacture an interview occurrence')
 for(const consideredTime of ['我还在考虑周六访谈完三位学生后再反馈。','我考虑11月2日访谈完三位学生后再反馈。','我考虑两天后访谈完三位学生后再反馈。','我考虑大约三周后访谈完三位学生后再反馈。']){
  assert.equal(clauseExpressesFuturePlan(consideredTime),true,'a calendar-qualified considered action stays prospective: '+consideredTime)
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(consideredTime)),false,'calendar wording cannot manufacture an interview occurrence: '+consideredTime)
 }
 const splitPlan='我有个计划，完成了报告后休息。'
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue(splitPlan)),false,'a standalone plan declaration cannot lend user ownership to its comma-separated outcome')
 assert.equal(selectStructuralCandidate(splitPlan,buildClauseCatalogue(splitPlan),ANCHOR),null)
 const mixed='我已经交付了一张海报。我想先确认下一单的交付范围，怎么开始？'
 const actual=selectStructuralCandidate(mixed,buildClauseCatalogue(mixed),ANCHOR)
 assert.equal(actual?.quote,'我已经交付了一张海报');assert.equal(requiresExperienceCandidate(buildClauseCatalogue(mixed)),true)
})

test('an explicit open third-party interview subject overrides temporal actor inheritance',()=>{
 assert.equal(reportsInterviewOccurrence('我访谈3位产品经理了。'),true,'an Arabic participant quantity remains a completed self interview')
 assert.equal(reportsInterviewOccurrence('我先整理了提纲，后来助教访谈了三位学生。'),false,'an unknown direct role cannot inherit the user actor')
 assert.equal(reportsInterviewOccurrence('我先整理了提纲，后来团支书访谈了三位学生。'),false,'an open human role outside the suffix catalogue cannot inherit the user actor')
 assert.equal(reportsInterviewOccurrence('我先整理了提纲，后来助教反复访谈了三位学生。'),false,'a human performer remains third-party through an action adverb')
 assert.equal(reportsInterviewOccurrence('我先整理了提纲，后来认真访谈了三位学生。'),true,'a pure action modifier keeps ordinary omitted-subject inheritance')
 assert.equal(reportsInterviewOccurrence('我先整理了提纲，后来反复访谈了三位学生。'),true,'an ordinary action adverb cannot become an invented performer')
 assert.equal(reportsInterviewOccurrence('我先整理了提纲，后来周六访谈了三位学生。'),true,'a weekday is a time qualifier, not a fabricated actor')
 assert.equal(reportsInterviewOccurrence('我先整理了提纲，后来11月2日访谈了三位学生。'),true,'a calendar date is a time qualifier, not a fabricated actor')
 assert.equal(reportsInterviewOccurrence('我先整理了提纲，后来两天后访谈了三位学生。'),true,'a relative duration is a time qualifier, not a fabricated actor')
 assert.equal(reportsInterviewOccurrence('我先整理了提纲，后来周六助教访谈了三位学生。'),false,'a time qualifier cannot hide the following open third-party subject')
 assert.equal(reportsInterviewOccurrence('我先整理了提纲，后来两天后助教访谈了三位学生。'),false,'a relative duration cannot hide the following open third-party subject')
 assert.equal(reportsInterviewOccurrence('我先整理了提纲，后来用户管理系统访谈了三位学生。'),false,'an explicit non-human system cannot inherit the user as interview performer')
 assert.equal(reportsInterviewOccurrence('我先整理了提纲，后来项目组访谈了三位学生。'),false,'an explicit organization cannot inherit the user as interview performer')
 assert.equal(reportsInterviewOccurrence('我先整理了提纲，后来研究团队访谈了三位学生。'),false,'an uncatalogued organization cannot inherit the user as interview performer')
 assert.equal(reportsInterviewOccurrence('我们项目组访谈了三位学生。'),true,'an explicitly first-person team remains user-owned work')
 assert.equal(reportsInterviewOccurrence('我们研究团队访谈了三位学生。'),true,'an explicitly first-person uncatalogued team remains user-owned work')
 assert.equal(reportsInterviewOccurrence('我们三人访谈了三位学生。'),true,'an explicitly quantified first-person collective remains joint user work')
 assert.equal(reportsInterviewOccurrence('我们三位同学访谈了三位学生。'),true,'a quantified first-person collective with a role noun remains joint user work')
 assert.equal(reportsInterviewOccurrence('我们三位助教访谈了三位学生。'),true,'an explicit quantified first-person human role remains joint user work without a role whitelist')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们三人完成了报告。')),true,'a quantified first-person collective can create an experience candidate')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们三位同学完成了报告。')),true,'a quantified first-person collective with a role noun can create an experience candidate')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们三个助教完成了报告。')),true,'an explicit quantified first-person human role can create an experience candidate')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们三个机器人完成了报告。')),false,'a quantified non-human noun cannot become joint user work merely by ending in 人')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们三名AI助教完成了报告。')),false,'a quantified AI role cannot become joint user work through a human-role suffix')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们三名 AI 助教完成了报告。')),false,'whitespace cannot turn a quantified AI role into joint user work')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们三位虚拟助教完成了报告。')),false,'a quantified virtual role cannot become joint user work through a human-role suffix')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们三名系统工程师完成了报告。')),true,'a human occupation remains joint user work when its title contains system')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们三名算法工程师完成了报告。')),true,'a human occupation remains joint user work when its title contains algorithm')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们三名虚拟教师完成了报告。')),false,'a virtual actor cannot become joint user work through an occupation title')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们工程师完成了报告。')),true,'an unquantified first-person occupation remains joint user work')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们嵌入式工程师完成了报告。')),true,'an open bounded specialty remains joint user work')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们产品负责人完成了报告。')),true,'an open human role head remains joint user work without an occupation whitelist')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们产品负责人小王完成了报告。')),false,'a named person after an open possessive role remains the explicit third-party performer')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们虚拟程序员完成了报告。')),false,'a virtual actor remains non-user work regardless of its occupation suffix')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们系统完成了报告。')),false,'a possessed non-human system cannot become joint user work')
 assert.equal(selectStructuralCandidate('我们系统完成了报告。',buildClauseCatalogue('我们系统完成了报告。'),ANCHOR),null,'system work must not enter the user experience or star map')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们智能体完成了报告。')),false,'an open non-human agent noun cannot become joint user work')
  assert.equal(selectStructuralCandidate('我们智能体完成了报告。',buildClauseCatalogue('我们智能体完成了报告。'),ANCHOR),null,'agent work must not enter the user experience or star map')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们面向全国高校毕业生就业服务综合平台的虚拟程序员完成了报告。')),false,'a long virtual-role modifier cannot fall through to joint user ownership')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们导师昨天完成了报告。')),false,'a bare relational role after first-person plural remains possessive and third-party')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们的工程师完成了报告。')),false,'an explicitly possessive occupation remains third-party work')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们班助教完成了报告。')),false,'a possessive-like first-person class frame cannot turn its TA into the user')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我班的助教完成了报告。')),false,'a singular first-person class container cannot turn its TA into the user')
 assert.equal(selectStructuralCandidate('我们班助教完成了报告。',buildClauseCatalogue('我们班助教完成了报告。'),ANCHOR),null,'the TA remains the performer after 我们班')
 assert.equal(selectStructuralCandidate('我班的助教完成了报告。',buildClauseCatalogue('我班的助教完成了报告。'),ANCHOR),null,'the TA remains the performer after 我班的')
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我们班王建中完成了报告。')),false,'a named person after a plural possessive container remains the performer')
})

test('role-headed technical objects remain first-person completed work',()=>{
 for(const text of ['我用户管理系统做完了。','我客户管理系统做完了。']){
  const candidate=selectStructuralCandidate(text,buildClauseCatalogue(text),ANCHOR)
  assert.equal(candidate?.content.action,text.slice(0,-1),text)
 }
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue('客户管理了系统。')),false,'a real third-party client subject remains non-user work')
})

test('a completed first-person action report structurally requires a candidate',()=>{
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('上周五我把社团招新的推文和海报整套都交了，比约好的时间晚了两天，部长说整体效果还不错。')),true)
  const contact='我通过学校邮箱请教了学长甲，原请求是想知道项目课能否提供实习作品。对方已经读了，但没有回复，也没有采用。'
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(contact)),true,'a concrete channel contact is a performed experience')
  assert.ok(selectStructuralCandidate(contact,buildClauseCatalogue(contact),ANCHOR)?.content.action.includes('学校邮箱请教了学长甲'))
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我准备通过学校邮箱请教学长甲。')),false,'a planned channel contact stays out')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我通过学校邮箱将联系导师。')),false,'a channel does not turn an explicit future modal into completion')
  for(const timedFuture of ['我之前通过邮箱将于周五提交报告。','我之前通过邮箱会在周五提交报告。']){
    assert.equal(clauseExpressesFuturePlan(timedFuture),true,timedFuture)
    assert.equal(clauseReportsCompleted(timedFuture.slice(0,-1)),false,timedFuture)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(timedFuture)),false,timedFuture)
  }
  for(const negatedSend of ['我通过学校邮箱没有发送报告。','我昨天通过邮箱未发送报告。','我昨天通过邮箱不发送报告。','我昨天通过邮箱发送报告这件事最终没有发生。','我昨天通过邮箱没有成功发送报告。','我昨天通过邮箱被要求发送报告。','我昨天通过学校邮箱向研究生院招生就业办公室负责材料审核的老师不发送报告。','我昨天通过邮箱讨论发送报告的方案。','我之前通过邮箱发送报告前需要审批。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(negatedSend)),false,'a channel does not override explicit non-execution: '+negatedSend)
  for(const postposedNonExecution of ['我之前通过邮箱联系导师这件事由小王负责。','我之前通过邮箱联系导师应该更合适。']){
    assert.equal(clauseReportsCompleted(postposedNonExecution.slice(0,-1)),false,'postposed ownership or evaluation cannot turn a past channel into completed user work: '+postposedNonExecution)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(postposedNonExecution)),false,'postposed ownership or evaluation cannot enter experience: '+postposedNonExecution)
  }
  for(const nearMiss of ['我昨天通过邮箱差点发送报告。','我昨天通过邮箱差一点提交报告。','我昨天通过邮箱险些联系导师。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(nearMiss)),false,'a near miss is explicit non-occurrence: '+nearMiss)
  for(const nominalOrObserved of ['我昨天通过邮箱发送报告的按钮坏了。','我昨天通过邮箱发送报告按钮坏了。','我昨天通过邮箱发送报告按钮消失了。','我昨天通过邮箱发送报告按钮被禁用了。','我昨天通过邮箱的发送报告按钮变灰了。','我昨天通过邮箱发送队列卡住了。','我昨天通过邮箱提交任务停滞了。','我昨天通过邮箱发送请求超时了。','我昨天通过邮箱提交申请冻结了。','我昨天通过邮箱提交任务过期了。','我昨天通过邮箱发送链路断开了。','我昨天通过邮箱看到导师发送报告。','我昨天通过邮箱看到导师发送报告了。','我昨天通过邮箱由导师发送报告。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(nominalOrObserved)),false,'past channel context cannot own a nominal, observed or passive third-party send: '+nominalOrObserved)
  for(const failedSend of ['我昨天通过邮箱发送报告失败了。','我昨天通过邮箱发送报告未成功。','我昨天通过邮箱发送了报告但发送失败了。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(failedSend)),false,'a failed send is not completed experience: '+failedSend)
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我不得不完成了报告。')),true,'a compelled but perfective action is still completed experience evidence')
  assert.equal(clauseReportsCompleted('我昨天通过邮箱发送报告这件事最终没有发生'),false,'a trailing denial of occurrence governs the earlier action')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发送了报告，没有发生错误。')),true,'a denied side effect does not erase the completed send')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我通过邮箱发送了报告并记录失败原因。')),true,'an unrelated failure noun does not erase the explicitly completed send')
  for(const capability of ['我之前通过学校邮箱能够发送报告。','我之前通过学校邮箱可以提交材料。','我之前通过学校邮箱能联系导师。']){
    assert.equal(clauseReportsCompleted(capability.slice(0,-1)),false,capability)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(capability)),false,capability+' states capability, not execution')
  }
  const completedOuterWithCapabilityObject='我把可以提交的材料整理了。'
  assert.equal(clauseReportsCompleted(completedOuterWithCapabilityObject.slice(0,-1)),true,'a capability inside the object does not erase the completed outer predicate')
  assert.equal(selectStructuralCandidate(completedOuterWithCapabilityObject,buildClauseCatalogue(completedOuterWithCapabilityObject),ANCHOR)?.content.action,completedOuterWithCapabilityObject.slice(0,-1))
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我可以提交材料并整理目录。')),false,'a capability governing the main predicate remains non-execution')
  for(const lexicalAbility of ['我负责性能分析并已完成。','我完成了功能分析。'])assert.equal(selectStructuralCandidate(lexicalAbility,buildClauseCatalogue(lexicalAbility),ANCHOR)?.content.action,lexicalAbility.slice(0,-1),'lexical 能 is not a capability modal: '+lexicalAbility)
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我通过学校邮箱让李老师发送了报告。')),false,'a channel does not claim a delegated send as user work')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我安排产品负责人完成了报告。')),false,'an open compound role remains the delegated performer')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我让助教完成了报告。')),false,'an uncatalogued delegated role remains the performer')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我让助教按照我的方法完成了报告。')),false,'a first-person possessive method does not reclaim an open delegated performer')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我让助教帮助我完成了报告。')),true,'an explicit standalone self bridge after an open role restores user performance')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我让自己完成了报告。')),true,'an explicit reflexive performer remains user work')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我安排了今天的时间并完成了报告。')),true,'an arranged object before a coordinated completion is not an open delegated performer')
  for(const modifiedTime of ['我安排了晚上的时间完成了报告。','我安排了周末的时间完成了报告。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(modifiedTime)),true,'an ordinary modified time object cannot become a fabricated performer: '+modifiedTime)
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我安排好时间后完成了报告。')),true,'an arrangement-result time slot cannot become a fabricated performer')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我安排助教会后完成了报告。')),false,'a real open-role performer remains delegated through its temporal modifier')
  for(const durationSlot of ['我安排了三小时完成了报告。','我安排了3小时完成了报告。','我安排了三小时半完成了报告。','我安排了三小时的时间完成了报告。','我安排了三小时以内完成了报告。','我安排了大约三小时完成了报告。','我安排了近三小时完成了报告。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(durationSlot)),true,'a bounded duration slot is not a delegated performer: '+durationSlot)
  for(const clockSlot of ['我安排了下午两点完成了报告。','我安排了晚上八点半完成了报告。','我安排了14:30完成了报告。','我安排了周六下午两点完成了报告。','我安排了星期日晚上八点半完成了报告。','我安排了11月2日14:30完成了报告。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(clockSlot)),true,'a clock-time slot is not a delegated performer: '+clockSlot)
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我安排导师按照我的方法完成了报告。')),false,'a first-person possessive method does not reverse the delegated performer')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我安排导师让我完成了报告。')),true,'an explicit causative self subject does reverse the delegated performer')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我安排导师帮助我室友完成了报告。')),false,'a possessive relational actor after 我 is not a standalone self subject')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我安排导师帮助我完成了报告。')),true,'a standalone self subject after assistance keeps the user performer')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我陪王建中看他做完了创业访谈。')),false,'a named performer inside an accompaniment wrapper remains third-party')
  for(const openNestedActor of ['我陪助教看他做完了创业访谈。','我在整理助教访谈了三位学生的记录。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(openNestedActor)),false,'an open nested performer remains third-party without a finite role catalogue: '+openNestedActor)
  for(const completedOuterRecord of ['我整理了助教访谈了三位学生的记录。','我整理了助教访谈了三位学生的表格。']){
   assert.equal(personalActionText(completedOuterRecord.slice(0,-1)),'我整理了','the user owns the completed outer record action, not the embedded interview: '+completedOuterRecord)
   assert.equal(selectStructuralCandidate(completedOuterRecord,buildClauseCatalogue(completedOuterRecord),ANCHOR)?.content.action,'我整理了','protecting an embedded performer must retain only the user\'s real outer work: '+completedOuterRecord)
  }
  const passiveRelativeObject='我核对了由小王提交的报告。'
  assert.equal(personalActionText(passiveRelativeObject.slice(0,-1)),'我核对了','a third-party relative inside the object cannot erase the user-owned outer review')
  assert.equal(selectStructuralCandidate(passiveRelativeObject,buildClauseCatalogue(passiveRelativeObject),ANCHOR)?.content.action,'我核对了','only the real outer review enters experience content')
  assert.equal(personalActionText('我核对了由小王负责的报告'),'我核对了','a passive relative object still preserves the independently completed outer review')
  assert.equal(personalActionText('我核对完由小王负责的报告'),'我核对完','a completion complement preserves the independently completed outer review')
  assert.equal(personalActionText('我核对好由小王负责的报告'),'我核对好','a result complement preserves the independently completed outer review')
  const objectFinalPassiveRelative='我核对由小王提交的报告了。'
  assert.equal(personalActionText(objectFinalPassiveRelative.slice(0,-1)),'我核对了','an object-final perfective marker preserves the user-owned outer review')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(objectFinalPassiveRelative)),true,'the embedded submitter cannot erase the user\'s completed outer review')
  assert.equal(selectStructuralCandidate(objectFinalPassiveRelative,buildClauseCatalogue(objectFinalPassiveRelative),ANCHOR)?.content.action,objectFinalPassiveRelative.slice(0,-1),'the verbatim completed outer review remains available to experience persistence')
  const coordinatedPassiveRelative='我核对了由小王提交的报告并记录了问题。'
  assert.equal(personalActionText(coordinatedPassiveRelative.slice(0,-1)),'我核对了并记录了问题','a passive relative object cannot absorb a later completed user action')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(coordinatedPassiveRelative)),true,'both completed user actions remain eligible experience evidence')
  assert.equal(selectStructuralCandidate(coordinatedPassiveRelative,buildClauseCatalogue(coordinatedPassiveRelative),ANCHOR)?.content.action,coordinatedPassiveRelative.slice(0,-1),'the persisted experience keeps the verbatim user report and third-party attribution')
  const lexicalYoulaiObject='我分析了由来已久的问题。'
  assert.equal(personalActionText(lexicalYoulaiObject.slice(0,-1)),lexicalYoulaiObject.slice(0,-1),'an ordinary object beginning with 由 is not a passive performer relation')
  assert.equal(selectStructuralCandidate(lexicalYoulaiObject,buildClauseCatalogue(lexicalYoulaiObject),ANCHOR)?.content.action,lexicalYoulaiObject.slice(0,-1),'lexical 由来 content remains verbatim experience evidence')
  const postposedPerformer='我完成了报告是由小王负责的。'
  assert.equal(personalActionText(postposedPerformer.slice(0,-1)),null,'a final copular performer overrides earlier first-person wording')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(postposedPerformer)),false,'postposed third-party responsibility cannot enter the user experience graph')
  const observedPassiveRelative='我看到了由小王完成的报告。'
  assert.equal(personalActionText(observedPassiveRelative.slice(0,-1)),null,'observing a third-party completion is not an independently completed user action')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(observedPassiveRelative)),false,'the embedded completion cannot manufacture first-person experience evidence')
  const explicitInnerSelf='我整理了这份我访谈了三位学生的记录。'
  assert.equal(personalActionText(explicitInnerSelf.slice(0,-1)),explicitInnerSelf.slice(0,-1),'an intervening object cannot hide the explicit inner user')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(explicitInnerSelf)),true,'both the user\'s outer record and explicit inner interview remain owned')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我通过学校邮箱发现李老师发送了报告。')),false,'a channel-prefixed observation does not claim another person\'s send as user work')
  for(const completedSend of ['我把申请发出去了。','我把报告发给了导师。']){
    assert.equal(clauseReportsCompleted(completedSend),true,completedSend)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(completedSend)),true,completedSend)
  }
  for(const explicitPastSend of ['我昨天把报告发给导师。','我之前把申请发出去。']){
    assert.equal(clauseReportsCompleted(explicitPastSend.slice(0,-1)),true,'an explicit past-time anchor restores omitted Chinese aspect: '+explicitPastSend)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(explicitPastSend)),true,'explicitly past user work remains eligible experience: '+explicitPastSend)
  }
  for(const revokedPastSend of ['我昨天把报告发给导师，这件事由小王负责。','我昨天把报告发给导师。这件事由小王负责。','我昨天把报告发给导师，后来发送失败了。','我昨天把报告发给导师前需要审批。','我昨天把报告发给导师前，需要审批。']){
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(revokedPastSend)),false,'a linked performer or failure revokes the aspect-omitted past send: '+revokedPastSend)
    assert.equal(selectStructuralCandidate(revokedPastSend,buildClauseCatalogue(revokedPastSend),ANCHOR),null,revokedPastSend)
  }
  for(const futureObjectCompletion of ['我将报告完成。','我将报告做完。']){
    assert.equal(clauseExpressesFuturePlan(futureObjectCompletion),true,futureObjectCompletion)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(futureObjectCompletion)),false,futureObjectCompletion+' is not independently perfective')
  }
  for(const completedObject of ['我已经将报告完成。','我已经按导师要求将报告完成。','我将报告完成了。','我将报告做完了。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(completedObject)),true,completedObject+' has independent completion evidence')
  const methodPrefixedSend='我按照老师的要求把报告发给导师了。'
  assert.equal(selectStructuralCandidate(methodPrefixedSend,buildClauseCatalogue(methodPrefixedSend),ANCHOR)?.content.action,methodPrefixedSend.slice(0,-1),'a method prefix cannot erase an explicitly completed outer send')
  for(const uncompletedSend of ['我把申请发出去。','我把报告发给导师。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(uncompletedSend)),false,uncompletedSend)
  const assistedThenDelegated='李老师指导我完成了报告并让同学提交了材料。'
  const assistedClauses=buildClauseCatalogue(assistedThenDelegated)
  assert.deepEqual(assistedClauses.map(clause=>clause.text),['李老师指导我完成了报告','让同学提交了材料'])
  const assistedCandidate=selectStructuralCandidate(assistedThenDelegated,assistedClauses,ANCHOR)
  assert.equal(assistedCandidate?.content.action,'李老师指导我完成了报告')
  assert.ok(!assistedCandidate?.quote.includes('同学提交'))
  for(const observedNickname of ['我发现阿杰完成了报告。','我看到老周提交了材料。']){
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(observedNickname)),false,observedNickname)
    assert.equal(selectStructuralCandidate(observedNickname,buildClauseCatalogue(observedNickname),ANCHOR),null,observedNickname)
  }
  for(const observedRole of ['我看到助教完成了报告。','我看到后勤助教完成了报告。','我看到并购顾问完成了报告。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(observedRole)),false,'an open observed performer cannot become the user: '+observedRole)
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我通过学校邮箱收到了李老师发送的报告。')),false,'receiving another person\'s report does not claim their send as user work')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我看到李老师的要求后自己完成了报告。')),true,'an observed person does not override an explicit reflexive self-performer')
  const observedOtherThenSelf='我看到小王完成了报告后自己整理了目录。'
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(observedOtherThenSelf)),false,'a mixed unsplit clause fails closed instead of claiming the observed person\'s work')
  assert.equal(selectStructuralCandidate(observedOtherThenSelf,buildClauseCatalogue(observedOtherThenSelf),ANCHOR),null,observedOtherThenSelf)
  const observedOtherThenExplicitSelf='我看到小王完成了报告后我整理了目录。'
  assert.deepEqual(buildClauseCatalogue(observedOtherThenExplicitSelf).map(clause=>clause.text),['我看到小王完成了报告','我整理了目录'])
  assert.equal(selectStructuralCandidate(observedOtherThenExplicitSelf,buildClauseCatalogue(observedOtherThenExplicitSelf),ANCHOR)?.content.action,'我整理了目录','an explicit repeated self actor retains only the user\'s later work')
  for(const directedSelf of ['小王让我完成了报告。','阿杰让我完成了报告。','老周让我完成了报告。','导师让我按上次方法完成了报告。','导师让我认真完成了报告。','导师让我认真地完成了报告。','导师让我亲自完成了报告。','导师让我在图书馆完成了报告。','导师让我把报告完成了。','我请导师帮助我亲自完成了报告。','我安排导师帮助我认真完成了报告。']){
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(directedSelf)),true,directedSelf+' keeps the user performer')
    assert.equal(selectStructuralCandidate(directedSelf,buildClauseCatalogue(directedSelf),ANCHOR)?.content.action,directedSelf.slice(0,-1),directedSelf)
  }
  for(const possessiveOther of ['导师让我的同学完成了报告。','我请导师帮助我的同学完成了报告。','导师让我室友完成了报告。','我请导师帮助我室友完成了报告。','导师让我联系的同学完成了报告。','导师让我组长完成了报告。','导师让我组长认真地完成了报告。','导师让我搭档完成了报告。','我请导师帮助我负责人助理完成了报告。']){
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(possessiveOther)),false,possessiveOther+' keeps the possessive actor as another person')
    assert.equal(selectStructuralCandidate(possessiveOther,buildClauseCatalogue(possessiveOther),ANCHOR),null,possessiveOther)
  }
  const objectStorage='我对象存储迁移做完了。'
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(objectStorage)),true,'对象 as a domain noun cannot be consumed as a partner actor')
  assert.equal(selectStructuralCandidate(objectStorage,buildClauseCatalogue(objectStorage),ANCHOR)?.content.action,objectStorage.slice(0,-1))
  const objectAnalysis='我对象分析报告写完了。'
  assert.equal(selectStructuralCandidate(objectAnalysis,buildClauseCatalogue(objectAnalysis),ANCHOR)?.content.action,objectAnalysis.slice(0,-1),'对象分析报告 is a technical noun compound, not partner authorship')
  const locatedObjectStorage='我对象存储服务在本地完成了迁移。'
  assert.equal(selectStructuralCandidate(locatedObjectStorage,buildClauseCatalogue(locatedObjectStorage),ANCHOR)?.content.action,locatedObjectStorage.slice(0,-1),'an open technical 对象 compound remains the user subject through a location phrase')
  const mannerObjectStorage='我对象存储服务认真地完成了迁移。'
  assert.equal(selectStructuralCandidate(mannerObjectStorage,buildClauseCatalogue(mannerObjectStorage),ANCHOR)?.content.action,mannerObjectStorage.slice(0,-1),'a technical 对象 compound cannot be swallowed as a relationship actor through a later manner phrase')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我对象完成了报告。')),false,'对象 followed by its own completed predicate remains another actor')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我对象分析了报告。')),false,'对象 followed by a perfective predicate remains another actor')
  for(const locatedOther of ['我室友在图书馆完成了报告。','我对象在实验室分析了报告。','我室友在阅览室完成了报告。','我室友在阅览室认真地完成了报告。','我室友特别认真负责地完成了报告。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(locatedOther)),false,'a relationship actor remains third-party through a location modifier: '+locatedOther)
  for(const roleManner of ['我孩子气地完成了报告。','我孩子气十足地完成了报告。','我专家式地完成了报告。','我朋友般地完成了报告。'])assert.equal(selectStructuralCandidate(roleManner,buildClauseCatalogue(roleManner),ANCHOR)?.content.action,roleManner.slice(0,-1),'a role-derived manner word remains the user\'s own action: '+roleManner)
  for(const methodAction of ['我整理了目录，按照老师要求发布了报告。','我整理了目录，按照老师要求发送了报告。']){
    const methodClauses=buildClauseCatalogue(methodAction)
    assert.equal(clauseReportsCompleted(methodClauses[1]!.text),true,methodAction+' keeps the complete long verb')
    assert.equal(selectStructuralCandidate(methodAction,methodClauses,ANCHOR)?.content.action,methodAction.slice(0,-1),methodAction+' remains one personal experience')
  }
  const nestedTemplateAuthor='我整理了目录，按照现有材料中王明完成的模板整理了报告。'
  assert.equal(selectStructuralCandidate(nestedTemplateAuthor,buildClauseCatalogue(nestedTemplateAuthor),ANCHOR)?.content.action,nestedTemplateAuthor.slice(0,-1),'the author of a method template cannot replace the outer user performer')
  const nestedTemplateWithOuterPerformer='我整理了目录，按照王明完成的模板由小李整理了报告。'
  assert.equal(selectStructuralCandidate(nestedTemplateWithOuterPerformer,buildClauseCatalogue(nestedTemplateWithOuterPerformer),ANCHOR)?.content.action,'我整理了目录','an explicit outer performer overrides the author of the referenced template')
  const directMethodPerformer='我整理了目录，按照分工王建中完成了报告。'
  assert.equal(selectStructuralCandidate(directMethodPerformer,buildClauseCatalogue(directMethodPerformer),ANCHOR)?.content.action,'我整理了目录','a direct named performer after a method prefix remains third-party')
  const directOpenMethodPerformer='我整理了目录，按照分工助教完成了报告。'
  assert.equal(selectStructuralCandidate(directOpenMethodPerformer,buildClauseCatalogue(directOpenMethodPerformer),ANCHOR)?.content.action,'我整理了目录','an open human performer after a generic method prefix remains third-party')
  const mixedTiming='我完成了报告并打算明天提交附录。'
  const mixedCandidate=selectStructuralCandidate(mixedTiming,buildClauseCatalogue(mixedTiming),ANCHOR)
  assert.equal(mixedCandidate?.content.action,'我完成了报告','a completed action survives while its future sibling stays out of experience content')
  const mixedConjunction='我完成了报告并且打算明天提交附录。'
  assert.equal(selectStructuralCandidate(mixedConjunction,buildClauseCatalogue(mixedConjunction),ANCHOR)?.content.action,'我完成了报告','并且 does not erase the completed sibling or include the future sibling')
  for(const futureSibling of ['我完成了报告并将提交附录。','我完成了报告并会提交附录。'])assert.equal(selectStructuralCandidate(futureSibling,buildClauseCatalogue(futureSibling),ANCHOR)?.content.action,'我完成了报告',futureSibling)
  for(const capabilitySibling of ['我完成了报告并可以提交附录。','我完成了报告并能够提交附录。','我完成了报告并能提交附录。'])assert.equal(selectStructuralCandidate(capabilitySibling,buildClauseCatalogue(capabilitySibling),ANCHOR)?.content.action,'我完成了报告',capabilitySibling)
  for(const futureSibling of ['我完成了报告并计划提交附录。','我完成了报告并准备提交附录。'])assert.equal(selectStructuralCandidate(futureSibling,buildClauseCatalogue(futureSibling),ANCHOR)?.content.action,'我完成了报告',futureSibling)
  for(const interviewThenPlan of ['我访谈了三位同学并计划提交报告。','我采访了三位同学并准备整理材料。'])assert.equal(selectStructuralCandidate(interviewThenPlan,buildClauseCatalogue(interviewThenPlan),ANCHOR)?.content.action,interviewThenPlan.split('并')[0],interviewThenPlan+' keeps only the completed interview')
  const interviewAfterCancellation='我取消了提交附录的计划并访谈了三位同学。'
  assert.deepEqual(buildClauseCatalogue(interviewAfterCancellation).map(clause=>clause.text),['我取消了提交附录的计划','访谈了三位同学'])
  assert.equal(selectStructuralCandidate(interviewAfterCancellation,buildClauseCatalogue(interviewAfterCancellation),ANCHOR)?.content.action,'访谈了三位同学','real work after a cancelled plan remains completed evidence')
  for(const futureSibling of ['我完成了报告然后计划提交附录。','我完成了报告随后准备提交附录。','我完成了报告接着将提交附录。'])assert.equal(selectStructuralCandidate(futureSibling,buildClauseCatalogue(futureSibling),ANCHOR)?.content.action,'我完成了报告',futureSibling)
  for(const futureSibling of ['我完成了报告现在计划提交附录。','我完成了报告目前准备提交附录。'])assert.equal(selectStructuralCandidate(futureSibling,buildClauseCatalogue(futureSibling),ANCHOR)?.content.action,'我完成了报告','an unpunctuated current-time transition keeps its future sibling out of experience: '+futureSibling)
  const lexicalCurrent='我完成了初稿体现在计划提交的版本里。'
  assert.deepEqual(buildClauseCatalogue(lexicalCurrent).map(clause=>clause.text),[lexicalCurrent.slice(0,-1)],'现在 inside 体现在 is not a sequence boundary')
  for(const futureSibling of ['我完成了报告但计划提交附录。','我完成了报告又计划提交附录。']){
    assert.equal(selectStructuralCandidate(futureSibling,buildClauseCatalogue(futureSibling),ANCHOR)?.content.action,'我完成了报告',futureSibling)
    assert.equal(clauseReportsCompleted(futureSibling),true,'the completed prefix remains usable without treating the planned sibling as performed')
  }
  for(const futureSibling of ['我完成了报告且计划提交附录。','我完成了报告同时计划提交附录。']){
    assert.equal(selectStructuralCandidate(futureSibling,buildClauseCatalogue(futureSibling),ANCHOR)?.content.action,'我完成了报告',futureSibling)
    assert.equal(clauseReportsCompleted(futureSibling),true,'only the completed prefix remains experience evidence')
  }
  for(const futureSibling of ['我完成了报告后准备提交附录。','我完成了报告后计划提交附录。'])assert.equal(selectStructuralCandidate(futureSibling,buildClauseCatalogue(futureSibling),ANCHOR)?.content.action,'我完成了报告',futureSibling)
  const openVocabularyFutureSibling='我完成报名后准备复习英语六级。'
  assert.equal(selectStructuralCandidate(openVocabularyFutureSibling,buildClauseCatalogue(openVocabularyFutureSibling),ANCHOR)?.content.action,'我完成报名','a post-completion plan cannot become experience merely because its verb is outside a finite action list')
  assert.equal(selectStructuralCandidate('我完成了报告并且我打算明天提交附录。',buildClauseCatalogue('我完成了报告并且我打算明天提交附录。'),ANCHOR)?.content.action,'我完成了报告','a repeated first-person subject stays on the future sibling')
  const lexical='我完成了分支合并会签流程。'
  assert.deepEqual(buildClauseCatalogue(lexical).map(clause=>clause.text),['我完成了分支合并会签流程'],'lexical 合并会签 stays one exact source clause')
  const lexicalPlan='我完成了合并计划提交前的核对。'
  assert.deepEqual(buildClauseCatalogue(lexicalPlan).map(clause=>clause.text),[lexicalPlan.replace('。','')],'lexical 合并计划 stays one exact source clause')
  assert.equal(selectStructuralCandidate(lexicalPlan,buildClauseCatalogue(lexicalPlan),ANCHOR)?.content.action,lexicalPlan.replace('。',''),'a lexical compound cannot truncate completed evidence')
  const nominalPlanTail='我完成了报告并计划提交前的核对。'
  assert.deepEqual(buildClauseCatalogue(nominalPlanTail).map(clause=>clause.text),[nominalPlanTail.slice(0,-1)])
  assert.equal(selectStructuralCandidate(nominalPlanTail,buildClauseCatalogue(nominalPlanTail),ANCHOR)?.content.action,nominalPlanTail.slice(0,-1))
  const relativePlanTail='我完成了并计划提交的报告。'
  assert.deepEqual(buildClauseCatalogue(relativePlanTail).map(clause=>clause.text),[relativePlanTail.slice(0,-1)])
  assert.equal(selectStructuralCandidate(relativePlanTail,buildClauseCatalogue(relativePlanTail),ANCHOR)?.content.action,relativePlanTail.slice(0,-1))
  const complementedRelativePlan='我核对了负责人制定并计划提交给导师的报告。'
  assert.deepEqual(buildClauseCatalogue(complementedRelativePlan).map(clause=>clause.text),[complementedRelativePlan.slice(0,-1)],'a planned predicate inside an object-relative phrase cannot fabricate a sibling clause')
  assert.equal(selectStructuralCandidate(complementedRelativePlan,buildClauseCatalogue(complementedRelativePlan),ANCHOR)?.content.action,complementedRelativePlan.slice(0,-1))
  const plannedRiskObject='我分析了团队延期并计划提交附录所带来的风险。'
  assert.deepEqual(buildClauseCatalogue(plannedRiskObject).map(clause=>clause.text),[plannedRiskObject.slice(0,-1)],'a planned predicate nominalized by 所带来的 remains inside the completed analysis object')
  assert.equal(selectStructuralCandidate(plannedRiskObject,buildClauseCatalogue(plannedRiskObject),ANCHOR)?.content.action,plannedRiskObject.slice(0,-1))
  const genuineComplementedPlan='我核对了报告并计划提交给导师。'
  assert.equal(selectStructuralCandidate(genuineComplementedPlan,buildClauseCatalogue(genuineComplementedPlan),ANCHOR)?.content.action,'我核对了报告','a genuine coordinated future action still stays out of completed evidence')
  const nestedFuture='我写了我将提交报告的计划说明。'
  assert.equal(selectStructuralCandidate(nestedFuture,buildClauseCatalogue(nestedFuture),ANCHOR)?.content.action,nestedFuture.slice(0,-1),'a future statement inside a completed document is not the outer action tense')
  const preparationWork='我准备工作完成了。'
  assert.equal(selectStructuralCandidate(preparationWork,buildClauseCatalogue(preparationWork),ANCHOR)?.content.action,preparationWork.slice(0,-1),'准备工作 is a completed nominal compound, not a future modal')
  for(const modifiedPlan of ['我准备认真完成报告。','我计划认真完成报告。']){
    assert.equal(clauseExpressesFuturePlan(modifiedPlan),true,'a manner modifier does not detach the governed action from its plan: '+modifiedPlan)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(modifiedPlan)),false,'a modified future plan cannot become completed experience: '+modifiedPlan)
  }
  assert.equal(clauseExpressesFuturePlan('我考虑尝试上次的方法。'),true,'consideration governs a prospective attempt in the shared plan authority')
  assert.equal(clauseExpressesFuturePlan('我正在考虑按上次方法访谈完三位学生后再反馈。'),true,'progressive consideration remains prospective for interview chronology')
  const completedThenConsidered='我完成了报告后考虑提交附录。'
  assert.deepEqual(buildClauseCatalogue(completedThenConsidered).map(clause=>clause.text),['我完成了报告','考虑提交附录'],'a temporal consideration sibling gets its own exact source clause')
  assert.equal(selectStructuralCandidate(completedThenConsidered,buildClauseCatalogue(completedThenConsidered),ANCHOR)?.content.action,'我完成了报告','considering a later submission cannot become completed experience')
  const lexicalConsideration='我完成了售后考虑因素分析。'
  assert.deepEqual(buildClauseCatalogue(lexicalConsideration).map(clause=>clause.text),[lexicalConsideration.slice(0,-1)],'后考虑 inside a completed lexical object is not a temporal sibling')
  assert.equal(selectStructuralCandidate(lexicalConsideration,buildClauseCatalogue(lexicalConsideration),ANCHOR)?.content.action,lexicalConsideration.slice(0,-1))
  const lexicalThenConsidered='我分析了售后考虑因素并考虑提交报告。'
  assert.deepEqual(buildClauseCatalogue(lexicalThenConsidered).map(clause=>clause.text),['我分析了售后考虑因素','考虑提交报告'],'every action-governing consideration is scanned after lexical occurrences')
  assert.equal(selectStructuralCandidate(lexicalThenConsidered,buildClauseCatalogue(lexicalThenConsidered),ANCHOR)?.content.action,'我分析了售后考虑因素','a later considered submission cannot enter completed analysis evidence')
  assert.equal(clauseExpressesFuturePlan('我在售后考虑因素上仍在考虑提交报告。'),true,'a lexical occurrence cannot hide a later action-governing consideration')
  const analyzedConsideration='我分析了是否考虑提交报告的风险。'
  assert.equal(clauseReportsCompleted(analyzedConsideration.slice(0,-1)),true,'nested consideration cannot erase the completed outer analysis')
  assert.equal(selectStructuralCandidate(analyzedConsideration,buildClauseCatalogue(analyzedConsideration),ANCHOR)?.content.action,analyzedConsideration.slice(0,-1),'the completed outer analysis remains exact experience evidence')
  const reorganizationPlan='我完成了撤并计划提交前的核对。'
  assert.deepEqual(buildClauseCatalogue(reorganizationPlan).map(clause=>clause.text),[reorganizationPlan.replace('。','')],'a nominal plan after a lexical 并 cannot corrupt the source span')
  assert.equal(selectStructuralCandidate(reorganizationPlan,buildClauseCatalogue(reorganizationPlan),ANCHOR)?.content.action,reorganizationPlan.replace('。',''))
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我通过学校邮箱联系导师是下一步。')),false,'a bare next step is not a past channel contact')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我通过学校邮箱发送报告是我的计划。')),false,'a trailing plan declaration cannot become a completed channel action')
  const plannedFuturePerfect='我在计划完成了报告后休息两天。'
  assert.equal(clauseReportsCompleted(plannedFuturePerfect.slice(0,-1)),false,'a completed-looking action governed by an ongoing plan remains prospective')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(plannedFuturePerfect)),false,'a future-perfect plan cannot become a personal experience')
  const terminalPlannedPerfect='我计划完成了报告。'
  assert.equal(clauseExpressesFuturePlan(terminalPlannedPerfect),true,'a terminal perfective-looking outcome remains governed by the unperformed plan')
  assert.equal(clauseReportsCompleted(terminalPlannedPerfect.slice(0,-1)),false,'a planned outcome cannot become completed experience merely through 了')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(terminalPlannedPerfect)),false)
  for(const progressivePlannedPerfect of ['我正在计划完成了报告。','我还在计划完成了报告。']){
    assert.equal(clauseExpressesFuturePlan(progressivePlannedPerfect),true,'an ongoing plan governs its terminal perfective-looking outcome: '+progressivePlannedPerfect)
    assert.equal(clauseReportsCompleted(progressivePlannedPerfect.slice(0,-1)),false,'ongoing planning is not completed experience: '+progressivePlannedPerfect)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(progressivePlannedPerfect)),false)
  }
  assert.equal(clauseReportsCompleted('我制定了计划并完成了报告。'.slice(0,-1)),true,'an independently completed outer plan and coordinated report remain real work')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我计划完成了报告后休息两天。')),false,'a bare governing plan also keeps the perfective-looking outcome prospective')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我有计划在完成了报告后再休息。')),false,'a natural 有计划在 construction keeps its governed completion prospective')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我有了一个在完成了报告后再休息的计划。')),false,'a completed plan-state wrapper cannot turn its governed outcome into completed experience')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我手里有一个完成了报告后再休息的计划。')),false,'a locative possession wrapper cannot turn its planned outcome into completed experience')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我手里有一个发布了报告后再休息的计划。')),false,'a relative-plan outcome is prospective regardless of its verb')
  assert.equal(clauseExpressesFuturePlan('我有准备完成报告的想法。'),true,'a possessed intention keeps its embedded completion prospective')
  assert.equal(clauseReportsCompleted('我有准备完成报告的想法'),false,'the embedded action in an intention is not completed experience')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我有准备完成报告的想法。')),false,'a possessed intention cannot enter the experience lane')
  assert.equal(clauseReportsCompleted('我还在做完成报告的准备'),false,'ongoing preparation for completion is not the completed report')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我还在做完成报告的准备。')),false,'ongoing preparation cannot become a completed experience through its object')
  assert.equal(clauseReportsCompleted('我完成了准备工作'),true,'actually completed preparation remains valid work')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我分析了发布了报告后再休息的计划。')),true,'independent completed analysis of a relative plan remains real work')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发送报告可能泄露隐私。')),false,'a risk description after an uninflected channel verb is not proof that the send happened')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我之前通过邮箱发送报告存在隐私风险。')),false,'a nominal risk predicate after an uninflected channel verb is not proof that the send happened')
  assert.equal(clauseReportsCompleted('我昨天通过邮箱发报告的计划被取消了。'),false,'a cancelled nominalized plan is not proof that its channel action happened')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发报告的计划被取消了。')),false)
  for(const cancelled of ['我昨天通过邮箱发送报告的计划被取消了。','我昨天通过邮箱提交报告的计划被取消了。','我昨天通过邮箱联系导师的计划被取消了。']){
    assert.equal(clauseReportsCompleted(cancelled.slice(0,-1)),false,cancelled)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(cancelled)),false,cancelled)
  }
  for(const rejectedIdea of ['我之前通过邮箱发送报告的想法被否决了。','我之前通过邮箱提交报告的设想被拒绝了。','我之前通过邮箱联系导师的提议被搁置了。']){
    assert.equal(clauseReportsCompleted(rejectedIdea.slice(0,-1)),false,rejectedIdea)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(rejectedIdea)),false,rejectedIdea)
  }
  const activeContactPlan='我之前通过邮箱联系导师的计划仍然有效。'
  assert.equal(clauseReportsCompleted(activeContactPlan.slice(0,-1)),false,'an active contact plan is not proof that contact happened')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(activeContactPlan)),false)
  for(const unchangedIdea of ['我昨天通过邮箱发送报告的想法还不成熟。','我之前通过微信联系导师的设想仍需讨论。']){
    assert.equal(clauseReportsCompleted(unchangedIdea.slice(0,-1)),false,unchangedIdea)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(unchangedIdea)),false,unchangedIdea)
  }
  const analyzedIdea='我分析了通过邮箱发送报告的想法。'
  assert.equal(selectStructuralCandidate(analyzedIdea,buildClauseCatalogue(analyzedIdea),ANCHOR)?.content.action,analyzedIdea.slice(0,-1),'a completed outer analysis remains an experience when its object is only an idea')
  const completedBeforeCancellation='我完成了报告并取消了提交附录的计划。'
  assert.equal(selectStructuralCandidate(completedBeforeCancellation,buildClauseCatalogue(completedBeforeCancellation),ANCHOR)?.content.action,'我完成了报告','cancelling a later plan cannot erase an independently completed action')
  const completedAfterCancellation='我取消了提交附录的计划并完成了报告。'
  assert.deepEqual(buildClauseCatalogue(completedAfterCancellation).map(clause=>clause.text),['我取消了提交附录的计划','完成了报告'])
  assert.equal(clauseReportsCompleted(completedAfterCancellation.slice(0,-1)),true,'a cancelled plan cannot erase a later independent completion')
  assert.equal(selectStructuralCandidate(completedAfterCancellation,buildClauseCatalogue(completedAfterCancellation),ANCHOR)?.content.action,'完成了报告')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(completedAfterCancellation)),true)
  for(const nonOwned of ['我取消了提交附录的计划并考虑完成报告。','我取消了提交附录的计划并让小王完成了报告。','我取消了提交附录的计划并完成了报告的是小王。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(nonOwned)),false,nonOwned)
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我完成报告是我的计划。')),false,'an uninflected completion inside a trailing plan declaration is still future')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我有一个完成报告的计划。')),false,'an outcome nested inside a possessed plan is not completed work')
  assert.equal(clauseExpressesFuturePlan('我有一份完成报告计划。'),true,'a compact possessed report plan remains prospective without a linking 的')
  assert.equal(clauseReportsCompleted('我有一份完成报告计划。'),false,'possessing a compact plan is not proof that its outcome happened')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我有一份完成报告计划。')),false,'a compact plan noun cannot become a completed star-map experience')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我通过学校邮箱发送报告。')),false,'an uninflected channel intention is not proof that the report was sent')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我完成报告是我今天唯一的计划。')),false,'a modified copular plan declaration is not completed experience')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我完成报告是我今天在课程项目最终答辩准备阶段经过导师确认后唯一需要执行的长期计划。')),false,'an arbitrarily long copular plan modifier fails closed as future')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我完成报告的计划。')),false,'a bare possessive planned outcome is not completed experience')
  const pastChannel='我昨天通过邮箱发送报告。'
  assert.equal(clauseReportsCompleted(pastChannel),true)
  assert.equal(clauseReportsPastAction(pastChannel),true,'past channel evidence has one completion authority')
  assert.equal(selectStructuralCandidate(pastChannel,buildClauseCatalogue(pastChannel),ANCHOR)?.content.action,pastChannel.slice(0,-1))
  for(const thirdPartyFailure of ['我昨天通过邮箱发送报告。后来助教发送失败了。','我昨天通过邮箱发送报告。后来助教再次发送失败了。'])assert.equal(selectStructuralCandidate(thirdPartyFailure,buildClauseCatalogue(thirdPartyFailure),ANCHOR)?.content.action,'我昨天通过邮箱发送报告','an uncatalogued third party failure cannot revoke the user-owned send: '+thirdPartyFailure)
  for(const artifactFailure of ['我昨天通过邮箱发送报告。后来邮件发送失败了。','我昨天通过邮箱发送报告。后来报告发送失败了。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(artifactFailure)),false,'a channel artifact is not a human performer and its linked failure revokes the unperfected send: '+artifactFailure)
  const cancelledBeforeSend='我昨天通过邮箱发送报告之前取消了行程。'
  assert.equal(clauseReportsCompleted(cancelledBeforeSend.slice(0,-1)),false,'a before-send temporal clause is not evidence that the send happened')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(cancelledBeforeSend)),false,'a cancelled later activity cannot manufacture an earlier channel contact')
  const cancelledDuringSend='我昨天通过邮箱发送报告时取消了发送。'
  assert.equal(clauseReportsCompleted(cancelledDuringSend.slice(0,-1)),false,'an interrupted in-progress send is not completed channel contact')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(cancelledDuringSend)),false,'cancelling during a send cannot manufacture completed experience')
  for(const interruptedSibling of ['我昨天通过邮箱发送报告时，我取消了发送。','我昨天通过邮箱发送报告，发送失败了。','我昨天通过邮箱发送报告，后来发送失败了。','我昨天通过邮箱提交报告，随后提交未成功。','我昨天通过邮箱发送报告，后来因为网络问题发送失败了。','我昨天通过邮箱发送报告，随后取消了这次发送报告。','我昨天通过邮箱发送报告，我取消了这次发送。','我昨天通过邮箱发报告，我取消了这次发报告。']){
    assert.equal(clauseReportsCompleted(interruptedSibling.slice(0,-1)),false,'a same-sentence interruption invalidates the unperfected channel action: '+interruptedSibling)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(interruptedSibling)),false,'comma splitting cannot hide a failed or cancelled channel action: '+interruptedSibling)
  }
  for(const interruptedNextSentence of ['我昨天通过邮箱发送报告。后来因为网络问题发送失败了。','我昨天通过邮箱发送报告。后来取消了这次发送。','我昨天通过邮箱发送报告。后来取消了这次发送报告。','我昨天通过邮箱发报告。后来情况变了，我取消了这次发报告。']){
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(interruptedNextSentence)),false,'an immediate next-sentence failure or cancellation invalidates the unperfected channel action: '+interruptedNextSentence)
  }
  for(const independentFailure of ['我昨天通过邮箱发送报告。导师后来发送失败了。','我昨天通过邮箱发送报告。后来导师那边发送失败了。','我昨天通过邮箱发送报告。后来老师这边发送失败了。','我昨天通过邮箱发送报告。今天我又发送失败了。']){
    assert.equal(selectStructuralCandidate(independentFailure,buildClauseCatalogue(independentFailure),ANCHOR)?.content.action,'我昨天通过邮箱发送报告','a third-party or separately timed attempt cannot revoke the earlier user send: '+independentFailure)
  }
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发报告。')),true,'a natural bare 发 in explicit past channel context is a completed report')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发报告。后来发失败了。')),false,'the matching natural bare 发 failure revokes the unperfected attempt')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发报告。后来这次发报告失败了。')),false,'a determiner before the matching bare 发 cannot hide the failed attempt')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发报告。后来这次头发护理失败了。')),true,'an unrelated noun containing 发 cannot revoke the send')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发送报告。后来发送并没有失败。')),true,'an explicitly negated next-sentence failure preserves the past send')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发送报告。后来并没有发送失败。')),true,'a pre-verbal negation of send failure preserves the past send')
  const deniedSend='我昨天通过邮箱发送报告需要审批，所以没发。'
  assert.equal(clauseReportsCompleted(deniedSend.slice(0,-1)),false,'the whole completion authority honors the later explicit non-send')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(deniedSend)),false,'a later explicit non-send revokes the unperfected channel action')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发送报告需要审批，所以没有把报告发出去。')),false,'an object-fronted explicit non-send revokes the unperfected channel action')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发送报告。后来没有把报告发错。')),true,'an object-fronted denial of a send error preserves the send')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发送报告需要审批，所以没联系。')),true,'a denial of another channel action cannot revoke the send')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发送报告。后来并没有发错。')),true,'denying a send error is not denying the send')
  assert.equal(selectStructuralCandidate('我昨天通过邮箱提交报告了。后来提交失败了。',buildClauseCatalogue('我昨天通过邮箱提交报告了。后来提交失败了。'),ANCHOR)?.content.action,'我昨天通过邮箱提交报告了','an object-final perfective marker preserves the earlier completed submission')
  for(const unrelatedNextAction of ['我昨天通过邮箱联系导师。后来提交失败了。','我昨天通过邮箱联系导师。后来发送失败了。','我昨天通过邮箱联系导师。后来取消了这次提交。']){
    assert.equal(selectStructuralCandidate(unrelatedNextAction,buildClauseCatalogue(unrelatedNextAction),ANCHOR)?.content.action,'我昨天通过邮箱联系导师','a different channel action cannot revoke the earlier contact: '+unrelatedNextAction)
  }
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发送了报告。后来因为网络问题发送失败了。')),true,'a later failed attempt cannot erase an explicitly perfective earlier send')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发报告了但联系失败了。')),true,'a different channel action failure cannot erase the object-final completed send')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我昨天通过邮箱发报告了并没有失败。')),true,'an explicitly negated failure preserves the object-final completed send')
  assert.equal(clauseReportsCompleted('我昨天通过邮箱发送前端报告。'),true,'the lexical word 前端 is not a before-send temporal marker')
  assert.equal(clauseReportsCompleted('我按照项目计划完成了报告。'),true,'a named plan is the method noun when an explicit completed action follows it')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我按照项目计划完成了报告。')),true)
  for(const completedMethod of ['我整理了目录，按照老师的要求做完了报告。','我整理了目录，按照老师的要求提交过报告。','我整理了目录，按照老师的要求整理好了附录。']){
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(completedMethod)),true,completedMethod)
    assert.ok(selectStructuralCandidate(completedMethod,buildClauseCatalogue(completedMethod),ANCHOR)?.content.action.includes('按照老师的要求'),completedMethod)
  }
  for(const prerequisite of ['我整理了目录，按照老师的要求完成了报告才可以提交。','我整理了目录，按照老师的要求做完报告后才能提交。','我整理了目录，按照老师的要求完成报告方可提交。']){
    const candidate=selectStructuralCandidate(prerequisite,buildClauseCatalogue(prerequisite),ANCHOR)
    assert.equal(candidate?.content.action,'我整理了目录',prerequisite)
  }
  const compactPrerequisite='我整理了目录后发现核对完数据才能提交。'
  assert.equal(selectStructuralCandidate(compactPrerequisite,buildClauseCatalogue(compactPrerequisite),ANCHOR)?.content.action,'我整理了目录','a compact prerequisite cannot erase the completed prefix or enter its action span')
  const prerequisiteRule='我整理了完成报告才能提交的规则。'
  assert.equal(selectStructuralCandidate(prerequisiteRule,buildClauseCatalogue(prerequisiteRule),ANCHOR)?.content.action,prerequisiteRule.slice(0,-1),'a prerequisite quoted inside a completed rule object does not erase the outer action')
  for(const completedOuter of ['我分析了取消计划的影响。','我分析了怎样才能提交的风险。'])assert.equal(selectStructuralCandidate(completedOuter,buildClauseCatalogue(completedOuter),ANCHOR)?.content.action,completedOuter.slice(0,-1),'an embedded plan or prerequisite cannot erase its completed outer action: '+completedOuter)
  const analyzedNextStep='我分析了哪项任务是下一步。'
  assert.equal(clauseExpressesFuturePlan(analyzedNextStep),false,'下一步 nested inside completed analysis is content, not the outer tense')
  assert.equal(selectStructuralCandidate(analyzedNextStep,buildClauseCatalogue(analyzedNextStep),ANCHOR)?.content.action,analyzedNextStep.slice(0,-1))
  for(const completedOuter of ['我复核了哪项任务是下一步。','我审阅了项目计划仍然有效。']){
    assert.equal(clauseExpressesFuturePlan(completedOuter),false,'an open-vocabulary completed audit cannot be erased by its plan-shaped object: '+completedOuter)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(completedOuter)),true,completedOuter)
  }
  for(const text of ['我通过学校邮箱发给导师一份报告。','我通过学校邮箱发到导师账号一份报告。','我通过学校邮箱发出去一份报告。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(text)),false,text+' has no completed aspect')
  assert.equal(selectStructuralCandidate('我通过学校邮箱发给了导师一份报告。',buildClauseCatalogue('我通过学校邮箱发给了导师一份报告。'),ANCHOR)?.content.action,'我通过学校邮箱发给了导师一份报告','an explicit completed aspect remains a performed contact')
  for(const obligation of ['我昨天通过邮箱应该联系导师。','我昨天通过邮箱需要联系导师。','我昨天通过邮箱本来要联系导师。']){
    assert.equal(clauseExpressesFuturePlan(obligation),true,obligation)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(obligation)),false,obligation+' is an unperformed obligation')
  }
  for(const nonExecution of ['我昨天通过邮箱无需发送报告。','我昨天通过邮箱无须发送报告。','我昨天通过邮箱不必发送报告。','我昨天通过邮箱不用发送报告。','我昨天通过邮箱没有必要发送报告。']){
    assert.equal(clauseReportsCompleted(nonExecution),false,nonExecution)
    assert.equal(clauseReportsPastAction(nonExecution),false,nonExecution)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(nonExecution)),false,nonExecution)
  }
  for(const proposal of ['我昨天通过邮箱拟发送报告。','我之前通过邮箱预计提交材料。','我拟于周五发布报告。','我预计下周上线产品。']){
    assert.equal(clauseExpressesFuturePlan(proposal),true,proposal)
    assert.equal(clauseReportsCompleted(proposal.slice(0,-1)),false,proposal)
    assert.equal(requiresExperienceCandidate(buildClauseCatalogue(proposal)),false,proposal+' is a proposal, not a past channel contact')
  }
  const analyzedProposal='我分析了预计发送报告的风险。'
  assert.equal(clauseExpressesFuturePlan(analyzedProposal),false,'a prospective object does not erase its completed outer analysis')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(analyzedProposal)),true)
  const unrelatedDenial='我否认了抄袭指控并完成了报告。'
  assert.equal(clauseReportsCompleted(unrelatedDenial.slice(0,-1)),true,'denying an accusation does not deny an independently coordinated completion')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(unrelatedDenial)),true)
  const simultaneousDenial='我否认了谣言同时完成了报告。'
  assert.equal(clauseReportsCompleted(simultaneousDenial.slice(0,-1)),true,'同时 starts an independent completion after the denied object')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(simultaneousDenial)),true)
  assert.equal(clauseReportsCompleted('我否认了小王整理并完成了报告。'.slice(0,-1)),false,'a named third party inside the denied predicate cannot become the user\'s completion')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我否认了小王整理并完成了报告。')),false)
  assert.equal(clauseReportsCompleted('我否认小王完成了报告。'.slice(0,-1)),false,'denying another person\'s predicate cannot become the user\'s work')
  assert.equal(clauseReportsCompleted('我否认了我整理并完成了报告。'.slice(0,-1)),false,'coordination inside an explicitly owned denied clause remains denied')
  const completedDeonticAnalysis='我昨天通过邮箱分析了应该联系导师的原因。'
  assert.equal(clauseReportsCompleted(completedDeonticAnalysis),true,'a completed outer analysis survives its deontic object')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我在会上计划完成报告。')),false,'a scene prefix does not turn a future plan into completed work')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('在图书馆我计划下周完成报告。')),false,'a location before the first-person actor cannot hide a future plan')
  assert.equal(clauseExpressesFuturePlan('在图书馆我计划下周完成报告。'),true)
  assert.equal(clauseReportsCompleted('在图书馆我计划下周完成报告。'),false)
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我在会上计划于下周完成报告。')),false,'计划于下周 remains future under a scene prefix')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我按照导师对本学期课程项目最终版本中的全部数据图表引用格式附录提出的详细要求计划完成报告。')),false,'a long same-clause prefix cannot hide a future plan')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我按照导师对本学期课程项目最终版本中的全部数据图表引用格式附录提出的详细要求会完成报告。')),false,'a long same-clause prefix cannot hide a future modal')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我在会上计划于周五完成报告。')),false,'计划于具体星期 remains future under a scene prefix')
  const completedPlanning='我已经计划好下周完成报告。'
  assert.equal(clauseExpressesFuturePlan(completedPlanning),true,'completing a plan does not complete its future outcome')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(completedPlanning)),false)
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我在会上计划于2026年11月2日完成报告。')),false,'计划于具体日期 remains future under a scene prefix')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我在会上计划在下周完成报告。')),false,'计划在下周 remains future under a scene prefix')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我在会上计划下周审核后发布报告。')),false,'a scene-prefixed plan remains future even when its immediate verb is outside a bounded action lexicon')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我通过学校邮箱了解到李老师发送了报告。')),false,'observing another performer through a channel is not the user\'s send')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我按照李老师要求完成报告。')),false,'an aspect-free instruction is not proof of completed work')
  const attributedMethod='我整理了目录，老师说，按照李老师要求完成了报告。'
  assert.deepEqual(personalActionClauses(buildClauseCatalogue(attributedMethod)).map(clause=>clause.text),['我整理了目录'],'an attribution boundary ends omitted-subject ownership before a method-owned instruction')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('老师说导师帮助我完成了报告。')),false,'reported assistance cannot become a user-authored experience')
  const taughtMethod='我整理了目录，按照李老师课堂讲解完成了报告。'
  assert.deepEqual(personalActionClauses(buildClauseCatalogue(taughtMethod)).map(clause=>clause.text),['我整理了目录','按照李老师课堂讲解完成了报告'],'following a teacher\'s explanation does not make the teacher the performer')
  assert.equal(selectStructuralCandidate('我会后提交了报告。',buildClauseCatalogue('我会后提交了报告。'),ANCHOR)?.content.action,'我会后提交了报告','会后 is a meeting-time noun, not a future modal')
  assert.equal(selectStructuralCandidate('我会前核对了材料。',buildClauseCatalogue('我会前核对了材料。'),ANCHOR)?.content.action,'我会前核对了材料','会前 is a meeting-time noun, not a future modal')
  assert.equal(selectStructuralCandidate('我会诊后写完了病例报告。',buildClauseCatalogue('我会诊后写完了病例报告。'),ANCHOR)?.content.action,'我会诊后写完了病例报告','会诊后 is a lexical activity, not a future modal')
  assert.equal(selectStructuralCandidate('我请李老师指导我完成了报告。',buildClauseCatalogue('我请李老师指导我完成了报告。'),ANCHOR)?.content.action,'我请李老师指导我完成了报告','guidance from another person does not erase explicitly self-performed work')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我了解到李老师帮助我联系的同学完成了报告。')),false,'a helper relation cannot cross into a later third-party performer')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我了解到李老师帮助我提交了报告。')),false,'an ambiguous helper-mediated submission stays out of self experience')
  assert.equal(selectStructuralCandidate('我整理了学生会提交的报名材料。',buildClauseCatalogue('我整理了学生会提交的报名材料。'),ANCHOR)?.content.action,'我整理了学生会提交的报名材料','学生会 is an organization noun, not a future modal')
  assert.equal(selectStructuralCandidate('我学会整理数据并完成了报告。',buildClauseCatalogue('我学会整理数据并完成了报告。'),ANCHOR)?.content.action,'我学会整理数据并完成了报告','lexical 学会 is learned ability, not a future modal')
  assert.equal(selectStructuralCandidate('我核对了合并计划完成情况。',buildClauseCatalogue('我核对了合并计划完成情况。'),ANCHOR)?.content.action,'我核对了合并计划完成情况','a lexical 合并计划 is not a future sibling')
  for(const planObject of ['我核对项目计划完成情况并写了报告。','我核对项目计划执行进度并写了报告。','我核对项目计划并写了报告。'])assert.equal(selectStructuralCandidate(planObject,buildClauseCatalogue(planObject),ANCHOR)?.content.action,planObject.slice(0,-1),'a plan noun inside the audited object cannot erase a later completed predicate: '+planObject)
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我核对计划并计划完成报告。')),false,'a later governing plan remains future even when an earlier plan token is the audited object')
  const unlistedPlanAudit='我审计了项目计划并写了报告。'
  assert.equal(selectStructuralCandidate(unlistedPlanAudit,buildClauseCatalogue(unlistedPlanAudit),ANCHOR)?.content.action,unlistedPlanAudit.slice(0,-1),'plan-object recognition does not depend on a finite audit-verb list')
  const nestedFutureProcess='我分析了我将提交报告的风险。'
  assert.equal(clauseReportsCompleted(nestedFutureProcess.slice(0,-1)),true,'a completed outer analysis survives its embedded future submission')
  assert.equal(selectStructuralCandidate(nestedFutureProcess,buildClauseCatalogue(nestedFutureProcess),ANCHOR)?.content.action,nestedFutureProcess.slice(0,-1))
  const nestedFutureActivity='我参加了我将提交报告的风险评审。'
  assert.equal(clauseReportsCompleted(nestedFutureActivity.slice(0,-1)),true,'a completed outer activity survives its embedded future submission')
  assert.equal(selectStructuralCandidate(nestedFutureActivity,buildClauseCatalogue(nestedFutureActivity),ANCHOR)?.content.action,nestedFutureActivity.slice(0,-1))
  const nestedFutureOther='我分析了团队将提交报告的风险。'
  assert.equal(clauseReportsCompleted(nestedFutureOther.slice(0,-1)),true,'a third-party embedded future does not erase the user\'s completed outer analysis')
  assert.equal(selectStructuralCandidate(nestedFutureOther,buildClauseCatalogue(nestedFutureOther),ANCHOR)?.content.action,nestedFutureOther.slice(0,-1))
  for(const lexicalAfter of ['我分析了幕后准备提交报告的风险。','我分析了售后让小王完成报告的流程。']){
    assert.deepEqual(buildClauseCatalogue(lexicalAfter).map(clause=>clause.text),[lexicalAfter.slice(0,-1)],'lexical 后 never becomes a temporal source boundary')
  }
  assert.equal(selectStructuralCandidate('我分析了幕后准备提交报告的风险。',buildClauseCatalogue('我分析了幕后准备提交报告的风险。'),ANCHOR)?.content.action,'我分析了幕后准备提交报告的风险')
  assert.equal(selectStructuralCandidate('我分析了售后让小王完成报告的流程。',buildClauseCatalogue('我分析了售后让小王完成报告的流程。'),ANCHOR),null,'an embedded third-party action may fail closed but cannot persist a truncated self fragment')
  assert.equal(selectStructuralCandidate('我分析了项目计划风险。',buildClauseCatalogue('我分析了项目计划风险。'),ANCHOR)?.content.action,'我分析了项目计划风险','a plan noun after completed analysis does not make the action future')
  assert.equal(selectStructuralCandidate('我完成的是我的计划。',buildClauseCatalogue('我完成的是我的计划。'),ANCHOR)?.content.action,'我完成的是我的计划','a completed cleft whose object is a plan remains completed work')
  assert.equal(selectStructuralCandidate('我完成了报告并计划提交附录也核对了合并计划。',buildClauseCatalogue('我完成了报告并计划提交附录也核对了合并计划。'),ANCHOR)?.content.action,'我完成了报告','a later lexical compound cannot hide the earlier completed sibling')
  assert.equal(selectStructuralCandidate('我准备了材料并提交了报告。',buildClauseCatalogue('我准备了材料并提交了报告。'),ANCHOR)?.content.action,'我准备了材料并提交了报告','completed 准备了 is not a future plan')
  assert.equal(selectStructuralCandidate('我准备完材料并提交了报告。',buildClauseCatalogue('我准备完材料并提交了报告。'),ANCHOR)?.content.action,'我准备完材料并提交了报告','completed 准备完 is not a future plan')
  assert.equal(selectStructuralCandidate('我准备不足但完成了报告。',buildClauseCatalogue('我准备不足但完成了报告。'),ANCHOR)?.content.action,'我准备不足但完成了报告','a preparation state cannot hide the completed action in the same report')
  assert.equal(selectStructuralCandidate('我准备充分并完成了报告。',buildClauseCatalogue('我准备充分并完成了报告。'),ANCHOR)?.content.action,'我准备充分并完成了报告','a positive preparation state is not a future modal')
  for(const venue of ['展会','峰会','年会','招聘会','发布会','运动会','研讨会'])assert.equal(selectStructuralCandidate(`我在${venue}提交了作品。`,buildClauseCatalogue(`我在${venue}提交了作品。`),ANCHOR)?.content.action,`我在${venue}提交了作品`,venue+' is a venue noun, not a future modal')
  for(const completedVenue of ['我在峰会写完了报告。','我在展会做完了报告。'])assert.equal(selectStructuralCandidate(completedVenue,buildClauseCatalogue(completedVenue),ANCHOR)?.content.action,completedVenue.slice(0,-1),completedVenue)
  assert.equal(selectStructuralCandidate('我请李老师指导我亲自提交了报告。',buildClauseCatalogue('我请李老师指导我亲自提交了报告。'),ANCHOR)?.content.action,'我请李老师指导我亲自提交了报告','explicit 亲自 performance outranks helper ambiguity')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我委托小王替我完成了报告。')),false,'delegated proxy work is not the user\'s experience')
  assert.equal(selectStructuralCandidate('我们会签了合同。',buildClauseCatalogue('我们会签了合同。'),ANCHOR)?.content.action,'我们会签了合同','lexical 会签 is completed work, not a future modal')
  assert.equal(selectStructuralCandidate('我已经完成了下一步的材料核对。',buildClauseCatalogue('我已经完成了下一步的材料核对。'),ANCHOR)?.content.action,'我已经完成了下一步的材料核对','下一步 inside an explicitly completed object is not a future plan')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('我打算下周交海报，还没做完。')),false,'plans are not experiences')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('如果我交了海报会怎样？')),false,'hypothetical question')
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue('今天天气不错。')),false)
  assert.equal(clauseReportsCompleted('比约好的时间晚了两天'),false,'lateness alone is not the action')
  assert.equal(clauseReportsCompleted('整套都交了'),true)
})

test('the structural candidate keeps the whole comma chain with verbatim fields',()=>{
  const text='上周五我把社团招新的推文和海报整套都交了，比约好的时间晚了两天，部长说整体效果还不错。'
  const candidate=selectStructuralCandidate(text,buildClauseCatalogue(text),ANCHOR)!
  assert.equal(candidate.quote,'上周五我把社团招新的推文和海报整套都交了，比约好的时间晚了两天，部长说整体效果还不错')
  assert.equal(candidate.content.action,'上周五我把社团招新的推文和海报整套都交了')
  assert.equal(candidate.content.result,'部长说整体效果还不错')
  assert.equal(candidate.content.occurredAt,'2026年10月2日（周五）')
})

test('reported lookup and reduced-question outcomes are retained as verbatim experience results',()=>{
  const examples=[
    {text:'最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。',result:'后来同学能直接找到两份材料，少问了我一次'},
    {text:'回来反馈：我把奖学金材料按三条规则整理了一次，第二天大约20秒找到通知，但目前只发生过一次。',result:'第二天大约20秒找到通知，但目前只发生过一次'},
  ]
  for(const example of examples){
    const candidate=selectStructuralCandidate(example.text,buildClauseCatalogue(example.text),ANCHOR)!
    assert.equal(candidate.content.result,example.result,example.text)
  }
})

test('saved real36 daily and repeated activities retain felt results without inventing their cause',()=>{
 const first='我是成年大学生，昨晚和室友打羽毛球后觉得轻松。请从生活体验聊起，不要加付款、采用、效率评分或职业标签。先问一个值得问的问题。'
 const repeat='回来反馈：一周后我又和同一个室友打了一次，仍然放松，但当天身体累所以提前结束。不要用一次疲惫推翻之前的感受。'
 for(const text of [first,repeat,'昨晚我打了球觉得轻松，后来身体累所以提前结束。']){
  const clauses=buildClauseCatalogue(text)
  assert.ok(requiresExperienceCandidate(clauses))
  const actual=selectStructuralCandidate(text,clauses,ANCHOR)!
  assert.ok(actual)
  assert.match(actual.content.result,/觉得轻松|仍然放松/)
  if(text.includes('后来身体累'))assert.match(actual.content.result,/后来身体累所以提前结束/)
  assert.ok(text.includes(actual.content.result),'stored result is a verbatim reported observation')
  assert.doesNotMatch(actual.content.result,/不要|原因|证明/)
 }
 for(const text of ['下周我想再和室友打一次球，可能会放松。','如果我和室友打了一次会怎样？','室友说他昨天打了一次球，仍然放松。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(text)),false,text)
})

test('model-named handles outside the selected span drop the field, never the candidate',()=>{
  const text='我负责做了一整套推文和海报，约好周五交、我周日才交过去'
  const catalogue=buildClauseCatalogue(text)
  const selection={quote:'约好周五交、我周日才交过去',start:text.indexOf('约好'),end:text.indexOf('过去')+2}
  const inside=resolveCandidateContent(catalogue,selection,{action:{clauseId:'c1'},result:{clauseId:'c2'}},ANCHOR)
  assert.deepEqual(inside,{content:{action:'约好周五交',result:'我周日才交过去',occurredAt:''},dropped:[]})
  const outside=resolveCandidateContent(catalogue,selection,{action:{clauseId:'c0'}},ANCHOR)
  assert.equal(outside.content.action,'')
  assert.deepEqual(outside.dropped,['action'])
})

test('structural category links quote verbatim fragments and stay adjustable',()=>{
  const links=deriveStructuralLinks('上周五我把社团招新的推文和海报整套都交了，比约好的时间晚了两天，部长说整体效果还不错')
  const ids=links.map(link=>link.valueId)
  assert.ok(ids.includes('value-creation'),'a delivered poster set is creative work')
  assert.ok(ids.includes('value-growth'),'explicit feedback and lateness feed growth')
  for(const link of links)assert.ok(link.reason.includes('「'),'the reason names the verbatim fragment it matched')
  assert.deepEqual(deriveStructuralLinks('今天天气不错'),[],'small talk categorizes nowhere')
})
