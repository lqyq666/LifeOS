import test from 'node:test'
import assert from 'node:assert/strict'
import {requestsTimeArrangement} from '../server/turn-obligations.ts'

test('real course V18: natural planning question uses remaining time, questions about others stay read-only',()=>{
 const text='我是成年大学生，平常每周可用六小时；这周只剩两小时了。课程作业和备考怎么安排？'
 assert.equal(requestsTimeArrangement(text),true)
 assert.ok(deriveTurnObligations(text).requiredEffects.some(e=>e.type==='weekly_plan'&&e.minutes===120))
 for(const no of ['老师怎么安排课程？','室友怎么安排备考？','上次课程怎么安排的？','如果课程怎么安排会比较好？'])assert.equal(requestsTimeArrangement(no),false,no)
})

test('a wrong week-hour restatement is repaired to the verified budget',()=>{
  const obligations=deriveTurnObligations('我每周最多两小时。')
  assert.equal(repairReplyBudget(obligations,'可以每周三小时试一下。'),'可以每周2小时试一下。')
  assert.equal(repairReplyBudget(obligations,'可以每周最多两小时试一下。'),'可以每周最多两小时试一下。')
})

test('a proposed repeated time block cannot multiply past the owned weekly budget',()=>{
 const obligations=deriveTurnObligations('我每周最多两小时。')
 for(const reply of ['在未来两周内，每周挑出两个“两小时”时段。','每周安排3个45分钟时段。']){
  assert.throws(()=>verifyReplyAgainstObligations(obligations,reply),{code:'REPLY_CONTRADICTS_CURRENT_EFFECT'},reply)
 }
 for(const reply of ['每周安排两个30分钟时段。','每周安排1个两小时时段。','如果每周安排三个两小时时段，就会超过预算，不这样做。','室友每周安排三个两小时时段。']){
  assert.doesNotThrow(()=>verifyReplyAgainstObligations(obligations,reply),reply)
 }
})

test('budget repair and verification share multiplicity without rewriting a per-block duration',()=>{
 const obligations=deriveTurnObligations('我每周最多两小时。')
 for(const reply of ['每周安排两个各1小时。','每周安排两个1小时学习块。','每周安排两个、每个1小时学习块。']){
  assert.equal(repairReplyBudget(obligations,reply),reply)
  assert.doesNotThrow(()=>verifyReplyAgainstObligations(obligations,reply))
 }
 for(const reply of ['每周安排三个各1小时。','每周安排三个1小时学习块。','每周安排三个45分钟来复习。','每周安排三个、每个1小时学习块。'])assert.throws(()=>verifyReplyAgainstObligations(obligations,reply),{code:'REPLY_CONTRADICTS_CURRENT_EFFECT'})
 for(const reply of ['每周安排2个1小时时间块。','每周安排两个30分钟时段。','室友每周安排三个1小时时间块。','如果每周安排三个1小时时间块，就超了，不这样做。']){
  const repaired=repairReplyBudget(obligations,reply)
  assert.equal(repaired,reply,'an allocation is not a restatement of total available time')
  assert.doesNotThrow(()=>verifyReplyAgainstObligations(obligations,repaired))
 }
 const over='每周安排3个1小时时间块。'
 assert.equal(repairReplyBudget(obligations,over),over)
 assert.throws(()=>verifyReplyAgainstObligations(obligations,over),{code:'REPLY_CONTRADICTS_CURRENT_EFFECT'})
})

test('listening preserves explicit zero time without authorizing a plan',()=>{
 const effects=deriveTurnObligations('我这周零分钟可用，先别分析创业了，只想说说最近的压力。').requiredEffects
 assert.ok(effects.some(e=>e.type==='weekly_time'&&e.minutes===0&&e.period==='this_week'))
 assert.ok(!effects.some(e=>e.type==='weekly_plan'))
 for(const text of ['室友这周零分钟可用，先别分析创业了。','如果我这周零分钟可用，先别分析创业了。','我只想说说“这周零分钟可用”。'])assert.equal(deriveTurnObligations(text).requiredEffects.length,0,text)
})
test('natural candidate schedule request is mandatory and keeps its requested week',()=>{
 const text='下周仅有一小时，请给课程和备考安排下周的候选任务。'
 assert.ok(deriveTurnObligations(text).requiredEffects.some(e=>e.type==='weekly_plan'&&e.period==='next_week'&&e.minutes===60))
 for(const no of ['室友说请给课程和备考安排下周的候选任务。','如果请给课程和备考安排下周的候选任务会怎么样？','请给课程和备考不要安排下周的任务。'])assert.ok(!deriveTurnObligations(no).requiredEffects.some(e=>e.type==='weekly_plan'),no)
})
import {weeklyTimeIntent,remainingWeeklyTimeIntent,weeklyPlanIntent,deriveTurnObligations,isPureControlCommand,isPureZeroPlanRequest,verifyTurnObligations,verifyReplyAgainstObligations,repairReplyBudget,supplementMissingBudgetDeltas,planExplicitCorrection,explicitCorrectionIntent,hoursIn} from '../server/turn-obligations.ts'
test('V19 remaining-week replacement identifies only the matching owned budget, never recurring time',()=>{
 const old=[{id:'remaining',revision:2,kind:'constraint' as const,assertion:'user_reported',text:'这周还剩两小时'},{id:'routine',revision:1,kind:'context' as const,assertion:'user_reported',text:'平时每周能拿出六小时'}]
 assert.equal(planExplicitCorrection('这周剩余时间要改成三十分钟。',old)?.target?.itemId,'remaining')
 for(const text of ['如果这周剩余时间要改成三十分钟。','同学说这周剩余时间要改成三十分钟。','这周剩余时间要改成三十分钟吗？'])assert.equal(planExplicitCorrection(text,old),null,text)
 assert.equal(planExplicitCorrection('这周剩余时间要改成三十分钟。',old.slice(1))?.target,undefined)
})

