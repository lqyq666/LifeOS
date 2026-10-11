import {chineseInteger} from './growth-time.ts'
import { scanUserClauses, parseExactHours } from './user-command-spans.ts'
import type { DirectionScope, RawDirectionControl, PreparedDirectionControls } from './growth-controls.ts'
import type { GrowthStaged } from './growth.ts'

// P5.2/N1.2: obligations exist only for explicit, checkable commands — never
// for small talk, questions, conditionals or other people's words. This is a
// limited syntax detector built on the shared clause scanner, not a general
// semantic classifier; unseen phrasings create no obligation and stay open to
// review (or surface as needs_confirmation upstream).
export type RequiredEffect =
  | {type:'weekly_time';quote:string;minutes:number;period:'current'|'this_week'|'next_week'}
  // PC07: "这周还剩N小时" is the budget REMAINING inside the current calendar
  // week — never a recurring weekly amount and never a next-week plan. It must
  // persist as a week-scoped constraint, so it expires with the week instead of
  // silently reshaping future weeks. weekQuote is the user's own 本周/这周 token
  // the server can use as calendar evidence.
  | {type:'remaining_time';quote:string;minutes:number;weekQuote:string}
  | {type:'direction_control';scopes:DirectionScope[];operation:'pause'|'resume'}
  | {type:'grounded_material';materialKind:'resume_portfolio'}
  | {type:'weekly_plan';period:'current'|'this_week'|'next_week';minutes:number}
export type TurnObligations = {
  kind:'ordinary'|'update_weekly_time'|'direction_control'|'resume_portfolio'|'mixed'
  requiredEffects:RequiredEffect[]
}
const arrangementRequest=/(?:请(?:帮我)?|帮我)(?:给|为)[^不别；。！？?!]{1,16}(?:安排|排)|(?:安排|计划)(?:帮我)?(?:改|调整|修改|更新|排|重新)|(?:请(?:帮我)?|帮我)(?:安排|排)|改一下安排|调整.{0,4}安排|重新(?:安排|排)|再(?:安排|排)一?(?:次|下)?|怎么(?:安排|排|规划)|(?:只|仅|请(?:帮我)?|帮我)?(?:保存|建立|生成|给我)(?:一个|一份)?空(?:安排|计划)/
// N2.3: only an explicit request to arrange/re-arrange creates a plan
// obligation; stating a weekly budget alone only requires the fact.
export function weeklyPlanIntent(text:string):{period:'current'|'this_week'|'next_week'}|null{
  for(const sentence of groupBySentence(scanUserClauses(text))){
    for(const clause of sentence){
      const body=clause.text.trim()
      if(!body)continue
      if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||thirdPersonSubject.test(body))continue
      if(arrangementRequest.test(body)){
        // P2 (B10): a past-tense question (怎么安排的) asks what WAS done, not
        // for a plan.
        if(/怎么(?:安排|排|规划)的[？?]?$/.test(body))continue
        // P2 (B10/B05): a week marker in the PLAN REQUEST clause itself always
        // wins; sentence markers only inherit when the request names no week.
        // (下周我每周只有4小时，帮我安排本周 → the plan is for THIS week.)
        const period=/下周/.test(body)?'next_week':/(?:这周|本周)/.test(body)?'this_week':/下周/.test(joinClauses(sentence.filter(c=>c!==clause)))?'next_week':/(?:这周|本周)/.test(joinClauses(sentence.filter(c=>c!==clause)))?'this_week':'current'
        return {period}
      }
    }
  }
  return null
}
const joinClauses=(clauses:readonly UserClauseLike[])=>clauses.map(clause=>clause.text).join('')

