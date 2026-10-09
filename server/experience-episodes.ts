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
  return best.score >= threshold && sharedBigramCount(best.row.source_quote, quote) >= MIN_SHARED ? best.row : null
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
