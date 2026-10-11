// P2 (D-gate replay): growth mutation authority. The model expresses INTENT —
// create a new fact, or correct/change a referenced item — and this module
// alone decides the concrete mutation: which item, which revision, amend vs
// replace vs a safe create. A provider cannot overwrite an old item twice in
// one turn, cannot replace an item its current clause has no correction
// relation to, and memory-control clauses never enter the growth mutation
// batch (they commit through the control path instead — P3).

import type { ClauseHandle } from './clause-catalogue.ts'
import { resolveClause } from './clause-catalogue.ts'
import type { GrowthInputDelta, ResolvedGrowthDelta, ResolvedGrowthTarget } from './growth-model-contracts.ts'
import type { CorrectionPlan } from './turn-obligations.ts'
import {applicableTimeBudget} from './turn-obligations.ts'
import {conversationPreferenceClause,currentConversationOnly,deferredPursuitClause} from './user-command-spans.ts'

export type AuthorityItemView={id:string;revision:number;kind:string;assertion:string;text:string;unavailableReason:string|null;status?:string}

export type GrowthAuthorityAudit=
  |{phase:'growth_authority_entry';deltas:number;planTarget:boolean;controlClauses:number}
  |{phase:'growth_clause_unresolved';inputIndex:number;clauseId:string}
  |{phase:'growth_clause_not_anchorable';inputIndex:number;clauseId:string;reason:'interrogative'|'conditional'|'quoted'|'code'|'fragment'|'chat_request'}
  |{phase:'growth_control_clause_excluded';inputIndex:number;clauseId:string}
  |{phase:'growth_duplicate_clause';inputIndex:number;clauseId:string}
  |{phase:'growth_correct_unknown_item';inputIndex:number;itemId:string}
  |{phase:'growth_correct_no_relation';inputIndex:number;itemId:string}
  |{phase:'growth_correct_duplicate_target';inputIndex:number;itemId:string}
  |{phase:'growth_correct_goal_change';inputIndex:number;itemId:string}
  |{phase:'growth_correct_honored';inputIndex:number;itemId:string;mode:'amend'|'replace'}
  |{phase:'growth_marker_clause_excluded';inputIndex:number;clauseId:string}
  |{phase:'growth_correction_plan_retarget';inputIndex:number;itemId:string;mode:'amend'|'replace'}
  |{phase:'growth_goal_superseded';inputIndex:number;itemId:string;mode:'create_retarged_to_replace'}

// A goal/direction change marker in the CURRENT clause: the user is changing
// course, not asserting a new independent fact alongside the old ones.
export const goalChangeMarker=/(?:改主意|换(?:个)?(?:方向|目标)|不想(?:再)?(?:做|继续|准备)|不打算|决定不|改为|换成|转向|放弃)/
const goalChangeMarkerReplace=/(?:改为|换成|转向|不想(?:再)?(?:做|继续|准备)|不打算|决定不|放弃)/
const clauseIsControl=(text:string,controlClauseTexts:readonly string[])=>controlClauseTexts.some(control=>control.trim()===text.trim())
const carriesClauseText=(text:string)=>/[\p{L}\p{N}]/u.test(text)

