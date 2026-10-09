// 我的成长主题：growth_items 已提交事实之上的确定性投影，不新增模型调用。
// 只有用户亲口说的 goal/direction/priority 成为 active 主题；preference/interest
// 证据不足时保持 pending（待核对）。主题身份、来源引用和修订由服务器控制，
// 用户可置顶、重命名、暂缓、撤销（userThemeAction），全部持久化。
import type { PoolClient } from 'pg'
import { distinctiveGrams } from './experience-episodes.ts'

// 路径同义词表：主题锚词除标题片段外，还接受该路径的领域词（行测↔考公、
// 雅思↔留学）。这只是连线候选的召回面；成线仍需本人经历原文包含锚词。
const PATH_SYNONYMS: [RegExp, string[]][] = [
  [/考公|公务员|考编/, ['行测', '申论', '公考', '编制']],
  [/考研|研究生考试/, ['政治', '英语一', '专业课', '真题', '复习']],
  [/保研|推免/, ['绩点', '六级', '科研训练', '综合测评', '排名']],
  [/留学|申请.*研究生|出境/, ['雅思', '托福', 'GRE', '文书', '套磁']],
  [/就业|求职|实习|offer/, ['简历', '面试', '笔试', '群面', 'offer']],
  [/创业/, ['需求验证', '访谈', '商业计划', '路演', '种子用户', 'bp']],
  [/自由职业|接单/, ['甲方', '客户', '稿费', '尾款']],
  [/自媒体|内容创作|博主/, ['涨粉', '选题', '投稿', '账号', '剪辑']],
  [/科研/, ['文献综述', '实验室', '导师', '论文']],
  [/竞赛|建模/, ['数模', '美赛', '国赛', '队伍']],
]
export function themeAnchors(title: string): string[] {
  const anchors = [...distinctiveGrams(title)]
  for (const [pattern, synonyms] of PATH_SYNONYMS) if (pattern.test(title)) anchors.push(...synonyms)
  return anchors
}
import { randomUUID } from 'node:crypto'

export type ThemeKind = 'goal' | 'pursuit' | 'exploration' | 'valued_point' | 'interest'
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
const CONTEXT_PREFIX = [/^(?:这|本|下|新)?(?:学期|学年|阶段|月|周)/, /^(?:接下来|近期|目前|现在)/, /^(?:我)?(?:最重要?的?)?(?:目标|重点|计划|追求|方向|安排)(?:是)?/, /^(?:每周|每天|这周|本周|长期)/]
export function themeTitle(text: string): string {
  let stripped = text.trim()
  for (let round = 0; round < 5; round++) {
    const before = stripped
    stripped = stripped.replace(WISH_PREFIX, '')
    for (const prefix of CONTEXT_PREFIX) stripped = stripped.replace(prefix, '')
    stripped = stripped.replace(/^(?:和|跟|与|先|再|去|要)+/, '').replace(/^(?:同学|朋友|室友)(?:一起)?/, '')
    stripped = stripped.replace(/^(?:同时)?(?:也)?(?:还)?(?:在)?(?:考虑|想着?|犹豫)/, '')
    if (stripped === before) break
  }
  stripped = stripped.trim()
  // 逗号前已是完整追求时取主干（“考研，目标本校计算机”→“考研”）。
  const comma = stripped.search(/[，,；;]/)
  if (comma >= 2 && comma <= 10) stripped = stripped.slice(0, comma)
  const cleaned = stripped.replace(/(?:一个|一类|之类的|的话|比较|真的|就是)/g, '').trim()
  return (cleaned || text).slice(0, 14)
}
// 以过去时间词开头的陈述是事件报告，不是追求——不投影为主题。
const PAST_EVENT_OPEN = /^(?:上周|上个月|上月|昨天|前天|上次|之前|当时|上学期|上年)/
// 第三方故事不是本人追求（纵深防御：分句归属已挡一道）。
const THIRD_PARTY = /(?:他|她|它)(?:说|打算|想|决定|要)|室友说|同学说|朋友说|别人|老师说|父母说|爸妈说/
// 主题必须带有意图词：目标/想要/打算/不再……。模型的 feedback/direction
// 误分类（"部长说效果还不错"）没有意图词，进不了主题。
const INTENT_MARKER = /(?:想|要|打算|准备|希望|计划|决定|争取|目标|重点|优先|不再|不想|追求)/
const normalize = (text: string) => text.replace(WISH_PREFIX, '').replace(/[\s，。、！？?！,.\-—]/g, '')

export type ThemeCandidate = { kind: ThemeKind; title: string; sourceGrowthId: string; quote: string }

