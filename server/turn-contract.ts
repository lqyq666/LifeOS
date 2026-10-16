// One ordinary contract with composable optional outputs. User controls,
// requested time arrangements and authorized sources narrow capabilities;
// legacy mode names are retained only for callers reading old contracts.

import { actionCoachTurnSchema } from './action-coach-contracts.ts'
import { scanUserClauses,currentConversationOnly,refusalPreferenceClause,scopedTaskPauseClause,assistantRequestClause } from './user-command-spans.ts'
import {requiresImmediateMaterial,deliverableIntent} from './action-coach-events.ts'
import {requiresPlanSlack} from './weekly-plans.ts'

export type TurnContractMode='ordinary'|'reply_only'|'reply_growth'|'event'|'knowledge'|'planning'|'material'
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

// Compatibility evidence helper; ordinary capabilities do not depend on it.
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

const negativePersonalFact=/^(?:这次|这周|本周|最近)?我(?:目前|现在|暂时|还|仍|一直|并|从来)?(?:没(?:有)?|尚未|还未|未|不)(?:开始|做|学|复习|准备|完成|交付|发送|收到|拿到|有|想|愿意|打算|决定|能)/
const anchorablePersonalClauses=(text:string)=>scanUserClauses(text).filter(clause=>!clause.interrogative&&!clause.conditional&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&!clause.quoteSpans.length)
const embeddedOtherActorAction=(text:string)=>/(?:我|本人).{0,15}(?:让|看到|看见|听说|知道|发现|听到|要求|请(?!教)|确认|得知|获悉|收到).{0,15}(?:同学|学长|学姐|导师|老师|客户|朋友|对方|他|她)/.test(text)
export function negativePersonalFactClauses(text:string){
  const own=anchorablePersonalClauses(text)
  return own.filter(clause=>negativePersonalFact.test(clause.text)||
    (/^(?:目前|现在|暂时|也)?(?:没(?:有)?|尚未|未)(?:客户|接过单|接单)/.test(clause.text)&&own.some(c=>c.sentenceStart===clause.sentenceStart&&/我|本人/.test(c.text)))||
    (/^(?:但|也|目前|现在)?(?:还|仍)?(?:没(?:有)?|尚未|还未|未)(?:开始|动手|问|访谈|联系|回答|复习|准备|完成)/.test(clause.text)&&own.some(c=>c.sentenceStart===clause.sentenceStart&&/我|本人/.test(c.text)))||
    (/^(?:但|也)?(?:还)?(?:没(?:有)?|尚未|未)人(?:承诺|答应)(?:使用|采用|用)/.test(clause.text)&&own.some(c=>c.sentenceStart===clause.sentenceStart&&/我|本人/.test(c.text))))
}
export function reportedPursuitClauses(text:string){
 const own=anchorablePersonalClauses(text)
 return own.filter(clause=>/^(?:(?:我|本人)想(?:先)?(?:要|用|了解)|想(?:要|用|了解))/.test(clause.text)&&own.some(other=>other.sentenceStart===clause.sentenceStart&&/(?:我|本人)/.test(other.text)))
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
  ||(/^(?:但)?(?:我的(?:课程|作业)?)?第[一二三四五六七八九十\d]+(?:道|个)?题(?:还是|还)?(?:不会做|不会|不懂|没思路|没有思路|不知道从哪里下手)$/.test(clause.text)
   &&clauses.some(other=>other.sentenceStart===clause.sentenceStart&&/(?:我|本人)/.test(other.text))))
}

