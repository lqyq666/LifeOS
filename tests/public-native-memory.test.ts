import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {reportedSourceContextClauses} from '../server/turn-contract.ts'
import {planExplicitCorrection} from '../server/turn-obligations.ts'
const fixture=JSON.parse(readFileSync(new URL('./fixtures/public-native-memory-failure.json',import.meta.url),'utf8'))
test('public first-turn autobiographical context survives omitted optional model growth',()=>{
 const retained=reportedSourceContextClauses(fixture.firstText,[]).map(c=>c.text).join('；')
 for(const fact of ['大三','软件工程专业','会一点Python','做过CSV整理练习','想比较就业和考研','还没选定'])assert.ok(retained.includes(fact),fact+' must remain a sourced personal report')
 assert.ok(!retained.includes('今天只愿意花15分钟'),'temporary action permission is not durable background')
 assert.ok(!retained.includes('每周最多两小时'),'typed budget stays in its existing budget lane')
})
test('public time-only correction cannot target unrelated performed-work clause',()=>{
 const correction=planExplicitCorrection(fixture.correctionText,fixture.beforeCorrection)
 assert.equal(correction?.newQuote,'我这周剩余时间是一小时')
 assert.equal(correction?.target,undefined,'a remaining-week correction cannot replace recurring budget or performed work')
 const prior={id:'weekly-remaining',revision:2,kind:'constraint' as const,assertion:'user_reported',text:'我这周剩余时间是两小时'}
 assert.equal(planExplicitCorrection(fixture.correctionText,[...fixture.beforeCorrection,prior])?.target?.itemId,prior.id)
})

test('background capture excludes commands, other speakers, hypotheses and chat instructions',()=>{
 for(const text of ['朋友说：我是软件工程专业，会一点Python。','如果我是软件工程专业，会一点Python。','“我是软件工程专业，会一点Python”。','我是软件工程专业吗？','帮我写：我是软件工程专业，会一点Python。','我想你帮我写软件工程专业的介绍。']){
  const reports=reportedSourceContextClauses(text,[])
  assert.ok(!reports.some(c=>c.text.includes('软件工程')),text)
 }
 const changed='我是大二学生，机械专业，学过CAD。想听你说说。'
 const reports=reportedSourceContextClauses(changed,[]).map(c=>c.text).join('；')
 assert.ok(reports.includes('机械专业')&&reports.includes('学过CAD'))
 assert.ok(!reports.includes('想听你说说'))
})

test('time corrections require the same field as well as period and budget scope',()=>{
 for(const [text,prior] of [
  ['更正：我本周剩余学习时间是一小时','我本周剩余运动时间是两小时'],
  ['更正：我这周学习还剩一小时','我这周运动还剩两小时'],
  ['更正：我这周还剩一小时学习时间','我这周还剩两小时运动时间'],
  ['本周剩余学习时间改为一小时','我本周还剩两小时运动时间']
 ])assert.equal(planExplicitCorrection(text!,[{id:'unrelated',revision:1,kind:'context',assertion:'user_reported',text:prior!}])?.target,undefined,text)
})
test('the shared budget parser keeps weekly aliases out of durable biography',()=>{
 const reports=reportedSourceContextClauses('我是大三，一周最多两小时。',[]).map(c=>c.text).join('；')
 assert.ok(reports.includes('我是大三'))
 assert.ok(!reports.includes('一周最多两小时'))
})

test('budget aliases do not reinterpret past work or a daily rate',()=>{
 for(const text of ['我上一周花了两小时复习','我用一周每天两小时完成课程']){
  assert.equal(applicableTimeBudget(text,undefined,undefined,{retainReportedBudget:true}),undefined,text)
 }
 const old={id:'learning',revision:1,kind:'context' as const,assertion:'user_reported',text:'我本周剩余学习时间是两小时'}
 assert.equal(planExplicitCorrection('本周剩余学习时间改为一小时',[old])?.target?.itemId,'learning')
})
test('mandatory background capture does not retain current location or adjacent contact data',()=>{
 for(const text of ['我现在在某医院，手机号是13800138000。','我是大三，手机号是13800138000。','我是大三，密码是ExampleOnly123。']){
  const reports=reportedSourceContextClauses(text,[]).map(c=>c.text).join('；')
  assert.ok(!reports.includes('某医院')&&!reports.includes('13800138000')&&!reports.includes('ExampleOnly123'),text)
 }
})
import {applicableTimeBudget} from '../server/turn-obligations.ts'

