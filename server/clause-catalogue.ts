// P1 (D-gate replay): the server owns every quote the model can anchor a
// personal fact to. The current user message is split into stable, numbered
// clause handles rendered into the prompt; the model only ever SELECTS a
// clauseId and the server resolves the exact verbatim span and messageId.
// A fabricated, drifted or cross-message quote is unrepresentable.

import { scanUserClauses,otherActorClause,firstPersonalActor,jointPersonalActorClause,personalReportBody,ownedOuterRecordAction,actionReportText,actionStepChoice } from './user-command-spans.ts'
import {SKILL_ACTION_LEXICON} from './category-lexicon.ts'
import {personalContributionClauses,personalActionText,actionEvidenceUnavailable,clauseExpressesFuturePlan,clauseReportsCompleted,reportedAdjacentCleanupResult} from './experience-content.ts'

export type ClauseHandle={
  clauseId:string
  text:string
  start:number;end:number
  // Structural flags reused by the anchor guards: a question, a hypothesis, a
  // quoted span or code is never a personal-fact anchor.
  interrogative:boolean
  conditional:boolean
  quoted:boolean
  code:boolean
  quoteSpans?:ReadonlyArray<{start:number;end:number}>
  codeSpans?:ReadonlyArray<{start:number;end:number}>
  attributedToOther:boolean
  sentenceStart:number;sentenceEnd:number
}

const wholeStepChoice=(clause:ClauseHandle)=>clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.attributedToOther||clause.quoteSpans?.length||clause.codeSpans?.length
  ?null:actionStepChoice(actionReportText(clause.text).choiceBody,'whole')

const carriesClauseText=(text:string)=>/[\p{L}\p{N}]/u.test(text)

export function buildClauseCatalogue(text:string):ClauseHandle[]{
  const handles:ClauseHandle[]=[]
  for(const clause of scanUserClauses(text)){
    if(!carriesClauseText(clause.text))continue
    handles.push({
      clauseId:'c'+handles.length,
      text:clause.text,
      start:clause.start,end:clause.end,
      interrogative:clause.interrogative,
      conditional:clause.conditional,
      quoted:clause.quoted,
      code:clause.code,
      quoteSpans:clause.quoteSpans,codeSpans:clause.codeSpans,
      attributedToOther:clause.attributedToOther,
      sentenceStart:clause.sentenceStart,sentenceEnd:clause.sentenceEnd,
    })
  }
  return handles
}

// A detection-only view from the existing scanner; stored quotes stay verbatim.
export function unprotectedClauseText(handle:ClauseHandle):string{
  if(handle.quoted||handle.code)return ''
  const spans=[...(handle.quoteSpans??[]),...(handle.codeSpans??[])]
  return handle.text.split('').map((char,index)=>spans.some(span=>handle.start+index>=span.start&&handle.start+index<span.end)?' ':char).join('')
}

export function resolveClause(catalogue:readonly ClauseHandle[],clauseId:unknown):ClauseHandle|null{
  return typeof clauseId==='string'?catalogue.find(handle=>handle.clauseId===clauseId)??null:null
}

// Private, non-serialized selection identity survives host normalization.
// Public event/source fields and persisted formats remain unchanged.
const processSourceSelections=new WeakMap<object,string>()
export const processSourceClauseId=(node:object)=>processSourceSelections.get(node)
const processFactReferences=new WeakMap<object,number[]>()
export const processFactInputIndices=(node:object)=>processFactReferences.get(node)
export type ReportedContribution={actor:'self'|'joint'|'other'|'unknown';actionQuote:string;pendingActionQuote?:string;proposedActor?:'self'|'joint';rejectedActionRanges?:SourceRange[];skillTags:string[];result?:{quote:string;inputIndex:number};sourceQuote:string;sourceMessageId:string;sourceClauseId:string;factQuote:string}
const contributionSelections=new WeakMap<object,ReportedContribution>()
export const reportedContribution=(fact:object)=>contributionSelections.get(fact)
export function inheritReportedContribution(from:object,to:object){const value=reportedContribution(from);if(value)contributionSelections.set(to,value)}
type SourceRange={start:number;end:number}
const selectedSourceRanges=new WeakMap<object,SourceRange>()
export const selectedSourceRange=(source:object)=>selectedSourceRanges.get(source)
export function inheritSourceRange(from:object,to:object){const range=selectedSourceRange(from);if(range)selectedSourceRanges.set(to,range)}
export function clauseMessageSource<T extends Pick<ClauseHandle,'start'|'text'>>(messageId:string,clause:T,quote=clause.text){
  const source={messageId,quote},offset=clause.text.indexOf(quote)
  if(offset>=0&&clause.text.indexOf(quote,offset+1)<0)selectedSourceRanges.set(source,{start:clause.start+offset,end:clause.start+offset+quote.length})
  return source
}