export function reportedTaskOutcomeClauses(text:string,continuingOwnedTask=false){
  const clauses=scanUserClauses(text).filter(c=>!c.interrogative&&!c.conditional&&!c.quoted&&!c.code&&!c.quoteSpans.length)
  // An actual task of the speaker must precede any participant observation.
  // Reported speech by that participant stays a report, never a verified effect.
  if(!continuingOwnedTask&&!clauses.some(c=>!c.attributedToOther&&/(?:我|本人).{0,30}(?:请教|联系|发送|发了|交付|交给|提交|访谈|聊过|问了|问过)/.test(c.text)))return []
  return clauses.filter(c=>/^(?:对方|客户|学长(?:[\u4e00-\u9fa5A-Z]{1,3})?|学姐(?:[\u4e00-\u9fa5A-Z]{1,3})?|导师(?:[\u4e00-\u9fa5A-Z]{1,3})?|他们|她们|他|她)(?:说|回答|回复)[^，。！？]{1,200}$/.test(c.text)||(/^(?:对方|客户|学长(?:[\u4e00-\u9fa5A-Z]{1,3})?|学姐(?:[\u4e00-\u9fa5A-Z]{1,3})?|导师(?:[\u4e00-\u9fa5A-Z]{1,3})?|他们|她们|他|她|费用)?(?:说|觉得)?(?:[一二三四五六七八九十两\d]+(?:天|周|小时|分钟))?(?:已经|还|仍|也|但|并|是否|没有|尚未|未|没|觉得|听起来|看过|读过|已读|有兴趣)/.test(c.text)&&/(?:读了|读过|看过|已读|回复|回应|没回|采用|使用|用了|用过|会不会用|没用|付款|付费|付钱|没付|感兴趣|有兴趣|有意思)/.test(c.text)))
}
export function reportedPerformedTaskClauses(text:string){
 return anchorablePersonalClauses(text).filter(c=>!embeddedOtherActorAction(c.text)&&/(?:我|本人)/.test(c.text)&&/(?:发出去了|发出了|发出(?:那个|这个)?(?:问题|消息|邮件|资料|材料)了|发了|交给.{0,10}了|交付了|提交了|问了|问过|聊过|访谈了|已经尝试|尝试了|试做了|开始尝试)/.test(c.text)&&!/(?:想|打算|准备|计划|希望|考虑|愿意|决定|如果|还没|没有|尚未|未曾|没)(?:.{0,40})(?:发出|发了|交给|交付|提交|问|聊|访谈|尝试|试做)/.test(c.text))
}
// Reuse the ownership/intent guards; an attempt or a channel noun is not a send.
export function reportedCompletedContactClauses(text:string){
 return anchorablePersonalClauses(text).filter(c=>!embeddedOtherActorAction(c.text)&&/^(?:(?:昨天|今天|刚才|后来|之后)\s*)?(?:我|本人)/.test(c.text)&&/(?:发出去了|发出了|发出(?:那个|这个)?(?:问题|消息|邮件|资料|材料)了|发了(?:.{0,20})(?:邮件|消息|问题)|联系了|发送了)/.test(c.text)&&!/(?:想|打算|准备|计划|希望|考虑|愿意|决定|还没|没有|尚未|未曾|没|尝试|试做).{0,40}(?:发出|发了|联系|发送)/.test(c.text))
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
 const result=Object.fromEntries(dimensions.map(k=>[k,{status:'unknown',quote:null as string|null}])) as Record<typeof dimensions[number],{status:string;quote:string|null;conflicting?:boolean}>
 for(const c of clauses){
  const q=c.text
  const negativeRead=/(?:没(?:有)?|尚未|还未|未).{0,6}(?:读|看)(?:了|过)?/g,negativeResponse=/(?:没(?:有)?|尚未|还未|未)(?:回复|回应)|没回/g
  const readNo=q.match(negativeRead)!==null,readYes=/读了|读过|看过|已读/.test(q.replace(negativeRead,''))
  const responseNo=q.match(negativeResponse)!==null,responseYes=/^(?:对方|客户|学长|导师|他们|她们|他|她)(?:说|觉得)/.test(q)||/(?:已经|已)(?:回复|回应)|回复了|回应了/.test(q.replace(negativeResponse,''))
  if(readNo&&readYes)result.read={status:'unknown',quote:null,conflicting:true}
  else if(readNo)result.read={status:'reported_not_read',quote:q}
  else if(readYes)result.read={status:'reported_read',quote:q}
  if(responseNo&&responseYes)result.response={status:'unknown',quote:null,conflicting:true}
  else if(responseNo)result.response={status:'reported_no_response',quote:q}
  else if(responseYes)result.response={status:'reported_response',quote:q}
  if(!/承诺|打算|计划|是否|会不会/.test(q)&&/(?:没(?:有)?|尚未|还未|未).{0,6}(?:采用|使用|用过|用了)|还没用/.test(q))result.adoption={status:'reported_not_used',quote:q}
  else if(/(?:已经|已).{0,3}(?:采用|使用|用了)/.test(q))result.adoption={status:'reported_used',quote:q}
  if(/(?:没(?:有)?|尚未|还未|未)(?:付款|付费|付)|还没付|没人(?:采用|使用)(?:或|和|也|、)(?:付款|付费)/.test(q))result.payment={status:'reported_unpaid',quote:q}
  else if(/(?:已经|已).{0,3}(?:付款|付费)|付了/.test(q))result.payment={status:'reported_paid',quote:q}
 }
 return result
}

