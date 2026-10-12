import test from 'node:test'
import assert from 'node:assert/strict'

test('real course V18: reported blocker and a narrow budget correction never promise marks or sufficient time',()=>{
 const blocked=make('上次排的课程作业，我已经列好题目了，但第三题不会做。')!
 assert.equal(blocked?.stage,'blocked')
 assert.ok(blocked.choices.every(x=>x.includes('题')&&!/基础分|足够/.test(x)))
 const corrected=make('更正一下，这周现在只剩半小时了，先不备考，处理第三题。',{verifiedBudget:{minutes:30,period:'this_week',quote:'这周现在只剩半小时了'}})!
 assert.ok(corrected?.choices.every(x=>x.includes('30分钟')&&!x.includes('足够')))
 const refused=make('这事先不想继续，别给我安排。')!
 assert.equal(refused?.stage,'reported_result')
 assert.ok(refused?.choices.every(x=>!x.includes('哪部分')&&!x.includes('先选')))
})
import {deliverableIntent} from '../server/action-coach-events.ts'
import {bindPlanBudgetSchema} from '../server/turn-contract.ts'

test('new real chain failures: discovery is not sending and next-week judgment stays scoped',()=>{
 assert.equal(deliverableIntent('我是成年大学生，想做一个校园产品。我想先发现值得解决的问题，怎么开始？','create'),false)
 assert.equal(deliverableIntent('我想先发一封邮件。','create'),true)
 const future=make('下周我有六小时可用，我想重新判断课程与备考。',{verifiedBudget:{minutes:360,period:'next_week',quote:'下周我有六小时可用'}})!
 assert.ok(future.choices.every(s=>s.includes('下周')&&!s.includes('这周')))
 const mismatch=make('我收到一个新的海报机会，需要每周十小时。我本周只有两小时，仍然就业优先。',{verifiedBudget:{minutes:120,period:'this_week',quote:'我本周只有两小时'}})!
 assert.ok(mismatch.choices.every(s=>s.includes('600分钟')&&s.includes('120分钟')&&s.includes('不足')))
 const contract=deriveTurnContract({text:'请帮我安排本周课程与备考。',knowledgeCount:0,currentEventExists:false,planIntent:true,material:false})
 const schema=bindPlanBudgetSchema(contract,{minutes:120,period:'this_week'},'请帮我安排本周课程与备考。').schema as any
 const candidate=schema.properties.weeklyPlan.properties.items.enum[0]
 assert.equal(candidate.length,2);assert.equal(candidate.reduce((n:number,x:any)=>n+x.minutes,0),120)
 assert.ok(candidate[0].action.includes('课程')&&candidate[1].action.includes('备考'))
})
import {boundedOrdinaryReply,boundedPlanningReply,bindBoundedReplySchema,boundedReplyAccepts,boundedDraftAccepts,boundedSentenceAccepts} from '../server/bounded-reply.ts'
import {boundedRecallReply} from '../server/bounded-reply.ts'