const thirdPersonSubject=/^(?:室友|同学|朋友|他|她|他们|她们|别人|大家|我妈|我爸|父母|家人|老师|辅导员)/
const inexactBudget=/(?:大概|大约|左右|至少|最多|不超过|可能|到|至|－|~)/
// An opportunity's OWN demanded hours (实习每周15小时) are not the user's
// budget. Inside a sentence that mentions an opportunity, a bare 每周N小时
// clause only counts when it reads as the user's own availability.
const opportunityNoun=/(?:实习|岗位|兼职|机会|项目|offer|Offer|OFFER)/
const ownAvailability=/(?:我|自己|能|可|只有|只剩|还剩|拿出|投入|腾)/
// P2 (B06): 实习要求我每周投入15小时 — the opportunity noun itself carrying a
// demand verb marks the amount as the OPPORTUNITY's requirement even when the
// clause mentions 我. 我要每周投入… (my own commitment) keeps counting.
const opportunityDemand=/(?:实习|岗位|兼职|机会|项目|offer|Offer|OFFER)(?:的)?(?:要求|需要|要|得)(?:我|本人)?/
// The full numeric token is captured atomically so a decimal point can never
// be swallowed by a wildcard prefix (N1.2: 1.5小时 is 90 minutes, not 300).
const weeklyBudget=/每(?:周|星期)[^，,。；;！？!?\n]{0,8}?([0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+)(?:个)?(?:小时|钟头)/
// Bare amounts (做作品花了3小时) resolve exactly but never claim to be weekly.
const bareHours=/([0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+)\s*(?:个)?(?:小时|钟头)/

export function weeklyTimeIntent(text:string):{quote:string;minutes:number;period:'current'|'this_week'|'next_week'}|null{
  for(const sentence of groupBySentence(scanUserClauses(text))){
    // Period markers inherit from earlier clauses of the same sentence.
    let period:'current'|'this_week'|'next_week'='current'
    let mentionsOpportunity=false
    for(const clause of sentence){
      const body=clause.text.trim()
      if(!body)continue
      if(/下周/.test(body))period='next_week'
      else if(/(?:这周|本周)/.test(body))period='this_week'
      if(opportunityNoun.test(body))mentionsOpportunity=true
      // N1.1 guards: quoted/code spans, other people's speech, conditional
      // clauses and question clauses never state the user's current budget.
      if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther)continue
      if(clause.interrogative)continue
      if(thirdPersonSubject.test(body))continue
      // An explicit negation of the amount is not a budget statement.
      if(/(?:不是|并没有|没说|并非|没)/.test(body))continue
      if(inexactBudget.test(body))continue
      // 这周剩N小时 is a remaining budget, not a weekly one; refused this batch.
      if(/剩/.test(body)&&!weeklyBudget.test(body))continue
      const match=weeklyBudget.exec(body)
      if(!match)continue
      // PC13/C04 + B06: an opportunity's demanded hours are never the user's
      // budget — neither a bare amount beside the opportunity, nor an explicit
      // 要求/需要+每周 demand clause, even one that mentions 我.
      if(mentionsOpportunity&&(!ownAvailability.test(body)||opportunityDemand.test(body)))continue
      const minutes=parseExactHours(match[1]!)
      if(minutes===null)continue
      if(minutes<0||minutes>10080)continue
      return {quote:body,minutes,period}
    }
  }
  return null
}

// PC07 + P2 (B01): the budget inside the CURRENT calendar week — an explicit
// "这周…剩N小时" or "这周我只有N小时" availability statement. The week marker may
// sit in an earlier clause of the same sentence (这周，只剩两小时). Next-week
// clauses and marker-less statements stay out rather than being guessed into
// this week. Spent time (花了/用了) and attached nouns (两小时课) never count.
const remainingBudget=/((?:只)?还?剩(?:下|着)?|(?:只|就)?有|(?:只|就)|可用)[^，,。；;！？!?\n]{0,4}?((?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半|个)?\s*(?:小时|钟头))(?![课班])/
// 半小时=30, 一个半小时=90 resolve through parseExactHours on the whole token
// first; bare amounts (两小时) strip the unit. Ambiguous forms (两个半小时) refuse.
const remainingMinutes=(token:string):number|null=>{
  const direct=parseExactHours(token)
  if(direct!==null)return direct
  return parseExactHours(token.replace(/(?:小时|钟头)$/,'').replace(/个$/,''))
}
export function remainingWeeklyTimeIntent(text:string):{quote:string;minutes:number;weekQuote:string}|null{
  for(const sentence of groupBySentence(scanUserClauses(text))){
    let weekScoped=false,weekQuote=''
    // P3 (TM1): a bare week marker re-scopes the REST of the sentence —
    // "这周我忙，下周，只剩两小时" makes the amount NEXT-week's, overriding the
    // earlier 这周.
    let sentenceWeek:'this'|'next'|null=null
    for(const clause of sentence){
      const body=clause.text.trim()
      if(!body)continue
      // P4 (R06): the week marker is bidirectional - a LATER 这周/本周
      // marker re-scopes back from next-week (下周我忙，这周，只剩两小时).
      if(/下周/.test(body)){sentenceWeek='next'}
      else if(/(?:这|本)周/.test(body)){sentenceWeek='this'}
      // P2 (B03): a clause scoped to NEXT week (下周只剩两小时) never becomes a
      // this-week constraint, even when an earlier clause said 这周.
      if(/下周/.test(body))continue
      const ownWeek=/(?:这|本)周/.exec(body)
      if(ownWeek){weekScoped=true;weekQuote=ownWeek[0]}
      if(sentenceWeek==='next')continue
      if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther)continue
      if(clause.interrogative)continue
      if(thirdPersonSubject.test(body))continue
      if(/(?:不是|并没有|没说|并非|没|不剩|没剩|没有剩|花[了到]?[0-9一二两三四五六七八九十百半.]|用掉|用完)/.test(body))continue
      if(inexactBudget.test(body))continue
      if(!weekScoped)continue
      const match=remainingBudget.exec(body)
      if(!match)continue
      const minutes=remainingMinutes(match[2]!)
      if(minutes===null||minutes<0||minutes>10080)continue
      return {quote:body,minutes,weekQuote:weekQuote||'这周'}
    }
  }
  return null
}

