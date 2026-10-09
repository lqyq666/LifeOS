// 语义检索层：用已有的 BGE 中文 embedding（512维）替代词表匹配，
// 提升主题-经历连线的命中率。不增加模型调用——embedding 是本地服务。
import { localEmbedding } from './local-embedding.ts'

// 余弦相似度
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1)
}

// 批量计算文本向量（最多32条/次，与 embedding worker 上限一致）
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const batches: number[][][] = []
  for (let i = 0; i < texts.length; i += 32) {
    batches.push(await localEmbedding.encode(texts.slice(i, i + 32)))
  }
  return batches.flat()
}

// 语义连线：给定主题文本和候选经历文本，返回最匹配的经历索引+分数
export async function semanticMatch(
  themeText: string,
  experienceTexts: string[],
  threshold = 0.55,
): Promise<{ index: number; score: number }[]> {
  if (!experienceTexts.length) return []
  const vectors = await embedTexts([themeText, ...experienceTexts])
  const themeVec = vectors[0]!
  const results: { index: number; score: number }[] = []
  for (let i = 1; i < vectors.length; i++) {
    const score = cosineSimilarity(themeVec, vectors[i]!)
    if (score >= threshold) results.push({ index: i - 1, score })
  }
  return results.sort((a, b) => b.score - a.score)
}

// 经历间相似度：找出与给定经历最相似的其他经历（用于故事线）
export async function findRelatedExperiences(
  targetText: string,
  candidateTexts: string[],
  threshold = 0.65,
): Promise<{ index: number; score: number }[]> {
  return semanticMatch(targetText, candidateTexts, threshold)
}
