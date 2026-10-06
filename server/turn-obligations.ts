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
  // silently reshaping future weeks.
  | {type:'remaining_time';quote:string;minutes:number}
  | {type:'direction_control';scopes:DirectionScope[];operation:'pause'|'resume'}
  | {type:'grounded_material';materialKind:'resume_portfolio'}
  | {type:'weekly_plan';period:'current'|'this_week'|'next_week';minutes:number}
export type TurnObligations = {
  kind:'ordinary'|'update_weekly_time'|'direction_control'|'resume_portfolio'|'mixed'
  requiredEffects:RequiredEffect[]
}
// N2.3: only an explicit request to arrange/re-arrange creates a plan
// obligation; stating a weekly budget alone only requires the fact.
export function weeklyPlanIntent(text:string):{period:'current'|'this_week'|'next_week'}|null{
  for(const sentence of groupBySentence(scanUserClauses(text))){
    for(const clause of sentence){
      const body=clause.text.trim()
      if(!body)continue
      if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.interrogative)continue
      if(/(?:安排|计划)(?:帮我)?(?:改|调整|修改|更新|排|重新)|帮我(?:安排|排)|改一下安排|调整.{0,4}安排|重新(?:安排|排)|再(?:安排|排)一?(?:次|下)?/.test(body)){
        const period=/下周/.test(body)||sentence.some(c=>/下周/.test(c.text))?'next_week':/(?:这周|本周)/.test(body)||sentence.some(c=>/(?:这周|本周)/.test(c.text))?'this_week':'current'
        return {period}
      }
    }
  }
  return null
}

const thirdPersonSubject=/^(?:室友|同学|朋友|他|她|他们|她们|别人|大家|我妈|我爸|父母|家人|老师|辅导员)/
const inexactBudget=/(?:大概|大约|左右|至少|最多|不超过|可能|到|至|－|~)/
// An opportunity's OWN demanded hours (实习每周15小时) are not the user's
// budget. Inside a sentence that mentions an opportunity, a bare 每周N小时
// clause only counts when it reads as the user's own availability.
const opportunityNoun=/(?:实习|岗位|兼职|机会|项目|offer|Offer|OFFER)/
const ownAvailability=/(?:我|自己|能|可|只有|只剩|还剩|拿出|投入|腾)/
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
      // PC13/C04: "有个实习，每周15小时" states the OPPORTUNITY's demand;
      // only a clause with the user's own availability marker counts there.
      if(mentionsOpportunity&&!ownAvailability.test(body))continue
      const minutes=parseExactHours(match[1]!)
      if(minutes===null)continue
      if(minutes<0||minutes>10080)continue
      return {quote:body,minutes,period}
    }
  }
  return null
}

// PC07: the REMAINING budget inside the current calendar week. Only an explicit
// "this week ... N hours left" statement by the user counts; the week marker may
// sit in an earlier clause of the same sentence (这周，只剩两小时). Next-week and
// marker-less statements stay out rather than being guessed into this week.
const remainingBudget=/(?:只)?还?剩(?:下|着)?[^，,。；;！？!?\n]{0,6}?((?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半)?\s*(?:小时|钟头))/
// 半小时=30, 一个半小时=90 resolve through parseExactHours on the whole token
// first; bare amounts (两小时) strip the unit. Ambiguous forms (两个半小时) refuse.
const remainingMinutes=(token:string):number|null=>{
  const direct=parseExactHours(token)
  if(direct!==null)return direct
  return parseExactHours(token.replace(/(?:小时|钟头)$/,''))
}
export function remainingWeeklyTimeIntent(text:string):{quote:string;minutes:number}|null{
  for(const sentence of groupBySentence(scanUserClauses(text))){
    let weekScoped=false
    for(const clause of sentence){
      const body=clause.text.trim()
      if(!body)continue
      if(/(?:这|本)周/.test(body))weekScoped=true
      if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther)continue
      if(clause.interrogative)continue
      if(thirdPersonSubject.test(body))continue
      if(/(?:不是|并没有|没说|并非|没|不剩|没剩|没有剩)/.test(body))continue
      if(inexactBudget.test(body))continue
      if(!weekScoped)continue
      const match=remainingBudget.exec(body)
      if(!match)continue
      const minutes=remainingMinutes(match[1]!)
      if(minutes===null||minutes<0||minutes>10080)continue
      return {quote:body,minutes}
    }
  }
  return null
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
  // A same-turn plan binds to the TIGHTEST stated budget: the remaining amount
  // when the user just said what is left this week, otherwise the weekly one.
  const bindingBudget=remaining??weekly
  if(plan&&bindingBudget)effects.push({type:'weekly_plan',period:plan.period,minutes:bindingBudget.minutes})
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
const ignorableConnectives=new Set(['谢谢','好的','好','请','嗯','哦','ok','OK','Okay','okay'])
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
  const bare=bareHours.exec(text)
  if(!bare)return null
  return parseExactHours(bare[1]!)
}

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

