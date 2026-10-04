import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

const text=(maxLength=16000)=>Type.String({minLength:1,maxLength})
const id=Type.String({pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'})
export const processSourceSchema=Type.Object({messageId:{...id,description:'只复制本轮currentUserMessage.id。不能把历史消息的原话重新标成本轮消息。'},quote:{...text(8000),description:'必须是本轮最后一条用户消息中的连续原文，不能引用更早消息、拼接或改写。历史事实已在事件/对话中，不重复生成到本轮新节点。'}},{additionalProperties:false})
const reportedNode=Type.Object({kind:Type.Union([Type.Literal('fact'),Type.Literal('feeling'),Type.Literal('user_interpretation')]),source:processSourceSchema},{additionalProperties:false})
const unknownNode=Type.Object({kind:Type.Literal('unknown'),question:text(2000)},{additionalProperties:false})
const processNode=Type.Union([reportedNode,unknownNode])
// The server creates identities and revisions. The model selects existing
// records by ID/revision only; it cannot create an ID or mark a plan executed.
export const actionDraftSchema=Type.Object({
  content:Type.String({minLength:1,maxLength:12000,description:'完整可使用成品，只生成一次；服务器将它加入正式回复并保存同一版本。不得是空字符串、空格、未完成占位或只说去执行。'}),
  goal:Type.Optional(text(2000)),
  start:Type.Optional(text(4000)),
  materials:Type.Optional(Type.Array(text(4000),{maxItems:12})),
  observable:Type.Optional(text(2000)),
  effort:Type.Optional(text(1000)),
  stopWhen:Type.Optional(text(2000)),
},{additionalProperties:false})
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
  corrections:Type.Optional(Type.Array(Type.Object({nodeId:id,source:processSourceSchema},{additionalProperties:false}),{maxItems:12})),
  resolveUnknowns:Type.Optional(Type.Array(id,{maxItems:24})),
  declineUnknowns:Type.Optional(Type.Array(id,{maxItems:24})),
  action:Type.Optional(actionChangeSchema),
},{additionalProperties:false,description:'仅在本人具体事件/目标的过程或行动确有变化时使用。不是对话话题分类；纯知识、概念解释、只倾听不建立event。没有事件变化时整字段省略，不只填target来凑结构。'})
export const coachCitationSchema=Type.Object({sourceId:id,revision:Type.Integer({minimum:1}),claim:text(4000),quote:text(8000),scope:text(4000)},{additionalProperties:false})
export type CoachCitation=Static<typeof coachCitationSchema>
export const actionCoachTurnSchema=Type.Object({
  reply:Type.String({minLength:1,maxLength:16000,description:'自然回应本轮用户，并承接之前真实对话。用户补充经过后不要只照抄事实；需要深入时先问一个关键未知信息。可复制成品只写在event.action.draft.content，本字段写必要说明。'}),
  citations:Type.Optional(Type.Array(coachCitationSchema,{maxItems:6,description:'仅对确实使用的有效知识条目逐命题引用；普通追问、个人起草和倾听通常省略。不得编造来源。'})),
  event:Type.Optional(eventDeltaSchema),
  background:Type.Optional(Type.Array(Type.Object({
    key:Type.Union([Type.Literal('education.school'),Type.Literal('education.major'),Type.Literal('education.stage'),Type.Literal('skills')]),
    value:text(500),source:processSourceSchema,
  },{additionalProperties:false}),{maxItems:8})),
  // Candidates remain opt-in proposals; confirmation still uses the existing
  // experience API and is never implied by a conversation-state update.
  experienceCandidate:Type.Optional(Type.Object({source:processSourceSchema},{additionalProperties:false})),
},{additionalProperties:false,description:'reply是唯一必填字段。其余字段仅表示真实必要变化；知识或倾听可以只有reply。可选不是要求每轮创建对象，省略未发生的变化，不填空对象或空文案。'})
export type ActionCoachTurn=Static<typeof actionCoachTurnSchema>
export type EventDelta=Static<typeof eventDeltaSchema>
export type ActionDraft=Static<typeof actionDraftSchema>

export function parseActionCoachTurn(raw:string):ActionCoachTurn {
  const output=JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1')) as unknown
  if(!Value.Check(actionCoachTurnSchema,output))throw new Error('ACTION_COACH_OUTPUT_INVALID')
  return output
}

export const eventSearchSchema=Type.Object({query:Type.String({maxLength:16000}),eventId:Type.Optional(id),actionId:Type.Optional(id),object:Type.Optional(text(200)),after:Type.Optional(text(100)),before:Type.Optional(text(100))},{additionalProperties:false})
