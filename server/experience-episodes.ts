// 同一事件多轮讲述：新候选与既有经历的引用做字符二元组（bigram）相似度，
// 阈值以上合并进原经历（身份不变、修订+1），不另立新行。合并只补空字段或
// 追加反思，绝不覆盖用户已确认的内容。
export type EpisodeExisting = {
  id: string
  source_quote: string
  content: { action?: string; result?: string; reflection?: string; occurredAt?: string }
}

export function bigrams(text: string): Set<string> {
  const normalized = text.replace(/[\s，。、；！？?!.,]/g, '')
  const grams = new Set<string>()
  for (let i = 0; i + 2 <= normalized.length; i++) grams.add(normalized.slice(i, i + 2))
  return grams
}

export function episodeSimilarity(a: string, b: string): number {
  const left = bigrams(a), right = bigrams(b)
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared++
  // Overlap coefficient: a retelling is usually shorter than the original, so
  // Jaccard would punish exactly the case we want to catch.
  return shared / Math.min(left.size, right.size)
}

export function sharedBigramCount(a: string, b: string): number {
  const left = bigrams(a), right = bigrams(b)
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared++
  return shared
}

// 通用活动词汇：同一领域里大量不同事件都会出现的词，永远不能作为“同一
// 事件”的证据（两次不同活动的海报可以共享“海报/一套/设计/学院”的全部
// 二元组）。区别性词元 = 不含通用词的二元/三元片段。
const GENERIC_WORDS = new Set(['海报', '推文', '视频', '文章', '课件', '作品', '方案', '一套', '设计', '制作', '排版', '剪辑', '整理', '交付', '完成', '提交', '学院', '社团', '学校', '宣传', '活动', '材料', '清单', '比赛', '项目', '简历', '面试', '老师', '导师', '部长', '同学', '学长', '负责人', '反馈', '效果', '报名', '参加', '主动', '联系', '决定', '选择'])
const TIME_TOKEN = /(?:上周[一二三四五六日天]?|本周|这周|下周|昨天|今天|前天|\d{1,2}月\d{1,2}[日号]?|\d{4}年)/g

function gramsOf(text: string): Set<string> {
  const normalized = text.replace(/[\s，。、；！？?!,.]/g, '')
  const grams = new Set<string>()
  for (let i = 0; i + 2 <= normalized.length; i++) {
    grams.add(normalized.slice(i, i + 2))
    if (i + 3 <= normalized.length) grams.add(normalized.slice(i, i + 3))
  }
  return grams
}
export function distinctiveGrams(text: string): Set<string> {
  return new Set([...gramsOf(text)].filter(gram => ![...GENERIC_WORDS].some(word => gram.includes(word))))
}
function sharedDistinctiveCount(a: string, b: string): number {
  const left = distinctiveGrams(a)
  let shared = 0
  for (const gram of distinctiveGrams(b)) if (left.has(gram)) shared++
  return shared
}
// 双方都写了明确时间且互不相同时，视为不同场次：对象相似也不合并。
export function timeContradiction(a: string, b: string): boolean {
  const timesOf = (text: string) => new Set(text.match(TIME_TOKEN) ?? [])
  const left = timesOf(a), right = timesOf(b)
  if (!left.size || !right.size) return false
  for (const time of left) if (right.has(time)) return false
  return true
}

// 0.40 重叠系数 + 至少 6 个共享片段：同一件事的复述共享核心词对，不同事情
// （哪怕同一领域）远低于此。宁可漏合并（多一条经历、用户可删），不可错合并。
// 显式追述（"上次那套海报后来…"）放宽到 0.30：说话人已表明在说同一件事，
// 合并只补结果/反思，不新增身份。
const MERGE_THRESHOLD = 0.40, BACK_REFERENCE_THRESHOLD = 0.20, MIN_SHARED = 6
const BACK_REFERENCE = /上次那|上次说|上次提到|之前那次|之前说的|那件事|刚才说的/
export function findEpisode(existing: readonly EpisodeExisting[], quote: string, action: string, result: string): EpisodeExisting | null {
  let best: { row: EpisodeExisting; score: number } | null = null
  for (const row of existing) {
    const score = Math.max(
      episodeSimilarity(row.source_quote, quote),
      action ? episodeSimilarity(row.source_quote, action) : 0,
      result ? episodeSimilarity(row.source_quote, result) : 0,
    )
    if (score > (best?.score ?? 0)) best = { row, score }
  }
  if (!best) return null
  const threshold = BACK_REFERENCE.test(quote) ? BACK_REFERENCE_THRESHOLD : MERGE_THRESHOLD
  // 相似度只做候选召回；写入还需要事件身份证据：至少一个区别性词元共享
  // 且无时间矛盾。证据不足保留两条，不猜。
  const sharedDistinctive = sharedDistinctiveCount(best.row.source_quote, quote)
  const minShared = BACK_REFERENCE.test(quote) && sharedDistinctive >= 1 ? 4 : MIN_SHARED
  return best.score >= threshold && sharedBigramCount(best.row.source_quote, quote) >= minShared
    && sharedDistinctive >= 1 && !timeContradiction(best.row.source_quote, quote) ? best.row : null
}

// 合并策略：行动保首个非空（最初怎么做的），结果取最新非空（最新状态），
// 反思追加（后来的认识不该挤掉先前的），时间补空。
export function mergeContent(previous: EpisodeExisting['content'], next: { action: string; result: string; reflection?: string; occurredAt: string }) {
  return {
    action: previous.action || next.action,
    result: next.result || previous.result,
    reflection: next.reflection && previous.reflection && previous.reflection !== next.reflection ? `${previous.reflection}\n${next.reflection}` : (next.reflection || previous.reflection || ''),
    occurredAt: previous.occurredAt || next.occurredAt,
  }
}