test('review regression: preparation mentioning mail never starts a completed contact window',()=>{
 for(const text of ['我开始尝试写邮件','我已经尝试整理邮件','我试做了邮件内容','我已经尝试联系但还没发出']){
  const answer=boundedRecallReply('目前是否已经联系？',[{text,createdAt:'2026-10-12T00:00:00Z'}]).choices[0]
  assert.doesNotMatch(answer,/按较后报告的联系进展/)
 }
})
test('review regression: current contact resolves actual time offsets before presentation limits',()=>{
 const facts=[{text:'我给学长发了邮件',createdAt:'2026-10-12T08:00:00+08:00'},{text:'我已经通过校内邮箱发出这个问题了',createdAt:'2026-10-12T01:00:00Z'},...Array.from({length:12},(_,i)=>({text:'我不想改到私人微信去催促',createdAt:`2026-10-12T02:00:${String(i).padStart(2,'0')}Z`}))]
 const answer=boundedRecallReply('目前是否已经联系学长？',facts).choices[0]
 assert.match(answer,/校内邮箱发出这个问题了/);assert.doesNotMatch(answer,/给学长发了邮件/)
})
test('review regression: contradictory reports at the same instant remain ambiguous',()=>{
 const facts=[{text:'我给学长发了邮件',createdAt:'2026-10-12T00:00:00Z'},{text:'我还没联系学长',createdAt:'2026-10-12T08:00:00+08:00'}]
 const answer=boundedRecallReply('目前是否已经联系学长？',facts).choices[0]
 assert.match(answer,/尚需核对|不能确认/);assert.doesNotMatch(answer,/按较后报告的联系进展/)
 assert.doesNotMatch(answer,/较后|早期/)
})
test('completed contact verbs use the shared own-statement guards',()=>{
 for(const verb of ['联系了学长','发送了邮件']){
  const own=boundedRecallReply('目前是否已经联系学长？',[{text:'我'+verb,createdAt:'2026-10-12T00:00:00Z'}]).choices[0]
  assert.match(own,/按较后报告的联系进展/)
  for(const text of ['我打算'+verb,'我没有'+verb,'如果我'+verb,'他说我'+verb,'“我'+verb+'”']){
   assert.doesNotMatch(boundedRecallReply('目前是否已经联系学长？',[{text,createdAt:'2026-10-12T00:00:00Z'}]).choices[0],/按较后报告的联系进展/,text)
  }
 }
})
test('current contact retains generic followups within the last explicit target window',()=>{
 const facts=[{text:'我给导师发了邮件',createdAt:'2026-10-10T00:00:00Z'},{text:'我给学长发了邮件',createdAt:'2026-10-12T00:00:00Z'},{text:'对方已经看过问题',createdAt:'2026-10-12T01:00:00Z'},{text:'但还没有回应',createdAt:'2026-10-12T02:00:00Z'}]
 const answer=boundedRecallReply('目前是否已经联系学长？',facts).choices[0]
 assert.match(answer,/看过问题/);assert.match(answer,/没有回应/);assert.doesNotMatch(answer,/给导师发了/)
})
test('same-time conflicting responses cannot be ordered by fact-array order',()=>{
 const facts=[{text:'我给学长发了邮件',createdAt:'2026-10-12T00:00:00Z'},{text:'对方已经回复',createdAt:'2026-10-12T01:00:00Z'},{text:'还没有回应',createdAt:'2026-10-12T01:00:00Z'}]
 for(const ordered of [facts,[facts[0],facts[2],facts[1]]]){
  const answer=boundedRecallReply('目前是否已经联系学长？',ordered).choices[0]
  assert.match(answer,/是否回应仍未知/);assert.doesNotMatch(answer,/「对方已经回复」|「还没有回应」/)
 }
 const combined=[facts[0],{text:'对方已经回复但没有回应',createdAt:'2026-10-12T01:00:00Z'}]
 assert.match(boundedRecallReply('目前是否已经联系学长？',combined).choices[0],/是否回应仍未知/)
 assert.equal(taskOutcomeReadback(combined[1].text,undefined,true).response.status,'unknown')
 assert.equal(taskOutcomeReadback('对方已经看过但没有读过',undefined,true).read.status,'unknown')
})
test('own contact excludes delegated or observed third-party actions and distinguishes role suffixes',()=>{
 for(const text of ['我让同学联系了学长','我看到同学联系了导师','我知道同学发了邮件','我亲眼看到同学联系了学长','我收到消息说同学发了邮件','我确认同学发了邮件','我收到学长发了邮件']){
  assert.doesNotMatch(boundedRecallReply('目前是否已经联系？',[{text,createdAt:'2026-10-12T00:00:00Z'}]).choices[0],/按较后报告的联系进展/)
  assert.equal(reportedPerformedTaskClauses(text).length,0)
 }
 const facts=[{text:'我给学长甲发了邮件',createdAt:'2026-10-10T00:00:00Z'},{text:'学长甲还没有回复',createdAt:'2026-10-11T00:00:00Z'},{text:'我给学长乙发了邮件',createdAt:'2026-10-12T00:00:00Z'},{text:'对方已经回复',createdAt:'2026-10-13T00:00:00Z'}]
 const answer=boundedRecallReply('目前是否已经联系学长甲？',facts).choices[0]
 assert.match(answer,/学长甲还没有回复/);assert.doesNotMatch(answer,/学长乙|已经回复/)
})
test('later negative read and same-time read conflicts cannot become read confirmation',()=>{
 const facts=[{text:'我给学长发了邮件',createdAt:'2026-10-10T00:00:00Z'},{text:'对方已经看过问题',createdAt:'2026-10-11T00:00:00Z'},{text:'对方没有看过问题',createdAt:'2026-10-12T00:00:00Z'}]
 assert.doesNotMatch(boundedRecallReply('目前是否已经联系？',facts).choices[0],/「对方已经看过问题」/)
 facts[1].createdAt=facts[2].createdAt
 assert.match(boundedRecallReply('目前是否已经联系？',facts).choices[0],/是否看过/)
 for(const text of ['对方未真正看过问题','对方并未仔细读过问题'])assert.equal(taskOutcomeReadback(text,undefined,true).read.status,'reported_not_read')
 assert.equal(taskOutcomeReadback('同学说对方已经回复',undefined,true).response.status,'unknown','nested hearsay is excluded by the existing participant prefix, while direct participant reports remain reported evidence')
})

