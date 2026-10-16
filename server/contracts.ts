import { Type, type Static, type TSchema } from 'typebox'
import { Value } from 'typebox/value'
import { HttpError } from './db.ts'
const uuid = Type.String({ pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' })
const text = (max=4000) => Type.String({ minLength: 1, maxLength: max })
export const memoryKeySchema = Type.Union([
  Type.Literal('education.school'),Type.Literal('education.major'),Type.Literal('education.stage'),
  Type.Literal('skills'),Type.Literal('currentConcern'),Type.Literal('taskGoal'),Type.Literal('availableTime'),
  Type.Literal('taskConstraints'),Type.Literal('priorAttempts'),Type.Literal('optionsUnderConsideration'),
])
export type MemoryKey = Static<typeof memoryKeySchema>
export const valueId = Type.Union([Type.Literal('value-creation'),Type.Literal('value-autonomy'),Type.Literal('value-growth')])
// The content fields carry server-resolved verbatim clause text and the
// derived occurred date (empty when unresolved); the model never writes them.
export const candidateSchema = Type.Object({ sourceMessageId: uuid, quote: text(), links: Type.Array(Type.Object({ valueId, reason: text(2000) },{ additionalProperties: false }),{ maxItems: 3 }), content: Type.Optional(Type.Object({ action: Type.String({ maxLength: 4000 }), result: Type.String({ maxLength: 4000 }), occurredAt: Type.String({ maxLength: 200 }) },{ additionalProperties: false })) },{ additionalProperties: false })
export type Candidate = Static<typeof candidateSchema>
export const identityClaimActionSchema = Type.Object({ requestId: uuid, action: Type.Union([Type.Literal('deny'),Type.Literal('correct'),Type.Literal('stop')]), text: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })) },{ additionalProperties: false })
export const themeLinkActionSchema = Type.Object({ requestId: uuid, action: Type.Union([Type.Literal('confirm'),Type.Literal('revoke')]) },{ additionalProperties: false })
export const themeActionSchema = Type.Object({ requestId: uuid, expectedRevision: Type.Integer({ minimum: 1 }), action: Type.Union([Type.Literal('pin'),Type.Literal('unpin'),Type.Literal('rename'),Type.Literal('pause'),Type.Literal('resume'),Type.Literal('revoke')]), title: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })) },{ additionalProperties: false })
export const retrievalSchema = Type.Object({ query: Type.String({ maxLength: 200 }), limit: Type.Integer({ minimum: 1, maximum: 10 }) },{ additionalProperties: false })
export const createChatSchema = Type.Object({ id: uuid, title: text(100) },{ additionalProperties: false })
export const chatPatchSchema = Type.Object({ title: Type.Optional(text(100)), renamed: Type.Optional(Type.Boolean()), pinned: Type.Optional(Type.Boolean()), projectId: Type.Optional(Type.Union([Type.Null(),Type.String({ maxLength: 100 })])) },{ additionalProperties: false })
export const messageSchema = Type.Object({ requestId: uuid, text: text(16000), focusContext: Type.Optional(Type.Object({ type: Type.Union([Type.Literal('theme'),Type.Literal('experience')]), id: uuid, label: Type.String({ maxLength: 80 }) },{ additionalProperties: false })) },{ additionalProperties: false })
export const contentSchema = Type.Object({ summary: text(), reflection: Type.Optional(Type.String({ maxLength: 4000 })), action: Type.Optional(Type.String({ maxLength: 4000 })), result: Type.Optional(Type.String({ maxLength: 4000 })), occurredAt: Type.Optional(Type.String({ maxLength: 200 })), source: Type.Optional(Type.String({ maxLength: 4000 })), tags: Type.Optional(Type.Array(text(24),{ maxItems:12 })) },{ additionalProperties: false })
export const experienceActionSchema = Type.Object({ requestId: uuid, expectedRevision: Type.Integer({ minimum: 1 }), action: Type.Union([Type.Literal('confirm'),Type.Literal('correct'),Type.Literal('delete'),Type.Literal('review')]),
  content: Type.Optional(contentSchema), link: Type.Optional(Type.Object({ valueId, reason: text(2000), disposition: Type.Union([Type.Literal('accepted'),Type.Literal('edited'),Type.Literal('rejected')]) },{ additionalProperties: false })) },{ additionalProperties: false })
export type ExperienceAction = Static<typeof experienceActionSchema>
export const memorySettingsSchema=Type.Object({requestId:uuid,enabled:Type.Boolean(),expectedRevision:Type.Integer({minimum:0})},{additionalProperties:false})
export const memoryActionSchema=Type.Object({requestId:uuid,expectedRevision:Type.Integer({minimum:1}),action:Type.Union([Type.Literal('correct'),Type.Literal('forget'),Type.Literal('accept'),Type.Literal('reject')]),value:Type.Optional(text(1000))},{additionalProperties:false})
export function validate<T extends TSchema>(schema: T, data: unknown): Static<T> {
  if (!Value.Check(schema, data)) throw new HttpError(400,'INVALID_INPUT')
  return data as Static<T>
}
export function validateId(id: string) { return validate(uuid, id) }
