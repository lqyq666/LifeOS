import {chineseInteger} from './growth-time.ts'
import { scanUserClauses, parseExactHours, profileWritesDisallowed, responseRequestScope, firstPersonalActor, otherActorClause, openHumanOtherActor } from './user-command-spans.ts'
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
const arrangementClause=(body:string,preceding:string,following:string)=>arrangementRequest.test(body)
  // Only the observed bare starting-step command is exempt. Extra dates,
  // time slots or later content retain the existing plan path; only a trailing
  // explicit no-inference boundary is neutral for this narrow exemption.
  &&!(responseRequestScope(body).actionLimit===1&&/^(?:请|麻烦)?(?:先|只)?(?:帮我)?(?:安排|排)(?:一|1)(?:个|项)(?:能|可以|可)?(?:真正|立即|马上)?(?:开始|起步)?的?(?:小|具体)?(?:步骤|行动|动作|验证)$/.test(body)
    &&!/(?:安排|计划|日程|日期|时段|明天|后天|上午|下午|晚上|中午|凌晨|傍晚|早上|(?:今|明|后)[早晚晨]|(?:周|星期|礼拜)[一二三四五六日天末初中]|(?:下|次)个?(?:周|星期|礼拜|月|年)|月[底初末]|[一二三四五六七八九十\d]+(?:点|号|日)|\d[:：]\d|\d[-/]\d)/.test(preceding)
    &&scanUserClauses(following).every(clause=>/^(?:请)?(?:不要|别)(?:从(?:这|那)?(?:些|段|次)?(?:经历|事实|结果|反馈))?(?:推断|猜测|编造|假设)(?:稳定)?(?:能力|性格|人格|职业适配)(?:(?:或|和|与|、)(?:稳定)?(?:能力|性格|人格|职业适配))*$/.test(clause.text)))