test('a generic fact correction owned by another person never becomes the user correction',()=>{
 for(const text of ['我的男朋友职业目标写错了，应该是考研。','我的男朋友偏好写错了，应该是独处。']){
  assert.equal(explicitCorrectionIntent(text),false,text)
  assert.equal(planExplicitCorrection(text,[{id:'goal',revision:1,kind:'goal',assertion:'user_reported',text:'我的职业目标是就业'}]),null,text)
 }
 const matchingThirdParty=[{id:'roommate-preference',revision:2,kind:'preference' as const,assertion:'user_reported',text:'我的室友偏好是晚上复习'}]
 const matchingText='我的室友偏好写错了，应该是早上复习。'
 assert.equal(explicitCorrectionIntent(matchingText,matchingThirdParty),false,'stored third-party text cannot grant self ownership')
 assert.equal(planExplicitCorrection(matchingText,matchingThirdParty),null)
 const qualifiedThirdParty=[{id:'roommate-food',revision:3,kind:'preference' as const,assertion:'user_reported',text:'我的室友饮食偏好是吃辣'}]
 const qualifiedText='我的室友饮食偏好写错了，应该是不吃辣。'
 assert.equal(explicitCorrectionIntent(qualifiedText,qualifiedThirdParty),false,'an allowed self qualifier cannot hide a third-party possessor')
 assert.equal(planExplicitCorrection(qualifiedText,qualifiedThirdParty),null)
 const partnerText='我的男朋友饮食偏好写错了，应该是不吃辣。'
 const partnerOld=[{id:'partner-food',revision:1,kind:'preference' as const,assertion:'user_reported',text:'我的男朋友饮食偏好是吃辣'}]
 assert.equal(explicitCorrectionIntent(partnerText,partnerOld),false,'arbitrary relationship owners remain third party')
 assert.equal(planExplicitCorrection(partnerText,partnerOld),null)
 const partnerMusic='我的男朋友音乐偏好写错了，应该是古典乐。'
 const partnerMusicOld=[{id:'partner-music',revision:1,kind:'preference' as const,assertion:'user_reported',text:'我的男朋友音乐偏好是流行乐'}]
 assert.equal(explicitCorrectionIntent(partnerMusic,partnerMusicOld),false,'an open qualifier cannot hide a human possessor')
 assert.equal(planExplicitCorrection(partnerMusic,partnerMusicOld),null)
 const cousinText='我的表姐学习偏好写错了，应该是早上复习。'
 const cousinOld=[{id:'cousin-learning',revision:1,kind:'preference' as const,assertion:'user_reported',text:'我的表姐学习偏好是晚上复习'}]
 assert.equal(explicitCorrectionIntent(cousinText,cousinOld),false,'an authorized compound qualifier cannot turn an unlisted relationship into self ownership')
 assert.equal(planExplicitCorrection(cousinText,cousinOld),null)
 const nicknameText='我的小明英语学习偏好写错了，应该是早上复习。'
 const nicknameOld=[{id:'nickname-learning',revision:1,kind:'preference' as const,assertion:'user_reported',text:'我的小明英语学习偏好是晚上复习'}]
 assert.equal(explicitCorrectionIntent(nicknameText,nicknameOld),false,'an authorized row cannot turn an arbitrary nickname possessor into the user')
 assert.equal(planExplicitCorrection(nicknameText,nicknameOld),null)
})

test('a bare correction cannot inherit ownership across a third-party sentence',()=>{
 const old=[{id:'birthday',revision:2,kind:'context' as const,assertion:'user_reported',text:'我的生日是2003年5月1日'}]
 for(const text of ['我室友的生日原来记成2003年。生日记错了，应该是2004年5月1日。','室友生日原来记成2003年。生日记错了，应该是2004年5月1日。','小王生日原来记成2003年。生日记错了，应该是2004年5月1日。','我室友的生日原来记成2003年。顺便补充一下。生日记错了，应该是2004年5月1日。','关于室友。生日记错了，应该是2004年5月1日。','关于我室友。生日记错了，应该是2004年5月1日。','关于我的室友。生日记错了，应该是2004年5月1日。','关于我的前任。生日记错了，应该是2004年5月1日。','关于室友。顺便补充一下。生日记错了，应该是2004年5月1日。']){
  assert.equal(explicitCorrectionIntent(text,old),false,text)
  assert.equal(planExplicitCorrection(text,old),null,text)
 }
 const selfOverride='关于我室友。我的生日是2003年5月1日。生日记错了，应该是2004年5月1日。'
 assert.equal(planExplicitCorrection(selfOverride,old)?.target?.itemId,'birthday','the nearest explicit self-owner supersedes an older third-party frame')
})

test('a longer non-profile object cannot borrow a personal-field prefix',()=>{
 const text='我的兴趣小组名字写错了，应该是机器人协会。'
 const old=[{id:'interest',revision:1,kind:'preference' as const,assertion:'user_reported',text:'我的兴趣是摄影'}]
 assert.equal(explicitCorrectionIntent(text,old),false)
 assert.equal(planExplicitCorrection(text,old),null)
})

