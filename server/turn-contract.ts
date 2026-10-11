// Turn contract slimming: the provider schema and the system-prompt rule
// sections are derived from what THIS turn can actually produce. A field the
// turn cannot use is unrepresentable in the native schema (never a prompt
// "don't use this"), and mode-specific guidance is appended only when its
// lane is open. Server authority (clause handles, correct intent, plan
// minutes/basis, method claimId resolution) is untouched — this layer only
// narrows what the model is offered.

import { actionCoachTurnSchema } from './action-coach-contracts.ts'
import { scanUserClauses,currentConversationOnly,conversationPreferenceClause,refusalPreferenceClause,scopedTaskPauseClause } from './user-command-spans.ts'
import {deliverableIntent} from './action-coach-events.ts'

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
    if(/^(?:我|本人)(?:愿意|打算|准备|计划|想|希望)(?:先)?(?:试|尝试|整理|开始|问|做|复习)/.test(clause.text))continue
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
const anchorablePersonalClauses=(text:string)=>scanUserClauses(text).filter(clause=>!clause.interrogative&&!clause.conditional&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&!clause.quoteSpans.length)
export function negativePersonalFactClauses(text:string){
  const own=anchorablePersonalClauses(text)
  return own.filter(clause=>negativePersonalFact.test(clause.text)||
    (/^(?:目前|现在|暂时|也)?(?:没(?:有)?|尚未|未)(?:客户|接过单|接单)/.test(clause.text)&&own.some(c=>c.sentenceStart===clause.sentenceStart&&/我|本人/.test(c.text)))||
    (/^(?:但|也)?(?:还|仍)?(?:没(?:有)?|尚未|还未|未)(?:开始|动手|问|访谈|联系|回答|复习|准备|完成)/.test(clause.text)&&own.some(c=>c.sentenceStart===clause.sentenceStart&&/我|本人/.test(c.text))))
}
export function resourceBlockedPersonalFactClauses(text:string){
  // BS_RESOURCE_01: only an explicit resource of the speaker's current course.
  // This records their report, never a website diagnosis or a completed action.
  return anchorablePersonalClauses(text).filter(clause=>/^(?:我的|我这门课的|这门课的|这次课程的).{0,16}(?:材料|教材|课件|资料|链接|网页).{0,6}(?:无法打开|打不开)/.test(clause.text))
}

export function reportedTaskBoundaryClauses(text:string){
 const clauses=anchorablePersonalClauses(text)
 return clauses.filter(clause=>refusalPreferenceClause(clause.text)
  ||scopedTaskPauseClause(clause.text)
  ||(/^(?:但)?第[一二三四五六七八九十\d]+(?:道|个)?题(?:还是|还)?(?:不会做|不会|不懂|没思路|没有思路|不知道从哪里下手)$/.test(clause.text)
   &&clauses.some(other=>other.sentenceStart===clause.sentenceStart&&/(?:我|本人)/.test(other.text))))
}