test('persisted CONTACT_7 failure: current contact recall resolves later sending/read/no-response reports',()=>{
 const facts=[['想用校内邮箱请教学长课程项目如何整理成实习作品','2026-10-12T01:00:00Z'],['目前还没联系','2026-10-12T01:00:00Z'],['学长还没有回复','2026-10-12T02:00:00Z'],['接着聊请教学长','2026-10-12T02:00:01Z'],['我已经通过校内邮箱发出那个问题了','2026-10-12T02:00:00Z'],['我不想改到私人微信去催促','2026-10-12T03:00:00Z'],['但还没有回应','2026-10-12T03:00:00Z'],['对方已经看过问题','2026-10-12T03:00:00Z']].map(([text,createdAt])=>({text,createdAt}))
 const answer=boundedRecallReply('你记得我想用什么渠道联系学长，目前是否已经联系吗？只按我之前报告的内容回答。',facts).choices[0]
 assert.match(answer,/校内邮箱发出那个问题了/);assert.match(answer,/看过问题/);assert.match(answer,/没有回应/)
 assert.doesNotMatch(answer,/目前还没联系|接着聊请教学长/)
})
test('contact recall does not carry an earlier result into a newer sending attempt',()=>{
 const facts=[{text:'我给学长发了邮件',createdAt:'2026-10-01T00:00:00Z'},{text:'对方已经看过问题',createdAt:'2026-10-02T00:00:00Z'},{text:'我已经通过校内邮箱发出这个问题了',createdAt:'2026-10-12T00:00:00Z'}]
 const answer=boundedRecallReply('目前是否已经联系？',facts).choices[0]
 assert.match(answer,/发出这个问题了/);assert.doesNotMatch(answer,/已经看过|已读/)
})
test('current contact recall cannot use a later report about another explicit counterpart',()=>{
 const facts=[{text:'我给学长发了邮件',createdAt:'2026-10-01T00:00:00Z'},{text:'学长还没有回复',createdAt:'2026-10-02T00:00:00Z'},{text:'我给导师发了邮件',createdAt:'2026-10-12T00:00:00Z'},{text:'导师已经回复',createdAt:'2026-10-13T00:00:00Z'}]
 const answer=boundedRecallReply('学长目前是否已经联系？',facts).choices[0]
 assert.match(answer,/给学长发了邮件/);assert.doesNotMatch(answer,/给导师|导师已经回复/)
})
test('a later explicit unsent correction cannot be overridden by an older sending report',()=>{
 const facts=[{text:'我给学长发了邮件',createdAt:'2026-10-01T00:00:00Z'},{text:'我现在还没联系学长',createdAt:'2026-10-12T00:00:00Z'}]
 const answer=boundedRecallReply('学长目前是否已经联系？',facts).choices[0]
 assert.match(answer,/现在还没联系学长/);assert.doesNotMatch(answer,/较后报告的联系进展：「我给学长发了邮件」/)
})
test('planned, conditional, negative and third-party sending variants are not performed facts',()=>{
 for(const text of ['我准备先通过学校提供的校内邮箱发出这个问题了','如果我发出这个问题了','我还没有发出这个问题了','学长已经发出这个问题了'])assert.equal(reportedPerformedTaskClauses(text).length,0,text)
 assert.equal(reportedPerformedTaskClauses('我已经通过校内邮箱发出那个问题了').length,1)
})