// 语义分级（P1）：
//   “我决定X/目标是X” → pursuit（active 明确追求）；
//   “我考虑X/想试试X/未来再X” → exploration（pending 尚不确定，正在探索）；
//   “我不想X/放弃X” → 不是追求，绝不提升成主题；
//   “不再熬夜”这类边界意图仍是 pursuit；
//   “先就业，以后再创业”分句后：就业=pursuit，创业=exploration。
const REJECTED_PURSUIT = /(?:不想|不打算|不考虑|放弃|没兴趣|不走)/
const BOUNDARY_PURSUIT = /(?:不再|不想再|要避免|要改掉)/
const FUTURE_MARK = /(?:未来|以后|之后|下一步|毕业后再)/
const EXPLORING_MARK = /(?:考虑|在想|也许|可能|想试试|试试|了解一下|了解下|探索|纠结|犹豫|倾向|感兴趣)/
const DECIDED_MARK = /(?:决定|确定|定了|一定要|铁了心|就选)/
export function pursuitLevel(quote: string): { kind: 'pursuit' | 'exploration'; status: 'active' | 'pending' } | null {
  if (REJECTED_PURSUIT.test(quote) && !BOUNDARY_PURSUIT.test(quote)) return null
  if (BOUNDARY_PURSUIT.test(quote)) return { kind: 'pursuit', status: 'active' }
  if (EXPLORING_MARK.test(quote) && !DECIDED_MARK.test(quote)) return { kind: 'exploration', status: 'pending' }
  if (FUTURE_MARK.test(quote) && !DECIDED_MARK.test(quote)) return { kind: 'exploration', status: 'pending' }
  return { kind: 'pursuit', status: 'active' }
}

