import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import type {PoolClient} from 'pg'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {pool,transaction} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {setMemorySettings,applyMemoryAction,loadSnapshot,getMemoryView,assertMemoryEvidence} from '../../server/memory.ts'
import {growthContext,createGrowthItem,growthMessageSourceLocations,applyGrowthAction} from '../../server/growth.ts'
import {deriveTurnContract,bindPlanBudgetSchema,bindMaterialDeliverySchema,taskOutcomeReadback,requestsSingleQuestionMaterial,requestedQuestionEditClauses,resolveRequestedQuestionEdit,questionEditMatchesMatter,selectedRequestedQuestionEditMemory,selectedRequestedQuestionEditMatter,selectedRequestedQuestionEditSource,interveningInterviewTexts,interviewContinuationRequest} from '../../server/turn-contract.ts'
import {requiresImmediateMaterial,deliverableIntent,invalidateCoachSources,coachEventView} from '../../server/action-coach-events.ts'
import {mentionedDirectionScopes,stageDirectionControls} from '../../server/growth-controls.ts'
import {buildClauseCatalogue} from '../../server/clause-catalogue.ts'
import {selectStructuralCandidate,clauseReportsCompleted} from '../../server/experience-content.ts'
import {parseActionCoachTurn,completeCoachJsonFrame} from '../../server/action-coach-contracts.ts'
import {boundedRecallReply} from '../../server/bounded-reply.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {readGuideUsage,readPriorGuideEvents} from '../../server/guide-usage.ts'
import {growthQuoteSuppressed,messageQuoteCorrected,coachSourceBoundaryRefs} from '../../server/growth-privacy.ts'
import {safeEarlySentence,openingQuestionDraft} from '../../server/reply-draft.ts'
import {buildTurnPrompt,providerTurnMessages,turnSystemPrompt} from '../../server/turn-prompt.ts'
import {boundedDistinctionReply} from '../../server/review-repairs.ts'
import {configureProviderPayload} from '../../server/model-payload.ts'
import {normalizeWeeklyPlanTasks,validateWeeklyPlanShape,renderProposedWeeklyPlan} from '../../server/weekly-plans.ts'
import {explicitCorrectionIntent,planExplicitCorrection} from '../../server/turn-obligations.ts'
import {linkExperienceToThemes} from '../../server/user-themes.ts'
import {campusView} from '../../server/campus.ts'
import {setProviderBudget} from '../../server/provider-spend.ts'
import {createAssistantMessageEventStream,fauxAssistantMessage,registerApiProvider,resetApiProviders,type StreamFunction} from '@mariozechner/pi-ai'

test('owned correction synonyms share the atomic correction-intent boundary',()=>{
  for(const text of ['把我的专业改回计算机科学与技术。','把我的专业改成计算机科学与技术。','将我的专业改为计算机科学与技术。'])assert.equal(explicitCorrectionIntent(text),true,text)
  const rewritePlan=planExplicitCorrection('把我的专业改回计算机科学与技术。',[{id:'major',revision:1,kind:'context',assertion:'user_reported',text:'我的专业是软件工程'}])
  assert.equal(rewritePlan?.newQuote,'把我的专业改回计算机科学与技术')
  assert.equal(rewritePlan?.target?.itemId,'major')
  const fromRewrite='把我的专业从软件工程改成计算机科学与技术。'
  assert.equal(explicitCorrectionIntent(fromRewrite),true)
  const fromRewritePlan=planExplicitCorrection(fromRewrite,[{id:'major',revision:1,kind:'context',assertion:'user_reported',text:'我的专业是软件工程'}])
  assert.equal(fromRewritePlan?.newQuote,'把我的专业从软件工程改成计算机科学与技术')
  assert.equal(fromRewritePlan?.target?.itemId,'major')
  const mismatchedFromPlan=planExplicitCorrection('把我的专业从电子信息工程改成计算机科学与技术。',[{id:'major',revision:1,kind:'context',assertion:'user_reported',text:'我的专业是软件工程'}])
  assert.equal(mismatchedFromPlan?.newQuote,'把我的专业从电子信息工程改成计算机科学与技术')
  assert.equal(mismatchedFromPlan?.target,undefined)
  const alternateMajorPlan=planExplicitCorrection('把我的专业改成计算机科学与技术。',[{id:'major',revision:1,kind:'context',assertion:'user_reported',text:'我是软件工程专业'}])
  assert.equal(alternateMajorPlan?.target?.itemId,'major')
  for(const text of ['把这段消息改短。','把我的简历改成一页版。','我的简历写错了，帮我改成一页版。','我的简历专业经历写错了，帮我改成项目经历。','我的专业经历写错了，帮我改成项目经历。','我的学校报告写错了，应该是两页。','实验数据记错了，改成42。','我想把我的专业改成计算机科学与技术，先帮我分析利弊。','把我的访谈问题改成上一次遇到什么困难。','把我的报告改成两页。','如果我要改专业怎么办？','“把我的专业改回计算机”只是示例。'])assert.equal(explicitCorrectionIntent(text),false,text)
  const birthday='我的生日记错了，应该是2004年5月1日。'
  assert.equal(explicitCorrectionIntent(birthday),true)
  const birthdayPlan=planExplicitCorrection(birthday,[{id:'birthday',revision:1,kind:'context',assertion:'user_reported',text:'我的生日是2003年5月1日'}])
  assert.equal(birthdayPlan?.newQuote,'我的生日记错了，应该是2004年5月1日')
  assert.equal(birthdayPlan?.target?.itemId,'birthday')
  const omittedBirthday='生日记错了，应该是2004年5月1日。'
  assert.equal(explicitCorrectionIntent(omittedBirthday),true)
  const omittedBirthdayPlan=planExplicitCorrection(omittedBirthday,[{id:'birthday',revision:1,kind:'context',assertion:'user_reported',text:'我的生日是2003年5月1日'}])
  assert.equal(omittedBirthdayPlan?.newQuote,'生日记错了，应该是2004年5月1日')
  assert.equal(omittedBirthdayPlan?.target?.itemId,'birthday')
  const qualifiedSchool='我的本科院校记错了，应该是四川大学。'
  assert.equal(explicitCorrectionIntent(qualifiedSchool),true)
  assert.equal(planExplicitCorrection(qualifiedSchool,[{id:'school',revision:1,kind:'context',assertion:'user_reported',text:'我的本科院校是成都理工大学'}])?.target?.itemId,'school')
  assert.equal(explicitCorrectionIntent('我的户籍所在地记错了，应该是成都。'),true)
  const qualifiedSchoolRewrite='把我的本科院校改成四川大学。'
  assert.equal(explicitCorrectionIntent(qualifiedSchoolRewrite),true)
  assert.equal(planExplicitCorrection(qualifiedSchoolRewrite,[{id:'school',revision:1,kind:'context',assertion:'user_reported',text:'我的本科院校是成都理工大学'}])?.target?.itemId,'school')
  for(const thirdPartyCorrection of [
    '我室友的生日记错了，应该是2004年5月1日。',
    '我同学的年龄记错了，应该是22岁。',
    '我朋友的姓名记错了，应该是小林。',
    '我老师的所在地记错了，应该是成都。',
    '我室友的每周可用时间记错了，应该是六小时。',
    '我的男朋友生日记错了，应该是2004年5月1日。',
    '我的伴侣所在地记错了，应该是成都。',
    '我姐姐的姓名记错了，应该是小林。',
    '我学校老师的年龄记错了，应该是45岁。',
    '我记错了室友的生日，应该是2004年5月1日。',
  ])assert.equal(explicitCorrectionIntent(thirdPartyCorrection),false,thirdPartyCorrection)
  assert.equal(planExplicitCorrection('我室友的生日记错了，应该是2004年5月1日。',[{id:'birthday',revision:1,kind:'context',assertion:'user_reported',text:'我的生日是2003年5月1日'}]),null)
  const separatedThirdParty='不对，我室友的生日记错了，应该是2004年5月1日。'
  assert.equal(explicitCorrectionIntent(separatedThirdParty),false)
  assert.equal(planExplicitCorrection(separatedThirdParty,[{id:'birthday',revision:1,kind:'context',assertion:'user_reported',text:'我的生日是2003年5月1日'}]),null)
  const describedSelf='我之前填写的生日记错了，应该是2004年5月1日。'
  assert.equal(explicitCorrectionIntent(describedSelf),true)
  assert.equal(planExplicitCorrection(describedSelf,[{id:'birthday',revision:1,kind:'context',assertion:'user_reported',text:'我的生日是2003年5月1日'}])?.target?.itemId,'birthday')
  const prefixedDescribedSelf='之前我填写的生日记错了，应该是2004年5月1日。'
  assert.equal(explicitCorrectionIntent(prefixedDescribedSelf),true)
  assert.equal(planExplicitCorrection(prefixedDescribedSelf,[{id:'birthday',revision:1,kind:'context',assertion:'user_reported',text:'我的生日是2003年5月1日'}])?.target?.itemId,'birthday')
  for(const polite of ['请把我的专业改成计算机科学与技术。','帮我把我的专业改回计算机科学与技术。']){
    assert.equal(explicitCorrectionIntent(polite),true,polite)
    assert.equal(planExplicitCorrection(polite,[{id:'major',revision:1,kind:'context',assertion:'user_reported',text:'我的专业是软件工程'}])?.target?.itemId,'major',polite)
  }
  const experienceCorrection='更正：我的项目经历不是参加竞赛，而是课程项目。'
  assert.equal(explicitCorrectionIntent(experienceCorrection),true)
  const experiencePlan=planExplicitCorrection(experienceCorrection,[{id:'project',revision:1,kind:'context',assertion:'user_reported',text:'我的项目经历是参加竞赛'}])
  assert.equal(experiencePlan?.newQuote,'更正：我的项目经历不是参加竞赛，而是课程项目')
  assert.equal(experiencePlan?.target?.itemId,'project')
  const naturalExperienceCorrection='我的项目经历记错了，应该是课程项目。'
  assert.equal(explicitCorrectionIntent(naturalExperienceCorrection),true)
  const naturalExperiencePlan=planExplicitCorrection(naturalExperienceCorrection,[{id:'project',revision:1,kind:'context',assertion:'user_reported',text:'我的项目经历是参加竞赛'}])
  assert.equal(naturalExperiencePlan?.newQuote,'我的项目经历记错了，应该是课程项目')
  assert.equal(naturalExperiencePlan?.target?.itemId,'project')
  const mixedCorrection='我的专业记错了应该是计算机科学与技术同时请把简历也同步修改。'
  assert.equal(explicitCorrectionIntent(mixedCorrection),true)
  const mixedCorrectionPlan=planExplicitCorrection(mixedCorrection,[{id:'major',revision:1,kind:'context',assertion:'user_reported',text:'我的专业是软件工程'}])
  assert.equal(mixedCorrectionPlan?.newQuote,'我的专业记错了应该是计算机科学与技术')
  assert.equal(mixedCorrectionPlan?.target?.itemId,'major')
  const mixedAlso='我的专业记错了应该是计算机科学与技术同时也请把简历同步修改。'
  const mixedAlsoPlan=planExplicitCorrection(mixedAlso,[{id:'major',revision:1,kind:'context',assertion:'user_reported',text:'我的专业是软件工程'}])
  assert.equal(mixedAlsoPlan?.newQuote,'我的专业记错了应该是计算机科学与技术')
  assert.equal(mixedAlsoPlan?.target?.itemId,'major')
  const mixedJiang='我的专业记错了应该是计算机科学与技术同时将简历改成一页。'
  const mixedJiangPlan=planExplicitCorrection(mixedJiang,[{id:'major',revision:1,kind:'context',assertion:'user_reported',text:'我的专业是软件工程'}])
  assert.equal(mixedJiangPlan?.newQuote,'我的专业记错了应该是计算机科学与技术')
  assert.equal(mixedJiangPlan?.target?.itemId,'major')
  const goalCorrection='记录中我的职业目标写错了，应该是考研。'
  assert.equal(explicitCorrectionIntent(goalCorrection),true)
  const goalPlan=planExplicitCorrection(goalCorrection,[{id:'goal',revision:1,kind:'goal',assertion:'user_reported',text:'我的职业目标是就业'}])
  assert.equal(goalPlan?.newQuote,'记录中我的职业目标写错了，应该是考研')
  assert.equal(goalPlan?.target?.itemId,'goal')
})