test('planning first content is bound to the verified period and budget, never a saved or executed claim',()=>{
 const bounded=boundedPlanningReply({minutes:180,period:'next_week'})
 const first=safeEarlySentence(JSON.stringify({reply:bounded.choices[0]}))!
 assert.match(first,/下周.*180分钟以内/)
 assert.equal(boundedSentenceAccepts(first,bounded),true)
 assert.equal(boundedSentenceAccepts(first.replace('下周','本周'),bounded),false)
 assert.equal(boundedReplyAccepts('已经保存并执行三小时的复习安排。',bounded),false)
})

test('real first chain gaps: source-free interview reports and narrow correction cannot make effects or reset unrelated facts',()=>{
 const interview=make('我和一个同学聊过校园项目，他说感兴趣，但是还没使用。')!
 assert.equal(interview?.stage,'reported_result')
 assert.ok(interview.choices.every(s=>!s.includes('痛点不够')&&!s.includes('很常见')&&!s.includes('非用不可')))
 const first=make('我想做校园产品，先怎样找到一个可以核对的问题？')!
 assert.ok(first.choices.every(s=>!s.includes('高频')&&!s.includes('赢在')))
 const change=make('我更正，对方是否采用我不知道。')!
 assert.ok(change.choices.every(s=>!s.includes('是否看了')&&!s.includes('具体信息')&&!s.includes('建立联系')))
 assert.equal(make('我更正，刚才那个条件只是如果对方采用。')?.stage,undefined)
})

