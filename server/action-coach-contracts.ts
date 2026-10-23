import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'
import { growthDeltaSchema } from './growth-model-contracts.ts'

const text=(maxLength=16000)=>Type.String({minLength:1,maxLength})
const id=Type.String({pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'})
export const processSourceSchema=Type.Object({messageId:{...id,description:'只复制本轮currentUserMessage.id。不能把历史消息的原话重新标成本轮消息。'},quote:{...text(8000),description:'必须是本轮最后一条用户消息中的连续原文，不能引用更早消息、拼接或改写。历史事实已在事件/对话中，不重复生成到本轮新节点。'}},{additionalProperties:false})
const reportedNode=Type.Object({kind:Type.Union([Type.Literal('fact'),Type.Literal('feeling'),Type.Literal('user_interpretation')]),source:processSourceSchema},{additionalProperties:false,description:'一项当前用户陈述及其连续原话。已知旧陈述不重新生成，补充新信息使用新节点。事实、感受与用户解释分别表达。'})
const unknownNode=Type.Object({
  kind:Type.Literal('unknown'),question:text(2000),
  affects:Type.Optional(text(500)),
  reason:Type.Optional(text(500)),
  dependsOn:Type.Optional(Type.Array(id,{maxItems:8,uniqueItems:true})),
},{additionalProperties:false,description:'当前关键未知的具体问题；affects说明答案会改变哪项判断或行动，reason只写简短选问理由，dependsOn只引用同一事件仍active的上游unknown。不是隐藏思维过程。记不清的详情仍未知；不把已明确经过重新记作未知。'})
const processNode=Type.Union([reportedNode,unknownNode])
// The server creates identities and revisions. The model selects existing
// records by ID/revision only; it cannot create an ID or mark a plan executed.
const legacyDraftSchema=Type.Object({
  content:Type.String({minLength:1,maxLength:12000,description:'完整可使用成品，只生成一次；服务器将它加入正式回复并保存同一版本。不得是空字符串、空格、未完成占位或只说去执行。'}),
  goal:Type.Optional(text(2000)),
  start:Type.Optional(text(4000)),
  materials:Type.Optional(Type.Array(text(4000),{maxItems:12})),
  observable:Type.Optional(text(2000)),
  effort:Type.Optional(text(1000)),
  stopWhen:Type.Optional(text(2000)),
  readiness:Type.Optional(Type.Union([Type.Literal('template'),Type.Literal('draft_for_user_review')],{description:'由服务器渲染简历作品类材料时写入；模型不得自行填写。'})),
  missingRequired:Type.Optional(Type.Array(Type.String({maxLength:40}),{maxItems:8})),
  materialFactIds:Type.Optional(Type.Array(Type.String({maxLength:64}),{maxItems:32})),
  materialEvidence:Type.Optional(Type.Array(Type.Object({field:Type.String({maxLength:20}),text:Type.String({maxLength:4000}),sourceRef:Type.Object({type:Type.String({maxLength:20})},{additionalProperties:false})},{additionalProperties:false}),{maxItems:32})),
},{additionalProperties:false})
export const resumePortfolioDraftSchema=Type.Object({
  kind:Type.Literal('resume_portfolio'),
  selectedFactIds:Type.Array(Type.String({minLength:1,maxLength:64}),{minItems:0,maxItems:32,description:'只能从本轮growthCatalogue列出的catalogueId中选择；不得提交新文字、截断原话或宣称可直接发送。'}),
},{additionalProperties:false,description:'简历/个人介绍/作品清单类材料走证据选择：服务器核对引用并渲染内容，模板缺口如实标注。'})
export const actionDraftSchema=Type.Union([legacyDraftSchema,resumePortfolioDraftSchema])
const actionTarget={actionId:id,expectedRevision:Type.Integer({minimum:1})}
export const actionChangeSchema=Type.Union([
  Type.Object({operation:Type.Literal('create'),draft:actionDraftSchema},{additionalProperties:false}),
  Type.Object({operation:Type.Literal('modify'),...actionTarget,draft:actionDraftSchema},{additionalProperties:false}),
  Type.Object({operation:Type.Literal('reuse'),...actionTarget},{additionalProperties:false}),
  Type.Object({operation:Type.Literal('close'),...actionTarget,reason:text(2000)},{additionalProperties:false}),
],{description:'可选的实际行动变化。只交付成品时create/modify，确有现有行动才reuse/close；纯倾听、知识回答或仅追问时省略整个action，不能填空draft。'})
export const eventDeltaSchema=Type.Object({
  target:Type.Union([
    Type.Object({operation:Type.Literal('create'),title:text(200),source:processSourceSchema},{additionalProperties:false,description:'仅用于没有对应已存在事件的新事情。用户回答上轮问题、补充制作或交付细节不是新事情，不得复制当前事件的标题再创建。标题只概括已知经过，不把未使用改成未反馈或拒绝。'}),
    Type.Object({operation:Type.Literal('continue'),eventId:id,expectedRevision:Type.Integer({minimum:1})},{additionalProperties:false,description:'对currentEvent或已准确定位的events补充、回答、修正和共创时使用。必须原样取对应id/revision；nodes仅新增当前原话，既有过程由服务器保留。'}),
  ],{description:'先定位事情，再选择目标。同一事情的不同轮次共用eventId；新的用户消息不等于新的事件。'}),
  nodes:Type.Optional(Type.Array(processNode,{maxItems:24,description:'仅新增必要的实际过程变化。纯起草时，已由事件source或过程原话保留的需求和限制不再复制成fact/unknown节点；混合复盘仍保存本人新报告的行动、回应与关键未知。'})),
  corrections:Type.Optional(Type.Array(Type.Object({nodeId:id,source:processSourceSchema},{additionalProperties:false}),{maxItems:12,description:'用户实质更正已有陈述时才替换对应节点。重复旧话或补充另一个事实使用nodes，不能缩小覆盖其他旧事实。'})),
  resolveUnknowns:Type.Optional(Type.Array(id,{maxItems:24,description:'仅标记授权事件中实际已回答的对应未知问题ID；按问题与回答对应，不因本轮有任何新事实就任意选择ID。记不清仍未知。'})),
  declineUnknowns:Type.Optional(Type.Array(id,{maxItems:24,description:'仅在用户明确拒绝回答对应问题时标记该问题ID；记不清不是拒答，不标记declined，也不转移到另一个旧问题。原因不想讲可保留为declined，另一个时间记不清仍active。'})),
  action:Type.Optional(actionChangeSchema),
},{additionalProperties:false,description:'仅在本人具体事件/目标的过程或行动确有变化时使用。不是对话话题分类；纯知识、概念解释、只倾听不建立event。没有事件变化时整字段省略，不只填target来凑结构。'})
// Fix 3: the model only SELECTS which verified proposition it used (claimId =
// the knowledge entry id from authorizedContext.knowledge). The server
// resolves the real revision/claim/excerpt/scope — the model never repeats
// server-owned fields, so a paraphrased citation can no longer fail the turn.
// The legacy full form stays accepted for older outputs but is re-derived the
// same way whenever its sourceId matches an authorized card.
export const coachCitationSchema=Type.Union([
  Type.Object({claimId:id},{additionalProperties:false}),
  Type.Object({sourceId:id,revision:Type.Integer({minimum:1}),claim:text(4000),quote:text(8000),scope:text(4000)},{additionalProperties:false}),
])
export type CoachCitation=Static<typeof coachCitationSchema>
export const actionCoachTurnSchema=Type.Object({
  lead:Type.Optional(Type.String({minLength:0,maxLength:240,description:'首句预览：必须逐字等于reply第一句，不另写标题或另一种表述；不超过24个汉字，只给实际判断、具体起点或必要问题。禁止状态宣告、完成/发送/保存声明、承诺、材料正文或诊断。'})),
  reply:Type.String({minLength:1,maxLength:16000,description:'先回应本轮新增内容与实际诉求，不重复上一轮回复或已经回答的问题，不强行转问感受。只更新理解或明确不行动时不给新任务；有关键未知才问。除非本人要求展开，通常一至四句，说完即停。交付材料时这里只写必要提醒或未知边界，不引用或复写成品，不额外解释材料的作用；完整可复制文本只放event.action.draft.content，由服务器展示同一材料。'}),
  citations:Type.Optional(Type.Array(coachCitationSchema,{maxItems:6,description:'仅对确实使用的有效知识条目逐命题引用；普通追问、个人起草和倾听通常省略。不得编造来源。'})),
  event:Type.Optional(eventDeltaSchema),
  growthUpdates:Type.Optional(Type.Array(growthDeltaSchema,{maxItems:8,description:'只有当前个人情况、方向/近期判断或实际反馈新增/变化才给小粒度增量。普通知识/倾听无需建档。明确陈述与带局限的待核对AI观察分开，每条一项；不要求每轮补齐档案。'})),
  background:Type.Optional(Type.Array(Type.Object({
    key:Type.Union([Type.Literal('education.school'),Type.Literal('education.major'),Type.Literal('education.stage'),Type.Literal('skills')]),
    value:text(500),source:processSourceSchema,
  },{additionalProperties:false}),{maxItems:8,description:'仅限本人明确、稳定的教育和技能背景；教育阶段指大三、硕士等身份阶段，今晚等临时行动时间不是教育阶段。省略临时约束和事件事实。'})),
  weeklyPlan:Type.Optional(Type.Object({
    target:Type.Union([
      Type.Object({operation:Type.Literal('create')},{additionalProperties:false}),
      Type.Object({operation:Type.Literal('replace'),itemId:id,expectedRevision:Type.Integer({minimum:1})},{additionalProperties:false}),
    ]),
    availableMinutes:Type.Integer({minimum:0,maximum:10080}),
    period:Type.Union([Type.Literal('current'),Type.Literal('this_week'),Type.Literal('next_week')]),
    budgetRef:Type.Union([
      Type.Object({id,revision:Type.Integer({minimum:1})},{additionalProperties:false}),
      Type.Object({updateIndex:Type.Integer({minimum:0,maximum:7})},{additionalProperties:false}),
    ]),
    basis:Type.Array(Type.Union([
      Type.Object({id,revision:Type.Integer({minimum:1})},{additionalProperties:false}),
      Type.Object({updateIndex:Type.Integer({minimum:0,maximum:7})},{additionalProperties:false}),
    ]),{minItems:1,maxItems:12}),
    items:Type.Array(Type.Object({
      action:Type.String({minLength:1,maxLength:200}),
      minutes:Type.Integer({minimum:1,maximum:10080}),
      directionScopes:Type.Array(Type.Union([Type.Literal('employment'),Type.Literal('research_exploration'),Type.Literal('postgraduate_recommendation'),Type.Literal('postgraduate_exam'),Type.Literal('public_service'),Type.Literal('entrepreneurship'),Type.Literal('overseas_study'),Type.Literal('undergraduate_upgrade')]),{maxItems:8}),
    }),{minItems:0,maxItems:12}),
  },{additionalProperties:false,description:'仅在用户明确要求安排/修改时间安排时提供：budgetRef/basis引用本轮growthUpdates原始索引或授权id/revision；availableMinutes由服务器对照已核实预算，计划项合计不超过预算，方向不得命中已暂停范围。'})),
  // Candidates remain opt-in proposals; confirmation still uses the existing
  // experience API and is never implied by a conversation-state update.
  // P1: the source is a contiguous clauseId selection; the server owns the
  // exact verbatim span and the messageId. The structured action/result
  // fields follow the same rule — the model only names clause handles inside
  // the selected range and the server stores their verbatim text; the
  // occurred date is derived server-side from explicit words in the quote.
  experienceCandidate:Type.Optional(Type.Object({
    source:Type.Object({clauseIds:Type.Array(Type.String({pattern:'^c[0-9]{1,2}$'}),{minItems:1,maxItems:8,description:'currentUserMessage.clauses中连续的clause id，从第一句到最后一句必须相邻。'})},{additionalProperties:false}),
    action:Type.Optional(Type.Object({clauseId:Type.String({pattern:'^c[0-9]{1,2}$',description:'source范围内写本人做了什么的分句，服务器保存其精确原文；分不清就省略'})},{additionalProperties:false})),
    result:Type.Optional(Type.Object({clauseId:Type.String({pattern:'^c[0-9]{1,2}$',description:'source范围内写行动直接结果或交付状态的分句，服务器保存其精确原文；分不清就省略'})},{additionalProperties:false})),
    links:Type.Optional(Type.Array(Type.Object({valueId:Type.Union([Type.Literal('value-creation'),Type.Literal('value-autonomy'),Type.Literal('value-growth')]),reason:Type.String({maxLength:2000,description:'为什么挂这个分类：引用原话中的词语说明，不编造'})},{additionalProperties:false}),{maxItems:3,description:'经历的价值分类（value-creation创造：做出作品或方案／value-autonomy自主：自己拿主意并承担结果／value-growth成长：从反馈更新认知）。按source原话内容选最贴切的，可多选；拿不准就省略，由服务器兜底。'})),
  },{additionalProperties:false,description:'用户报告本人已发生、已完成的具体行为与结果时输出：服务器把所选原话收入星图并按links挂分类；计划、技能或他人故事不输出。'})),
},{additionalProperties:false,description:'reply是唯一必填字段。其余字段仅表示真实必要变化；知识或倾听可以只有reply。可选不是要求每轮创建对象，省略未发生的变化，不填空对象或空文案。'})
export type ActionCoachTurn=Static<typeof actionCoachTurnSchema>
export type EventDelta=Static<typeof eventDeltaSchema>
export type ActionDraft=Static<typeof legacyDraftSchema>
export type ResumePortfolioDraft=Static<typeof resumePortfolioDraftSchema>

// Transport framing only. Native JSON.parse decides completeness; the existing
// turn parser and source/transaction validators still decide admissibility.
export function completeCoachJsonFrame(raw:string):string|null {
  const text=raw.trimStart()
  if(!text.startsWith('{'))return null
  for(let end=text.indexOf('}');end>=0;end=text.indexOf('}',end+1)){
    try{const frame=text.slice(0,end+1),value=JSON.parse(frame);if(value&&typeof value==='object'&&!Array.isArray(value))return frame}catch{}
  }
  return null
}

// Only a structurally complete root object missing its final brace qualifies.
// Any open string, array, or nested object remains rejected.
function completeMissingRootBrace(raw:string):string|null {
  const text=raw.trim()
  if(!text.startsWith('{')||!text.endsWith('}'))return null
  let depth=0,inString=false,escaped=false
  for(const char of text){
    if(inString){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')inString=false;continue}
    if(char==='"')inString=true
    else if(char==='{'||char==='[')depth++
    else if(char==='}'||char===']')depth--
  }
  if(inString||depth!==1)return null
  return text+'}'
}


// Some captured text streams contain a JSON draft, an explicit deliberation
// terminator, then the final JSON. Only that complete final object is business
// output. Do not merge draft fields, scan arbitrary prose, or finish a prefix.
// A render-only tail is inert only when its exact text projection agrees with
// the business reply; it cannot supply state or replace missing business data.
export function finalCoachJsonText(raw:string,onNormalization?:(kind:string)=>void):string {
  const text=raw.trim(),first=completeCoachJsonFrame(text)
  if(!first){
    const completed=completeMissingRootBrace(text)
    if(completed){onNormalization?.('missing_root_closing_brace');return completed}
  }
  let rest=first?text.slice(first.length).trimStart():''
  // Transport-only HTML/analysis/result tags may follow the complete business
  // frame; ignore that tail, including echoed prompt text. A tag inside the
  // business JSON is already inside `first` and is never truncated here.
  if(first&&/^<\/?(?:br|analysis|result|body|html)\b/i.test(rest)){onNormalization?.('transport_tag_tail_ignored');return first}
  // A captured provider emitted a redundant root closing brace, either alone
  // or before its explicit deliberation terminator. The complete frame is
  // already parsed; surplus closing braces carry no fields.
  if(first&&/^}\s*$/.test(rest)){onNormalization?.('surplus_root_closing_brace');return first}
  if(/^[}\s]*<\/thinking>/.test(rest))rest=rest.replace(/^[}\s]*/,'')
  const canonical=(value:string)=>{try{return JSON.stringify(JSON.parse(value))}catch{return value}}
  const transportMarker=/^(?:<\/?(?:br|parameter|result|invoke|tool|function)\s*\/?>|<\|(?:tool_call(?:_end)?|tool_name|json_output)\|>)/i
  const stripTransportMarkers=(value:string)=>{let out=value.trimStart();while(true){const marker=transportMarker.exec(out);if(!marker)return out;out=out.slice(marker[0].length).trimStart()}}
  const onlyTransportMarkers=(value:string)=>stripTransportMarkers(value)===''
  const sameCompleteTail=(value:string):boolean=>{
    const tail=stripTransportMarkers(value)
    if(!tail)return true
    const frame=completeCoachJsonFrame(tail)
    if(!frame||canonical(frame)!==canonical(first!))return false
    return onlyTransportMarkers(tail.slice(frame.length))
  }
  // HTML break tags are transport separators. They may repeat an identical
  // business frame, but they cannot authorize a different or incomplete one.
  if(first&&/^(?:<\/?br\s*\/?>\s*)+/i.test(rest)){
    if(sameCompleteTail(rest)){onNormalization?.('html_break_identical_tail');return first}
    return text
  }
  // The acceptance transport test repeats the complete frame inside a fenced
  // block without a deliberation terminator. Only identical duplicate frames
  // are inert transport noise; a different trailing object remains ambiguous.
  if(first&&/^```/.test(rest)){
    const body=rest.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim()
    const canonical=(value:string)=>{try{return JSON.stringify(JSON.parse(value))}catch{return value}}
    let cursor=0,frames=0
    while(cursor<body.length){
      const at=body.indexOf('{',cursor)
      if(at<0)break
      const frame=completeCoachJsonFrame(body.slice(at))
      if(!frame||canonical(frame)!==canonical(first))return text
      frames++;cursor=at+frame.length
    }
    if(frames){onNormalization?.('repeated_identical_transport_frame');return first}
  }
  if(first&&rest.startsWith('<|render|>')){
    const tail=rest.slice('<|render|>'.length).trim()
    if(completeCoachJsonFrame(tail)===tail){
      const display=JSON.parse(tail),business=JSON.parse(first)
      if(Object.keys(display).length===2&&typeof display.lead==='string'&&typeof display.body==='string'&&typeof business.reply==='string'
        &&business.reply===display.lead+display.body){
        onNormalization?.('verified_render_metadata_ignored')
        return first
      }
    }
    return text
  }
  // Tool-parameter/result wrappers are transport. They may be followed by an
  // identical duplicate or by no business object, never by a conflicting one.
  if(first&&/^<\/(?:parameter|result|invoke|tool|function)>/.test(rest)){
    if(sameCompleteTail(rest)){onNormalization?.('wrapper_without_conflicting_frame');return first}
    return text
  }
  // One explicit final frame is authoritative. Repeated identical frames are
  // provider transport duplication; different, incomplete or ambiguous
  // trailing objects are rejected rather than guessed.
  const terminator=/^<\/(?:thinking|analysis)>/.exec(rest)
  if(!terminator)return text
  const displayEcho=/^\s*<reply>\s*([\s\S]*?)\s*<\/reply>/.exec(rest.slice(terminator[0].length))
  if(first&&displayEcho){
    let tail=rest.slice(terminator[0].length+displayEcho[0].length),identical=true
    try{if(displayEcho[1]!.trim()!==(JSON.parse(first) as {reply?:unknown}).reply)identical=false}catch{identical=false}
    while(identical&&tail.trim()){
      tail=tail.trimStart().replace(/^(?:<\|(?:tool_call_end|tool_|json_output)\|>|<\/?function_results>)\s*/i,'')
      if(!tail.trim())break
      if(!tail.startsWith('{')){identical=false;break}
      const frame=completeCoachJsonFrame(tail)
      if(!frame||canonical(frame)!==canonical(first)){identical=false;break}
      tail=tail.slice(frame.length)
    }
    if(identical){onNormalization?.('identical_display_and_transport_tail');return first}
    return text
  }
  const frames=rest.split(terminator[0]).map(part=>part.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim()).filter(Boolean)
  const complete:string[]=[]
  for(const part of frames){
    const frame=completeCoachJsonFrame(part)
    if(!frame||part.slice(frame.length).trim())return text
    complete.push(frame)
  }
  if(!complete.length)return text
  if(complete.length===1){onNormalization?.('explicit_final_json_frame');return complete[0]!}
  if(first&&complete.every(frame=>canonical(frame)===canonical(first))){
    onNormalization?.('repeated_identical_final_frame')
    return first
  }
  return text
}

export type CoachOutputRejection={stage:'json'|'draft_reference'|'schema';issues?:{keyword:string;schemaPath:string}[]}
export function parseActionCoachTurn(raw:string,options:{allowEmptyMaterialExplanation?:boolean;allowEmptyReplyWithCompleteDraft?:boolean;onNormalization?:(kind:string)=>void;onRejection?:(diagnostic:CoachOutputRejection)=>void}={}):ActionCoachTurn {
  const unframed=raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1')
  const text=finalCoachJsonText(unframed,options.onNormalization)
  let output:unknown
  try{output=JSON.parse(text)}catch(error){
    // A captured complete reply-only frame omitted escaping around a short
    // literal phrase. Normalize only that serialization defect, verbatim.
    // Never infer fields, finish partial JSON, or reconstruct state operations.
    const match=/^\{\s*"reply"\s*:\s*"([^{}\[\]\\:,\x00-\x1f]*)"\s*\}$/.exec(text)
    const body=match?.[1],literal=/"[\p{L}\p{N} _、，。！？（）().!?;\-]{1,80}"/gu
    const pairs=body?.match(literal)
    if(!body||!pairs?.length||pairs.length>2||pairs.some(pair=>!/[\p{L}\p{N}]/u.test(pair))||body.replace(literal,'').includes('"')){options.onRejection?.({stage:'json'});throw error}
    output=JSON.parse('{"reply":'+JSON.stringify(body)+'}')
    options.onNormalization?.('quoted_reply_literal')
  }
  // A provider can close `event` before its node list and leave `nodes` at the
  // root. Move only that already-present list into an event that has none.
  if((output as any)?.event&&Array.isArray((output as any).nodes)&&!(output as any).event.nodes){
    ;(output as any).event.nodes=(output as any).nodes
    delete (output as any).nodes
    options.onNormalization?.('root_nodes_moved_into_event')
  }
  // A captured provider response used an explicitly named create envelope
  // instead of the advertised array. Decode that unambiguous operation here,
  // in the sole parser, before ordinary schema/source/transaction validation.
  // Never infer an edit target or accept model prose as a reported fact.
  const updates=(output as any)?.growthUpdates
  // Captured native output echoed the read-only external-expectation label
  // as a fact kind. It carries no authority beyond a current-clause context
  // create: keep its source selector, never infer a personal preference/goal,
  // accept free prose or turn it into an edit of an existing memory.
  if(Array.isArray(updates))for(const update of updates){
    // The provider sometimes places the correction target id beside `target`
    // instead of inside it. Move only that already-present identity; never
    // infer a target.
    if(update&&typeof update==='object'&&update.target?.operation==='correct'
      &&typeof update.itemId==='string'&&!update.target.itemId){
      update.target.itemId=update.itemId
      delete update.itemId
      options.onNormalization?.('growth_correct_item_id_moved')
    }
    if(update&&typeof update==='object'&&update.kind==='externalExpectation'
      &&update.assertion==='user_reported'&&update.target?.operation==='create'
      &&Object.keys(update).length===4&&Object.keys(update).every(key=>['target','assertion','kind','source'].includes(key))){
      update.kind='context'
      options.onNormalization?.('reported_external_expectation_context')
    }
  }
  // A provider may attach a deadline-shaped field to a weekly-hours budget.
  // Weekly hours are not a calendar deadline; keep the reported fact as
  // context instead of rejecting an otherwise valid answer or inventing an
  // expiry. Valid deadline evidence is untouched.
  if(Array.isArray(updates))for(const update of updates){
    const evidence=update?.timeEvidence
    if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))continue
    if(typeof evidence.kind!=='string'&&typeof evidence.type==='string')evidence.kind=evidence.type
    if(evidence.kind==='duration'&&typeof evidence.count!=='number'&&typeof evidence.value==='number')evidence.count=evidence.value
    if(evidence.kind==='duration'&&typeof evidence.unit==='string'&&!['day','week'].includes(evidence.unit)){
      delete update.timeEvidence
      if(update.kind==='constraint')update.kind='context'
      options.onNormalization?.('weekly_budget_time_evidence_as_context')
    }else if(!['date_inclusive','duration','calendar_week'].includes(evidence.kind)){
      delete update.timeEvidence
      if(update.kind==='constraint')update.kind='context'
      options.onNormalization?.('unsupported_time_evidence_as_context')
    }
  }
  const reportedKeys=new Set(['assertion','kind','source','text','validUntil','timeEvidence','progressState'])
  if(updates&&typeof updates==='object'&&!Array.isArray(updates)&&Object.keys(updates).length===1&&Object.hasOwn(updates,'create')
    &&Array.isArray(updates.create)&&updates.create.length>0&&updates.create.length<=8
    &&updates.create.every((entry:any)=>entry&&typeof entry==='object'&&!Array.isArray(entry)&&entry.assertion==='user_reported'
      &&Object.keys(entry).every(key=>reportedKeys.has(key))&&(!Object.hasOwn(entry,'text')||typeof entry.text==='string'))){
    ;(output as any).growthUpdates=updates.create.map(({text,...entry}:any)=>({...entry,target:{operation:'create'}}))
    options.onNormalization?.('explicit_reported_create_envelope')
  }
  // Provider-authored metadata has no authority. Provenance and readiness are
  // rebuilt from the host catalogue after this parser, never accepted from a
  // model's invented field/type or claim that the material was verified.
  let draft=(output as any)?.event?.action?.draft
  if(draft&&typeof draft==='object'&&!Array.isArray(draft))for(const key of ['readiness','missingRequired','materialFactIds','materialEvidence'])delete draft[key]
  // The native body reference has one authority: the actual generated reply.
  // Expand it here into the existing canonical draft, before all validation.
  if(draft&&typeof draft==='object'&&!Array.isArray(draft)&&'fromReply'in draft){
    if(draft.fromReply!==true||Object.keys(draft).length!==1||typeof(output as any).reply!=='string'||!(output as any).reply.trim()){options.onRejection?.({stage:'draft_reference'});throw new Error('ACTION_COACH_OUTPUT_INVALID')}
    draft={content:(output as any).reply}
    ;(output as any).event.action.draft=draft
  }
  // Constrained decoding sometimes satisfies a required expiry with an empty
  // string. It carries no time information, so treat it as absent and let the
  // staging guards decide whether that item survives.
  if(Array.isArray((output as {growthUpdates?:unknown[]})?.growthUpdates)){
    for(const update of (output as {growthUpdates:{validUntil?:unknown}[]}).growthUpdates)if(update&&typeof update==='object'&&update.validUntil==='')delete update.validUntil
  }
  // Only the host catalogue lane can omit prose: it still needs a complete
  // selection that the engine resolves and validates before any delivery.
  const action=(output as any)?.event?.action
  const completeOrdinaryDraft=action&&['create','modify'].includes(action.operation)&&draft&&typeof draft==='object'&&!('kind'in draft)&&typeof draft.content==='string'&&draft.content.trim().length>0
  const mayOmitReply=options.allowEmptyMaterialExplanation&&draft?.kind==='resume_portfolio'||options.allowEmptyReplyWithCompleteDraft&&(output as any)?.reply===''&&completeOrdinaryDraft
  const schema=mayOmitReply
    ?{...actionCoachTurnSchema,properties:{...actionCoachTurnSchema.properties,reply:{...actionCoachTurnSchema.properties.reply,minLength:0}}}
    :actionCoachTurnSchema
  if(!Value.Check(schema,output)){
    // Only schema-owned locations are retained. instancePath, params and
    // messages can contain arbitrary model text or user data.
    if(options.onRejection){
      const issues:{keyword:string;schemaPath:string}[]=[]
      for(const issue of Value.Errors(schema,output)){
        issues.push({keyword:issue.keyword,schemaPath:issue.schemaPath})
        if(issues.length===8)break
      }
      options.onRejection({stage:'schema',issues})
    }
    throw new Error('ACTION_COACH_OUTPUT_INVALID')
  }
  return output as ActionCoachTurn
}

export const eventSearchSchema=Type.Object({query:Type.String({maxLength:16000}),eventId:Type.Optional(id),actionId:Type.Optional(id),object:Type.Optional(text(200)),after:Type.Optional(text(100)),before:Type.Optional(text(100))},{additionalProperties:false})