test('interview edit recall deduplicates one source and refuses cross-matter guessing',()=>{
  assert.deepEqual(requestedQuestionEditClauses('创业访谈，我想把访谈问题改成上次遇到什么困难，天气很好。').map(clause=>clause.text),['我想把访谈问题改成上次遇到什么困难'],'an unrelated declarative sibling is not persisted as part of the interview question')
  const selected=resolveRequestedQuestionEdit([
    {text:'我想把访谈问题改成上一次遇到什么困难',sourceId:'message-one'},
    {text:'我想把访谈问题改成上一次遇到什么',sourceId:'message-one'},
  ])
  assert.deepEqual(selected,{status:'selected',candidateCount:2,sourceCount:1,question:'上一次遇到什么困难',sourceId:'message-one'})
  const ambiguous=resolveRequestedQuestionEdit([
    {text:'我想把访谈问题改成上一次遇到什么困难',sourceId:'interview-a'},
    {text:'我想把访谈问题改成每周愿意投入多少时间',sourceId:'interview-b'},
  ])
  assert.deepEqual(ambiguous,{status:'ambiguous',candidateCount:2,sourceCount:2})
  const scoped=resolveRequestedQuestionEdit([
    {text:'求职访谈，我想把访谈问题改成最近一次投递卡在哪里',sourceId:'interview-job'},
    {text:'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',sourceId:'interview-startup'},
  ],'继续创业访谈，接下来应该怎么问？')
  assert.deepEqual(scoped,{status:'selected',candidateCount:1,sourceCount:1,question:'最近一次客户拒绝在哪一步',sourceId:'interview-startup'})
  const sameSourceItems=[
    {text:'我正在准备求职',sourceId:'same-message'},
    {text:'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',sourceId:'same-message'},
  ]
  const sameSourceResolution=resolveRequestedQuestionEdit(sameSourceItems,'继续创业访谈，接下来怎么问？')
  assert.equal(selectedRequestedQuestionEditMemory(sameSourceItems,sameSourceResolution,'继续创业访谈，接下来怎么问？')?.text,sameSourceItems[1]!.text)
  const sourceWithEarlierOccurrence='创业背景。后来我做了创业访谈。创业访谈，我想把访谈问题改成只问预算。'
  const rangedEditItems=[{text:sourceWithEarlierOccurrence,contextText:sourceWithEarlierOccurrence,sourceId:'ranged-edit',sourceOrder:0,createdAt:'2026-10-14T01:00:00.000Z'}]
  const rangedEditResolution=resolveRequestedQuestionEdit(rangedEditItems,'继续创业访谈，接下来怎么问？')
  assert.equal(selectedRequestedQuestionEditMemory(rangedEditItems,rangedEditResolution,'继续创业访谈，接下来怎么问？')?.sourceOrder,sourceWithEarlierOccurrence.indexOf('我想把访谈问题改成'),'the selected memory carries the selected edit clause offset, not merely its containing range offset')
  assert.deepEqual(selectedRequestedQuestionEditSource(rangedEditItems,rangedEditResolution,'继续创业访谈，接下来怎么问？'),{sourceId:'ranged-edit',sourceQuote:'我想把访谈问题改成只问预算',sourceRange:{start:sourceWithEarlierOccurrence.indexOf('我想把访谈问题改成'),end:sourceWithEarlierOccurrence.indexOf('我想把访谈问题改成')+'我想把访谈问题改成只问预算'.length}},'chronology authority covers only the winning edit clause')
  const revised=resolveRequestedQuestionEdit([{sourceId:'one-message',text:'我想把访谈问题改成最近一次遇到的困难是什么，以及当时为什么这样处理。把这个问题改成只问遇到了什么困难。'}])
  assert.deepEqual(revised,{status:'selected',candidateCount:2,sourceCount:1,question:'只问遇到了什么困难',sourceId:'one-message'})
  const multiClauseQuestion=resolveRequestedQuestionEdit([{sourceId:'multi-question',text:'创业访谈，我想把访谈问题改成你上次遇到什么困难，我可以提供什么帮助。'}],'继续创业访谈，接下来怎么问？')
  assert.deepEqual(multiClauseQuestion,{status:'selected',candidateCount:1,sourceCount:1,question:'你上次遇到什么困难，我可以提供什么帮助',sourceId:'multi-question'})
  const secondPersonQuestion=resolveRequestedQuestionEdit([{sourceId:'second-person-question',text:'创业访谈，我想把访谈问题改成你上次遇到什么困难，你当时怎么处理？'}],'继续创业访谈，接下来怎么问？')
  assert.deepEqual(secondPersonQuestion,{status:'selected',candidateCount:1,sourceCount:1,question:'你上次遇到什么困难，你当时怎么处理',sourceId:'second-person-question'},'a second-person follow-up remains part of the exact saved interview question')
  const naturalNextStep='继续创业访谈，下一步是什么？'
  assert.equal(interviewContinuationRequest(naturalNextStep),true)
  assert.deepEqual(resolveRequestedQuestionEdit([{sourceId:'next-step-question',text:'创业访谈，我想把访谈问题改成只问预算'}],naturalNextStep),{status:'selected',candidateCount:1,sourceCount:1,question:'只问预算',sourceId:'next-step-question'},'a natural next-step question still applies the saved interview edit')
  const explicitNewTopic='继续创业访谈，接下来问薪资。'
  assert.equal(interviewContinuationRequest(explicitNewTopic),false,'an explicit new topic cannot reuse the old saved question')
  assert.equal(questionEditMatchesMatter(explicitNewTopic,'创业访谈，我想把访谈问题改成只问预算。'),false,'a declarative new topic supersedes the saved question')
  const editThenMaterial=resolveRequestedQuestionEdit([{sourceId:'edit-then-material',text:'我想把访谈问题改成上一次遇到什么困难，并把简历改成一页版。'}])
  assert.deepEqual(editThenMaterial,{status:'selected',candidateCount:1,sourceCount:1,question:'上一次遇到什么困难',sourceId:'edit-then-material'})
  const editThenPlan=resolveRequestedQuestionEdit([{sourceId:'edit-then-plan',text:'我想把访谈问题改成上次遇到了什么困难，我明天去考试。'}])
  assert.deepEqual(editThenPlan,{status:'selected',candidateCount:1,sourceCount:1,question:'上次遇到了什么困难',sourceId:'edit-then-plan'})
  const splitRevisions=resolveRequestedQuestionEdit([
    {sourceId:'split-revisions',sourceOrder:0,text:'我想把访谈问题改成上一次遇到了什么困难以及原因'},
    {sourceId:'split-revisions',sourceOrder:40,text:'把这个问题改成遇到了什么困难'},
  ])
  assert.deepEqual(splitRevisions,{status:'selected',candidateCount:2,sourceCount:1,question:'遇到了什么困难',sourceId:'split-revisions'})
  const crossMessageRevision=[
    {conversationId:'startup-chat',sourceId:'startup-first',createdAt:'2026-10-14T01:00:00.000Z',text:'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步'},
    {conversationId:'startup-chat',sourceId:'startup-revision',createdAt:'2026-10-14T01:01:00.000Z',text:'把这个问题改成只问遇到了什么困难'},
  ]
  const crossMessageResolution=resolveRequestedQuestionEdit(crossMessageRevision,'继续创业访谈，接下来怎么问？')
  assert.deepEqual(crossMessageResolution,{status:'selected',candidateCount:2,sourceCount:1,question:'只问遇到了什么困难',sourceId:'startup-revision'})
  assert.equal(selectedRequestedQuestionEditMemory(crossMessageRevision,crossMessageResolution,'继续创业访谈，接下来怎么问？')?.text,crossMessageRevision[1]!.text)
  assert.equal(selectedRequestedQuestionEditMatter(crossMessageRevision,crossMessageResolution,'继续创业访谈，接下来怎么问？'),'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步','a revision keeps the inherited matter used by the final continuation guard')
  const duplicatedLatestRevision=[
    {conversationId:'startup-chat',sourceId:'startup-original',sourceOrder:0,createdAt:'2026-10-14T01:00:00.000Z',text:'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步'},
    {conversationId:'startup-chat',sourceId:'startup-latest',sourceOrder:0,createdAt:'2026-10-14T01:01:00.000Z',text:'把这个问题改成只问最近一次困难'},
    {conversationId:'startup-chat',sourceId:'startup-latest',sourceOrder:0,createdAt:'2026-10-14T01:01:00.000Z',text:'把这个问题改成只问最近一次困难'},
  ]
  assert.deepEqual(resolveRequestedQuestionEdit(duplicatedLatestRevision,'继续创业访谈，接下来怎么问？'),{status:'selected',candidateCount:3,sourceCount:1,question:'只问最近一次困难',sourceId:'startup-latest'})
  const crossConversationRevision=[
    {conversationId:'startup-chat',sourceId:'startup-original',createdAt:'2026-10-14T01:00:00.000Z',text:'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步'},
    {conversationId:'job-chat',sourceId:'job-original',createdAt:'2026-10-14T01:01:00.000Z',text:'求职访谈，我想把访谈问题改成最近一次投递卡在哪里'},
    {conversationId:'startup-chat',sourceId:'startup-revision',createdAt:'2026-10-14T01:02:00.000Z',text:'把这个问题改成只问遇到了什么困难'},
  ]
  const isolatedRevision=resolveRequestedQuestionEdit(crossConversationRevision,'继续创业访谈，接下来怎么问？')
  assert.deepEqual(isolatedRevision,{status:'selected',candidateCount:2,sourceCount:1,question:'只问遇到了什么困难',sourceId:'startup-revision'})
  assert.match(selectedRequestedQuestionEditMatter(crossConversationRevision,isolatedRevision,'继续创业访谈，接下来怎么问？')??'',/创业访谈/,'an unscoped revision inherits only inside its source conversation')
  const repeatedMatterRevision=resolveRequestedQuestionEdit([
    {sourceId:'startup-scoped-first',createdAt:'2026-10-14T01:00:00.000Z',text:'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步'},
    {sourceId:'startup-scoped-revision',createdAt:'2026-10-14T01:01:00.000Z',text:'创业访谈，把这个问题改成只问遇到了什么困难'},
  ],'继续创业访谈，接下来怎么问？')
  assert.deepEqual(repeatedMatterRevision,{status:'selected',candidateCount:2,sourceCount:1,question:'只问遇到了什么困难',sourceId:'startup-scoped-revision'})
  const ordinaryLastRevision=resolveRequestedQuestionEdit([
    {conversationId:'startup-chat',sourceId:'startup-last-one',createdAt:'2026-10-14T01:00:00Z',text:'创业访谈，我想把访谈问题改成上次遇到什么困难。'},
    {conversationId:'startup-chat',sourceId:'startup-last-two',createdAt:'2026-10-14T01:01:00Z',text:'创业访谈，把这个问题改成上次最难的是哪一步。'},
  ],'继续创业访谈，接下来怎么问？')
  assert.deepEqual(ordinaryLastRevision,{status:'selected',candidateCount:2,sourceCount:1,question:'上次最难的是哪一步',sourceId:'startup-last-two'},'same-matter edit declarations using 上次 select the latest revision')
  assert.equal(questionEditMatchesMatter('继续求职访谈，接下来应该怎么问？','我想把访谈问题改成上次在课程项目里遇到什么困难？'),false)
  assert.equal(questionEditMatchesMatter('继续求职访谈，接下来应该怎么问？','我想把访谈问题改成上次遇到什么困难？'),false)
  assert.equal(questionEditMatchesMatter('继续数据库课程访谈，接下来怎么问？','操作系统课程项目访谈，我想把访谈问题改成上次遇到什么困难？'),false)
  assert.equal(questionEditMatchesMatter('继续求职访谈，接下来怎么问？','创业访谈，我想把访谈问题改成你找工作时最困难的是什么？'),false)
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','操作系统课程项目访谈，我想把访谈问题改成课程里遇到什么困难？',['后来我做了求职访谈。']),false)
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['后来我做了一次访谈。']),false)
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['后来我做了创业访谈。']),false,'a later occurrence of the same named matter ends the old question binding')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','校园产品用户访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['后来我做了创业访谈。']),false)
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我整理了这次访谈记录。']),true)
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['后来我访谈了三位求职者。']),false)
  for(const report of ['后来我访谈过三位学生。','后来我访谈完三位学生。','后来我访谈好了三位学生。','后来我做过一次访谈。','后来我做完了创业访谈。','后来我做完创业访谈。','后来我把创业访谈做完了。'])assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',[report]),false,report+' is an actual interview occurrence')
  for(const report of ['我先整理了提纲，午饭后访谈了三位学生。','我先整理了提纲，下课后访谈了三位学生。','我先整理了提纲，项目结束后访谈了三位学生。'])assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',[report]),false,report+' keeps an event-relative time adjunct out of the performer slot')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我将创业访谈做完。']),true,'a future object-fronted completion cannot invalidate the saved question')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我已经按导师要求将创业访谈做完。']),false,'a leading completion adverb remains authoritative through a method phrase')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我将创业访谈做完了。']),false,'an explicitly perfective object-fronted completion supersedes the saved question')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['后来我访谈三位学生了。']),false,'object-before-aspect interview feedback ends the old question binding')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['后来我访谈三位产品经理了。']),false,'a human classifier keeps an open role head as a real interview occurrence')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['后来我把访谈三位学生的名单整理了。']),true,'a quantity-first interview preparation artifact cannot invalidate the saved question')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['后来我把访谈三位学生名单打印了。']),true,'an open-vocabulary artifact predicate cannot become an interview occurrence')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我为访谈三位学生准备好了。']),true,'preparing for quantified interviews cannot borrow 准备好了 as interview completion')
  for(const denied of ['后来我没做过任何访谈。','后来我没有进行过访谈。','后来我从未访谈过学生。','我否认我后来做了创业访谈。'])assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',[denied]),true,denied+' cannot manufacture a later interview occurrence')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我先整理了记录，后来做了求职访谈。']),false,'an omitted-subject continuation inherits the earlier self actor')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我先整理了提纲。后来做了求职访谈。']),false,'an immediate temporal continuation may inherit the user actor across a sentence boundary')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['导师访谈了三位求职者。']),true,'a third-party interview does not supersede the user\'s saved continuation')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我看到导师访谈了三位求职者。']),true,'a first-person observation wrapper cannot turn the observed performer into the user')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我整理了导师访谈了三位学生的记录。']),true,'a user-owned outer record does not turn its embedded mentor interview into the user\'s occurrence')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我在整理导师访谈了三位学生的记录。']),true,'an ongoing outer record keeps the mentor as the embedded interview performer')
  for(const openNestedActor of ['我陪助教看他做完了创业访谈。','我在整理助教访谈了三位学生的记录。','我整理了助教访谈了三位学生的记录。','我整理了助教访谈了三位学生的表格。'])assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',[openNestedActor]),true,'an open nested performer remains third-party: '+openNestedActor)
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我在整理我访谈了三位学生的记录。']),false,'an explicitly self-owned embedded interview still supersedes the saved question')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我整理了这份我访谈了三位学生的记录。']),false,'an intervening object cannot hide the explicit inner user interview')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我陪导师看他做完了创业访谈。']),true,'a user-owned observation cannot turn an object-final mentor interview into the user\'s occurrence')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我陪王建中看他做完了创业访谈。']),true,'a named third-party performer keeps the same nested observation boundary')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我整理完导师访谈了三位学生的记录。']),true,'a 完-marked outer record does not turn its embedded mentor interview into the user\'s occurrence')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我整理完导师访谈完三位学生的记录。']),true,'nested 完 aspects keep the mentor as the interview performer')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我看到助教访谈了三位学生。']),true,'an unlisted observed role cannot become the user performer')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我看到助教访谈了三位学生后，自己又访谈了两位学生。']),false,'an observed third-party interview cannot hide the user\'s later explicit interview')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我请导师指导我访谈了三位学生。']),false,'an explicitly guided self interview is still the user\'s later occurrence')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我先整理了提纲，后来由导师访谈了三位学生。']),true,'a passive third-party performer cannot inherit the preceding user actor')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我记录到导师访谈了三位学生。']),true,'recording a mentor interview cannot turn the mentor into the user')
  for(const protectedExample of ['我保存了示例“后来我做了创业访谈”。','我记录了代码`后来我做了创业访谈`。'])assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',[protectedExample]),true,'protected example text cannot become interview chronology: '+protectedExample)
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['导师帮助我做了创业访谈。']),false,'assisted self performance is still a later user interview')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['后来导师让我做了创业访谈。']),false,'a third party directing the user to perform is still the user occurrence')
  for(const directed of ['后来导师让我访谈完三位学生。','后来导师要求我做完创业访谈。'])assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',[directed]),false,'a directed self completion retains the user performer: '+directed)
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['后来我让导师做了创业访谈。']),true,'the user directing a third party cannot become a user occurrence')
  for(const report of ['后来我主持了一次创业访谈。','后来我开展了创业访谈。','后来我组织过一轮创业访谈。'])assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',[report]),false,report+' is an actual interview occurrence')
  for(const thirdParty of ['我先整理了提纲。后来另一个同学做了创业访谈。','我先整理了提纲。后来一位同学做了创业访谈。'])assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',[thirdParty]),true,'an explicitly qualified third-party actor cannot inherit the user performer: '+thirdParty)
  assert.equal(questionEditMatchesMatter('我主持了一次创业访谈，接下来怎么继续问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。'),false,'an interview completed in the current message supersedes the older saved question')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['我做了访谈问题整理。']),true,'editing interview material is not a newer interview occurrence')
  for(const retrospective of ['我做了一次用户访谈复盘。','我整理了用户访谈回顾。','我学习了用户访谈方法。'])assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',[retrospective]),true,'an interview artifact is not a new interview occurrence: '+retrospective)
  for(const retrospective of ['我做了访谈后的总结。','我做了访谈后的复盘。'])assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',[retrospective]),true,'a post-interview artifact is not a new interview occurrence: '+retrospective)
  for(const artifact of ['我参加了访谈培训。','我参加了访谈课程。','我参加了访谈讲座。'])assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',[artifact]),true,artifact+' is not an interview occurrence')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['后来我完成了访谈的总结。']),true,'completing an interview artifact is not a new interview occurrence')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',['后来我完成了访谈结果分析。']),true,'an interview result artifact is not a new interview occurrence')
  for(const artifact of ['后来我完成了访谈对象名单。','后来我完成了访谈招募表。','后来我完成了访谈邀约清单。'])assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。',[artifact]),true,'an open-ended interview preparation artifact is not a new interview occurrence: '+artifact)
  assert.equal(questionEditMatchesMatter('我上次做了访谈，接下来宿舍矛盾怎么处理？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。'),false)
  const mixedMatter='继续上次创业访谈，宿舍矛盾现在很严重，接下来怎么问？'
  assert.equal(interviewContinuationRequest(mixedMatter),false,'a valid continuation question cannot hide an unrelated declarative matter')
  assert.equal(questionEditMatchesMatter(mixedMatter,'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。'),false)
  assert.equal(questionEditMatchesMatter('继续创业访谈，接下来应该怎么问？','创业这边，我想把访谈问题改成最近一次遇到什么困难？'),true)
  assert.equal(questionEditMatchesMatter('请继续创业访谈，接下来怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。'),true)
  assert.equal(questionEditMatchesMatter('继续创业访谈，接下来怎么问？','创业访谈，我想把访谈问题改成只问预算。',['后来我做了求职访谈。']),true,'an explicitly unrelated later interview cannot disable the scoped startup edit')
  assert.equal(questionEditMatchesMatter('继续创业访谈，接下来怎么问？','创业访谈，我想把访谈问题改成只问预算。',['后来我做了创业访谈。']),false,'a later interview in the same explicit matter supersedes the old edit')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来怎么问？','创业访谈，我想把访谈问题改成只问预算。',['后来我做了求职访谈。']),false,'an unscoped continuation cannot guess which later interview was intended')
  assert.equal(questionEditMatchesMatter('继续创业访谈，接下来怎么问？','校园产品用户访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。'),false,'distinct explicit labels inside one broad domain never collide')
  assert.equal(questionEditMatchesMatter('继续上次的创业访谈，接下来怎么问？','创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。'),true)
  assert.equal(questionEditMatchesMatter('继续考研访谈，接下来怎么问？','英语四级访谈，我想把访谈问题改成最近一次错题卡在哪里。'),false)
  assert.equal(questionEditMatchesMatter('继续CET4访谈，接下来怎么问？','英语四级访谈，我想把访谈问题改成最近一次错题卡在哪里。'),true)
  assert.equal(questionEditMatchesMatter('继续高数访谈，接下来怎么问？','高等数学访谈，我想把访谈问题改成最近哪道题卡住。'),true)
  assert.equal(questionEditMatchesMatter('继续线代访谈，接下来怎么问？','线性代数访谈，我想把访谈问题改成最近哪道题卡住。'),true)
  assert.equal(questionEditMatchesMatter('继续考研访谈，接下来怎么问？','研究生访谈，我想把访谈问题改成最近一次复习卡在哪里。'),false,'a graduate-student participant label is not an exam-preparation alias')
  assert.equal(questionEditMatchesMatter('继续考公访谈，接下来怎么问？','公务员访谈，我想把访谈问题改成最近一次复习卡在哪里。'),false,'a civil-servant participant label is not an exam-preparation alias')
  assert.equal(questionEditMatchesMatter('继续考研访谈，接下来怎么问？','受访对象是研究生。研究生访谈，我想把访谈问题改成宿舍生活。'),false,'an explicit graduate-student participant cannot steal a postgraduate-exam interview edit')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？','我想把访谈问题改成上一次遇到什么困难？'),true)
  const contextualUnscopedEdit=[{sourceId:'startup-context-message',sourceOrder:5,contextText:'创业访谈，我想把访谈问题改成上一次遇到什么困难。',text:'我想把访谈问题改成上一次遇到什么困难。'}]
  assert.deepEqual(resolveRequestedQuestionEdit(contextualUnscopedEdit,'继续创业访谈，接下来怎么问？'),{status:'selected',candidateCount:1,sourceCount:1,question:'上一次遇到什么困难',sourceId:'startup-context-message'})
  const mixedItem=resolveRequestedQuestionEdit([{sourceId:'mixed-interviews',text:'求职访谈，我想把访谈问题改成最近一次投递卡在哪里。创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。'}],'继续求职访谈，接下来怎么问？')
  assert.deepEqual(mixedItem,{status:'selected',candidateCount:1,sourceCount:1,question:'最近一次投递卡在哪里',sourceId:'mixed-interviews'})
  const mixedSameSentence=resolveRequestedQuestionEdit([{sourceId:'mixed-one-sentence',text:'求职访谈，我想把访谈问题改成最近一次投递卡在哪里，创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。'}],'继续求职访谈，接下来怎么问？')
  assert.deepEqual(mixedSameSentence,{status:'selected',candidateCount:1,sourceCount:1,question:'最近一次投递卡在哪里',sourceId:'mixed-one-sentence'})
  const sameQuestionDifferentMatter=[
    {sourceId:'same-question-source',sourceOrder:0,text:'求职访谈，我想把访谈问题改成最近一次卡在哪里。'},
    {sourceId:'same-question-source',sourceOrder:50,text:'创业访谈，我想把访谈问题改成最近一次卡在哪里。'},
  ]
  const sameQuestionResolution=resolveRequestedQuestionEdit(sameQuestionDifferentMatter,'继续求职访谈，接下来怎么问？')
  assert.deepEqual(sameQuestionResolution,{status:'selected',candidateCount:1,sourceCount:1,question:'最近一次卡在哪里',sourceId:'same-question-source'})
  assert.equal(selectedRequestedQuestionEditMemory(sameQuestionDifferentMatter,sameQuestionResolution,'继续求职访谈，接下来怎么问？')?.text,sameQuestionDifferentMatter[0]!.text)
  const unscopedMixed=resolveRequestedQuestionEdit([{sourceId:'mixed-interviews',text:'求职访谈，我想把访谈问题改成最近一次投递卡在哪里。创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步。'}],'我想继续上次访谈，接下来怎么问？')
  assert.deepEqual(unscopedMixed,{status:'ambiguous',candidateCount:2,sourceCount:1})
  const closeRows=[
    {text:'求职访谈，我想把访谈问题改成最近一次投递卡在哪里',sourceId:'edit',createdAt:'2026-10-14T01:00:00.123400Z'},
    {text:'后来我做了创业访谈',sourceId:'later',createdAt:'2026-10-14T01:00:00.123900Z'},
  ]
  assert.deepEqual(interveningInterviewTexts(closeRows,closeRows[0]!),['后来我做了创业访谈'])
  const sameSourceRows=[
    {text:'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',sourceId:'one-message',createdAt:'2026-10-14T01:00:00.123400Z',sourceOrder:0},
    {text:'后来我做了求职访谈',sourceId:'one-message',createdAt:'2026-10-14T01:00:00.123900Z',sourceOrder:40},
  ]
  assert.deepEqual(interveningInterviewTexts(sameSourceRows,sameSourceRows[0]!),['后来我做了求职访谈'])
  const sameTimestampSourceRows=[
    {text:'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',sourceId:'one-message',createdAt:'2026-10-14T01:00:00Z',sourceOrder:0},
    {text:'后来我做了求职访谈',sourceId:'one-message',createdAt:'2026-10-14T01:00:00Z',sourceOrder:40},
  ]
  assert.deepEqual(interveningInterviewTexts(sameTimestampSourceRows,sameTimestampSourceRows[0]!),['后来我做了求职访谈'],'same-message source order resolves equal transaction timestamps')
  const earlierRows=[
    {text:'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',sourceId:'edit',createdAt:'2026-10-14T01:00:00.123900Z'},
    {text:'此前我做了求职访谈',sourceId:'earlier',createdAt:'2026-10-14T01:00:00.123100Z'},
  ]
  assert.deepEqual(interveningInterviewTexts(earlierRows,earlierRows[0]!),[])
  const equalRows=[
    {text:'此前我做了求职访谈',sourceId:'earlier',createdAt:'2026-10-14T01:00:00.123900Z'},
    {text:'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',sourceId:'edit',createdAt:'2026-10-14T01:00:00.123900Z'},
  ]
  assert.deepEqual(interveningInterviewTexts(equalRows,equalRows[1]!),['此前我做了求职访谈'],'equal timestamps from different sources remain conflicting evidence')
  assert.equal(questionEditMatchesMatter('我想继续上次访谈，接下来应该怎么问？',equalRows[1]!.text,interveningInterviewTexts(equalRows,equalRows[1]!)),false)
  const equivalentRows=[
    {text:'此前我做了求职访谈',sourceId:'earlier',createdAt:'2026-10-14T01:00:00.000Z'},
    {text:'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',sourceId:'edit',createdAt:'2026-10-14T01:00:00Z'},
  ]
  assert.deepEqual(interveningInterviewTexts(equivalentRows,equivalentRows[1]!),['此前我做了求职访谈'],'equivalent ISO timestamps from different sources remain conflicting evidence')
})

test('growth source location keeps message identity and offset on the same authoritative row',()=>{
  assert.deepEqual(growthMessageSourceLocations([
    {type:'message',id:'old-message',quote:'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',range:{start:3,end:29}},
    {type:'message',id:'revision-message',quote:'把这个问题改成只问遇到了什么困难'},
  ]),[
    {sourceId:'old-message',start:3,quote:'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',contextText:'   创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步'},
    {sourceId:'revision-message',quote:'把这个问题改成只问遇到了什么困难'},
  ])
  const duplicate='求职访谈，我想把访谈问题改成最近卡在哪里。创业访谈，我想把访谈问题改成最近卡在哪里。'
  assert.deepEqual(growthMessageSourceLocations([
    {type:'message',id:'duplicate-message',quote:'我想把访谈问题改成最近卡在哪里'},
  ],new Map([['duplicate-message',duplicate]])),[
    {sourceId:'duplicate-message',quote:'我想把访谈问题改成最近卡在哪里',ambiguous:true},
  ],'an identical quote without a stored range is never rebound to the first occurrence')
  const overlapping='把这个问题改成把这个问题改成把这个问题改成'
  assert.deepEqual(growthMessageSourceLocations([
    {type:'message',id:'overlapping-message',quote:'把这个问题改成把这个问题改成'},
  ],new Map([['overlapping-message',overlapping]])),[
    {sourceId:'overlapping-message',quote:'把这个问题改成把这个问题改成',ambiguous:true},
  ],'overlapping duplicate occurrences are also ambiguous')
  assert.deepEqual(growthMessageSourceLocations([
    {type:'message',id:'dated-message',quote:'把这个问题改成只问困难'},
  ],new Map([['dated-message','把这个问题改成只问困难。']]),new Map([['dated-message','2026-10-14T01:02:03.456Z']]),new Map([['dated-message','startup-chat']])),[
    {sourceId:'dated-message',quote:'把这个问题改成只问困难',start:0,contextText:'把这个问题改成只问困难',createdAt:'2026-10-14T01:02:03.456Z',conversationId:'startup-chat'},
  ],'each source message carries its own authoritative ordering and conversation identity')
  const privateNeighbor='创业访谈，我想把访谈问题改成只问困难；不要保留我的病情信息'
  const boundedQuote='我想把访谈问题改成只问困难',boundedStart=privateNeighbor.indexOf(boundedQuote)
  const boundedLocation=growthMessageSourceLocations([
    {type:'message',id:'private-neighbor',quote:boundedQuote,range:{start:boundedStart,end:boundedStart+boundedQuote.length}},
  ],new Map([['private-neighbor',privateNeighbor]]))[0]!
  assert.equal(boundedLocation.start,boundedStart)
  assert.ok(!boundedLocation.contextText?.includes('病情'),'neighboring unsaved or forgotten text never enters routing context')
  const mismatchedRange=growthMessageSourceLocations([
    {type:'message',id:'stale-range',quote:'创业访谈，我想把访谈问题改成只问困难',range:{start:0,end:22}},
  ],new Map([['stale-range','求职访谈，我想把访谈问题改成只问困难。创业访谈，我想把访谈问题改成只问困难。']]))[0]!
  assert.equal(mismatchedRange.ambiguous,true)
  assert.equal(mismatchedRange.start,undefined,'a stale source offset is never rebound to another matter')
  for(const source of [
    {type:'message' as const,id:'missing-ranged',quote:'创业访谈',range:{start:0,end:4}},
    {type:'message' as const,id:'missing-unranged',quote:'创业访谈'},
  ])assert.deepEqual(growthMessageSourceLocations([source],new Map()),[
    {sourceId:source.id,quote:source.quote,ambiguous:true},
  ],'an explicitly queried but missing source message is never authorized')
  const oversized=growthMessageSourceLocations([
    {type:'message',id:'oversized-range',quote:'x',range:{start:4294967296,end:4294967297}},
  ])[0]!
  assert.equal(oversized.ambiguous,true,'a persisted offset beyond the message contract fails closed without allocating its range')
  assert.equal(oversized.start,undefined)
  const longExact=growthMessageSourceLocations([
    {type:'message',id:'long-exact',quote:'ENDQUOTE'},
  ],new Map([['long-exact','x'.repeat(16001)+'ENDQUOTE']]))[0]!
  assert.equal(longExact.start,16001,'an exact authoritative source beyond a private context cap remains addressable')
  assert.equal(longExact.contextText?.slice(-8),'ENDQUOTE')
  const separatedMessage='创业访谈。求职访谈，我想把访谈问题改成最近一次投递卡在哪里'
  const editQuote='我想把访谈问题改成最近一次投递卡在哪里',editStart=separatedMessage.indexOf(editQuote)
  const separated=growthMessageSourceLocations([
    {type:'message',id:'separated-scopes',quote:'创业访谈',range:{start:0,end:4}},
    {type:'message',id:'separated-scopes',quote:editQuote,range:{start:editStart,end:editStart+editQuote.length}},
  ],new Map([['separated-scopes',separatedMessage]]))
  const separatedMemories=separated.map(location=>({sourceId:location.sourceId,text:location.quote,sourceOrder:location.start!,contextText:location.contextText!}))
  assert.match(separated[1]!.contextText!.slice(4,editStart),/。/,'a hidden gap remains a hard anonymous sentence boundary')
  assert.deepEqual(resolveRequestedQuestionEdit(separatedMemories,'继续创业访谈，接下来怎么问？'),{status:'none',candidateCount:0,sourceCount:0},'hidden conflicting matter text cannot bind the later edit to the earlier visible matter')
})

test('real mixed report keeps editing commands out of the experience and reads later progress',()=>{
  const text='我通过校内邮箱发了消息，他还没回复，把消息改短，别猜他没回复的原因。'
  const result=selectStructuralCandidate(text,buildClauseCatalogue(text),'2026-10-14T03:00:00Z')
  assert.equal(result?.quote,'我通过校内邮箱发了消息，他还没回复')
  const recall=boundedRecallReply('上次请教学长那件事，你目前知道实际做过什么？',[
    {text:'想向学长请教实习方向',createdAt:'2026-10-14T01:00:00Z'},
    {text:'还没联系过',createdAt:'2026-10-14T01:00:00Z'},
    {text:'我通过校内邮箱发了消息',createdAt:'2026-10-14T02:00:00Z'},
    {text:'他还没回复',createdAt:'2026-10-14T02:00:00Z'},
  ]).choices[0]!
  assert.ok(recall.includes('我通过校内邮箱发了消息'))
  assert.ok(!recall.includes('「还没联系过」'))
  const outcome=taskOutcomeReadback('我问了一个同学，也没人采用或付款。')
  assert.equal(outcome.adoption.status,'reported_not_used')
  assert.equal(outcome.payment.status,'reported_unpaid')
  assert.equal(outcome.effect.status,'unknown')
  assert.equal(clauseReportsCompleted('我问了一个同学'),true)
  assert.equal(clauseReportsCompleted('同学问了我'),false)
  assert.equal(clauseReportsCompleted('我打算问了再决定'),false)
  const contribution='我整理了资料，代码是队友做的。帮我写一段作品描述，不要扩写成收集全部资料或交付终版。'
  const experience=selectStructuralCandidate(contribution,buildClauseCatalogue(contribution),'2026-10-14T03:00:00Z')
  assert.equal(experience?.quote,'我整理了资料，代码是队友做的')
  assert.equal(experience?.content.action,'我整理了资料')
  const instruction='我在课程小组里负责整理资料和排版，代码是队友做的。帮我写一段只包含本人贡献的作品描述，不要扩写成收集全部资料或交付终版。'
  assert.equal(selectStructuralCandidate(instruction,buildClauseCatalogue(instruction),'2026-10-14T03:00:00Z'),null)
})

test('provider material metadata cannot authorize source or readiness',()=>{
  const mixed=parseActionCoachTurn(JSON.stringify({reply:'本人报告只负责整理资料和排版，本周还剩半小时；适配仍未知。',event:{target:{operation:'create',title:'岗位问题',source:{messageId:randomUUID(),quote:'帮我拟一个问题'}},action:{operation:'create',draft:{content:'请问我应先核对哪项公开岗位要求？'}}}}))
  assert.equal((mixed.event!.action as any).draft.content,'请问我应先核对哪项公开岗位要求？')
  assert.ok(mixed.reply.includes('本周还剩半小时'))
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:'',materialContext:'正文未到。',event:{action:{draft:{fromReply:true}}}})),/ACTION_COACH_OUTPUT_INVALID/)

  const singleBody={reply:'你好，方便请教一下实习方向吗？',event:{target:{operation:'create',title:'请教消息',source:{messageId:randomUUID(),quote:'帮我写一句消息'}},action:{operation:'create',draft:{fromReply:true}}}}
  const decoded=parseActionCoachTurn(JSON.stringify(singleBody))
  assert.deepEqual((decoded.event!.action as any).draft,{content:singleBody.reply})
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({...singleBody,reply:''})))
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({...singleBody,event:{...singleBody.event,action:{operation:'create',draft:{fromReply:true,content:'另一份正文'}}}})))
  const c=deriveTurnContract({text:'帮我写一句消息',knowledgeCount:0,currentEventExists:false,planIntent:false,material:true})
  assert.ok(!JSON.stringify(c.schema).includes('materialEvidence'))
  const interview=bindMaterialDeliverySchema(c,'帮我写一句访谈问题',false)
  assert.ok(!JSON.stringify(interview.schema).includes('resume_portfolio'))
  const result=parseActionCoachTurn(JSON.stringify({reply:'这里是简短消息。',event:{target:{operation:'create',title:'请教消息',source:{messageId:randomUUID(),quote:'帮我写一句消息'}},action:{operation:'create',draft:{content:'你好，方便请教一下吗？',readiness:'ready',materialEvidence:[{type:'invented_authority'}],materialFactIds:['fake']}}}}))
  const action=result.event!.action!
  assert.ok('draft'in action)
  assert.equal('materialEvidence'in action.draft,false)
  assert.equal('readiness'in action.draft,false)
})

