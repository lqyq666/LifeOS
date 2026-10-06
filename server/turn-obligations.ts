import {chineseInteger} from './growth-time.ts'
import type { DirectionScope, RawDirectionControl, PreparedDirectionControls } from './growth-controls.ts'
import type { GrowthStaged } from './growth.ts'

// P5.2: obligations exist only for explicit, checkable commands — never for
// small talk. This is a limited syntax detector (subject, negation,
// hypothetical, bounds), not a general semantic classifier; unseen phrasings
// simply create no obligation and stay open to review.
export type RequiredEffect =
  | {type:'weekly_time';quote:string;minutes:number;period:'current'|'this_week'|'next_week'}
  | {type:'direction_control';scopes:DirectionScope[];operation:'pause'|'resume'}
  | {type:'grounded_material';materialKind:'resume_portfolio'}
export type TurnObligations = {
  kind:'ordinary'|'update_weekly_time'|'direction_control'|'resume_portfolio'|'mixed'
  requiredEffects:RequiredEffect[]
}

const clauseSplit=/[，,；;。！？!?\n]/
const thirdPersonSubject=/^(?:室友|同学|朋友|他|她|他们|她们|别人|大家|我妈|我爸|父母|家人|老师|辅导员)/
const hypothetical=/(?:如果|要是|假如|假设|万一)/
const negation=/(?:不是|并没有|没说|并非)/
const vagueBound=/(?:大概|大约|左右|至少|最多|不超过|可能)/
const weeklyBudget=/每(?:周|星期)[^，,。；;！？!?\n]{0,8}?([\d零一二两三四五六七八九十百]+)\s*(?:个)?(?:个)?(?:小时|钟头)/

export function weeklyTimeIntent(text:string):{quote:string;minutes:number;period:'current'|'this_week'|'next_week'}|null{
  for(const clause of text.split(clauseSplit)){
    const trimmed=clause.trim()
    if(!trimmed)continue
    if(hypothetical.test(trimmed))continue
    if(negation.test(trimmed)&&weeklyBudget.test(trimmed))continue
    if(thirdPersonSubject.test(trimmed))continue
    if(vagueBound.test(trimmed))continue
    const match=weeklyBudget.exec(trimmed)
    if(!match)continue
    const hours=chineseInteger(match[1]!)
    if(hours===null||hours<1||hours>100)continue
    const period=/下周/.test(trimmed)?'next_week':/(?:这周|本周)/.test(trimmed)?'this_week':'current'
    return {quote:trimmed,minutes:hours*60,period}
  }
  return null
}

// Pure by construction: the caller (engine) runs the growth-controls deriver
// and passes the explicit changes in; this module never loads database code.
export function deriveTurnObligations(currentText:string,options:{resumePortfolioMode?:boolean;directionControls?:readonly RawDirectionControl[]}={}):TurnObligations{
  const effects:RequiredEffect[]=[]
  const weekly=weeklyTimeIntent(currentText)
  if(weekly)effects.push({type:'weekly_time',...weekly})
  for(const change of options.directionControls??[])effects.push({type:'direction_control',scopes:change.scopes,operation:change.operation})
  if(options.resumePortfolioMode)effects.push({type:'grounded_material',materialKind:'resume_portfolio'})
  const families=new Set(effects.map(effect=>effect.type))
  const kind=families.size>1?'mixed'
    :families.has('weekly_time')?'update_weekly_time'
    :families.has('direction_control')?'direction_control'
    :families.has('grounded_material')?'resume_portfolio'
    :'ordinary'
  return {kind,requiredEffects:effects}
}

// A pure control message contains nothing but the explicit command clauses and
// trivial connectives — it can be answered deterministically without a model.
export function isPureControlCommand(currentText:string,obligations:TurnObligations,controlQuotes:readonly string[]):boolean{
  if(obligations.kind!=='direction_control'||!obligations.requiredEffects.length||!controlQuotes.length)return false
  const controlClauses=new Set(controlQuotes)
  return currentText.split(clauseSplit).map(clause=>clause.trim()).every(clause=>!clause||controlClauses.has(clause)||clause.length<=3)
}

const hoursIn=(text:string):number|null=>{
  const match=weeklyBudget.exec(text)??/(?:^|[^\d])(\d{1,3})\s*(?:个)?小时/.exec(text)
  if(!match)return null
  const value=chineseInteger(match[1]!)
  return value!==null&&value>=1&&value<=100?value:null
}

export type ObligationVerificationInput={
  growth:GrowthStaged|undefined
  controls:PreparedDirectionControls|undefined
  coachActionDraft?:{readiness?:string}|null
  currentText:string
  reply:string
}

// P5.3 step 4: required state changes must actually exist in the staged batch.
// A reply that answers an old topic while the required update is absent fails
// the turn — the absence of a source error is not success.
export function verifyTurnObligations(obligations:TurnObligations,staged:ObligationVerificationInput):void{
  for(const effect of obligations.requiredEffects){
    if(effect.type==='weekly_time'){
      const hours=effect.minutes/60
      const covered=(staged.growth?.changes??[]).some(delta=>delta.assertion==='user_reported'
        &&['context','constraint'].includes(delta.kind)
        &&staged.currentText.includes(delta.source.quote)
        &&hoursIn(delta.text)===hours)
      if(!covered)throw new ObligationError('GROWTH_REQUIRED_UPDATE_MISSING')
    }
    if(effect.type==='direction_control'){
      const covered=(staged.controls?.changes??[]).some(change=>change.operation===effect.operation&&effect.scopes.every(scope=>change.scopes.includes(scope)))
      if(!covered)throw new ObligationError('DIRECTION_CONTROL_NOT_APPLIED')
    }
  }
}

// P5.3 step 8: the rendered reply must not contradict a verified required
// effect — one place saying 3h while another still plans on 6h. Mentions of
// the old value framed as a change (从/降到/改为/变为/减少到) stay legal.
export function verifyReplyAgainstObligations(obligations:TurnObligations,reply:string):void{
  for(const effect of obligations.requiredEffects){
    if(effect.type!=='weekly_time')continue
    const hours=effect.minutes/60
    for(const match of reply.matchAll(/每(?:周|星期)[^，,。；;！？!\n]{0,8}?(\d{1,3})\s*(?:个)?(?:小时|钟头)/g)){
      const stated=Number(match[1])
      if(!Number.isFinite(stated)||stated===hours)continue
      const before=reply.slice(Math.max(0,match.index-8),match.index)
      if(/(?:从|降到|改为|变为|变成|减到|减少到|降到|换成|改到|低于|超过|多于|不到|最多|至少)/.test(before+match[0]))continue
      throw new ObligationError('REPLY_CONTRADICTS_CURRENT_EFFECT')
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