test('a qualified first-person personal field remains an owned correction',()=>{
 const text='我的饮食偏好写错了，应该是不吃辣。'
 const old=[{id:'preference',revision:1,kind:'context' as const,assertion:'user_reported',text:'我的饮食偏好是吃辣'}]
 assert.equal(explicitCorrectionIntent(text),true)
 assert.equal(planExplicitCorrection(text,old)?.target?.itemId,'preference')
 const learning='我的英语学习偏好写错了，应该是早上复习。'
 const learningOld=[{id:'learning-preference',revision:3,kind:'preference' as const,assertion:'user_reported',text:'我的英语学习偏好是晚上复习'}]
 assert.equal(explicitCorrectionIntent(learning,learningOld),true)
 assert.equal(planExplicitCorrection(learning,learningOld)?.target?.itemId,'learning-preference')
 const programming='我的编程学习偏好写错了，应该是早上复习。'
 const programmingOld=[{id:'programming-preference',revision:2,kind:'preference' as const,assertion:'user_reported',text:'我的编程学习偏好是晚上复习'}]
 assert.equal(explicitCorrectionIntent(programming,programmingOld),true)
 assert.equal(planExplicitCorrection(programming,programmingOld)?.target?.itemId,'programming-preference')
 const music='我的音乐偏好写错了，应该是古典乐。'
 const musicOld=[{id:'music-preference',revision:5,kind:'preference' as const,assertion:'user_reported',text:'我的音乐偏好是流行乐'}]
 assert.equal(explicitCorrectionIntent(music,musicOld),true,'an exact authorized first-person field may use an open qualifier')
 assert.equal(planExplicitCorrection(music,musicOld)?.target?.itemId,'music-preference')
 const discovered='我才发现我的专业写错了，应该是计算机科学与技术。'
 const discoveredOld=[{id:'discovered-major',revision:4,kind:'context' as const,assertion:'user_reported',text:'我的专业是软件工程'}]
 assert.equal(explicitCorrectionIntent(discovered,discoveredOld),true)
 assert.equal(planExplicitCorrection(discovered,discoveredOld)?.target?.itemId,'discovered-major')
 const observedThirdParty='我发现我的男朋友专业写错了，应该是计算机科学与技术。'
 const observedThirdPartyOld=[{id:'observed-partner-major',revision:2,kind:'context' as const,assertion:'user_reported',text:'我的男朋友专业是软件工程'}]
 assert.equal(explicitCorrectionIntent(observedThirdParty,observedThirdPartyOld),false)
 assert.equal(planExplicitCorrection(observedThirdParty,observedThirdPartyOld),null)
 const unrelated=[{id:'own-preference',revision:1,kind:'preference' as const,assertion:'user_reported',text:'我的学习偏好是晚上复习'}]
 assert.equal(explicitCorrectionIntent('我的室友偏好写错了，应该是早上复习。',unrelated),false)
 assert.equal(planExplicitCorrection('我的室友偏好写错了，应该是早上复习。',unrelated),null)
 for(const school of ['我所在学校写错了，应该是四川大学。','我就读的学校写错了，应该是四川大学。']){
  const schoolOld=[{id:'school',revision:2,kind:'context' as const,assertion:'user_reported',text:'我的学校是成都理工大学'}]
  assert.equal(explicitCorrectionIntent(school,schoolOld),true,school)
  assert.equal(planExplicitCorrection(school,schoolOld)?.target?.itemId,'school',school)
 }
})

test('a reflexive first-person owner remains an owned correction',()=>{
 const text='我自己的生日记错了，应该是2004年5月1日。'
 const old=[{id:'birthday',revision:1,kind:'context' as const,assertion:'user_reported',text:'我自己的生日是2004年4月1日'}]
 assert.equal(explicitCorrectionIntent(text),true)
 assert.equal(planExplicitCorrection(text,old)?.target?.itemId,'birthday')
 const framed='关于我本人。生日记错了，应该是2004年5月1日。'
 assert.equal(explicitCorrectionIntent(framed),true)
 assert.equal(planExplicitCorrection(framed,old)?.target?.itemId,'birthday')
})

test('a personal correction stops before an independent third-party correction',()=>{
 const text='我的专业记错了应该是计算机科学与技术同时我室友的生日也记错了应该是2004年5月1日。'
 const old=[{id:'major',revision:1,kind:'context' as const,assertion:'user_reported',text:'我的专业是软件工程'}]
 const plan=planExplicitCorrection(text,old)
 assert.equal(plan?.target?.itemId,'major')
 assert.equal(plan?.newQuote,'我的专业记错了应该是计算机科学与技术')
 assert.ok(!plan?.newQuote.includes('室友'))
})

test('an owned correction after an independent third-party correction still applies',()=>{
 const text='我室友的生日记错了应该是2004年5月1日同时我的专业也记错了应该是计算机科学与技术。'
 const old=[{id:'major',revision:1,kind:'context' as const,assertion:'user_reported',text:'我的专业是软件工程'}]
 assert.equal(explicitCorrectionIntent(text),true)
 const plan=planExplicitCorrection(text,old)
 assert.equal(plan?.target?.itemId,'major')
 assert.equal(plan?.newQuote,'我的专业也记错了应该是计算机科学与技术')
 assert.ok(!plan?.newQuote.includes('室友'))
})

test('a named previous major remains an owned major correction',()=>{
 const text='我的软件工程专业记错了，应该是计算机科学与技术。'
 const old=[{id:'major',revision:1,kind:'context' as const,assertion:'user_reported',text:'我的专业是软件工程'}]
 assert.equal(explicitCorrectionIntent(text),true)
 assert.equal(planExplicitCorrection(text,old)?.target?.itemId,'major')
})

test('a completed correction report is not executed as a new correction command',()=>{
 const old=[{id:'major',revision:1,kind:'context' as const,assertion:'user_reported',text:'我的专业是软件工程'}]
 for(const text of ['我把我的专业改成计算机科学与技术后，又更新了简历。','我把我的专业改成计算机科学与技术后，吃了饭。','我把我的专业改成计算机科学与技术后吃了饭。','我把我的专业改成计算机科学与技术后一直没再调整。']){
  assert.equal(explicitCorrectionIntent(text,old),false,text)
  assert.equal(planExplicitCorrection(text,old),null,text)
 }
})

test('a natural named-major correction binds arbitrary authorized major names',()=>{
 const text='我的人工智能专业记错了，应该是网络空间安全。'
 const old=[{id:'major',revision:2,kind:'context' as const,assertion:'user_reported',text:'我的专业是人工智能'}]
 assert.equal(explicitCorrectionIntent(text,old),true)
 const plan=planExplicitCorrection(text,old)
 assert.equal(plan?.target?.itemId,'major')
 assert.equal(plan?.target?.expectedRevision,2)
 assert.match(plan?.newQuote??'',/网络空间安全/)
 const punctuated='我的电子信息工程（中外合作办学）专业记错了，应该是人工智能。'
 const punctuatedOld=[{id:'major-punctuated',revision:1,kind:'context' as const,assertion:'user_reported',text:'我的专业是电子信息工程（中外合作办学）'}]
 assert.equal(explicitCorrectionIntent(punctuated,punctuatedOld),true)
 assert.equal(planExplicitCorrection(punctuated,punctuatedOld)?.target?.itemId,'major-punctuated')
 const thirdParty='我的姐姐专业记错了，应该是人工智能。'
 assert.equal(explicitCorrectionIntent(thirdParty,old),false)
 assert.equal(planExplicitCorrection(thirdParty,old),null)
})

test('whitespace after a correction modifier keeps the replacement atomic',()=>{
 const text='我的专业刚才 写错了，应该是计算机科学与技术。'
 const old=[{id:'major',revision:1,kind:'context' as const,assertion:'user_reported',text:'我的专业是软件工程'}]
 assert.equal(explicitCorrectionIntent(text),true)
 const plan=planExplicitCorrection(text,old)
 assert.equal(plan?.target?.itemId,'major')
 assert.match(plan?.newQuote??'',/计算机科学与技术/)
})

