import { pool, HttpError } from './db.ts'
import { growthView } from './growth.ts'
import { getMemoryView } from './memory.ts'
import { retrieveExperiences, requireVisibleConversation } from './store.ts'
import { readIdentityClaims } from './identity.ts'
import { extractSkillTags } from './starmap-enrichment.ts'
import { readStarMapContext } from './user-themes.ts'
import {scanUserClauses} from './user-command-spans.ts'
import {clauseReportsPastAction} from './experience-content.ts'
import {currentExperienceEvidence} from './growth-privacy.ts'
import { UNDERSTANDING_DIMENSIONS, type UnderstandingItem, type UnderstandingView, type UnderstandingDimension } from '../src/features/conversation/product-modes.ts'

export function understandingDimension(kind: string, text: string): UnderstandingDimension {
  if (/习惯|通常|做事方式|做事风格|我倾向|每次/.test(text)) return 'behavior'
  if (['goal', 'direction', 'priority', 'decision'].includes(kind)) return 'direction'
  if (kind === 'constraint' || /可用时间|每周|这周|预算|精力|经济约束/.test(text)) return 'constraints'
  if (kind === 'ability' || kind === 'feedback') return 'experience'
  return kind === 'preference' ? 'values' : 'background'
}
export async function personalUnderstanding(user: string, conversation?: string): Promise<UnderstandingView> {
  if (conversation) await requireVisibleConversation(user, conversation)
  const settings = async () => (await pool.query('SELECT enabled,revision FROM user_memory_settings WHERE user_id=$1', [user])).rows[0] ?? { enabled: false, revision: 0 }
  const before = await settings()
  const view: UnderstandingView = { memoryEnabled: before.enabled, memoryRevision: before.revision, dimensions: UNDERSTANDING_DIMENSIONS.map(d => ({ ...d, items: [] })), themes: [], skills: [] }
  // This read projection is not a second profile. OFF returns no cross-session
  // personal data, even when the management APIs allow inspecting old records.
  if (!before.enabled) return view
  const [growth, memory, experiences, starMap] = await Promise.all([growthView(user, conversation), getMemoryView(user, conversation), retrieveExperiences(user, { query: '', limit: 10 }), readStarMapContext(pool, user)])
  const add = (dimension: UnderstandingDimension, item: UnderstandingItem) => {
    const rows = view.dimensions.find(d => d.id === dimension)!.items
    if (!rows.some(row => row.family === item.family && row.id === item.id)) rows.push(item)
  }
  const active = growth.items.filter(item => item.sources.length > 0 && !item.unavailableReason && !item.recommendationStopped && ['active', 'proposed'].includes(item.status))
  for (const item of active) add(understandingDimension(item.kind, item.text), {
    id: item.id, family: 'growth', revision: item.revision, text: item.text,
    state: item.kind === 'unknown' || item.assertion === 'unknown' ? 'unknown' : item.assertion === 'ai_observation' ? 'observation' : 'fact', confirmed: item.status === 'active',
    sources: item.sources.map(source => ({ quote: source.quote, label: source.type === 'user_edit' ? '本人手动修改' : '用户原话', conversationId: item.conversationId, ...(source.type === 'message' ? { messageId: source.id } : {}) })),
    actions: [...(item.status === 'proposed' ? ['accept' as const] : []), 'correct', 'reject', 'forget'], note: item.limitation || '保留原事项和记录时间；是否适用于新的问题需重新核对。',
  })
  for (const item of memory.items.filter(item => item.sources.length > 0 && item.sourceValidity === 'valid' && ['active', 'unknown', 'pending', 'accepted'].includes(item.status) && (item.scope === 'user' || (conversation && item.taskConversationId === conversation)))) {
    const pattern = item.kind === 'pattern_candidate'
    const value = pattern ? `${item.value?.context ?? ''}时，可能会${item.value?.behavior ?? ''}，结果是${item.value?.outcome ?? ''}。` : item.value === null ? '尚未确认' : String(item.value)
    add(pattern ? 'behavior' : item.key?.startsWith('education.') ? 'background' : item.key === 'skills' ? 'experience' : 'constraints', { id: item.id, family: 'memory', revision: item.revision, text: value, state: pattern ? 'observation' : item.status === 'unknown' ? 'unknown' : 'fact', confirmed: item.status === 'accepted' || !pattern, sources: item.sources.map(source => ({ quote: source.quote, label: source.conversationTitle ?? source.label ?? '已保存的本人来源' })), actions: pattern ? [...(item.status === 'pending' ? ['accept' as const, 'reject' as const] : []), 'forget'] : ['correct', 'forget'], note: pattern ? '候选解释，即使认可也不代表稳定人格。' : undefined })
  }
  const tags = new Map<string, number>()
  const corrections = new Map((await pool.query(`SELECT DISTINCT ON (experience_id) experience_id,revision,snapshot FROM experience_revisions
    WHERE user_id=$1 AND experience_id=ANY($2::uuid[]) AND action='correct' AND snapshot->'correction'->>'version'='1' AND snapshot->'correction'->'changedFields' ? 'summary'
    ORDER BY experience_id,revision DESC`,[user,experiences.records.map(e=>e.id)])).rows.map(row=>[row.experience_id,row]))
  for (const e of await currentExperienceEvidence(pool,user,experiences.records)) {
    const originalQuote=experiences.records.find(row=>row.id===e.id)?.source_quote??e.source_quote
    const correction=corrections.get(e.id)
    const corrected=e.correctionProjection||(correction&&correction.revision<=e.revision&&correction.snapshot?.content?.summary===e.content?.summary)
    const text=e.correctionProjection?e.quote:corrected?String(e.content.summary):e.source_quote
    const practice=scanUserClauses(text).filter(c=>!c.quoted&&!c.code&&!c.conditional&&!c.interrogative&&!c.attributedToOther&&clauseReportsPastAction(c.text)).map(c=>c.text).join('；')
    const skills = extractSkillTags('', '', practice)
    for (const tag of new Set(skills)) tags.set(tag, (tags.get(tag) ?? 0) + 1)
    add('experience', { id: e.id, family: 'experience', revision: e.revision, text, state: 'fact', confirmed: true, sources: corrected?[{quote:text,label:'本人版本化更正'},{ quote: originalQuote, label: '当时原话（以更正为准）', messageId: e.source_message_id }]:[{ quote: e.source_quote, label: '本人已确认经历', messageId: e.source_message_id }], actions: ['correct', 'forget'], note: skills.length ? `这段实践涉及${skills.join('、')}；不等同于稳定职业能力。` : '记录本人承担的行动与反馈；能力熟练度仍需更多证据。' })
  }
  const client = await pool.connect()
  try {
    const live = new Set(active.filter(item => item.status === 'active').map(item => item.id))
    for (const claim of await readIdentityClaims(client, user)) {
      const refs = claim.source_refs ?? []
      if (!refs.length || !refs.every((ref: any) => ref.type === 'user_edit' ? ref.quote === claim.text && claim.confirmed_by_user : live.has(ref.growthItemId))) continue
      add('behavior', { id: claim.id, family: 'identity', revision: 1, text: claim.text, state: claim.confirmed_by_user ? 'fact' : 'observation', confirmed: claim.confirmed_by_user, sources: refs.map((ref: any) => ({ quote: ref.quote, label: ref.type === 'user_edit' ? '本人直接修改' : '有来源的自我描述' })), actions: [...(!claim.confirmed_by_user ? ['accept' as const] : []), 'correct', 'reject', 'forget'], note: '本人自述，不作为人格测评或永久标签。' })
    }
  } finally { client.release() }
  view.themes = (starMap?.themes ?? []).filter(t => t.status === 'active').map(t => ({ id: t.id, title: t.title, status: t.status }))
  view.skills = [...tags].map(([tag, count]) => ({ tag, count }))
  const after = await settings()
  if (after.enabled !== before.enabled || after.revision !== before.revision) throw new HttpError(409, 'MEMORY_SNAPSHOT_INVALIDATED')
  return view
}