export function resolveGrowthDeltas(input:{
  deltas:readonly GrowthInputDelta[]
  currentMessageId:string
  currentText:string
  catalogue:readonly ClauseHandle[]
  authorized:readonly AuthorityItemView[]
  correctionPlan:CorrectionPlan|null
  controlClauseTexts:readonly string[]
}):{deltas:ResolvedGrowthDelta[];audit:GrowthAuthorityAudit[];indexMap:ReadonlyMap<number,number>}{
  const audit:GrowthAuthorityAudit[]=[]
  const resolved:ResolvedGrowthDelta[]=[]
  const indexMap=new Map<number,number>()
  audit.push({phase:'growth_authority_entry',deltas:input.deltas.length,planTarget:Boolean(input.correctionPlan?.target),controlClauses:input.controlClauseTexts.length})
  const mutatedItems=new Set<string>()
  const emittedClauses=new Set<string>()
  for(const [inputIndex,delta] of input.deltas.entries()){
    const clause=resolveClause(input.catalogue,delta.source.clauseId)
    if(!clause){audit.push({phase:'growth_clause_unresolved',inputIndex,clauseId:String(delta.source.clauseId)});continue}
    if(!carriesClauseText(clause.text)){audit.push({phase:'growth_clause_unresolved',inputIndex,clauseId:clause.clauseId});continue}
    // P3: a memory-control clause commits through the control path only.
    if(clauseIsControl(clause.text,input.controlClauseTexts)){audit.push({phase:'growth_control_clause_excluded',inputIndex,clauseId:clause.clauseId});continue}
    // A question, hypothesis, quoted span or code block is not a personal
    // fact the user asserted — the meta-query shape (你记得我之前说过什么吗)
    // can no longer ground a user_reported create (L1OFF).
    if(delta.assertion==='user_reported'){
      if(conversationPreferenceClause(clause.text)){audit.push({phase:'growth_clause_not_anchorable',inputIndex,clauseId:clause.clauseId,reason:'chat_request'});continue}
      // SP_STATUS_01: a request about THIS conversation is not a pursuit or
      // personal fact, even if the provider selects it as a goal. Short genuine
      // direction statements (先就业/先探索科研) remain eligible.
      if(/^(?:(?:请|麻烦|帮我|给我)(?:先|继续)?(?:处理|解释|看看|分析|安排|写|修改|听|聊)|(?:先|继续)(?:处理|解决|看|聊|整理|核对)(?:这个|这件|原来|刚才|上述|一下))/.test(clause.text.trim())){
        audit.push({phase:'growth_clause_not_anchorable',inputIndex,clauseId:clause.clauseId,reason:'chat_request'});continue
      }
      // A pure connective/adverbial fragment (顺便/然后/另外…) is not a fact.
      if(/^(?:我想把(?:验证问题|访谈问题|提问|这个问题)|把(?:上次的|这个)?问题)改成/.test(clause.text)){
        audit.push({phase:'growth_clause_not_anchorable',inputIndex,clauseId:clause.clauseId,reason:'chat_request'});continue
      }
      if(/^(?:顺便|然后|另外|同时|所以|但是|而且|接着|其次|最后|还有|而且呢)$/.test(clause.text.trim())||clause.text.trim().length<=2){audit.push({phase:'growth_clause_not_anchorable',inputIndex,clauseId:clause.clauseId,reason:'fragment'});continue}
      if(clause.interrogative){audit.push({phase:'growth_clause_not_anchorable',inputIndex,clauseId:clause.clauseId,reason:'interrogative'});continue}
      if(clause.conditional){audit.push({phase:'growth_clause_not_anchorable',inputIndex,clauseId:clause.clauseId,reason:'conditional'});continue}
      if(clause.quoted||clause.code){audit.push({phase:'growth_clause_not_anchorable',inputIndex,clauseId:clause.clauseId,reason:clause.quoted?'quoted':'code'});continue}
    }
    // The same clause grounds one fact per turn; a provider echoing one span
    // into several shapes (the C06 duplicate replace shape) keeps the first.
    if(emittedClauses.has(clause.clauseId)){audit.push({phase:'growth_duplicate_clause',inputIndex,clauseId:clause.clauseId});continue}
    // The marker clause of an active correction plan belongs to the
    // deterministic fallback staging — a model create anchored there would
    // store the marker prefix (更正一下：…) as a stray fact, so creates are
    // dropped early. A correct aimed at the scored plan target is honored
    // below (the plan supplies the stripped newQuote), so it passes through.
    if(delta.target.operation!=='correct'&&input.correctionPlan&&/(?:更正|说错了?|搞错了?|记错了?|写错了?|看错了?|不对|说成|说成过|之前说|以前说|原本是)/.test(clause.text)&&!clause.interrogative){audit.push({phase:'growth_marker_clause_excluded',inputIndex,clauseId:clause.clauseId});continue}
    const timeEvidence=resolveTimeEvidence(delta,input.catalogue)
    // The wire timeEvidence (clauseId form) must never leak through: an
    // unresolvable anchor means NO evidence, and the supplement path covers
    // the obligation deterministically. A legacy validUntil is kept ONLY when
    // it is well-formed timezone-explicit ISO text — the server owns expiry,
    // and a malformed model value is dropped instead of poisoning the turn.
    const deltaWithoutExpiry={...delta}
    if('timeEvidence'in deltaWithoutExpiry)delete deltaWithoutExpiry.timeEvidence
    const expiry='validUntil'in delta?delta.validUntil:undefined
    const legacyValidUntil=typeof expiry==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(expiry)?expiry:undefined
    if('validUntil'in deltaWithoutExpiry)delete deltaWithoutExpiry.validUntil
    const next:ResolvedGrowthDelta={...deltaWithoutExpiry,...(legacyValidUntil?{validUntil:legacyValidUntil}:{}),source:{messageId:input.currentMessageId,quote:clause.text},target:{operation:'create'},...(timeEvidence?{timeEvidence}:{})} as unknown as ResolvedGrowthDelta
    // A provider kind is not evidence of an affirmative pursuit. Reports,
    // negative preferences and current feelings retain their words as context.
    if(next.assertion==='user_reported'&&['goal','direction'].includes(next.kind)&&
      (currentConversationOnly(input.currentText)||clause.attributedToOther||/^(?:但|也|还|仍)?(?:没|没有|未|尚未)|(?:不想|不要|别)(?:改|到|再)|(?:我)?(?:有点|很)?(?:担心|烦躁|难过)/.test(clause.text)||
       !/(?:想|打算|希望|准备|计划|优先|决定|目标|我(?:要|将)|先(?:就业|考研|考公|探索|处理))|^(?:就业|考研|保研|考公|创业|留学|专升本)$/.test(clause.text)))next.kind='context'
    if(['goal','direction'].includes(next.kind)&&/^我想把(?:验证问题|访谈问题|提问|这个问题)/.test(clause.text))next.kind='context'
    if(['goal','direction'].includes(next.kind)&&deferredPursuitClause(clause.text))next.kind='context'
    if(['goal','direction'].includes(next.kind)&&/^我(?:愿意|想)(?:试|尝试)(?:这个|刚才|上述)(?:方法|那一步)?/.test(clause.text))next.kind='context'
    if(next.assertion==='user_reported'&&['context','constraint'].includes(next.kind)){
      const budget=[applicableTimeBudget(input.currentText,undefined,'this_week'),applicableTimeBudget(input.currentText,undefined,'next_week')].find(b=>b?.quote===clause.text&&b.period!=='current')
      if(budget){
        next.kind='constraint'
        next.timeEvidence={kind:'calendar_week',which:budget.period==='next_week'?'next':'this',quote:budget.period==='next_week'?'下周':(/本周/.test(input.currentText)?'本周':'这周')}
      }
    }
    if(delta.target.operation==='correct'){
      const itemId=delta.target.itemId
      const item=input.authorized.find(row=>row.id===itemId)
      if(!item){audit.push({phase:'growth_correct_unknown_item',inputIndex,itemId});emittedClauses.add(clause.clauseId);indexMap.set(inputIndex,resolved.length);resolved.push(next);continue}
      // One mutation per old item per turn (C06/L2:6 duplicate shapes).
      if(mutatedItems.has(itemId)){audit.push({phase:'growth_correct_duplicate_target',inputIndex,itemId});emittedClauses.add(clause.clauseId);indexMap.set(inputIndex,resolved.length);resolved.push(next);continue}
      // The deterministic correction plan is authoritative for fact
      // corrections; a goal/direction change marker honors an explicit item
      // selection on a goal-shaped item. Anything else is a new fact.
      const planTarget=input.correctionPlan?.target?.itemId===itemId?input.correctionPlan.target:null
      const goalChange=['goal','direction'].includes(item.kind)&&item.assertion==='user_reported'&&!item.unavailableReason&&goalChangeMarker.test(clause.text)
      // A correction clause carries its marker prefix (更正一下：我是大二); the
      // stored value is the plan's marker-stripped verbatim newQuote, never the
      // raw clause.
      const markerClause=Boolean(input.correctionPlan)&&/(?:更正|说错了?|搞错了?|记错了?|写错了?|看错了?|不对)/.test(clause.text)
      // A correction adopts the OLD item's kind; when that makes it a
      // feedback item the delta must actually carry the action state.
      const kindCompatible=item.kind!=='feedback'||('progressState'in delta)
      if(planTarget&&kindCompatible){
        const composite=(item.text.match(/[，,；;。！？\n]/)?.length??0)>0
        next.target=composite
          ?{operation:'amend',itemId:item.id,expectedRevision:item.revision,beforeQuote:planTarget.beforeQuote}
          :{operation:'replace',itemId:item.id,expectedRevision:item.revision}
        if(input.correctionPlan&&input.correctionPlan.newQuote!==clause.text)next.source={messageId:input.currentMessageId,quote:input.correctionPlan.newQuote}
        audit.push({phase:'growth_correct_honored',inputIndex,itemId,mode:next.target.operation})
      }else if(goalChange){
        // When the anchor is the marker clause itself (我改主意了), the
        // replacement value is the NEXT first-person clause of the same
        // message (现在想先就业) — the marker text never becomes the fact.
        if(goalChangeMarker.test(clause.text)&&!goalChangeMarkerReplace.test(clause.text)){
          // The marker's 我 already scopes the sentence to the user; the
          // follow clause itself may omit it (现在想先就业).
          const follow=input.catalogue.filter(handle=>handle.start>clause.end&&!handle.interrogative&&!handle.attributedToOther&&!goalChangeMarker.test(handle.text)).find(handle=>carriesClauseText(handle.text))
          if(follow)next.source={messageId:input.currentMessageId,quote:follow.text}
        }
        next.target={operation:'replace',itemId:item.id,expectedRevision:item.revision}
        audit.push({phase:'growth_correct_goal_change',inputIndex,itemId})
      }else{
        audit.push({phase:'growth_correct_no_relation',inputIndex,itemId})
        // The marker clause of an active correction plan is owned by the
        // deterministic fallback staging; a model delta aimed at the WRONG
        // item never re-saves the corrected value as a stray duplicate.
        if(markerClause)continue
        emittedClauses.add(clause.clauseId);resolved.push(next);continue
      }
      // A correction carries the corrected item's kind; the provider's own
      // kind label never retypes an existing record (L3:4 shape).
      ;(next as {kind:string}).kind=item.kind
      mutatedItems.add(itemId)
      emittedClauses.add(clause.clauseId)
      indexMap.set(inputIndex,resolved.length)
      resolved.push(next)
      continue
    }
    emittedClauses.add(clause.clauseId)
    indexMap.set(inputIndex,resolved.length)
    resolved.push(next)
  }
  // Correction-plan retarget: when the scored plan target EXISTS and the
  // model landed the corrected value as a plain create, that create becomes
  // the plan's amendment — the refuted old clause must not stay active beside
  // its replacement (G1-contribution shape: 我做的是整体策划 stayed active
  // next to 我只负责了排版).
  if(input.correctionPlan?.target){
    const plan=input.correctionPlan,targetPlan=input.correctionPlan.target
    // The new value may land verbatim (quote===newQuote) or as its whole
    // clause; accept either as the correction's replacement payload as long
    // as no amend/replace on the target was already staged.
    const index=resolved.findIndex(delta=>delta.target.operation==='create'&&(delta.source.quote===plan.newQuote||input.currentText.includes(delta.source.quote)&&delta.source.quote!==plan.target!.beforeQuote&&!resolved.some(other=>other!==delta&&(other.target.operation==='amend'||other.target.operation==='replace')&&'itemId'in other.target&&other.target.itemId===plan.target!.itemId)))
    if(index>=0){
      const delta=resolved[index]!
      const target=input.authorized.find(item=>item.id===plan.target!.itemId)
      if(target&&target.revision===plan.target!.expectedRevision){
        const composite=(target.text.match(/[，,；;。！？\n]/)?.length??0)>0
        resolved[index]={...delta,kind:targetPlan.kind,target:composite
          ?{operation:'amend',itemId:target.id,expectedRevision:target.revision,beforeQuote:plan.target!.beforeQuote}
          :{operation:'replace',itemId:target.id,expectedRevision:target.revision}} as typeof delta
        audit.push({phase:'growth_correction_plan_retarget',inputIndex:-1,itemId:target.id,mode:composite?'amend':'replace'})
      }
    }
  }
  // Goal supersession (goal-change semantics): when a change-marker sentence
  // (改主意/不想继续/决定不…) lands a NEW goal/direction via a plain create,
  // the server retargets it to replace the single active goal record — the
  // old goal must not stay active beside its declared replacement (两个相反
  // 的当前目标不能同时有效). The marker is matched against the WHOLE message:
  // the anchor clause itself (现在想先就业) may not carry the marker (我改主意了).
  if(input.authorized.length){
    const activeGoals=input.authorized.filter(item=>['goal','direction'].includes(item.kind)&&item.assertion==='user_reported'&&item.status==='active'&&!item.unavailableReason)
    if(activeGoals.length===1){
      for(let index=0;index<resolved.length;index++){
        const delta=resolved[index]!
        if(delta.target.operation==='create'&&['goal','direction'].includes(delta.kind)&&(goalChangeMarker.test(delta.source.quote)||goalChangeMarker.test(input.currentText))){
          resolved[index]={...delta,target:{operation:'replace',itemId:activeGoals[0]!.id,expectedRevision:activeGoals[0]!.revision}} as typeof delta
          audit.push({phase:'growth_goal_superseded',inputIndex:indexMap.size?index:-1,itemId:activeGoals[0]!.id,mode:'create_retarged_to_replace'})
          break
        }
      }
    }
  }
  return {deltas:resolved,audit,indexMap}
}