test('possessive first-person subjects do not turn a friend into the user',()=>{
 const reports=reportedSourceContextClauses('我是大三，我的朋友是软件工程专业。',[]).map(c=>c.text).join('；')
 assert.ok(reports.includes('我是大三'));assert.ok(!reports.includes('朋友'))
})
test('same-field rephrasing and actual execution-duration corrections remain supported',()=>{
 assert.equal(planExplicitCorrection('更正：我这周学习还剩一小时',[{id:'learning',revision:1,kind:'context',assertion:'user_reported',text:'我本周剩余学习时间是两小时'}])?.target?.itemId,'learning')
 assert.equal(planExplicitCorrection('更正：我今天花了20分钟查看岗位',[{id:'execution',revision:1,kind:'feedback',assertion:'user_reported',text:'我今天花了15分钟查看岗位'}])?.target?.itemId,'execution')
 assert.equal(applicableTimeBudget('我做了一周项目共两小时',undefined,undefined,{retainReportedBudget:true}),undefined)
})

test('context capture applies ownership and contact boundaries even with a model-selected anchor',()=>{
 const third=reportedSourceContextClauses('我是大三，另外我的朋友是软件工程专业。',[]).map(c=>c.text).join('；')
 assert.ok(!third.includes('朋友'))
 for(const [text,anchors] of [['我是大三，手机号是13800138000。',['我是大三']],['回来反馈：我看了岗位，手机号是13800138000。',[]]] as const){
  const reports=reportedSourceContextClauses(text,anchors).map(c=>c.text).join('；')
  assert.ok(!reports.includes('13800138000'))
 }
})

test('connective personal introductions retain their facts while explicit contacts and transient locations stay out',()=>{
 for(const text of ['另外我是大三。','此外本人是研究生。'])assert.ok(reportedSourceContextClauses(text,[]).length>0,text)
 for(const text of ['回来反馈：我看了岗位，微信号是wx123456。','我是大三，邮箱是person@example.invalid。','我现在在某医院，今天看了岗位。']){
  const reports=reportedSourceContextClauses(text,['今天看了岗位']).map(c=>c.text).join('；')
  assert.ok(!reports.includes('wx123456')&&!reports.includes('person@example.invalid')&&!reports.includes('某医院'),text)
 }
})

test('both context paths share normalized subjects and contact-value exclusion',()=>{
 for(const [text,anchor] of [['另外我现在在某医院，今天看了岗位。','今天看了岗位'],['我是大三，电话是13800138000。','我是大三'],['我是大三，13800138000。','我是大三'],['我是大三，person@example.invalid。','我是大三']]){
  const reports=reportedSourceContextClauses(text!,[anchor!]).map(c=>c.text).join('；')
  assert.ok(!reports.includes('某医院')&&!reports.includes('13800138000')&&!reports.includes('person@example.invalid'),text)
 }
})

test('contact exclusion does not erase telephone work or email channels, and plural transient subjects stay excluded',()=>{
 for(const text of ['我做过电话客服项目。','我今天参加了电话面试，也核实了岗位要求。','我通过校内邮箱发了消息，对方还没回复。'])assert.ok(reportedSourceContextClauses(text,[text.split('，')[0]!]).some(c=>c.text===text.slice(0,-1)),text)
 assert.ok(!reportedSourceContextClauses('我们现在在某医院，今天看了岗位。',['今天看了岗位']).some(c=>c.text.includes('某医院')))
})

test('mandatory self-subject capture distinguishes possessive shorthand from explicit self declarations',()=>{
 for(const text of ['我是大三，我室友软件工程专业。','我大三，我表哥机械专业。']){
  const reports=reportedSourceContextClauses(text,[]).map(c=>c.text).join('；')
  assert.ok(!reports.includes('室友')&&!reports.includes('表哥'));assert.ok(reports.includes('大三'))
 }
})

test('literal contact values stay excluded without treating channel descriptions or current work as secrets',()=>{
 for(const [text,anchor] of [['我做过以电话为主要渠道的客服项目。','我做过以电话为主要渠道的客服项目'],['我使用校内邮箱，校内邮箱是我提交材料的渠道。','我使用校内邮箱'],['我正在查看岗位，已经记下两条要求。','我正在查看岗位']]){
  assert.ok(reportedSourceContextClauses(text!,[anchor!]).some(c=>c.text.includes(anchor!)),text)
 }
 assert.ok(!reportedSourceContextClauses('我们正在某医院，今天看了岗位。',['今天看了岗位']).some(c=>c.text.includes('某医院')))
})

test('present location guard does not confuse applying, contacting or researching with being at a place',()=>{
 for(const text of ['我正在申请学校，已经提交了材料。','我正在联系学校，还没收到回复。','我正在调研医院，访谈还没开始。'])assert.ok(reportedSourceContextClauses(text,[text.split('，')[0]!]).some(c=>c.text.includes(text.split('，')[0]!)),text)
 assert.ok(!reportedSourceContextClauses('我现在正在某医院，今天看了岗位。',['今天看了岗位']).some(c=>c.text.includes('某医院')))
})

test('deictic activity descriptions are not place nouns',()=>{
 for(const text of ['我正在一个项目里调研医院，访谈还没开始。','我正在一个项目中联系学校，暂时没有回复。'])assert.ok(reportedSourceContextClauses(text,[text.split('，')[0]!]).some(c=>c.text.includes(text.split('，')[0]!)),text)
})