test('an explicit major rewrite binds arbitrary authorized major names',()=>{
 const text='把我的专业从人工智能改成网络空间安全。'
 const old=[{id:'major',revision:3,kind:'context' as const,assertion:'user_reported',text:'我的专业是人工智能'}]
 const plan=planExplicitCorrection(text,old)
 assert.equal(plan?.target?.itemId,'major')
 assert.equal(plan?.target?.expectedRevision,3)
 assert.equal(plan?.target?.beforeQuote,'我的专业是人工智能')
 assert.match(plan?.newQuote??'',/网络空间安全/)
 const direct='我的专业从人工智能改成网络空间安全。'
 assert.equal(explicitCorrectionIntent(direct),true)
 assert.equal(planExplicitCorrection(direct,old)?.target?.itemId,'major')
 const naturalOld=[{...old[0]!,text:'我目前就读人工智能专业'}]
 assert.equal(planExplicitCorrection(text,naturalOld)?.target?.itemId,'major')
})

test('a completed personal-field correction report is not executed again',()=>{
 const old=[{id:'major',revision:1,kind:'context' as const,assertion:'user_reported',text:'我的专业是软件工程'}]
 for(const report of ['我把我的专业改成计算机科学与技术了，为什么页面还显示软件工程？','把我的专业改成计算机科学与技术了，为什么页面还显示软件工程？','请把我的专业改成计算机科学与技术了，可是页面仍显示软件工程。','麻烦帮我把我的专业改成计算机科学与技术了，不过系统仍显示软件工程。','我把我的专业改成了计算机科学与技术，为什么页面还显示软件工程？','我把我的专业改成计算机科学与技术了可是页面还显示软件工程。','我把我的专业改成计算机科学与技术后，页面仍显示软件工程。','我把我的专业改成计算机科学与技术了以后，页面仍显示软件工程。']){
  assert.equal(explicitCorrectionIntent(report,old),false,report)
  assert.equal(planExplicitCorrection(report,old),null,report)
 }
})

test('a correction followed by another requested action is still an atomic correction command',()=>{
 const old=[{id:'major',revision:1,kind:'context' as const,assertion:'user_reported',text:'我的专业是软件工程'}]
 for(const text of ['把我的专业改成计算机科学与技术后，再更新简历。','请把我的专业改成计算机科学与技术了以后，再更新简历。']){
  assert.equal(explicitCorrectionIntent(text,old),true,text)
  const plan=planExplicitCorrection(text,old)
  assert.equal(plan?.target?.itemId,'major',text)
  assert.match(plan?.newQuote??'',/计算机科学与技术/,text)
 }
})

test('a derived artifact containing a personal-field name is not a profile correction',()=>{
 for(const text of ['我的职业目标分析写错了，应该是还缺信息。','我的偏好报告写错了，应该重做。','我的兴趣清单写错了，应该是阅读清单。','我的年龄计算写错了，应该是另一种算法。','我的年龄相关计算写错了，应该是另一种算法。','我的专业方向写错了，应该是人工智能安全。','我的专业课程写错了，应该是机器学习。','我的专业课写错了，应该是机器学习。','我的学校邮箱写错了，应该换一个地址。']){
  assert.equal(explicitCorrectionIntent(text),false,text)
  assert.equal(planExplicitCorrection(text,[]),null,text)
 }
})

test('only the complete explicit empty-plan request can take the zero-generation path',()=>{
 const yes='本周我没有可用时间。请安排本周课程和备考。'
 assert.equal(isPureZeroPlanRequest(yes,deriveTurnObligations(yes)),true)
 for(const no of ['本周我没有可用时间。请安排本周课程和备考，也帮我起草邮件。','本周我没有可用时间。请安排本周课程和备考，为什么会这样？','室友本周没有可用时间。请安排本周课程和备考。','如果本周没有可用时间，请安排本周课程和备考。','我是成年大学生，本周我没有可用时间。请安排本周课程和备考。'])assert.equal(isPureZeroPlanRequest(no,deriveTurnObligations(no)),false,no)
})

test('retained current browser natural save-empty-arrangement request is a plan intent',()=>{
 const text='这周没有可用时间，只保存一个空安排。'
 assert.equal(weeklyPlanIntent(text)?.period,'this_week')
 assert.equal(isPureZeroPlanRequest(text,deriveTurnObligations(text)),true)
 for(const no of ['室友这周没有可用时间，只保存一个空安排。','如果这周没有可用时间，只保存一个空安排。','这周没有可用时间，是不是只保存一个空安排？'])assert.equal(isPureZeroPlanRequest(no,deriveTurnObligations(no)),false,no)
})

test('retained real split-clause zero budget verifies its own verbatim staged fact',()=>{
  const text='这周我没有可用时间，是零小时。请排这周的课程和备考安排。'
  const obligations=deriveTurnObligations(text)
  assert.equal(hoursIn('这周我没有可用时间'),0)
  const growth={changes:[{target:{operation:'create'},kind:'constraint',assertion:'user_reported',text:'这周我没有可用时间',source:{messageId:'m',quote:'这周我没有可用时间'},validUntil:'2026-10-12T00:00:00Z'}],prepared:[]}
  assert.equal(supplementMissingBudgetDeltas(obligations,growth as never,'m',text).length,0)
  verifyTurnObligations(obligations,{growth:growth as never,controls:undefined,currentText:text,reply:'先不安排任务。',weeklyPlan:{input:{availableMinutes:0}}})
  for(const negative of ['如果这周没有可用时间怎么办？','室友这周没有可用时间','这周不是没有可用时间','这周没有休息时间'])assert.equal(hoursIn(negative),null,negative)
})
const pauseChanges=[{scopes:['overseas_study','postgraduate_exam','postgraduate_recommendation','undergraduate_upgrade'] as never,operation:'pause' as const,quote:'先别推升学相关的安排'}]

