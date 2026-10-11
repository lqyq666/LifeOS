import test from 'node:test'
import assert from 'node:assert/strict'
import {boundedOrdinaryReply,boundedPlanningReply,bindBoundedReplySchema,boundedReplyAccepts,boundedDraftAccepts,boundedSentenceAccepts} from '../server/bounded-reply.ts'

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
import {deriveTurnContract} from '../server/turn-contract.ts'
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
test('listening, refusal, controls, delivery, planning, comparison and sourced methods retain their original contracts',()=>{
 for(const text of ['我只想聊聊，不要给我建议。','更正，那个不是我做的。','你好','你记得我之前说过什么吗？','请比较就业和创业，哪个更适合？'])assert.equal(make(text),null,text)
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
