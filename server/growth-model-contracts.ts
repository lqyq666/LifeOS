import { Type, type Static } from 'typebox'

const id=Type.String({pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'})
const text=(maxLength=4000)=>Type.String({minLength:1,maxLength})
// P1: the model only SELECTS a clause handle from
// currentUserMessage.clauses; the server owns the exact verbatim span and the
// messageId. Quotes from earlier messages, paraphrases or punctuation drift
// are unrepresentable.
const clauseId=Type.String({pattern:'^c[0-9]{1,2}$',description:'currentUserMessage.clauses中的clause id。'})
const source=Type.Object({clauseId},{additionalProperties:false,description:'选择本轮currentUserMessage.clauses中列出的clauseId；服务器保存其精确原文，不接受自写引文。'})
export const timeEvidenceSchema=Type.Union([
  Type.Object({kind:Type.Literal('date_inclusive'),date:Type.String({minLength:10,maxLength:10}),clauseId},{additionalProperties:false}),
  Type.Object({kind:Type.Literal('duration'),count:Type.Integer({minimum:1,maximum:366}),unit:Type.Union([Type.Literal('day'),Type.Literal('week')]),clauseId},{additionalProperties:false}),
  Type.Object({kind:Type.Literal('calendar_week'),which:Type.Union([Type.Literal('this'),Type.Literal('next')]),clauseId},{additionalProperties:false}),
],{description:'期限证据来自本轮用户原话：截至某日/接下来N天N周/本周/下周。服务器按clause原文推导有效期（上海时区，右开区间），模型不再生成validUntil。'})
// P2: the model expresses INTENT only. create = a new fact from a current
// clause; correct = this update corrects/changes the referenced existing item.
// The server alone decides the concrete operation (create/amend/replace), the
// binding revision, and when an unrelated current fact becomes a create.
const target=Type.Union([
  Type.Object({operation:Type.Literal('create')},{additionalProperties:false}),
  Type.Object({operation:Type.Literal('correct'),itemId:id},{additionalProperties:false,description:'表示本轮内容更正/改变了授权growth中的该条目；服务器决定具体改法与版本，不由模型指定。'}),
],{description:'新增本人情况用create并锚定本轮clauseId。只有确实在更正/改变旧条目时用correct并选择该条目id；服务器决定amend/replace/版本，无明确纠正关系时转为create；同一旧条目一轮只改一次。'})
const dependencies=Type.Array(Type.Union([
  Type.Object({id,revision:Type.Integer({minimum:1})},{additionalProperties:false}),
  Type.Object({updateIndex:Type.Integer({minimum:0,maximum:7})},{additionalProperties:false,description:'本轮growthUpdates数组的0基索引；只能引用已核实user_reported增量，不引用unknown或其他观察。服务器在同一事务保存事实后解析到真实id/revision。'}),
]),{minItems:1,maxItems:12,description:'依据来自授权growth准确id/revision，或本轮明确user_reported增量的updateIndex。不引用助手文字、编造ID或本轮replace的旧版本；更正后的事实用updateIndex明确引用。观察始终待核对并保留局限。'})
const reportedFields={
  text:Type.Optional({...text(),description:'兼容旧输出；若提供必须逐字来自source.quote。推荐省略，由服务器直接保存已核实的一项本人原话，避免重复改写。'}),source,
  timeEvidence:Type.Optional({...timeEvidenceSchema,description:'仅当本轮原话明确给出期限时提供；服务器校验并推导有效期。'}),
}
// Select information status before its category in every constrained branch.
// This is protocol consistency; real-model classification still needs review.
const reported=Type.Object({
  target,assertion:Type.Literal('user_reported'),
  kind:Type.Union([Type.Literal('context'),Type.Literal('ability'),Type.Literal('preference'),Type.Literal('goal'),Type.Literal('direction')]),
  ...reportedFields,
  validUntil:Type.Optional(text(40)),
},{additionalProperties:false,description:'本人本轮明确提供的实际情况。未定期限的个人时间预算、经济情况和地域愿望可用context原样保留，不猜日期；有明确有效期才用单独constraint分支。反馈区分未做/已尝试/卡住/完成动作/不知道，结果未知不等于动作失败。'})
const constraint=Type.Object({
  target,assertion:Type.Literal('user_reported'),kind:Type.Literal('constraint'),...reportedFields,
  validUntil:Type.Optional({...text(40),description:'兼容旧协议；新输出省略并改用timeEvidence。若仍提供，必须与用户原话中明确截止日一致，否则服务器拒绝。学期/假期名称不能推算结束日；期限未知时不要生成constraint，改用context保留原话并核对期限。'}),
},{additionalProperties:false,description:'有明确可核对有效期的本人临时约束。本人愿望、未定期限的时间预算和经济情况用context；不要补默认日期或将愿望升级为硬性限制。'})
const feedback=Type.Object({
  target,assertion:Type.Literal('user_reported'),kind:Type.Literal('feedback'),...reportedFields,
  progressState:Type.Union([Type.Literal('unattempted'),Type.Literal('attempted'),Type.Literal('stuck'),Type.Literal('completed'),Type.Literal('unknown')]),
  validUntil:Type.Optional(text(40)),
},{additionalProperties:false,description:'本人实际反馈必须明确动作状态。已完成动作但仍等结果用completed，不假设结果成功；复制建议或材料不是对外执行。其他记录不填写progressState。'})
const directionScopeLiteral=Type.Union([Type.Literal('employment'),Type.Literal('research_exploration'),Type.Literal('postgraduate_recommendation'),Type.Literal('postgraduate_exam'),Type.Literal('public_service'),Type.Literal('entrepreneurship'),Type.Literal('overseas_study'),Type.Literal('undergraduate_upgrade')])
const observation=Type.Object({
  target,
  assertion:Type.Literal('ai_observation'),
  kind:Type.Union([Type.Literal('observation'),Type.Literal('direction'),Type.Literal('priority'),Type.Literal('decision')]),
  text:text(),source,dependencies,
  directionScopes:Type.Optional(Type.Array(directionScopeLiteral,{maxItems:8,description:'方向/重点/决策类观察关联的发展方向；该方向被用户暂停时不要再作为新建议依据。'})),
  limitation:text(1200),validUntil:Type.Optional(text(40)),
},{additionalProperties:false,description:'有当前诉求和本人证据的待核对观察/方向权衡/阶段重点。不是用户已经认可或执行。明确局限与仍未知的条件；单次事件不能证明稳定人格、终身能力或确定路径适配。'})
const unknown=Type.Object({target,assertion:Type.Literal('unknown'),kind:Type.Literal('unknown'),text:text(2000),source},{additionalProperties:false,description:'具体仍缺失且影响当前判断的答案；已提供的年级、作品、偏好、时间等保存user_reported，不将已回答的信息标题列为unknown。不把拒答改成未知反复追问。纯知识或日常闲聊不建立档案问题。'})
export const growthDeltaSchema=Type.Union([reported,constraint,feedback,observation,unknown])
export type GrowthInputDelta=Static<typeof growthDeltaSchema>
// P1/P2 server-internal resolved form: clauseId handles are already resolved
// to exact messageId+quote spans, and the model's correct intent is already
// decided into a concrete server-owned operation with a real revision.
export type ResolvedTimeEvidence=
  |{kind:'date_inclusive';date:string;quote:string}
  |{kind:'duration';count:number;unit:'day'|'week';quote:string}
  |{kind:'calendar_week';which:'this'|'next';quote:string}
export type ResolvedGrowthTarget=
  |{operation:'create'}
  |{operation:'replace'|'amend';itemId:string;expectedRevision:number;beforeQuote?:string}
type DistributiveOmit<T,K extends keyof never>=T extends unknown?Omit<T,K>:never
export type ResolvedGrowthDelta=DistributiveOmit<GrowthInputDelta,'source'|'target'|'timeEvidence'>&{
  source:{messageId:string;quote:string}
  target:ResolvedGrowthTarget
  timeEvidence?:ResolvedTimeEvidence
}
export type GrowthDelta=ResolvedGrowthDelta&{text:string}