test('new task starts preserve contracting and recurring-budget boundaries instead of a generic material question',()=>{
 const freelance=make('我想探索自由职业接单，先确认需求与交付范围，怎么开始？')!
 assert.ok(freelance.choices.every(s=>s.includes('交付')&&!s.includes('已经完成')))
 const text='我每周能拿出六小时，想平衡课程与课外并做低时间预算，怎么开始？'
 const course=make(text,{verifiedBudget:{minutes:360,period:'current',quote:'我每周能拿出六小时'}})!
 assert.ok(course.choices.every(s=>s.includes('常规每周')&&s.includes('360分钟')&&!s.includes('本周')))
 const adjustment=make('我想把验证问题改成上一次遇到什么困难，不再问愿不愿意用。')!
 assert.ok(adjustment.choices.every(s=>!s.includes('更有效')&&!s.includes('客套')))
})
import {safeEarlySentence} from '../server/reply-draft.ts'
import {knowledgeIntent} from '../server/evergreen-guide.ts'
import {deriveTurnContract,reportedPerformedTaskClauses,taskOutcomeReadback} from '../server/turn-contract.ts'
const make=(text:string,extra:Partial<Parameters<typeof boundedOrdinaryReply>[0]>={})=>boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default',...extra})
test('an explicit request to continue a known unavailable resource uses the same blocked boundary',()=>{
 const bounded=make('这次课程的资料网页无法打开，我尚未开始准备课堂汇报，先处理这个卡点。')
 assert.equal(bounded?.stage,'blocked');assert.ok(bounded?.choices.every(s=>!s.includes('校园网')&&!s.includes('换个网络')))
})
test('source-free ordinary choices separate preparation, actual blockage and unknown response',()=>{
 const start=make('我还有两小时准备明天的课堂汇报，先做哪一步？')!
 const waiting=make('我发给学长的问题还没有回复，今天还要催吗？')!
 const blocked=make('昨天作业没做完，今晚怎么调整？')!
 assert.equal(start.stage,'start');assert.equal(waiting.stage,'waiting_result');assert.equal(blocked.stage,'blocked')
 assert.equal(make('我今天没按原计划做完作业，想调整一个小步骤。')!.stage,'blocked')
 assert.equal(start.basis,'editorial_adaptation');assert.equal(start.sourceStatus,'NO_PUBLIC_METHOD')
 assert.ok(waiting.choices.every(s=>!s.includes('明天再')&&!s.includes('更容易得到回应')))
 assert.ok(blocked.choices.every(s=>!s.includes('自责')&&!s.includes('很正常')))
 assert.ok(start.choices.every(s=>!s.includes('分钟')),'no invented budget allocation')
 assert.ok(blocked.choices.some(s=>s.includes('不重新安排整套')))
})
test('a first complete authorized editorial sentence can display provisionally without surfacing arbitrary model claims',()=>{
 const bounded=make('已经在第二道题卡住，接着怎么做？')!,sentence=safeEarlySentence(JSON.stringify({reply:bounded.choices[0]}))!
 assert.equal(boundedSentenceAccepts(sentence,bounded),true)
 assert.equal(boundedSentenceAccepts('更容易拿到学长回复',bounded),false)
 assert.equal(boundedSentenceAccepts(sentence.slice(0,-1),bounded),false,'an incomplete prefix cannot count as useful content')
 assert.equal(boundedReplyAccepts(bounded.choices[0]+'已经发出。',bounded),false,'the final reply still must validate and commit')
})
test('the runtime schema binds reply exactly and rejects free prose even if native validation was bypassed',()=>{
 const text='前天联系了学长，他没回，我下一步怎么办？',bounded=make(text)!
 const original=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),bound=bindBoundedReplySchema(original,bounded)
 assert.deepEqual((bound.schema as any).properties.reply.enum,bounded.choices)
 assert.equal((original.schema as any).properties.reply.enum,undefined,'original contract is not mutated')
 assert.equal(boundedReplyAccepts('语气轻一点反而更容易得到回应。',bounded),false)
 assert.equal(boundedReplyAccepts(bounded.choices[0]!,bounded),true)
 assert.equal(boundedReplyAccepts(bounded.choices[0]!+' 明天再发。',bounded),false)
 assert.equal(boundedDraftAccepts('你还有两小时要准备汇报吗？',bounded),false)
 assert.equal(boundedDraftAccepts('你们原先是怎么约定的？',bounded),true)
})
test('controls, delivery, planning, comparison and sourced methods retain their original contracts',()=>{
 for(const text of ['更正，那个不是我做的。','你好','你记得我之前说过什么吗？','请比较就业和创业，哪个更适合？'])assert.equal(make(text),null,text)
 const text='怎么开始？',contract=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:true,material:false})
 assert.equal(make(text,{contract}),null)
 assert.equal(make(text,{contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:true})}),null)
 assert.equal(make(text,{knowledgeCount:1}),null)
 assert.equal(make(text,{tier:'reasoning'}),null)
})
test('real-chain first failures: contact is not delivery and known feedback is not asked again',()=>{
 const contact=make('我是成年大学生，想向学长甲请教项目课对实习的帮助。我想先提出需求与边界，怎么开始？')!
 assert.ok(contact.choices.every(s=>!s.includes('交付')))
 const waiting=make('我通过学校邮箱请教学长甲，原请求是想知道项目课能否提供实习作品。对方已经读了，但没有回复，也没有采用。')!
 assert.ok(waiting.choices.every(s=>!s.includes('原消息')&&!s.includes('问了什么')))
 const blocked=make('我已经尝试课程复习，但遇到第一题卡住了。')!
 assert.ok(blocked.choices.every(s=>!s.includes('是没开始')&&!s.includes('停在哪一步')))
 const notStarted=make('我没有开始上次课程复习，材料打不开。')!
 assert.equal(notStarted.stage,'blocked')
 assert.ok(notStarted.choices.every(s=>!s.includes('已经完成')&&!s.includes('停在哪一步')&&!s.includes('是没开始')),'known missing material is the next gap, not an unknown progress question')
 const naturalMaterial=make('换件事，我还没有开始课程复习，教材链接打不开了，应该怎么调整？')!
 assert.ok(naturalMaterial.choices.every(s=>!s.includes('已经完成')&&!s.includes('停在哪一步')))
 const naturalWaiting=make('我已经通过学校邮箱发了那条项目课问题，对方未回应，接下来怎么办？')!
 assert.equal(naturalWaiting.stage,'waiting_result')
 const adopted=make('我愿意试这个方法。')!
 assert.ok(adopted.choices.every(s=>!s.includes('完成')&&!s.includes('更容易')))
 const result=make('我已经交付了一张社团海报，对方已经采用，已经付款300元。')!
 assert.ok(result.choices.every(s=>!s.includes('第一单')&&!s.includes('确认需求')&&!s.includes('跑通')))
})
test('new real pilot natural forms retain progress and bound contact without pretending to use a public method',()=>{
 assert.equal(make('好，我愿意尝试刚才那一步，还没有发出去。')!.stage,'adopted')
 assert.ok(make('我是成年大学生，刚才开始复习，已经在第一道题卡住了。接下来怎么继续？')!.choices.every(s=>!s.includes('停在哪一步')))
 const contact=make('我想请教学姐她的项目怎么用于实习，应该先怎么联系？',{knowledgeCount:1})!
 assert.equal(contact.sourceStatus,'PUBLIC_METHOD_NOT_USED')
 assert.ok(contact.choices.every(s=>!s.includes('很难')&&!s.includes('压力')&&!s.includes('交付')))
})

