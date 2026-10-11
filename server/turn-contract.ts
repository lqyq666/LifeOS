// Turn contract slimming: the provider schema and the system-prompt rule
// sections are derived from what THIS turn can actually produce. A field the
// turn cannot use is unrepresentable in the native schema (never a prompt
// "don't use this"), and mode-specific guidance is appended only when its
// lane is open. Server authority (clause handles, correct intent, plan
// minutes/basis, method claimId resolution) is untouched — this layer only
// narrows what the model is offered.

import { actionCoachTurnSchema } from './action-coach-contracts.ts'
import { scanUserClauses } from './user-command-spans.ts'

export type TurnContractMode='reply_only'|'reply_growth'|'event'|'knowledge'|'planning'|'material'
export type TurnContractCapabilities={
  growth:boolean
  candidate:boolean
  plan:boolean
  citations:boolean
  event:boolean
  material:boolean
}
export type TurnContract={
  mode:TurnContractMode
  capabilities:TurnContractCapabilities
  // Slimmed clone of the full action-coach schema; a deleted lane is
  // unrepresentable, everything kept is byte-identical to the full contract.
  schema:Record<string,unknown>
  schemaChars:number
}

const carriesClauseText=(text:string)=>/[\p{L}\p{N}]/u.test(text)

// Deterministic reply_only shapes: pure greeting/acknowledgement, a memory
// meta query, an all-question message, or an explicit listening-only opener.
// Any plan intent, material request or personal-event report opts out.
const greetingOnly=/^(?:好的?|好呀|好嘞|好滴|嗯+|哦+|噢+|行|行的|可以|ok|OK|Okay|谢谢|感谢|辛苦了|收到|明白|了解了?|继续|加油|晚安|早安|抱抱|没问题|听你的|先这样|就这样|都行|随你)(?:[了的呀呢啊嘛吧!！。.,，,~\s]*(?:先这样|就这样|听你的|再?说)?)?(?:[了的呀呢啊嘛吧!！。.,，,~\s]*)*$/
const metaMemoryQuery=/你(?:还)?记得|我说过什么|你知道我什|记得我(?:以前|之前|上次)?说过/
const listeningOnly=/^(?:我(?:今天|现在|最近)?(?:只想|就想|只?想)(?:倾诉|聊聊|说说|吐个槽|吐槽|说点心里话|说说不开心的|发发牢骚)|我(?:今天|最近)?(?:心里|有点)(?:.{0,6}不舒服|难过|烦|累|迷茫|委屈))[^。！？]*[。！？?]?$/
// A first-person past-action report opens the event/review lane. The lexicon
// only flags CANDIDATE clauses; structure (interrogative / attributedToOther /
// conditional / quoted from scanUserClauses) decides whether the candidate is
// the USER'S OWN report — a question, a third-party report or a hypothesis
// never opens the lane.
const personalEventReportLexicon=/(?:做了|做完|做过|交了|交过|发过|发了|投过|写过|整理过|帮过|参加(?:了|过)|弄了|搞了|写了|投了|联系了|问了|试了|试过|没用上?|没效果|没结果|没坚持|卡住了?|导师说|学长说|学姐说|同学说|室友说|对方说|他们没用)/
export function reportsPersonalEvent(text:string):boolean{
  for(const clause of scanUserClauses(text)){
    if(!carriesClauseText(clause.text))continue
    // Temporal anchors alone (上次/昨天/上周…) carry no verb: they open the
    // lane only inside a clause that also reports an action by the speaker.
    if(clause.interrogative||clause.attributedToOther||clause.conditional||clause.quoted||clause.code)continue
    // A clause that merely MENTIONS a quoted statement (…这句话是什么意思)
    // discusses language, not experience; quoted spans inside it disqualify.
    if(clause.quoteSpans.length)continue
    if(personalEventReportLexicon.test(clause.text)&&(clause.text.includes('我')||clause.text.includes('本人')))return true
    if(/(?:上次|昨天|前天|上周|上个月|上学期|去年)/.test(clause.text)){
      const rest=scanUserClauses(text).slice().find(other=>other.sentenceStart===clause.sentenceStart&&personalEventReportLexicon.test(other.text)&&(other.text.includes('我')||other.text.includes('本人'))&&!other.interrogative&&!other.attributedToOther&&!other.conditional)
      if(rest)return true
    }
  }
  return false
}
const personalEventReport={test:reportsPersonalEvent}

const negativePersonalFact=/^(?:这次|这周|本周|最近)?我(?:目前|现在|暂时|还|仍|一直|并|从来)?(?:没(?:有)?|尚未|还未|未|不)(?:开始|做|学|复习|准备|完成|交付|发送|收到|拿到|有|想|愿意|打算|决定|能)/
export function negativePersonalFactClauses(text:string){
  return scanUserClauses(text).filter(clause=>!clause.interrogative&&!clause.conditional&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&!clause.quoteSpans.length&&negativePersonalFact.test(clause.text))
}