test('first useful content skips politeness without skipping unsafe assertions',()=>{
  assert.equal(safeEarlySentence(JSON.stringify({reply:'消息已写好，你可以直接复制使用。'})),null)
  assert.equal(safeEarlySentence(JSON.stringify({reply:'消息已写好，你可以直接复制使用。尚未联系过对方时，先询问是否方便交流。'})),'尚未联系过对方时，先询问是否方便交流')
  assert.equal(safeEarlySentence(JSON.stringify({reply:'基于期末优先，我为你规划了一个轻量级方案。'})),null)
  assert.equal(safeEarlySentence(JSON.stringify({reply:'基于期末优先，我为你规划了一个轻量级方案。先给课程作业留一块时间，其余保留余量。'})),'先给课程作业留一块时间，其余保留余量')
  assert.equal(safeEarlySentence(JSON.stringify({reply:'收到。先给课程作业留一个小时间块，剩余时间保留缓冲。'})),'先给课程作业留一个小时间块，剩余时间保留缓冲')
  assert.equal(safeEarlySentence(JSON.stringify({reply:'好的，这是一条简短、礼貌且尊重对方时间的请教消息，你可以直接复制使用：\n\n'})),null)
  assert.equal(safeEarlySentence(JSON.stringify({reply:'这是一份简短的请教消息草稿，你可以直接复制使用。尚未联系过对方时，先询问是否方便交流。'})),'尚未联系过对方时，先询问是否方便交流')
  assert.equal(safeEarlySentence(JSON.stringify({reply:'已经替你发送了消息。还想聊什么？'})),null)
})

test('real natural requests bind material delivery without taking over review',()=>{
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'想请教一下，整理资料这类工作大概占多少比重？最核心产出是什么？'})),'想请教一下，整理资料这类工作大概占多少比重？')
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'可好？最核心产出是什么？'})),null)
  assert.equal(requiresImmediateMaterial('上次我的本人贡献和这周时间分别是什么？未知要求不要替我补。现在先就业探索，自由职业暂缓。再帮我拟一个向学长核对岗位要求的问题，不替我判断适合。'),true)
  assert.equal(requiresImmediateMaterial('他说：再帮我拟一个问题'),false)
  assert.equal(requiresImmediateMaterial('不要再帮我拟一个问题'),false)
  const pureText='我想先了解实习岗位，别把小组成果都算成我的能力。帮我写一段只包含本人贡献的作品描述。'
  const pure=bindMaterialDeliverySchema(deriveTurnContract({text:pureText,knowledgeCount:0,currentEventExists:true,planIntent:false,material:true}),pureText,true).schema as any
  assert.equal(pure.properties.event.properties.nodes,undefined,'a material intent already retained as source must not generate repeated process nodes')
  assert.equal(requestsSingleQuestionMaterial('先问一个同学就好，帮我写一句能问出最近一次选课经历的问题。'),true)
  assert.equal(requestsSingleQuestionMaterial('再帮我拟一个向学长核对岗位要求的问题。'),true)
  for(const text of ['先问一个问题厘清我说的自由。','请问我一个问题。','先问我一个值得问的问题。'])assert.equal(deliverableIntent(text,'create'),false,text)
  for(const text of ['我写了一个问题。','同学说帮我写一个问题。','“帮我写一个问题”是什么意思？'])assert.equal(requestsSingleQuestionMaterial(text),false,text)
  for(const text of ['帮我写一句简短的请教消息，不要替我发送。','帮我写一段只包含本人贡献的作品描述。','我通过校内邮箱发了消息，他还没回复，把消息改短，别猜他没回复的原因。']){
    assert.equal(deliverableIntent(text,'create'),true,text)
    assert.equal(requiresImmediateMaterial(text),true,text)
  }
  for(const text of ['填过表但卡住了，别重写。','同学说帮我写一句消息。','“帮我写一句消息”是什么意思？','帮我写一封邮件，但还不知道发给谁。'])assert.equal(requiresImmediateMaterial(text),false,text)
})

