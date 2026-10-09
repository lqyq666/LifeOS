// 我的成长主题：growth_items 已提交事实之上的确定性投影，不新增模型调用。
// 只有用户亲口说的 goal/direction/priority 成为 active 主题；preference/interest
// 证据不足时保持 pending（待核对）。主题身份、来源引用和修订由服务器控制，
// 用户可置顶、重命名、暂缓、撤销（userThemeAction），全部持久化。
import type { PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'

export type ThemeKind = 'goal' | 'pursuit' | 'valued_point' | 'interest'
export type GrowthFact = {
  id: string
  kind: string
  text: string
  assertion: string
  status: string
}

// 标题来自用户原话，去掉愿望引导词后截断；原文完整保留在 source_refs 里。
const WISH_PREFIX = /^(?:我)?(?:想|要|打算|准备|希望|计划|决定|争取)+(?:去)?/
// 去掉时间/语境前缀和「目标是/重点是」连接词，让标题落在追求本身。
const CONTEXT_PREFIX = [/^(?:这|本|下|新)?(?:学期|学年|阶段|月|周)/, /^(?:接下来|近期|目前|现在)/, /^(?:最重要?的?)?(?:目标|重点|计划|追求|方向|安排)(?:是)?/]
export function themeTitle(text: string): string {
  let stripped = text.trim()
  for (let round = 0; round < 4; round++) {
    const before = stripped
    stripped = stripped.replace(WISH_PREFIX, '')
    for (const prefix of CONTEXT_PREFIX) stripped = stripped.replace(prefix, '')
    if (stripped === before) break
  }
  stripped = stripped.trim()
  return (stripped || text).slice(0, 24)
}
// 以过去时间词开头的陈述是事件报告，不是追求——不投影为主题。
const PAST_EVENT_OPEN = /^(?:上周|上个月|上月|昨天|前天|上次|之前|当时|上学期|上年)/
// 主题必须带有意图词：目标/想要/打算/不再……。模型的 feedback/direction
// 误分类（"部长说效果还不错"）没有意图词，进不了主题。
const INTENT_MARKER = /(?:想|要|打算|准备|希望|计划|决定|争取|目标|重点|优先|不再|不想|追求)/
const normalize = (text: string) => text.replace(WISH_PREFIX, '').replace(/[\s，。、！？?！,.\-—]/g, '')

export type ThemeCandidate = { kind: ThemeKind; title: string; sourceGrowthId: string; quote: string }

// goal/direction/priority（用户亲述）→ active；preference/interest（用户亲述）→
// pending 待核对；ai_observation 与其它 kind 不投影——AI 只提解释候选，
// 不直接长出主题。
export function deriveThemeCandidates(facts: readonly GrowthFact[]): ThemeCandidate[] {
  const candidates: ThemeCandidate[] = []
  for (const fact of facts) {
    if (fact.status !== 'active' || !['user_reported', 'user_edit'].includes(fact.assertion)) continue
    const quote = fact.text.trim()
    if (!quote) continue
    if (PAST_EVENT_OPEN.test(quote)) continue
    if (['goal', 'direction', 'priority'].includes(fact.kind)) {
      if (!INTENT_MARKER.test(quote)) continue
      candidates.push({ kind: 'pursuit', title: themeTitle(quote), sourceGrowthId: fact.id, quote })
    } else if (fact.kind === 'preference') candidates.push({ kind: 'valued_point', title: themeTitle(quote), sourceGrowthId: fact.id, quote })
  }
  return candidates
}

export type ThemeRow = {
  id: string
  title: string
  kind: ThemeKind
  status: string
  origin: string
  summary: string
  source_refs: { growthItemId: string; quote: string }[]
  pinned: boolean
  revision: number
}

// 幂等上投影：同一来源 growth 项或同义标题只更新既有主题（修订+1、追加证据），
// 不重复建主题。retired 的主题不因同义新述复活——用户撤销过就是撤销过，
// 除非新的来源证据指向它（换 growth 项）时以 pending 重新出现。
export function mergeThemeCandidates(existing: readonly ThemeRow[], candidates: readonly ThemeCandidate[]): { insert: ThemeCandidate[]; update: { row: ThemeRow; candidate: ThemeCandidate }[] } {
  const insert: ThemeCandidate[] = [], update: { row: ThemeRow; candidate: ThemeCandidate }[] = []
  for (const candidate of candidates) {
    const bySource = existing.find(row => row.source_refs.some(ref => ref.growthItemId === candidate.sourceGrowthId))
    const byTitle = existing.find(row => row.status !== 'retired' && normalize(row.title) === normalize(candidate.title))
    const target = bySource ?? byTitle
    if (target) {
      if (target.source_refs.some(ref => ref.growthItemId === candidate.sourceGrowthId)) continue
      update.push({ row: target, candidate })
      continue
    }
    if (existing.some(row => row.status === 'retired' && normalize(row.title) === normalize(candidate.title))) continue
    insert.push(candidate)
  }
  return { insert, update }
}

// 经历→主题的关系判定：主题标题的实词片段出现在经历原话里才连线，关系类型
// 按主题类型与经历形态决定；没有重叠就不连（不相关经历不强行连线）。
// 标题的滑窗二元/三元片段作为主题锚词：主题和经历只要共享一个实义片段就
// 有连线的资格；功能词片段被排除。
const STOP_TOKENS = new Set(['自己', '现在', '想要', '打算', '准备', '希望', '可以', '因为', '但是', '而且', '然后', '所以', '时候', '觉得', '可能', '一个', '这个', '那个', '什么', '怎么', '上周', '昨天', '今天', '明天', '前天', '这周', '下周', '上周五', '这学', '学期', '时候', '最近', '后来', '上次'])
export function themeTokens(title: string): string[] {
  const normalized = title.replace(/[\s，。、；！？?！,.\-—我要想去]/g, '')
  const tokens = new Set<string>()
  for (let size = 2; size <= 3; size++) for (let i = 0; i + size <= normalized.length; i++) tokens.add(normalized.slice(i, i + size))
  return [...tokens].filter(token => !STOP_TOKENS.has(token))
}

export type ThemeRelation = 'exploring' | 'acting_toward' | 'partial_evidence'
export function relationForExperience(theme: { kind: ThemeKind; title?: string }, experienceText: string, completedAction: boolean): { relation: ThemeRelation; token: string } | null {
  if (!theme.title) return null
  const token = themeTokens(theme.title).find(token => experienceText.includes(token))
  if (!token) return null
  if ((theme.kind === 'goal' || theme.kind === 'pursuit') && completedAction) return { relation: 'acting_toward', token }
  if (theme.kind === 'interest' || theme.kind === 'valued_point') return { relation: 'exploring', token }
  return { relation: 'partial_evidence', token }
}

// 事务内投影：facts 是本轮新提交（或修正后仍有效）的 growth 项。返回发生变化
// 的主题 id 供前端提示。查询和写入都在调用方的事务客户端里完成。
export async function projectUserThemes(c: PoolClient, user: string, newFacts: readonly GrowthFact[]): Promise<string[]> {
  if (!newFacts.length) return []
  const existing = (await c.query('SELECT id, title, kind, status, origin, summary, source_refs, pinned, revision FROM user_themes WHERE user_id=$1', [user])).rows as ThemeRow[]
  const { insert, update } = mergeThemeCandidates(existing, deriveThemeCandidates(newFacts))
  const changed: string[] = []
  for (const candidate of insert) {
    const id = randomUUID()
    await c.query('INSERT INTO user_themes(user_id, id, title, kind, status, origin, summary, source_refs, pinned) VALUES($1,$2,$3,$4,$5,\'user_stated\',$6,$7,false)', [
      user, id, candidate.title, candidate.kind, candidate.kind === 'pursuit' ? 'active' : 'pending',
      `来自你说的：「${candidate.quote}」`, JSON.stringify([{ growthItemId: candidate.sourceGrowthId, quote: candidate.quote }]),
    ])
    changed.push(id)
  }
  for (const { row, candidate } of update) {
    const refs = [...row.source_refs, { growthItemId: candidate.sourceGrowthId, quote: candidate.quote }]
    await c.query('UPDATE user_themes SET source_refs=$3, summary=$4, revision=revision+1, updated_at=now(), status=CASE WHEN status=\'pending\' AND $5=\'pursuit\' THEN \'active\' ELSE status END WHERE user_id=$1 AND id=$2', [
      user, row.id, JSON.stringify(refs), row.summary || `来自你说的：「${candidate.quote}」`, candidate.kind,
    ])
    changed.push(row.id)
  }
  return changed
}

// 事务内连线：把（新或合并后的）经历挂到活跃主题上；同一对已存在则跳过。
export async function linkExperienceToThemes(c: PoolClient, user: string, experienceId: number | string, experienceText: string, completedAction: boolean): Promise<number> {
  const themes = (await c.query("SELECT id, kind, title FROM user_themes WHERE user_id=$1 AND status IN ('active','pending')", [user])).rows as { id: string; kind: ThemeKind; title?: string }[]
  let linked = 0
  for (const theme of themes) {
    const relation = relationForExperience(theme, experienceText, completedAction)
    if (!relation) continue
    const result = await c.query(`INSERT INTO experience_theme_links(user_id, experience_id, theme_id, relation, reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id, experience_id, theme_id) DO NOTHING`, [user, experienceId, theme.id, relation.relation, `经历原话提到「${relation.token}」`])
    if (result.rowCount) linked++
  }
  return linked
}
