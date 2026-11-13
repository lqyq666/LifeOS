import test from 'node:test'
import assert from 'node:assert/strict'
import {classifyGuideFeedback,feedbackMatchesCurrent,guideFeedbackSource} from '../server/guide-usage.ts'

const blocked='我看了一个岗位四分钟，只核对了三列标题，没有完成，也没帮我判断方向。'

test('a natural partial job check is blocked feedback for the same task only',()=>{
 assert.equal(classifyGuideFeedback(blocked),'blocked')
 assert.equal(feedbackMatchesCurrent(blocked,'就业岗位初次探索','核对一项岗位要求'),true)
 assert.equal(feedbackMatchesCurrent(blocked,'课程复习','核对第一道题'),false)
})

test('a prospective which-step question is not executed guide feedback',()=>{
 assert.equal(classifyGuideFeedback('我在数据分析岗位上做了哪一步才不会卡住？'),null)
})

test('an ordinal question object does not become part of the exam identity',()=>{
 assert.equal(feedbackMatchesCurrent('我高数第一道错题还是卡住了。','高等数学期末复习','核对第一道错题'),true)
 assert.equal(feedbackMatchesCurrent('我英语四级第一套错题还是卡住了。','CET4备考','核对CET4错题'),true)
})

test('matter identity never turns a future plan into guide feedback by itself',()=>{
 const plan='英语四级复习是我下个月的计划。'
 assert.equal(feedbackMatchesCurrent(plan,'CET4备考','核对CET4错题'),true,'the matter matcher remains an identity predicate')
 assert.equal(classifyGuideFeedback(plan),null,'the independent feedback classifier prevents any usage update')
})

test('a future method plan cannot become executed guide feedback through a perfective example',()=>{
 assert.equal(classifyGuideFeedback('我计划明天按上次方法做了再反馈。'),null)
 assert.equal(classifyGuideFeedback('我计划明天按上次方法做还是会卡住。'),null)
})

test('considering a future attempt is not executed guide feedback',()=>{
 for(const text of ['按上次方法，我考虑尝试。','我考虑下周按上次方法尝试。','我正在考虑按上次方法访谈完三位学生后再反馈。'])assert.equal(classifyGuideFeedback(text),null,text)
 assert.equal(classifyGuideFeedback('我已经按上次方法尝试了。'),'attempted','an actually perfective attempt remains feedback')
})

test('a one-character completed object cannot update an unrelated guide',()=>{
 const text='我按上次方法看了药，还是卡住了。'
 assert.equal(classifyGuideFeedback(text),'blocked')
 assert.equal(feedbackMatchesCurrent(text,'数据分析岗位准备','核对数据分析岗位技能'),false)
 assert.equal(guideFeedbackSource(text,'blocked',{title:'数据分析岗位准备',task:'核对数据分析岗位技能'}),null)
 assert.equal(feedbackMatchesCurrent(text,'用药复盘','检查药'),true,'the same concrete object remains positively bindable')
})