// The workflow and its evidence gate share this selector. Amount conversion,
// clause protection and explicit recurring/remainder effects stay in this file.
export type BudgetContext={period:'this_week'|'next_week';question:string;anchor:string}
export type ApplicableBudget={period:'current'|'this_week'|'next_week';amountMinutes:number;scope:'recurring'|'available'|'remaining';qualification:'exact'|'estimate'|'upper_bound';quote:string;reason:string}
export function applicableTimeBudget(text:string,context?:BudgetContext,target?:'this_week'|'next_week',options:{retainReportedBudget?:boolean}={}):ApplicableBudget|undefined{
 const clauses=scanUserClauses(text),valid=clauses.filter(c=>!c.quoted&&!c.code&&!c.conditional&&!c.attributedToOther&&!c.interrogative&&!/[？?]/.test(c.delimiter))
 if(!options.retainReportedBudget&&valid.some(c=>/先别分析|不要分析|不想继续|拒绝继续|取消|只想倾诉|只听我说|不要建议|不想要建议/.test(c.text)))return undefined
 const candidates:ApplicableBudget[]=[]
 let sentence=-1,period:'this_week'|'next_week'|undefined,correction=false,mentionsOpportunity=false
 for(const clause of clauses){
  if(clause.sentenceStart!==sentence){sentence=clause.sentenceStart;period=undefined;mentionsOpportunity=false}
  if(!valid.includes(clause))continue
  const original=clause.text.trim(),body=original.replace(/^(?:但是|不过|但|其实|更正一下|更正|改为)\s*/,'')
  if(/下周/.test(body))period='next_week';else if(/这周|本周/.test(body))period='this_week'
  if(opportunityNoun.test(body))mentionsOpportunity=true
  const explicitNoTime=/^(?:我|本人)?(?:这周|本周|下周)?(?:我|本人)?(?:已经)?没有(?:能用的?|可用的?|空闲)时间(?:了)?$/.test(body)
  if(thirdPersonSubject.test(body)||opportunityDemand.test(body)||(!explicitNoTime&&/已经|已花|花了|用了|用掉|用完|不是|并非|至少|到八|到十/.test(body))||clause.quoteSpans.length||clause.codeSpans.length)continue
  if(/更正|改为|其实/.test(original))correction=true
  if(mentionsOpportunity&&/每周|每星期/.test(body)&&(!ownAvailability.test(body)||opportunityDemand.test(body)))continue
  const qualification=/大概|大约|左右/.test(body)?'estimate':/最多|不超过|上限/.test(body)?'upper_bound':'exact'
  const exact=body.replace(/大概|大约|左右|最多|不超过|上限/g,'')
  const recurring=weeklyTimeIntent(exact)
  const remainder=remainingWeeklyTimeIntent((period==='this_week'&&!/这周|本周/.test(exact)?'这周':'')+exact)
  let candidate:ApplicableBudget|undefined
  if(recurring)candidate={period:/每周|每星期/.test(exact)&&!/下周|这周|本周/.test(exact)?'current':recurring.period,amountMinutes:recurring.minutes,scope:'recurring',qualification,quote:original,reason:'本人常规周投入'}
  else if(remainder)candidate={period:'this_week',amountMinutes:remainder.minutes,scope:/剩/.test(exact)?'remaining':'available',qualification,quote:original,reason:'指定周本人可用或剩余时间'}
  else {
   // Omitted answers require a durable, explicit own-availability question.
   const scoped=period??(context&&/本人.*(?:可用|剩余)/.test(context.question)?context.period:undefined)
   const match=/^(?:我|本人)?(?:(?:这周|本周|下周))?(?:我|本人)?(?:有|可用|能用|只有|仅有|能拿出|可拿出|只剩|仅剩|还剩)?\s*([0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+)(?:个)?(小时|钟头|分钟)(?:可用)?(?:吧|呀|啊)?$/.exec(exact)
   const amount=match?(match[2]==='分钟'?chineseInteger(match[1]!):parseExactHours(match[1]!)):null
   const noTime=explicitNoTime||/^(?:我|本人)?(?:这周|本周|下周)?(?:我|本人)?(?:没空|没有空闲时间|没有可用时间|(?:能用|可用)(?:的)?时间(?:是|为)(?:零|0))$/.test(exact)
   if(scoped&&(noTime||amount!==null))candidate={period:scoped,amountMinutes:noTime?0:amount!,scope:/剩/.test(exact)?'remaining':'available',qualification,quote:original,reason:period?'指定周本人可用时间':'承接持久任务的本人可用时间追问'}
  }
  if(candidate&&Number.isSafeInteger(candidate.amountMinutes)&&candidate.amountMinutes>=0&&candidate.amountMinutes<=10080){
   if(correction){for(let i=candidates.length-1;i>=0;i--)if(candidates[i]!.period===candidate.period)candidates.splice(i,1);correction=false}
   candidates.push(candidate)
  }
 }
 const plan=weeklyPlanIntent(text)?.period
 const wanted=target??(plan==='next_week'?'next_week':plan==='this_week'?'this_week':context?.period??(candidates.some(c=>c.period==='this_week')?'this_week':candidates.some(c=>c.period==='next_week')?'next_week':'this_week'))
 const eligible=candidates.filter(c=>c.period==='current'||c.period===wanted)
 const rank=(c:ApplicableBudget)=>c.period==='current'?1:c.scope==='remaining'?3:2
 const strongest=eligible.filter(c=>rank(c)===Math.max(...eligible.map(rank)))
 if(!strongest.length||new Set(strongest.map(c=>c.amountMinutes)).size>1)return undefined
 const chosen=strongest.at(-1)!
 return {...chosen,period:chosen.period==='current'&&plan&&plan!=='current'?wanted:chosen.period}
}

function groupBySentence(clauses:readonly UserClauseLike[]):UserClauseLike[][]{
  const groups:UserClauseLike[][]=[]
  let currentKey=-1
  for(const clause of clauses){
    if(clause.sentenceStart!==currentKey){currentKey=clause.sentenceStart;groups.push([])}
    groups.at(-1)!.push(clause)
  }
  return groups
}
type UserClauseLike={start:number;end:number;text:string;delimiter:string;sentenceStart:number;sentenceEnd:number;quoted:boolean;code:boolean;conditional:boolean;attributedToOther:boolean;interrogative:boolean}

export function deriveTurnObligations(currentText:string,options:{resumePortfolioMode?:boolean;directionControls?:readonly RawDirectionControl[]}={}):TurnObligations{
  const effects:RequiredEffect[]=[]
  const weekly=weeklyTimeIntent(currentText)
  if(weekly)effects.push({type:'weekly_time',...weekly})
  const remaining=remainingWeeklyTimeIntent(currentText)
  if(remaining)effects.push({type:'remaining_time',...remaining})
  const plan=weeklyPlanIntent(currentText)
  const applicable=applicableTimeBudget(currentText,undefined,plan?.period==='next_week'?'next_week':plan?.period==='this_week'?'this_week':undefined,{retainReportedBudget:true})
  // Use the same current-event selector as workflows and persistence. A bare
  // "这周零小时可用" is a real budget, although not a recurring/remainder phrase.
  if(!weekly&&!remaining&&applicable){
    if(applicable.scope==='remaining'&&applicable.period==='this_week')effects.push({type:'remaining_time',quote:applicable.quote,minutes:applicable.amountMinutes,weekQuote:/本周/.test(currentText)?'本周':'这周'})
    else effects.push({type:'weekly_time',quote:applicable.quote,minutes:applicable.amountMinutes,period:applicable.period})
  }
  const future=applicableTimeBudget(currentText,undefined,'next_week',{retainReportedBudget:true})
  if(future?.period==='next_week'&&future.quote!==applicable?.quote&&!effects.some(e=>e.type==='weekly_time'&&e.quote===future.quote))effects.push({type:'weekly_time',quote:future.quote,minutes:future.amountMinutes,period:'next_week'})
  // P2 (B05/B10): the plan binds to the budget that actually APPLIES to the
  // plan's own period. A next-week plan never binds to this week's remainder
  // or to a this-week-scoped amount; it uses the recurring weekly budget. A
  // current/this-week plan binds to the tightest stated amount. When nothing
  // applies (a this-week plan with only a next-week budget, or vice versa)
  // there is no plan obligation at all — the honest gap, never a quietly
  // re-scoped plan.
  if(plan){
    const bindingMinutes=applicable?.amountMinutes??null
    if(bindingMinutes!==null)effects.push({type:'weekly_plan',period:plan.period==='current'&&applicable?.period==='this_week'?'this_week':plan.period,minutes:bindingMinutes})
  }
  for(const change of options.directionControls??[])effects.push({type:'direction_control',scopes:change.scopes,operation:change.operation})
  if(options.resumePortfolioMode)effects.push({type:'grounded_material',materialKind:'resume_portfolio'})
  const families=new Set(effects.map(effect=>effect.type==='remaining_time'?'weekly_time':effect.type))
  const kind=families.size>1?'mixed'
    :families.has('weekly_time')?'update_weekly_time'
    :families.has('direction_control')?'direction_control'
    :families.has('grounded_material')?'resume_portfolio'
    :'ordinary'
  return {kind,requiredEffects:effects}
}

// A pure control message contains nothing but the explicit command clauses and
// trivial connectives — it can be answered deterministically without a model.
export const ignorableConnectives=new Set(['谢谢','好的','好','请','嗯','哦','ok','OK','Okay','okay'])
// P6 closeout C2/D: did the user ask to arrange/re-arrange time THIS message?
// A model-supplied weeklyPlan is spurious only when this is false; a real
// arrangement request keeps the full plan contract even without a stated
// amount (the no-binding-amount gap stays honest in the obligation detector).
export function requestsTimeArrangement(text:string):boolean{
  for(const clause of scanUserClauses(text)){
    const body=clause.text.trim()
    if(!body)continue
    if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||thirdPersonSubject.test(body))continue
    if(arrangementRequest.test(body)){
      if(/怎么(?:安排|排|规划)的[？?]?$/.test(body))continue
      return true
    }
  }
  return false
}

