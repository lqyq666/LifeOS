// 身份层最小投影：用户明确的自述认同（“我是那种先做再想的人”）从已提交
// growth 事实中捕获；AI 观察不自动成为身份。变更事件只记录真实发生的
// 状态迁移（旧/新、原因、来源、影响、确认状态、提交时间），无变化不生成。
// 权威事实仍在 growth/experiences/coach_events——这里不建第二份人格档案。
import type { PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import {scanUserClauses} from './user-command-spans.ts'

// 用户自述认同的句式：我是/我认为自己是/我算是……的（人/性格/学生/做事方式）。
const SELF_DESCRIPTION = /我(?:是|算是|觉得自己是|认为自己(?:是|属于)|属于)(?:那种|一个|个)?[^，。；！？]{2,30}?(?:的人|的性格|的类型|做事方式|风格)/

export type IdentitySourceFact = { id: string; kind: string; text: string; assertion: string; status: string; messageId?: string }

export function deriveIdentityClaims(facts: readonly IdentitySourceFact[]): { text: string; sourceGrowthId: string; quote: string }[] {
  const claims: { text: string; sourceGrowthId: string; quote: string }[] = []
  for (const fact of facts) {
    if (fact.status !== 'active' || !['user_reported', 'user_edit'].includes(fact.assertion)) continue
    const clause=scanUserClauses(fact.text).find(part=>!part.conditional&&!part.interrogative&&!['？','?'].includes(part.delimiter)&&!part.attributedToOther&&!part.quoted&&!part.code&&!part.quoteSpans.length&&SELF_DESCRIPTION.test(part.text))
    const match = clause?SELF_DESCRIPTION.exec(clause.text):null
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
  unknowns?: string
  nextStep?: string
  userConfirmation?: 'none' | 'pending' | 'confirmed' | 'rejected'
}

export async function recordChangeEvent(c: PoolClient, user: string, input: ChangeEventInput): Promise<void> {
  await c.query(`INSERT INTO identity_change_events(user_id,id,subject_type,subject_id,transition,old_snapshot,new_snapshot,reason,source_refs,impact,unknowns,next_step,user_confirmation)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
    user, randomUUID(), input.subjectType, input.subjectId, input.transition,
    input.oldSnapshot === undefined ? null : JSON.stringify(input.oldSnapshot),
    input.newSnapshot === undefined ? null : JSON.stringify(input.newSnapshot),
    input.reason, JSON.stringify(input.sourceRefs ?? []), input.impact ?? '', input.unknowns ?? '', input.nextStep ?? '', input.userConfirmation ?? 'none',
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

// 身份声明与来源 growth 项同步（G1.2）：来源遗忘/拒绝 → 身份声明退休且旧
// 描述不再出现在任何可见位置；来源更正 → 若自述句式已不存在则撤回；用户
// 明确否定/停止使用走 claimAction。变更事件中被遗忘的原话同步清除，只留
// 不含私人内容的技术回执。
export async function reconcileIdentityClaims(c: PoolClient, user: string, changedSourceIds:string[]=[]): Promise<void> {
  const claims=(await c.query("SELECT id, text, source_refs, status FROM identity_claims WHERE user_id=$1 AND status='active'",[user])).rows
  if(!claims.length&&!changedSourceIds.length)return
  const refIds=[...new Set([...changedSourceIds,...claims.flatMap((claim:any)=>(claim.source_refs??[]).map((ref:any)=>ref.growthItemId)).filter(Boolean)])]
  const facts=new Map(refIds.length?(await c.query('SELECT id, text, status FROM growth_items WHERE user_id=$1 AND id=ANY($2::uuid[])',[user,refIds])).rows.map((row:any)=>[row.id,row]):[])
  // Earlier corrections may have retired claims sharing this source. Forgetting
  // must redact those earlier event quotes, not just the active claim's quote.
  for(const id of refIds){
    if(!['forgotten','rejected','missing'].includes(facts.get(id)?.status??'missing'))continue
    const related=(await c.query('SELECT text,source_refs FROM identity_claims WHERE user_id=$1 AND source_refs @> $2::jsonb',[user,JSON.stringify([{growthItemId:id}])])).rows as {text:string;source_refs:{quote?:string}[]}[]
    const events=(await c.query('SELECT source_refs FROM identity_change_events WHERE user_id=$1 AND source_refs @> $2::jsonb',[user,JSON.stringify([{growthItemId:id}])])).rows as {source_refs:{quote?:string}[]}[]
    const quotes=[...related.map(row=>row.text),...[...related,...events].flatMap(row=>row.source_refs.map(ref=>ref.quote).filter((quote):quote is string=>Boolean(quote)))]
    await purgeForgottenFromEvents(c,user,[...quotes,...quotes.flatMap(quote=>{const match=SELF_DESCRIPTION.exec(quote);return match?[match[0]]:[]})])
  }
  for(const claim of claims){
    // A direct authenticated identity edit is its own new user testimony.
    if((claim.source_refs??[]).some((ref:{type?:string;quote?:string})=>ref.type==='user_edit'&&ref.quote===claim.text))continue
    const statuses=(claim.source_refs??[]).map((ref:any)=>facts.get(ref.growthItemId)?.status??'missing')
    const live=(claim.source_refs??[]).filter((_:any,index:number)=>statuses[index]==='active')
    if(!live.length){
      const forgottenQuotes=(claim.source_refs??[]).filter((_:any,index:number)=>['forgotten','rejected','missing'].includes(statuses[index]!)).map((ref:any)=>ref.quote).filter(Boolean)
      await c.query("UPDATE identity_claims SET status='retired', revision=revision+1, updated_at=now() WHERE user_id=$1 AND id=$2",[user,claim.id])
      await purgeForgottenFromEvents(c,user,forgottenQuotes)
      await recordChangeEvent(c,user,{subjectType:'identity_claim',subjectId:claim.id,transition:'retired',oldSnapshot:{text:'',status:'active'},newSnapshot:{status:'retired'},reason:'来源事实被遗忘或拒绝，该自我描述停止使用',impact:'中央身份不再显示该描述，模型不再引用'})
      continue
    }
    // 来源更正后自述句式消失 → 撤回该声明。
    const stillDescribed=live.some((ref:any)=>deriveIdentityClaims([{id:ref.growthItemId,kind:'preference',text:facts.get(ref.growthItemId)?.text??'',assertion:'user_reported',status:'active'}]).some(current=>current.text===claim.text))
    if(!stillDescribed){
      await c.query("UPDATE identity_claims SET status='retired', revision=revision+1, updated_at=now() WHERE user_id=$1 AND id=$2",[user,claim.id])
      await recordChangeEvent(c,user,{subjectType:'identity_claim',subjectId:claim.id,transition:'retired',oldSnapshot:{status:'active'},newSnapshot:{status:'retired'},reason:'来源更正后不再包含该自我描述',impact:'中央身份同步更新'})
    }
  }
}

// 被遗忘原话从变更事件的可见字段清除：保留迁移的技术回执（类型/状态），
// 抹去 old/new 快照与来源里的原话。
async function purgeForgottenFromEvents(c: PoolClient, user: string, quotes: string[]): Promise<void> {
  if(!quotes.length)return
  const events=(await c.query('SELECT id, old_snapshot, new_snapshot, source_refs FROM identity_change_events WHERE user_id=$1',[user])).rows
  for(const event of events){
    let oldSnapshot=event.old_snapshot,newSnapshot=event.new_snapshot,sourceRefs=event.source_refs
    const cleanse=(value:any)=>{
      if(!value)return value
      const text=JSON.stringify(value)
      if(!quotes.some(quote=>text.includes(quote)))return value
      const parsed=JSON.parse(text)
      for(const key of Object.keys(parsed))if(typeof parsed[key]==='string'&&quotes.some(quote=>parsed[key].includes(quote)))parsed[key]='[已遗忘]'
      return parsed
    }
    oldSnapshot=cleanse(oldSnapshot);newSnapshot=cleanse(newSnapshot)
    if(JSON.stringify(sourceRefs).length){
      sourceRefs=(sourceRefs as any[]).filter((ref:any)=>!quotes.some(quote=>JSON.stringify(ref).includes(quote)))
    }
    await c.query('UPDATE identity_change_events SET old_snapshot=$3, new_snapshot=$4, source_refs=$5 WHERE user_id=$1 AND id=$2',[user,event.id,oldSnapshot?JSON.stringify(oldSnapshot):null,newSnapshot?JSON.stringify(newSnapshot):null,JSON.stringify(sourceRefs)])
  }
}

// 用户对身份声明的裁决：这不是我 / 纠正文本 / 停止使用。
export async function identityClaimAction(c: PoolClient, user: string, claimId: string, input: { action: 'deny' | 'correct' | 'stop'; text?: string }): Promise<void> {
  const claim=(await c.query('SELECT * FROM identity_claims WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,claimId])).rows[0]
  if(!claim)throw Object.assign(new Error('NOT_FOUND'),{status:404})
  if(input.action==='correct'){
    if(!input.text?.trim())throw Object.assign(new Error('TEXT_REQUIRED'),{status:400})
    await c.query("UPDATE identity_claims SET text=$3, source_refs=$4, confirmed_by_user=true, origin='user_stated', revision=revision+1, updated_at=now() WHERE user_id=$1 AND id=$2",[user,claimId,input.text.trim().slice(0,400),JSON.stringify([{type:'user_edit',quote:input.text.trim().slice(0,400)}])])
    await recordChangeEvent(c,user,{subjectType:'identity_claim',subjectId:claimId,transition:'corrected',oldSnapshot:{text:claim.text},newSnapshot:{text:input.text.trim()},reason:'用户纠正了自己的描述',userConfirmation:'confirmed',impact:'中央身份与模型上下文使用纠正后的描述'})
  }else{
    await c.query("UPDATE identity_claims SET status='retired', revision=revision+1, updated_at=now() WHERE user_id=$1 AND id=$2",[user,claimId])
    await recordChangeEvent(c,user,{subjectType:'identity_claim',subjectId:claimId,transition:'revoked',oldSnapshot:{text:input.action==='deny'?claim.text:''},newSnapshot:{status:'retired'},reason:input.action==='deny'?'用户表示“这不是我”':'用户停止使用该描述',userConfirmation:'rejected',impact:'该描述不再作为身份被引用'})
  }
}