test('ordinary contract composes review, material and facts without competing modes',()=>{
  for(const text of ['填过表但卡住了，别重写','他没回复，把消息改短','我每周三小时，帮我安排并写一句消息']){
    const c=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:text.includes('安排'),material:text.includes('消息')})
    assert.equal(c.mode,'ordinary')
    assert.equal(c.capabilities.growth,true)
    assert.equal(c.capabilities.event,true)
    assert.equal(c.capabilities.material,true)
    assert.equal(c.capabilities.candidate,false,'star-map experience extraction is program-owned')
    assert.equal(c.capabilities.citations,false)
    assert.equal((c.schema.properties as any).reply.enum,undefined)
  }
  const c=deriveTurnContract({text:'我每周两小时，安排课程和备考',knowledgeCount:0,currentEventExists:false,planIntent:true,material:false})
  assert.ok(turnSystemPrompt('default','qwen3.8-flash',c,false).length<turnSystemPrompt('default','qwen3.8-flash',c).length,'ordinary replies omit irrelevant material instructions without changing capabilities')
  const s=bindPlanBudgetSchema(c,{minutes:120,period:'this_week'},'课程和备考').schema as any
  assert.equal(s.properties.weeklyPlan.properties.items.enum,undefined,'model chooses the actual tasks')
  assert.deepEqual(s.properties.weeklyPlan.properties.availableMinutes.enum,[120],'time binding remains authoritative')
  assert.equal(s.properties.reply.enum,undefined,'plan explanation stays naturally generated')
  assert.equal(s.properties.reply.maxLength,16000)
  const slack=bindPlanBudgetSchema(c,{minutes:120,period:'this_week'},'安排课程作业和复习，不要全排满').schema as any
  assert.ok(slack.properties.weeklyPlan.description.includes('合计至多119分钟'))
  assert.equal(slack.properties.weeklyPlan.properties.items.items.properties.minutes.maximum,119)
  assert.equal(slack.properties.weeklyPlan.properties.items.enum,undefined)
  const course=bindPlanBudgetSchema(c,{minutes:120,period:'this_week'},'安排课程作业和复习，不要全排满',[]).schema as any
  assert.equal(Object.keys(course.properties)[0],'weeklyPlan')
  assert.equal(course.properties.weeklyPlan.properties.items.items.properties.directionScopes.maxItems,0,'generic coursework cannot invent a degree direction')
  assert.deepEqual(course.properties.weeklyPlan.properties.items.items.properties.action.enum,['课程作业','复习'])
  assert.equal(course.properties.weeklyPlan.properties.items.maxItems,2)
  assert.deepEqual(mentionedDirectionScopes('期末课程优先，备考只保留少量时间。'),[])
  assert.deepEqual(mentionedDirectionScopes('我想先了解就业。'),['employment'])
  assert.deepEqual(mentionedDirectionScopes('同学说他想考研。我读过“专升本”的文章。'),[])
  assert.throws(()=>validateWeeklyPlanShape({target:{operation:'create'},availableMinutes:120,period:'this_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'create',minutes:60,directionScopes:[]}]}),{code:'WEEKLY_PLAN_INVALID'})
})

test('structured frame completion uses native JSON and never promotes an incomplete prefix',()=>{
  const frame=JSON.stringify({reply:'原文里有 } 和转义引号 "，仍保留完整。',growthUpdates:[]})
  assert.equal(completeCoachJsonFrame(frame+'\n```\n'+frame.repeat(3)),frame)
  assert.equal(completeCoachJsonFrame(frame.slice(0,-1)),null)
  assert.equal(completeCoachJsonFrame('解释文字'+frame),null)
  assert.equal(completeCoachJsonFrame('[{"reply":"不能把数组当响应"}]'),null)
  assert.equal(completeCoachJsonFrame('{"nested":{"reply":"还没结束"}'),null)
  assert.equal(completeCoachJsonFrame('{}\n{}'),'{}','invalid contract is framed then rejected by the existing validator')
})

test('single ordinary generation preserves mixed delivery and real transaction boundaries (simulated provider)',async t=>{
  await localEmbedding.start()
  const previous={url:model.baseUrl,key:config.apiKey},requests:any[]=[],outputs:unknown[]=[]
  let afterSyntheticFrame:(()=>void)|undefined,requestGuardProbe:(()=>void)|undefined
  const fake=createServer((req,res)=>{
    const chunks:Buffer[]=[]
    req.on('data',chunk=>chunks.push(Buffer.from(chunk)))
    req.on('end',()=>{
      requestGuardProbe?.()
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const queued=outputs.shift()
      const output=typeof queued==='function'?queued(requests.at(-1)):queued
      if(output===undefined){res.writeHead(500);res.end();return}
      const requiresAnswer=requests.at(-1).response_format?.json_schema?.schema?.required?.includes('answer')
      const encode=(frame:unknown)=>{
        if(!requiresAnswer||!frame||typeof frame!=='object'||Array.isArray(frame)||!('reply' in frame))return JSON.stringify(frame)
        const {reply,...metadata}=frame
        return JSON.stringify({answer:{deliver:reply},...metadata})
      }
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      const base={id:'ordinary-synthetic-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id}
      if(output&&typeof output==='object'&&'syntheticChunks'in output){
        const parts=[...(output as {syntheticChunks:string[]}).syntheticChunks]
        let index=0,timer:NodeJS.Timeout|undefined
        const writeNext=()=>{
          if(index<parts.length){res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:parts[index++]},finish_reason:null}]})+'\n\n');timer=setTimeout(writeNext,10);return}
          res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
        }
        writeNext();res.on('close',()=>{if(timer)clearTimeout(timer)});return
      }
      if(output&&typeof output==='object'&&('syntheticRepeatedFrame'in output||'syntheticHeldFrame'in output)){
        const repeated='syntheticRepeatedFrame'in output
        const frame=encode((output as any)[repeated?'syntheticRepeatedFrame':'syntheticHeldFrame'])
        res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:frame+(repeated?'\n```\n'+frame.repeat(3):'')},finish_reason:null}]})+'\n\n')
        afterSyntheticFrame?.()
        const timer=setTimeout(()=>res.end((repeated?'data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\n':'')+'data: [DONE]\n\n'),repeated?250:5000)
        res.on('close',()=>clearTimeout(timer))
        return
      }
      res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:encode(output)},finish_reason:null}]})+'\n\n')
      res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve))
  model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port
  config.apiKey='synthetic-ordinary-key'
  // Even an old diagnostic caller cannot turn failure into a second paid call.
  const engine=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{allowRepair:true,before(){},after(){}}})
  const user='ordinary-'+randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  const conversation=randomUUID()
  await store.createConversation(user,{id:conversation,title:'SYNTHETIC ordinary composition'})
  async function prepare(text:string,conversationId=conversation){
    const run=(await store.startRun(user,conversationId,randomUUID(),text)).run
    const staged:store.Staged={candidates:[],audit:[]}
    return {run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:(_event:Record<string,unknown>)=>{}}
  }
  let event:any
  try{
    await t.test('current stable memory retains its field semantics for a sourced follow-up',async()=>{
      const majorConversation=randomUUID();await store.createConversation(user,{id:majorConversation,title:'SYNTHETIC stable-memory question source'})
      const text='课程安排事项。我的专业是软件工程。',question='专业会影响下一步吗？',input=await prepare(text,majorConversation)
      let committed=false,memoryId:string|undefined
      try{
        outputs.push({reply:question,background:[{key:'education.major',value:'软件工程',source:{clauseId:'c1'}}],event:{target:{operation:'create',title:'课程安排事项',source:{clauseId:'c0'}},nodes:[{kind:'unknown',question}]}})
        const result=await engine(input)
        const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal);committed=true
        const memory=(await getMemoryView(user,majorConversation)).items.find(item=>item.key==='education.major')!;memoryId=memory.id
        assert.ok(saved.event?.asked.includes(question),'the stable-memory projection keeps the canonical field wording, not only its value')
        const revision=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=1',[user,saved.event!.id])).rows[0].snapshot
        assert.deepEqual(revision.questionBindings?.[0]?.sources.map((item:any)=>item.quote),['我的专业是软件工程'])
        await applyMemoryAction(user,memory.id,{requestId:randomUUID(),expectedRevision:memory.revision,action:'correct',value:'计算机科学'})
        assert.ok(!(await coachEventView(user,majorConversation,saved.event!.id))!.asked.includes(question),'correcting the exact stable fact retires its cross-session follow-up')
      }finally{
        if(!committed)await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_STABLE_MEMORY_CLEANUP')
        if(memoryId){const current=(await getMemoryView(user,majorConversation)).items.find(item=>item.id===memoryId);if(current)await applyMemoryAction(user,current.id,{requestId:randomUUID(),expectedRevision:current.revision,action:'forget'})}
        await store.deleteConversation(user,majorConversation)
      }
    })
    await t.test('historical Campus results fail closed when a persisted source range no longer matches its quote',async()=>{
      const campusConversation=randomUUID(),content='前文。我联系了导师。',inquiryId=randomUUID(),experimentId=randomUUID()
      await store.createConversation(user,{id:campusConversation,title:'SYNTHETIC malformed Campus source range'})
      const run=(await store.startRun(user,campusConversation,randomUUID(),content)).run,now=new Date().toISOString()
      const payload={domain:'life_goal',question:'验证历史来源',questionSource:{type:'message',id:run.source_message_id,quote:content},criteria:[],readiness:'act',questions:[],studentContext:[],pathways:[],opportunities:[],evidence:[],hypotheses:[],experiments:[{id:experimentId,status:'reported',action:'联系导师',createdAt:now,result:{text:'我联系了导师',source:{type:'message',id:run.source_message_id,quote:'我联系了导师',range:{start:0,end:4}},reportedAt:now}}],changes:[]}
      await pool.query('INSERT INTO campus_inquiries(id,user_id,conversation_id,payload) VALUES($1,$2,$3,$4)',[inquiryId,user,campusConversation,payload])
      const view=await campusView(user,campusConversation),inquiry=view.inquiries.find(item=>item.id===inquiryId)!
      assert.equal(inquiry.redactedForRevocation,true)
      assert.deepEqual(inquiry.payload.experiments,[])
      assert.equal(JSON.stringify(inquiry).includes('我联系了导师'),false)
      await store.terminateRun(user,run.request_id,'cancelled','SYNTHETIC_CLEANUP')
    })
    await t.test('historical Campus results fail closed after their exact source conversation is deleted',async()=>{
      const inquiryConversation=randomUUID(),sourceConversation=randomUUID(),question='验证跨会话结果',resultText='受访同学没有采用资料',inquiryId=randomUUID(),experimentId=randomUUID(),now=new Date().toISOString()
      await store.createConversation(user,{id:inquiryConversation,title:'SYNTHETIC Campus inquiry retained'})
      await store.createConversation(user,{id:sourceConversation,title:'SYNTHETIC Campus result deleted'})
      const inquiryRun=(await store.startRun(user,inquiryConversation,randomUUID(),question)).run
      const sourceRun=(await store.startRun(user,sourceConversation,randomUUID(),resultText)).run
      await store.finishRun(inquiryRun,{candidates:[],audit:[]},'已记录问题。',null,new AbortController().signal)
      await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录结果。',null,new AbortController().signal)
      const payload={domain:'life_goal',question,questionSource:{type:'message',id:inquiryRun.source_message_id,quote:question},criteria:[],readiness:'act',questions:[],studentContext:[],pathways:[],opportunities:[],evidence:[],hypotheses:[],experiments:[{id:experimentId,status:'reported',action:'询问同学',createdAt:now,result:{text:resultText,source:{type:'message',id:sourceRun.source_message_id,quote:resultText,range:{start:0,end:resultText.length}},reportedAt:now}}],changes:[]}
      await pool.query('INSERT INTO campus_inquiries(id,user_id,conversation_id,payload) VALUES($1,$2,$3,$4)',[inquiryId,user,inquiryConversation,payload])
      await store.deleteConversation(user,sourceConversation)
      const inquiry=(await campusView(user,inquiryConversation)).inquiries.find(item=>item.id===inquiryId)!
      assert.equal(inquiry.redactedForRevocation,true)
      assert.deepEqual(inquiry.payload.experiments,[])
      assert.equal(JSON.stringify(inquiry).includes(resultText),false)
    })
    await t.test('mixed judgment correction withholds model help until the correction commits',async()=>{
      const text='更正：同学少问一次只是结果，不代表我因此有成就感；我当时真正轻松的是自己不用反复找。只更新受影响的判断，给一个本周能开始的小动作。'
      const input=await prepare(text),frames:Record<string,unknown>[]=[]
      const lead='挑一份最近常翻的资料，先写三条分类规则。'
      const reply=lead+'只按这三条归档，到时可停；下次实际查找后记录是否少翻几轮。轻松来自自己不用反复找，同学少问一次不代表你的成就感，分类能否持续减少反复找仍未知。'
      outputs.push({lead,reply})
      const before=requests.length
      let committed=false
      try{
        const result=await engine({...input,emit:frame=>{frames.push(frame)}})
        assert.equal(requests.length-before,1)
        const native=input.staged.audit.find((entry:any)=>entry.phase==='provider_native_contract') as any
        assert.ok(!native.properties.includes('lead'),'reply streams directly without a duplicate lead field')
        const drafts=frames.filter(frame=>frame.type==='draft').map(frame=>String(frame.text??''))
        assert.deepEqual(drafts,[],'semantic independence cannot be proven before the correction transaction commits')
        assert.equal(result.text,reply)
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,input.run.request_id])).rows[0].n,0,'draft does not commit an assistant message')
        await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal);committed=true
      }finally{
        if(!committed)await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_UNCOMMITTED_CORRECTION')
      }
    })
    await t.test('a deictic judgment after an independent correction action waits for commit',async()=>{
      const text='把我的专业从软件工程改成计算机科学与技术，同时给我一个复习动作。'
      const input=await prepare(text),frames:Record<string,unknown>[]=[]
      const lead='挑一份最近常翻的资料，先写三条分类规则。',reply=lead+'这样更适合你。'
      outputs.push({reply})
      try{
        const result=await engine({...input,emit:frame=>{frames.push(frame)}})
        const drafts=frames.filter(frame=>frame.type==='draft').map(frame=>String(frame.text??''))
        assert.deepEqual(drafts,[],'all model output waits because a later deictic sentence can depend on the uncommitted correction')
        assert.equal(result.text,reply)
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,input.run.request_id])).rows[0].n,0)
      }finally{
        await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_UNCOMMITTED_DEICTIC_CORRECTION')
      }
    })
    await t.test('mixed correction never streams a write receipt before its transaction',async()=>{
      const text='更正：同学少问一次只是结果，不代表我因此有成就感；我当时真正轻松的是自己不用反复找。只更新受影响的判断，给一个本周能开始的小动作。'
      for(const receipt of ['更正好了：轻松来自自己不用反复找。','已完成更改。','已经纠正。','调整成功了。']){
        const input=await prepare(text),frames:Record<string,unknown>[]=[]
        const reply=receipt+'挑一份最近常翻的资料，先写三条分类规则；下次实际查找后记录是否少翻几轮。'
        outputs.push({reply})
        try{
          const result=await engine({...input,emit:frame=>{frames.push(frame)}})
          assert.equal(result.text,reply)
          assert.ok(!frames.some(frame=>frame.type==='draft'),`${receipt} stayed invisible before finishRun`)
          assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,input.run.request_id])).rows[0].n,0)
        }finally{
          await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_UNCOMMITTED_CORRECTION')
        }
      }
    })
    await t.test('owned correction synonyms never stream before their transaction',async()=>{
      for(const [text,reply] of [
        ['把我的专业改回计算机科学与技术。','已按你的更正处理，当前专业以计算机科学与技术为准。'],
        ['把我的专业改成计算机科学与技术，同时给我一个复习动作。','我已经把你的专业改为计算机科学与技术。先核对一道错题。'],
        ['把我的专业改成计算机科学与技术，同时给我一个复习动作。','你的专业现在是计算机科学与技术。先核对一道错题。'],
      ]){
        const input=await prepare(text),frames:Record<string,unknown>[]=[]
        outputs.push({reply})
        try{
          const result=await engine({...input,emit:frame=>{frames.push(frame)}})
          assert.equal(result.text,reply)
          assert.ok(!frames.some(frame=>frame.type==='draft'),'rewrite synonyms share the correction transaction boundary')
          assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,input.run.request_id])).rows[0].n,0)
        }finally{
          await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_UNCOMMITTED_CORRECTION_SYNONYM')
        }
      }
    })
    await t.test('semantic course advice cannot escape when a concurrent edit makes the correction stale',async()=>{
      const baseline=await createGrowthItem(user,{requestId:randomUUID(),conversationId:conversation,kind:'context',text:'我的专业是软件工程'})
      const input=await prepare('把我的专业从软件工程改成计算机科学，同时给我课程建议。'),frames:Record<string,unknown>[]=[]
      const reply='更适合优先学习算法基础。'
      outputs.push({reply})
      let concurrent=baseline
      try{
        const result=await engine({...input,emit:frame=>{frames.push(frame)}})
        concurrent=await transaction(c=>applyGrowthAction(c,user,baseline.id,{requestId:randomUUID(),expectedRevision:baseline.revision,action:'correct',text:'我的专业是信息工程'}))
        assert.deepEqual(frames.filter(frame=>frame.type==='draft'),[],'advice derived from the pending value stays invisible before commit')
        await assert.rejects(store.finishRun(input.run,input.staged,result.text,result.usage,input.signal),(error:any)=>['GROWTH_SNAPSHOT_INVALIDATED','GROWTH_REVISION_CONFLICT'].includes(error?.code),'the concurrent edit makes the prepared correction fail rather than saving stale advice')
      }finally{
        await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_STALE_CORRECTION').catch(()=>{})
        await transaction(c=>applyGrowthAction(c,user,baseline.id,{requestId:randomUUID(),expectedRevision:concurrent.revision,action:'forget'})).catch(()=>{})
      }
    })
    await t.test('an explicit no-record instruction suppresses every experience lane',async()=>{
      const input=await prepare('我完成了报告，但不要记录这件事。')
      const reply='这件事只在当前回复中使用，不写入个人记录。'
      outputs.push({reply})
      try{
        const result=await engine(input)
        assert.equal(result.text,reply)
        assert.deepEqual(input.staged.candidates,[],'the structural compatibility lane cannot bypass the privacy instruction')
        assert.deepEqual(input.staged.growth?.changes??[],[])
      }finally{
        await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_NO_RECORD')
      }
    })
    await t.test('source-less derived growth cannot supersede a user-sourced interview edit',async()=>{
      const actor='interview-authority-'+randomUUID(),sourceChat=randomUUID(),nextChat=randomUUID(),sourceText='创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',question='最近一次客户拒绝在哪一步',signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC authoritative interview edit'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已按你的原话记录访谈问题。',null,signal)
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now()-interval '2 minutes',now()-interval '2 minutes')",[randomUUID(),actor,sourceChat,sourceText,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:sourceText,range:{start:0,end:sourceText.length}}])])
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'observation',$4,'ai_observation','active','[]','[]',now()-interval '1 minute',now()-interval '1 minute')",[randomUUID(),actor,sourceChat,'后来我做了求职访谈'])
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC authoritative interview continuation'})
        const current='继续上次创业访谈。',run=(await store.startRun(actor,nextChat,randomUUID(),current)).run,staged:store.Staged={candidates:[],audit:[]}
        outputs.push((request:any)=>({reply:request.response_format.json_schema.schema.properties.reply?.enum?.[0]??'继续核对原访谈。'}))
        const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
        const diagnostic={result:result.text,audit:staged.audit.filter((entry:any)=>entry.phase==='edited_interview_route'),growth:(await growthContext(actor,nextChat)).map(item=>({id:item.id,text:item.text,assertion:item.assertion,sources:item.sources}))}
        assert.match(result.text,new RegExp(question),'a derived item without a user message cannot invalidate the saved edit: '+JSON.stringify(diagnostic))
        assert.ok(staged.audit.some((entry:any)=>entry.phase==='edited_interview_route'&&entry.selectedSourceId===sourceRun.source_message_id&&entry.continuation===true))
        await store.finishRun(run,staged,result.text,result.usage,signal)
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('separately persisted source clauses retain their authorized interview matter',async()=>{
      const actor='interview-split-source-'+randomUUID(),sourceChat=randomUUID(),nextChat=randomUUID(),sourceText='创业访谈：我想把访谈问题改成上次遇到什么困难',label='创业访谈',edit='我想把访谈问题改成上次遇到什么困难',question='上次遇到什么困难',signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC split interview source'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已按你的原话记录访谈问题。',null,signal)
        for(const [quote,start] of [[label,0],[edit,sourceText.indexOf(edit)]] as const)await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now()-interval '2 minutes',now()-interval '2 minutes')",[randomUUID(),actor,sourceChat,quote,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote,range:{start,end:start+quote.length}}])])
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC split interview continuation'})
        const current='继续上次创业访谈。',run=(await store.startRun(actor,nextChat,randomUUID(),current)).run,staged:store.Staged={candidates:[],audit:[]}
        outputs.push((request:any)=>({reply:request.response_format.json_schema.schema.properties.reply?.enum?.[0]??'继续核对原访谈。'}))
        const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
        const route=staged.audit.find((entry:any)=>entry.phase==='edited_interview_route') as any
        assert.match(result.text,new RegExp(question),JSON.stringify({result:result.text,route}))
        assert.equal(route?.continuation,true,JSON.stringify(route))
        await store.finishRun(run,staged,result.text,result.usage,signal)
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('a concurrent forget cannot expose or commit a selected interview question',async()=>{
      const actor='interview-concurrent-forget-'+randomUUID(),sourceChat=randomUUID(),nextChat=randomUUID(),sourceText='创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',question='最近一次客户拒绝在哪一步',signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let run:store.Run|undefined
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC concurrent-forget source'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已按你的原话记录访谈问题。',null,signal)
        const item=(await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now()-interval '1 minute',now()-interval '1 minute') RETURNING id,revision",[randomUUID(),actor,sourceChat,sourceText,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:sourceText,range:{start:0,end:sourceText.length}}])])).rows[0]
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC concurrent-forget continuation'})
        const current='继续上次创业访谈。';run=(await store.startRun(actor,nextChat,randomUUID(),current)).run
        const staged:store.Staged={candidates:[],audit:[]},frames:Record<string,unknown>[]=[],racingEngine=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{
          before:async()=>{await transaction(c=>applyGrowthAction(c,actor,item.id,{requestId:randomUUID(),expectedRevision:item.revision,action:'forget'}))},
          after:async()=>{},
        }})
        const beforeRequests=requests.length
        const beforeOutputs=outputs.length
        outputs.push((request:any)=>({reply:request.response_format.json_schema.schema.properties.reply?.enum?.[0]??question}))
        try{
          await assert.rejects(racingEngine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:frame=>frames.push(frame)}),(error:any)=>error?.code==='GROWTH_SNAPSHOT_INVALIDATED')
        }finally{outputs.splice(beforeOutputs)}
        assert.equal(requests.length-beforeRequests,0,'a forgotten source is rejected before provider dispatch or billing')
        assert.ok(!frames.some(frame=>frame.type==='draft'&&String(frame.text??'').includes(question)),'a forgotten question is never exposed as an unsaved SSE draft: '+JSON.stringify(frames))
        assert.equal((await pool.query("SELECT count(*)::int n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[actor,run.request_id])).rows[0].n,0,'the stale reply never commits')
      }finally{
        if(run)await store.terminateRun(actor,run.request_id,'cancelled','SYNTHETIC_CONCURRENT_FORGET').catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('provider transport cannot start before the dispatch fence is acquired',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC pre-transport fence'})
      const input=await prepare('我今天想聊一下课程。',chat),beforeRequests=requests.length
      const oldBudget={enabled:config.providerBudgetEnabled,id:config.providerBudgetId},budgetId='synthetic-dispatch-order-'+randomUUID()
      let gate:PoolClient|undefined,pending:ReturnType<typeof engine>|undefined,committed=false
      try{
        config.providerBudgetEnabled=true;config.providerBudgetId=budgetId;await setProviderBudget(budgetId,10)
        const orderingEngine=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{
          before:async()=>{gate=await pool.connect();await gate.query('BEGIN');await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])},
          after:async()=>{},
        }})
        outputs.push((request:any)=>({reply:request.response_format.json_schema.schema.properties.reply?.enum?.[0]??'你想先聊课程里的哪件事？'}))
        pending=orderingEngine(input)
        let reservationCommitted=false
        for(let index=0;index<200;index++){
          reservationCommitted=Number((await pool.query("SELECT count(*)::int AS n FROM lifeos_provider_spend WHERE user_id=$1 AND request_id=$2 AND status='reserved'",[user,input.run.request_id])).rows[0].n)===1
          if(reservationCommitted)break
          await new Promise(resolve=>setTimeout(resolve,5))
        }
        assert.equal(reservationCommitted,true,'the short spend transaction commits before the long-lived source fence can consume a pool client')
        let pendingSettled=false
        void pending.then(()=>{pendingSettled=true},()=>{pendingSettled=true})
        await new Promise(resolve=>setTimeout(resolve,50))
        assert.equal(pendingSettled,false,'the model call keeps retrying the canonical non-blocking account fence')
        assert.equal(requests.length,beforeRequests,'the HTTP transport has not started while the dispatch fence is pending')
        const heldGate=gate
        assert.ok(heldGate)
        await heldGate.query('COMMIT');heldGate.release();gate=undefined
        const result=await pending
        assert.equal(requests.length,beforeRequests+1,'one request starts only after the fence is held')
        await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal);committed=true
      }finally{
        if(gate){await gate.query('ROLLBACK').catch(()=>{});gate.release()}
        await pending?.catch(()=>{})
        if(!committed)await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_PRE_TRANSPORT_FENCE').catch(()=>{})
        config.providerBudgetEnabled=oldBudget.enabled;config.providerBudgetId=oldBudget.id
        await pool.query('DELETE FROM lifeos_provider_spend WHERE budget_id=$1',[budgetId])
        await pool.query('DELETE FROM lifeos_provider_budgets WHERE id=$1',[budgetId])
      }
    })
    await t.test('an abort after reservation but before transport releases a proven-unsent spend',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC pre-transport abort'})
      const input=await prepare('我想继续聊课程。',chat),beforeRequests=requests.length,controller=new AbortController()
      const oldBudget={enabled:config.providerBudgetEnabled,id:config.providerBudgetId},budgetId='synthetic-pre-transport-abort-'+randomUUID()
      let gate:PoolClient|undefined,pending:ReturnType<typeof engine>|undefined
      try{
        config.providerBudgetEnabled=true;config.providerBudgetId=budgetId;await setProviderBudget(budgetId,10)
        const abortEngine=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{
          before:async()=>{gate=await pool.connect();await gate.query('BEGIN');await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])},
          after:async()=>{},
        }})
        pending=abortEngine({...input,signal:controller.signal})
        let reserved=false
        for(let index=0;index<200;index++){
          reserved=(await pool.query("SELECT status FROM lifeos_provider_spend WHERE budget_id=$1 AND request_id=$2",[budgetId,input.run.request_id])).rows[0]?.status==='reserved'
          if(reserved)break
          await new Promise(resolve=>setTimeout(resolve,5))
        }
        assert.equal(reserved,true)
        let pendingSettled=false
        void pending.then(()=>{pendingSettled=true},()=>{pendingSettled=true})
        await new Promise(resolve=>setTimeout(resolve,50))
        assert.equal(pendingSettled,false,'the abort fixture reaches the retrying provider fence before cancellation')
        controller.abort()
        await gate!.query('COMMIT');gate!.release();gate=undefined
        await assert.rejects(pending)
        assert.equal(requests.length,beforeRequests,'the aborted call never reaches the loopback HTTP server')
        assert.deepEqual((await pool.query('SELECT status,settled_cny::text AS settled_cny FROM lifeos_provider_spend WHERE budget_id=$1 AND request_id=$2',[budgetId,input.run.request_id])).rows[0],{status:'not_sent',settled_cny:'0.00000000'},'a transport-zero reservation is released instead of becoming unknown spend')
      }finally{
        if(gate){await gate.query('ROLLBACK').catch(()=>{});gate.release()}
        await pending?.catch(()=>{})
        await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_PRE_TRANSPORT_ABORT').catch(()=>{})
        config.providerBudgetEnabled=oldBudget.enabled;config.providerBudgetId=oldBudget.id
        await pool.query('DELETE FROM lifeos_provider_spend WHERE budget_id=$1',[budgetId])
        await pool.query('DELETE FROM lifeos_provider_budgets WHERE id=$1',[budgetId])
      }
    })
    await t.test('identical schema errors account for dispatch according to the payload boundary',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC local payload rejection'})
      const input=await prepare('我想继续聊课程。',chat),beforeRequests=requests.length
      const oldBudget={enabled:config.providerBudgetEnabled,id:config.providerBudgetId},budgetId='synthetic-local-payload-'+randomUUID()
      const schemaError='Schema validation failed: maxLength 400 exceeded'
      let preflight:Awaited<ReturnType<typeof prepare>>|undefined
      const localFailure:StreamFunction<'openai-completions'>=(_selected,_context,options)=>{
        const events=createAssistantMessageEventStream()
        void (async()=>{
          const partial=fauxAssistantMessage('')
          events.push({type:'start',partial:{...partial,api:model.api,provider:model.provider,model:model.id}})
          const payload=await options?.onPayload?.({model:model.id,messages:[],stream:true},model)
          const response=await fetch(model.baseUrl+'/chat/completions',{method:'POST',body:JSON.stringify(payload),signal:options?.signal})
          await response.text()
          throw new Error(schemaError)
        })().catch((failure:Error)=>{
          const error=fauxAssistantMessage('',{stopReason:'error',errorMessage:failure.message})
          events.push({type:'error',reason:'error',error:{...error,api:model.api,provider:model.provider,model:model.id}})
        })
        return events
      }
      try{
        config.providerBudgetEnabled=true;config.providerBudgetId=budgetId;await setProviderBudget(budgetId,10)
        registerApiProvider({api:'openai-completions',stream:localFailure,streamSimple:localFailure},'synthetic-local-payload')
        const localEngine=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{before(){},after(){}}})
        outputs.push({reply:'合成回环请求已收到。'})
        await assert.rejects(localEngine(input))
        assert.equal(requests.length-beforeRequests,1,'the loopback service received exactly one HTTP request')
        assert.equal(input.staged.upstreamCalls,1,'post-payload ambiguity is one conservatively recorded provider call')
        assert.equal((input.staged.modelUsage as any)?.llmCallCount,1,'usage accounting retains the possibly billed call')
        assert.ok(!input.staged.audit.some((entry:any)=>entry.phase==='provider_dispatch_blocked'))
        assert.ok(input.staged.audit.some((entry:any)=>entry.phase==='model_call_started'&&entry.dispatchEvidence==='possible_after_payload_handoff')&&input.staged.audit.some((entry:any)=>entry.phase==='model_call_failed'),'the provider-call lifecycle records the uncertainty')
        assert.deepEqual((await pool.query('SELECT status,settled_cny::text AS settled_cny FROM lifeos_provider_spend WHERE budget_id=$1 AND request_id=$2',[budgetId,input.run.request_id])).rows[0],{status:'unknown',settled_cny:null},'unknown post-payload cost retains its reservation instead of being released')
        await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_POST_PAYLOAD_FAILURE')
        preflight=await prepare('我想继续聊课程。',chat)
        const preflightEngine=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{before(){},after(){},payload(){throw new Error(schemaError)}}})
        await assert.rejects(preflightEngine(preflight))
        assert.equal(requests.length-beforeRequests,1,'a rejection from the local payload callback never reaches HTTP')
        assert.equal(preflight.staged.upstreamCalls??0,0)
        assert.deepEqual((await pool.query('SELECT status,settled_cny::text AS settled_cny FROM lifeos_provider_spend WHERE budget_id=$1 AND request_id=$2',[budgetId,preflight.run.request_id])).rows[0],{status:'not_sent',settled_cny:'0.00000000'})
      }finally{
        resetApiProviders()
        await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_LOCAL_PAYLOAD_REJECTION').catch(()=>{})
        if(preflight)await store.terminateRun(user,preflight.run.request_id,'cancelled','SYNTHETIC_LOCAL_PAYLOAD_REJECTION').catch(()=>{})
        config.providerBudgetEnabled=oldBudget.enabled;config.providerBudgetId=oldBudget.id
        await pool.query('DELETE FROM lifeos_provider_spend WHERE budget_id=$1',[budgetId])
        await pool.query('DELETE FROM lifeos_provider_budgets WHERE id=$1',[budgetId])
      }
    })
    await t.test('a post-validation forget waits until source-derived SSE visibility ends',async()=>{
      const actor='interview-dispatch-fence-'+randomUUID(),sourceChat=randomUUID(),nextChat=randomUUID(),sourceText='创业访谈，我想把访谈问题改成客户最后在哪一步离开',question='客户最后在哪一步离开',signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let run:store.Run|undefined,forgetPromise:Promise<unknown>|undefined,forgetCommitted=false,dispatchSawCommittedForget:boolean|undefined
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC dispatch-fence source'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已按你的原话记录访谈问题。',null,signal)
        const item=(await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now()-interval '1 minute',now()-interval '1 minute') RETURNING id,revision",[randomUUID(),actor,sourceChat,sourceText,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:sourceText,range:{start:0,end:sourceText.length}}])])).rows[0]
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC dispatch-fence continuation'})
        run=(await store.startRun(actor,nextChat,randomUUID(),'继续上次创业访谈。')).run
        const staged:store.Staged={candidates:[],audit:[]},frames:Record<string,unknown>[]=[],draftSawCommittedForget:boolean[]=[],racingEngine=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{
          before:()=>{},
          payload:()=>{forgetPromise=transaction(c=>applyGrowthAction(c,actor,item.id,{requestId:randomUUID(),expectedRevision:item.revision,action:'forget'})).then(value=>{forgetCommitted=true;return value})},
          after:async()=>{},
        }})
        requestGuardProbe=()=>{dispatchSawCommittedForget=forgetCommitted}
        const beforeRequests=requests.length
        outputs.push((request:any)=>{
          const reply=request.response_format.json_schema.schema.properties.reply?.enum?.[0]??question,frame=JSON.stringify({reply}),split=frame.indexOf('。')+1
          assert.ok(split>0&&frame.slice(0,split).includes(question),'the first stream chunk is authorized private prose')
          return {syntheticChunks:[frame.slice(0,split),frame.slice(split)]}
        })
        const result=await racingEngine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:frame=>{
          frames.push(frame)
          if(frame.type==='draft'&&String(frame.text??'').includes(question))draftSawCommittedForget.push(forgetCommitted)
        }})
        await forgetPromise
        assert.equal(requests.length-beforeRequests,1,'the fenced request dispatches exactly once')
        assert.equal(dispatchSawCommittedForget,false,'the forget transaction cannot commit before the HTTP request crosses the transport seam')
        assert.ok(draftSawCommittedForget.length>0,'the fixture exposes at least one source-derived SSE draft: '+JSON.stringify(frames))
        assert.ok(draftSawCommittedForget.every(value=>value===false),'the forget cannot commit while any source-derived draft is still becoming visible')
        assert.equal(forgetCommitted,true,'the queued control commits only after stream assembly releases the fence')
        await assert.rejects(store.finishRun(run,staged,result.text,result.usage,signal),(error:any)=>error?.code==='GROWTH_SNAPSHOT_INVALIDATED')
      }finally{
        requestGuardProbe=undefined
        if(run)await store.terminateRun(actor,run.request_id,'cancelled','SYNTHETIC_DISPATCH_FENCE').catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('a direction pause committed after prompt staging blocks stale provider dispatch',async()=>{
      const raceChat=randomUUID(),targetChat=randomUUID(),signal=new AbortController().signal
      await store.createConversation(user,{id:raceChat,title:'SYNTHETIC direction dispatch race'})
      await store.createConversation(user,{id:targetChat,title:'SYNTHETIC stale direction prompt'})
      const pauseText='先别推自由职业建议。',pauseRun=(await store.startRun(user,raceChat,randomUUID(),pauseText)).run
      const pause=await stageDirectionControls(pauseRun,[{scopes:['freelance'],operation:'pause',quote:'先别推自由职业建议'}])
      const input=await prepare('我今天想聊一下课程。',targetChat),beforeRequests=requests.length
      const racingEngine=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{
        before:async()=>{await store.finishRun(pauseRun,{candidates:[],audit:[],directionControls:pause,directionControlSnapshotKey:pause.expectedSnapshotKey},'已暂停自由职业建议。',null,signal)},
        after:async()=>{},
      }})
      try{
        await assert.rejects(racingEngine(input),(error:any)=>error?.code==='DIRECTION_CONTROL_CONFLICT')
        assert.equal(requests.length,beforeRequests,'a stale direction prompt is rejected before transport or billing')
      }finally{
        await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_DIRECTION_CONFLICT').catch(()=>{})
        await pool.query("DELETE FROM growth_direction_control_revisions WHERE user_id=$1 AND scope='freelance'",[user])
        await pool.query("DELETE FROM growth_direction_controls WHERE user_id=$1 AND scope='freelance'",[user])
      }
    })
    await t.test('a concurrent raw interview message invalidates stale chronology before commit',async()=>{
      const actor='interview-concurrent-chronology-'+randomUUID(),sourceChat=randomUUID(),nextChat=randomUUID(),raceChat=randomUUID(),sourceText='创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',question='最近一次客户拒绝在哪一步',signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let run:store.Run|undefined,raceRun:store.Run|undefined
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC concurrent chronology source'})
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC concurrent chronology continuation'})
        await store.createConversation(actor,{id:raceChat,title:'SYNTHETIC concurrent chronology report'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已按你的原话记录访谈问题。',null,signal)
        await pool.query("UPDATE messages SET created_at=clock_timestamp()-interval '3 minutes' WHERE user_id=$1 AND id=$2",[actor,sourceRun.source_message_id])
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now()-interval '2 minutes',now()-interval '2 minutes')",[randomUUID(),actor,sourceChat,sourceText,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:sourceText,range:{start:0,end:sourceText.length}}])])
        const current='继续上次创业访谈。';run=(await store.startRun(actor,nextChat,randomUUID(),current)).run
        const staged:store.Staged={candidates:[],audit:[]},frames:Record<string,unknown>[]=[],racingEngine=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{
          before:async()=>{
            raceRun=(await store.startRun(actor,raceChat,randomUUID(),'后来我做了创业访谈')).run
          },
          after:async()=>{},
        }})
        const beforeRequests=requests.length
        const beforeOutputs=outputs.length
        outputs.push((request:any)=>({reply:request.response_format.json_schema.schema.properties.reply?.enum?.[0]??question}))
        try{
          await assert.rejects(racingEngine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:frame=>frames.push(frame)}),(error:any)=>error?.code==='INTERVIEW_CHRONOLOGY_INVALIDATED')
        }finally{outputs.splice(beforeOutputs)}
        assert.equal(requests.length-beforeRequests,0,'new chronology is rejected before provider dispatch or billing')
        assert.ok(!frames.some(frame=>frame.type==='draft'&&String(frame.text??'').includes(question)),'stale chronology is never exposed as an unsaved SSE draft: '+JSON.stringify(frames))
        assert.equal((await pool.query("SELECT count(*)::int n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[actor,run.request_id])).rows[0].n,0,'the stale reply never commits')
      }finally{
        if(run)await store.terminateRun(actor,run.request_id,'cancelled','SYNTHETIC_CONCURRENT_CHRONOLOGY').catch(()=>{})
        if(raceRun)await store.terminateRun(actor,raceRun.request_id,'cancelled','SYNTHETIC_CONCURRENT_CHRONOLOGY_RACE').catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('a raw interview message already newer than the continuation fails before generation',async()=>{
      const actor='interview-pre-snapshot-chronology-'+randomUUID(),sourceChat=randomUUID(),nextChat=randomUUID(),raceChat=randomUUID(),sourceText='创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let run:store.Run|undefined,raceRun:store.Run|undefined
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        for(const [id,title] of [[sourceChat,'SYNTHETIC pre-snapshot source'],[nextChat,'SYNTHETIC pre-snapshot continuation'],[raceChat,'SYNTHETIC pre-snapshot report']] as const)await store.createConversation(actor,{id,title})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已按你的原话记录访谈问题。',null,signal)
        await pool.query("UPDATE messages SET created_at=clock_timestamp()-interval '3 minutes' WHERE user_id=$1 AND id=$2",[actor,sourceRun.source_message_id])
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now()-interval '2 minutes',now()-interval '2 minutes')",[randomUUID(),actor,sourceChat,sourceText,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:sourceText,range:{start:0,end:sourceText.length}}])])
        run=(await store.startRun(actor,nextChat,randomUUID(),'继续上次创业访谈。')).run
        raceRun=(await store.startRun(actor,raceChat,randomUUID(),'后来我做了创业访谈')).run
        const beforeRequests=requests.length
        await assert.rejects(engine({run,staged:{candidates:[],audit:[]},context:await store.contextForRun(run),decision:null,signal,emit:()=>{}}),(error:any)=>error?.code==='INTERVIEW_CHRONOLOGY_INVALIDATED')
        assert.equal(requests.length,beforeRequests,'an already newer user report blocks stale generation before any provider call')
      }finally{
        if(run)await store.terminateRun(actor,run.request_id,'cancelled','SYNTHETIC_PRE_SNAPSHOT_CHRONOLOGY').catch(()=>{})
        if(raceRun)await store.terminateRun(actor,raceRun.request_id,'cancelled','SYNTHETIC_PRE_SNAPSHOT_CHRONOLOGY_RACE').catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('newer third-party, future, negated, explicitly unrelated and forgotten interview text does not stale the continuation',async()=>{
      const actor='interview-nonoccurrence-chronology-'+randomUUID(),sourceChat=randomUUID(),nextChat=randomUUID(),signal=new AbortController().signal
      const newerTexts=['导师后来做了创业访谈。','我计划明天做创业访谈。','我后来没有做创业访谈。','后来我做了求职访谈。','后来我做了创业访谈。']
      const newerChats=newerTexts.map(()=>randomUUID()),newerRuns:store.Run[]=[]
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let currentRun:store.Run|undefined
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC nonoccurrence source'})
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC nonoccurrence continuation'})
        for(const [index,id] of newerChats.entries())await store.createConversation(actor,{id,title:'SYNTHETIC nonoccurrence '+index})
        const sourceText='创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        await pool.query("UPDATE messages SET created_at=clock_timestamp()-interval '3 minutes' WHERE user_id=$1 AND id=$2",[actor,sourceRun.source_message_id])
        currentRun=(await store.startRun(actor,nextChat,randomUUID(),'继续上次创业访谈。')).run
        for(const [index,text] of newerTexts.entries())newerRuns.push((await store.startRun(actor,newerChats[index]!,randomUUID(),text)).run)
        await transaction(c=>invalidateCoachSources(c,actor,[newerRuns.at(-1)!.source_message_id],true))

        const chronology=await store.readInterviewChronologySnapshot(actor,{sourceId:sourceRun.source_message_id,currentMessageId:currentRun.source_message_id,conversationId:nextChat,memoryEnabled:true})
        assert.ok(!chronology.messages.some(message=>newerRuns.some(run=>run.source_message_id===message.id)),'non-occurrences, explicitly unrelated occurrences and forgotten occurrences never enter the historical chronology')
      }finally{
        if(currentRun)await store.terminateRun(actor,currentRun.request_id,'cancelled','SYNTHETIC_NONOCCURRENCE_CHRONOLOGY').catch(()=>{})
        for(const run of newerRuns)await store.terminateRun(actor,run.request_id,'cancelled','SYNTHETIC_NONOCCURRENCE_CHRONOLOGY').catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('database chronology keeps PostgreSQL microseconds for the current-message upper bound',async()=>{
      const actor='interview-microsecond-chronology-'+randomUUID(),sourceChat=randomUUID(),reportChat=randomUUID(),nextChat=randomUUID(),signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let currentRun:store.Run|undefined
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        for(const [id,title] of [[sourceChat,'SYNTHETIC microsecond edit'],[reportChat,'SYNTHETIC microsecond report'],[nextChat,'SYNTHETIC microsecond continuation']] as const)await store.createConversation(actor,{id,title})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步')).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        const reportRun=(await store.startRun(actor,reportChat,randomUUID(),'后来我做了创业访谈')).run
        await store.finishRun(reportRun,{candidates:[],audit:[]},'收到。',null,signal)
        currentRun=(await store.startRun(actor,nextChat,randomUUID(),'继续上次创业访谈。')).run
        await pool.query("UPDATE messages SET created_at='2026-10-14T12:00:00.123100Z'::timestamptz WHERE user_id=$1 AND id=$2",[actor,sourceRun.source_message_id])
        await pool.query("UPDATE messages SET created_at='2026-10-14T12:00:00.123500Z'::timestamptz WHERE user_id=$1 AND id=$2",[actor,reportRun.source_message_id])
        await pool.query("UPDATE messages SET created_at='2026-10-14T12:00:00.123900Z'::timestamptz WHERE user_id=$1 AND id=$2",[actor,currentRun.source_message_id])
        const current=(await pool.query('SELECT created_at FROM messages WHERE user_id=$1 AND id=$2',[actor,currentRun.source_message_id])).rows[0]
        const scope={sourceId:sourceRun.source_message_id,currentCreatedAt:new Date(current.created_at).toISOString(),currentMessageId:currentRun.source_message_id,conversationId:nextChat,memoryEnabled:true}
        const chronology=await store.readInterviewChronologySnapshot(actor,scope)
        assert.deepEqual(chronology.messages.map(message=>message.id),[sourceRun.source_message_id,reportRun.source_message_id],'the .123500 report remains before the .123900 current row even though JavaScript exposes only milliseconds')
      }finally{
        if(currentRun)await store.terminateRun(actor,currentRun.request_id,'cancelled','SYNTHETIC_MICROSECOND_CHRONOLOGY').catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('an earlier active interview fact in the same millisecond does not invalidate a later question edit',async()=>{
      const actor='interview-growth-microsecond-order-'+randomUUID(),earlierChat=randomUUID(),editChat=randomUUID(),nextChat=randomUUID(),signal=new AbortController().signal
      const earlierText='此前我做了求职访谈',editText='创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',question='最近一次客户拒绝在哪一步'
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let currentRun:store.Run|undefined
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        for(const [id,title] of [[earlierChat,'SYNTHETIC earlier microsecond interview'],[editChat,'SYNTHETIC later microsecond edit'],[nextChat,'SYNTHETIC microsecond edit continuation']] as const)await store.createConversation(actor,{id,title})
        const earlierRun=(await store.startRun(actor,earlierChat,randomUUID(),earlierText)).run
        await store.finishRun(earlierRun,{candidates:[],audit:[]},'已记录。',null,signal)
        const editRun=(await store.startRun(actor,editChat,randomUUID(),editText)).run
        await store.finishRun(editRun,{candidates:[],audit:[]},'已记录。',null,signal)
        await pool.query("UPDATE messages SET created_at='2026-10-14T12:00:00.123100Z'::timestamptz WHERE user_id=$1 AND id=$2",[actor,earlierRun.source_message_id])
        await pool.query("UPDATE messages SET created_at='2026-10-14T12:00:00.123900Z'::timestamptz WHERE user_id=$1 AND id=$2",[actor,editRun.source_message_id])
        for(const [conversationId,run,text,createdAt] of [[earlierChat,earlierRun,earlierText,'2026-10-14T12:00:00.123100Z'],[editChat,editRun,editText,'2026-10-14T12:00:00.123900Z']] as const)await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',$6::timestamptz,$6::timestamptz)",[randomUUID(),actor,conversationId,text,JSON.stringify([{type:'message',id:run.source_message_id,quote:text,range:{start:0,end:text.length}}]),createdAt])
        currentRun=(await store.startRun(actor,nextChat,randomUUID(),'继续上次创业访谈。')).run
        await pool.query("UPDATE messages SET created_at='2026-10-14T12:00:00.124100Z'::timestamptz WHERE user_id=$1 AND id=$2",[actor,currentRun.source_message_id])
        const staged:store.Staged={candidates:[],audit:[]}
        outputs.push((request:any)=>({reply:request.response_format.json_schema.schema.properties.reply?.enum?.[0]??question}))
        const result=await engine({run:currentRun,staged,context:await store.contextForRun(currentRun),decision:null,signal,emit:()=>{}})
        const route=staged.audit.find((entry:any)=>entry.phase==='edited_interview_route') as any
        assert.match(result.text,new RegExp(question),JSON.stringify({result:result.text,route}))
        assert.equal(route?.continuation,true,JSON.stringify(route))
      }finally{
        if(currentRun)await store.terminateRun(actor,currentRun.request_id,'cancelled','SYNTHETIC_GROWTH_MICROSECOND_ORDER').catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('a deleted conversation no longer contributes raw interview chronology',async()=>{
      const actor='interview-deleted-chronology-'+randomUUID(),sourceChat=randomUUID(),deletedChat=randomUUID(),nextChat=randomUUID(),signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let currentRun:store.Run|undefined
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        for(const [id,title] of [[sourceChat,'SYNTHETIC retained edit'],[deletedChat,'SYNTHETIC deleted raw report'],[nextChat,'SYNTHETIC post-delete continuation']] as const)await store.createConversation(actor,{id,title})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步')).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        const reportRun=(await store.startRun(actor,deletedChat,randomUUID(),'后来我做了创业访谈')).run
        await store.finishRun(reportRun,{candidates:[],audit:[]},'收到。',null,signal)
        await store.deleteConversation(actor,deletedChat)
        currentRun=(await store.startRun(actor,nextChat,randomUUID(),'继续上次创业访谈。')).run
        const scope={sourceId:sourceRun.source_message_id,currentMessageId:currentRun.source_message_id,conversationId:nextChat,memoryEnabled:true}
        const chronology=await store.readInterviewChronologySnapshot(actor,scope)
        assert.ok(!chronology.messages.some(message=>message.id===reportRun.source_message_id),'a hidden transcript is not raw routing evidence')
        assert.ok(chronology.messages.some(message=>message.id===sourceRun.source_message_id),'the separately retained edit source remains available')
      }finally{
        if(currentRun)await store.terminateRun(actor,currentRun.request_id,'cancelled','SYNTHETIC_DELETED_CHRONOLOGY').catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('a selected interview source deleted before chronology snapshot creation is rejected',async()=>{
      const actor='interview-selected-source-deleted-'+randomUUID(),sourceChat=randomUUID(),nextChat=randomUUID(),signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let currentRun:store.Run|undefined
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC selected edit deleted'})
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC selected edit continuation'})
        const sourceText='创业访谈，我想把访谈问题改成只问预算',sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        currentRun=(await store.startRun(actor,nextChat,randomUUID(),'继续创业访谈。')).run
        await store.deleteConversation(actor,sourceChat)
        await assert.rejects(()=>store.readInterviewChronologySnapshot(actor,{sourceId:sourceRun.source_message_id,currentMessageId:currentRun!.source_message_id,conversationId:nextChat,memoryEnabled:true}),(error:any)=>error?.code==='INTERVIEW_CHRONOLOGY_INVALIDATED')
      }finally{
        if(currentRun)await store.terminateRun(actor,currentRun.request_id,'cancelled','SYNTHETIC_SELECTED_SOURCE_DELETED').catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('forgetting an unrelated clause in the selected edit message preserves its exact authority',async()=>{
      const actor='interview-selected-range-forget-'+randomUUID(),sourceChat=randomUUID(),nextChat=randomUUID(),signal=new AbortController().signal
      const major='我的专业是软件工程',edit='我想把访谈问题改成只问预算',sourceText=major+'。创业访谈，'+edit+'。'
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let currentRun:store.Run|undefined
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC exact edit authority'})
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC exact edit continuation'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        const majorRange={start:0,end:major.length},memoryId=randomUUID()
        await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','education.major',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,actor,JSON.stringify('软件工程'),JSON.stringify([{type:'message',conversationId:sourceChat,messageId:sourceRun.source_message_id,quote:major,range:majorRange}])])
        currentRun=(await store.startRun(actor,nextChat,randomUUID(),'继续创业访谈，接下来怎么问？')).run
        const item={sourceId:sourceRun.source_message_id,sourceOrder:0,text:sourceText,contextText:sourceText},resolution=resolveRequestedQuestionEdit([item],'继续创业访谈，接下来怎么问？')
        const selected=selectedRequestedQuestionEditSource([item],resolution,'继续创业访谈，接下来怎么问？')!
        const scope={...selected,currentMessageId:currentRun.source_message_id,conversationId:nextChat,memoryEnabled:true}
        const before=await store.readInterviewChronologySnapshot(actor,scope)
        await applyMemoryAction(actor,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
        const after=await store.readInterviewChronologySnapshot(actor,scope)
        assert.ok(after.messages.some(message=>message.id===sourceRun.source_message_id),'the selected edit source remains readable after the unrelated major is forgotten')
        assert.notEqual(after.key,before.key,'the unrelated exact control still participates in the concurrency snapshot')
      }finally{
        if(currentRun)await store.terminateRun(actor,currentRun.request_id,'cancelled','SYNTHETIC_SELECTED_RANGE_FORGET').catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('forgetting one fact keeps independent same-message chronology, records and snapshot concurrency',async()=>{
      const actor='interview-scoped-memory-forget-'+randomUUID(),sourceChat=randomUUID(),mixedChat=randomUUID(),nextChat=randomUUID(),signal=new AbortController().signal
      const editText='创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',majorQuote='我的专业是软件工程',interviewQuote='后来我做了创业访谈',mixedText=majorQuote+'；'+interviewQuote+'。'
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let currentRun:store.Run|undefined
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        for(const [id,title] of [[sourceChat,'SYNTHETIC scoped memory edit'],[mixedChat,'SYNTHETIC scoped memory mixed source'],[nextChat,'SYNTHETIC scoped memory continuation']] as const)await store.createConversation(actor,{id,title})
        const editRun=(await store.startRun(actor,sourceChat,randomUUID(),editText)).run
        await store.finishRun(editRun,{candidates:[],audit:[]},'已记录。',null,signal)
        const mixedRun=(await store.startRun(actor,mixedChat,randomUUID(),mixedText)).run
        await store.finishRun(mixedRun,{candidates:[],audit:[]},'已记录。',null,signal)
        const memoryId=randomUUID(),experienceId=randomUUID()
        await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','education.major',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,actor,JSON.stringify('软件工程'),JSON.stringify([{type:'message',conversationId:mixedChat,messageId:mixedRun.source_message_id,quote:majorQuote}])])
        await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',1)",[experienceId,actor,mixedChat,mixedRun.source_message_id,interviewQuote,mixedRun.request_id,{title:'创业访谈',summary:interviewQuote,action:interviewQuote,result:'',reflection:'',occurredAt:'',source:'用户对话原话',tags:[]}])
        currentRun=(await store.startRun(actor,nextChat,randomUUID(),'继续上次创业访谈。')).run
        const scope={sourceId:editRun.source_message_id,currentMessageId:currentRun.source_message_id,conversationId:nextChat,memoryEnabled:true}
        const before=await store.readInterviewChronologySnapshot(actor,scope)
        assert.ok(before.messages.some(message=>message.id===mixedRun.source_message_id),'the mixed source begins in raw chronology')

        await applyMemoryAction(actor,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})

        const after=await store.readInterviewChronologySnapshot(actor,scope)
        assert.deepEqual(after.messages.map(message=>message.id),before.messages.map(message=>message.id),'forgetting the major does not erase the independent interview clause')
        assert.notEqual(after.key,before.key,'an exact source boundary changes the commit snapshot even when the raw message remains')
        assert.ok(after.boundaries.some(ref=>ref.messageId===mixedRun.source_message_id&&ref.quote===majorQuote),'the snapshot carries the exact forgotten source boundary')
        assert.equal((await pool.query("SELECT count(*)::int n FROM memory_suppressions WHERE user_id=$1 AND source_message_id=$2 AND key='scope:education.major'",[actor,mixedRun.source_message_id])).rows[0].n,1)
        assert.equal((await pool.query('SELECT count(*)::int n FROM growth_source_suppressions WHERE user_id=$1 AND message_id=$2 AND quote=$3',[actor,mixedRun.source_message_id,majorQuote])).rows[0].n,1)
        assert.equal((await pool.query('SELECT count(*)::int n FROM coach_source_withdrawals WHERE user_id=$1 AND message_id=$2',[actor,mixedRun.source_message_id])).rows[0].n,0,'a partial memory forget never withdraws the whole coach source')
        assert.ok((await store.listExperiences(actor)).some(record=>record.id===experienceId),'the independent interview experience remains visible to record and star-map readers')
        assert.ok(!(await loadSnapshot(actor,nextChat,'继续创业访谈')).suppressedMessageIds?.includes(mixedRun.source_message_id),'model context does not classify a scoped forget as a full-message tombstone')
        await assert.rejects(store.finishRun(currentRun,{candidates:[],audit:[],interviewChronologySnapshot:{scope,key:before.key}},'收到。',null,signal),(error:any)=>error?.code==='INTERVIEW_CHRONOLOGY_INVALIDATED')
      }finally{
        if(currentRun)await store.terminateRun(actor,currentRun.request_id,'cancelled','SYNTHETIC_SCOPED_MEMORY_FORGET').catch(()=>{})
        await pool.query('DELETE FROM experiences WHERE user_id=$1',[actor])
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('a ranged memory forget preserves a later identical quote in the same message',async()=>{
      const actor='memory-ranged-duplicate-forget-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal,quote='我的专业是软件工程',text=quote+'；'+quote+'；后来我做了创业访谈。'
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:chat,title:'SYNTHETIC duplicate ranged memory source'})
        const sourceRun=(await store.startRun(actor,chat,randomUUID(),text)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        const first={start:0,end:quote.length},secondStart=text.indexOf(quote,quote.length),second={start:secondStart,end:secondStart+quote.length},memoryId=randomUUID(),experienceId=randomUUID(),themeId=randomUUID()
        await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','education.major',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,actor,JSON.stringify('软件工程'),JSON.stringify([{type:'message',conversationId:chat,messageId:sourceRun.source_message_id,quote,range:first}])])
        await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',1)",[experienceId,actor,chat,sourceRun.source_message_id,quote,sourceRun.request_id,{title:'软件工程经历',summary:quote,action:quote,result:'',reflection:'',occurredAt:'',source:'用户对话原话',tags:[]}])
        await pool.query("INSERT INTO user_themes(user_id,id,title,kind,status,origin,summary,source_refs,pinned) VALUES($1,$2,'软件工程','interest','active','user_stated','合成主题','[]',false)",[actor,themeId])

        await applyMemoryAction(actor,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})

        const unavailable=async(range:{start:number;end:number})=>await growthQuoteSuppressed(pool,actor,sourceRun.source_message_id,quote,text,range)||await messageQuoteCorrected(pool,actor,sourceRun.source_message_id,quote,text,range)
        assert.equal(await unavailable(first),true,'the selected occurrence is forgotten')
        assert.equal(await unavailable(second),false,'an identical later occurrence remains independent')
        assert.ok((await coachSourceBoundaryRefs(pool,actor)).some(ref=>ref.messageId===sourceRun.source_message_id&&ref.range?.start===first.start&&ref.range.end===first.end),'the persisted boundary retains the selected source range')
        assert.ok(!(await store.listExperiences(actor)).some(record=>record.id===experienceId),'an experience without an exact occurrence binding fails closed when its quote overlaps the ranged forget')
        assert.ok(!(await store.retrieveExperiences(actor,{query:'',limit:10})).records.some(record=>record.id===experienceId),'retrieval applies the same ranged memory boundary as star-map projection')
        assert.equal(await transaction(c=>linkExperienceToThemes(c,actor,experienceId,quote,true)),0,'an overlapping ranged forget cannot create a star-map link')
      }finally{await pool.query('DELETE FROM experiences WHERE user_id=$1',[actor]);await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('a range-free duplicate memory source fails closed as a full-message tombstone',async()=>{
      const actor='memory-ambiguous-duplicate-forget-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal,quote='我的专业是软件工程',stageQuote='我现在大二',text=quote+'；'+quote+'；'+stageQuote+'；后来我做了创业访谈。',memoryId=randomUUID(),stageMemoryId=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:chat,title:'SYNTHETIC ambiguous duplicate memory source'})
        const sourceRun=(await store.startRun(actor,chat,randomUUID(),text)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','education.major',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,actor,JSON.stringify('软件工程'),JSON.stringify([{type:'message',conversationId:chat,messageId:sourceRun.source_message_id,quote}])])
        await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','education.stage',$3,'user_reported','user',$4,now(),now(),'active')",[stageMemoryId,actor,JSON.stringify('大二'),JSON.stringify([{type:'message',conversationId:chat,messageId:sourceRun.source_message_id,quote:stageQuote,range:{start:text.indexOf(stageQuote),end:text.indexOf(stageQuote)+stageQuote.length}}])])

        await applyMemoryAction(actor,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})

        assert.equal((await pool.query("SELECT count(*)::int n FROM memory_suppressions WHERE user_id=$1 AND source_message_id=$2 AND key='scope:education.major'",[actor,sourceRun.source_message_id])).rows[0].n,0,'an ambiguous quote never receives a scoped marker')
        assert.equal((await pool.query('SELECT count(*)::int n FROM growth_source_suppressions WHERE user_id=$1 AND message_id=$2 AND quote=$3',[actor,sourceRun.source_message_id,quote])).rows[0].n,0,'an ambiguous quote never creates a quote-wide suppression')
        const snapshot=await loadSnapshot(actor,chat,'继续访谈')
        assert.ok(snapshot.suppressedMessageIds?.includes(sourceRun.source_message_id),'the conservative full tombstone keeps both indistinguishable occurrences out of model context')
        assert.ok(!snapshot.profile.some(item=>item.id===stageMemoryId&&item.status==='active'),'a full-message tombstone also removes every sibling fact from active model memory')
        assert.ok(!(await getMemoryView(actor)).items.some(item=>item.id===stageMemoryId),'memory details cannot expose a sibling fact from a fully forgotten message')
        await assert.rejects(()=>assertMemoryEvidence(actor,stageMemoryId,1,true),(error:any)=>error?.code==='MEMORY_EVIDENCE_STALE','a fully forgotten message cannot remain valid citation evidence')
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('an invalid memory source range fails closed as a full-message tombstone',async()=>{
      const actor='memory-invalid-range-forget-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal,quote='我的专业是软件工程',text='后来我做了创业访谈；'+quote,memoryId=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:chat,title:'SYNTHETIC invalid ranged memory source'})
        const sourceRun=(await store.startRun(actor,chat,randomUUID(),text)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','education.major',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,actor,JSON.stringify('软件工程'),JSON.stringify([{type:'message',conversationId:chat,messageId:sourceRun.source_message_id,quote,range:{start:text.indexOf(quote),end:999}}])])

        await applyMemoryAction(actor,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})

        assert.equal((await pool.query("SELECT count(*)::int n FROM memory_suppressions WHERE user_id=$1 AND source_message_id=$2 AND key='scope:education.major'",[actor,sourceRun.source_message_id])).rows[0].n,0,'an unverifiable range never receives a scoped marker')
        assert.ok((await loadSnapshot(actor,chat,'继续访谈')).suppressedMessageIds?.includes(sourceRun.source_message_id),'the legacy-compatible full tombstone prevents forgotten text from re-entering model context')
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('a real suppression key using the legacy marker prefix still hides its source',async()=>{
      const actor='memory-reserved-prefix-forget-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:chat,title:'SYNTHETIC reserved-prefix memory suppression'})
        const sourceRun=(await store.startRun(actor,chat,randomUUID(),'这条来源必须整体遗忘。')).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        await pool.query("INSERT INTO memory_suppressions(user_id,source_conversation_id,source_message_id,key,suppression_kind) VALUES($1,$2,$3,'health','fact'),($1,$2,$3,'scope:health','scope_marker'),($1,$2,$3,'scope:health','fact')",[actor,chat,sourceRun.source_message_id])
        assert.ok((await loadSnapshot(actor,chat,'继续')).suppressedMessageIds?.includes(sourceRun.source_message_id),'row kind, not a user-key prefix, decides whether a suppression is scoped')
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('a ranged memory forget cannot create a star-map link through an adjacent forgotten fact',async()=>{
      const actor='memory-adjacent-theme-forget-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal,preference='我重视证据透明',experienceQuote='后来我做了创业访谈',text=preference+'；'+experienceQuote+'。',memoryId=randomUUID(),growthId=randomUUID(),experienceId=randomUUID(),themeId=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:chat,title:'SYNTHETIC adjacent forgotten theme fact'})
        const sourceRun=(await store.startRun(actor,chat,randomUUID(),text)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        const preferenceRange={start:0,end:preference.length}
        await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','currentConcern',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,actor,JSON.stringify('证据透明'),JSON.stringify([{type:'message',conversationId:chat,messageId:sourceRun.source_message_id,quote:preference,range:preferenceRange}])])
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies) VALUES($1,$2,$3,'preference',$4,'user_reported','active',$5,'[]')",[growthId,actor,chat,preference,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:preference,range:preferenceRange}])])
        await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',1)",[experienceId,actor,chat,sourceRun.source_message_id,experienceQuote,sourceRun.request_id,{title:'创业访谈',summary:experienceQuote,action:experienceQuote,result:'',reflection:'',occurredAt:'',source:'用户对话原话',tags:[]}])
        await pool.query("INSERT INTO user_themes(user_id,id,title,kind,status,origin,summary,source_refs,pinned) VALUES($1,$2,'证据透明','valued_point','active','user_stated','合成主题',$3,false)",[actor,themeId,JSON.stringify([{growthItemId:growthId,quote:preference}])])
        assert.equal(await transaction(c=>linkExperienceToThemes(c,actor,experienceId,experienceQuote,true)),1,'the fixture proves the adjacent source would otherwise create a tentative link')
        await pool.query('DELETE FROM experience_theme_links WHERE user_id=$1 AND experience_id=$2',[actor,experienceId])

        await applyMemoryAction(actor,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})

        assert.equal(await transaction(c=>linkExperienceToThemes(c,actor,experienceId,experienceQuote,true)),0,'the forgotten adjacent fact cannot be reused as star-map evidence')
      }finally{await pool.query('DELETE FROM experiences WHERE user_id=$1',[actor]);await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('adjacent star-map evidence must come from the experience message, not identical text elsewhere',async()=>{
      const actor='theme-cross-message-adjacency-'+randomUUID(),sourceChat=randomUUID(),otherChat=randomUUID(),signal=new AbortController().signal,preference='我重视证据透明',experienceQuote='后来我做了创业访谈',sourceText=preference+'；'+experienceQuote+'。',memoryId=randomUUID(),growthId=randomUUID(),experienceId=randomUUID(),themeId=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC forgotten adjacent occurrence'})
        await store.createConversation(actor,{id:otherChat,title:'SYNTHETIC independent repeated preference'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        const otherRun=(await store.startRun(actor,otherChat,randomUUID(),preference)).run
        await store.finishRun(otherRun,{candidates:[],audit:[]},'已记录。',null,signal)
        const preferenceRange={start:0,end:preference.length}
        await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','currentConcern',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,actor,JSON.stringify('证据透明'),JSON.stringify([{type:'message',conversationId:sourceChat,messageId:sourceRun.source_message_id,quote:preference,range:preferenceRange}])])
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies) VALUES($1,$2,$3,'preference',$4,'user_reported','active',$5,'[]')",[growthId,actor,otherChat,preference,JSON.stringify([{type:'message',id:otherRun.source_message_id,quote:preference,range:preferenceRange}])])
        await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',1)",[experienceId,actor,sourceChat,sourceRun.source_message_id,experienceQuote,sourceRun.request_id,{title:'创业访谈',summary:experienceQuote,action:experienceQuote,result:'',reflection:'',occurredAt:'',source:'用户对话原话',tags:[]}])
        await pool.query("INSERT INTO user_themes(user_id,id,title,kind,status,origin,summary,source_refs,pinned) VALUES($1,$2,'证据透明','valued_point','active','user_stated','合成主题',$3,false)",[actor,themeId,JSON.stringify([{growthItemId:growthId,quote:preference}])])
        await applyMemoryAction(actor,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
        assert.equal(await transaction(c=>linkExperienceToThemes(c,actor,experienceId,experienceQuote,true)),0,'an identical preference sourced from another message cannot replace the forgotten adjacent occurrence')
      }finally{await pool.query('DELETE FROM experiences WHERE user_id=$1',[actor]);await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('adjacent star-map evidence uses the exact growth occurrence, not an earlier duplicate',async()=>{
      const actor='theme-same-message-range-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal,preference='我重视证据透明',experienceQuote='我完成了报告',text=preference+'；'+experienceQuote+'；'+preference+'。',growthId=randomUUID(),experienceId=randomUUID(),themeId=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:chat,title:'SYNTHETIC exact adjacent growth source'})
        const sourceRun=(await store.startRun(actor,chat,randomUUID(),text)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        const preferenceStart=text.lastIndexOf(preference),preferenceRange={start:preferenceStart,end:preferenceStart+preference.length}
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies) VALUES($1,$2,$3,'preference',$4,'user_reported','active',$5,'[]')",[growthId,actor,chat,preference,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:preference,range:preferenceRange}])])
        await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',1)",[experienceId,actor,chat,sourceRun.source_message_id,experienceQuote,sourceRun.request_id,{title:'完成报告',summary:experienceQuote,action:experienceQuote,result:'',reflection:'',occurredAt:'',source:'用户对话原话',tags:[]}])
        await pool.query("INSERT INTO user_themes(user_id,id,title,kind,status,origin,summary,source_refs,pinned) VALUES($1,$2,'证据透明','valued_point','active','user_stated','合成主题',$3,false)",[actor,themeId,JSON.stringify([{growthItemId:growthId,quote:preference}])])
        assert.equal(await transaction(c=>linkExperienceToThemes(c,actor,experienceId,experienceQuote,true)),0,'a later exact preference cannot borrow the earlier identical clause as preceding evidence')
      }finally{await pool.query('DELETE FROM experiences WHERE user_id=$1',[actor]);await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('legacy memory suppression without an exact scope remains a full-message tombstone',async()=>{
      const actor='interview-legacy-memory-suppression-'+randomUUID(),sourceChat=randomUUID(),mixedChat=randomUUID(),nextChat=randomUUID(),signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let currentRun:store.Run|undefined
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        for(const [id,title] of [[sourceChat,'SYNTHETIC legacy edit'],[mixedChat,'SYNTHETIC legacy hidden source'],[nextChat,'SYNTHETIC legacy continuation']] as const)await store.createConversation(actor,{id,title})
        const editRun=(await store.startRun(actor,sourceChat,randomUUID(),'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步')).run
        await store.finishRun(editRun,{candidates:[],audit:[]},'已记录。',null,signal)
        const mixedRun=(await store.startRun(actor,mixedChat,randomUUID(),'我的专业是软件工程；后来我做了创业访谈。')).run
        await store.finishRun(mixedRun,{candidates:[],audit:[]},'已记录。',null,signal)
        await pool.query("INSERT INTO memory_suppressions(user_id,source_conversation_id,source_message_id,key) VALUES($1,$2,$3,'education.major')",[actor,mixedChat,mixedRun.source_message_id])
        currentRun=(await store.startRun(actor,nextChat,randomUUID(),'继续上次创业访谈。')).run
        const chronology=await store.readInterviewChronologySnapshot(actor,{sourceId:editRun.source_message_id,currentMessageId:currentRun.source_message_id,conversationId:nextChat,memoryEnabled:true})
        assert.ok(!chronology.messages.some(message=>message.id===mixedRun.source_message_id),'a pre-upgrade tombstone keeps its conservative full-message privacy meaning')
      }finally{
        if(currentRun)await store.terminateRun(actor,currentRun.request_id,'cancelled','SYNTHETIC_LEGACY_MEMORY_SUPPRESSION').catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('start waits on the conversation before claiming the account chronology lock',async()=>{
      const actor='interview-lock-order-'+randomUUID(),chat=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let run:store.Run|undefined,blocker:PoolClient|undefined,probe:PoolClient|undefined
      try{
        await store.createConversation(actor,{id:chat,title:'SYNTHETIC chronology lock order'})
        blocker=await pool.connect()
        await blocker.query('BEGIN')
        await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor+':conversation:'+chat])
        const starting=store.startRun(actor,chat,randomUUID(),'新的同会话消息。')
        let startWaiting=false
        for(let attempt=0;attempt<100&&!startWaiting;attempt++){
          startWaiting=Boolean((await pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted LIMIT 1")).rowCount)
          if(!startWaiting)await new Promise(resolve=>setTimeout(resolve,10))
        }
        assert.equal(startWaiting,true,'start reached the deliberately blocked conversation lock')
        probe=await pool.connect()
        await probe.query('BEGIN')
        await probe.query("SET LOCAL lock_timeout='250ms'")
        await probe.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor+':interview-chronology'])
        await probe.query('COMMIT');probe.release();probe=undefined
        await blocker.query('COMMIT');blocker.release();blocker=undefined
        run=(await starting).run
      }finally{
        if(probe){await probe.query('ROLLBACK').catch(()=>{});probe.release()}
        if(blocker){await blocker.query('ROLLBACK').catch(()=>{});blocker.release()}
        if(run)await store.terminateRun(actor,run.request_id,'cancelled','SYNTHETIC_LOCK_ORDER').catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('every raw chronology predicate writer waits behind the validated account snapshot',async()=>{
      const actor='interview-predicate-lock-'+randomUUID(),deletedChat=randomUUID(),memoryChat=randomUUID(),growthChat=randomUUID(),withdrawalChat=randomUUID(),signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      const holdChronologyWhile=async<T>(label:string,mutation:()=>Promise<T>)=>{
        const blocker=await pool.connect()
        await blocker.query('BEGIN')
        await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor+':interview-chronology'])
        let settled=false
        const pending=mutation().then(value=>({value}),error=>({error})).finally(()=>{settled=true})
        let waiting=false
        try{
          for(let attempt=0;attempt<100&&!settled&&!waiting;attempt++){
            waiting=Boolean((await pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted LIMIT 1")).rowCount)
            if(!waiting)await new Promise(resolve=>setTimeout(resolve,10))
          }
          assert.equal(settled,false,label+' mutated chronology while a validated snapshot still owned its lock')
          assert.equal(waiting,true,label+' never attempted the chronology lock')
        }finally{
          await blocker.query('COMMIT').catch(async()=>blocker.query('ROLLBACK').catch(()=>{}))
          blocker.release()
        }
        const outcome=await pending
        if('error' in outcome)throw outcome.error
        return outcome.value
      }
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        for(const [id,title] of [[deletedChat,'SYNTHETIC chronology deletion writer'],[memoryChat,'SYNTHETIC chronology suppression writer'],[growthChat,'SYNTHETIC chronology exact suppression writer'],[withdrawalChat,'SYNTHETIC chronology withdrawal writer']] as const)await store.createConversation(actor,{id,title})
        const persist=async(conversationId:string,text:string)=>{
          const run=(await store.startRun(actor,conversationId,randomUUID(),text)).run
          await store.finishRun(run,{candidates:[],audit:[]},'收到。',null,signal)
          return run
        }
        await persist(deletedChat,'后来我做了创业访谈。')
        const memoryRun=await persist(memoryChat,'后来我做了求职访谈。')
        const growthRun=await persist(growthChat,'后来我做了科研访谈。')
        const withdrawalRun=await persist(withdrawalChat,'后来我做了课程访谈。')
        const memoryId=randomUUID(),memoryQuote='后来我做了求职访谈。'
        await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,actor,JSON.stringify(memoryQuote),JSON.stringify([{type:'message',conversationId:memoryChat,messageId:memoryRun.source_message_id,quote:memoryQuote}])])
        const growthId=randomUUID(),growthQuote='后来我做了科研访谈。'
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]')",[growthId,actor,growthChat,growthQuote,JSON.stringify([{type:'message',id:growthRun.source_message_id,quote:growthQuote}])])
        await pool.query("INSERT INTO growth_revisions(user_id,item_id,revision,action,snapshot) VALUES($1,$2,1,'create',$3)",[actor,growthId,{id:growthId,revision:1,conversationId:growthChat,assertion:'user_reported',sources:[{type:'message',id:growthRun.source_message_id,quote:growthQuote}]}])

        await holdChronologyWhile('deleted_conversations',()=>store.deleteConversation(actor,deletedChat))
        await holdChronologyWhile('memory_suppressions',()=>applyMemoryAction(actor,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'}))
        await holdChronologyWhile('growth_source_suppressions',()=>transaction(c=>applyGrowthAction(c,actor,growthId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})))
        await holdChronologyWhile('coach_source_withdrawals',()=>transaction(c=>invalidateCoachSources(c,actor,[withdrawalRun.source_message_id],true)))

        assert.equal((await pool.query('SELECT count(*)::int n FROM deleted_conversations WHERE user_id=$1 AND conversation_id=$2',[actor,deletedChat])).rows[0].n,1)
        assert.equal((await pool.query("SELECT count(*)::int n FROM memory_suppressions WHERE user_id=$1 AND source_message_id=$2 AND key='priorAttempts'",[actor,memoryRun.source_message_id])).rows[0].n,1)
        assert.equal((await pool.query("SELECT count(*)::int n FROM memory_suppressions WHERE user_id=$1 AND source_message_id=$2 AND key='scope:priorAttempts'",[actor,memoryRun.source_message_id])).rows[0].n,1)
        assert.equal((await pool.query('SELECT count(*)::int n FROM growth_source_suppressions WHERE user_id=$1 AND message_id=$2 AND quote=$3',[actor,growthRun.source_message_id,growthQuote])).rows[0].n,1)
        assert.equal((await pool.query('SELECT count(*)::int n FROM coach_source_withdrawals WHERE user_id=$1 AND message_id=$2',[actor,withdrawalRun.source_message_id])).rows[0].n,1)
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('an unscoped interview revision inherits only inside its source conversation',async()=>{
      const actor='interview-conversation-scope-'+randomUUID(),startupChat=randomUUID(),jobChat=randomUUID(),nextChat=randomUUID(),signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:startupChat,title:'SYNTHETIC startup interview revisions'})
        await store.createConversation(actor,{id:jobChat,title:'SYNTHETIC job interview revisions'})
        const persist=async(conversationId:string,text:string,createdAt:string)=>{
          const sourceRun=(await store.startRun(actor,conversationId,randomUUID(),text)).run
          await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
          await pool.query('UPDATE messages SET created_at=$3::timestamptz WHERE user_id=$1 AND id=$2::uuid',[actor,sourceRun.source_message_id,createdAt])
          await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',$6::timestamptz,$6::timestamptz)",[randomUUID(),actor,conversationId,text,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:text,range:{start:0,end:text.length}}]),createdAt])
          return sourceRun
        }
        await persist(startupChat,'创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步','2026-10-14T01:00:00.000Z')
        await persist(jobChat,'求职访谈，我想把访谈问题改成最近一次投递卡在哪里','2026-10-14T01:01:00.000Z')
        const revisionRun=await persist(startupChat,'把这个问题改成只问遇到了什么困难','2026-10-14T01:02:00.000Z')
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC scoped revision continuation'})
        const current='继续创业访谈，接下来怎么问？',run=(await store.startRun(actor,nextChat,randomUUID(),current)).run,staged:store.Staged={candidates:[],audit:[]}
        outputs.push((request:any)=>({reply:request.response_format.json_schema.schema.properties.reply?.enum?.[0]??'只问遇到了什么困难。'}))
        const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
        const route=staged.audit.find((entry:any)=>entry.phase==='edited_interview_route') as any
        assert.match(result.text,/只问遇到了什么困难/,JSON.stringify({result:result.text,route}))
        assert.equal(route?.selectedSourceId,revisionRun.source_message_id,JSON.stringify(route))
        assert.equal(route?.continuation,true,JSON.stringify(route))
        await store.finishRun(run,staged,result.text,result.usage,signal)
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('a deleted growth source cannot route an interview edit into a later conversation',async()=>{
      const actor='interview-deleted-growth-source-'+randomUUID(),sourceChat=randomUUID(),nextChat=randomUUID(),sourceText='创业访谈，我想把访谈问题改成只问预算',question='只问预算',signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      let currentRun:store.Run|undefined
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC deleted interview edit'})
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC retained interview continuation'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]')",[randomUUID(),actor,sourceChat,sourceText,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:sourceText,range:{start:0,end:sourceText.length}}])])
        await store.deleteConversation(actor,sourceChat)
        assert.ok(!(await growthContext(actor,nextChat)).some(item=>item.text.includes(question)),'deleted source is absent from cross-session growth context')
        currentRun=(await store.startRun(actor,nextChat,randomUUID(),'继续创业访谈，接下来怎么问？')).run
        const staged:store.Staged={candidates:[],audit:[]},before=requests.length
        outputs.push({reply:'请先说明你现在要继续哪次访谈，再决定下一问。'})
        const result=await engine({run:currentRun,staged,context:await store.contextForRun(currentRun),decision:null,signal,emit:()=>{}})
        assert.equal(requests.length,before+1)
        const route=staged.audit.find((entry:any)=>entry.phase==='edited_interview_route') as any
        assert.notEqual(route?.selectedSourceId,sourceRun.source_message_id,JSON.stringify(route))
        assert.doesNotMatch(result.text,new RegExp(question),JSON.stringify({result:result.text,route}))
        await store.finishRun(currentRun,staged,result.text,result.usage,signal);currentRun=undefined
      }finally{
        if(currentRun)await store.terminateRun(actor,currentRun.request_id,'cancelled','SYNTHETIC_DELETED_GROWTH_SOURCE').catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('Memory OFF keeps interview chronology inside the source conversation',async()=>{
      const actor='interview-memory-off-'+randomUUID(),sourceChat=randomUUID(),otherChat=randomUUID(),sourceText='创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',question='最近一次客户拒绝在哪一步',signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:false,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC memory-off source interview'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已按你的原话记录访谈问题。',null,signal)
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now()-interval '2 minutes',now()-interval '2 minutes')",[randomUUID(),actor,sourceChat,sourceText,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:sourceText,range:{start:0,end:sourceText.length}}])])
        await store.createConversation(actor,{id:otherChat,title:'SYNTHETIC memory-off unrelated conversation'})
        const later=(await store.startRun(actor,otherChat,randomUUID(),'后来我做了创业访谈')).run
        await store.finishRun(later,{candidates:[],audit:[]},'收到。',null,signal)
        const current='继续上次创业访谈。',run=(await store.startRun(actor,sourceChat,randomUUID(),current)).run,staged:store.Staged={candidates:[],audit:[]}
        outputs.push((request:any)=>({reply:request.response_format.json_schema.schema.properties.reply?.enum?.[0]??'继续核对原访谈。'}))
        const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
        const route=staged.audit.find((entry:any)=>entry.phase==='edited_interview_route') as any
        assert.match(result.text,new RegExp(question),JSON.stringify({result:result.text,route}))
        assert.equal(route?.continuation,true,JSON.stringify(route))
        await store.finishRun(run,staged,result.text,result.usage,signal)
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('a later user message supersedes an interview edit even when optional extraction omitted it',async()=>{
      const actor='interview-message-authority-'+randomUUID(),sourceChat=randomUUID(),nextChat=randomUUID(),sourceText='创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',question='最近一次客户拒绝在哪一步',signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC extracted interview edit'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已按你的原话记录访谈问题。',null,signal)
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now()-interval '2 minutes',now()-interval '2 minutes')",[randomUUID(),actor,sourceChat,sourceText,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:sourceText,range:{start:0,end:sourceText.length}}])])
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC omitted later interview report'})
        const later=(await store.startRun(actor,nextChat,randomUUID(),'我先整理了提纲，后来做了求职访谈。')).run
        await store.finishRun(later,{candidates:[],audit:[]},'收到。',null,signal)
        const current='我想继续上次访谈，接下来怎么问？',run=(await store.startRun(actor,nextChat,randomUUID(),current)).run,staged:store.Staged={candidates:[],audit:[]}
        outputs.push({reply:'先确认你现在要继续的是哪次访谈，再决定下一问。'})
        const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
        const route=staged.audit.find((entry:any)=>entry.phase==='edited_interview_route') as any
        assert.equal(route?.resolution,'selected',JSON.stringify(route))
        assert.equal(route?.selectedSourceId,sourceRun.source_message_id,JSON.stringify(route))
        assert.doesNotMatch(result.text,new RegExp(question),JSON.stringify({result:result.text,route}))
        assert.equal(route?.continuation,false,JSON.stringify(route))
        await store.finishRun(run,staged,result.text,result.usage,signal)
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('a corrected interview report cannot re-enter through raw chronology',async()=>{
      const actor='interview-corrected-chronology-'+randomUUID(),sourceChat=randomUUID(),reportChat=randomUUID(),nextChat=randomUUID(),sourceText='创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',question='最近一次客户拒绝在哪一步',positive='后来我做了创业访谈',signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC corrected interview edit'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now()-interval '3 minutes',now()-interval '3 minutes')",[randomUUID(),actor,sourceChat,sourceText,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:sourceText,range:{start:0,end:sourceText.length}}])])
        await store.createConversation(actor,{id:reportChat,title:'SYNTHETIC corrected interview report'})
        const reportRun=(await store.startRun(actor,reportChat,randomUUID(),positive)).run
        await store.finishRun(reportRun,{candidates:[],audit:[]},'收到。',null,signal)
        const reportItem=(await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now()-interval '2 minutes',now()-interval '2 minutes') RETURNING id,revision",[randomUUID(),actor,reportChat,positive,JSON.stringify([{type:'message',id:reportRun.source_message_id,quote:positive,range:{start:0,end:positive.length}}])])).rows[0]
        await pool.query("INSERT INTO growth_revisions(user_id,item_id,revision,action,snapshot) VALUES($1,$2,$3,'create',$4)",[actor,reportItem.id,reportItem.revision,JSON.stringify({id:reportItem.id,conversationId:reportChat,kind:'context',text:positive,assertion:'user_reported',status:'active',revision:reportItem.revision,sources:[{type:'message',id:reportRun.source_message_id,quote:positive,range:{start:0,end:positive.length}}],dependencies:[]})])
        await transaction(c=>applyGrowthAction(c,actor,reportItem.id,{requestId:randomUUID(),expectedRevision:reportItem.revision,action:'correct',text:'我没有做那次创业访谈'}))
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC corrected chronology continuation'})
        const current='继续上次创业访谈。',run=(await store.startRun(actor,nextChat,randomUUID(),current)).run,staged:store.Staged={candidates:[],audit:[]}
        outputs.push((request:any)=>({reply:request.response_format.json_schema.schema.properties.reply?.enum?.[0]??'继续核对原访谈。'}))
        const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
        const route=staged.audit.find((entry:any)=>entry.phase==='edited_interview_route') as any
        assert.match(result.text,new RegExp(question),JSON.stringify({result:result.text,route}))
        assert.equal(route?.continuation,true,JSON.stringify(route))
        await store.finishRun(run,staged,result.text,result.usage,signal)
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('an omitted interview report still supersedes after leaving the bounded message context',async()=>{
      const actor='interview-db-chronology-'+randomUUID(),sourceChat=randomUUID(),middleChat=randomUUID(),nextChat=randomUUID(),sourceText='创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',question='最近一次客户拒绝在哪一步',signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC persisted old interview edit'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now()-interval '3 minutes',now()-interval '3 minutes')",[randomUUID(),actor,sourceChat,sourceText,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:sourceText,range:{start:0,end:sourceText.length}}])])
        await store.createConversation(actor,{id:middleChat,title:'SYNTHETIC omitted report outside context window'})
        const later=(await store.startRun(actor,middleChat,randomUUID(),'后来我做了创业访谈')).run
        await store.finishRun(later,{candidates:[],audit:[]},'收到。',null,signal)
        for(let index=0;index<18;index++){
          const filler=(await store.startRun(actor,middleChat,randomUUID(),`普通近况${index+1}。`)).run
          await store.finishRun(filler,{candidates:[],audit:[]},'收到。',null,signal)
        }
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC database chronology continuation'})
        const current='我想继续上次访谈，接下来怎么问？',run=(await store.startRun(actor,nextChat,randomUUID(),current)).run,staged:store.Staged={candidates:[],audit:[]}
        outputs.push({reply:'先确认你现在要继续的是哪次访谈，再决定下一问。'})
        const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
        const route=staged.audit.find((entry:any)=>entry.phase==='edited_interview_route') as any
        assert.doesNotMatch(result.text,new RegExp(question),JSON.stringify({result:result.text,route}))
        assert.equal(route?.continuation,false,JSON.stringify(route))
        await store.finishRun(run,staged,result.text,result.usage,signal)
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('an omitted later interview clause in the edit message invalidates that edit by source offset',async()=>{
      const actor='interview-same-message-authority-'+randomUUID(),sourceChat=randomUUID(),nextChat=randomUUID(),edit='创业访谈，我想把访谈问题改成最近一次客户拒绝在哪一步',sourceText=edit+'。后来我做了求职访谈。',question='最近一次客户拒绝在哪一步',signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC same-message omitted interview report'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now()-interval '1 minute',now()-interval '1 minute')",[randomUUID(),actor,sourceChat,edit,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:edit,range:{start:0,end:edit.length}}])])
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC same-message chronology continuation'})
        const current='我想继续上次访谈，接下来怎么问？',run=(await store.startRun(actor,nextChat,randomUUID(),current)).run,staged:store.Staged={candidates:[],audit:[]}
        outputs.push({reply:'先确认你现在要继续的是哪次访谈，再决定下一问。'})
        const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
        const route=staged.audit.find((entry:any)=>entry.phase==='edited_interview_route') as any
        assert.equal(route?.resolution,'selected',JSON.stringify(route))
        assert.equal(route?.selectedSourceId,sourceRun.source_message_id,JSON.stringify(route))
        assert.doesNotMatch(result.text,new RegExp(question),JSON.stringify({result:result.text,route}))
        assert.equal(route?.continuation,false,JSON.stringify(route))
        await store.finishRun(run,staged,result.text,result.usage,signal)
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('an earlier interview clause in the same authoritative source does not invalidate its later edit',async()=>{
      const actor='interview-earlier-same-message-'+randomUUID(),sourceChat=randomUUID(),nextChat=randomUUID(),edit='创业访谈，我想把访谈问题改成只问预算',sourceText='创业背景。后来我做了创业访谈。'+edit+'。',question='只问预算',signal=new AbortController().signal
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:sourceChat,title:'SYNTHETIC earlier same-message interview report'})
        const sourceRun=(await store.startRun(actor,sourceChat,randomUUID(),sourceText)).run
        await store.finishRun(sourceRun,{candidates:[],audit:[]},'已记录。',null,signal)
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now()-interval '1 minute',now()-interval '1 minute')",[randomUUID(),actor,sourceChat,sourceText,JSON.stringify([{type:'message',id:sourceRun.source_message_id,quote:sourceText,range:{start:0,end:sourceText.length}}])])
        await store.createConversation(actor,{id:nextChat,title:'SYNTHETIC later edit continuation'})
        const current='继续上次创业访谈。',run=(await store.startRun(actor,nextChat,randomUUID(),current)).run,staged:store.Staged={candidates:[],audit:[]}
        outputs.push((request:any)=>({reply:request.response_format.json_schema.schema.properties.reply?.enum?.[0]??question}))
        const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
        const route=staged.audit.find((entry:any)=>entry.phase==='edited_interview_route') as any
        assert.equal(route?.resolution,'selected',JSON.stringify(route))
        assert.equal(route?.selectedSourceId,sourceRun.source_message_id,JSON.stringify(route))
        assert.match(result.text,new RegExp(question),JSON.stringify({result:result.text,route}))
        assert.equal(route?.continuation,true,JSON.stringify(route))
        await store.finishRun(run,staged,result.text,result.usage,signal)
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('OH prerequisite inquiry commits once without hardening a soft objective',async()=>{
      const actor='oh-prerequisite-'+randomUUID(),chat=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:chat,title:'SYNTHETIC source-bound prerequisite inquiry'})
        const text='我自己更在意留在目前城市。请给一个最多四小时核对岗位学历门槛的小验证。'
        const run=(await store.startRun(actor,chat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]},signal=new AbortController().signal
        const reply='用最多四小时查看一条本地岗位信息，核对研究生学历是否为该留城岗位的必要条件；只记录该岗位要求，不推整座城市的门槛，到时停止。'
        const before=requests.length;outputs.push({reply})
        const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
        assert.equal(requests.length-before,1);assert.equal(result.text,reply)
        await store.finishRun(run,staged,result.text,result.usage,signal)
        const count=(await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[actor,run.request_id])).rows[0].n
        assert.equal(count,1)
        const next=randomUUID();await store.createConversation(actor,{id:next,title:'SYNTHETIC unchanged soft preference'})
        assert.ok((await growthContext(actor,next)).some(g=>g.kind==='preference'&&g.text==='我自己更在意留在目前城市'))
      }finally{await pool.query('DELETE FROM experiences WHERE user_id=$1',[actor]);await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('current status-only reports commit without a provider, keep prior trial evidence and respect Memory OFF',async()=>{
      const actor='source-status-'+randomUUID(),firstChat=randomUUID(),secondChat=randomUUID(),offChat=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:firstChat,title:'SYNTHETIC prior participant report'})
        const prior=(await store.startRun(actor,firstChat,randomUUID(),'老师还没有回复那封邮件；另一位同学试过我做的表格后明确说不适合他。')).run
        const priorStaged:store.Staged={candidates:[],audit:[]},signal=new AbortController().signal
        outputs.push({reply:'老师未回复邮件；另一位同学试过表格后说不适合。各次原报告保留，未说明的其他状态不补写。'})
        const priorResult=await engine({run:prior,staged:priorStaged,context:await store.contextForRun(prior),decision:null,signal,emit:()=>{}})
        const wire=requests.at(-1),system=wire.messages.find((message:any)=>message.role==='system').content
        const evidenceRule='participantReports每项是一条来源报告，不是一个独立人物或新增反馈样本'
        assert.equal(system.split(evidenceRule).length-1,1,'the actual engine system prompt carries stable evidence rules once')
        const metadata=JSON.parse(wire.messages.find((message:any)=>message.role==='user').content)
        assert.ok(!metadata.currentTask.responseScope.rules.some((rule:string)=>rule.startsWith(evidenceRule)),'the wire metadata keeps the same deduplication')
        await store.finishRun(prior,priorStaged,priorResult.text,priorResult.usage,signal)
        const sourceEngine=createTurnEngine({capabilityVerified:()=>false,providerCallObserver:{before(){throw new Error('SOURCE_STATUS_MUST_NOT_DISPATCH')},after(){}}})
        const facts='回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。'
        async function update(chat:string){
          await store.createConversation(actor,{id:chat,title:'SYNTHETIC source status update'})
          const run=(await store.startRun(actor,chat,randomUUID(),facts+'请只更新各自相关状态。')).run
          const staged:store.Staged={candidates:[],audit:[]},before=requests.length
          const result=await sourceEngine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
          assert.equal(requests.length,before,'source-only updates must not ask a model to invent an actor link')
          assert.match(result.text,/老师：已回复[\s\S]*老师后来回复[\s\S]*同学表格仍是明确不适合他/,'source-only updates synthesize the two updated participant states')
          assert.equal((result.usage as any).llmCallCount,0)
          await store.finishRun(run,staged,result.text,result.usage,signal)
          return run
        }
        const latest=await update(secondChat),memory=await growthContext(actor,secondChat)
        assert.ok(memory.some(item=>item.text.includes('试过我做的表格')),'a later partial report cannot erase prior trial evidence')
        const current=memory.filter(item=>item.sources.some(source=>source.type==='message'&&source.id===latest.source_message_id))
        assert.ok(current.some(item=>item.text.includes('后来回复')))
        assert.ok(current.every(item=>facts.includes(item.text)),'new memories are exact current reports, never inferred people or sample counts')
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:false,expectedRevision:1})
        await update(offChat)
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1 AND conversation_id=$2',[actor,offChat])).rows[0].n,0)
      }finally{
        await pool.query('DELETE FROM experiences WHERE user_id=$1',[actor])
        await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
      }
    })
    await t.test('an omitted positive self-explanation is committed verbatim and follows Memory ON across sessions',async()=>{
      const actor='explanation-'+randomUUID(),chat=randomUUID(),next=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:chat,title:'SYNTHETIC owned explanation'})
        const quote='我当时真正轻松的是自己不用反复找'
        const run=(await store.startRun(actor,chat,randomUUID(),'更正：同学少问一次只是结果，不代表我因此有成就感；'+quote+'。只更新受影响的理解，不安排动作。')).run
        const staged:store.Staged={candidates:[],audit:[]},signal=new AbortController().signal
        outputs.push({reply:'你明确说轻松来自自己不用反复找，不能把同学少问一次等同于成就感；是否能在下一次重现仍未知。'})
        const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
        await store.finishRun(run,staged,result.text,result.usage,signal)
        await store.createConversation(actor,{id:next,title:'SYNTHETIC cross-session explanation'})
        const memory=await growthContext(actor,next),saved=memory.find(item=>item.text===quote)
        assert.ok(saved,'the positive explanation must not disappear when the model returns reply only')
        assert.equal(saved.assertion,'user_reported');assert.equal(saved.kind,'context')
        assert.ok(saved.sources.some(source=>source.type==='message'&&source.id===run.source_message_id))
        for(const value of ['我发现同学轻松是因为不用反复找。','我觉得他感到轻松是因为不用反复找。','我希望你能帮我分析我为什么感到轻松。','我希望你可以帮我分析我为什么感到轻松。','我想麻烦你帮我分析我为什么感到轻松。']){
          const negativeChat=randomUUID();await store.createConversation(actor,{id:negativeChat,title:'SYNTHETIC source ownership negative'})
          const negativeRun=(await store.startRun(actor,negativeChat,randomUUID(),value)).run
          outputs.push({reply:'目前只能依据你明确报告的内容，不能补充尚未确认的解释。'})
          const negativeStage:store.Staged={candidates:[],audit:[]},negativeSignal=new AbortController().signal
          const negative=await engine({run:negativeRun,staged:negativeStage,context:await store.contextForRun(negativeRun),decision:null,signal:negativeSignal,emit:()=>{}})
          await store.finishRun(negativeRun,negativeStage,negative.text,negative.usage,negativeSignal)
          assert.ok(!(await growthContext(actor,negativeChat)).some(item=>item.kind==='context'&&item.text===value.replace(/。$/,'')),value)
        }
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:false,expectedRevision:1})
        assert.ok(!(await growthContext(actor,next)).some(item=>item.text===quote),'Memory OFF hides the prior-session source')
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('actual OG sources persist across sessions; failed mock prose is retained for mandatory real generation acceptance',async()=>{
      const turns=JSON.parse(readFileSync(new URL('../fixtures/og-known-goals-and-fit.json',import.meta.url),'utf8')).turns
      for(const prefix of ['C3','C6']){
        const actor='og-'+randomUUID(),chat=randomUUID(),next=randomUUID()
        await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
        try{
          await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
          await store.createConversation(actor,{id:chat,title:'SYNTHETIC OG source reports'})
          await store.createConversation(actor,{id:next,title:'SYNTHETIC OG cross-session readback'})
          const sequence=turns.filter((x:any)=>x.id.startsWith(prefix+'-')).slice(0,prefix==='C3'?5:6)
          for(let i=0;i<sequence.length;i++){
            const x=sequence[i],run=(await store.startRun(actor,i===sequence.length-1?next:chat,randomUUID(),x.user)).run
            const staged:store.Staged={candidates:[],audit:[]},signal=new AbortController().signal,frames:Record<string,unknown>[]=[]
            const before=requests.length;outputs.push((request:any)=>({reply:request.response_format.json_schema.schema.properties.reply?.enum?.[0]??x.assistant}))
            const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:f=>{frames.push(f)}})
            assert.equal(requests.length-before,1)
            await store.finishRun(run,staged,result.text,result.usage,signal)
            const saved=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[actor,run.request_id])).rows
            assert.equal(saved.length,1);assert.equal(saved[0].content,result.text)
            if(i!==sequence.length-1)continue
            const visible=frames.filter(f=>f.type==='draft').map(f=>String(f.text)).join('\n')+'\n'+result.text
            if(prefix==='C3'){
              assert.match(result.text,/如果这个节奏你能接受，它仍符合/,'conditional relationships are not repaired by the lexical guard; the retained semantic failure must be rejected by real acceptance if generated again')
            }else{
              assert.match(result.text,/你真正想.*还是/,'retained failed mock prose is not semantic acceptance; no new lexical deletion');assert.match(result.text,/20秒/);assert.match(result.text,/是否稳定复现/)
              const known=(await growthContext(actor,next)).filter(x=>x.kind==='goal'&&x.status==='active').map(x=>x.text)
              assert.ok(known.some(x=>x.includes('更快看出哪些信息关键')))
              assert.ok(known.some(x=>x.includes('减少自己反复找东西的时间')))
            }
          }
          if(prefix==='C6'){
            const questionChat=randomUUID();await store.createConversation(actor,{id:questionChat,title:'SYNTHETIC explicit goal reconsideration'})
            const questionRun=(await store.startRun(actor,questionChat,randomUUID(),'只问一个问题，帮我重新想清楚这两个目标。')).run
            const questionStage:store.Staged={candidates:[],audit:[]},questionSignal=new AbortController().signal
            const question='你现在想先弄清这两个目标的哪个环节？'
            outputs.push({reply:question})
            const result=await engine({run:questionRun,staged:questionStage,context:await store.contextForRun(questionRun),decision:null,signal:questionSignal,emit:()=>{}})
            assert.equal(result.text,question,'stage readback correction must preserve an explicitly requested exploration question')
            await store.finishRun(questionRun,questionStage,result.text,result.usage,questionSignal)
            const ordinaryChat=randomUUID();await store.createConversation(actor,{id:ordinaryChat,title:'SYNTHETIC known goals without reconsideration permission'})
            assert.ok((await growthContext(actor,ordinaryChat)).filter(g=>g.kind==='goal'&&g.status==='active').length>=2)
            const ordinaryRun=(await store.startRun(actor,ordinaryChat,randomUUID(),'只问一个问题，看看最近的进展。')).run
            const ordinaryStage:store.Staged={candidates:[],audit:[]},unsupportedChoice='你真正想要的是减少自己反复找东西的时间还是更快看出哪些信息关键？';outputs.push({reply:unsupportedChoice})
            await assert.rejects(engine({run:ordinaryRun,staged:ordinaryStage,context:await store.contextForRun(ordinaryRun),decision:null,signal:questionSignal,emit:()=>{}}),{code:'BOUNDED_REPLY_INVALID'})
            await store.terminateRun(actor,ordinaryRun.request_id,'failed','BOUNDED_REPLY_INVALID')
          }
          if(prefix==='C6'){
            const declaredChat=randomUUID();await store.createConversation(actor,{id:declaredChat,title:'SYNTHETIC explicit current goal'})
            const text='我现在的目标是考研。只给一句阶段理解，不排计划。',run=(await store.startRun(actor,declaredChat,randomUUID(),text)).run
            const staged:store.Staged={candidates:[],audit:[]},signal=new AbortController().signal
            outputs.push({reply:'你当前明确把目标放在考研，专业、学校和备考时间尚未说明。'})
            const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
            await store.finishRun(run,staged,result.text,result.usage,signal)
            const saved=(await growthContext(actor,declaredChat)).find(g=>g.kind==='goal'&&g.text==='我现在的目标是考研')
            assert.ok(saved);assert.equal(saved.assertion,'user_reported')
            assert.ok(saved.sources.some(s=>s.type==='message'&&s.id===run.source_message_id))
            const verifyChat=randomUUID();await store.createConversation(actor,{id:verifyChat,title:'SYNTHETIC current goal continuity'})
            assert.ok((await growthContext(actor,verifyChat)).some(g=>g.id===saved.id))
          }
          await createGrowthItem(actor,{requestId:randomUUID(),conversationId:chat,kind:'context',text:'我确认它符合我的偏好。'})
          await setMemorySettings(actor,{requestId:randomUUID(),enabled:false,expectedRevision:1})
          const offChat=randomUUID();await store.createConversation(actor,{id:offChat,title:'SYNTHETIC OG memory off'})
          assert.equal((await growthContext(actor,offChat)).length,0)
          const offRun=(await store.startRun(actor,offChat,randomUUID(),'先说明这个候选的适配是否有依据，不安排动作。')).run
          const offStage:store.Staged={candidates:[],audit:[]},offSignal=new AbortController().signal
          const offReply='这个候选是否具备你需要的属性仍未说明，暂不能判断整体适配。'
          outputs.push({reply:offReply})
          const offResult=await engine({run:offRun,staged:offStage,context:await store.contextForRun(offRun),decision:null,signal:offSignal,emit:()=>{}})
          assert.equal(offResult.text,offReply)
          assert.ok(!JSON.stringify(requests.at(-1).messages).includes('我确认它符合我的偏好'))
          await store.finishRun(offRun,offStage,offResult.text,offResult.usage,offSignal)
          if(prefix==='C6'){
            const offQuestionChat=randomUUID();await store.createConversation(actor,{id:offQuestionChat,title:'SYNTHETIC OFF question source'})
            const offQuestionRun=(await store.startRun(actor,offQuestionChat,randomUUID(),'只问一个问题，帮我重新想清楚这两个目标。')).run
            const offQuestionStage:store.Staged={candidates:[],audit:[]}
            const question='你真正想要的是减少自己反复找东西的时间还是更快看出哪些信息关键？'
            outputs.push({reply:question})
            await assert.rejects(engine({run:offQuestionRun,staged:offQuestionStage,context:await store.contextForRun(offQuestionRun),decision:null,signal:offSignal,emit:()=>{}}),{code:'REPLY_QUESTION_PREMISE_UNGROUNDED'})
            assert.ok(!JSON.stringify(requests.at(-1).messages).includes('减少自己反复找东西的时间'))
            await store.terminateRun(actor,offQuestionRun.request_id,'failed','REPLY_QUESTION_PREMISE_UNGROUNDED')
          }
        }finally{
          await pool.query('DELETE FROM experiences WHERE user_id=$1',[actor])
          await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
        }
      }
    })
    await t.test('actual OE open type question keeps its topic through engine and one commit',async()=>{
      const actual=JSON.parse(readFileSync(new URL('../fixtures/oe-open-question-failure.json',import.meta.url),'utf8'))
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC actual OE open question'})
      const input=await prepare(actual.user,chat),before=requests.length
      outputs.push(actual.raw)
      await assert.rejects(engine(input),{code:'REPLY_QUESTION_PREMISE_UNGROUNDED'})
      assert.equal(requests.length-before,1)
      await store.terminateRun(user,input.run.request_id,'failed','REPLY_QUESTION_PREMISE_UNGROUNDED')
      const good=await prepare(actual.user,chat),expected='你说的“自由”具体指什么？'
      outputs.push({reply:expected});const result=await engine(good)
      assert.equal(result.text,expected)
      await store.finishRun(good.run,good.staged,result.text,result.usage,good.signal)
      const saved=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,good.run.request_id])).rows
      assert.equal(saved.length,1);assert.equal(saved[0].content,expected)
    })
    await t.test('nonpriority is never committed as exclusion through the normal engine',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC exact preference modality'})
      const input=await prepare('我不在意当老板。请只分析，不修改档案，不创建任务。',chat),before=requests.length
      outputs.push({reply:'你排除了当老板。'})
      await assert.rejects(engine(input),{code:'REPLY_PREFERENCE_HARDENED'})
      assert.equal(requests.length-before,1)
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,input.run.request_id])).rows[0].n,0)
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_MODALITY_REJECTION')
      const good=await prepare('我不在意当老板。请按这句话说明，不推断职业适配。',chat),reply='你没有把当老板列为重点；是否排除当老板仍未知。'
      outputs.push({reply});const result=await engine(good);assert.equal(result.text,reply)
      await store.finishRun(good.run,good.staged,result.text,result.usage,good.signal)
    })
    await t.test('the actual live no-task request still receives its explicitly requested question',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC explicit question no task'})
      const text='请先问一个问题，了解我在课程任务中如何安排专注时间。不要补出我没说过的偏好，不安排任务。'
      const input=await prepare(text,chat),before=requests.length,reply='你在课程任务里通常如何安排开始专注的时间？'
      outputs.push({reply});const result=await engine(input)
      assert.equal(requests.length-before,1);assert.equal(result.text,reply)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.equal((await store.listConversations(user)).find(x=>x.id===chat)!.messages.at(-1)!.content,reply)
    })
    await t.test('a requested single question cannot commit an unrelated generated pricing plan',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC one question only'})
      const input=await prepare('想了解实习岗位，先帮我选一个值得了解的问题。',chat),before=requests.length
      outputs.push({reply:'你整理排版的那份课程资料，有没有被小组外的人看过或用过？\n\n两小时可以分三步：找需求、定价格、写介绍。'})
      await assert.rejects(engine(input),{code:'REPLY_SINGLE_QUESTION_INVALID'})
      assert.equal(requests.length-before,1,'one failed generation, never an automatic paid repair')
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,input.run.request_id])).rows[0].n,0)
      await store.terminateRun(user,input.run.request_id,'failed','SYNTHETIC_ONE_QUESTION_REJECTION')
    })
    await t.test('actual OD causal inference stays out of drafts and the calibrated inference commits once',async()=>{
      const capture=JSON.parse(readFileSync(new URL('../fixtures/od-semantic-preview-failures.json',import.meta.url),'utf8'))
      const actual=capture.turns.find((x:any)=>x.chain==='no-direction'&&x.index===2)
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC actual OD inference preview'})
      const input=await prepare(actual.user,chat),before=requests.length,frames:Record<string,unknown>[]=[]
      input.emit=event=>{frames.push(event)}
      outputs.push(actual.raw)
      await assert.rejects(engine(input),{code:'REPLY_CAUSALITY_UNGROUNDED'})
      assert.equal(requests.length-before,1)
      assert.ok(frames.filter(f=>f.type==='draft').every(f=>!String(f.text).includes('支持提前分类能减少沟通')))
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,input.run.request_id])).rows[0].n,0)
      await store.terminateRun(user,input.run.request_id,'failed','REPLY_CAUSALITY_UNGROUNDED')
      const good=await prepare(actual.user,chat),reply='这次先定三条规则后同学少问一次，暂时只能视为一次共同出现的结果；是否存在因果、你找资料的时间是否缩短，仍未知。'
      outputs.push({reply});const result=await engine(good);assert.equal(result.text,reply)
      await store.finishRun(good.run,good.staged,result.text,result.usage,good.signal)
    })
    await t.test('an internal draft without a delivered answer is rejected once instead of saved as an invented unknown',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC empty draft guard'})
      const input=await prepare('我现在更在意专注时段。依据这条反馈更新自由的理解；现在不继续行动。',chat),before=requests.length
      outputs.push({reply:'目前可以确认的目标：【待补】'})
      await assert.rejects(engine(input),{code:'REPLY_INCOMPLETE_OR_INTERNAL'})
      assert.equal(requests.length-before,1,'no paid replacement generation')
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND conversation_id=$2 AND role=$3',[user,chat,'assistant'])).rows[0].n,0)
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1 AND conversation_id=$2',[user,chat])).rows[0].n,0)
      assert.equal(input.staged.growth,undefined)
      await store.terminateRun(user,input.run.request_id,'failed','REPLY_INCOMPLETE_OR_INTERNAL')
    })
    await t.test('withheld control preview is absent from generation and mixed control still commits atomically',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC control without preview'})
      const input=await prepare('先暂停考研方向，这周不安排任务。我自己更在意留在目前城市。请说明当前理解，不删除事实。',chat)
      outputs.push({reply:'你更在意留在目前城市；考研建议已暂停，本周不安排任务，是否适合继续读研仍未知。'})
      const before=requests.length,result=await engine(input)
      assert.equal(requests.length-before,1)
      assert.equal(requests.at(-1).response_format.json_schema.schema.properties.lead,undefined)
      assert.ok(!requests.at(-1).response_format.json_schema.schema.required.includes('lead'))
      assert.ok(requests.at(-1).messages[0].content.includes('本轮schema未开放lead'))
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.ok(saved.directionControls?.changedScopes.includes('postgraduate_exam'))
    })
    await t.test('already canonical two-factor reply is selected before generation without a duplicate lead',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC distinction without duplicate'})
      const text='接着羽毛球那次体验。我想保留这种不被评价的陪伴，但不确定是运动本身还是这个室友带来的。请给暂定理解和一个很小的区分办法。'
      const input=await prepare(text,chat),expected=boundedDistinctionReply(text)
      assert.ok(expected)
      outputs.push((request:any)=>({reply:request.response_format.json_schema.schema.properties.reply.enum[0]}))
      const result=await engine(input),schema=requests.at(-1).response_format.json_schema.schema
      assert.equal(schema.properties.lead,undefined)
      assert.deepEqual(schema.properties.reply.enum,[expected])
      assert.equal(result.text,expected)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('repeated JSON tail is ignored while provider EOS usage and normal commit guards are retained',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC repeated transport'})
      const input=await prepare('我今天想聊一下课程。',chat),before=requests.length
      let expectedReply=''
      outputs.push((request:any)=>{expectedReply=request.response_format.json_schema.schema.properties.reply?.enum?.[0]??'你想先聊课程里的哪件事？';return {syntheticRepeatedFrame:{reply:expectedReply}}})
      const result=await engine(input)
      assert.equal(requests.length-before,1)
      assert.equal(result.text,expectedReply)
      assert.equal((result.usage as any).calls[0].usageCompleteness,'complete')
      assert.equal((result.usage as any).calls[0].outputTokens,100)
      assert.ok(!input.staged.audit.some((row:any)=>row.phase==='host_structured_frame_terminated'))
      assert.ok(input.staged.audit.some((row:any)=>row.phase==='provider_stream_assembly'&&row.streamMatchesResult===false))
      const stages:any=input.staged.audit.find((row:any)=>row.phase==='provider_output_stages')
      assert.ok(stages&&stages.streamChars>0&&typeof stages.resultChars==='number'&&typeof stages.resultEqualsNormalized==='boolean')
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      const saved=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,input.run.request_id])).rows
      assert.equal(saved[0].content,expectedReply)
    })
    await t.test('a complete frame with missing provider EOS finishes after grace with unknown usage',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC held frame'})
      const input=await prepare('我今天想聊一下课程。',chat),before=requests.length
      outputs.push((request:any)=>({syntheticHeldFrame:{reply:request.response_format.json_schema.schema.properties.reply.enum[0]}}))
      const result=await engine(input)
      assert.equal(requests.length-before,1)
      assert.equal((result.usage as any).calls[0].usageCompleteness,'unavailable')
      assert.ok(input.staged.audit.some((row:any)=>row.phase==='host_structured_frame_terminated'))
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('user cancellation wins even after a complete frame and creates no assistant commit',async()=>{
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC cancelled frame'})
      const input=await prepare('我今天想聊一下课程。',chat),cancel=new AbortController()
      input.signal=cancel.signal
      outputs.push((request:any)=>({syntheticHeldFrame:{reply:request.response_format.json_schema.schema.properties.reply.enum[0]}}))
      afterSyntheticFrame=()=>setTimeout(()=>cancel.abort(),20)
      try{await assert.rejects(engine(input))}finally{afterSyntheticFrame=undefined;await store.terminateRun(user,input.run.request_id,'cancelled','SYNTHETIC_USER_CANCEL')}
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,input.run.request_id])).rows[0].n,0)
    })
    await t.test('feedback and shorter material share one call and persist together',async()=>{
      const input=await prepare('我给学长发了请教消息，他还没回复，把消息改短。')
      const material='学长，方便说说你最初怎么选实习方向的吗？'
      outputs.push({reply:'没有回复还不能判断原因。可以先把问题缩到一个具体点：',event:{target:{operation:'create',title:'向学长请教实习方向',source:{clauseId:'c0'}},nodes:[{kind:'fact',source:{clauseId:'c1'}}],action:{operation:'create',draft:{content:material}}},growthUpdates:[{target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'completed',source:{clauseId:'c0'}},{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c1'}}],experienceCandidate:{source:{clauseIds:['c0','c1','c2']},action:{clauseId:'c0'},result:{clauseId:'c1'}}})
      const before=requests.length,result=await engine(input)
      assert.equal(requests.length-before,1)
      assert.match(result.text,/不能判断原因/)
      assert.ok(result.text.includes(material))
      assert.equal((requests.at(-1).response_format.json_schema.schema.properties.reply as any).enum,undefined)
      const outgoingEvent=requests.at(-1).response_format.json_schema.schema.properties.event
      const createTarget=outgoingEvent.properties.target
      assert.equal(createTarget.properties.operation.const,'create')
      assert.ok(createTarget.properties.source.properties.clauseId.enum.includes('c0'))
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      event=saved.event
      assert.equal(event.actions[0].draft.content,material)
      const rows=(await pool.query('SELECT text FROM growth_items WHERE user_id=$1',[user])).rows
      assert.ok(rows.some(row=>row.text==='我给学长发了请教消息'))
      assert.ok(rows.some(row=>row.text==='他还没回复'))
      const experiences=(await pool.query('SELECT source_quote FROM experiences WHERE user_id=$1 AND source_message_id=$2',[user,input.run.source_message_id])).rows
      assert.equal(experiences[0]?.source_quote,'我给学长发了请教消息，他还没回复')
    })
    await t.test('a later feedback question does not authorize modifying a previously requested material',async()=>{
      const input=await prepare('我又问了一个同学，他也没有给出原因。下一步怎么判断？')
      const reply='目前原因仍未知；先核对收到的具体反馈，不把猜测当结果。'
      outputs.push({reply,event:{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId:event.actions[0].id,expectedRevision:event.actions[0].revision,draft:{content:'未经当前请求擅自修改的消息'}}}})
      const result=await engine(input)
      assert.equal(result.text,reply)
      assert.ok(input.staged.audit.some((row:any)=>row.phase==='unsolicited_material_dropped'))
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('new conversation receives real feedback and Memory OFF removes it',async()=>{
      const next=randomUUID()
      await store.createConversation(user,{id:next,title:'SYNTHETIC follow-up'})
      const input=await prepare('上次给学长的消息还记得吗？',next)
      outputs.push({reply:'你报告过发了请教消息，还没有收到回复；原因仍未知。'})
      const result=await engine(input)
      const state=JSON.parse(requests.at(-1).messages[1].content)
      assert.ok((JSON.stringify(state.growth)+JSON.stringify(state.growthBackground)+JSON.stringify(state.events)).includes('他还没回复'),JSON.stringify(state))
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      await setMemorySettings(user,{requestId:randomUUID(),enabled:false,expectedRevision:Number((await pool.query('SELECT revision FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]?.revision??0)})
      const off=randomUUID()
      await store.createConversation(user,{id:off,title:'SYNTHETIC memory off'})
      const offInput=await prepare('现在先聊一个新问题。',off)
      outputs.push({reply:'好，想聊什么？'})
      const offResult=await engine(offInput)
      const offState=JSON.parse(requests.at(-1).messages[1].content)
      assert.ok(!JSON.stringify(offState).includes('他还没回复'))
      await store.finishRun(offInput.run,offInput.staged,offResult.text,offResult.usage,offInput.signal)
      await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:2})
    })
    await t.test('review does not rewrite declined material or force a fixed response',async()=>{
      const input=await prepare('填过表但卡住了，别重写，我不知道选哪个岗位。')
      const reply='卡住的是岗位选择，先保留你已经填的表。里面哪两个岗位让你拿不准？'
      outputs.push({reply,event:{target:{operation:'create',title:'岗位比较受阻',source:{messageId:input.run.source_message_id,quote:'填过表但卡住了'}},nodes:[{kind:'fact',source:{messageId:input.run.source_message_id,quote:'填过表但卡住了'}}],action:{operation:'create',draft:{content:'不被用户要求的第二份表格'}}}})
      const before=requests.length,result=await engine(input)
      assert.equal(requests.length-before,1)
      assert.equal(result.text,reply)
      assert.equal(input.staged.coach?.actionId,undefined)
      await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
    })
    await t.test('a contribution paragraph can select multiple verified facts without becoming a one-sentence mode',async()=>{
      const input=await prepare('换一件事。我在课程小组里负责整理资料，我负责排版。帮我写一段只包含本人贡献的作品描述。')
      outputs.push((request:any)=>{
        const state=JSON.parse(request.messages[1].content)
        const selected=state.growthCatalogue.filter((fact:any)=>fact.text==='我在课程小组里负责整理资料'||fact.text==='我负责排版')
        assert.equal(selected.length,2)
        return {reply:'只保留你明确负责的两部分，其他成果不补写。',event:{target:{operation:'create',title:'课程小组本人贡献',source:{messageId:input.run.source_message_id,quote:'我在课程小组里负责整理资料，我负责排版'}},action:{operation:'create',draft:{kind:'resume_portfolio',selectedFactIds:[selected[0].catalogueId,...selected.map((fact:any)=>fact.catalogueId)]}}}}
      })
      const result=await engine(input)
      assert.ok(result.text.includes('我在课程小组里负责整理资料'))
      assert.ok(result.text.includes('我负责排版'))
      assert.ok(!result.text.includes('交付终版'))
      assert.equal(requests.at(-1).response_format.json_schema.schema.properties.reply.enum,undefined)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.ok(String(saved.event!.actions[0]!.draft!.content).includes('我负责排版'))
    })
    await t.test('a later normal-entry draft reuses an exact contribution from conversation history without another model call',async()=>{
      const actor='ordinary-history-'+randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      await setMemorySettings(actor,{requestId:randomUUID(),enabled:false,expectedRevision:0})
      const chat=randomUUID()
      await store.createConversation(actor,{id:chat,title:'SYNTHETIC prior contribution material'})
      const prepareHistory=async(text:string)=>{
        const run=(await store.startRun(actor,chat,randomUUID(),text)).run
        return {run,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:(_event:Record<string,unknown>)=>{}}
      }
      const first=await prepareHistory('我是成年大学生，想先了解就业和自由职业。我在课程小组里负责整理资料和排版，代码是队友做的。目前没有客户，每周能花两小时。先帮我选一个值得了解的问题。')
      outputs.push({reply:'这个实际岗位每天最常做的任务是什么？'})
      const firstResult=await engine(first)
      await store.finishRun(first.run,first.staged,firstResult.text,firstResult.usage,first.signal)

      const draft=await prepareHistory('我想先了解实习岗位，别把小组成果都算成我的能力。帮我写一段只包含本人贡献的作品描述。')
      const callsBefore=requests.length
      const result=await engine(draft)
      assert.equal(requests.length,callsBefore,'one exact current-conversation contribution is a server-rendered material decision')
      assert.equal(result.text,'我在课程小组里负责整理资料和排版。')
      assert.ok(draft.staged.audit.some((row:any)=>row.phase==='explicit_material_rendered_without_generation'&&row.basis==='single_verified_literal_contribution'))
      const saved=await store.finishRun(draft.run,draft.staged,result.text,result.usage,draft.signal)
      const savedEvent=saved.event as any
      assert.equal(savedEvent?.actions[0]?.draft?.content,'我在课程小组里负责整理资料和排版。')
      assert.equal(savedEvent?.actions[0]?.draft?.materialEvidence?.[0]?.sourceRef?.type,'message')
    })
    await t.test('a recall question does not close an independent new goal in the same message',async()=>{
      const input=await prepare('你记得我之前说过什么吗？我现在决定先就业。')
      outputs.push({reply:'你报告过联系和课程分工；接下来先按就业这个新重点来。',growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c1'}}]})
      const result=await engine(input)
      assert.ok(requests.at(-1).response_format.json_schema.schema.properties.growthUpdates)
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.ok(saved.growthIds.length)
      const rows=(await pool.query('SELECT text FROM growth_items WHERE user_id=$1 AND id=ANY($2::uuid[])',[user,saved.growthIds])).rows
      assert.ok(rows.some(row=>row.text==='我现在决定先就业'))
    })
    await t.test('requested slack and native plan remain authoritative in one generation',async()=>{
      const plan=(minutes:number)=>({reply:'先处理课程作业，具体题量尚未知；保留余量再调整。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'constraint',source:{clauseId:'c0'},timeEvidence:{kind:'calendar_week',which:'this',clauseId:'c0'}}],weeklyPlan:{target:{operation:'create'},availableMinutes:120,period:'this_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'核对课程作业并尝试一道题',minutes,directionScopes:[]}]}})
      const valid=await prepare('这周还剩两小时，帮我安排课程作业，不要全排满。')
      const withRest=plan(90)
      withRest.weeklyPlan.items.push({action:'buffer_rest',minutes:30,directionScopes:[]})
      outputs.push(withRest)
      const result=await engine(valid)
      assert.ok(result.text.includes('未安排：30分钟。'))
      assert.equal(valid.staged.weeklyPlan?.input.items.length,1)
      assert.equal(valid.staged.weeklyPlan?.input.items[0]?.minutes,90)
      await store.finishRun(valid.run,valid.staged,result.text,result.usage,valid.signal)
      const invalid=await prepare('这周还剩两小时，帮我安排课程作业，不要全排满。')
      outputs.push(plan(120))
      const before=requests.length
      await assert.rejects(engine(invalid),error=>Boolean((error as any).code==='WEEKLY_PLAN_SLACK_REQUIRED'))
      assert.equal(requests.length-before,1)
      await store.terminateRun(user,invalid.run.request_id,'failed','WEEKLY_PLAN_SLACK_REQUIRED')
    })
    await t.test('the preserved course plan cannot invent a degree direction',async()=>{
      const input=await prepare('我是成年大学生，目前期末课程优先，备考只保留少量时间。这周还剩两小时，帮我安排课程作业和复习，不要全排满。')
      outputs.push({reply:'两小时排课程作业加少量复习，留缓冲不排满。具体题目和章节仍未知。',weeklyPlan:{target:{operation:'create'},availableMinutes:120,period:'this_week',budgetRef:{updateIndex:0},basis:[{updateIndex:1},{updateIndex:2},{updateIndex:3}],items:[{action:'课程作业',minutes:60,directionScopes:['undergraduate_upgrade']},{action:'期末复习',minutes:30,directionScopes:['undergraduate_upgrade']},{action:'缓冲/休息',minutes:30,directionScopes:['undergraduate_upgrade']}]}})
      await assert.rejects(engine(input),{code:'WEEKLY_PLAN_SCOPE_UNGROUNDED'})
      await store.terminateRun(user,input.run.request_id,'failed','WEEKLY_PLAN_SCOPE_UNGROUNDED')
    })
    await t.test('a named reviewed method keeps its owned task and failure continuation even when the model only returns prose',async()=>{
      const read=(name:string)=>readFileSync('.planning/research/evergreen/'+name,'utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line))
      const cards=read('KB_GUIDES.jsonl').filter(card=>card.guide?.reviewStatus==='approved')
      await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
      const card=cards.find(card=>card.title==='从示例走向独立完成')!
      const actor='ordinary-method-'+randomUUID(),chat=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
      await store.createConversation(actor,{id:chat,title:'SYNTHETIC reviewed method'})
      async function methodInput(text:string,target=chat){
        const run=(await store.startRun(actor,target,randomUUID(),text)).run
        return {run,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:(_event:Record<string,unknown>)=>{}}
      }
      const first=await methodInput('请用已审核的“从示例走向独立完成”方法。我的课程第三题不会做。')
      outputs.push({reply:'先确定题目对应的知识点，再对照一个已解示例；没有题干时不猜题型。',citations:[{claimId:card.id}]})
      const firstReply=await engine(first),saved=await store.finishRun(first.run,first.staged,firstReply.text,firstReply.usage,first.signal)
      assert.equal(saved.event?.title,'我的课程第三题不会做')
      assert.equal((await readGuideUsage(actor,chat,saved.event!.id))[0]?.guide_id,card.id)
      // The next conversation can begin before the asynchronous index job.
      // Persisted guide identity must remain available in that interval.
      const followup=randomUUID()
      await store.createConversation(actor,{id:followup,title:'SYNTHETIC cross-session method'})
      const next=await methodInput('接着上次第三题的那个方法，我找不到适用的已解示例，课件链接也打不开。先不重做计划，怎样继续？',followup)
      outputs.push({reply:'先保留示例缺失这个阻碍，核对题干或关键词后再找相同知识点的例子，不换到另一套方法。',citations:[{claimId:card.id}]})
      const nextReply=await engine(next)
      const context=JSON.parse(requests.at(-1).messages[1].content)
      assert.deepEqual(context.methodContext.map((row:any)=>row.id),[card.id])
      assert.equal(next.staged.guideUsage?.[0]?.guideId,card.id)
      assert.equal(next.staged.guideUsage?.[0]?.status,'blocked')
      await store.finishRun(next.run,next.staged,nextReply.text,nextReply.usage,next.signal)
      await setMemorySettings(actor,{requestId:randomUUID(),enabled:false,expectedRevision:1})
      assert.deepEqual(await readPriorGuideEvents(actor,followup),[],'index-independent lookup must respect Memory OFF')
    })
    await t.test('unrequested method context cannot advertise a citation lane hidden from the user',async()=>{
      const actor='citation-policy-'+randomUUID(),chat=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[actor,actor+'@example.invalid'])
      try{
        await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
        await store.createConversation(actor,{id:chat,title:'SYNTHETIC citation visibility'})
        const run=(await store.startRun(actor,chat,randomUUID(),'我主要在意能自己安排专注时间，还没有客户，也没有自由职业经历，每周最多两小时。请比较一个更低成本的探索方式，不要推出我适合自由职业。')).run
        const input={run,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}}
        outputs.push({reply:'方式一：记录一次自己的专注时段，依据是你在意自主安排时间，投入几分钟，局限是一次记录不证明长期状态。\n方式二：在两小时上限内试做一项已有课程练习，依据是你没有客户且时间有限，局限是仅作探索，不代表适合自由职业。'})
        const before=requests.length,result=await engine(input)
        assert.equal(requests.length-before,1)
        assert.ok(input.staged.audit.some((a:any)=>a.phase==='method_context'&&a.cardIds?.length),'the comparison really received a method context')
        assert.equal(requests.at(-1).response_format.json_schema.schema.properties.citations,undefined,'the provider cannot select citations that the host will suppress')
        const contractAudit=input.staged.audit.find((a:any)=>a.phase==='turn_contract') as {capabilities:{citations:boolean}}|undefined
        assert.equal(contractAudit?.capabilities.citations,false)
        const saved=await store.finishRun(run,input.staged,result.text,result.usage,input.signal)
        assert.equal((saved.stateChange as {guideUsage?:{status?:unknown}}|undefined)?.guideUsage?.status,'not_requested')
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[actor])}
    })
    await t.test('time-prefixed listening uses the authorized no-action catalogue with no unsolicited material',async()=>{
      const input=await prepare('今天只想聊聊，不要给我安排任务。')
      let reply=''
      outputs.push((request:any)=>{
        const schema=request.response_format.json_schema.schema
        assert.ok(schema.properties.reply.enum.length>0)
        assert.equal(schema.properties.event,undefined)
        reply=schema.properties.reply.enum[0]
        assert.doesNotMatch(reply,/安排任务|[？?]/)
        return {reply}
      })
      const before=requests.length,result=await engine(input)
      assert.equal(requests.length-before,1)
      assert.equal(result.text,reply)
      assert.deepEqual(input.staged.growth?.changes??[],[])
      const saved=await store.finishRun(input.run,input.staged,result.text,result.usage,input.signal)
      assert.deepEqual(saved.growthCreatedIds,[])
      assert.deepEqual(saved.candidateIds,[])
    })
    await t.test('invalid source fails once even when legacy repair is requested',async()=>{
      const input=await prepare('我想聊聊另一个项目。')
      outputs.push({reply:'先看新项目。',event:{target:{operation:'create',title:'新项目',source:{messageId:input.run.source_message_id,quote:'用户根本没有说的内容'}},nodes:[{kind:'fact',source:{messageId:input.run.source_message_id,quote:'编造'}}]}})
      const before=requests.length
      await assert.rejects(engine(input))
      assert.equal(requests.length-before,1)
      assert.equal(input.staged.upstreamCalls,1)
      assert.ok(input.staged.audit.some((row:any)=>row.phase==='coach_repair_blocked'))
      await store.terminateRun(user,input.run.request_id,'failed','COACH_SOURCE_INVALID')
    })
  }finally{
    model.baseUrl=previous.url;config.apiKey=previous.key
    fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(()=>resolve()))
    // The isolated runner drops this entire synthetic database after the test.
    await localEmbedding.close()
    await pool.end()
  }
})


test('wire context transmits each method and identical current event once without losing authorization',()=>{
  const id=randomUUID(),eventId=randomUUID(),otherId=randomUUID()
  const current={id,role:'user',content:'接着上次的方法，第三题仍不会做',created_at:'2026-10-14T03:00:00Z'} as any
  const event={id:eventId,revision:3,nodes:[{id:randomUUID(),kind:'unknown',status:'active',text:'第三题条件尚未核对'}],actions:[],processTurns:[]} as any
  const other={...event,id:otherId}
  const method={id:randomUUID(),version:2,branch:'C04-3',step:'C04-3-1',body:'先核对已解示例及其适用条件。',sourceStatus:'approved'}
  const context=JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[current],currentEvent:event,events:[event,other],methodContext:[method],knowledge:[method] as any,growthBoundaries:[],blockedDirectionScopes:['postgraduate'],allowedDirectionScopes:['employment']}))
  assert.equal(context.knowledge,undefined)
  assert.deepEqual(context.methodContext,[method])
  assert.equal(context.currentEvent.id,eventId)
  assert.deepEqual(context.events.map((row:any)=>row.id),[otherId])
  assert.deepEqual(context.blockedDirectionScopes,['postgraduate'])
  assert.deepEqual(context.currentEvent.nodes,event.nodes)
  const wire=providerTurnMessages(JSON.stringify(context),{provider:'bailian',id:'qwen3.8-flash'})
  assert.equal(JSON.stringify(wire).split(method.body).length-1,1)
  assert.equal(wire.at(-1)!.content,current.content)
  const growth={id:randomUUID(),revision:2,kind:'constraint',text:'这周还剩半小时',status:'active',assertion:'user_reported',sources:[{id,type:'message',quote:'这周还剩半小时'}],dependencies:[],validUntil:'2026-10-18T15:59:59Z',validFrom:null,timeBasis:{kind:'calendar_week'},createdAt:current.created_at,updatedAt:current.created_at,unavailableReason:null,limitation:''} as any
  const original=JSON.stringify(growth)
  const compact=JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[current],growth:[growth]})).growth[0]
  assert.equal(compact.id,growth.id);assert.equal(compact.revision,2)
  assert.equal(compact.text,growth.text);assert.equal(compact.sources[0].id,id)
  assert.equal(compact.sources[0].quote,undefined);assert.equal(compact.validUntil,growth.validUntil)
  assert.deepEqual(compact.timeBasis,growth.timeBasis);assert.equal(JSON.stringify(growth),original)
  const legacy=JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[current],knowledge:[method] as any}))
  assert.deepEqual(legacy.knowledge,[method])
  const conflicting={...event,nodes:[{...event.nodes[0],status:'declined'}]}
  const distinct=JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[current],currentEvent:event,events:[conflicting]}))
  assert.equal(distinct.events.length,1,'do not discard a nonidentical authorization snapshot')
})

