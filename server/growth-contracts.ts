import { Type, type Static } from 'typebox'
const id = Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' })
const text = Type.String({ minLength: 1, maxLength: 4000, pattern: '\\S' })
export const growthProgressSchema = Type.Union([Type.Literal('unattempted'),Type.Literal('attempted'),Type.Literal('stuck'),Type.Literal('completed'),Type.Literal('unknown')])
export const growthKindSchema = Type.Union([Type.Literal('context'),Type.Literal('ability'),Type.Literal('preference'),Type.Literal('unknown'),Type.Literal('goal'),Type.Literal('direction'),Type.Literal('constraint'),Type.Literal('priority'),Type.Literal('decision'),Type.Literal('feedback')])
export const growthCreateSchema = Type.Object({
  requestId: id, conversationId: id, kind: growthKindSchema, text,
  validUntil: Type.Optional(Type.String({ maxLength: 40 })),
  progressState: Type.Optional(growthProgressSchema),
  dependencies: Type.Optional(Type.Array(Type.Object({ id, revision: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }), { maxItems: 12 })),
}, { additionalProperties: false })
export const growthActionSchema = Type.Object({
  requestId: id, expectedRevision: Type.Integer({ minimum: 1 }),
  action: Type.Union([Type.Literal('correct'),Type.Literal('accept'),Type.Literal('pause'),Type.Literal('complete'),Type.Literal('reject'),Type.Literal('forget')]),
  progressState: Type.Optional(growthProgressSchema),
  text: Type.Optional(text), validUntil: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 40 })])),
}, { additionalProperties: false })
export type GrowthCreate = Static<typeof growthCreateSchema>
export type GrowthAction = Static<typeof growthActionSchema>