test('weekly time intent: only the user\'s own explicit weekly budget creates an obligation',()=>{
  assert.deepEqual(weeklyTimeIntent('最近课程变多了，每周只有3小时了，安排帮我改一下。'),{quote:'每周只有3小时了',minutes:180,period:'current'})
  assert.deepEqual(weeklyTimeIntent('我每周只有3小时'),{quote:'我每周只有3小时',minutes:180,period:'current'})
  assert.deepEqual(weeklyTimeIntent('我每周只有两小时'),{quote:'我每周只有两小时',minutes:120,period:'current'})
  assert.deepEqual(weeklyTimeIntent('下周我每周三小时都得排满'),{quote:'下周我每周三小时都得排满',minutes:180,period:'next_week'})
  assert.deepEqual(weeklyTimeIntent('这周每周就剩这些了，先按每周4小时安排'),{quote:'先按每周4小时安排',minutes:240,period:'this_week'},'周期从同句前置分句继承（N1.2）')
  assert.deepEqual(weeklyTimeIntent('这周先按每周4小时安排'),{quote:'这周先按每周4小时安排',minutes:240,period:'this_week'})
  // PC13/C04: the opportunity's own demanded hours are never the user's budget.
  assert.equal(weeklyTimeIntent('有个无薪产品实习，每周15小时、持续8周，我要不要接？'),null,'机会要求不是本人预算')
  assert.equal(weeklyTimeIntent('这个岗位要求每周工作20小时，值得去吗？'),null)
  // …but the user's own availability in the same breath still counts.
  assert.deepEqual(weeklyTimeIntent('这个实习要每周15小时，我每周只有10小时。'),{quote:'我每周只有10小时',minutes:600,period:'current'})
  for(const negative of [
    '室友每周3小时。',
    '如果以后每周只有3小时怎么办？',
    '我不是每周只有3小时。',
    '这周剩3小时，不是以后每周3小时。',
    '朋友说他每周10小时都不够用。',
    '我每周大概4小时吧。',
    '每天2小时行不行？',
  ])assert.equal(weeklyTimeIntent(negative),null,negative)
})

test('obligation kinds follow explicit commands and never small talk',()=>{
  assert.equal(deriveTurnObligations('今天天气不错。').kind,'ordinary')
  assert.equal(deriveTurnObligations('我每周只有3小时。').kind,'update_weekly_time')
  assert.equal(deriveTurnObligations('我每周只有3小时，安排帮我改一下。').kind,'mixed','改安排同轮增加计划义务(N2.3)')
  assert.equal(deriveTurnObligations('先别推升学相关的安排。',{directionControls:pauseChanges}).kind,'direction_control')
  assert.equal(deriveTurnObligations('请直接起草一份我可以用的简历作品清单。',{resumePortfolioMode:true}).kind,'resume_portfolio')
  const mixed=deriveTurnObligations('改成每周3小时吧，也先别推升学相关的安排。',{directionControls:pauseChanges})
  assert.equal(mixed.kind,'mixed')
  assert.deepEqual(mixed.requiredEffects.map(effect=>effect.type).sort(),['direction_control','weekly_time'])
})

test('pure control detection and deterministic control replies',()=>{
  const pureObligations=deriveTurnObligations('先别推升学相关的安排。',{directionControls:pauseChanges})
  assert.equal(isPureControlCommand('先别推升学相关的安排。',pureObligations,[pauseChanges[0]!.quote]),true)
  const mixedText='先别推升学相关的安排，顺便帮我看看简历。'
  assert.equal(isPureControlCommand(mixedText,deriveTurnObligations(mixedText,{directionControls:pauseChanges}),[pauseChanges[0]!.quote]),false)
  assert.equal(isPureControlCommand('我每周只有3小时。',deriveTurnObligations('我每周只有3小时。'),[]),false)
})

test('missing required updates and contradicting replies are hard failures',()=>{
  const obligations=deriveTurnObligations('最近课程变多了，每周只有3小时了，安排帮我改一下。')
  // OBL-01 core: an old-topic update with no 3h change fails even without any source error.
  assert.throws(()=>verifyTurnObligations(obligations,{growth:{changes:[{target:{operation:'create'},kind:'context',assertion:'user_reported',text:'我把清单发给两个招聘方了',source:{messageId:'m',quote:'我把清单发给两个招聘方了'}}],prepared:[]},controls:undefined,currentText:'最近课程变多了，每周只有3小时了，安排帮我改一下。',reply:'已收到反馈。'}),(error:unknown)=>(error as {code?:string}).code==='GROWTH_REQUIRED_UPDATE_MISSING')
  const planInput={availableMinutes:180,period:'current',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[],target:{operation:'create'}}
  verifyTurnObligations(obligations,{growth:{changes:[{target:{operation:'replace'},kind:'context',assertion:'user_reported',text:'每周只有3小时了',source:{messageId:'m',quote:'每周只有3小时了'}}],prepared:[]},controls:undefined,weeklyPlan:{input:planInput},currentText:'最近课程变多了，每周只有3小时了，安排帮我改一下。',reply:'已更新。'})
  verifyReplyAgainstObligations(obligations,'每周从6小时降到3小时，安排如下…')
  verifyReplyAgainstObligations(obligations,'按每周3小时安排。')
  // The opportunity's own demanded hours in the reply never contradict the user's budget.
  verifyReplyAgainstObligations(obligations,'这个实习本身要求每周15小时，而你每周只有3小时，缺口很大。')
  // Alternative allocations are not a restatement of the user's weekly total.
  verifyReplyAgainstObligations(obligations,'方式A每周30分钟，方式B每周1.5小时。')
  verifyReplyAgainstObligations(obligations,'方案A每周30分钟，方案B每周1.5小时。')
  verifyReplyAgainstObligations(obligations,'第一种每周30分钟，第二种每周1.5小时。')
  // P2 (B13): affirming a DIFFERENT amount of the user's own just-stated
  // budget is a hard failure again — with escapes for opportunity-attributed
  // amounts and change framings (the classes P1's removal was for).
  assert.throws(()=>verifyReplyAgainstObligations(obligations,'好的，继续保持每周6小时的节奏推进。'),(error:unknown)=>(error as {code?:string}).code==='REPLY_CONTRADICTS_CURRENT_EFFECT')
  // Control obligations must actually be staged.
  const controlObligations=deriveTurnObligations('先别推升学相关的安排。',{directionControls:pauseChanges})
  assert.throws(()=>verifyTurnObligations(controlObligations,{growth:undefined,controls:undefined,currentText:'先别推升学相关的安排。',reply:'好的。'}),(error:unknown)=>(error as {code?:string}).code==='DIRECTION_CONTROL_NOT_APPLIED')
})