export function deriveTurnContract(input:{
  text:string
  knowledgeCount:number
  currentEventExists:boolean
  planIntent:boolean
  material:boolean
}):TurnContract{
  const clauses=scanUserClauses(input.text).filter(clause=>carriesClauseText(clause.text))
  const allInterrogative=clauses.length>0&&clauses.every(clause=>clause.interrogative)
  // A question-dominated turn (at least one question, no clause asserting a
  // first-person fact) cannot carry new personal records.
  const factBearingClause=new RegExp('我[^，。！？\\n]{0,8}(?:是|在|有|会|能|要|想|做|读|学|喜欢|决定|准备|报|考|找|投|写|交|发|参加|实习|社团|科研|项目|课|专业|大三|大四|大二|大一|研一|研二|每周|小时|岁)|[0-9一二两三四五六七八九十]+(?:小时|天|周|个月)')
  const hasPersonalFact=negativePersonalFactClauses(input.text).length>0||clauses.some(clause=>!clause.interrogative&&!clause.conditional&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&factBearingClause.test(clause.text))
  // A how-to/method/recommendation question is knowledge-seeking: the
  // citations lane must stay open even though no personal fact is asserted.
  const knowledgeSeeking=/怎么(?:开始|做|弄|写|准备|验证|提升|学)|有什么[^，。？]{0,8}(?:方法|办法|方式|技巧|建议|路子)|如何(?:开始|做|验证|准备|提升|学)|有哪些|推荐(?:一?下|几个)?(?:方?法|东西|书|课)?|什么(?:是|叫)|区别|对比/.test(input.text)
  const questionDominated=!knowledgeSeeking&&(/[？?]/.test(input.text)||clauses.some(clause=>clause.interrogative))&&!hasPersonalFact&&!personalEventReport.test(input.text)
  const trimmed=input.text.trim()
  const replyOnlyShape=allInterrogative||questionDominated||greetingOnly.test(trimmed)||(metaMemoryQuery.test(trimmed)&&/[？?]\s*$/.test(trimmed))||listeningOnly.test(trimmed)
  const eventLane=input.currentEventExists||personalEventReport.test(input.text)
  // A pure-listening turn never carries plan/material/event intent by
  // definition; a question can still be a plan request, so plan intent wins.
  const replyOnly=replyOnlyShape&&!input.planIntent&&!input.material&&!eventLane&&input.knowledgeCount===0
  const capabilities:TurnContractCapabilities={
    growth:!replyOnly,
    candidate:!replyOnly&&!input.planIntent,
    plan:input.planIntent,
    citations:!replyOnly&&input.knowledgeCount>0,
    // material output lives in event.action, so a material turn always
    // opens the event structure.
    event:!replyOnly&&(eventLane||input.material),
    material:input.material,
  }
  const mode:TurnContractMode=capabilities.material?'material'
    :capabilities.plan?'planning'
    :capabilities.citations?'knowledge'
    :capabilities.event?'event'
    :'reply_growth'
  const effectiveMode=replyOnly?'reply_only':mode
  const schema=slimActionCoachSchema(capabilities)
  return {mode:effectiveMode,capabilities,schema,schemaChars:JSON.stringify(schema).length}
}

export function slimActionCoachSchema(capabilities:TurnContractCapabilities):Record<string,unknown>{
  const schema=structuredClone(actionCoachTurnSchema) as unknown as {
    properties:Record<string,unknown>
    required?:string[]
  }
  const properties=schema.properties
  // The legacy background lane is never offered under the native growth
  // protocol regardless of mode.
  delete properties.background
  if(!capabilities.growth)delete properties.growthUpdates
  if(!capabilities.candidate)delete properties.experienceCandidate
  if(!capabilities.plan)delete properties.weeklyPlan
  if(!capabilities.citations)delete properties.citations
  if(capabilities.material){
    // The full event lane including action.draft stays byte-identical.
  }else if(capabilities.event){
    // Process/nodes/corrections without the material branch.
    const event=properties.event as {properties:Record<string,unknown>}|undefined
    if(event)delete event.properties.action
  }else{
    delete properties.event
  }
  schema.required=['reply']
  return schema as unknown as Record<string,unknown>
}

// The authoritative obligation has already resolved the student's current
// event and week. Constrain generation before dispatch; never discard illegal
// model tasks after the fact or ask the student to confirm an explicit zero.
export function bindPlanBudgetSchema(contract:TurnContract,budget:{minutes:number;period:string}|undefined):TurnContract{
 if(!budget||!contract.capabilities.plan)return contract
 const schema=structuredClone(contract.schema) as any
 const plan=schema.properties.weeklyPlan
 schema.required=[...new Set([...(schema.required??[]),'weeklyPlan'])]
 plan.properties.availableMinutes={type:'integer',enum:[budget.minutes]}
 plan.properties.period={type:'string',enum:[budget.period]}
 if(budget.minutes===0){
  plan.properties.items.maxItems=0
  schema.properties.reply={type:'string',enum:[budget.period==='next_week'?'下周没有可用时间，先不安排课程或备考任务；等可用时间改变后再调整。':'当前安排的时段没有可用时间，先不安排课程或备考任务；等可用时间改变后再调整。']}
 }
 return {...contract,schema,schemaChars:JSON.stringify(schema).length}
}
