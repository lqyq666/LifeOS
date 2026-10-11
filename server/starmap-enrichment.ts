// 星图增强：能力标签提取、未完成经历识别、外部反馈标记——全部从
// 已提交经历的原文字段确定性提取，零新增模型调用。
import type { PoolClient,Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { recordChangeEvent } from './identity.ts'
import {clauseReportsCompleted} from './experience-content.ts'

// ── 能力标签 ──
// 技能同义词表：经历的行动/结果原文包含这些词时挂对应能力标签。
// 这只是证据召回——"做过海报"不等于"擅长设计"，标签始终显示来源经历数。
const SKILL_LEXICON: { tag: string; words: string[] }[] = [
  { tag: '设计', words: ['设计', '海报', '排版', '配色', '排版', '视觉', 'UI', 'logo', 'Logo'] },
  { tag: '写作', words: ['写了', '写完', '文案', '推文', '文章', '公众号', '稿件', '剧本'] },
  { tag: '编程', words: ['代码', '编程', '开发', 'Python', 'python', 'Java', '前端', '后端', '小程序', '爬虫', '算法', 'SQL'] },
  { tag: '视频制作', words: ['剪辑', '视频', '拍摄', '拍了', 'Pr', 'AE', '剪辑', 'Vlog', 'vlog'] },
  { tag: '组织协调', words: ['组织', '策划', '协调', '带队', '负责', '主持', '招新', '活动'] },
  { tag: '沟通表达', words: ['访谈', '采访', '演讲', '答辩', '汇报', '主持', '谈判', '沟通'] },
  { tag: '数据分析', words: ['数据', '分析', 'Excel', 'excel', '统计', 'SPSS', 'Python', '可视化'] },
  { tag: '教学', words: ['家教', '辅导', '教了', '讲课', '支教', '答疑'] },
  { tag: '科研', words: ['文献', '综述', '实验', '科研', '论文', '导师', '课题'] },
  { tag: '外语', words: ['雅思', '托福', '六级', '四级', '英语', '日语', '翻译'] },
]

export function extractSkillTags(action: string, result: string, quote: string): string[] {
  const text = `${action} ${result} ${quote}`
  return SKILL_LEXICON.filter(entry => entry.words.some(word => text.includes(word))).map(entry => entry.tag)
}

// ── 未完成/卡住识别 ──
const BLOCKED_MARKER = /(?:还没|尚未|没做完|没完成|卡在|卡住|进行中|正在做|写到一半|做到一半|拖了|搁置)/
const BLOCKED_DONE = /(?:完成了|交了|交付|搞定|通过了|验收)/

// 一条经历是否是未完成/卡住的行动：有"卡住"标记且没有完成标记。
export function isBlockedExperience(action: string, result: string, quote: string): boolean {
  if(clauseReportsCompleted(action))return false
  if(action.trim())return BLOCKED_MARKER.test(action)&&!BLOCKED_DONE.test(action)
  // A participant not adopting or paying is not an unfinished contribution.
  if(/问了|问过|访谈了|聊过/.test(action)&&!BLOCKED_MARKER.test(action))return false
  const text = `${action} ${result} ${quote}`
  return BLOCKED_MARKER.test(text) && !BLOCKED_DONE.test(text)
}

// ── 外部反馈标记 ──
// "部长说/导师夸/客户评价/老师反馈" → 来自他人；无这些标记 → 本人自述。
const EXTERNAL_FEEDBACK = /(?:部长|导师|老师|客户|社长|学长|同学|评委|负责人|经理|HR|面试官)(?:说|说|表示|评价|反馈|夸|批评|认为|觉得)|(?:客户|对方|他们).{0,8}(?:用了|使用|采用|看过|读过|没(?:有)?回复)|(?:反馈|评价|验收|回复)(?:说|是|不错|很好|挺好|还行|一般|不好)|(?:被)(?:夸|批评|表扬|认可|拒绝)/
export function isExternalFeedback(result: string, quote: string): boolean {
  return EXTERNAL_FEEDBACK.test(`${result} ${quote}`)
}

// ── 数据库读写 ──

// 从已确认经历中汇总能力标签（有证据的那种），返回 {tag, count} 列表。
export async function readSkillTags(c: PoolClient|Pool, user: string): Promise<{ tag: string; count: number }[]> {
  const rows = (await c.query("SELECT content FROM experiences WHERE user_id=$1 AND status='confirmed'", [user])).rows
  const counts = new Map<string, number>()
  for (const row of rows) {
    const content = row.content ?? {}
    for (const tag of extractSkillTags(String(content.action ?? ''), String(content.result ?? ''), String(content.summary ?? ''))) {
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