test('remaining weekly budget intent: this-week leftover, never weekly or next-week amounts',()=>{
  assert.deepEqual(remainingWeeklyTimeIntent('这周还剩两小时。'),{quote:'这周还剩两小时',minutes:120,weekQuote:'这周'})
  assert.deepEqual(remainingWeeklyTimeIntent('本周只剩1.5小时。'),{quote:'本周只剩1.5小时',minutes:90,weekQuote:'本周'})
  assert.deepEqual(remainingWeeklyTimeIntent('这周，只剩下半小时了。'),{quote:'只剩下半小时了',minutes:30,weekQuote:'这周'},'周期从同句前置分句继承')
  assert.deepEqual(remainingWeeklyTimeIntent('这周还剩一个半小时。'),{quote:'这周还剩一个半小时',minutes:90,weekQuote:'这周'})
  for(const negative of [
    '还剩两小时。',
    '下周只剩两小时。',
    '如果这周还剩两小时呢？',
    '这周还剩两小时吗？',
    '室友说这周还剩两小时。',
    '这周没剩两小时了。',
    '这周大概还剩三小时。',
    '这周还剩两个半小时。',
  ])assert.equal(remainingWeeklyTimeIntent(negative),null,negative)
})

test('re-plan phrasings create the plan obligation (重新排/重新安排)',()=>{
  assert.deepEqual(weeklyPlanIntent('以后改成每周1.5小时吧，重新排一下。'),{period:'current'})
  assert.deepEqual(weeklyPlanIntent('重新安排一下这周的。'),{period:'this_week'})
  assert.equal(weeklyPlanIntent('你说得有道理。'),null)
  const obligations=deriveTurnObligations('以后改成每周1.5小时吧，重新排一下。')
  assert.deepEqual(obligations.requiredEffects.map(effect=>effect.type),['weekly_time','weekly_plan'])
  const planEffect=obligations.requiredEffects.find(effect=>effect.type==='weekly_plan')
  assert.equal(planEffect&&planEffect.type==='weekly_plan'?planEffect.minutes:null,90,'1.5小时=90分钟')
})