test('delegated execution never becomes the user guide feedback',()=>{
 assert.equal(classifyGuideFeedback('我让小王按上次方法做了，为什么还是卡住了？'),null)
 assert.equal(classifyGuideFeedback('我让王建中按上次方法做了，为什么还是卡住了？'),null)
 assert.equal(classifyGuideFeedback('小王按上次方法做了但为什么还是卡住了？'),null)
 assert.equal(classifyGuideFeedback('按上次方法助教做了但还是卡住了。'),null,'an open human performer after a prior-method prefix remains third-party')
 assert.equal(classifyGuideFeedback('按上次方法助教反复做了但还是卡住了。'),null,'an action adverb cannot hide the open human performer')
 assert.equal(classifyGuideFeedback('按上次方法课程助教做了但还是卡住了。'),null,'an open compound human role remains third-party')
 assert.equal(classifyGuideFeedback('关于数据分析岗位。我们班助教按上次方法做了，但还是卡住了。'),null,'a possessive-like plural prefix cannot turn the class TA into user feedback')
 assert.equal(classifyGuideFeedback('关于数据分析岗位。我班的助教按上次方法做了，但还是卡住了。'),null,'a singular possessive class container cannot turn the TA into user feedback')
 assert.equal(classifyGuideFeedback('关于数据分析岗位。我们班助教按上次方法做了。还是卡住了。'),null,'a detached generic outcome retains the immediately preceding third-party performer')
 assert.equal(classifyGuideFeedback('关于数据分析岗位。我们班王建中按上次方法做了，但还是卡住了。'),null,'a named class member cannot become user guide feedback')
 for(const possessedPerformer of ['我们的助教','我们的同学'])assert.equal(classifyGuideFeedback(`${possessedPerformer}按上次方法做了。还是卡住了。`),null,'an explicit plural possessive remains third-party: '+possessedPerformer)
 assert.equal(classifyGuideFeedback('关于数据分析岗位。我们的助教先看了数据。按上次方法做了，但还是卡住了。'),null,'a substantive omitted-subject continuation retains the prior third-party performer')
 for(const filler of ['顺便说一下','过了一天'])assert.equal(classifyGuideFeedback(`关于数据分析岗位。我们的助教按上次方法做了。${filler}。还是卡住了。`),null,'a neutral filler cannot erase the preceding third-party performer: '+filler)
 assert.equal(classifyGuideFeedback('按上次方法周六做了，但还是卡住了。'),'blocked','a weekday after the prior-method prefix remains the user action time')
 assert.equal(classifyGuideFeedback('我们三人按上次方法做了，还是卡住了。'),'blocked','an explicitly quantified first-person collective remains user-owned feedback')
 assert.equal(classifyGuideFeedback('我们三名学生按上次方法做了，还是卡住了。'),'blocked','a quantified first-person student group remains user-owned feedback')
 assert.equal(classifyGuideFeedback('我们三位助教按上次方法做了，还是卡住了。'),'blocked','a quantified first-person human-role group remains user-owned feedback')
 assert.equal(classifyGuideFeedback('我们三个机器人按上次方法做了，还是卡住了。'),null,'a quantified non-human noun cannot update the user guide merely by ending in 人')
 assert.equal(classifyGuideFeedback('我们三名AI助教按上次方法做了，还是卡住了。'),null,'a quantified AI role cannot update the user guide through a human-role suffix')
 assert.equal(classifyGuideFeedback('我们三名 AI 助教按上次方法做了，还是卡住了。'),null,'whitespace cannot turn a quantified AI role into user feedback')
 assert.equal(classifyGuideFeedback('我们三位虚拟助教按上次方法做了，还是卡住了。'),null,'a quantified virtual role cannot update the user guide through a human-role suffix')
 assert.equal(classifyGuideFeedback('我们三名系统工程师按上次方法做了，还是卡住了。'),'blocked','a system-engineer occupation remains joint user feedback')
 assert.equal(classifyGuideFeedback('我们三名算法工程师按上次方法做了，还是卡住了。'),'blocked','an algorithm-engineer occupation remains joint user feedback')
 assert.equal(classifyGuideFeedback('我们三名虚拟教师按上次方法做了，还是卡住了。'),null,'a virtual actor cannot update the user guide through an occupation title')
 assert.equal(classifyGuideFeedback('我们工程师按上次方法做了，还是卡住了。'),'blocked','an unquantified first-person occupation remains joint user feedback')
 assert.equal(classifyGuideFeedback('我们嵌入式工程师按上次方法做了，还是卡住了。'),'blocked','an open bounded specialty remains joint user feedback')
 assert.equal(classifyGuideFeedback('我们产品负责人按上次方法做了，还是卡住了。'),'blocked','an open human role head remains joint user feedback')
 assert.equal(classifyGuideFeedback('我们虚拟程序员按上次方法做了，还是卡住了。'),null,'a virtual actor cannot update the user guide through another occupation suffix')
 assert.equal(classifyGuideFeedback('我们面向全国高校毕业生就业服务综合平台的虚拟程序员按上次方法做了，还是卡住了。'),null,'a long virtual-role modifier cannot become user guide feedback')
 assert.equal(classifyGuideFeedback('智能体按上次方法做了，但还是卡住了。'),null,'an open non-human agent cannot become the user guide feedback')
 assert.equal(classifyGuideFeedback('我们导师按上次方法做了，还是卡住了。'),null,'a bare relational role after first-person plural remains third-party feedback')
 assert.equal(classifyGuideFeedback('我们的工程师按上次方法做了，还是卡住了。'),null,'an explicitly possessive occupation remains third-party feedback')
 assert.equal(classifyGuideFeedback('我按上次方法做了，为什么还是卡住了？'),'blocked')
})

test('a third party directing the user to execute remains the user feedback',()=>{
 const text='导师让我按上次方法做了，但还是卡住了。'
 assert.equal(classifyGuideFeedback(text),'blocked')
 assert.equal(feedbackMatchesCurrent(text,'就业岗位初次探索','核对一项岗位要求'),true)
 assert.equal(classifyGuideFeedback('我让导师按上次方法做了，但还是卡住了。'),null)
})