// N2.3: only an explicit request to arrange/re-arrange creates a plan
// obligation; stating a weekly budget alone only requires the fact.
export function weeklyPlanIntent(text:string):{period:'current'|'this_week'|'next_week'}|null{
  for(const sentence of groupBySentence(scanUserClauses(text))){
    for(const clause of sentence){
      const body=clause.text.trim()
      if(!body)continue
      if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||thirdPersonSubject.test(body))continue
      if(arrangementClause(body,text.slice(0,clause.start),text.slice(clause.end))){
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
      if(/(?:用|花了?|经过|历时|持续).{0,4}一周|一周.{0,8}(?:每天|每日)/.test(body))continue
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
const remainingBudget=/(剩余[\p{L}]{0,12}?时间(?:要)?(?:更正为|改成|改为)?|(?:只)?还?剩(?:下|着)?|(?:只|就)?有|(?:只|就)|可用|^(?:我|本人)?(?:本周|这周)(?:我|本人)?(?:只能|能|可)(?:给|用于|投入|留给)[^0-9零一二两三四五六七八九十百半，,。；;！？!?\n]{0,16}?)[^，,。；;！？!?\n]{0,4}?((?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半|个)?\s*(?:小时|钟头|分钟))(?![课班])/u
// 半小时=30, 一个半小时=90 resolve through parseExactHours on the whole token
// first; bare amounts (两小时) strip the unit. Ambiguous forms (两个半小时) refuse.
const remainingMinutes=(token:string):number|null=>{
  const minute=/^([0-9]+|[零一二两三四五六七八九十百]+)\s*分钟$/.exec(token)
  if(minute)return chineseInteger(minute[1]!)
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
  if(thirdPersonSubject.test(body)||opportunityDemand.test(body)||(!explicitNoTime&&/已经|已花|花了|(?<![能可])用了|用掉|用完|不是|并非|至少|到八|到十/.test(body))||clause.quoteSpans.length||clause.codeSpans.length)continue
  if(/更正|改为|其实/.test(original))correction=true
  if(mentionsOpportunity&&/每周|每星期/.test(body)&&(!ownAvailability.test(body)||opportunityDemand.test(body)))continue
  const qualification=/大概|大约|左右/.test(body)?'estimate':/最多|不超过|上限/.test(body)?'upper_bound':'exact'
  const exact=body.replace(/大概|大约|左右|最多|不超过|上限/g,'')
  // Only an explicit availability upper-bound/permission phrase licenses the
  // 一周 alias; duration reports such as 用一周/上一周/做了一周 do not.
  const weeklyAlias=/^(?:(?:我|本人)(?:平时|通常)?|(?:平时|通常)(?:我|本人)?)?一周(?=最多|不超过|上限|只有|可用|能拿出|能投入|可投入)/.test(body)
  const recurring=weeklyTimeIntent(weeklyAlias?exact.replace('一周','每周'):exact)
  const remainder=remainingWeeklyTimeIntent((period==='this_week'&&!/这周|本周/.test(exact)?'这周':'')+exact)
  let candidate:ApplicableBudget|undefined
  if(recurring)candidate={period:/每周|每星期/.test(exact)&&!/下周|这周|本周/.test(exact)?'current':recurring.period,amountMinutes:recurring.minutes,scope:'recurring',qualification,quote:original,reason:'本人常规周投入'}
  else if(remainder)candidate={period:'this_week',amountMinutes:remainder.minutes,scope:/剩/.test(exact)?'remaining':'available',qualification,quote:original,reason:'指定周本人可用或剩余时间'}
  else {
   // Omitted answers require a durable, explicit own-availability question.
   const scoped=period??(context&&/本人.*(?:可用|剩余)/.test(context.question)?context.period:undefined)
   // A direct next-session allowance is task-local current capacity. It is
   // neither a recurring weekly budget nor a calendar-week constraint.
   const nextSession=/^(?:我|本人)?下次(?:我|本人)?(?:有|可用|能用|只有|仅有|能拿出|可拿出|只剩|仅剩|还剩)?\s*((?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半|个)?\s*(?:小时|钟头|分钟))(?:可用)?(?:吧|呀|啊)?$/.exec(exact)
   const match=/^(?:我|本人)?(?:(?:这周|本周|下周))?(?:我|本人)?(?:有|可用|能用|只有|仅有|能拿出|可拿出|只剩|仅剩|还剩)?\s*([0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+)(?:个)?(小时|钟头|分钟)(?:可用)?(?:吧|呀|啊)?$/.exec(exact)
   const amount=match?(match[2]==='分钟'?chineseInteger(match[1]!):parseExactHours(match[1]!)):null
   const noTime=explicitNoTime||/^(?:我|本人)?(?:这周|本周|下周)?(?:我|本人)?(?:没空|没有空闲时间|没有可用时间|(?:能用|可用)(?:的)?时间(?:是|为)(?:零|0))$/.test(exact)
   const nextSessionMinutes=nextSession?remainingMinutes(nextSession[1]!):null
   if(nextSessionMinutes!==null)candidate={period:'current',amountMinutes:nextSessionMinutes,scope:/剩/.test(exact)?'remaining':'available',qualification,quote:original,reason:'下次处理当前事项的本人可用时间'}
   else if(scoped&&(noTime||amount!==null))candidate={period:scoped,amountMinutes:noTime?0:amount!,scope:/剩/.test(exact)?'remaining':'available',qualification,quote:original,reason:period?'指定周本人可用时间':'承接持久任务的本人可用时间追问'}
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
  // An opportunity's required hours are discussion evidence, never a command
  // to persist the student's own budget when the user explicitly forbids it.
  // Explicit direction controls and material delivery retain their contracts.
  if(profileWritesDisallowed(currentText))for(let i=effects.length-1;i>=0;i--)if(['weekly_time','remaining_time','weekly_plan'].includes(effects[i]!.type))effects.splice(i,1)
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
    // "这周不再安排任务" is the opposite of a plan request. Skip a negated
    // arrangement clause instead of treating the words 安排/任务 as a request.
    if(/(?:不|别|无需|不用|暂不|先不|不要|不想)(?:再|去|做|进行|安排|排|规划|加|增加)?\s{0,3}(?:安排|排|规划|任务|计划)/.test(body))continue
    if(arrangementClause(body,text.slice(0,clause.start),text.slice(clause.end))){
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
    // This helper compares the stated quantity, not its certainty. An upper
    // bound such as "这周最多能用90分钟" still carries the exact numeric limit
    // 90; qualification remains preserved separately on the budget record.
    return available?.amountMinutes??null
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
const otherActivityAttribution=/(?:实习|岗位|项目|机会|兼职|课题|标注|课程|硬课|学业|功课|这份|该|对方|它|他们|要求|需要|要占|占|吃掉|花|用掉|留给|排给|最多|至少|超过|多于|不到|低于|如果|若|假设|大概|可能|方式|方案|选项|做法|一种|另一种|第[一二三]种)/
const userBudgetVoice=/(?:你|您)/
const changeFraming=/(?:从|降到|改为|变为|变成|减到|减少到|换成|改到|降为|调整到)/
// The allocation signal lives in the text BEFORE the amount (排/留/备份…),
// never in the amount span itself.
const allocationFraming=/(?:排|留|给|用|花|占|备份|另一|第二|其中|之一|里|中|内|后|做完|发完|完成后)/
function quantifiedWeeklyTimeBlocks(reply:string){
  const clauses=scanUserClauses(reply)
  const blocks=/每(?:周|星期)(?:先|只|可以|建议|要)?(?:安排|挑出|抽出|腾出|留出|分配)\s*([\d一二两三四五六七八九十百]+)\s*个\s*(?:[、，,]\s*)?(?:各|每个)?\s*[“"「]?\s*((?:\d+(?:\.\d+)?|[一二两三四五六七八九十百]+|半)\s*(?:小时|分钟))/g
  return [...reply.matchAll(blocks)].flatMap(match=>{
    const clause=clauses.find(clause=>match.index>=clause.start&&match.index<clause.end)
    if(!clause)return []
    const asserted=!clause.conditional&&!clause.interrogative&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&!thirdPersonSubject.test(clause.text)
    const count=chineseInteger(match[1]!),minutes=remainingMinutes(match[2]!)
    return count===null||minutes===null?[]:[{start:match.index,end:match.index+match[0].length,minutes:count*minutes,asserted}]
  })
}
export function repairReplyBudget(obligations:TurnObligations,reply:string):string{
  const blocks=quantifiedWeeklyTimeBlocks(reply)
  let fixed=reply
  for(const effect of obligations.requiredEffects){
    if(effect.type!=='weekly_time')continue
    fixed=fixed.replace(/每(?:周|星期)([^，,。；;！？!\n]{0,8}?)((?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半|个)?\s*(?:小时|钟头))/g,(whole:string,_prefix:string,amount:string,offset:number)=>{
      if(blocks.some(block=>offset>=block.start&&offset<block.end))return whole
      const before=fixed.slice(Math.max(0,offset-14),offset)
      if(otherActivityAttribution.test(before)||otherActivityAttribution.test(whole))return whole
      if(changeFraming.test(before)||changeFraming.test(whole))return whole
      const stated=remainingMinutes(amount)
      if(stated===null||stated===effect.minutes)return whole
      const hours=effect.minutes%60===0?`${effect.minutes/60}小时`:`${Math.floor(effect.minutes/60)}小时${effect.minutes%60}分钟`
      return `每周${_prefix}${hours}`
    })
  }
  return fixed
}

export function verifyReplyAgainstObligations(obligations:TurnObligations,reply:string):void{
  const blocks=quantifiedWeeklyTimeBlocks(reply)
  for(const effect of obligations.requiredEffects){
    if(effect.type==='weekly_time'){
      // Multiplicity belongs to the allocation, not to a second statement of
      // the available budget. Reuse the same numeric/time parser and source
      // boundaries; reject an over-allocation rather than silently shortening it.
      if(blocks.some(block=>block.asserted&&block.minutes>effect.minutes))throw new ObligationError('REPLY_CONTRADICTS_CURRENT_EFFECT')
      for(const match of reply.matchAll(/每(?:周|星期)[^，,。；;！？!\n]{0,8}?((?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半|个)?\s*(?:小时|钟头))/g)){
        if(blocks.some(block=>match.index>=block.start&&match.index<block.end))continue
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

const scopeLabels:Record<DirectionScope,string>={research_exploration:"科研探索",employment:'就业',postgraduate_recommendation:'推免',postgraduate_exam:'考研',public_service:'考公考编',entrepreneurship:'创业',overseas_study:'留学出境升学',undergraduate_upgrade:'专升本',freelance:'自由职业'}
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
// A bare "把我的…改成…" is transactional only for a bounded personal-fact
// field. Deliverable edits (简历、报告、访谈问题…) are ordinary material
// requests and must keep streaming instead of waiting for a profile write.
const personalCorrectionArtifactSuffix='(?:小组|社团|协会|组织|名字|名称|方向|课程|分析|报告|评估|建议|方案|总结|文档|表格|材料|说明|计划|清单|列表|名单|调查|计算(?!机)|问卷|画像|测试|测评|统计)'
const personalCorrectionFieldSource='(?:专业(?!经历)|学校|院校|年级|年龄|生日|出生日期|学历|学位|姓名|称呼|城市|地区|所在地|职业目标|长期目标|短期目标|发展方向|就业方向|考研方向|研究方向|偏好|兴趣|(?:本|这|下)周(?:的)?(?:剩余|可用|投入)?时间|每周(?:的)?(?:可用|投入)?时间)'
const personalCorrectionFieldBoundary=`(?=(?:(?:刚才|之前|先前|原来|一直|确实|又|也)\\s*){0,2}(?:${correctionMarker.source}|从|改回|改成|改为|不是|并非|应该|是)|[：:\\s，,。；;！？!?]|$)`
const personalCorrectionField=new RegExp(`${personalCorrectionFieldSource}(?!${personalCorrectionArtifactSuffix})${personalCorrectionFieldBoundary}`)
const beforeFirstCorrection=`(?:(?!${correctionMarker.source})[^，。；！？])*?`
const derivedPersonalFactArtifactCorrection=new RegExp(`${personalCorrectionFieldSource}${beforeFirstCorrection}${personalCorrectionArtifactSuffix}${beforeFirstCorrection}${correctionMarker.source}`)
const correctionOwnerMeta='(?:刚才|之前|先前|原来|目前|当前|现在|记录中|记录里|资料中|资料里|档案中|档案里|记忆中|记忆里)'
const personalCorrectionFieldQualifier='(?:本科|研究生|硕士|博士|专科|高中|户籍|常住|毕业|就读|饮食|职业|学习)'
const directPersonalCorrectionOwner=new RegExp(`^(?:(?:${correctionOwnerMeta})(?:的)?)*(?:(?:我|本人)(?:自己(?:的)?)?(?:的)?(?:(?:${personalCorrectionFieldQualifier})(?:的)?)?)?(?:(?:${correctionOwnerMeta})(?:的)?)*$`)
const locatedPersonalCorrectionOwner=new RegExp(`^(?:(?:${correctionOwnerMeta})(?:的)?)*(?:我|本人)(?:所在|就读(?:的)?)(?:(?:${correctionOwnerMeta})(?:的)?)*$`)
const describedPersonalCorrectionOwner=new RegExp(`^(?:(?:${correctionOwnerMeta})(?:的)?)*(?:我|本人)(?:的)?(?:(?:刚才|之前|先前|原来|当时|曾经)\\s*)?(?:填写|填报|登记|记录|提供|写下|报告|告诉你)(?:过|了)?的$`)
const observedPersonalCorrectionPrefix=/^(?:我|本人)(?:(?:刚才|现在|今天|最近|原来)\s*)?(?:才)?(?:发现|注意到|意识到|察觉到)(?:了)?(?=(?:我|本人|自己)(?:自己(?:的)?)?(?:的)?)/
const ownedCorrectionView=(body:string)=>body.replace(observedPersonalCorrectionPrefix,'').replace(/^自己/,'我自己')
// Compound qualifiers are accepted only when their free prefix is a bounded
// study domain. An old row containing “我的小明英语学习偏好” is evidence about
// that exact third party, not authority to rewrite it as the user's profile.
const ownedPersonalFieldTopicQualifier=/^(?:英语|日语|韩语|法语|德语|西班牙语|俄语|中文|语文|数学|高等数学|高数|线性代数|线代|编程|代码|写作|阅读|口语|听力|算法|数据分析|机器学习|人工智能|计算机|专业课|公共课|考研|考公|四级|六级|CET[-_ ]?[46])$/i
const authorizedMajorName=(value:string,authorizedMajorValues:readonly string[])=>legacyMajorNames.has(value)||authorizedMajorValues.includes(value)
const openQualifierHasHumanPossessor=(value:string)=>{
 const characters=[...value]
 return characters.some((_,index)=>openHumanOtherActor(characters.slice(0,index+1).join('')))
}
function namedMajorCorrectionOwner(owner:string,field:string,authorizedMajorValues:readonly string[]=[]):string|null{
 if(field!=='专业')return null
 const withoutMeta=owner.replace(new RegExp(`^(?:(?:${correctionOwnerMeta})(?:的)?)*`),'')
 const match=/^(?:我|本人)(?:自己(?:的)?)?(?:的)?([^，。；！？]{2,64})$/u.exec(withoutMeta)
 const value=match?.[1]?.trim()
 return value&&authorizedMajorName(value,authorizedMajorValues)?value:null
}
function authorizedPersonalFieldOwner(owner:string,field:string,authorized:readonly CorrectionCandidate[]):boolean{
 const normalizedOwner=owner.replace(new RegExp(`^(?:(?:${correctionOwnerMeta})(?:的)?)*`),'').replace(/\s+/g,'')
 if(!/^(?:我|本人)/.test(normalizedOwner))return false
 const subject=(normalizedOwner+field).replace(/\s+/g,'')
 const authorizedSubject=authorized.some(item=>['user_reported','user_edit'].includes(item.assertion)&&item.text.replace(/\s+/g,'').includes(subject))
 const openQualifier=new RegExp(`^(?:我|本人)(?:自己(?:的)?)?(?:的)?([^，。；！？]{1,24})$`).exec(normalizedOwner)?.[1]
  const compoundQualifier=new RegExp(`^(?:我|本人)(?:自己(?:的)?)?(?:的)?([^，。；！？]{1,24}?)(?:${personalCorrectionFieldQualifier})$`).exec(normalizedOwner)
  const boundedCompoundQualifier=Boolean(compoundQualifier)
  if(compoundQualifier&&!ownedPersonalFieldTopicQualifier.test(compoundQualifier[1]!))return false
  if(compoundQualifier&&otherActorClause(compoundQualifier[1]+'完成了',{allowOmittedSubject:true}))return false
 // Open profile qualifiers are accepted only when an existing user-authored
 // row contains this exact first-person field and the qualifier is not a
 // grammatical human actor. Bounded compound qualifiers are checked first,
 // so 室友饮食/小明英语学习 cannot hide a third-party possessor.
 if(!compoundQualifier&&openQualifier&&authorizedSubject&&!openQualifierHasHumanPossessor(openQualifier)&&!otherActorClause(normalizedOwner,{allowOmittedSubject:true}))return true
  if(otherActorClause(normalizedOwner,{allowOmittedSubject:true}))return false
  if(!directPersonalCorrectionOwner.test(owner)&&!locatedPersonalCorrectionOwner.test(owner)&&!describedPersonalCorrectionOwner.test(owner)&&!boundedCompoundQualifier)return false
 return authorizedSubject
}
function thirdPartyPersonalFieldCorrection(body:string,authorizedMajorValues:readonly string[]=[],authorized:readonly CorrectionCandidate[]=[]):boolean{
 if(!correctionMarker.test(body))return false
 const normalized=ownedCorrectionView(body.trim().replace(/^更正(?:一下)?[：:]?/,''))
 // In a named denial, a trailing “专业” belongs to the old value, not a new owner.
 if(namedMajorDenial.test(normalized.replace(/[：:](?=不是)/u,'')))return false
 const marker=correctionMarker.exec(normalized)
 const fields=[...normalized.matchAll(new RegExp(personalCorrectionField.source,'g'))]
 const field=marker?fields.sort((left,right)=>{
  const distance=(match:RegExpMatchArray)=>match.index!+match[0].length<=marker.index
    ?marker.index-(match.index!+match[0].length)
    :Math.max(0,match.index!-(marker.index+marker[0].length))
  return distance(left)-distance(right)||right.index!-left.index!
 })[0]:fields.at(-1)
 if(!field)return false
 let owner=normalized.slice(0,field.index)
 if(marker&&marker.index<field.index)owner=owner.slice(0,marker.index)+owner.slice(marker.index+marker[0].length)
 owner=owner.replace(/(?:把|将)\s*$/,'').trim()
 if(namedMajorCorrectionOwner(owner,field[0]!,authorizedMajorValues))return false
 if(authorizedPersonalFieldOwner(owner,field[0]!,authorized))return false
 // A direct/bare personal field is owned. Any extra possessor between the
 // speaker and that field is a third party without relying on a finite role
 // dictionary (男朋友、姐姐 and future relationship terms stay protected).
 return owner.length>0&&!directPersonalCorrectionOwner.test(owner)&&!locatedPersonalCorrectionOwner.test(owner)&&!describedPersonalCorrectionOwner.test(owner)
}
const ownedNamedMajorCorrection=(body:string,authorizedMajorValues:readonly string[]=[]):string|null=>{
 body=ownedCorrectionView(body)
 const match=/^(?:我|本人)(?:自己(?:的)?)?(?:的)?([^，。；！？]{2,64}?)专业(?:(?:刚才|之前|先前|原来|一直|确实|又|也)\s*){0,2}(?:更正|说错了?|搞错了?|记错了?|写错了?|看错了?)/u.exec(body)
 const value=match?.[1]?.trim()
 return value&&authorizedMajorName(value,authorizedMajorValues)?value:null
}
const ownedCorrectionRewrite=new RegExp('^(?:(?:请|麻烦)(?:帮我)?|帮我)?\\s*(?:(?:我|本人)(?:(?:现在|目前)\\s*)?(?:把|将)(?:我|本人)?|(?:把|将)(?:我|本人))(?:(?:的|之前|先前|原来|目前|现在|记录中|资料中)\\s*)*(?:(?:'+personalCorrectionFieldQualifier+')(?:的)?)?'+personalCorrectionField.source+'(?:从[^，。；！？]{1,24})?(?:改回|改成|改为)')
const directOwnedCorrectionRewrite=new RegExp(`^(?:我|本人)(?:自己(?:的)?)?(?:的)?(?:(?:${personalCorrectionFieldQualifier})(?:的)?)?${personalCorrectionField.source}(?:从[^，。；！？]{1,64})?(?:改回|改成|改为)`)
const ownedCorrectionRewriteMatches=(body:string)=>ownedCorrectionRewrite.test(body)||directOwnedCorrectionRewrite.test(body)
const completedCorrectionStatus=/^(?:可是|但是|不过|然而|却)?(?:页面|系统|记录|资料|为什么|怎么|如何|为何)/
const completedCorrectionContinuation=/^(?![^，。；！？]{0,24}(?:请|帮我|计划|准备|打算|希望|想要|将要|需要|应该))(?:(?:又|再|随后|然后|接着)\s*)?[^，。；！？]{1,48}?(?:了|过|完(?:了)?|好(?:了)?)[^，。；！？]{0,32}$/
const completedCorrectionUnchangedContinuation=/^(?:(?:一直|后来|此后|之后|从此|到现在|目前)\s*)?(?:(?:也|都)\s*)?(?:没(?:有)?|未曾|不曾)(?:再|继续)?(?:调整|修改|更正|改动|变更)(?:过)?$/
const completedOwnedCorrectionRewrite=(body:string,followingBody?:string)=>{
 const ownedBody=body.replace(/^(?:(?:请|麻烦)(?:帮我)?|帮我)\s*/,'')
 if(!/^(?:(?:我|本人)|(?:把|将)(?:我|本人))/.test(ownedBody)||!ownedCorrectionRewriteMatches(body))return false
 const verb=/(?:改回|改成|改为)/.exec(body)
 if(!verb)return false
 const tail=body.slice(verb.index+verb[0].length),status='(?:可是|但是|不过|然而|却|可(?=页面|系统|记录|资料)|页面|系统|记录|资料|为什么|怎么|如何|为何)'
  if(new RegExp(`^(?:了[^，。；！？]{1,64}?|[^，。；！？]{1,64}?(?:了|过))(?=$|${status})`).test(tail))return true
  if(/(?:后|之后)(?:页面|系统|记录|资料|为什么|怎么|如何|为何)/.test(tail))return true
  const inlineContinuation=/(?:后|之后)([^，。；！？]{1,64})$/.exec(tail)?.[1]
  if(inlineContinuation&&(completedCorrectionContinuation.test(inlineContinuation)||completedCorrectionUnchangedContinuation.test(inlineContinuation)))return true
  const following=followingBody?.trim()??''
  return /^[^，。；！？]{1,64}?(?:后|之后)$/.test(tail)&&(completedCorrectionStatus.test(following)||completedCorrectionContinuation.test(following)||completedCorrectionUnchangedContinuation.test(following))
}
const unsupportedPersonalFieldCompoundCorrection=(body:string)=>correctionMarker.test(body)&&[...body.matchAll(new RegExp(personalCorrectionFieldSource,'g'))].some(match=>!new RegExp(`^${personalCorrectionField.source}`).test(body.slice(match.index!)))
const deliverableCorrectionSubject=/(?:简历|专业经历|项目经历|工作经历|教育经历|实习经历|报告|消息|邮件|文案|访谈问题|提纲|材料|作业|代码|海报|幻灯片|PPT|表格|文章|方案)/i
const personalExperienceFactCorrection=(body:string)=>/^(?:更正(?:一下)?[：:]?(?:我|本人)(?:的)?(?:项目|工作|实习|教育)?经历(?:不是|并非)|(?:我|本人)(?:的)?(?:项目|工作|实习|教育)?经历(?:说错了?|搞错了?|记错了?|写错了?|看错了?))/.test(body)
const ownedPersonalFieldCorrection=(body:string,authorizedMajorValues:readonly string[]=[])=>new RegExp(`^(?:我|本人)(?:的)?${personalCorrectionField.source}(?:(?:刚才|之前|先前|原来|一直|确实|又|也)\\s*){0,2}${correctionMarker.source}`).test(ownedCorrectionView(body))||ownedNamedMajorCorrection(body,authorizedMajorValues)!==null
const ownedCorrectionMarker=/^(?:(?:我|本人)(?:(?:刚才|之前|先前|原来)\s*)?|(?:刚才|之前|先前)(?:我|本人)?)(?:说错了?|搞错了?|记错了?|写错了?|看错了?)/
const ownedFactCorrectionMarker=/^(?:(?:记录|资料|档案|记忆)(?:中|里)(?:的)?\s*)?(?:我|本人)(?:(?:之前|先前|原来)\s*)?的[^，。；！？]{1,20}(?:说错了?|搞错了?|记错了?|写错了?|看错了?)/
const correctionSiblingConnector=/(?:同时|另外|顺便|并且?)(?:也|还|再)?/g
const correctionContextFiller=/^(?:(?:顺便|另外|此外|还有|再|还|也)?(?:补充|说明|说|提)(?:一下|一句|一点)?|还有一点)$/
const framedCorrectionTopicOwner=(text:string):boolean|null=>{
 const match=/^(?:关于|针对|围绕)([^，。；！？]+)$/.exec(text.trim())
 if(!match)return null
 const topic=match[1]!.trim()
 const directSelf=/^(?:我(?:本人)?|本人)(?:自己)?$/.test(topic)
 // A possessive frame is self-owned only when it ends in a bounded profile
 // field. Unknown nouns after “我的” are people/things, not implicit aliases
 // for the user (for example, “我的前任”).
 const boundedOwnedField=new RegExp(`^(?:我|本人)(?:自己(?:的)?|的)?(?:(?:${personalCorrectionFieldQualifier})(?:的)?)?${personalCorrectionFieldSource}$`).test(topic)
 return (directSelf||boundedOwnedField)&&!otherActorClause(topic+'完成了',{allowOmittedSubject:true})
}
const explicitSelfCorrectionTopic=new RegExp(`^(?:我|本人)(?:自己(?:的)?|的)(?:(?:${personalCorrectionFieldQualifier})(?:的)?)?${personalCorrectionFieldSource}`)
const correctionTopicOwner=(text:string):boolean|null=>{
 const framed=framedCorrectionTopicOwner(text)
 if(framed!==null)return framed
 const body=text.trim()
 if(otherActorClause(body,{allowOmittedSubject:true}))return false
 if(explicitSelfCorrectionTopic.test(body)||Boolean(firstPersonalActor(body)))return true
 const field=new RegExp(personalCorrectionFieldSource).exec(body)
 return field&&field.index>0?false:null
}
function independentOwnedCorrectionSegment(body:string,authorizedMajorValues:readonly string[]=[],authorized:readonly CorrectionCandidate[]=[]):string|null{
 const connectors=[...body.matchAll(correctionSiblingConnector)]
 for(const [position,connector] of connectors.entries()){
  const start=connector.index!+connector[0].length,end=connectors[position+1]?.index??body.length
  const segment=body.slice(start,end).trim()
  if(!segment||thirdPartyPersonalFieldCorrection(segment,authorizedMajorValues,authorized))continue
  if(ownedPersonalFieldCorrection(segment,authorizedMajorValues)||ownedCorrectionRewriteMatches(segment)||personalExperienceFactCorrection(segment))return segment
 }
 return null
}
function explicitCorrectionMarkerIndex(clauses:ReturnType<typeof scanUserClauses>,authorizedMajorValues:readonly string[]=[],authorized:readonly CorrectionCandidate[]=[]):number{
 for(const [index,clause] of clauses.entries()){
  const body=clause.text.trim()
  if(!body)continue
  // Conditional, quoted and completed-correction mentions are not commands.
  if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.interrogative)continue
  if(/(?:如果|(?<![主重只必还需总概])要是|假如|假设|万一|一旦)/.test(body))continue
  if(/(?:已(?:经)?更正(?:过|的|后)|更正(?:后|过|记录|结果|历史))/.test(body))continue
   const barePersonalFieldCorrection=new RegExp(`^${personalCorrectionField.source}(?:(?:刚才|之前|先前|原来|一直|确实|又|也)\\s*){0,2}${correctionMarker.source}`).test(body)
   const preceding=clauses.slice(0,index).reverse().find(candidate=>candidate.text.trim()&&!candidate.quoted&&!candidate.code&&!candidate.conditional&&!candidate.interrogative&&!correctionContextFiller.test(candidate.text.trim()))
   // A bare field can continue an explicitly self-owned sentence, but never
   // silently switches a prior third-party subject into the user's profile.
   // Filler clauses do not reset an explicit “关于/针对/围绕” owner. The
   // latest frame stays authoritative until another frame replaces it.
   const framedOwner=clauses.slice(0,index).reverse().map(candidate=>framedCorrectionTopicOwner(candidate.text)).find(owner=>owner!==null)??null
   const nearestOwner=preceding?correctionTopicOwner(preceding.text):null
   if(barePersonalFieldCorrection&&(nearestOwner??framedOwner)===false)continue
   const following=clauses[index+1]
   const followingBody=following?.sentenceStart===clause.sentenceStart?following.text:undefined
   if(completedOwnedCorrectionRewrite(body,followingBody))continue
   if(unsupportedPersonalFieldCompoundCorrection(body))continue
  if(derivedPersonalFactArtifactCorrection.test(body))continue
  const thirdParty=thirdPartyPersonalFieldCorrection(body,authorizedMajorValues,authorized)
  const ownedSibling=thirdParty?independentOwnedCorrectionSegment(body,authorizedMajorValues,authorized):null
  if(thirdParty&&!ownedSibling)continue
  const correctionBody=ownedSibling??body
  if(/^不对[，,。！？]?$/.test(body)){
   const continuation=clauses.slice(index+1).find(candidate=>candidate.sentenceStart===clause.sentenceStart&&candidate.text.trim())
   if(continuation&&thirdPartyPersonalFieldCorrection(continuation.text.trim(),authorizedMajorValues,authorized))continue
  }
  const personalExperienceCorrection=personalExperienceFactCorrection(correctionBody)
  const markedCorrection=correctionMarker.test(correctionBody)&&(!deliverableCorrectionSubject.test(correctionBody)||personalExperienceCorrection||ownedPersonalFieldCorrection(correctionBody,authorizedMajorValues))&&(/^更正/.test(correctionBody)||personalCorrectionField.test(correctionBody)||ownedCorrectionMarker.test(correctionBody)||ownedFactCorrectionMarker.test(correctionBody))
  if(markedCorrection||ownedCorrectionRewriteMatches(correctionBody)||/^不对[，,。！？]?$/.test(correctionBody))return index
 }
 return -1
}
export function explicitCorrectionIntent(text:string,authorized:readonly CorrectionCandidate[]=[]):boolean{
 const authorizedMajorValues=authorized.flatMap(item=>{const field=authorizedMajorField(item);return field?[field.value]:[]})
 return !profileWritesDisallowed(text)&&explicitCorrectionMarkerIndex(scanUserClauses(text),authorizedMajorValues,authorized)>=0
}
export type CorrectionPlan={
  // The user's own affirmative new-value words, verbatim in the message.
  newQuote:string
  field?:'education.major'
  // Offsets in newQuote for a current fact with a superseded value between its two exact sources.
  majorSourceParts?:{labelStart:number;labelEnd:number;currentStart:number}
  markerQuote?:string
  relatedTargets?:NonNullable<CorrectionPlan['target']>[]
  // Best-effort deterministic amend target, derived ONLY from character
  // overlap between the correction message and the authorized old items.
  target:undefined|{
    itemId:string
    expectedRevision:number
    // The single old clause to swap out; must appear verbatim exactly once.
    beforeQuote:string
    field?:'education.major'
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
export type CorrectionCandidate={id:string;revision:number;kind:NonNullable<CorrectionPlan['target']>['kind'];assertion:string;text:string;sourceIds?:string[]}
// Conservative field identity for a quantified-time correction. Mask only the
// amount and budget grammar; keep activity words, calendar labels
// and the rest of the source intact. Different wording may safely create a new
// sourced fact, but matching quantities never grants cross-field mutation.
const timeQuantity=/[0-9零一二两三四五六七八九十百半.]+(?:个半|个)?\s*(?:小时|钟头|分钟)/g
const timeFieldTemplate=(text:string)=>(text.replace(/((?:本|这|下)周)的时间[：:]?/g,'$1').replace(/现在|只能给|用于|留给/g,'').replace(timeQuantity,'#').replace(/(?:我|本人)/g,'').replace(/本周/g,'这周').replace(/(?:剩余(?:可投入|可用)?时间(?:要)?(?:更正为|改成|改为)?|剩余|(?:只)?还?剩(?:下|着)?|更正为|改成|改为|可用|时间|时长|只有|最多|不超过|上限)/g,'').replace(/(?:是|为)(?=#)/g,'').replace(/[\s，,：:]/g,'').replace(/#/g,''))+'#'
// Legacy compound profiles lack a named field. Only these unambiguous major
// names can fill that slot; an explicit stored major predicate needs no list.
// Education states such as 休学/退学 never gain field authority by their suffix.
const legacyMajorNames=new Set(['统计学','应用统计学','数学','应用数学','物理学','化学','生物学','经济学','金融学','法学','心理学','社会学','教育学','医学','临床医学','计算机科学与技术','软件工程','信息管理','信息管理与信息系统','数据科学','数据科学与大数据技术','公共管理','工商管理','行政管理','汉语言文学','英语','机械工程','土木工程'])
const namedMajorDenial=/^(?:更正(?:一下)?[：:]?)?(?:我|本人)(?:的)?专业不是([\p{L}]{2,24}?)(?:专业)?$/u
const namedMajorAffirmation=/^(?:而|其实|实际(?:上)?)?是([\p{L}]{2,24}?)(?:专业)?$/u
const namedMajorRewrite=/专业(?<previous>从(?<before>[^，。；！？]{1,64}?)(?:专业)?)?(?:改回|改成|改为)(?<after>[^，。；！？]{1,64}?)(?:专业)?$/d
const ambiguousMajorValue=/并|且|但|而|另外|同时|顺便|删除|忘记|移除|修改|更正|保留|年龄|年级|不再|不是|然后|我的|你的|他的|她的/
function majorSourceParts(quote:string,labelEnd:number,currentStart:number):CorrectionPlan['majorSourceParts']{
 const label=/(?:我|本人)(?:的)?专业$/.exec(quote.slice(0,labelEnd))
 if(label&&labelEnd<currentStart&&currentStart<quote.length)return {labelStart:label.index,labelEnd,currentStart}
}
export function authorizedMajorField(item:CorrectionCandidate,expectedValue?:string):{value:string;beforeQuote:string}|null{
 if(item.kind!=='context'||!['user_reported','user_edit'].includes(item.assertion))return null
 const direct=/^(?:另外|还有|同时|并且)?(?:我|本人)(?:的专业(?:实际(?:上)?|确实)?是|学的是|读的是|学习(?:的是)?)([^，。；！？]{1,64})$/.exec(item.text)
 if(direct){const value=direct[1]!.replace(/专业$/,'').trim();return value&&!/更正|修改|改成|改为/.test(value)?{value,beforeQuote:item.text}:null}
 const ownedRewrite=/^(?:我|本人)(?:的)?(?=专业(?:从|改))/.exec(item.text)
 const amended=ownedRewrite?namedMajorRewrite.exec(item.text.slice(ownedRewrite[0].length))?.groups?.after?.trim():undefined
 if(amended&&!ambiguousMajorValue.test(amended))return {value:amended,beforeQuote:item.text}
 if(/^(?:更正(?:一下)?[：:]?)?(?:我|本人)(?:的)?专业不是/.test(item.text)){
  const [denial,affirmation,...rest]=scanUserClauses(item.text)
  const value=affirmation&&namedMajorAffirmation.exec(affirmation.text)?.[1]
  if(!rest.length&&denial&&affirmation&&denial.sentenceStart===affirmation.sentenceStart&&namedMajorDenial.test(denial.text)&&value&&!ambiguousMajorValue.test(value))return {value,beforeQuote:item.text}
 }
 const legacy=/^(?:我|本人)是((?:[0-9零一二三四五六七八九十]{1,3}岁的)?)([^，。；！？]{1,64}?)专业((?:大[一二三四五六]学生|本科生|研究生|学生)?)$/.exec(item.text)
 if(legacy){
  const [,age,rawValue,level]=legacy
  const value=rawValue!.trim()
  return value&&!/更正|修改|改成|改为/.test(value)?{value,beforeQuote:age||level?value+'专业':item.text}:null
 }
 if(!expectedValue||item.text.split(expectedValue).length!==2||!firstPersonalActor(item.text)||otherActorClause(item.text))return null
 const at=item.text.indexOf(expectedValue),prefix=item.text.slice(0,at)
 if(!/(?:专业(?:是|为)?|就读(?:于)?|主修|学习(?:的是)?|学(?:的)?是|读(?:的)?是)\s*$/.test(prefix))return null
 return {value:expectedValue,beforeQuote:item.text}
}
export function planExplicitCorrection(text:string,authorized:readonly CorrectionCandidate[]):CorrectionPlan|null{
  // A read-only turn cannot carry a required profile write. This also prevents
  // its mention of an earlier correction from becoming an outstanding command.
  if(profileWritesDisallowed(text))return null
  const clauses=scanUserClauses(text)
  const authorizedMajorValues=authorized.flatMap(item=>{const field=authorizedMajorField(item);return field?[field.value]:[]})
  for(const clause of clauses){
    if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.interrogative||clause.quoteSpans.length)continue
    if(!/^(?:这周|本周|下周)[^。！？,，;；]{0,16}(?:改成|改为)/.test(clause.text))continue
    const budget=applicableTimeBudget(clause.text,undefined,undefined,{retainReportedBudget:true})
    if(!budget||budget.scope!=='remaining')continue
    const matching=authorized.filter(item=>['user_reported','user_edit'].includes(item.assertion)&&['context','constraint'].includes(item.kind)).filter(item=>{
      const prior=applicableTimeBudget(item.text,undefined,undefined,{retainReportedBudget:true})
      return prior?.scope==='remaining'&&prior.period===budget.period&&timeFieldTemplate(item.text)===timeFieldTemplate(clause.text)
    })
    const item=matching.length===1?matching[0]:undefined
    return {newQuote:clause.text,target:item?{itemId:item.id,expectedRevision:item.revision,beforeQuote:item.text,kind:item.kind}:undefined}
  }
  const markerIndex=explicitCorrectionMarkerIndex(clauses,authorizedMajorValues,authorized)
  if(markerIndex<0)return null
  // An explicitly named major can be one field inside a larger identity
  // clause. Bind the denied value and adjacent affirmative replacement;
  // unchanged facts later in the message never select this correction target.
  const firstMarker=clauses[markerIndex]!,nextMarker=clauses[markerIndex+1]
  const detachedMajor=/^更正(?:一下)?$/.test(firstMarker.text)&&nextMarker&&nextMarker.sentenceStart===firstMarker.sentenceStart&&!nextMarker.conditional&&!nextMarker.quoted&&!nextMarker.code&&!nextMarker.attributedToOther&&!nextMarker.interrogative&&!nextMarker.quoteSpans.length&&!nextMarker.codeSpans.length&&namedMajorDenial.test(nextMarker.text)
  const marker=detachedMajor?nextMarker!:firstMarker,follow=clauses[markerIndex+(detachedMajor?2:1)]
  const rawMarkerBody=marker.text.trim(),markerThirdParty=thirdPartyPersonalFieldCorrection(rawMarkerBody,authorizedMajorValues,authorized)
  const embeddedOwnedCorrection=markerThirdParty?independentOwnedCorrectionSegment(rawMarkerBody,authorizedMajorValues,authorized):null
  const markerBody=embeddedOwnedCorrection??rawMarkerBody
  if(markerThirdParty&&!embeddedOwnedCorrection||/^更正(?:一下)?[：:]?(?:我(?:的)?|本人(?:的)?)?(?:室友|同学|朋友|老师|他|她|别人)(?:的)?(?:背景|专业)/.test(markerBody))return null
  const deniedMajor=/^更正(?:一下)?[：:]?(?:(?:我|本人)?(?:之前|先前|原来)?的?(?:背景|专业)[：:]?|(?:我|本人))不是([\p{L}]{2,24}?)(?:专业)?$/u.exec(markerBody)
  const ownFollow=follow&&follow.sentenceStart===marker.sentenceStart&&!follow.conditional&&!follow.quoted&&!follow.code&&!follow.attributedToOther&&!follow.interrogative&&!follow.quoteSpans.length&&!follow.codeSpans.length?follow:null
  const personalExperienceCorrection=/^更正(?:一下)?[：:]?(?:我|本人)(?:的)?(?:项目|工作|实习|教育|专业)?经历(?:不是|并非)/.test(markerBody)&&ownFollow&&/^而是[^，。；！？]{1,40}$/.test(ownFollow.text.trim())
  const impliedOwnedFieldCorrection=Boolean(personalExperienceCorrection||(ownedFactCorrectionMarker.test(markerBody)||personalCorrectionField.test(markerBody)&&correctionMarker.test(markerBody))&&ownFollow&&/^(?:(?:其实|实际|正确(?:的)?)?应该|其实|实际|正确(?:的)?)?是[^，。；！？]{1,40}$/.test(ownFollow.text.trim()))
  let correctionOnly=markerBody
  for(const connector of markerBody.matchAll(/(?:同时|另外|顺便|并且?)(?:也|还|再)?/g)){
    const tail=markerBody.slice(connector.index!+connector[0].length)
    if(/^(?:请|帮我|把|将)/.test(tail)||correctionMarker.test(tail)&&personalCorrectionField.test(tail)){
      correctionOnly=markerBody.slice(0,connector.index)
      break
    }
  }
  correctionOnly=correctionOnly.trim()
  const namedMarkerMajor=ownedNamedMajorCorrection(correctionOnly,authorizedMajorValues)
  const namedMajorFollow=namedMarkerMajor&&ownFollow&&/^(?:(?:其实|实际|正确(?:的)?)?应该|其实|实际|正确(?:的)?)?是[^，。；！？]{1,40}$/.test(ownFollow.text.trim())
  const ownedFieldMarker=ownedPersonalFieldCorrection(correctionOnly,authorizedMajorValues)
  const ownedFieldFollow=ownedFieldMarker&&ownFollow&&/^(?:(?:其实|实际|正确(?:的)?)?应该|其实|实际|正确(?:的)?)?是[^，。；！？]{1,40}$/.test(ownFollow.text.trim())
  const personalFieldQuote=ownedFieldMarker||ownedCorrectionRewriteMatches(correctionOnly)?namedMajorFollow||ownedFieldFollow?text.slice(marker.start,ownFollow!.end).trim():correctionOnly:null
  const affirmedMajor=ownFollow?/^(?:我|本人)(?:其实)?(?:学的|读的|的专业)是([\p{L}]{2,24}?)(?:专业)?$/u.exec(ownFollow.text.trim()):null
  const namedDenial=namedMajorDenial.exec(markerBody)
  const affirmedNamed=ownFollow&&namedDenial?(affirmedMajor??namedMajorAffirmation.exec(ownFollow.text.trim())):null
  if(namedDenial&&affirmedNamed&&ownFollow){
    const before=namedDenial[1]!,after=affirmedNamed[1]!
    if(before===after||ambiguousMajorValue.test(before+after))return null
    const matches=authorized.flatMap(item=>{const field=authorizedMajorField(item,before);return field?.value===before?[{item,field}]:[]})
    const chosen=matches.length===1?matches[0]:undefined
    const newQuote=affirmedMajor?ownFollow.text.trim():text.slice(marker.start,ownFollow.end).trim()
    const parts=affirmedMajor?undefined:majorSourceParts(newQuote,newQuote.indexOf('专业不是')+'专业'.length,newQuote.length-ownFollow.text.length+ownFollow.text.indexOf('是'))
    return {newQuote,field:'education.major',...(parts?{majorSourceParts:parts}:{}),markerQuote:markerBody,target:chosen?{itemId:chosen.item.id,expectedRevision:chosen.item.revision,beforeQuote:chosen.field.beforeQuote,kind:chosen.item.kind,field:'education.major'}:undefined}
  }
  if(deniedMajor&&(ownFollow||/背景|专业/.test(marker.text))){
    // Near matches must not fall back to whole-identity overlap replacement.
    if(!affirmedMajor)return ownFollow&&/^(?:我|本人)/.test(ownFollow.text.trim())?{newQuote:ownFollow.text.trim(),target:undefined}:null
    const before=deniedMajor[1]!,after=affirmedMajor[1]!
    if(before===after)return null
    if(!legacyMajorNames.has(after))return {newQuote:ownFollow!.text.trim(),target:undefined}
    if(ambiguousMajorValue.test(before+after))return {newQuote:ownFollow!.text.trim(),target:undefined}
    const explicitMajor=Boolean(affirmedMajor)
    const matches=authorized.filter(item=>item.kind==='context'&&['user_reported','user_edit'].includes(item.assertion)&&item.text.split(before).length===2).filter(item=>{
      const at=item.text.indexOf(before),prefix=item.text.slice(0,at),suffix=item.text.slice(at+before.length)
      const storedMajor=/(?:的专业是|学的是|读的是|学习(?:的是)?)$/.test(prefix)||suffix.startsWith('专业')
      const academicSlot=legacyMajorNames.has(before)
      return (storedMajor||explicitMajor&&academicSlot)&&/^(?:我|本人)(?:是(?:[0-9零一二两三四五六七八九十]{1,3}岁的)?|的专业是|学的是|读的是|学习(?:的是)?)$/.test(prefix)&&/^(?:专业)?(?:大[一二三四五六]学生|本科生|研究生|学生)?$/.test(suffix)
    })
    const target=matches.length===1?matches[0]:undefined
    // Keep the affirmative field sentence self-describing so a later
    // correction can address this field again without guessing a bare value.
    const standalone=target&&/^(?:我|本人)(?:的专业是|学的是|读的是|学习(?:的是)?)$/.test(target.text.slice(0,target.text.indexOf(before)))&&/^(?:专业)?$/.test(target.text.slice(target.text.indexOf(before)+before.length))
    const beforeSpan=target?.text.slice(target.text.indexOf(before)+before.length).startsWith('专业')?before+'专业':before
    return {newQuote:ownFollow!.text.trim(),field:'education.major',markerQuote:markerBody,target:target?{itemId:target.id,expectedRevision:target.revision,beforeQuote:standalone?target.text:beforeSpan,kind:target.kind,field:'education.major'}:undefined}
  }
  const namedMajorBefore=personalFieldQuote?ownedNamedMajorCorrection(personalFieldQuote,authorizedMajorValues):null
  const personalFieldView=personalFieldQuote?ownedCorrectionView(personalFieldQuote):null
  if(personalFieldQuote&&personalFieldView&&(/^(?:我|本人)(?:的)?专业(?!经历)/.test(personalFieldView)||namedMajorBefore!==null||ownedCorrectionRewriteMatches(personalFieldView)&&/专业(?!经历)/.test(personalFieldView))){
    const genericRewrite=namedMajorRewrite.exec(personalFieldView)
    if(genericRewrite){
      const before=genericRewrite.groups?.before?.trim(),after=genericRewrite.groups?.after?.trim()
      if(!after||/并|且|但|而|另外|同时|顺便|删除|忘记|移除|修改|更正|保留|年龄|年级|然后|我的|你的|他的|她的/.test((before??'')+after))return {newQuote:personalFieldQuote,field:'education.major',markerQuote:personalFieldQuote,target:undefined}
      const candidates=authorized.flatMap(item=>{const field=authorizedMajorField(item,before);return field&&(!before||field.value===before)?[{item,field}]:[]})
      const chosen=candidates.length===1?candidates[0]:undefined
      const oldSpan=genericRewrite.indices?.groups?.previous,offset=personalFieldQuote.length-personalFieldView.length
      const parts=oldSpan&&personalFieldQuote.endsWith(personalFieldView)?majorSourceParts(personalFieldQuote,offset+oldSpan[0],offset+oldSpan[1]):undefined
      return {newQuote:personalFieldQuote,field:'education.major',...(parts?{majorSourceParts:parts}:{}),markerQuote:personalFieldQuote,target:chosen?{itemId:chosen.item.id,expectedRevision:chosen.item.revision,beforeQuote:chosen.field.beforeQuote,kind:chosen.item.kind,field:'education.major'}:undefined}
    }
    const markerAt=personalFieldQuote.search(correctionMarker),replacement=markerAt>=0?personalFieldQuote.slice(markerAt):personalFieldQuote
    const statedReplacement=/(?:应该|正确(?:的)?)(?:是|为)([^，。；！？]{2,64}?)(?:专业)?$/.exec(replacement)?.[1]?.trim()
    const after=statedReplacement??[...legacyMajorNames].sort((a,b)=>b.length-a.length).find(name=>name!==namedMajorBefore&&replacement.includes(name))
    const statedBefore=/从([^，。；！？]{2,24}?)(?:专业)?(?:改回|改成|改为)/.exec(personalFieldView)?.[1]??namedMajorBefore??undefined
    if(!after)return {newQuote:personalFieldQuote,field:'education.major',markerQuote:personalFieldQuote,target:undefined}
    const candidates=authorized.flatMap(item=>{const field=authorizedMajorField(item,statedBefore);return field&&(!statedBefore||field.value===statedBefore)?[{item,before:field.value,beforeQuote:field.beforeQuote}]:[]})
    const chosen=candidates.length===1?candidates[0]:undefined
    return {newQuote:personalFieldQuote,field:'education.major',markerQuote:personalFieldQuote,target:chosen?{itemId:chosen.item.id,expectedRevision:chosen.item.revision,beforeQuote:chosen.beforeQuote,kind:chosen.item.kind,field:'education.major'}:undefined}
  }
  // A named third party or unsupported field-denial shape must not fall into
  // generic character-overlap matching against this user's profile.
  if(/背景|专业/.test(markerBody))return null
  // New value: the marker clause with the marker prefix stripped (更正一下：我是大二
  // → 我是大二), else the next affirmative first-person clause of the same
  // sentence (不对，我不是…，我是想… → 我是想…). Denials are not the new value.
  let newQuote=impliedOwnedFieldCorrection?text.slice(marker.start,ownFollow!.end).trim():personalFieldQuote??markerBody.replace(/^.{0,3}更正(?:一下)?[：:，,]?/,'').replace(/^(?:不对|不是的?)[，,。！？]?/,'').trim()
  if(!carriesText(newQuote)||!impliedOwnedFieldCorrection&&!/我/.test(newQuote)&&!applicableTimeBudget(newQuote,undefined,undefined,{retainReportedBudget:true})){
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
  const newBudget=applicableTimeBudget(newQuote,undefined,undefined,{retainReportedBudget:true})
  const alreadyStored=authorized.some(item=>(item.assertion==='user_reported'||item.assertion==='user_edit')&&item.text.includes(newQuote))
  if(alreadyStored&&!newBudget)return null
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
  const conflictingBudget=Boolean(newBudget&&authorized.some(item=>['user_reported','user_edit'].includes(item.assertion)&&scanUserClauses(item.text).some(clause=>{const prior=applicableTimeBudget(clause.text,undefined,undefined,{retainReportedBudget:true});return prior&&prior.period===newBudget.period&&timeFieldTemplate(clause.text)===timeFieldTemplate(newQuote)&&(prior.amountMinutes!==newBudget.amountMinutes||prior.scope!==newBudget.scope||prior.qualification!==newBudget.qualification)})))
  for(const item of conflictingBudget?[]:authorized){
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
  // Time corrections target the same typed budget, never an execution report
  // that happens to share characters such as 我/小时/一. A remainder is not a
  // correction to a recurring allowance; retain both and let the scoped budget
  // selector choose the applicable one.
  const correctedBudget=applicableTimeBudget(newQuote,undefined,undefined,{retainReportedBudget:true})
  if(correctedBudget){
    const matching=authorized.filter(item=>['user_reported','user_edit'].includes(item.assertion)&&['context','constraint'].includes(item.kind)).flatMap(item=>
      scanUserClauses(item.text).filter(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!clause.interrogative).flatMap(clause=>{
        const prior=applicableTimeBudget(clause.text,undefined,undefined,{retainReportedBudget:true})
        const sameScope=prior&&prior.period===correctedBudget.period&&(prior.scope===correctedBudget.scope||prior.scope!=='recurring'&&correctedBudget.scope!=='recurring')
        return sameScope&&(prior.amountMinutes!==correctedBudget.amountMinutes||prior.scope!==correctedBudget.scope||prior.qualification!==correctedBudget.qualification)&&timeFieldTemplate(clause.text)===timeFieldTemplate(newQuote)?[{item,quote:clause.text}]:[]
      })
    )
    const chosen=matching.length===1?matching[0]:undefined
    if(!matching.length&&alreadyStored)return null
    return {newQuote,target:chosen?{itemId:chosen.item.id,expectedRevision:chosen.item.revision,beforeQuote:chosen.quote,kind:chosen.item.kind}:undefined}
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
  const restOfMessage=(embeddedOwnedCorrection?[markerBody]:clauses.map(clause=>clause.text)).map(value=>value.replace(/^.{0,3}更正(?:一下)?[：:，,]?/,'').replace(/^(?:不对|不是的?)[，,。！？]?/,'')).join('').replace(newQuote,'')
  const scored:Scored[]=[]
  const readStatusCorrection=/看过|读过|已读/.test(newQuote)
  // Qualifying an inference does not retract its underlying event. Require
  // the denied proposition itself in an old clause before replacing it;
  // character overlap with the surrounding event is not correction authority.
  const deniedInference=/(?:不代表|不等于|不能说明|不能证明)(.+)$/.exec(newQuote)?.[1]
    ?.replace(/^(?:(?:我|本人|这)\s*)+/,'').trim()
  for(const item of authorized){
    if(item.assertion!=='user_reported'&&item.assertion!=='user_edit')continue
    if(item.text.includes(newQuote)||newQuote===item.text)continue
    if(readStatusCorrection&&!/看过|读过|已读/.test(item.text))continue
    const clausesOfItem=scanUserClauses(item.text).map(clause=>clause.text.trim()).filter(carriesText)
    for(const clause of clausesOfItem){
      // A single grammatical clause can still contain independent identity
      // fields. A narrower correction cannot replace age/grade along with it.
      if(/^(?:我|本人)是/.test(clause)&&((/[0-9零一二两三四五六七八九十]{1,3}岁/.test(clause)&&!/[0-9零一二两三四五六七八九十]{1,3}岁/.test(newQuote))||(/大[一二三四五六](?:学生)?/.test(clause)&&!/大[一二三四五六](?:学生)?/.test(newQuote))))continue
      if(deniedInference){
        // Only the same affirmative proposition is a safe retractable target.
        // Extra negation, uncertainty or event context keeps the old source
        // intact and stores this new qualifier instead of guessing polarity.
        const proposition=clause.replace(/^(?:(?:我|本人|这)\s*)+/,'').trim()
        if(proposition!==deniedInference)continue
      }
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
  if(best&&best.score>=3&&runnerUp?.score===best.score){
    const tied=scored.filter(candidate=>candidate.score===best.score)
    // Copies of the same original clause share message provenance. Equal
    // words from separate reports remain ambiguous and cannot authorize amends.
    const source=best.item.sourceIds?.find(id=>tied.every(candidate=>candidate.item.sourceIds?.includes(id)))
    if(source&&tied.every(candidate=>candidate.clause===best.clause&&candidate.item.text.split(candidate.clause).length===2)){
      const targets=tied.map(candidate=>({itemId:candidate.item.id,expectedRevision:candidate.item.revision,beforeQuote:candidate.clause,kind:candidate.item.kind}))
      return {newQuote,target:targets[0],relatedTargets:targets.slice(1)}
    }
  }
  if(best&&best.score>=3&&(!runnerUp||runnerUp.score<best.score)&&best.item.text.split(best.clause).length===2){
    return {newQuote,target:{itemId:best.item.id,expectedRevision:best.item.revision,beforeQuote:best.clause,kind:best.item.kind}}
  }
  return {newQuote,target:undefined}
}