// goal/direction/priority（用户亲述）投影；preference → 重视点（待核对）；
// ai_observation 与其它 kind 不投影——AI 只提解释候选，不直接长出主题。
export function deriveThemeCandidates(facts: readonly GrowthFact[]): ThemeCandidate[] {
  const candidates: ThemeCandidate[] = []
  const seen = new Set<string>()
  for (const fact of facts) {
    if (fact.status !== 'active' || !['user_reported', 'user_edit'].includes(fact.assertion)) continue
    const quote = fact.text.trim()
    if (!quote) continue
    if (PAST_EVENT_OPEN.test(quote) || THIRD_PARTY.test(quote)) continue
    let kind: ThemeKind, status: 'active' | 'pending'
    if (['goal', 'direction', 'priority', 'decision'].includes(fact.kind)) {
      if (!INTENT_MARKER.test(quote) && !EXPLORING_MARK.test(quote) && !BOUNDARY_PURSUIT.test(quote)) continue
      const level = pursuitLevel(quote)
      if (!level) continue
      kind = level.kind; status = level.status
    } else if (fact.kind === 'preference') { kind = 'valued_point'; status = 'pending' }
    else continue
    const title = themeTitle(quote)
    const dedupeKey = kind + '|' + normalize(title)
    if (seen.has(dedupeKey)) continue
    // 同义主题合并：同类且一方标题完整包含另一方（保研 ⊂ 保研成功）只留
    // 第一条；共享“目标”这类功能词不算同义。
    const normalizedTitle = normalize(title)
    const synonym = candidates.some(candidate => candidate.kind === kind && (normalizedTitle.includes(normalize(candidate.title)) || normalize(candidate.title).includes(normalizedTitle)))
    if (synonym) continue
    seen.add(dedupeKey)
    candidates.push({ kind, title, status, sourceGrowthId: fact.id, quote } as ThemeCandidate)
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

export type ThemeRelation = 'exploring' | 'acting_toward' | 'partial_evidence' | 'constraint' | 'correction'
// 关系语义（P2）：主题锚词（标题滑窗片段）只是候选召回；成线必须共享一个
// 区别性词元（不含通用活动词），否则宁可不连。关系类型按主题类型与经历
// 形态判定，措辞只陈述原文证据，不推断未发生的结果。
export function relationForExperience(theme: { kind: ThemeKind; title?: string }, experienceText: string, completedAction: boolean): { relation: ThemeRelation; token: string } | null {
  if (!theme.title) return null
  const anchors = themeAnchors(theme.title)
  const token = anchors.find(token => experienceText.includes(token))
  if (!token) return null
  // 通用词（海报/一套/设计…）不足以证明这条经历与这个主题有关；标题的
  // 区别性词元或该路径的领域词被经历原文提到才算成线。
  const verified = themeAnchors(theme.title).some(anchor => experienceText.includes(anchor))
  if (!verified) return null
  if ((theme.kind === 'goal' || theme.kind === 'pursuit') && completedAction) return { relation: 'acting_toward', token }
  if (theme.kind === 'exploration' || theme.kind === 'interest' || theme.kind === 'valued_point') return { relation: 'exploring', token }
  return { relation: 'partial_evidence', token }
}

// 事务内投影：facts 是本轮新提交（或修正后仍有效）的 growth 项。返回发生变化
// 的主题 id 供前端提示。查询和写入都在调用方的事务客户端里完成。
export async function projectUserThemes(c: PoolClient, user: string, newFacts: readonly GrowthFact[]): Promise<string[]> {
  if (!newFacts.length) return []
  const existing = (await c.query('SELECT id, title, kind, status, origin, summary, source_refs, pinned, revision FROM user_themes WHERE user_id=$1', [user])).rows as ThemeRow[]
  const changed: string[] = []
  // 显式否定同一追求（“我不打算考公了”）：退休同义主题，不等模型是否
  // 用 correct 改写旧条目。边界意图（“不再熬夜”）不是否定，不受影响。
  for (const fact of newFacts) {
    if (!['user_reported', 'user_edit'].includes(fact.assertion) || fact.status !== 'active') continue
    const domain = fact.text.trim().replace(/^我(?:不想|不打算|放弃|没兴趣)+/, '').replace(/了$/, '')
    if (domain.length < 2 || domain === fact.text.trim()) continue
    const domainAnchors = new Set([...distinctiveGrams(domain), ...themeAnchors(domain)])
    for (const theme of existing.filter(row => row.status === 'active' || row.status === 'pending')) {
      const matched = themeAnchors(theme.title).some(anchor => domainAnchors.has(anchor)) || [...distinctiveGrams(theme.title)].some(gram => domain.includes(gram))
      if (!matched) continue
      await c.query("UPDATE user_themes SET status='retired', revision=revision+1, updated_at=now() WHERE user_id=$1 AND id=$2", [user, theme.id])
      await c.query("UPDATE experience_theme_links SET status='retired', revision=revision+1 WHERE user_id=$1 AND theme_id=$2 AND status='active'", [user, theme.id])
      changed.push(theme.id)
    }
  }
  const { insert, update } = mergeThemeCandidates(existing, deriveThemeCandidates(newFacts))
  for (const candidate of insert) {
    const id = randomUUID()
    await c.query('INSERT INTO user_themes(user_id, id, title, kind, status, origin, summary, source_refs, pinned) VALUES($1,$2,$3,$4,$5,\'user_stated\',$6,$7,false)', [
      user, id, candidate.title, candidate.kind, (candidate as any).status ?? (candidate.kind === 'pursuit' ? 'active' : 'pending'),
      `来自你说的：「${candidate.quote}」`, JSON.stringify([{ growthItemId: candidate.sourceGrowthId, quote: candidate.quote }]),
    ])
    changed.push(id)
    // 回填：主题出现在经历之后时，既有经历也按同一验证规则连过来。
    const backfill=(await c.query("SELECT id, source_quote, content FROM experiences WHERE user_id=$1 AND status='confirmed'",[user])).rows
    for(const experience of backfill){
      await linkExperienceToThemes(c,user,experience.id,`${experience.source_quote} ${experience.content?.action??''} ${experience.content?.result??''}`,true)
    }
  }
  for (const { row, candidate } of update) {
    const refs = [...row.source_refs, { growthItemId: candidate.sourceGrowthId, quote: candidate.quote }]
    await c.query('UPDATE user_themes SET source_refs=$3, summary=$4, revision=revision+1, updated_at=now(), status=CASE WHEN status=\'pending\' AND $5=\'pursuit\' THEN \'active\' ELSE status END WHERE user_id=$1 AND id=$2', [
      user, row.id, JSON.stringify(refs), row.summary || `来自你说的：「${candidate.quote}」`, candidate.kind,
    ])
    changed.push(row.id)
  }
  return [...new Set(changed)]
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

// 生命周期 reconcile：主题跟随其来源 growth 事实的当前状态。
//   更正 → 同步标题与依据；取代/暂停/完成 → 主题转 paused；
//   拒绝/遗忘 → 主题 retired 且连线退休；遗忘的原话不得残留在可见
//   summary/source_refs；用户手动改过的标题（title_locked）不被覆盖。
export async function reconcileThemesWithGrowth(c: PoolClient, user: string): Promise<void> {
  const themes = (await c.query("SELECT id, title, kind, status, summary, source_refs, title_locked FROM user_themes WHERE user_id=$1 AND status IN ('active','pending','paused')", [user])).rows as (ThemeRow & { title_locked: boolean })[]
  if (!themes.length) return
  const refIds = [...new Set(themes.flatMap(theme => theme.source_refs.map(ref => ref.growthItemId)))]
  const facts = new Map((await c.query('SELECT id, kind, text, status FROM growth_items WHERE user_id=$1 AND id=ANY($2::uuid[])', [user, refIds])).rows.map((row: any) => [row.id as string, row]))
  for (const theme of themes) {
    const statuses = theme.source_refs.map(ref => facts.get(ref.growthItemId)?.status ?? 'missing')
    const live = theme.source_refs.filter((_, index) => statuses[index] === 'active')
    if (!live.length) {
      const fatal = theme.source_refs.some((_, index) => ['forgotten', 'rejected', 'missing'].includes(statuses[index]!))
      const nextStatus = fatal ? 'retired' : 'paused'
      // 被遗忘/拒绝的原话即使主题退休也不得残留：可见字段一并清理。
      const keep = theme.source_refs.filter((_, index) => !['forgotten', 'rejected'].includes(statuses[index]!))
      await c.query("UPDATE user_themes SET status=$3, revision=revision+1, updated_at=now(), source_refs=$4, summary=CASE WHEN $5 THEN summary ELSE '' END WHERE user_id=$1 AND id=$2", [user, theme.id, nextStatus, JSON.stringify(keep), keep.length > 0])
      if (nextStatus === 'retired') await c.query("UPDATE experience_theme_links SET status='retired', revision=revision+1 WHERE user_id=$1 AND theme_id=$2 AND status='active'", [user, theme.id])
      continue
    }
    if (live.length !== theme.source_refs.length) {
      // 只保留仍有效的来源；summary 由剩余原话重建，被遗忘的话不再可见。
      await c.query('UPDATE user_themes SET source_refs=$3, summary=$4, revision=revision+1, updated_at=now() WHERE user_id=$1 AND id=$2', [user, theme.id, JSON.stringify(live), live.map(ref => `「${ref.quote}」`).join('')])
    }
    if (!theme.title_locked) {
      const primary = facts.get(live[live.length - 1]!.growthItemId)
      if (!primary) continue
      // 更正可能改写追求本身：重新分级。被明确否定的追求（“我不打算考公了”）
      // 退休主题；从决定降为考虑则转为 exploration/pending。
      const level = pursuitLevel(primary.text)
      if (!level) {
        await c.query("UPDATE user_themes SET status='retired', revision=revision+1, updated_at=now() WHERE user_id=$1 AND id=$2", [user, theme.id])
        await c.query("UPDATE experience_theme_links SET status='retired', revision=revision+1 WHERE user_id=$1 AND theme_id=$2 AND status='active'", [user, theme.id])
        continue
      }
      if (themeTitle(primary.text) !== theme.title || theme.kind !== level.kind) {
        await c.query("UPDATE user_themes SET title=$3, kind=$4, status=CASE WHEN $5='pending' AND status='active' THEN 'pending' ELSE status END, revision=revision+1, updated_at=now() WHERE user_id=$1 AND id=$2", [user, theme.id, themeTitle(primary.text), level.kind, level.status])
      }
    }
  }
}

// P3 有界读取：星图作为教练轮次的决策依据注入（同一次模型调用，不加路由）。
// 只读当前有效主题、用户设置、已验证连线的经历摘要、现实约束和边界；
// 候选关系显式标注 candidate，绝不冒充已确认。
export type StarMapContext = {
  themes: { id: string; title: string; kind: string; status: string; pinned: boolean }[]
  linkedExperiences: { themeTitle: string; relation: string; candidate: boolean; summary: string }[]
  constraints: string[]
  boundaries: string[]
}
export async function readStarMapContext(c: PoolClient, user: string): Promise<StarMapContext | null> {
  const themes = (await c.query("SELECT id, title, kind, status, pinned FROM user_themes WHERE user_id=$1 AND status IN ('active','pending') ORDER BY pinned DESC, updated_at DESC LIMIT 3", [user])).rows
  if (!themes.length) return null
  const links = (await c.query(`SELECT t.title AS theme_title, l.relation, l.status, left(e.content->>'summary', 80) AS summary
    FROM experience_theme_links l JOIN user_themes t ON t.user_id=l.user_id AND t.id=l.theme_id
    JOIN experiences e ON e.user_id=l.user_id AND e.id=l.experience_id AND e.status='confirmed'
    WHERE l.user_id=$1 AND t.status IN ('active','pending') ORDER BY l.created_at DESC LIMIT 6`, [user])).rows
  const constraints = (await c.query("SELECT text FROM growth_items WHERE user_id=$1 AND kind='constraint' AND status='active' ORDER BY updated_at DESC LIMIT 3", [user])).rows.map((row: any) => row.text)
  const boundaries = (await c.query("SELECT title FROM user_themes WHERE user_id=$1 AND status IN ('paused','retired') ORDER BY updated_at DESC LIMIT 5", [user])).rows.map((row: any) => row.title)
  return {
    themes: themes.map((theme: any) => ({ id: theme.id, title: theme.title, kind: theme.kind, status: theme.status, pinned: theme.pinned })),
    linkedExperiences: links.map((link: any) => ({ themeTitle: link.theme_title, relation: link.relation, candidate: false, summary: link.summary })),
    constraints,
    boundaries,
  }
}
