import { graph } from './graph.ts'

export const RECORD_KEY = 'lifeos.record-drafts.v1'
export const recordFields = ['summary', 'occurredAt', 'action', 'result', 'reflection', 'source'] as const
export type RecordDraft = Partial<Record<typeof recordFields[number], string>> & { tags?: string[] }
export type RecordDrafts = Record<string, RecordDraft>

export function recordEditingDraft(record: Partial<Record<typeof recordFields[number], string | null>> & { tags?: string[] }, draft: RecordDraft): RecordDraft {
  return { ...Object.fromEntries(recordFields.map(key => [key, draft[key] ?? record[key] ?? ''])), tags: [...(draft.tags ?? record.tags ?? [])] }
}

export function recordCorrectionContent(initial: RecordDraft, next: RecordDraft): RecordDraft {
  // The API requires summary; other fields are patches, not a blank snapshot.
  // Hidden metadata and derived display text must never become new testimony.
  return { summary: next.summary===initial.summary?next.summary??'':(next.summary??'').trim(), ...Object.fromEntries((['occurredAt', 'action', 'result', 'reflection'] as const).filter(key => next[key] !== initial[key]).map(key => [key, (next[key] ?? '').trim()])) }
}

export function recordLocalCorrection(previous: RecordDraft, initial: RecordDraft, next: RecordDraft): RecordDraft {
  return { ...previous, ...recordCorrectionContent(initial, next) }
}

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