export function isPureControlCommand(currentText:string,obligations:TurnObligations,controlQuotes:readonly string[]):boolean{
  if(obligations.kind!=='direction_control'||!obligations.requiredEffects.length||!controlQuotes.length)return false
  const controlClauses=new Set(controlQuotes)
  return scanUserClauses(currentText).every(clause=>{
    const body=clause.text.trim()
    // Only whitespace, pure punctuation and fixed politeness words are neutral;
    // any real content (为什么/怎么办/会怎样…) keeps the turn out of the
    // zero-model shortcut so the question is actually answered.
    return !body||!/[\p{L}\p{N}]/u.test(body)||controlClauses.has(body)||ignorableConnectives.has(body)
  })
}

const hoursIn=(text:string):number|null=>{
  const weekly=weeklyBudget.exec(text)
  if(weekly)return parseExactHours(weekly[1]!)
  const bare=/(?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半|个)?\s*(?:小时|钟头)/.exec(text)
  if(!bare){
    // Arithmetic for an already independently authorized fact. The existing
    // parser handles minute tokens and standalone zero; this context does not
    // supply temporal authority to staging or turn obligations.
    const available=applicableTimeBudget(text,{period:'this_week',question:'本人可用时间',anchor:'AMOUNT_CHECK_ONLY_NOT_TIME_AUTHORITY'})
    return available?.qualification==='exact'?available.amountMinutes:null
  }
  return remainingMinutes(bare[0]!)
}
export {hoursIn}

