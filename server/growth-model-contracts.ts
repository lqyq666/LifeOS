import { Type, type Static } from 'typebox'

const id=Type.String({pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'})
const text=(maxLength=4000)=>Type.String({minLength:1,maxLength})
const source=Type.Object({messageId:id,quote:text(8000)},{additionalProperties:false,description:'仅引用最后一条用户消息的连续原文；不能把助手建议或旧消息伪装成本轮用户事实。'})
const target=Type.Union([
  Type.Object({operation:Type.Literal('create')},{additionalProperties:false}),
  Type.Object({operation:Type.Literal('replace'),itemId:id,expectedRevision:Type.Integer({minimum:1})},{additionalProperties:false}),
],{description:'新增一项当前信息用create；用户明确改目标/更正同一项才replace授权growth中的真实id/revision。补充另一事实不能覆盖旧项。'})
const dependencies=Type.Array(Type.Union([
  Type.Object({id,revision:Type.Integer({minimum:1})},{additionalProperties:false}),
  Type.Object({updateIndex:Type.Integer({minimum:0,maximum:7})},{additionalProperties:false,description:'本轮growthUpdates数组的0基索引；只能引用已核实user_reported增量，不引用unknown或其他观察。服务器在同一事务保存事实后解析到真实id/revision。'}),
]),{minItems:1,maxItems:12,description:'依据来自授权growth准确id/revision，或本轮明确user_reported增量的updateIndex。不引用助手文字、编造ID或本轮replace的旧版本；更正后的事实用updateIndex明确引用。观察始终待核对并保留局限。'})
const reportedFields={
  text:Type.Optional({...text(),description:'兼容旧输出；若提供必须逐字来自source.quote。推荐省略，由服务器直接保存已核实的一项本人原话，避免重复改写。'}),source,
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
  validUntil:{...text(40),description:'必填ISO有效期，必须依据本人明确截止日或可核对的相对时长计算。学期/假期名称不能推算结束日；有效期未知时不要生成constraint，改用context保留原话并核对期限。'},
},{additionalProperties:false,description:'有明确可核对有效期的本人临时约束。本人愿望、未定期限的时间预算和经济情况用context；不要补默认日期或将愿望升级为硬性限制。'})
const feedback=Type.Object({
  target,assertion:Type.Literal('user_reported'),kind:Type.Literal('feedback'),...reportedFields,
  progressState:Type.Union([Type.Literal('unattempted'),Type.Literal('attempted'),Type.Literal('stuck'),Type.Literal('completed'),Type.Literal('unknown')]),
  validUntil:Type.Optional(text(40)),
},{additionalProperties:false,description:'本人实际反馈必须明确动作状态。已完成动作但仍等结果用completed，不假设结果成功；复制建议或材料不是对外执行。其他记录不填写progressState。'})
const observation=Type.Object({
  target,
  assertion:Type.Literal('ai_observation'),
  kind:Type.Union([Type.Literal('observation'),Type.Literal('direction'),Type.Literal('priority'),Type.Literal('decision')]),
  text:text(),source,dependencies,
  limitation:text(1200),validUntil:Type.Optional(text(40)),
},{additionalProperties:false,description:'有当前诉求和本人证据的待核对观察/方向权衡/阶段重点。不是用户已经认可或执行。明确局限与仍未知的条件；单次事件不能证明稳定人格、终身能力或确定路径适配。'})
const unknown=Type.Object({target,assertion:Type.Literal('unknown'),kind:Type.Literal('unknown'),text:text(2000),source},{additionalProperties:false,description:'具体仍缺失且影响当前判断的答案；已提供的年级、作品、偏好、时间等保存user_reported，不将已回答的信息标题列为unknown。不把拒答改成未知反复追问。纯知识或日常闲聊不建立档案问题。'})
export const growthDeltaSchema=Type.Union([reported,constraint,feedback,observation,unknown])
export type GrowthInputDelta=Static<typeof growthDeltaSchema>
export type GrowthDelta=GrowthInputDelta&{text:string}
