import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'
import { growthDeltaSchema } from './growth-model-contracts.ts'

const text=(maxLength=16000)=>Type.String({minLength:1,maxLength})
const id=Type.String({pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'})
export const processSourceSchema=Type.Object({messageId:{...id,description:'只复制本轮currentUserMessage.id。不能把历史消息的原话重新标成本轮消息。'},quote:{...text(8000),description:'必须是本轮最后一条用户消息中的连续原文，不能引用更早消息、拼接或改写。历史事实已在事件/对话中，不重复生成到本轮新节点。'}},{additionalProperties:false})
const reportedNode=Type.Object({kind:Type.Union([Type.Literal('fact'),Type.Literal('feeling'),Type.Literal('user_interpretation')]),source:processSourceSchema},{additionalProperties:false,description:'一项当前用户陈述及其连续原话。已知旧陈述不重新生成，补充新信息使用新节点。事实、感受与用户解释分别表达。'})
const unknownNode=Type.Object({kind:Type.Literal('unknown'),question:text(2000)},{additionalProperties:false,description:'当前关键未知的具体问题；记不清的详情仍未知。只保留会改变理解或下一步的信息，不把已明确的经过重新记作未知。'})
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
  nodes:Type.Optional(Type.Array(processNode,{maxItems:24})),
  corrections:Type.Optional(Type.Array(Type.Object({nodeId:id,source:processSourceSchema},{additionalProperties:false}),{maxItems:12,description:'用户实质更正已有陈述时才替换对应节点。重复旧话或补充另一个事实使用nodes，不能缩小覆盖其他旧事实。'})),
  resolveUnknowns:Type.Optional(Type.Array(id,{maxItems:24,description:'仅标记授权事件中实际已回答的对应未知问题ID；按问题与回答对应，不因本轮有任何新事实就任意选择ID。记不清仍未知。'})),
  declineUnknowns:Type.Optional(Type.Array(id,{maxItems:24,description:'仅在用户明确拒绝回答对应问题时标记该问题ID；记不清不是拒答，不标记declined，也不转移到另一个旧问题。原因不想讲可保留为declined，另一个时间记不清仍active。'})),
  action:Type.Optional(actionChangeSchema),
},{additionalProperties:false,description:'仅在本人具体事件/目标的过程或行动确有变化时使用。不是对话话题分类；纯知识、概念解释、只倾听不建立event。没有事件变化时整字段省略，不只填target来凑结构。'})
export const coachCitationSchema=Type.Object({sourceId:id,revision:Type.Integer({minimum:1}),claim:text(4000),quote:text(8000),scope:text(4000)},{additionalProperties:false})
export type CoachCitation=Static<typeof coachCitationSchema>
export const actionCoachTurnSchema=Type.Object({
  reply:Type.String({minLength:1,maxLength:16000,description:'自然简洁地回应本轮诉求。复盘先问关键未知问题，已知事实用于理解，不逐句复述。要交付成品时这里只写必要说明，完整可复制文本放event.action.draft.content，服务器展示同一材料。'}),
  citations:Type.Optional(Type.Array(coachCitationSchema,{maxItems:6,description:'仅对确实使用的有效知识条目逐命题引用；普通追问、个人起草和倾听通常省略。不得编造来源。'})),
  event:Type.Optional(eventDeltaSchema),
  growthUpdates:Type.Optional(Type.Array(growthDeltaSchema,{maxItems:8,description:'只有当前个人情况、方向/近期判断或实际反馈新增/变化才给小粒度增量。普通知识/倾听无需建档。明确陈述与带局限的待核对AI观察分开，每条一项；不要求每轮补齐档案。'})),
  background:Type.Optional(Type.Array(Type.Object({
    key:Type.Union([Type.Literal('education.school'),Type.Literal('education.major'),Type.Literal('education.stage'),Type.Literal('skills')]),
    value:text(500),source:processSourceSchema,
  },{additionalProperties:false}),{maxItems:8,description:'仅限本人明确、稳定的教育和技能背景；教育阶段指大三、硕士等身份阶段，今晚等临时行动时间不是教育阶段。省略临时约束和事件事实。'})),
  weeklyPlan:Type.Optional(Type.Object({
    availableMinutes:Type.Integer({minimum:1,maximum:10080}),
    items:Type.Array(Type.Object({action:Type.String({minLength:1,maxLength:200}),minutes:Type.Integer({minimum:1,maximum:10080})}),{minItems:0,maxItems:12}),
    basis:Type.Array(Type.Union([
      Type.Object({id,revision:Type.Integer({minimum:1})},{additionalProperties:false}),
      Type.Object({updateIndex:Type.Integer({minimum:0,maximum:7})},{additionalProperties:false}),
    ]),{maxItems:12}),
  },{additionalProperties:false,description:'仅在用户明确要求安排时间时提供：availableMinutes必须来自已核对的每周时间事实；各项分钟数为正且合计不超过预算；依据指向对应growth条目或本轮增量。'})),
  // Candidates remain opt-in proposals; confirmation still uses the existing
  // experience API and is never implied by a conversation-state update.
  experienceCandidate:Type.Optional(Type.Object({source:processSourceSchema},{additionalProperties:false})),
},{additionalProperties:false,description:'reply是唯一必填字段。其余字段仅表示真实必要变化；知识或倾听可以只有reply。可选不是要求每轮创建对象，省略未发生的变化，不填空对象或空文案。'})
export type ActionCoachTurn=Static<typeof actionCoachTurnSchema>
export type EventDelta=Static<typeof eventDeltaSchema>
export type ActionDraft=Static<typeof legacyDraftSchema>
export type ResumePortfolioDraft=Static<typeof resumePortfolioDraftSchema>

export function parseActionCoachTurn(raw:string):ActionCoachTurn {
  const output=JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1')) as unknown
  // Constrained decoding sometimes satisfies a required expiry with an empty
  // string. It carries no time information, so treat it as absent and let the
  // staging guards decide whether that item survives.
  if(Array.isArray((output as {growthUpdates?:unknown[]})?.growthUpdates)){
    for(const update of (output as {growthUpdates:{validUntil?:unknown}[]}).growthUpdates)if(update&&typeof update==='object'&&update.validUntil==='')delete update.validUntil
  }
  if(!Value.Check(actionCoachTurnSchema,output))throw new Error('ACTION_COACH_OUTPUT_INVALID')
  return output
}

export const eventSearchSchema=Type.Object({query:Type.String({maxLength:16000}),eventId:Type.Optional(id),actionId:Type.Optional(id),object:Type.Optional(text(200)),after:Type.Optional(text(100)),before:Type.Optional(text(100))},{additionalProperties:false})