export type ObligationVerificationInput={
  growth:GrowthStaged|undefined
  controls:PreparedDirectionControls|undefined
  coachActionDraft?:{readiness?:string;content?:string;materialFactIds?:string[]}|null
  weeklyPlan?:unknown
  currentText:string
  reply:string
}

// P5.3 step 4: required state changes must actually exist in the staged batch.
// A reply that answers an old topic while the required update is absent fails
// the turn — the absence of a source error is not success.
export function verifyTurnObligations(obligations:TurnObligations,staged:ObligationVerificationInput):void{
  for(const effect of obligations.requiredEffects){
    if(effect.type==='weekly_time'){
      const covered=(staged.growth?.changes??[]).some(delta=>delta.assertion==='user_reported'
        &&['context','constraint'].includes(delta.kind)
        &&staged.currentText.includes(delta.source.quote)
        &&hoursIn(delta.text)===effect.minutes)
      if(!covered)throw new ObligationError('GROWTH_REQUIRED_UPDATE_MISSING')
    }
    if(effect.type==='remaining_time'){
      // The remaining budget must land as a week-scoped constraint (resolved
      // validity from the user's own words), never as an open-ended context
      // item that would quietly reshape the following weeks.
      const covered=(staged.growth?.changes??[]).some(delta=>delta.assertion==='user_reported'
        &&delta.kind==='constraint'
        &&staged.currentText.includes(delta.source.quote)
        &&hoursIn(delta.text)===effect.minutes
        &&'validUntil'in delta&&typeof delta.validUntil==='string'&&Boolean(delta.validUntil))
      if(!covered)throw new ObligationError('GROWTH_REQUIRED_UPDATE_MISSING')
    }
    if(effect.type==='weekly_plan'){
      // A required plan must be a staged structured plan whose budget matches
      // the verified weekly minutes; a free-text list in the reply never counts.
      const plan=staged.weeklyPlan as {input?:{availableMinutes?:number}}|undefined
      const covered=Boolean(plan&&plan.input&&plan.input.availableMinutes===effect.minutes)
      if(!covered)throw new ObligationError('WEEKLY_PLAN_REQUIRED_MISSING')
    }
    if(effect.type==='grounded_material'){
      // The obligation needs an actual SERVER-RENDERED material: real content
      // plus resolved fact references, never a bare readiness string.
      const draft=staged.coachActionDraft
      const rendered=Boolean(draft&&typeof draft.content==='string'&&draft.content.trim()&&Array.isArray(draft.materialFactIds))
      if(!rendered)throw new ObligationError('MATERIAL_MODE_MISMATCH')
    }
    if(effect.type==='direction_control'){
      const covered=(staged.controls?.changes?.length??0)>0&&(staged.controls?.changes??[]).some(change=>change.operation===effect.operation&&effect.scopes.every(scope=>change.scopes.includes(scope)))
      if(!covered)throw new ObligationError('DIRECTION_CONTROL_NOT_APPLIED')
    }
  }
}

