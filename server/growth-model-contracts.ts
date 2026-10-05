import { Type, type Static } from 'typebox'

const id=Type.String({pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'})
const text=(maxLength=4000)=>Type.String({minLength:1,maxLength})
const source=Type.Object({messageId:id,quote:text(8000)},{additionalProperties:false,description:'仅引用最后一条用户消息的连续原文；不能把助手建议或旧消息伪装成本轮用户事实。'})
const target=Type.Union([
  Type.Object({operation:Type.Literal('create')},{additionalProperties:false}),
  Type.Object({operation:Type.Literal('replace'),itemId:id,expectedRevision:Type.Integer({minimum:1})},{additionalProperties:false}),
],{description:'新增一项当前信息用create；用户明确改目标/更正同一项才replace授权growth中的真实id/revision。补充另一事实不能覆盖旧项。'})
const dependencies=Type.Array(Type.Object({id,revision:Type.Integer({minimum:1})},{additionalProperties:false}),{minItems:1,maxItems:12,description:'至少一项授权growth中仍有效的本人依据，不引用助手文字或编造ID。首次提供事实先保存，不能编造新记录ID。待核对观察不是已确定的个人事实。'})
const reported=Type.Object({
  target,
  kind:Type.Union([Type.Literal('context'),Type.Literal('ability'),Type.Literal('preference'),Type.Literal('goal'),Type.Literal('direction'),Type.Literal('constraint'),Type.Literal('feedback')]),
  assertion:Type.Literal('user_reported'),text:{...text(),description:'逐字来自source.quote的一项具体本人陈述。兴趣/自评/团队结果仍照原话保留，不能改写成已经证明的个人能力。'},source,
  validUntil:Type.Optional(text(40)),
  progressState:Type.Optional(Type.Union([Type.Literal('unattempted'),Type.Literal('attempted'),Type.Literal('stuck'),Type.Literal('completed'),Type.Literal('unknown')])),
},{additionalProperties:false,description:'本人本轮明确提供的实际情况。临时时间约束必须给出有当前时间依据的有效期。反馈区分未做/已尝试/卡住/完成动作/不知道，结果未知不等于动作失败。'})
const observation=Type.Object({
  target,
  kind:Type.Union([Type.Literal('observation'),Type.Literal('direction'),Type.Literal('priority'),Type.Literal('decision')]),
  assertion:Type.Literal('ai_observation'),text:text(),source,dependencies,
  limitation:text(1200),validUntil:Type.Optional(text(40)),
},{additionalProperties:false,description:'有当前诉求和本人证据的待核对观察/方向权衡/阶段重点。不是用户已经认可或执行。明确局限与仍未知的条件；单次事件不能证明稳定人格、终身能力或确定路径适配。'})
const unknown=Type.Object({target,kind:Type.Literal('unknown'),assertion:Type.Literal('unknown'),text:text(2000),source},{additionalProperties:false,description:'尚不清楚且会影响本人当前判断的未知，不把拒答改成未知反复追问。纯知识或日常闲聊不建立档案问题。'})
export const growthDeltaSchema=Type.Union([reported,observation,unknown])
export type GrowthDelta=Static<typeof growthDeltaSchema>