test('remaining budget obligations require a week-scoped constraint and bind plans to the tighter amount',()=>{
  const obligations=deriveTurnObligations('这周还剩两小时，剩下的时间帮我安排一下。')
  assert.deepEqual(obligations.requiredEffects.map(effect=>effect.type),['remaining_time','weekly_plan'])
  const planEffect=obligations.requiredEffects.find(effect=>effect.type==='weekly_plan')
  assert.equal(planEffect&&planEffect.type==='weekly_plan'?planEffect.minutes:null,120,'计划用剩余数而非每周数')
  // An open-ended context item is NOT enough: the remaining budget must be week-scoped.
  assert.throws(()=>verifyTurnObligations(obligations,{growth:{changes:[{target:{operation:'create'},kind:'context',assertion:'user_reported',text:'这周还剩两小时',source:{messageId:'m',quote:'这周还剩两小时'}}],prepared:[]},controls:undefined,currentText:'这周还剩两小时，剩下的时间帮我安排一下。',reply:'好的。'}),(error:unknown)=>(error as {code?:string}).code==='GROWTH_REQUIRED_UPDATE_MISSING')
  const planInput={availableMinutes:120,period:'this_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[],target:{operation:'create'}}
  verifyTurnObligations(obligations,{growth:{changes:[{target:{operation:'create'},kind:'constraint',assertion:'user_reported',text:'这周还剩两小时',validUntil:'2026-10-12T16:00:00.000Z',source:{messageId:'m',quote:'这周还剩两小时'}}],prepared:[]},controls:undefined,weeklyPlan:{input:planInput},currentText:'这周还剩两小时，剩下的时间帮我安排一下。',reply:'好的。'})
  // The reply may restate a weekly amount (每周6小时 is not contradicted by 2h left),
  // but a different REMAINING amount is a contradiction unless framed as a change.
  verifyReplyAgainstObligations(obligations,'你每周有六小时，这周还剩两小时，先做最小验证。')
  verifyReplyAgainstObligations(obligations,'从剩下的三小时改为两小时来安排。')
  assert.throws(()=>verifyReplyAgainstObligations(obligations,'这周还剩三小时，我们这样安排。'),(error:unknown)=>(error as {code?:string}).code==='REPLY_CONTRADICTS_CURRENT_EFFECT')
})

test('supplementMissingBudgetDeltas stages only what the model failed to persist',()=>{
  const weekly=deriveTurnObligations('我每周只有3小时，安排帮我改一下。')
  // Nothing staged: one context delta from the obligation's own quote.
  const empty=supplementMissingBudgetDeltas(weekly,undefined,'m1')
  assert.equal(empty.length,1)
  assert.equal(empty[0]!.kind,'context')
  assert.deepEqual((empty[0] as {source:{messageId:string;quote:string}}).source,{messageId:'m1',quote:'我每周只有3小时'})
  // The model already persisted a 3h context fact: no supplement.
  const coveredGrowth={changes:[{target:{operation:'create'},kind:'context',assertion:'user_reported',text:'每周只有3小时',source:{messageId:'m1',quote:'我每周只有3小时'}}],prepared:[],inputIndexBindings:new Map()}
  assert.equal(supplementMissingBudgetDeltas(weekly,coveredGrowth as never,'m1').length,0)
  // A remaining-this-week budget without a week-scoped constraint is staged as
  // exactly that, with calendar evidence from the user's own week token.
  const remaining=deriveTurnObligations('这周课程赶，只剩两小时能用了。')
  const supplement=supplementMissingBudgetDeltas(remaining,undefined,'m2')
  assert.equal(supplement.length,1)
  assert.equal(supplement[0]!.kind,'constraint')
  assert.deepEqual((supplement[0] as {timeEvidence:{kind:string;which:string;quote:string}}).timeEvidence,{kind:'calendar_week',which:'this',quote:'这周'})
  const weekScoped={changes:[{target:{operation:'create'},kind:'constraint',assertion:'user_reported',text:'只剩两小时能用了',validUntil:'2026-10-12T16:00:00.000Z',source:{messageId:'m2',quote:'只剩两小时能用了'}}],prepared:[],inputIndexBindings:new Map()}
  assert.equal(supplementMissingBudgetDeltas(remaining,weekScoped as never,'m2').length,0)
})

test('a current-week upper bound keeps its numeric amount through obligation verification',()=>{
  const text='我大三，做过一个校园活动工具。我只负责访谈同学和画原型，代码是队友写的。这周最多能用90分钟。'
  const obligations=deriveTurnObligations(text)
  const effect=obligations.requiredEffects.find(item=>item.type==='weekly_time')
  assert.deepEqual(effect,{type:'weekly_time',quote:'这周最多能用90分钟',minutes:90,period:'this_week'})
  const growth={changes:[{
    target:{operation:'create'},
    kind:'constraint',
    assertion:'user_reported',
    text:'这周最多能用90分钟',
    validUntil:'2026-10-18T16:00:00.000Z',
    source:{messageId:'m-upper-bound',quote:'这周最多能用90分钟'},
  }],prepared:[],inputIndexBindings:new Map()}
  verifyTurnObligations(obligations,{growth:growth as never,controls:undefined,currentText:text,reply:'我会按90分钟上限给你建议。'})
})

test('P2 input family: availability without 剩, clock units, decimals, zero budget and wrong-period guards',()=>{
  // B01 family — 这周我只有N小时 is a this-week availability statement.
  assert.equal(deriveTurnObligations('这周我只有两小时，给我一个现在就能开始的具体行动。').requiredEffects.some(effect=>effect.type==='remaining_time'&&effect.minutes===120),true)
  assert.deepEqual(remainingWeeklyTimeIntent('本周就三个钟头能用。'),{quote:'本周就三个钟头能用',minutes:180,weekQuote:'本周'},'钟头单位')
  assert.deepEqual(remainingWeeklyTimeIntent('这周我还能用两个半小时。'),null,'两个半小时 refuses (ambiguous)')
  assert.equal(deriveTurnObligations('这周还剩2.5小时。').requiredEffects.some(effect=>effect.type==='remaining_time'&&effect.minutes===150),true,'2.5小时=150')
  assert.equal(deriveTurnObligations('这周剩0小时，全排满了。').requiredEffects.some(effect=>effect.type==='remaining_time'&&effect.minutes===0),true,'零预算也是明确预算')
  // B03 family — a 下周 clause never becomes this-week.
  for(const text of ['这周我忙，下周只剩两小时能做作品。','这周先赶论文，下周就剩一个半小时了。'])
    assert.equal(remainingWeeklyTimeIntent(text),null,text)
  // B06 family — the opportunity demanding hours, varied phrasings.
  for(const text of ['实习要求我每周投入15小时。','这个岗位需要每周工作20小时。','该项目要求我们每周花10小时维护。'])
    assert.equal(weeklyTimeIntent(text),null,text)
  // …while the user's own commitment beside an opportunity still counts.
  assert.deepEqual(weeklyTimeIntent('这个实习我要每周投入10小时去做。'),{quote:'这个实习我要每周投入10小时去做',minutes:600,period:'current'})
  // B05/B10 — plan period binding.
  const b05=deriveTurnObligations('我每周有六小时。这周还剩两小时，帮我安排下周。')
  const b05Plan=b05.requiredEffects.find(effect=>effect.type==='weekly_plan')
  assert.equal(b05Plan&&b05Plan.type==='weekly_plan'?b05Plan.period+'@'+b05Plan.minutes:'','next_week@360','下周计划用常规预算，不用本周剩余')
  const b10=deriveTurnObligations('下周我每周只有4小时，帮我安排本周。')
  assert.equal(b10.requiredEffects.some(effect=>effect.type==='weekly_plan'),false,'本周计划无本周预算→无计划义务（明确缺口）')
  // B13 escape classes.
  const stale=deriveTurnObligations('我每周只有2小时。')
  assert.throws(()=>verifyReplyAgainstObligations(stale,'你每周有6小时，可以按每天一小时继续准备。'),(error:unknown)=>(error as {code?:string}).code==='REPLY_CONTRADICTS_CURRENT_EFFECT')
  verifyReplyAgainstObligations(stale,'这个实习本身需要每周15小时，你每周只有2小时，需要慎重。')
  verifyReplyAgainstObligations(stale,'你从每周6小时降到现在只有2小时，安排如下。')
  // B14 — staged half-hours satisfy the same obligation that parsed them.
  const half=deriveTurnObligations('这周只剩半小时。')
  verifyTurnObligations(half,{growth:{changes:[{target:{operation:'create'},kind:'constraint',assertion:'user_reported',text:'这周只剩半小时',validUntil:'2026-10-11T16:00:00.000Z',source:{messageId:'m',quote:'这周只剩半小时'}}],prepared:[]},controls:undefined,currentText:'这周只剩半小时。',reply:''})
})

test('P2-1: explicit corrections carry a required, deterministic state change',()=>{
  const yearOld={id:'g-year',revision:1,kind:'context' as const,assertion:'user_reported',text:'我大三，最近在就业和考研之间犹豫。'}
  // A01 shape: 更正一下：我是大二，刚才说成大三了 → amend the 我大三 clause.
  const yearPlan=planExplicitCorrection('更正一下：我是大二，刚才说成大三了。',[yearOld])
  assert.equal(yearPlan?.newQuote,'我是大二')
  assert.equal(yearPlan?.target?.itemId,'g-year')
  assert.equal(yearPlan?.target?.beforeQuote,'我大三')
  const duplicateYear=planExplicitCorrection('更正一下：我是大二，刚才说成大三了。',[
    {id:'whole',revision:1,kind:'context',assertion:'user_reported',text:'我是大三，读市场营销',sourceIds:['same-original-message']},
    {id:'part',revision:1,kind:'context',assertion:'user_reported',text:'我是大三',sourceIds:['same-original-message']},
    {id:'unrelated',revision:1,kind:'context',assertion:'user_reported',text:'更正一下：那张海报的设计主要是队友做的，我只负责了排版和打印',sourceIds:['other-message']},
  ])
  assert.ok(duplicateYear?.target)
  assert.equal(duplicateYear?.relatedTargets?.length,1,'two copies of one original clause must both be corrected')
  const unrelatedCopies=planExplicitCorrection('更正一下：我是大二，刚才说成大三了。',[
    {id:'first',revision:1,kind:'context',assertion:'user_reported',text:'我是大三',sourceIds:['first-message']},
    {id:'second',revision:1,kind:'context',assertion:'user_reported',text:'我是大三',sourceIds:['second-message']},
  ])
  assert.equal(unrelatedCopies?.target,undefined,'same words in independent reports do not grant a multi-record correction')
  // A02 shape: composite team award — the scored clause is the personal role.
  const teamOld={id:'g-team',revision:1,kind:'ability' as const,assertion:'user_reported',text:'我们团队上学期拿了校园文创设计二等奖，我做的是整体策划。'}
  const teamPlan=planExplicitCorrection('更正一下：整体策划主要是队长做的，我只负责了宣传物料里的排版部分。',[teamOld])
  assert.equal(teamPlan?.newQuote,'我只负责了宣传物料中的排版部分'.replace('中','里'))
  assert.equal(teamPlan?.target?.itemId,'g-team')
  assert.equal(teamPlan?.target?.beforeQuote,'我做的是整体策划')
  // Denial-only correction without a safe old target → verbatim create.
  const observationOnly=[{id:'g-obs',revision:1,kind:'observation' as const,assertion:'ai_observation',text:'可能因为害怕竞争所以暂停投递'}]
  const denial=planExplicitCorrection('不对，我不是害怕竞争或者不主动，我是想先把作品集改好才暂停投递的。',observationOnly)
  assert.equal(denial?.target,undefined)
  assert.equal(denial?.newQuote,'我是想先把作品集改好才暂停投递的')
  // No marker / re-assertion → null (normal turns and 已记录内容不受影响).
  assert.equal(planExplicitCorrection('另外我每周还有三小时空闲。',[yearOld]),null)
  assert.equal(planExplicitCorrection('更正一下，我确实是每周三小时。', [{id:'g-h',revision:1,kind:'context' as const,assertion:'user_reported',text:'我每周三小时'}]),null,'原话已存在=无操作')
  // Wrong-event safety: a correction naming nothing in the old item falls back
  // to verbatim create, never a guessed amend.
  const unrelated=planExplicitCorrection('更正一下：我是大二，刚才说成大三了。',[{id:'g-other',revision:1,kind:'context' as const,assertion:'user_reported',text:'我喜欢视觉设计，每周能投入六小时。'}])
  assert.equal(unrelated?.target,undefined)
  const event={id:'event',revision:1,kind:'context' as const,assertion:'user_reported',text:'最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次'}
  const qualify='更正：同学少问一次只是结果，不代表我因此有成就感；我当时真正轻松的是自己不用反复找。只更新受影响的判断。'
  assert.equal(planExplicitCorrection(qualify,[event])?.target,undefined,'denying an inference cannot replace its supporting event')
  const alreadyNegative={id:'negative',revision:1,kind:'context' as const,assertion:'user_reported',text:'同学少问一次时我没有成就感'}
  assert.equal(planExplicitCorrection(qualify,[alreadyNegative])?.target,undefined,'an already negative feeling is not refuted by denial of a positive inference')
  assert.equal(planExplicitCorrection('更正：不代表我有成就感。',[alreadyNegative])?.target,undefined,'negation immediately before the matching predicate must not be lost')
  for(const text of ['我谈不上因此有成就感','我并非因此有成就感','我从未因此有成就感','我不算因此有成就感','我未必因此有成就感'])assert.equal(planExplicitCorrection('更正：不代表我因此有成就感。',[{...alreadyNegative,text}])?.target,undefined,text)
  assert.equal(planExplicitCorrection('更正：不代表我因此有成就感。',[{...alreadyNegative,text:'我可能因此有成就感'}])?.target,undefined,'a hedged prior explanation remains a separate dated source')
  assert.equal(planExplicitCorrection(qualify,[event,{id:'feeling',revision:1,kind:'context',assertion:'user_reported',text:'我因此有成就感'}])?.target?.itemId,'feeling','an actually refuted feeling remains correctable')
})

test('new real first failures: one-and-a-half remainder is not thirty minutes and scoped zero can persist from its amount clause',()=>{
 const text='我这周只剩一个半小时，课程和备考怎么取舍？先别都铺开。',obligations=deriveTurnObligations(text)
 assert.doesNotThrow(()=>verifyReplyAgainstObligations(obligations,'这周只剩一个半小时，课程和备考各有什么硬截止？'))
 assert.throws(()=>verifyReplyAgainstObligations(obligations,'这周只剩半小时。'),/REPLY_CONTRADICTS_CURRENT_EFFECT/)
 const zero=deriveTurnObligations('这周后面都排满了，能用的时间是零。下周大概有四小时，先不排具体任务。')
 const deltas=supplementMissingBudgetDeltas(zero,undefined,'00000000-0000-4000-8000-000000000001','这周后面都排满了，能用的时间是零。下周大概有四小时，先不排具体任务。')
 assert.ok(deltas.some(d=>d.source.quote==='能用的时间是零'))
})

test('a separated correction marker preserves the scope of a named major and can be corrected again',()=>{
 const before={id:'major',revision:1,kind:'context',assertion:'user_reported',text:'另外我的专业是软件工程'}
 const correction='更正一下，我的专业不是软件工程，是人工智能；请按更正后的专业重新比较之前的取舍。'
 const plan=planExplicitCorrection(correction,[before])
 assert.equal(plan?.target?.itemId,before.id)
 assert.equal(plan?.target?.beforeQuote,before.text)
 assert.equal(plan?.newQuote,'我的专业不是软件工程，是人工智能')
 const next=planExplicitCorrection('我的专业从人工智能改成信息管理。',[{...before,id:'major-revised',text:plan!.newQuote}])
 assert.equal(next?.target?.itemId,'major-revised')
 assert.equal(next?.target?.beforeQuote,plan?.newQuote)
 assert.equal(planExplicitCorrection('假设更正一下，我的专业不是软件工程，是人工智能。',[before]),null)
 assert.equal(planExplicitCorrection('更正一下，室友的专业不是软件工程，是人工智能。',[before]),null)
})