// P5.3 step 8 (P2 revision → D-gate replay P4): a reply must not AFFIRM a
// different amount of the user's OWN just-stated budget (你每周有6小时 while
// the user just said 2h). The check is deliberately narrow after the D-batch
// false positives: an amount attributed to ANOTHER activity (标注每周要占3小时,
// 三门课每周吃掉N小时) or an ALLOCATION inside the stated budget (两小时里剩下
// 1小时做备份) is informational planning, never an affirmation of the user's
// total. Only a span that states the user's own current budget in the reply's
// own voice may contradict. The structural checks (required growth update
// carries the new amount; a staged plan's availableMinutes equals the binding
// budget) remain the primary guard and stay exact.
const otherActivityAttribution=/(?:实习|岗位|项目|机会|兼职|课题|标注|课程|硬课|学业|功课|这份|该|对方|它|他们|要求|需要|要占|占|吃掉|花|用掉|留给|排给|最多|至少|超过|多于|不到|低于|如果|若|假设|大概|可能)/
const userBudgetVoice=/(?:你|您)/
const changeFraming=/(?:从|降到|改为|变为|变成|减到|减少到|换成|改到|降为|调整到)/
// The allocation signal lives in the text BEFORE the amount (排/留/备份…),
// never in the amount span itself.
const allocationFraming=/(?:排|留|给|用|花|占|备份|另一|第二|其中|之一|里|中|内|后|做完|发完|完成后)/
export function verifyReplyAgainstObligations(obligations:TurnObligations,reply:string):void{
  for(const effect of obligations.requiredEffects){
    if(effect.type==='weekly_time'){
      for(const match of reply.matchAll(/每(?:周|星期)[^，,。；;！？!\n]{0,8}?((?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半|个)?\s*(?:小时|钟头))/g)){
        const stated=remainingMinutes(match[1]!)
        if(stated===null||stated===effect.minutes)continue
        const before=reply.slice(Math.max(0,match.index-14),match.index)
        // Contradiction requires the reply to state the USER's own recurring
        // budget; anything attached to another activity or a comparison/change
        // framing stays informational (L2:4 每周要占3小时 shape).
        if(otherActivityAttribution.test(before)||otherActivityAttribution.test(match[0]))continue
        if(changeFraming.test(before)||changeFraming.test(match[0]))continue
        throw new ObligationError('REPLY_CONTRADICTS_CURRENT_EFFECT')
      }
    }
    if(effect.type==='remaining_time'){
      // A different REMAINING amount contradicts only when the reply restates
      // the user's week total in its own voice; planning allocations inside
      // the budget (D01:4 两小时里剩下约1小时) never do. A weekly amount
      // never contradicts a remaining one (每周6小时 with 这周剩2小时 is normal).
      for(const match of reply.matchAll(/(?:只)?还?剩(?:下|着)?[^，,。；;！？!\n]{0,6}?((?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半|个)?\s*(?:小时|钟头))/g)){
        const stated=remainingMinutes(match[1]!)
        if(stated===null||stated===effect.minutes)continue
        const before=reply.slice(Math.max(0,match.index-10),match.index)
        if(allocationFraming.test(before)||changeFraming.test(before))continue
        if(!userBudgetVoice.test(before)&&!/(?:这|本)周/.test(before))continue
        throw new ObligationError('REPLY_CONTRADICTS_CURRENT_EFFECT')
      }
    }
  }
}

const scopeLabels:Record<DirectionScope,string>={employment:'就业',postgraduate_recommendation:'推免',postgraduate_exam:'考研',public_service:'考公考编',entrepreneurship:'创业',overseas_study:'留学出境升学',undergraduate_upgrade:'专升本',freelance:'自由职业'}
export function controlReplyText(effects:RequiredEffect[]):string{
  const parts:string[]=[]
  for(const effect of effects)if(effect.type==='direction_control')
    parts.push((effect.operation==='pause'?'已暂停':'已恢复')+effect.scopes.map(scope=>scopeLabels[scope]).join('、')+(effect.operation==='pause'?'相关方向的新建议。':'建议。'))
  return parts.join('')||'已更新方向设置。'
}

// P1/P2: a server-verified weekly/remaining budget the model failed to persist
// is staged deterministically from the obligation itself — the same trust
// pattern as explicit direction controls. The quote is the user's own verbatim
// clause; nothing beyond it is ever written. P2 (B04): a weekly amount scoped
// to THIS or NEXT week persists as a week-scoped constraint so its applicable
// period survives; an unscoped recurring amount stays an open context fact.
export function supplementMissingBudgetDeltas(obligations:TurnObligations,stagedGrowth:import('./growth.ts').GrowthStaged|undefined,currentMessageId:string,currentText=''):import('./growth-model-contracts.ts').ResolvedGrowthDelta[]{
  if(!obligations.requiredEffects.length)return []
  const covered=(effect:Extract<RequiredEffect,{type:'weekly_time'|'remaining_time'}>)=>(stagedGrowth?.changes??[]).some(delta=>delta.assertion==='user_reported'
    &&(effect.type==='remaining_time'?delta.kind==='constraint':['context','constraint'].includes(delta.kind))
    &&hoursIn(delta.text)===effect.minutes)
  const deltas:import('./growth-model-contracts.ts').ResolvedGrowthDelta[]=[]
  for(const effect of obligations.requiredEffects){
    if(effect.type==='weekly_time'&&!covered(effect)){
      // P3 (TM2): 从下周起/下周开始 introduces a NEW RECURRING schedule, not an
      // only-next-week constraint — the verbatim context keeps the from-date
      // readable and the schedule survives past next week. The marker sits in
      // an earlier clause of the message, so detection uses the full text.
      // P4 (R05): 从下周起 recurring schedules persist as verbatim context; the
      // from-marker requirement is handled by quoting the FULL user clause below.
      const fromNextWeek=/(?:从下周起|下周起|下周开始|从下周开始)/.test(currentText)
      const recurringFromNextWeek=fromNextWeek
      // P4 (R05): the persisted quote re-includes the from-marker clause so the
      // future-start survives reading (verbatim contiguous span of the message).
      const fromMarkerQuote=(quote:string):string=>{
        if(!fromNextWeek)return quote
        const at=currentText.indexOf(quote)
        if(at<0)return quote
        const before=currentText.slice(0,at)
        const m=/(?:从下周起|下周起|下周开始|从下周开始)[，,。]?。?[^，,。]*[，,]?。?$/.exec(before)
        return m?m[0]+quote:quote
      }
      if(effect.period==='current'||recurringFromNextWeek)
        deltas.push({target:{operation:'create'},assertion:'user_reported',kind:'context',source:{messageId:currentMessageId,quote:fromMarkerQuote(effect.quote)}})
      else{
        const token=effect.period==='next_week'?'下周':(/(?:这|本)周/.exec(effect.quote)?.[0]??(/(?:这|本)周/.exec(currentText)?.[0]??'这周'))
        deltas.push({target:{operation:'create'},assertion:'user_reported',kind:'constraint',source:{messageId:currentMessageId,quote:effect.quote},timeEvidence:{kind:'calendar_week',which:effect.period==='next_week'?'next':'this',quote:token}})
      }
    }
    if(effect.type==='remaining_time'&&!covered(effect))
      deltas.push({target:{operation:'create'},assertion:'user_reported',kind:'constraint',source:{messageId:currentMessageId,quote:effect.quote},timeEvidence:{kind:'calendar_week',which:'this',quote:effect.weekQuote}})
  }
  return deltas
}

