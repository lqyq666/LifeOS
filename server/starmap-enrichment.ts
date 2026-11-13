// 星图增强：能力标签提取、未完成经历识别、外部反馈标记——全部从
// 已提交经历的原文字段确定性提取，零新增模型调用。
import type { PoolClient,Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { recordChangeEvent } from './identity.ts'
import {SKILL_ACTION_LEXICON} from './category-lexicon.ts'
import {clauseReportsCompleted,personalContributionClauses,personalActionText} from './experience-content.ts'
import {buildClauseCatalogue,unprotectedClauseText} from './clause-catalogue.ts'
import {scanUserClauses} from './user-command-spans.ts'
import {reportedExternalFeedback} from './turn-contract.ts'

// ── 能力标签 ──
// Conservative contribution evidence: an owned, performed action is required.
// Task domains, delegation and denied work do not establish a personal skill.


export function extractSkillTags(action: string, result: string, quote: string, interpretedSkillTags?:readonly string[]): string[] {
  if(interpretedSkillTags!==undefined)return [...new Set(interpretedSkillTags)]
  // A source quote, when present, governs historical extracted action labels.
  // A task title or a model-inferred action cannot overrule that source.
  const evidence=(quote.trim()?[quote]:[action,result]).flatMap(text=>personalContributionClauses(buildClauseCatalogue(text)).map(clause=>personalActionText(unprotectedClauseText(clause))??''))
  return SKILL_ACTION_LEXICON.filter(entry=>evidence.some(text=>entry.action.test(text)&&clauseReportsCompleted(text))).map(entry=>entry.tag)
}

// ── 未完成/卡住识别 ──
const BLOCKED_MARKER = /(?:还没|尚未|没做完|没完成|卡在|卡住|进行中|正在做|写到一半|做到一半|拖了|搁置)/
const BLOCKED_DONE = /(?:完成了|交了|交付|搞定|通过了|验收)/

// 一条经历是否是未完成/卡住的行动：有"卡住"标记且没有完成标记。
export function isBlockedExperience(action: string, result: string, quote: string): boolean {
  if(/已经尝试|尝试了|试做了|开始尝试/.test(action)&&BLOCKED_MARKER.test(result+' '+quote))return true
  if(clauseReportsCompleted(action))return false
  if(action.trim())return BLOCKED_MARKER.test(action)&&!BLOCKED_DONE.test(action)
  // A participant not adopting or paying is not an unfinished contribution.
  if(/问了|问过|访谈了|聊过/.test(action)&&!BLOCKED_MARKER.test(action))return false
  const text = `${action} ${result} ${quote}`
  return BLOCKED_MARKER.test(text) && !BLOCKED_DONE.test(text)
}

// ── 外部反馈标记 ──
// "部长说/导师夸/客户评价/老师反馈" → 来自他人；无这些标记 → 本人自述。
export function isExternalFeedback(result: string, quote: string): boolean {
  return ['positive','negative','reported'].includes(reportedExternalFeedback([quote,result].filter(Boolean).join('；')).status)
}

// ── 数据库读写 ──

// 从已确认经历中汇总能力标签（有证据的那种），返回 {tag, count} 列表。
export function summarizeSkillTags(rows: readonly {content:any;source_quote?:string;quote?:string;interpretedSkillTags?:readonly string[]}[]): { tag: string; count: number }[] {
  // Reuse the graph's source-checked records. Raw confirmed rows can still
  // contain withdrawn sources or historical wording superseded by an edit.
  const counts = new Map<string, number>()
  for (const row of rows) {
    const content = row.content ?? {}
    for (const tag of extractSkillTags(String(content.action ?? ''), String(content.result ?? ''), String(row.source_quote??row.quote??content.summary??''),row.interpretedSkillTags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }))
}

// ── P2: 经历间关联（故事线）──
// 用语义 embedding 找相似经历，用时间顺序建 follows 关系。

export async function buildExperienceRelations(c: PoolClient, user: string, newExperienceId: string, newText: string): Promise<number> {
  const others = (await c.query(
    "SELECT id, source_quote, content->>'action' as action, content->>'result' as result, created_at FROM experiences WHERE user_id=$1 AND status='confirmed' AND id<>$2 ORDER BY created_at DESC LIMIT 20",
    [user, newExperienceId]
  )).rows
  if (!others.length) return 0
  const texts = others.map(row => `${row.source_quote} ${row.action ?? ''} ${row.result ?? ''}`)
  let created = 0
  try {
    const { findRelatedExperiences } = await import('./semantic-search.ts')
    const related = await findRelatedExperiences(newText, texts, 0.65)
    for (const match of related.slice(0, 3)) {
      const other = others[match.index]!
      await c.query(
        `INSERT INTO experience_relations(user_id, from_experience, to_experience, relation, score, reason) VALUES($1,$2,$3,'similar',$4,$5) ON CONFLICT DO NOTHING`,
        [user, newExperienceId, other.id, match.score, `语义相似度 ${(match.score * 100).toFixed(0)}%`]
      )
      created++
    }
  } catch { /* embedding 不可用时跳过 */ }
  // Creation order alone establishes no meaningful personal relationship.
  return created
}