// P5.3 step 8: the rendered reply must not contradict a verified required
// effect — one place saying 3h while another still plans on 6h. Mentions of
// the old value framed as a change (从/降到/改为/变为/减少到) stay legal.
export function verifyReplyAgainstObligations(obligations:TurnObligations,reply:string):void{
  for(const effect of obligations.requiredEffects){
    if(effect.type==='weekly_time'){
      const hours=effect.minutes/60
      for(const match of reply.matchAll(/每(?:周|星期)[^，,。；;！？!\n]{0,8}?([0-9]+(?:\.[0-9]{1,2})?|\d{1,3})\s*(?:个)?(?:小时|钟头)/g)){
        const stated=parseExactHours(match[1]!)
        if(stated===null||stated===effect.minutes)continue
        const before=reply.slice(Math.max(0,match.index-8),match.index)
        // A change framing, or an amount attributed to the OPPORTUNITY itself
        // (该实习需要每周15小时), never contradicts the user's own budget.
        if(/(?:从|降到|改为|变为|变成|减到|减少到|换成|改到|低于|超过|多于|不到|最多|至少|实习|岗位|项目|机会|这份|它需要|需要每周|要求每周)/.test(before+match[0]))continue
        throw new ObligationError('REPLY_CONTRADICTS_CURRENT_EFFECT')
      }
    }
    if(effect.type==='remaining_time'){
      // A different REMAINING amount in the reply contradicts the just-stated
      // one; a weekly amount never does (每周6小时 with 这周剩2小时 is normal).
      for(const match of reply.matchAll(/(?:只)?还?剩(?:下|着)?[^，,。；;！？!\n]{0,6}?((?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半)?\s*(?:小时|钟头))/g)){
        const stated=remainingMinutes(match[1]!)
        if(stated===null||stated===effect.minutes)continue
        const before=reply.slice(Math.max(0,match.index-8),match.index)
        if(/(?:从|降到|改为|变为|变成|减到|减少到|换成|改到|低于|超过|多于|不到|最多|至少)/.test(before+match[0]))continue
        throw new ObligationError('REPLY_CONTRADICTS_CURRENT_EFFECT')
      }
    }
  }
}

const scopeLabels:Record<DirectionScope,string>={employment:'就业',postgraduate_recommendation:'推免',postgraduate_exam:'考研',public_service:'考公考编',entrepreneurship:'创业',overseas_study:'留学出境升学',undergraduate_upgrade:'专升本'}
export function controlReplyText(effects:RequiredEffect[]):string{
  const parts:string[]=[]
  for(const effect of effects)if(effect.type==='direction_control')
    parts.push((effect.operation==='pause'?'已暂停':'已恢复')+effect.scopes.map(scope=>scopeLabels[scope]).join('、')+(effect.operation==='pause'?'相关方向的新建议。':'建议。'))
  return parts.join('')||'已更新方向设置。'
}

export class ObligationError extends Error{readonly code:string;constructor(code:string){super(code);this.code=code}}
export const isObligationError=(error:unknown):error is ObligationError=>error instanceof ObligationError
