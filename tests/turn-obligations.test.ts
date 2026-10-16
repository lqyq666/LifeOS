import test from 'node:test'
import assert from 'node:assert/strict'
import {requestsTimeArrangement} from '../server/turn-obligations.ts'

test('real course V18: natural planning question uses remaining time, questions about others stay read-only',()=>{
 const text='我是成年大学生，平常每周可用六小时；这周只剩两小时了。课程作业和备考怎么安排？'
 assert.equal(requestsTimeArrangement(text),true)
 assert.ok(deriveTurnObligations(text).requiredEffects.some(e=>e.type==='weekly_plan'&&e.minutes===120))
 for(const no of ['老师怎么安排课程？','室友怎么安排备考？','上次课程怎么安排的？','如果课程怎么安排会比较好？'])assert.equal(requestsTimeArrangement(no),false,no)
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
import {weeklyTimeIntent,remainingWeeklyTimeIntent,weeklyPlanIntent,deriveTurnObligations,isPureControlCommand,isPureZeroPlanRequest,verifyTurnObligations,verifyReplyAgainstObligations,supplementMissingBudgetDeltas,planExplicitCorrection,hoursIn} from '../server/turn-obligations.ts'
test('V19 remaining-week replacement identifies only the matching owned budget, never recurring time',()=>{
 const old=[{id:'remaining',revision:2,kind:'constraint' as const,assertion:'user_reported',text:'这周还剩两小时'},{id:'routine',revision:1,kind:'context' as const,assertion:'user_reported',text:'平时每周能拿出六小时'}]
 assert.equal(planExplicitCorrection('这周剩余时间要改成三十分钟。',old)?.target?.itemId,'remaining')
 for(const text of ['如果这周剩余时间要改成三十分钟。','同学说这周剩余时间要改成三十分钟。','这周剩余时间要改成三十分钟吗？'])assert.equal(planExplicitCorrection(text,old),null,text)
 assert.equal(planExplicitCorrection('这周剩余时间要改成三十分钟。',old.slice(1))?.target,undefined)
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
})

test('new real first failures: one-and-a-half remainder is not thirty minutes and scoped zero can persist from its amount clause',()=>{
 const text='我这周只剩一个半小时，课程和备考怎么取舍？先别都铺开。',obligations=deriveTurnObligations(text)
 assert.doesNotThrow(()=>verifyReplyAgainstObligations(obligations,'这周只剩一个半小时，课程和备考各有什么硬截止？'))
 assert.throws(()=>verifyReplyAgainstObligations(obligations,'这周只剩半小时。'),/REPLY_CONTRADICTS_CURRENT_EFFECT/)
 const zero=deriveTurnObligations('这周后面都排满了，能用的时间是零。下周大概有四小时，先不排具体任务。')
 const deltas=supplementMissingBudgetDeltas(zero,undefined,'00000000-0000-4000-8000-000000000001','这周后面都排满了，能用的时间是零。下周大概有四小时，先不排具体任务。')
 assert.ok(deltas.some(d=>d.source.quote==='能用的时间是零'))
})
