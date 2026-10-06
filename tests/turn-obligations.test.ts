import test from 'node:test'
import assert from 'node:assert/strict'
import {weeklyTimeIntent,remainingWeeklyTimeIntent,weeklyPlanIntent,deriveTurnObligations,isPureControlCommand,verifyTurnObligations,verifyReplyAgainstObligations} from '../server/turn-obligations.ts'
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
  // P1: a different WEEKLY amount in reply text alone is no longer a hard
  // failure — the lexical guard blocked correct opportunity comparisons three
  // real runs in a row. Stale planning stays caught structurally via the
  // required growth update and the plan's availableMinutes binding.
  verifyReplyAgainstObligations(obligations,'好的，继续保持每周6小时的节奏推进。')
  // Control obligations must actually be staged.
  const controlObligations=deriveTurnObligations('先别推升学相关的安排。',{directionControls:pauseChanges})
  assert.throws(()=>verifyTurnObligations(controlObligations,{growth:undefined,controls:undefined,currentText:'先别推升学相关的安排。',reply:'好的。'}),(error:unknown)=>(error as {code?:string}).code==='DIRECTION_CONTROL_NOT_APPLIED')
})

test('remaining weekly budget intent: this-week leftover, never weekly or next-week amounts',()=>{
  assert.deepEqual(remainingWeeklyTimeIntent('这周还剩两小时。'),{quote:'这周还剩两小时',minutes:120})
  assert.deepEqual(remainingWeeklyTimeIntent('本周只剩1.5小时。'),{quote:'本周只剩1.5小时',minutes:90})
  assert.deepEqual(remainingWeeklyTimeIntent('这周，只剩下半小时了。'),{quote:'只剩下半小时了',minutes:30},'周期从同句前置分句继承')
  assert.deepEqual(remainingWeeklyTimeIntent('这周还剩一个半小时。'),{quote:'这周还剩一个半小时',minutes:90})
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