export function reportedTaskOutcomeClauses(text:string,continuingOwnedTask=false){
  const clauses=scanUserClauses(text).filter(c=>!c.interrogative&&!c.conditional&&!c.quoted&&!c.code&&!c.quoteSpans.length)
  // An actual task of the speaker must precede any participant observation.
  // Reported speech by that participant stays a report, never a verified effect.
  if(!continuingOwnedTask&&!clauses.some(c=>!c.attributedToOther&&/(?:我|本人).{0,30}(?:请教|联系|发送|发了|交付|交给|提交|访谈|聊过|问了|问过)/.test(c.text)))return []
  return clauses.filter(c=>/^(?:对方|客户|学长|导师|他们|她们|他|她)(?:说|回答|回复)[^，。！？]{1,200}$/.test(c.text)||(/^(?:对方|客户|学长|导师|他们|她们|他|她|费用)?(?:说|觉得)?(?:[一二三四五六七八九十两\d]+(?:天|周|小时|分钟))?(?:已经|还|仍|也|但|并|是否|没有|尚未|未|没|觉得|听起来|看过|读过|已读|有兴趣)/.test(c.text)&&/(?:读了|读过|看过|已读|回复|回应|没回|采用|使用|用了|用过|会不会用|没用|付款|付费|付钱|没付|感兴趣|有兴趣|有意思)/.test(c.text)))
}
export function reportedPerformedTaskClauses(text:string){
 return anchorablePersonalClauses(text).filter(c=>/(?:我|本人)/.test(c.text)&&/(?:发出去了|发了|交给.{0,10}了|交付了|提交了|问了|问过|聊过|访谈了|已经尝试|尝试了|试做了|开始尝试)/.test(c.text)&&!/(?:想|打算|准备|如果|还没|没有|尚未|未曾|没)(?:.{0,8})(?:发出|发了|交给|交付|提交|问|聊|访谈|尝试|试做)/.test(c.text))
}
export function requestedQuestionEditClauses(text:string){
 const clauses=scanUserClauses(text)
 return clauses.filter(c=>!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther&&/^(?:我想把(?:验证问题|访谈问题|提问|这个问题)|把(?:上次的|这个)?问题)改成/.test(c.text)).map(first=>{
   const same=clauses.filter(c=>c.start>=first.start&&c.sentenceStart===first.sentenceStart)
   const last=same.at(-1)??first
   return {...first,end:last.end,text:text.slice(first.start,last.end)}
 })
}
export function reportedAdoptionClauses(text:string){
 return anchorablePersonalClauses(text).filter(c=>/^我(?:愿意|(?:先)?准备|打算|决定)(?:先)?(?:试|尝试|问|整理)|^(?:先从|那先).{1,30}(?:开始|整理)/.test(c.text))
}
// Readback of guarded participant reports. Missing dimensions stay unknown;
// these defaults are not newly asserted personal facts or questions to ask.
export function taskOutcomeReadback(text:string,authorizedQuotes?:ReadonlySet<string>,continuingOwnedTask=false){
 const clauses=reportedTaskOutcomeClauses(text,continuingOwnedTask).filter(c=>!authorizedQuotes||authorizedQuotes.has(c.text)),dimensions=['read','response','adoption','payment','effect'] as const
 const result=Object.fromEntries(dimensions.map(k=>[k,{status:'unknown',quote:null as string|null}])) as Record<typeof dimensions[number],{status:string;quote:string|null}>
 for(const c of clauses){
  const q=c.text
  if(/读了|读过|看过|已读/.test(q))result.read={status:'reported_read',quote:q}
  if(/(?:没(?:有)?|尚未|还未|未)(?:回复|回应)|没回/.test(q))result.response={status:'reported_no_response',quote:q}
  else if(/^(?:对方|客户|学长|导师|他们|她们|他|她)(?:说|觉得)/.test(q)||/(?:已经|已)(?:回复|回应)|回复了|回应了/.test(q))result.response={status:'reported_response',quote:q}
  if(/(?:没(?:有)?|尚未|还未|未).{0,6}(?:采用|使用|用过|用了)|还没用/.test(q))result.adoption={status:'reported_not_used',quote:q}
  else if(/(?:已经|已).{0,3}(?:采用|使用|用了)/.test(q))result.adoption={status:'reported_used',quote:q}
  if(/(?:没(?:有)?|尚未|还未|未)(?:付款|付费|付)|还没付/.test(q))result.payment={status:'reported_unpaid',quote:q}
  else if(/(?:已经|已).{0,3}(?:付款|付费)|付了/.test(q))result.payment={status:'reported_paid',quote:q}
 }
 return result
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
  const hasPersonalFact=negativePersonalFactClauses(input.text).length>0||resourceBlockedPersonalFactClauses(input.text).length>0||clauses.some(clause=>!clause.interrogative&&!clause.conditional&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&!conversationPreferenceClause(clause.text)&&!/^(?:请)?只(?:按|依据|区分|回顾|说明|回答)/.test(clause.text)&&factBearingClause.test(clause.text))
  const supportOnly=currentConversationOnly(input.text)
  // A how-to/method/recommendation question is knowledge-seeking: the
  // citations lane must stay open even though no personal fact is asserted.
  const knowledgeSeeking=/怎么(?:开始|做|弄|写|准备|验证|提升|学)|有什么[^，。？]{0,8}(?:方法|办法|方式|技巧|建议|路子)|如何(?:开始|做|验证|准备|提升|学)|有哪些|推荐(?:一?下|几个)?(?:方?法|东西|书|课)?|什么(?:是|叫)|区别|对比/.test(input.text)
  const questionDominated=!knowledgeSeeking&&(/[？?]/.test(input.text)||clauses.some(clause=>clause.interrogative))&&!hasPersonalFact&&!personalEventReport.test(input.text)
  const trimmed=input.text.trim()
  const pauseBoundaryQuestion=clauses.some(clause=>clause.interrogative&&/^是不是(?:等于|意味着)/.test(clause.text))&&clauses.every(clause=>clause.interrogative||/^暂停[^，。！？]{1,25}(?:这|一)(?:周|天|个月)$/.test(clause.text))
  const replyOnlyShape=pauseBoundaryQuestion||allInterrogative||questionDominated||greetingOnly.test(trimmed)||(metaMemoryQuery.test(trimmed)&&/[？?]\s*$/.test(trimmed))||listeningOnly.test(trimmed)
  const eventLane=(input.currentEventExists&&!replyOnlyShape)||personalEventReport.test(input.text)
  // A pure-listening turn never carries plan/material/event intent by
  // definition; a question can still be a plan request, so plan intent wins.
  const replyOnly=supportOnly?!hasPersonalFact:replyOnlyShape&&!input.planIntent&&!input.material&&!eventLane&&input.knowledgeCount===0
  const newMaterialFacts=input.material&&clauses.some(clause=>!clause.interrogative&&!clause.conditional&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&!deliverableIntent(clause.text,'create')&&factBearingClause.test(clause.text))
  const capabilities:TurnContractCapabilities={
    growth:!replyOnly&&(!input.material||newMaterialFacts||personalEventReport.test(input.text)),
    candidate:!supportOnly&&!replyOnly&&!input.planIntent&&personalEventReport.test(input.text),
    plan:!supportOnly&&input.planIntent,
    citations:!supportOnly&&!replyOnly&&input.knowledgeCount>0,
    // material output lives in event.action, so a material turn always
    // opens the event structure.
    event:!supportOnly&&!replyOnly&&(eventLane||input.material),
    material:!supportOnly&&input.material,
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
export function bindPlanBudgetSchema(contract:TurnContract,budget:{minutes:number;period:string}|undefined,currentText=''):TurnContract{
 if(!budget||!contract.capabilities.plan)return contract
 const schema=structuredClone(contract.schema) as any
 const plan=schema.properties.weeklyPlan
 schema.required=[...new Set([...(schema.required??[]),'weeklyPlan'])]
 plan.properties.availableMinutes={type:'integer',enum:[budget.minutes]}
 plan.properties.period={type:'string',enum:[budget.period]}
 if(budget.minutes>0)plan.properties.items.minItems=1
 if(budget.minutes>1&&/课程/.test(currentText)&&/备考|考试复习|复习/.test(currentText)){
  const courseMinutes=Math.floor(budget.minutes/2)
  plan.properties.items.enum=[[
   {action:'课程：核对当前必须完成的任务与截止，先处理其中最紧要的一项',minutes:courseMinutes,directionScopes:[]},
   {action:'备考：沿用当前进度，尝试一个具体题目或步骤并记录受阻处',minutes:budget.minutes-courseMinutes,directionScopes:[]},
  ]]
 }
 if(budget.minutes===0){
  plan.properties.items.maxItems=0
  schema.properties.reply={type:'string',enum:[budget.period==='next_week'?'下周没有可用时间，先不安排课程或备考任务；等可用时间改变后再调整。':'当前安排的时段没有可用时间，先不安排课程或备考任务；等可用时间改变后再调整。']}
 }
 return {...contract,schema,schemaChars:JSON.stringify(schema).length}
}