export function deriveTurnContract(input:{
  text:string
  knowledgeCount:number
  knowledgeIds?:readonly string[]
  requiredKnowledgeCitation?:boolean
  currentEventExists:boolean
  planIntent:boolean
  material:boolean
  readOnly?:boolean
}):TurnContract{
  // Ordinary generation offers composable outputs. Only explicit user controls,
  // requested planning and available sources narrow the contract; legacy modes
  // never classify a sentence and close another legitimate output lane.
  const supportOnly=currentConversationOnly(input.text)
  const capabilities:TurnContractCapabilities={
    growth:!input.readOnly,
    // Experience extraction and star-map updates are program-owned. The main
    // model need not generate a second copy of the same autobiographical span.
    candidate:false,
    plan:!input.readOnly&&!supportOnly&&input.planIntent,
    citations:!input.readOnly&&!supportOnly&&input.knowledgeCount>0,
    event:!input.readOnly&&!supportOnly,
    material:!input.readOnly&&!supportOnly,
  }
  const schema=slimActionCoachSchema(capabilities)
  if(capabilities.citations&&input.knowledgeIds){
    // Generation selects from this turn's approved cards. The shared citation
    // validator still owns revision, scope and withdrawal checks at commit.
    const citations=(schema.properties as Record<string,any>).citations
    citations.items={type:'object',properties:{claimId:{type:'string',enum:[...new Set(input.knowledgeIds)]}},required:['claimId'],additionalProperties:false}
    if(input.requiredKnowledgeCitation){citations.minItems=1;(schema.required as string[]).push('citations')}
  }
  return {mode:'ordinary',capabilities,schema,schemaChars:JSON.stringify(schema).length}
}

export function slimActionCoachSchema(capabilities:TurnContractCapabilities):Record<string,unknown>{
  const schema=structuredClone(actionCoachTurnSchema) as unknown as {
    properties:Record<string,unknown>
    required?:string[]
  }
  const properties=schema.properties
  const action=(properties.event as any)?.properties?.action
  for(const branch of action?.anyOf??[]){
    for(const draft of branch.properties?.draft?.anyOf??[]){
      for(const key of ['readiness','missingRequired','materialFactIds','materialEvidence'])if(draft.properties)delete draft.properties[key]
    }
  }
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

// Explicit delivery requests must instantiate an artifact, never a bare
// presentation prefix. Clarifications remain legal for incomplete requests.
export function bindMaterialDeliverySchema(contract:TurnContract,text:string,groundedSelection=false,replyBody:boolean|'question_first'=false):TurnContract{
  const quotes=[...new Set(scanUserClauses(text).map(clause=>clause.text).filter(Boolean))]
  const bindQuotes=(node:any)=>{
    if(!node||typeof node!=='object')return
    if(node.properties?.messageId&&node.properties?.quote)node.properties.quote={...node.properties.quote,enum:quotes}
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(bindQuotes);else if(value&&typeof value==='object')bindQuotes(value)
  }
  if(quotes.length)bindQuotes((contract.schema.properties as any)?.event)
  if(groundedSelection){
    // Do not spend material generation on command nodes that validation would
    // discard. The event target may still cite the request; real feedback stays.
    const pursuitQuotes=new Set(reportedPursuitClauses(text).map(clause=>clause.text))
    const reportedQuotes=quotes.filter(quote=>!assistantRequestClause(quote)&&!pursuitQuotes.has(quote))
    const nodes=(contract.schema.properties as any)?.event?.properties?.nodes
    // Intent-only drafting has no new process report. The original intent
    // remains in target/process input sources and the personal growth lane.
    if(nodes&&!reportedQuotes.length)delete (contract.schema.properties as any).event.properties.nodes
    // A saved real response repeated the same report ten times before reaching
    // its artifact and was aborted by the provider. This material lane needs
    // at most one process node per report and one critical unknown; complete
    // source text and the authoritative event history remain available.
    if(nodes)nodes.maxItems=Math.min(nodes.maxItems??24,reportedQuotes.length+1)
    if(nodes?.items?.anyOf)nodes.items.anyOf=nodes.items.anyOf.filter((node:any)=>{
      if(!node.properties?.source)return true
      if(!reportedQuotes.length)return false
      node.properties.source.properties.quote={...node.properties.source.properties.quote,enum:reportedQuotes}
      return true
    })
  }
  const action=(contract.schema.properties as any)?.event?.properties?.action
  if(!groundedSelection)for(const branch of action?.anyOf??[]){
    const draft=branch.properties?.draft
    if(draft?.anyOf)draft.anyOf=draft.anyOf.filter((format:any)=>format.properties?.kind?.const!=='resume_portfolio')
  }
 if(!contract.capabilities.material||!requiresImmediateMaterial(text))return {...contract,schemaChars:JSON.stringify(contract.schema).length}
 const schema=structuredClone(contract.schema) as any,event=schema.properties.event
 // The material body has its own validated field and is rendered once by the
 // host. A mandatory nonempty reply makes the model generate it a second time.
 schema.properties.reply={type:'string',minLength:0,maxLength:160,description:'完整材料只写在event.action.draft；没有额外必要的反馈、提醒或未知时reply用空字符串，不重复材料正文，也不宣布已写好。混合复盘可保留必要回应。'}
 schema.required=[...new Set([...(schema.required??[]),'event'])]
 event.required=[...new Set([...(event.required??[]),'action'])]
 event.properties.action.anyOf=event.properties.action.anyOf.filter((branch:any)=>branch.properties?.draft)
 if(replyBody==='question_first'){
  // Use the original canonical material field; put it before explanatory text
  // so a safe question can stream without waiting for readback/state metadata.
  for(const branch of event.properties.action.anyOf)branch.properties={draft:branch.properties.draft,...Object.fromEntries(Object.entries(branch.properties).filter(([key])=>key!=='draft'))}
  event.properties={action:event.properties.action,...Object.fromEntries(Object.entries(event.properties).filter(([key])=>key!=='action'))}
  schema.properties={event,...Object.fromEntries(Object.entries(schema.properties).filter(([key])=>key!=='event'))}
  schema.properties.reply={type:'string',minLength:1,maxLength:1000,description:'回应本轮读回事实、时间和未知，不重复draft.content中的材料问题。'}
 }else if(replyBody&&!groundedSelection){
  schema.properties.reply={type:'string',minLength:1,maxLength:12000,description:'本轮reply就是完整可使用的材料正文，不另写介绍、已完成声明或第二份正文。draft仅返回fromReply:true，服务器将同一正文保存为材料。'}
  for(const branch of event.properties.action.anyOf)branch.properties.draft={type:'object',properties:{fromReply:{type:'boolean',const:true}},required:['fromReply'],additionalProperties:false}
 }

 return {...contract,schema,schemaChars:JSON.stringify(schema).length}
}

export function requestsSingleQuestionMaterial(text:string){
 return scanUserClauses(text).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!clause.quoteSpans.length&&!clause.codeSpans.length&&deliverableIntent(clause.text,'create')&&/(?:一句|一个)[^。！？\n]{0,32}(?:问题|提问)/.test(clause.text))
}

