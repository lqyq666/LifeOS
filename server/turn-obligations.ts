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
// N2.3: only an explicit request to arrange/re-arrange creates a plan
// obligation; stating a weekly budget alone only requires the fact.
export function weeklyPlanIntent(text:string):{period:'current'|'this_week'|'next_week'}|null{
  for(const sentence of groupBySentence(scanUserClauses(text))){
    for(const clause of sentence){
      const body=clause.text.trim()
      if(!body)continue
      if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.interrogative)continue
      if(/(?:安排|计划)(?:帮我)?(?:改|调整|修改|更新|排|重新)|帮我(?:安排|排)|改一下安排|调整.{0,4}安排|重新(?:安排|排)|再(?:安排|排)一?(?:次|下)?|怎么(?:安排|排|规划)/.test(body)){
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
const remainingBudget=/((?:只)?还?剩(?:下|着)?|(?:只|就)?有|(?:只|就))[^，,。；;！？!?\n]{0,4}?((?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半|个)?\s*(?:小时|钟头))(?![课班])/
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
    for(const clause of sentence){
      const body=clause.text.trim()
      if(!body)continue
      // P2 (B03): a clause scoped to NEXT week (下周只剩两小时) never becomes a
      // this-week constraint, even when an earlier clause said 这周.
      if(/下周/.test(body))continue
      const ownWeek=/(?:这|本)周/.exec(body)
      if(ownWeek){weekScoped=true;weekQuote=ownWeek[0]}
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
  // P2 (B05/B10): the plan binds to the budget that actually APPLIES to the
  // plan's own period. A next-week plan never binds to this week's remainder
  // or to a this-week-scoped amount; it uses the recurring weekly budget. A
  // current/this-week plan binds to the tightest stated amount. When nothing
  // applies (a this-week plan with only a next-week budget, or vice versa)
  // there is no plan obligation at all — the honest gap, never a quietly
  // re-scoped plan.
  if(plan){
    let bindingMinutes:number|null=null
    if(plan.period==='next_week')bindingMinutes=weekly&&weekly.period!=='this_week'?weekly.minutes:null
    else bindingMinutes=remaining?.minutes??(weekly&&weekly.period!=='next_week'?weekly.minutes:null)
    if(bindingMinutes!==null)effects.push({type:'weekly_plan',period:plan.period,minutes:bindingMinutes})
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
  const bare=/(?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半|个)?\s*(?:小时|钟头)/.exec(text)
  if(!bare)return null
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

// P5.3 step 8 (P2 revision): a reply must not AFFIRM a different amount of the
// user's OWN just-stated budget (你每周有6小时 while the user just said 2h).
// P1 removed this check because it blocked legitimate comparisons; it returns
// with an escape hatch for amounts attributed to an OPPORTUNITY or a change
// framing — the classes P1 actually hit. The structural checks (required growth
// update carries the new amount; a staged plan's availableMinutes equals the
// binding budget) remain the primary guard.
const replyAmountEscape=/(?:从|降到|改为|变为|变成|减到|减少到|换成|改到|低于|超过|多于|不到|最多|至少|实习|岗位|项目|机会|兼职|这份|该|对方|要求|需要|它| offer)/
export function verifyReplyAgainstObligations(obligations:TurnObligations,reply:string):void{
  for(const effect of obligations.requiredEffects){
    if(effect.type==='weekly_time'){
      for(const match of reply.matchAll(/每(?:周|星期)[^，,。；;！？!\n]{0,8}?((?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半|个)?\s*(?:小时|钟头))/g)){
        const stated=remainingMinutes(match[1]!)
        if(stated===null||stated===effect.minutes)continue
        const before=reply.slice(Math.max(0,match.index-12),match.index)
        if(replyAmountEscape.test(before)||replyAmountEscape.test(match[0]))continue
        throw new ObligationError('REPLY_CONTRADICTS_CURRENT_EFFECT')
      }
    }
    if(effect.type==='remaining_time'){
      // A different REMAINING amount in the reply contradicts the just-stated
      // one; a weekly amount never does (每周6小时 with 这周剩2小时 is normal).
      for(const match of reply.matchAll(/(?:只)?还?剩(?:下|着)?[^，,。；;！？!\n]{0,6}((?:[0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百]+|半)(?:个半|个)?\s*(?:小时|钟头))/g)){
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

// P1/P2: a server-verified weekly/remaining budget the model failed to persist
// is staged deterministically from the obligation itself — the same trust
// pattern as explicit direction controls. The quote is the user's own verbatim
// clause; nothing beyond it is ever written. P2 (B04): a weekly amount scoped
// to THIS or NEXT week persists as a week-scoped constraint so its applicable
// period survives; an unscoped recurring amount stays an open context fact.
export function supplementMissingBudgetDeltas(obligations:TurnObligations,stagedGrowth:import('./growth.ts').GrowthStaged|undefined,currentMessageId:string,currentText=''):import('./growth-model-contracts.ts').GrowthInputDelta[]{
  if(!obligations.requiredEffects.length)return []
  const covered=(effect:Extract<RequiredEffect,{type:'weekly_time'|'remaining_time'}>)=>(stagedGrowth?.changes??[]).some(delta=>delta.assertion==='user_reported'
    &&(effect.type==='remaining_time'?delta.kind==='constraint':['context','constraint'].includes(delta.kind))
    &&hoursIn(delta.text)===effect.minutes)
  const deltas:import('./growth-model-contracts.ts').GrowthInputDelta[]=[]
  for(const effect of obligations.requiredEffects){
    if(effect.type==='weekly_time'&&!covered(effect)){
      if(effect.period==='current')
        deltas.push({target:{operation:'create'},assertion:'user_reported',kind:'context',source:{messageId:currentMessageId,quote:effect.quote}})
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
    if(clause.quoted||clause.code||clause.attributedToOther||clause.interrogative)continue
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
  // likewise a no-op: every old char covered, at most three added.
  for(const item of authorized){
    if(item.assertion!=='user_reported'&&item.assertion!=='user_edit')continue
    const oldChars=new Set(item.text.replace(/[^\p{L}\p{N}]/gu,'')),newChars=new Set(newQuote.replace(/[^\p{L}\p{N}]/gu,''))
    let covered=true,added=0
    for(const char of oldChars)if(!newChars.has(char)){covered=false;break}
    if(covered)for(const char of newChars)if(!oldChars.has(char))added++
    if(covered&&oldChars.size>=3&&added<=3)return null
  }
  // Deterministic amend target: the old item whose clauses overlap BOTH the
  // new value and the rest of the correction message (the part that usually
  // names the old value: 刚才说成大三了 / 策划主要是队长做的). Requires a clear
  // margin over the runner-up clause so a wrong item is never rewritten.
  type Scored={item:CorrectionCandidate;clause:string;score:number}
  const restOfMessage=clauses.map(clause=>clause.text).join('').replace(newQuote,'')
  const scored:Scored[]=[]
  for(const item of authorized){
    if(item.assertion!=='user_reported'&&item.assertion!=='user_edit')continue
    if(item.text.includes(newQuote)||newQuote===item.text)continue
    const clausesOfItem=scanUserClauses(item.text).map(clause=>clause.text.trim()).filter(carriesText)
    for(const clause of clausesOfItem){
      const score=sharedChars(newQuote,clause)+sharedChars(restOfMessage,clause)
      scored.push({item,clause,score})
    }
  }
  scored.sort((a,b)=>b.score-a.score)
  const best=scored[0],runnerUp=scored[1]
  if(best&&best.score>=3&&(!runnerUp||runnerUp.score<best.score)&&best.item.text.split(best.clause).length===2){
    return {newQuote,target:{itemId:best.item.id,expectedRevision:best.item.revision,beforeQuote:best.clause,kind:best.item.kind}}
  }
  return {newQuote,target:undefined}
}