// Prefer complete source clauses over incidental occurrences inside a longer
// clause. These are literal positions, never another semantic interpretation.
export type SourceControlRef={messageId:string;quote:string;range?:{start:number;end:number}}
export function sourceQuoteRanges(text:string,quote:string,withinQuote?:string|Pick<SourceControlRef,'quote'|'range'>):{start:number;end:number}[]{
  if(!quote.trim())return []
  const scope=withinQuote?sourceControlRanges(text,withinQuote):null,ranges:{start:number;end:number}[]=[]
  for(let start=text.indexOf(quote);start>=0;start=text.indexOf(quote,start+1))if(!scope||scope.some(bound=>start>=bound.start&&start+quote.length<=bound.end))ranges.push({start,end:start+quote.length})
  const clauses=buildClauseCatalogue(text)
  const bounded=ranges.filter(range=>clauses.some(clause=>clause.start===range.start)&&clauses.some(clause=>clause.end<=range.end&&/^[\s，,。！？!?；;、]*$/.test(text.slice(clause.end,range.end))))
  return bounded.length?bounded:ranges
}
export function sourceControlRanges(text:string,ref:string|Pick<SourceControlRef,'quote'|'range'>){
  if(typeof ref==='string')return sourceQuoteRanges(text,ref)
  const range=ref.range
  if(range!==undefined)return range&&Number.isSafeInteger(range.start)&&Number.isSafeInteger(range.end)&&range.start>=0&&range.end>range.start&&range.end<=text.length&&ref.quote.trim()&&text.slice(range.start,range.end)===ref.quote?[range]:[]
  return sourceQuoteRanges(text,ref.quote)
}
export function uniqueSourceControlRange(text:string,ref:string|Pick<SourceControlRef,'quote'|'range'>):{start:number;end:number}|null{
  const ranges=typeof ref==='string'?sourceQuoteRanges(text,ref):sourceControlRanges(text,ref)
  return ranges.length===1?ranges[0]!:null
}
export function sourceQuotesOverlap(text:string,left:string|Pick<SourceControlRef,'quote'|'range'>,right:string|Pick<SourceControlRef,'quote'|'range'>,withinQuote?:string|Pick<SourceControlRef,'quote'|'range'>):boolean{
  return (typeof left==='string'?sourceQuoteRanges(text,left,withinQuote):sourceControlRanges(text,left)).some(a=>sourceControlRanges(text,right).some(b=>a.start<b.end&&b.start<a.end))
}
export function sourceQuoteCovered(text:string,quote:string,byQuote:string|Pick<SourceControlRef,'quote'|'range'>):boolean{
  const selected=sourceQuoteRanges(text,quote),cover=sourceControlRanges(text,byQuote)
  return selected.length>0&&selected.every(a=>cover.some(b=>a.start>=b.start&&a.end<=b.end))
}

// Process nodes and personal memory select the same server-owned source
// handles. Existing records and legacy outputs keep their public shape.
export function bindProcessSourceHandles(schema:unknown):void{
  if(!schema||typeof schema!=='object')return
  const properties=(schema as Record<string,any>).properties,event=properties?.event?.properties
  for(const branch of properties?.growthUpdates?.items?.anyOf??[]){
    if(branch.properties?.kind?.const!=='feedback')continue
    branch.properties.contribution={type:'object',properties:{actor:{type:'string',enum:['self','joint','other','unknown']},actionQuote:{type:'string',maxLength:2000},resultRef:{type:'integer',minimum:0,maximum:7}},required:['actor','actionQuote'],additionalProperties:false,description:'同一事实的行动归属：self本人执行，joint本人实际共同参与，other仅他人执行，unknown执行者未明确；actor与progressState独立，未执行但已知unattempted时actor可unknown。actionQuote只复制本分句内本人实际做过的动作原文；未执行、不确定或只有他人行为时留空。不得从看到、听说、委托或计划推断本人执行。resultRef可省略，只选择growthUpdates中同一经历直接结果的user_reported事实索引；不是他人的独立收获，效果未知不补成功。'}
    branch.properties.contribution.properties.skillTags={type:'array',items:{type:'string',enum:SKILL_ACTION_LEXICON.map(entry=>entry.tag)},uniqueItems:true,maxItems:10,description:'只标注本人实际动作涉及的领域，可空；不表示稳定能力。整理别人做过分析的报告不等于本人做过数据分析；看到岗位、引文、委托不算实践。'}
    branch.required=[...new Set([...branch.required??[],'contribution'])]
  }
  if(event&&properties?.growthUpdates){
    // Classify each personal fact once in growthUpdates. Events only select
    // references to those facts; the existing DB nodes are a projection.
    event.factRefs={type:'array',items:{type:'integer',minimum:0,maximum:7},maxItems:8,uniqueItems:true,description:'本轮growthUpdates中与此事项相关的user_reported事实的0基索引；不重复生成fact节点，不引用unknown或AI观察。'}
    for(const branch of event.nodes?.items?.anyOf??[]){
      const kinds=branch.properties?.kind?.anyOf
      if(kinds)branch.properties.kind.anyOf=kinds.filter((kind:any)=>kind.const!=='fact')
    }
  }
  const sources=[...(event?.target?.anyOf??[]).map((branch:any)=>branch.properties?.source),...(event?.nodes?.items?.anyOf??[]).map((branch:any)=>branch.properties?.source),event?.corrections?.items?.properties?.source,event?.matterReports?.items?.properties?.source,properties?.background?.items?.properties?.source]
  for(const source of sources){
    if(!source?.properties?.messageId||!source.properties.quote)continue
    source.properties={clauseId:{type:'string',pattern:'^c[0-9]+$',description:'选择currentUserMessage.clauses中的一个原文分句；服务器填写消息ID与精确引文。'}}
    source.required=['clauseId']
    source.description='只引用本轮原文分句，与growthUpdates共用同一来源目录，不生成消息ID或重写引文。'
  }
}