// The authoritative obligation has already resolved the student's current
// event and week. Constrain generation before dispatch; never discard illegal
// model tasks after the fact or ask the student to confirm an explicit zero.
export function bindPlanBudgetSchema(contract:TurnContract,budget:{minutes:number;period:string}|undefined,currentText='',allowedPlanScopes?:readonly string[]):TurnContract{
 if(!budget||!contract.capabilities.plan)return contract
 const schema=structuredClone(contract.schema) as any
 const plan=schema.properties.weeklyPlan
 schema.required=[...new Set([...(schema.required??[]),'weeklyPlan'])]
 plan.properties.availableMinutes={type:'integer',enum:[budget.minutes]}
 plan.properties.period={type:'string',enum:[budget.period]}
 if(budget.minutes>0){
  plan.properties.items.minItems=1
  plan.properties.items.items.properties.action.description='用中文写用户实际请求的课程、复习或探索任务，不写字段名或英文代号。休息和缓冲是未安排时间，不列为任务。'
  // Reuse the existing finite plan lane for this explicit pair of requested
  // tasks. No other task or direction is inferred from generic "备考".
  if(scanUserClauses(currentText).some(clause=>!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&/^(?:请)?(?:帮我)?安排课程作业(?:和|及|、)复习$/.test(clause.text))){
   plan.properties.items.items.properties.action.enum=['课程作业','复习']
   plan.properties.items.minItems=2
   plan.properties.items.maxItems=2
  }
  plan.properties.items.items.properties.directionScopes.description='只有实际属于该方向的任务才标注；普通课程作业用空数组，不把课程或一般备考自动标为专升本或考研。'
  if(allowedPlanScopes){
   const scopes=plan.properties.items.items.properties.directionScopes
   const choices=(scopes.items.enum??scopes.items.anyOf?.map((item:{const:string})=>item.const)??[]) as string[]
   const permitted=choices.filter(scope=>allowedPlanScopes.includes(scope))
   scopes.items=permitted.length?{type:'string',enum:permitted}:{type:'string'}
   scopes.maxItems=permitted.length
  }
  if(requiresPlanSlack(currentText)){
   plan.description=`本人明确不要排满：可用${budget.minutes}分钟，items中的任务分钟合计至多${budget.minutes-1}分钟。休息/缓冲保留在任务列表外，由服务器显示未安排量。`
   plan.properties.items.items.properties.minutes.maximum=budget.minutes-1
  }
 }
 if(budget.minutes>0)schema.properties.reply={type:'string',minLength:1,maxLength:160,description:'简短说明取舍、实际反馈或未知；具体时间只在weeklyPlan展示，不另写数字日程。'}
 if(budget.minutes===0){
  plan.properties.items.maxItems=0
  schema.properties.reply={type:'string',enum:[budget.period==='next_week'?'下周没有可用时间，先不安排课程或备考任务；等可用时间改变后再调整。':'当前安排的时段没有可用时间，先不安排课程或备考任务；等可用时间改变后再调整。']}
 }
 return {...contract,schema,schemaChars:JSON.stringify(schema).length}
}