test('an observed requirement followed by explicit reflexive work remains user feedback',()=>{
 for(const text of [
  '我看到导师的要求后自己按上次方法做了，但还是卡住了。',
  '我看到导师的要求后，自己按上次方法做了，但还是卡住了。',
 ])assert.equal(classifyGuideFeedback(text),'blocked',text)
 assert.equal(classifyGuideFeedback('我让小王按上次方法做了，自己还是卡住了。'),null,'a delegated performer is not reassigned merely by an ambiguous reflexive')
 assert.equal(classifyGuideFeedback('我看到导师的要求后，我让同学按上次方法做了，自己按上次方法做了但还是卡住了。'),null,'a later delegation supersedes an earlier observation antecedent')
})

test('actor-before-time feedback keeps the same matter identity',()=>{
 assert.equal(feedbackMatchesCurrent('我昨天尝试了英语四级复习，但还是卡住了。','CET4备考','核对CET4错题'),true)
 assert.equal(feedbackMatchesCurrent('我昨天尝试了数据分析岗位，但还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),true)
})

test('an exam identity after a progressive review verb still binds feedback',()=>{
 const text='我正在复习英语四级，但还是卡住了。'
 assert.equal(classifyGuideFeedback(text),'blocked')
 assert.equal(feedbackMatchesCurrent(text,'CET4备考','核对CET4错题'),true)
 assert.equal(feedbackMatchesCurrent(text,'CET6备考','核对CET6错题'),false)
})

test('location or organization modifiers preserve the core job identity',()=>{
 assert.equal(feedbackMatchesCurrent('我在成都的数据分析岗位上还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),true)
 assert.equal(feedbackMatchesCurrent('我在甲公司的数据分析岗位上还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),true)
 assert.equal(feedbackMatchesCurrent('我已经尝试了成都数据分析岗位，但还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),true)
 assert.equal(feedbackMatchesCurrent('我已经尝试了甲公司数据分析岗位，但还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),true)
 assert.equal(feedbackMatchesCurrent('我已经尝试了商业数据分析岗位，但还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),false)
 assert.equal(feedbackMatchesCurrent('关于我室友的数据分析岗位；还是卡住了。','数据分析岗位准备','核对数据分析岗位技能'),false,'a third-party possessive frame cannot authorize the user\'s guide progress')
})

test('a common completed action verb preserves the same job identity',()=>{
 const text='我做了数据分析岗位的技能核对，但还是卡住了。'
 assert.equal(classifyGuideFeedback(text),'blocked')
 assert.equal(feedbackMatchesCurrent(text,'数据分析岗位准备','核对数据分析岗位技能'),true)
})

test('a method-prefixed completed action preserves the same job identity',()=>{
 const text='我按上次方法完成了数据分析岗位核对，但还是卡住了。'
 assert.equal(classifyGuideFeedback(text),'blocked')
 assert.equal(feedbackMatchesCurrent(text,'数据分析岗位准备','核对数据分析岗位技能'),true)
})

test('an unpunctuated contrast tail is feedback outcome rather than a new matter',()=>{
 const text='我按上次方法做了但还是卡住了。'
 assert.equal(classifyGuideFeedback(text),'blocked')
 assert.equal(feedbackMatchesCurrent(text,'数据分析岗位准备','核对数据分析岗位技能'),true)
 assert.ok(guideFeedbackSource(text,'blocked',{title:'数据分析岗位准备',task:'核对数据分析岗位技能'}))
})

test('a bare quantified duration remains a method substep rather than a competing matter',()=>{
 for(const text of ['我按上次方法看了四分钟，还是卡住了。','我按上次方法看了四分钟但还是卡住了。']){
  assert.equal(classifyGuideFeedback(text),'blocked')
  assert.equal(feedbackMatchesCurrent(text,'数据分析岗位准备','核对数据分析岗位技能'),true)
  assert.ok(guideFeedbackSource(text,'blocked',{title:'数据分析岗位准备',task:'核对数据分析岗位技能'}))
 }
})

test('duplicate feedback is bound to the latest exact server-owned occurrence',()=>{
 const feedback='按上次办法，我已经联系了两人，没人回',text=feedback+'；'+feedback
 assert.equal(feedbackMatchesCurrent(feedback,'校园产品需求','发现值得解决的问题'),true,'办法 is the same explicit prior-method reference as 方法')
 const source=guideFeedbackSource(text,'blocked')
 assert.ok(source)
 assert.equal(text.slice(source.range.start,source.range.end),source.quote)
 assert.ok(source.range.start>feedback.length,'the second occurrence is the durable source')
})

test('a generic status retains the separate clause that establishes matter identity',()=>{
 const text='关于数据分析岗位；还是卡住了。',source=guideFeedbackSource(text,'blocked',{title:'数据分析岗位准备',task:'核对数据分析岗位技能'})
 assert.ok(source)
 assert.match(source.quote,/数据分析岗位/)
 assert.match(source.quote,/还是卡住了/)
 const broad='关于产品；还是卡住了。',broadSource=guideFeedbackSource(broad,'blocked',{title:'校园产品需求',task:'找目标用户'})
 assert.ok(broadSource)
 assert.match(broadSource.quote,/关于产品/,'a compatible frame stays inside the durable source even when it is too broad to bind by itself')
})

test('feedback after the bounded scan never falls back to whole-message authority',()=>{
 const unrelated=Array.from({length:64},(_,index)=>`第${index+1}条无关课程记录`).join('；')+'；'
 const feedback='关于数据分析岗位；还是卡住了。',text=unrelated+feedback
 const source=guideFeedbackSource(text,'blocked',{title:'数据分析岗位准备',task:'核对数据分析岗位技能'})
 assert.ok(source)
 assert.equal(source.quote,feedback.slice(0,-1),'only the exact identity and status clauses become durable guide provenance')
 assert.equal(source.range.start,unrelated.length)
})

test('a generic status cannot escape an explicit conflicting matter',()=>{
 for(const text of ['关于宿舍矛盾；还是卡住了。','关于室友关系；还是卡住了。','关于数据分析岗位和宿舍矛盾，我还是卡住了。']){
  assert.equal(feedbackMatchesCurrent(text,'数据分析岗位准备','核对数据分析岗位技能'),false,text)
  assert.equal(guideFeedbackSource(text,'blocked',{title:'数据分析岗位准备',task:'核对数据分析岗位技能'}),null,text)
 }
})

test('two distinct matters inside one broad product domain cannot update one guide',()=>{
 const text='我按上次方法做了校园产品用户访谈，也做了客户交付改稿，但还是卡住了。'
 assert.equal(feedbackMatchesCurrent(text,'校园产品用户访谈','找目标用户'),false)
 assert.equal(guideFeedbackSource(text,'blocked',{title:'校园产品用户访谈',task:'找目标用户'}),null)
})

test('one explicit conflicting matter cannot borrow a broad domain or method reference',()=>{
 const text='我按上次方法完成了客户交付改稿，但还是卡住了。'
 assert.equal(feedbackMatchesCurrent(text,'校园产品用户访谈','找目标用户'),false)
 assert.equal(guideFeedbackSource(text,'blocked',{title:'校园产品用户访谈',task:'找目标用户'}),null)
})

test('an open-domain completed object cannot mutate an unrelated guide',()=>{
 for(const text of ['我按上次方法完成了物理实验报告，但还是卡住了。','我按上次方法看了物理实验报告，但还是卡住了。','按上次方法，物理实验报告我看了，但还是卡住了。','按上次方法，我把物理实验报告看了，但还是卡住了。','按上次方法物理实验报告我看了，但还是卡住了。']){
  assert.equal(classifyGuideFeedback(text),'blocked',text)
  assert.equal(feedbackMatchesCurrent(text,'数据分析岗位准备','核对数据分析岗位技能'),false,text)
  assert.equal(guideFeedbackSource(text,'blocked',{title:'数据分析岗位准备',task:'核对数据分析岗位技能'}),null,text)
  assert.equal(feedbackMatchesCurrent(text,'物理实验报告复盘','检查物理实验报告'),true,'the same open-domain object remains positively bindable: '+text)
 }
 const unpunctuatedMethod='按上次方法我看了物理实验报告，但还是卡住了。'
 assert.equal(feedbackMatchesCurrent(unpunctuatedMethod,'物理实验报告复盘','检查物理实验报告'),true,'a method prefix is not a competing matter identity')
 assert.ok(guideFeedbackSource(unpunctuatedMethod,'blocked',{title:'物理实验报告复盘',task:'检查物理实验报告'}))
 const substep='我按上次方法核对了三列标题，但还是卡住了。'
 assert.equal(feedbackMatchesCurrent(substep,'数据分析岗位准备','核对数据分析岗位技能'),true,'a bounded method substep is not promoted into a new matter')
 const nominalSubstep='我按上次方法完成了三列标题核对，但还是卡住了。'
 assert.equal(classifyGuideFeedback(nominalSubstep),'blocked')
 assert.equal(feedbackMatchesCurrent(nominalSubstep,'数据分析岗位准备','核对数据分析岗位技能'),true,'a bounded completed substep remains feedback for the current guide')
 assert.ok(guideFeedbackSource(nominalSubstep,'blocked',{title:'数据分析岗位准备',task:'核对数据分析岗位技能'}))
})