export function constrainClauseCatalogueHandles(schema:unknown,clauseIds:readonly string[]):void{
  if(!clauseIds.length||!schema||typeof schema!=='object')return
  if(Array.isArray(schema)){
    for(const item of schema)constrainClauseCatalogueHandles(item,clauseIds)
    return
  }
  const node=schema as Record<string,any>,handle=node.properties?.clauseId
  if(handle&&!Array.isArray(handle.enum))node.properties.clauseId={...handle,enum:[...clauseIds]}
  for(const [key,child] of Object.entries(node)){
    if(!['const','enum','default','examples'].includes(key))constrainClauseCatalogueHandles(child,clauseIds)
  }
}

export function resolveProcessSourceHandles(output:unknown,context:{messageId:string;catalogue:readonly ClauseHandle[];text?:string;canonicalFacts?:boolean;optionalContributions?:boolean;omitQuestionMatterReports?:boolean;ownedFeedbackClauses?:ReadonlySet<string>;boundFeedbackActionClauseId?:string;hostFactClauses?:ReadonlySet<string>},onNormalization?:(kind:string)=>void):void{
  if(!output||typeof output!=='object')return
  const turn=output as Record<string,any>
  // A native no-op has no state or source to retain. Ignore that optional
  // entry without rejecting the independently valid reply and facts.
  if(Array.isArray(turn.event?.matterReports))turn.event.matterReports=turn.event.matterReports.filter((report:any)=>{
    if(report?.state===null&&report.choice===null&&report.resumed===false){onNormalization?.('empty_matter_report_dropped');return false}
    return true
  })
  const selectedClauses=new WeakMap<object,ClauseHandle>()
  let completeSourceCatalogue:readonly ClauseHandle[]|undefined
  const contextualSelfCandidate=(catalogue:readonly ClauseHandle[],clause:ClauseHandle,own:string)=>{
    const prior=catalogue[catalogue.indexOf(clause)-1]
    return Boolean(prior&&prior.sentenceStart===clause.sentenceStart
      &&[prior,clause].every(row=>!row.quoted&&!row.code&&!row.conditional&&!row.interrogative&&!row.attributedToOther&&!row.quoteSpans?.length&&!row.codeSpans?.length)
      &&firstPersonalActor(unprotectedClauseText(prior))&&!jointPersonalActorClause(unprotectedClauseText(prior))
      &&clauseReportsCompleted(unprotectedClauseText(prior))&&/^(?:只)?(?:把|将)/.test(personalReportBody(own)))
  }
  const followsOwnedReport=(clause:ClauseHandle)=>{
    const catalogue=context.catalogue
    for(let index=catalogue.indexOf(clause)-1;index>=0;index--){
      const prior=catalogue[index]!
      if(prior.sentenceStart!==clause.sentenceStart||prior.quoted||prior.code||prior.conditional||prior.interrogative||prior.attributedToOther||prior.quoteSpans?.length||prior.codeSpans?.length)return false
      const body=personalActionText(unprotectedClauseText(prior))
      if(!body||otherActorClause(body,{allowOmittedSubject:true}))return false
      if(firstPersonalActor(body)||jointPersonalActorClause(body))return !clauseExpressesFuturePlan(body)&&!actionEvidenceUnavailable(body)
    }
    return false
  }
  const proposedSelfContinuation=(catalogue:readonly ClauseHandle[],clause:ClauseHandle,own:string)=>{
    const prior=catalogue[catalogue.indexOf(clause)-1]
    if(!prior||prior.sentenceStart!==clause.sentenceStart)return false
    if(![prior,clause].every(row=>!row.quoted&&!row.code&&!row.conditional&&!row.interrogative&&!row.attributedToOther&&!row.quoteSpans?.length&&!row.codeSpans?.length))return false
    const priorText=unprotectedClauseText(prior)
    const personal=firstPersonalActor(priorText)&&!jointPersonalActorClause(priorText)
    const selectedNextStep=/(?:先|现在|目前)?(?:选|选择|决定|优先|把重点放在)/.test(personalReportBody(priorText))
      &&/^(?:今天|明天|后天|这周|本周|下次|接下来)(?:只)?(?:用|花|拿出)/.test(own)
      &&!clauseReportsCompleted(own)
    const plannedParent=clauseExpressesFuturePlan(priorText)&&!otherActorClause(priorText,{allowOmittedSubject:true})&&/^(?:随后|然后|接着|再|又|也)?(?:把|将)/.test(own)
    return Boolean(personal&&(selectedNextStep||plannedParent))
  }
  const resolveContribution=(fact:any,inputIndex:number)=>{
    if(!fact)return
    let clause=resolveClause(context.catalogue,fact.source?.clauseId)
    if(fact.assertion==='user_reported'&&fact.kind==='feedback'&&fact.target?.operation==='create'&&clause&&wholeStepChoice(clause)!==null){
      fact.kind='context'
      delete fact.progressState
      delete fact.contribution
      onNormalization?.('reported_step_choice_without_execution')
      return
    }
    if(!Object.hasOwn(fact,'contribution'))return
    const contribution=fact.contribution
    if(fact.assertion!=='user_reported'||fact.kind!=='feedback'||!clause||!contribution||!['self','joint','other','unknown'].includes(contribution.actor)||typeof contribution.actionQuote!=='string'||contribution.actionQuote!==''&&!contribution.actionQuote.trim()||contribution.actionQuote.length>2000||Object.keys(contribution).some(key=>!['actor','actionQuote','resultRef','skillTags'].includes(key)))throw new Error('CONTRIBUTION_SOURCE_INVALID')
    if(clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.attributedToOther)throw new Error('CONTRIBUTION_ACTION_SOURCE_INVALID')
    let rebound=false
    if(contribution.actionQuote){
      const protectedSpans=(candidate:ClauseHandle)=>[...candidate.quoteSpans??[],...candidate.codeSpans??[]]
      const overlapsProtection=(candidate:ClauseHandle,range:SourceRange)=>protectedSpans(candidate).some(span=>candidate.start+range.start<span.end&&span.start<candidate.start+range.end)
      const coveredByProtection=(candidate:ClauseHandle,range:SourceRange)=>protectedSpans(candidate).some(span=>candidate.start+range.start>=span.start&&candidate.start+range.end<=span.end)
      const crossesProtectionBoundary=(candidate:ClauseHandle,range:SourceRange)=>protectedSpans(candidate).some(span=>{
        const start=candidate.start+range.start,end=candidate.start+range.end
        return start>=span.start&&start<span.end||end>span.start&&end<span.end
      })
      // A correctly selected personal action may contain a quoted object. A
      // quote-only fragment is not an action, while rebound sources below use
      // the stricter any-overlap rule because their ownership is not known.
      const directActionRanges=(candidate:ClauseHandle,quote=contribution.actionQuote)=>sourceQuoteRanges(candidate.text,quote).filter(range=>!coveredByProtection(candidate,range)&&!crossesProtectionBoundary(candidate,range))
      const literalRanges=(candidate:ClauseHandle)=>{
        const ranges:SourceRange[]=[]
        for(let start=candidate.text.indexOf(contribution.actionQuote);start>=0;start=candidate.text.indexOf(contribution.actionQuote,start+1))ranges.push({start,end:start+contribution.actionQuote.length})
        return ranges
      }
      let directRanges=directActionRanges(clause)
      if(!directRanges.length&&context.canonicalFacts&&fact.target?.operation==='create'&&fact.progressState==='completed'&&['self','joint'].includes(contribution.actor)){
        const index=context.catalogue.indexOf(clause)
        const prior=context.catalogue[index-1]
        if(prior&&reportedAdjacentCleanupResult(prior,clause)){
          fact.kind='context'
          delete fact.progressState
          delete fact.contribution
          onNormalization?.('reported_cleanup_outcome_kept_as_fact')
          return
        }
        if(reportedAdjacentCleanupResult(clause,context.catalogue[index+1])){
          // This pair already has an authorized action and exact outcome.
          // Resolve the selected action from its source, then let the normal
          // experience stage link the adjacent reported result.
          const body=personalReportBody(unprotectedClauseText(clause)).trim()
          const actor=jointPersonalActorClause(body)?undefined:firstPersonalActor(body)?.[0]
          const exact=body.slice(actor?.length??0).trim()
          const ranges=exact?directActionRanges(clause,exact):[]
          if(ranges.length===1){
            contribution.actionQuote=exact
            delete contribution.resultRef
            delete contribution.skillTags
            directRanges=ranges
            onNormalization?.('reported_cleanup_action_resolved_from_source')
          }
        }
      }
      if(!directRanges.length){
        // The provider can select the leading clause of one sentence while
        // copying an exact action from its immediately related clause. Rebind
        // only to one safe, verbatim server-owned handle in that same sentence;
        // ambiguity, paraphrase and unsafe contexts remain hard failures.
        if(!context.text)throw new Error('CONTRIBUTION_ACTION_SOURCE_INVALID')
        const completeCatalogue=completeSourceCatalogue??=buildClauseCatalogue(context.text)
        const selected=completeCatalogue.find(candidate=>candidate.start===clause!.start&&candidate.end===clause!.end)
        const matches=completeCatalogue.flatMap(candidate=>literalRanges(candidate).map(range=>({candidate,range})))
        if(matches.length!==1)throw new Error('CONTRIBUTION_ACTION_SOURCE_INVALID')
        const match=matches[0]!
        const reboundClause=context.catalogue.find(candidate=>candidate.start===match.candidate.start&&candidate.end===match.candidate.end)
        const own=personalActionText(match.candidate.text)
        const safeReboundClause=(candidate:ClauseHandle)=>!candidate.quoted&&!candidate.code&&!candidate.conditional&&!candidate.interrogative&&!candidate.attributedToOther&&!candidate.quoteSpans?.length&&!candidate.codeSpans?.length
        const plausiblePersonalSource=own&&(personalContributionClauses(completeCatalogue).includes(match.candidate)||contextualSelfCandidate(completeCatalogue,match.candidate,own))
        const targetBody=personalReportBody(unprotectedClauseText(match.candidate))
        const targetActor=firstPersonalActor(targetBody)
        const completePersonalAction=contribution.actionQuote.trim()===targetBody.trim()||Boolean(targetActor&&contribution.actionQuote.trim()===targetBody.slice(targetActor[0].length).trim())
        const nonPersonalPerformance=otherActorClause(targetBody,{allowOmittedSubject:true})||otherActorClause(contribution.actionQuote,{allowOmittedSubject:true})
        if(!selected||!reboundClause||Math.abs(completeCatalogue.indexOf(match.candidate)-completeCatalogue.indexOf(selected))!==1||match.candidate.sentenceStart!==selected.sentenceStart||!safeReboundClause(selected)||!safeReboundClause(match.candidate)||overlapsProtection(match.candidate,match.range)||!completePersonalAction||nonPersonalPerformance||!plausiblePersonalSource)throw new Error('CONTRIBUTION_ACTION_SOURCE_INVALID')
        clause=reboundClause
        fact.source.clauseId=clause.clauseId
        rebound=true
      }
    }
    const allowedTags=SKILL_ACTION_LEXICON.map(entry=>entry.tag)
    // Optional labels can be unknown without rejecting a valid conversation.
    const skillTags=[...new Set<string>((Array.isArray(contribution.skillTags)?contribution.skillTags:[]).filter((tag:unknown):tag is string=>typeof tag==='string'&&allowedTags.includes(tag)))]
    let pending=false
    let rejectedActionRanges:SourceRange[]=[]
    if(contribution.actionQuote&&['self','joint'].includes(contribution.actor)){
      const actionBody=personalReportBody(unprotectedClauseText(clause)).trim()
      if(otherActorClause(contribution.actionQuote,{allowOmittedSubject:true})&&contribution.actionQuote.trim()!==actionBody)throw new Error('CONTRIBUTION_ACTOR_SOURCE_INVALID')
      const own=personalActionText(clause.text)
      // The full literal can name both the user's completed outer work and
      // the other person's work in its object. Keep the shared, verified
      // outer action only. An excerpt from the other actor still fails.
      const outer=ownedOuterRecordAction(actionBody)
      if(outer&&outer===own&&clauseReportsCompleted(outer)){
        if(rebound||![actionBody,outer].includes(contribution.actionQuote.trim()))throw new Error('CONTRIBUTION_ACTOR_SOURCE_INVALID')
        contribution.actionQuote=outer
        skillTags.length=0
        delete contribution.resultRef
      }
      if(!own||!own.includes(contribution.actionQuote))throw new Error('CONTRIBUTION_ACTOR_SOURCE_INVALID')
      // The optional projection must remain correctable and cannot invert a
      // literal negation/plan. A model-owned performed-action sidecar cannot
      // turn a current choice or proposed next step into experience evidence.
      // Keep the exact user fact, but degrade its performer/action projection
      // before the ownership guard so the useful reply is not discarded.
      const semanticClause=unprotectedClauseText(clause)
      const actionRanges=sourceQuoteRanges(clause.text,contribution.actionQuote)
      const semanticAction=actionRanges.length===1?semanticClause.slice(actionRanges[0]!.start,actionRanges[0]!.end).trim():contribution.actionQuote
      const semanticOwn=personalActionText(semanticClause)??semanticClause
      const omittedActor=!firstPersonalActor(own)&&!jointPersonalActorClause(own)&&!personalContributionClauses(context.catalogue).includes(clause)
      const contextualCandidate=omittedActor&&contextualSelfCandidate(context.catalogue,clause,own)
      const sourceUnavailable=actionRanges.length!==1||actionEvidenceUnavailable(semanticOwn,semanticAction)||clauseExpressesFuturePlan(semanticOwn)
      const proposedContinuation=omittedActor&&!rebound&&proposedSelfContinuation(context.catalogue,clause,own)
      if(proposedContinuation){
        contribution.actionQuote='';skillTags.length=0;fact.progressState='unknown';delete contribution.resultRef
        pending=true
      }else{
        if(rebound){pending=true;skillTags.length=0}
        else if(omittedActor){
          // An omitted subject is not proof of personal performance. Keep the
          // report as an unconfirmed candidate, never a skill or owned result.
          if(!contextualCandidate){
            if(!followsOwnedReport(clause))throw new Error('CONTRIBUTION_ACTOR_SOURCE_INVALID')
            // A literal detail or negative result following the user's own
            // report can remain a fact without a separate action projection.
            fact.kind='context'
            delete fact.progressState
            delete fact.contribution
            return
          }
          pending=true;skillTags.length=0
        }
        if(sourceUnavailable){
          rejectedActionRanges=actionRanges.map(range=>({start:clause.start+range.start,end:clause.start+range.end}))
          contribution.actionQuote='';skillTags.length=0;fact.progressState='unknown';delete contribution.resultRef
        }
      }
    }
    if(['other','unknown'].includes(contribution.actor)&&contribution.actionQuote!=='')throw new Error('CONTRIBUTION_ACTOR_ACTION_INVALID')
    if(fact.progressState==='unattempted'&&contribution.actionQuote!=='')throw new Error('CONTRIBUTION_UNATTEMPTED_ACTION_INVALID')
    if(['self','joint'].includes(contribution.actor)&&['completed','attempted'].includes(fact.progressState)&&!contribution.actionQuote.trim())throw new Error('CONTRIBUTION_ACTION_MISSING')
    const sourceQuote=clause.text
    let resultQuote:string|undefined
    if(contribution.resultRef!==undefined){
      const ref=contribution.resultRef,resultFact=Array.isArray(turn.growthUpdates)&&Number.isInteger(ref)&&ref>=0&&ref<8?turn.growthUpdates[ref]:undefined
      const result=resultFact?.assertion==='user_reported'?resolveClause(context.catalogue,resultFact.source?.clauseId):null
      if(ref===inputIndex||!result||result.quoted||result.code||result.conditional||result.interrogative){
        if(!context.optionalContributions&&context.boundFeedbackActionClauseId!==clause.clauseId)throw new Error('CONTRIBUTION_RESULT_REFERENCE_INVALID')
        // The contribution's action source was already verified. An invalid
        // optional result edge conveys no evidence about the action's outcome.
        delete contribution.resultRef
        onNormalization?.('unsupported_optional_contribution_result_dropped')
      }else{
        // Another actor's report remains its own canonical fact.
        const body=personalReportBody(unprotectedClauseText(result))
        if(!pending&&!result.attributedToOther&&!otherActorClause(body)&&(firstPersonalActor(body)||jointPersonalActorClause(body)||personalContributionClauses(context.catalogue).includes(result)||/^(?:结果|效果|还|仍|尚|未|没有|没|不清楚|不知道)/.test(body)))resultQuote=result.text
      }
    }
    // Self means the user's participation is known; it never claims that the
    // work was done alone. Only literal shared-participation syntax adds joint.
    const actor=pending?'unknown':['self','joint'].includes(contribution.actor)?jointPersonalActorClause(personalActionText(clause.text)??clause.text)?'joint':'self':contribution.actor
    contributionSelections.set(fact,{actor,actionQuote:pending?'':contribution.actionQuote,...(pending&&contribution.actionQuote?{pendingActionQuote:contribution.actionQuote,proposedActor:contribution.actor}:{}),...(rejectedActionRanges.length?{rejectedActionRanges}:{}),skillTags,sourceQuote,sourceMessageId:context.messageId,sourceClauseId:clause.clauseId,factQuote:clause.text,...(resultQuote?{result:{quote:resultQuote,inputIndex:contribution.resultRef}}:{})})
    delete fact.contribution
  }
   const updates=Array.isArray(turn.growthUpdates)?turn.growthUpdates:[],discarded=new Set<number>()
   const indexedRefs=(refs:unknown[])=>refs.filter((ref):ref is {updateIndex:number}=>Boolean(ref&&typeof ref==='object'&&'updateIndex'in ref&&Number.isInteger(ref.updateIndex)))
   const plan=turn.weeklyPlan
   const planRefs=indexedRefs([plan?.budgetRef,...(Array.isArray(plan?.basis)?plan.basis:[])])
   for(const [index,fact] of updates.entries())try{
     if(!Array.isArray(turn.event?.matterReports)&&updates.length<=8&&context.ownedFeedbackClauses?.has(fact?.source?.clauseId)){
       discarded.add(index)
       onNormalization?.('owned_feedback_sidecar_replaced')
       continue
     }
     resolveContribution(fact,index)
   }catch(error){
     if(!context.optionalContributions||updates.length>8||!['create','correct'].includes(fact?.target?.operation)||planRefs.some(ref=>ref.updateIndex===index)||!(error instanceof Error)||!['CONTRIBUTION_ACTION_SOURCE_INVALID','CONTRIBUTION_ACTOR_SOURCE_INVALID','CONTRIBUTION_UNATTEMPTED_ACTION_INVALID','CONTRIBUTION_ACTION_MISSING'].includes(error.message))throw error
    discarded.add(index)
     onNormalization?.('unsupported_optional_contribution_dropped')
  }
  if(discarded.size){
     // An observation loses authority when a cited update is removed. Never
     // let its old index silently select the next unrelated fact.
     for(let changed=true;changed;){
       changed=false
       for(const [index,fact] of updates.entries())if(!discarded.has(index)&&fact?.assertion==='ai_observation'&&Array.isArray(fact.dependencies)&&indexedRefs(fact.dependencies).some(ref=>discarded.has(ref.updateIndex))){
         discarded.add(index);changed=true
       }
     }
     if(planRefs.some(ref=>discarded.has(ref.updateIndex)))throw new Error('PROCESS_PLAN_FACT_REFERENCE_INVALID')
    const kept=new Map<number,number>()
    turn.growthUpdates=updates.filter((_,index)=>{
      if(discarded.has(index))return false
      kept.set(index,kept.size);return true
    })
    for(const fact of turn.growthUpdates){
       if(Array.isArray(fact?.dependencies))for(const ref of indexedRefs(fact.dependencies))if(kept.has(ref.updateIndex))ref.updateIndex=kept.get(ref.updateIndex)!
      const selection=contributionSelections.get(fact)
      if(!selection?.result)continue
      const index=kept.get(selection.result.inputIndex)
      if(index===undefined)delete selection.result
      else selection.result.inputIndex=index
    }
     for(const ref of planRefs)if(kept.has(ref.updateIndex))ref.updateIndex=kept.get(ref.updateIndex)!
    const refs=turn.event?.factRefs
    if(Array.isArray(refs)&&refs.length<=8&&new Set(refs).size===refs.length&&refs.every(ref=>Number.isInteger(ref)&&ref>=0&&ref<=7)){
      turn.event.factRefs=refs.flatMap(ref=>kept.has(ref)?[kept.get(ref)]:[])
    }
  }
  if(turn.event&&Object.hasOwn(turn.event,'factRefs')){
    if(context.canonicalFacts===false)throw new Error('PROCESS_FACT_REFERENCE_INVALID')
    // These are two wire representations of the same fact projection. A new
    // response must choose one; mixing them makes the selected input ambiguous.
    if(Array.isArray(turn.event.nodes)&&turn.event.nodes.some((node:any)=>node?.kind==='fact'))throw new Error('PROCESS_FACT_REFERENCE_INVALID')
    const refs=turn.event.factRefs
    if(!Array.isArray(refs)||refs.length>8||new Set(refs).size!==refs.length)throw new Error('PROCESS_FACT_REFERENCE_INVALID')
    let droppedRefs=0
    const nodes=refs.flatMap((ref:unknown)=>{
      if(!Number.isInteger(ref)||Number(ref)<0||Number(ref)>7)throw new Error('PROCESS_FACT_REFERENCE_INVALID')
      const fact=Array.isArray(turn.growthUpdates)?turn.growthUpdates[Number(ref)]:null
      // factRefs is an optional projection of canonical current-turn facts.
      // A stale index or an AI-only item has no write authority: omit that
      // projection instead of discarding the independently valid user reply.
      if(fact?.assertion!=='user_reported'||!fact.source){droppedRefs++;return []}
      const node={kind:'fact',source:fact.source}
      processFactReferences.set(node,[Number(ref)])
      return [node]
    })
    if(droppedRefs)onNormalization?.('invalid_event_fact_refs_dropped')
    if(turn.event.nodes!==undefined&&!Array.isArray(turn.event.nodes))throw new Error('PROCESS_FACT_REFERENCE_INVALID')
    turn.event.nodes=[...turn.event.nodes??[],...nodes]
    delete turn.event.factRefs
  }
  const resolve=(holder:unknown)=>{
    if(!holder||typeof holder!=='object')return
    const record=holder as Record<string,any>,source=record.source
    if(!source||typeof source!=='object')return
    const selectedId=processSourceSelections.get(record)
    const known=resolveClause(context.catalogue,selectedId)
    if(known&&source.messageId===context.messageId&&source.quote===known.text){selectedClauses.set(record,known);return}
    if(selectedId)throw new Error('PROCESS_SOURCE_HANDLE_INVALID')
    if(!Object.hasOwn(source,'clauseId')){
      if(source.messageId!==context.messageId||typeof source.quote!=='string'||!source.quote.trim()||!(context.text?context.text.includes(source.quote):context.catalogue.some(clause=>clause.text===source.quote)))throw new Error('PROCESS_SOURCE_HANDLE_INVALID')
      if(context.text){
        const ranges=sourceQuoteRanges(context.text,source.quote)
        // Only the server's private WeakMap can disambiguate repeated text.
        // A provider-supplied literal still needs exactly one occurrence.
        const selected=selectedSourceRange(source)
        const range=selected?ranges.find(range=>range.start===selected.start&&range.end===selected.end):ranges.length===1?ranges[0]:undefined
        if(!range)throw new Error('PROCESS_SOURCE_HANDLE_INVALID')
        const {start,end}=range
        if(!context.catalogue.some(clause=>clause.start===start)||!context.catalogue.some(clause=>clause.end<=end&&/^[\s，,。！？!?；;、]*$/.test(context.text!.slice(clause.end,end))))throw new Error('PROCESS_SOURCE_HANDLE_INVALID')
        const clause=context.catalogue.find(clause=>clause.start===start&&clause.end===end)
        if(clause)selectedClauses.set(record,clause)
      }
      return
    }
    // A conflicting literal source is rejected, never silently overwritten.
    if(Object.keys(source).length!==1)throw new Error('PROCESS_SOURCE_HANDLE_INVALID')
    const clause=resolveClause(context.catalogue,source.clauseId)
    if(!clause)throw new Error('PROCESS_SOURCE_HANDLE_INVALID')
    selectedClauses.set(record,clause)
    processSourceSelections.set(record,clause.clauseId)
    record.source=clauseMessageSource(context.messageId,clause)
  }
  resolve(turn.event?.target)
  if(turn.event?.action?.source?.clauseId!==undefined)resolve(turn.event.action)
  for(const entries of [turn.event?.nodes,turn.event?.corrections,turn.event?.matterReports,turn.background])if(Array.isArray(entries))for(const entry of entries)resolve(entry)
  const matterReports=turn.event?.matterReports
  const supportedReports=[]
  for(const report of matterReports??[]){
    const clause=selectedClauses.get(report)
    if(!clause||clause.quoted||clause.code||clause.conditional||clause.attributedToOther)throw new Error('MATTER_REPORT_SOURCE_INVALID')
    if(clause.interrogative){
      if(!context.omitQuestionMatterReports)throw new Error('MATTER_REPORT_SOURCE_INVALID')
      onNormalization?.('unsupported_optional_matter_report_dropped')
      continue
    }
    if(wholeStepChoice(clause)==='accepted'&&report.state!==null&&report.state!=='accepted'){
      report.state=null
      report.choice='accepted'
      report.resumed=false
      onNormalization?.('reported_step_choice_without_execution')
    }
    supportedReports.push(report)
    // A reported state is already a source-backed assertion. Project that
    // source through the same fact normalization below, without making the
    // model duplicate its clause selection in growthUpdates and factRefs.
    if(context.canonicalFacts===false)continue
    turn.event.nodes??=[]
    if(!turn.event.nodes.some((node:any)=>node.kind==='fact'&&processSourceSelections.get(node)===clause.clauseId)){
      const fact={kind:'fact',source:report.source}
      selectedClauses.set(fact,clause);processSourceSelections.set(fact,clause.clauseId)
      turn.event.nodes.push(fact)
    }
  }
  if(Array.isArray(matterReports))turn.event.matterReports=supportedReports
  // Compatibility outputs can still contain direct facts. Normalize those
  // through the SAME canonical authority instead of keeping a second write
  // path. A legacy fact says only "reported context", never a guessed ability.
  if(context.canonicalFacts===false)return
  if(Array.isArray(turn.event?.nodes)){
    const nodes:unknown[]=[]
    const emitted=new Set<string>()
    for(const node of turn.event.nodes){
      if(node?.kind!=='fact'){nodes.push(node);continue}
      const quote=node.source.quote as string
      const selected=selectedClauses.get(node)
      const start=context.text?.indexOf(quote)
      const clauses=selected?[selected]:context.catalogue.filter(clause=>start!==undefined?clause.start>=start&&clause.end<=start+quote.length:quote===clause.text)
      if(!clauses.length)throw new Error('PROCESS_SOURCE_HANDLE_INVALID')
      if(turn.growthUpdates!==undefined&&!Array.isArray(turn.growthUpdates))throw new Error('PROCESS_FACT_REFERENCE_INVALID')
      turn.growthUpdates??=[]
      for(const clause of clauses){
        if(emitted.has(clause.clauseId)){
          const prior=nodes.find((entry:any)=>entry?.kind==='fact'&&processSourceClauseId(entry)===clause.clauseId) as object|undefined
          if(prior)processFactReferences.set(prior,[...new Set([...processFactReferences.get(prior)??[],...processFactReferences.get(node)??[]])])
          continue
        }
        emitted.add(clause.clauseId)
        if(!turn.growthUpdates.some((fact:any)=>fact.assertion==='user_reported'&&fact.source?.clauseId===clause.clauseId)){
           if(turn.growthUpdates.length>=8&&!context.hostFactClauses?.has(clause.clauseId))throw new Error('PROCESS_FACT_REFERENCE_INVALID')
          turn.growthUpdates.push({target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:clause.clauseId}})
        }
        const fact={kind:'fact',source:clauseMessageSource(context.messageId,clause)}
        processSourceSelections.set(fact,clause.clauseId)
        processFactReferences.set(fact,processFactReferences.get(node)??turn.growthUpdates.flatMap((entry:any,index:number)=>entry.assertion==='user_reported'&&entry.source?.clauseId===clause.clauseId?[index]:[]))
        nodes.push(fact)
      }
    }
    turn.event.nodes=nodes
  }
}

// An experience candidate may span several clauses; the accepted quote is the
// exact server-owned text from the first to the last selected clause and the
// selection must be contiguous in the message.
export function resolveContiguousClauseRange(sourceText:string,catalogue:readonly ClauseHandle[],clauseIds:readonly string[]):{quote:string;start:number;end:number}|null{
  if(!clauseIds.length||clauseIds.length>8)return null
  const resolved=clauseIds.map(id=>resolveClause(catalogue,id))
  if(resolved.some(handle=>!handle))return null
  const indexes=resolved.map(handle=>catalogue.indexOf(handle!))
  for(let index=1;index<indexes.length;index++)if(indexes[index]!==indexes[index-1]!+1)return null
  const first=resolved[0]!,last=resolved[resolved.length-1]!
  if(first.start>last.end)return null
  return {quote:sourceText.slice(first.start,last.end),start:first.start,end:last.end}
}