test('bounded dialogue history is a contiguous suffix, not older isolated messages',()=>{
 const current={id:randomUUID(),role:'user',content:'甲'.repeat(19500)} as any
 const old={id:randomUUID(),role:'user',content:'旧'.repeat(300)} as any
 const previous={id:randomUUID(),role:'assistant',content:'乙'.repeat(1000)} as any
 const context=JSON.parse(buildTurnPrompt({currentMessageId:current.id,messages:[old,previous,current]}))
 assert.deepEqual(context.messages,[])
 assert.equal(context.currentUserMessage.text,current.content)
})


test('compact provider growth targets keep the exact authorized ID and revision pairs',()=>{
  const refs=[{id:randomUUID(),revision:1},{id:randomUUID(),revision:2},{id:randomUUID(),revision:1}]
  const contract=deriveTurnContract({text:'更正之前的情况',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
  const payload=configureProviderPayload({}, {provider:'bailian',id:'qwen3.8-flash'},'default',contract.schema,'ordinary',8192,randomUUID(),[],refs,0,false,undefined,false,['c1']) as any
  const branches=payload.response_format.json_schema.schema.properties.growthUpdates.items.anyOf
  for(const branch of branches){
    const targets=branch.properties.target.anyOf
    assert.equal(targets.length,2)
    assert.deepEqual(targets[1].properties.itemId.enum,refs.map(ref=>ref.id))
    if(branch.properties.assertion.const==='ai_observation'){
      const bound=branch.properties.dependencies.items.anyOf.filter((row:any)=>row.properties?.id)
      assert.equal(bound.length,2)
      const accepted=bound.flatMap((row:any)=>row.properties.id.enum.map((id:string)=>({id,revision:row.properties.revision.enum[0]})))
      assert.deepEqual(accepted.sort((a:any,b:any)=>a.id.localeCompare(b.id)),[...refs].sort((a,b)=>a.id.localeCompare(b.id)))
    }
  }
  const empty=configureProviderPayload({}, {provider:'bailian',id:'qwen3.8-flash'},'default',contract.schema,'ordinary',8192,randomUUID(),[],[],0,false,undefined,false,['c1']) as any
  assert.ok(empty.response_format.json_schema.schema.properties.growthUpdates.items.anyOf.every((row:any)=>row.properties.target.anyOf.length===1))
})


test('real reported native plan keeps its actual tasks and leaves explicit buffer unallocated',()=>{
 const input={target:{operation:'create' as const},availableMinutes:120,period:'this_week' as const,budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'list_urgent_tasks',minutes:10,directionScopes:[]},{action:'complete_priority_homework',minutes:50,directionScopes:[]},{action:'review_weak_subjects',minutes:40,directionScopes:[]},{action:'buffer_rest',minutes:20,directionScopes:[]}]}
 const plan=normalizeWeeklyPlanTasks(input)
 assert.deepEqual(plan.items.map(item=>item.minutes),[10,50,40])
 assert.deepEqual(plan.items.map(item=>item.action),['列出紧急任务','完成优先课程作业','复习薄弱科目'])
 assert.equal(input.items.length,4,'do not mutate the preserved raw output')
 assert.deepEqual(normalizeWeeklyPlanTasks({...input,items:[{action:'list_tasks',minutes:10,directionScopes:[]},{action:'prioritize_and_schedule',minutes:20,directionScopes:[]}]}).items.map(item=>item.action),['列出任务','按优先级安排任务'])
 for(const label of ['缓冲/休息','休息/缓冲','休息与缓冲','rest_or_buffer','buffer_rest'])assert.equal(normalizeWeeklyPlanTasks({...input,items:[{action:label,minutes:30,directionScopes:[]},input.items[0]!]}).items.length,1,label)
 assert.deepEqual(normalizeWeeklyPlanTasks({...input,items:[{action:'course_homework',minutes:50,directionScopes:[]},{action:'review',minutes:40,directionScopes:[]}]}).items.map(item=>item.action),['课程作业','复习'])
 validateWeeklyPlanShape(plan)
 assert.ok(renderProposedWeeklyPlan(plan).includes('未安排：20分钟'))
 const mixed=normalizeWeeklyPlanTasks({...input,items:[{action:'复习后休息',minutes:120,directionScopes:[]}]})
 assert.equal(mixed.items.length,1,'a real mixed task cannot be silently discarded')
 const over=normalizeWeeklyPlanTasks({...input,items:[{action:'完成作业',minutes:121,directionScopes:[]}]})
 assert.throws(()=>validateWeeklyPlanShape(over),'actual overbudget tasks remain invalid')
})



