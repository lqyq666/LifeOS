// 身份层最小投影：用户明确的自述认同（“我是那种先做再想的人”）从已提交
// growth 事实中捕获；AI 观察不自动成为身份。变更事件只记录真实发生的
// 状态迁移（旧/新、原因、来源、影响、确认状态、提交时间），无变化不生成。
// 权威事实仍在 growth/experiences/coach_events——这里不建第二份人格档案。
import type { PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'

// 用户自述认同的句式：我是/我认为自己是/我算是……的（人/性格/学生/做事方式）。
const SELF_DESCRIPTION = /我(?:是|算是|觉得自己是|认为自己(?:是|属于)|属于)(?:那种|一个|个)?[^，。；！？]{2,30}?(?:的人|的性格|的类型|做事方式|风格)/

export type IdentitySourceFact = { id: string; kind: string; text: string; assertion: string; status: string; messageId?: string }

export function deriveIdentityClaims(facts: readonly IdentitySourceFact[]): { text: string; sourceGrowthId: string; quote: string }[] {
  const claims: { text: string; sourceGrowthId: string; quote: string }[] = []
  for (const fact of facts) {
    if (fact.status !== 'active' || !['user_reported', 'user_edit'].includes(fact.assertion)) continue
    const match = SELF_DESCRIPTION.exec(fact.text)
    if (!match) continue
    claims.push({ text: match[0], sourceGrowthId: fact.id, quote: fact.text })
  }
  return claims
}

export async function projectIdentityClaims(c: PoolClient, user: string, facts: readonly IdentitySourceFact[]): Promise<string[]> {
  const claims = deriveIdentityClaims(facts)
  if (!claims.length) return []
  const changed: string[] = []
  for (const claim of claims) {
    // 同一来源只投影一次；同义文本不重复。
    const existing = (await c.query("SELECT id FROM identity_claims WHERE user_id=$1 AND status='active' AND source_refs @> $2::jsonb", [user, JSON.stringify([{ growthItemId: claim.sourceGrowthId }])])).rowCount
      || (await c.query("SELECT 1 FROM identity_claims WHERE user_id=$1 AND status='active' AND text=$2", [user, claim.text])).rowCount
    if (existing) continue
    const id = randomUUID()
    await c.query("INSERT INTO identity_claims(user_id,id,text,origin,confirmed_by_user,status,source_refs) VALUES($1,$2,$3,'user_stated',true,'active',$4)", [user, id, claim.text, JSON.stringify([{ growthItemId: claim.sourceGrowthId, quote: claim.quote }])])
    await recordChangeEvent(c, user, { subjectType: 'identity_claim', subjectId: id, transition: 'created', newSnapshot: { text: claim.text, origin: 'user_stated' }, reason: '用户自述的自我认同', sourceRefs: [{ growthItemId: claim.sourceGrowthId, quote: claim.quote }], impact: '进入星图中央的“我认可的描述”' })
    changed.push(id)
  }
  return changed
}

export type ChangeEventInput = {
  subjectType: 'theme' | 'experience' | 'identity_claim' | 'link'
  subjectId: string
  transition: 'created' | 'updated' | 'merged' | 'corrected' | 'retired' | 'paused' | 'resumed' | 'confirmed' | 'revoked' | 'backfilled'
  oldSnapshot?: unknown
  newSnapshot?: unknown
  reason: string
  sourceRefs?: unknown[]
  impact?: string
  userConfirmation?: 'none' | 'pending' | 'confirmed' | 'rejected'
}

export async function recordChangeEvent(c: PoolClient, user: string, input: ChangeEventInput): Promise<void> {
  await c.query(`INSERT INTO identity_change_events(user_id,id,subject_type,subject_id,transition,old_snapshot,new_snapshot,reason,source_refs,impact,user_confirmation)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
    user, randomUUID(), input.subjectType, input.subjectId, input.transition,
    input.oldSnapshot === undefined ? null : JSON.stringify(input.oldSnapshot),
    input.newSnapshot === undefined ? null : JSON.stringify(input.newSnapshot),
    input.reason, JSON.stringify(input.sourceRefs ?? []), input.impact ?? '', input.userConfirmation ?? 'none',
  ])
}

// 面板/时间轴读取：按时间倒序的真实变更（含确认状态）。
export async function readChangeEvents(c: PoolClient, user: string, limit = 20) {
  return (await c.query('SELECT * FROM identity_change_events WHERE user_id=$1 ORDER BY committed_at DESC LIMIT $2', [user, limit])).rows
}

// 读取有效身份：用户认可的自述 + 待核对的 AI 观察（当前只有自述）。
export async function readIdentityClaims(c: PoolClient, user: string) {
  return (await c.query("SELECT id, text, origin, confirmed_by_user, status, source_refs, updated_at FROM identity_claims WHERE user_id=$1 AND status='active' ORDER BY updated_at DESC LIMIT 6", [user])).rows
}