// Time evidence selects a clause handle too; the resolved quote is a
// server-derived span of that clause's exact text. The week marker and the
// dated/duration phrases resolve to the tightest grammar-matching span inside
// the clause, so calendar/duration evidence still validates verbatim while the
// model can only point at a clause — never author the span.
function resolveTimeEvidence(delta:GrowthInputDelta,catalogue:readonly ClauseHandle[]):ResolvedGrowthDelta['timeEvidence']|undefined{
  const evidence='timeEvidence'in delta?delta.timeEvidence:undefined
  if(!evidence)return undefined
  const anchor=resolveClause(catalogue,evidence.clauseId)
  if(!anchor)return undefined
  if(evidence.kind==='calendar_week'){
    const token=evidence.which==='this'?(['本周','这周'] as const).find(week=>anchor.text.includes(week)):(anchor.text.includes('下周')?'下周':undefined)
    return token?{...evidence,quote:token}:undefined
  }
  const phrase=/((?:从现在起|接下来|未来)\s*[\d零一二两三四五六七八九十百]+\s*(?:天|周)|(?:截至|截止到?|直到|到)\s*20\d{2}(?:年|-)\d{1,2}(?:月|-)\d{1,2}日?)/.exec(anchor.text)
  return phrase?{...evidence,quote:phrase[1]!}:undefined
}