export class ObligationError extends Error{readonly code:string;constructor(code:string){super(code);this.code=code}}

export function isPureZeroPlanRequest(text:string,obligations:TurnObligations):boolean{
 const plan=obligations.requiredEffects.find(e=>e.type==='weekly_plan'),budget=obligations.requiredEffects.find(e=>e.type==='weekly_time'||e.type==='remaining_time')
 if(plan?.type!=='weekly_plan'||plan.minutes!==0||!budget||obligations.requiredEffects.some(e=>!['weekly_plan','weekly_time','remaining_time'].includes(e.type)))return false
 return scanUserClauses(text).every(clause=>{
  const body=clause.text.trim()
  if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.interrogative)return false
  if(!body||ignorableConnectives.has(body))return true
  if(/为什么|如何|怎么|另外|同时|解释|起草|写|简历|消息|报告|交付|发送|反馈|更正|忘|拒绝|暂停|不想/.test(body))return false
  return body===budget.quote||applicableTimeBudget(body)?.amountMinutes===0||/^(?:是|也就是|就是)?(?:零|0)(?:个)?(?:小时|钟头)(?:了)?$/.test(body)||requestsTimeArrangement(body)
 })
}
export const isObligationError=(error:unknown):error is ObligationError=>error instanceof ObligationError