test('first natural real failures: quoted interview question is a step edit and a verified course tradeoff cannot invent career effects',()=>{
 const edit=make('创业这边我问了三个同学，他们觉得听起来有意思，但谁也还没用。我想把访谈问题改成“上次碰到这个问题，你具体怎么处理的？”')!
 assert.ok(edit.choices.every(s=>s.includes('问题')&&!s.includes('还没有具体方向')&&!s.includes('先写下一个待核对的问题')))
 const course=make('课程和备考怎么取舍？我这周只剩两小时，不想同时铺开。',{verifiedBudget:{minutes:120,period:'this_week',quote:'我这周只剩两小时'}})!
 assert.ok(course.choices.every(s=>s.includes('120分钟')&&!s.includes('简历')&&!s.includes('全砸')))
})

 test('listening cannot infer feelings or direct the emotional account',()=>{
 const reply=make('我请教导师的邮件已经发出去了。对方看过但没有回复。我现在只想聊聊感受，别给建议。')!
 assert.ok(reply.choices.length>0)
 assert.equal(boundedReplyAccepts('挺磨人的，你是不是很焦虑？',reply),false)
 assert.ok(reply.choices.every(s=>!s.includes('焦虑')&&!s.includes('催')&&!s.includes('难受')))
})
test('a continued interview uses the authorized revised question and cannot reopen an unrelated contact template',()=>{
 const text='还是上次那次访谈，接下来该怎样聊？'
 const reply=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default',priorInterviewQuestion:'最近一次卡在什么地方'})!
 assert.ok(reply.choices.every(c=>c.includes('最近一次卡在什么地方')))
 assert.ok(reply.choices.every(c=>!c.includes('尚未联系')&&!c.includes('起草消息')))
})

test('a natural problem-discovery request provides an editorial first interview step',()=>{
 const reply=make('我想探索给同学做学习工具，先了解他们实际碰到的问题，怎样开始？')!
 assert.ok(reply.choices.every(c=>c.includes('最近')&&(c.includes('怎么处理')||c.includes('当时做法'))))
 assert.equal(reply.basis,'editorial_adaptation')
})

