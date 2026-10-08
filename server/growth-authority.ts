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

export type AuthorityItemView={id:string;revision:number;kind:string;assertion:string;text:string;unavailableReason:string|null}

export type GrowthAuthorityAudit=
  |{phase:'growth_clause_unresolved';inputIndex:number;clauseId:string}
  |{phase:'growth_clause_not_anchorable';inputIndex:number;clauseId:string;reason:'interrogative'|'conditional'|'quoted'|'code'}
  |{phase:'growth_control_clause_excluded';inputIndex:number;clauseId:string}
  |{phase:'growth_duplicate_clause';inputIndex:number;clauseId:string}
  |{phase:'growth_correct_unknown_item';inputIndex:number;itemId:string}
  |{phase:'growth_correct_no_relation';inputIndex:number;itemId:string}
  |{phase:'growth_correct_duplicate_target';inputIndex:number;itemId:string}
  |{phase:'growth_correct_goal_change';inputIndex:number;itemId:string}
  |{phase:'growth_correct_honored';inputIndex:number;itemId:string;mode:'amend'|'replace'}

// A goal/direction change marker in the CURRENT clause: the user is changing
// course, not asserting a new independent fact alongside the old ones.
const goalChangeMarker=/(?:改主意|换(?:个)?(?:方向|目标)|不想(?:再)?(?:做|继续|准备)|不打算|决定不|改为|换成|转向|放弃)/
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
      if(clause.interrogative){audit.push({phase:'growth_clause_not_anchorable',inputIndex,clauseId:clause.clauseId,reason:'interrogative'});continue}
      if(clause.conditional){audit.push({phase:'growth_clause_not_anchorable',inputIndex,clauseId:clause.clauseId,reason:'conditional'});continue}
      if(clause.quoted||clause.code){audit.push({phase:'growth_clause_not_anchorable',inputIndex,clauseId:clause.clauseId,reason:clause.quoted?'quoted':'code'});continue}
    }
    // The same clause grounds one fact per turn; a provider echoing one span
    // into several shapes (the C06 duplicate replace shape) keeps the first.
    if(emittedClauses.has(clause.clauseId)){audit.push({phase:'growth_duplicate_clause',inputIndex,clauseId:clause.clauseId});continue}
    const timeEvidence=resolveTimeEvidence(delta,input.catalogue)
    // The wire timeEvidence (clauseId form) must never leak through: an
    // unresolvable anchor means NO evidence, and the supplement path covers
    // the obligation deterministically.
    const {timeEvidence:wireTimeEvidence,...deltaWithoutEvidence}=delta
    void wireTimeEvidence
    const next:ResolvedGrowthDelta={...deltaWithoutEvidence,source:{messageId:input.currentMessageId,quote:clause.text},target:{operation:'create'},...(timeEvidence?{timeEvidence}:{})} as unknown as ResolvedGrowthDelta
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
