import { graph } from './graph.ts'

export const RECORD_KEY = 'lifeos.record-drafts.v1'
export const recordFields = ['summary', 'occurredAt', 'action', 'result', 'reflection', 'source'] as const
export type RecordDraft = Partial<Record<typeof recordFields[number], string>> & { tags?: string[] }
export type RecordDrafts = Record<string, RecordDraft>

// User additions stay separate from the seed and relationship reviews.
export function parseRecordDrafts(raw: string | null): RecordDrafts {
  if (!raw) return {}
  const data: unknown = JSON.parse(raw)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid record drafts')
  const drafts: RecordDrafts = {}
  for (const [id, value] of Object.entries(data)) {
    if (graph.getNode(id)?.type !== 'experience') continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid record draft')
    const entry = value as Record<string, unknown>, draft: RecordDraft = {}
    for (const field of recordFields) {
      if (entry[field] === undefined) continue
      if (typeof entry[field] !== 'string' || entry[field].length > 4000) throw new Error('Invalid record field')
      draft[field] = entry[field]
    }
    if (entry.tags !== undefined) {
      if (!Array.isArray(entry.tags) || entry.tags.length > 12 || entry.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 24)) throw new Error('Invalid record tags')
      draft.tags = [...new Set(entry.tags as string[])]
    }
    drafts[id] = draft
  }
  return drafts
}