// ── P2-1: explicit corrections must actually land ──────────────────────────
// An explicit correction marker in the user's own words makes the turn carry
// a REQUIRED state change: the new value must verifiably reach the user's
// facts (an amend/replace of the old item, or at minimum a verbatim create).
// Optional observations may still be skipped; this class may not.
const correctionMarker=/(?:更正|说错了?|搞错了?|记错了?|写错了?|看错了?)/
export type CorrectionPlan={
  // The user's own affirmative new-value words, verbatim in the message.
  newQuote:string
  // Best-effort deterministic amend target, derived ONLY from character
  // overlap between the correction message and the authorized old items.
  target:undefined|{
    itemId:string
    expectedRevision:number
    // The single old clause to swap out; must appear verbatim exactly once.
    beforeQuote:string
    kind:'context'|'constraint'|'ability'|'preference'|'goal'|'direction'|'priority'|'decision'|'feedback'|'observation'|'unknown'
  }
}
const carriesText=(text:string)=>/[\p{L}\p{N}]/u.test(text)
const sharedChars=(a:string,b:string)=>{
  const set=new Set([...a.replace(/[^\p{L}\p{N}]/gu,'')])
  let count=0
  for(const char of b.replace(/[^\p{L}\p{N}]/gu,''))if(set.has(char)){count++;set.delete(char)}
  return count
}
export type CorrectionCandidate={id:string;revision:number;kind:NonNullable<CorrectionPlan['target']>['kind'];assertion:string;text:string}
export function planExplicitCorrection(text:string,authorized:readonly CorrectionCandidate[]):CorrectionPlan|null{
  const clauses=scanUserClauses(text)
  let markerIndex=-1
  for(const [index,clause] of clauses.entries()){
    const body=clause.text.trim()
    if(!body)continue
    // P3 (CP6): a conditional clause (如果我说错了，更正一下：…) inherits the
    // sentence's hypothesis scope and never authorizes changing a fact.
    if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.interrogative)continue
    // A conditional OPENER clause (如果我说错了) itself may contain a marker
    // word (说错了) — it states a hypothesis, not a correction.
    if(/(?:如果|(?<![主重只必还需总概])要是|假如|假设|万一|一旦)/.test(body))continue
    if(correctionMarker.test(body)||/^不对[，,。！？]?$/.test(body)){markerIndex=index;break}
  }
  if(markerIndex<0)return null
  // New value: the marker clause with the marker prefix stripped (更正一下：我是大二
  // → 我是大二), else the next affirmative first-person clause of the same
  // sentence (不对，我不是…，我是想… → 我是想…). Denials are not the new value.
  const markerBody=clauses[markerIndex]!.text.trim()
  let newQuote=markerBody.replace(/^.{0,3}更正(?:一下)?[：:，,]?/,'').replace(/^(?:不对|不是的?)[，,。！？]?/,'').trim()
  if(!carriesText(newQuote)||!/我/.test(newQuote)){
    newQuote=''
    for(const clause of clauses.slice(markerIndex+1)){
      const body=clause.text.trim()
      if(clause.sentenceStart!==clauses[markerIndex]!.sentenceStart)break
      if(!body||clause.quoted||clause.code||clause.attributedToOther||clause.interrogative)continue
      if(/^(?:不对|不是的?)[，,。！？]/.test(body))continue
      if(/我/.test(body)&&!/(?:不是|并没有|没)/.test(body)&&carriesText(body)){newQuote=body;break}
    }
  }
  if(!newQuote||!text.includes(newQuote))return null
  // Re-asserting what is already saved verbatim is a no-op, not a correction
  // needing a write (合法重复确认不应被强制写入).
  if(authorized.some(item=>(item.assertion==='user_reported'||item.assertion==='user_edit')&&item.text.includes(newQuote)))return null
  // Emphasis-only restatement (我确实是每周三小时 vs saved 我每周三小时) is
  // a no-op ONLY when every added character is an emphasis filler: negations
  // (不/没/别/非/无/未), digits and any other new content make it a REAL
  // change (P3 CP1-CP3: 我不喜欢考研 / 我每周13小时 / 我不支持考研).
  // P4 (R02/R03): hedge words carry REAL certainty changes - they are stripped
  // for the no-op comparison only, and the comparison additionally requires the
  // SAVED text to already carry the same hedging. Certainty flips are changes.
  const hedgeWords=/[大概左左州左右可能应该一定还算差不多]/
  const stripEmphasis=(value:string)=>value.replace(/(?:确实|真的|就是|应该|大概|可能|比较|一定|还算|差不多)/g,'')
  const fillerChars=new Set([...'确实是了的就吧呢啊嘛也很还都'])
  for(const item of authorized){
    if(item.assertion!=='user_reported'&&item.assertion!=='user_edit')continue
    const oldChars=new Set(stripEmphasis(item.text).replace(/[^\p{L}\p{N}]/gu,'')),newChars=new Set(stripEmphasis(newQuote).replace(/[^\p{L}\p{N}]/gu,''))
    let covered=true
    for(const char of oldChars)if(!newChars.has(char)){covered=false;break}
    if(!covered)continue
    const added=[...newChars].filter(char=>!oldChars.has(char))
    const oldHedged=hedgeWords.test(item.text),newHedged=hedgeWords.test(newQuote)
    const numsOf=(value:string)=>(value.match(/[0-9]+(?:\.[0-9]+)?/g)??[]).join('|')
    // P4 (R01): identical character sets never prove identical numbers - 13 vs 31.
    if(numsOf(item.text)!==numsOf(newQuote))continue
    if(oldChars.size>=3&&added.every(char=>fillerChars.has(char))&&oldHedged===newHedged)return null
  }
  // Deterministic amend target: the old item whose clauses overlap BOTH the
  // new value and the rest of the correction message (the part that usually
  // names the old value: 刚才说成大三了 / 策划主要是队长做的). Requires a clear
  // margin over the runner-up clause so a wrong item is never rewritten.
  type Scored={item:CorrectionCandidate;clause:string;score:number}
  // P3: generic pronouns/particles (我/了/的/一…) never count toward target
  // selection — otherwise an unrelated old item sharing only 我,了,一 scores
  // high enough to be wrongly amended (相似旧事件误改).
  const genericChars=new Set([...'我你他她它们了的是一在有就和都也与及还'])
  const scoreChars=(a:string,b:string)=>{
    const set=new Set([...a.replace(/[^\p{L}\p{N}]/gu,'')].filter(char=>!genericChars.has(char)))
    let count=0
    for(const char of b.replace(/[^\p{L}\p{N}]/gu,''))if(set.has(char)){count++;set.delete(char)}
    return count
  }
  const restOfMessage=clauses.map(clause=>clause.text).join('').replace(newQuote,'')
  const scored:Scored[]=[]
  for(const item of authorized){
    if(item.assertion!=='user_reported'&&item.assertion!=='user_edit')continue
    if(item.text.includes(newQuote)||newQuote===item.text)continue
    const clausesOfItem=scanUserClauses(item.text).map(clause=>clause.text.trim()).filter(carriesText)
    for(const clause of clausesOfItem){
      const score=scoreChars(newQuote,clause)+scoreChars(restOfMessage,clause)
      scored.push({item,clause,score})
    }
  }
  scored.sort((a,b)=>b.score-a.score)
  // A field-specific certainty correction can safely target one standalone
  // authorized outcome even when the old clause omitted its subject. Never
  // choose among similar events, or replace an entire composite report.
  const outcomeField=/是否(采用|使用|付款|付费|有效).{0,6}(?:我)?(?:不知道|不清楚|未知)/.exec(newQuote)?.[1]
  if(outcomeField){
    const candidates=scored.filter(s=>s.clause===s.item.text&&s.clause.includes(outcomeField)&&['context','feedback','unknown'].includes(s.item.kind))
    if(candidates.length===1){const chosen=candidates[0]!;return {newQuote,target:{itemId:chosen.item.id,expectedRevision:chosen.item.revision,beforeQuote:chosen.clause,kind:chosen.item.kind}}}
    if(candidates.length>1)return {newQuote,target:undefined}
  }
  const best=scored[0],runnerUp=scored[1]
  if(best&&best.score>=3&&(!runnerUp||runnerUp.score<best.score)&&best.item.text.split(best.clause).length===2){
    return {newQuote,target:{itemId:best.item.id,expectedRevision:best.item.revision,beforeQuote:best.clause,kind:best.item.kind}}
  }
  return {newQuote,target:undefined}
}
