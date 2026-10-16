import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { Type, type Static } from 'typebox'
import { pool, transaction, HttpError, requireRow } from './db.ts'
import { applyGrowthAction } from './growth.ts'
import type { Run } from './store.ts'

// P6 closeout A2: chat-derived memory controls (forget / pause_use /
// stop_recommend) commit INSIDE the run's final transaction via
// persistMemoryControl — never as an independent write during candidate
// validation. The receipt is derived from the real write result. Ambiguous
// requests persist a recoverable confirmation request
// (persistPendingControlRequest) that the normal UI reads in this
// conversation AND in a new session; confirming executes the same action
// contract under the user's own identity with idempotent request binding.

export type MemoryControlKind = 'forget' | 'pause_use' | 'stop_recommend'

const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
export const controlRequestActionSchema = Type.Object({
  requestId: Type.String({ pattern: uuidPattern }),
  action: Type.Union([Type.Literal('confirm'), Type.Literal('cancel')]),
  itemId: Type.Optional(Type.String({ pattern: uuidPattern })),
}, { additionalProperties: false })
export type ControlRequestAction = Static<typeof controlRequestActionSchema>

export type StagedMemoryControl = {
  kind: MemoryControlKind
  itemId: string
  expectedRevision: number
  clauseText: string
}

export type PendingMemoryControl = {
  kind: MemoryControlKind
  clauseText: string
  candidates: { itemId: string; revision: number; preview: string }[]
}

export type MemoryControlReceipt = {
  status: 'executed'
  kind: MemoryControlKind
  itemId: string
  revisionBefore: number
  revisionAfter: number
  // Which durable boundary the user can read back: forgotten items are
  // purged; paused items keep their text but leave the active evidence set;
  // stopped-recommendation items stay ACTIVE for understanding while a
  // user-scoped recommendation boundary blocks proactive suggestions.
  boundary: 'purged' | 'paused' | 'recommendation_stopped'
  replayed: boolean
}

// Deterministic operation identity: (run request, item, operation) binds one
// commit; a replayed finish or a repeated confirm re-reads the same result
// instead of clearing anything twice.
const deterministicUuid = (seed: string): string => {
  const hash = createHash('sha256').update('lifeos-memory-control:' + seed).digest('hex')
  return [hash.slice(0, 8), hash.slice(8, 12), '4' + hash.slice(13, 16), (parseInt(hash.slice(16, 17), 16) & 0x3 | 0x8).toString(16) + hash.slice(17, 20), hash.slice(20, 32)].join('-')
}
export const controlOperationRequestId = (runRequestId: string, itemId: string, kind: MemoryControlKind) =>
  deterministicUuid(`${runRequestId}|${itemId}|${kind}`)

const actionForKind = (kind: MemoryControlKind): 'forget' | 'pause' | null =>
  kind === 'forget' ? 'forget' : kind === 'pause_use' ? 'pause' : null

// stop_recommend persists a DIFFERENT durable boundary from pause_use: the
// fact stays ACTIVE (still usable for understanding the person) while a
// user-scoped recommendation control blocks proactive suggestions across all
// conversations until an explicit resume. Idempotent per (run, item, kind).
async function persistRecommendationStop(c: PoolClient, run: Run, staged: StagedMemoryControl): Promise<MemoryControlReceipt> {
  const operationRequestId = controlOperationRequestId(run.request_id, staged.itemId, staged.kind)
  const replayed = Boolean((await c.query('SELECT 1 FROM growth_operations WHERE user_id=$1 AND request_id=$2', [run.user_id, operationRequestId])).rowCount)
  const row = (await c.query('SELECT text,revision,status FROM growth_items WHERE user_id=$1 AND id=$2 FOR UPDATE', [run.user_id, staged.itemId])).rows[0] as { text: string;revision:number;status:string } | undefined
  if (!row) throw new HttpError(409, 'GROWTH_REVISION_CONFLICT')
  if(!replayed&&(row.revision!==staged.expectedRevision||!['active','proposed'].includes(row.status)))throw new HttpError(409,'GROWTH_REVISION_CONFLICT')
  const source=(await c.query("SELECT content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role='user'",[run.user_id,run.conversation_id,run.source_message_id])).rows[0] as {content:string}|undefined
  if(!source||!source.content.includes(staged.clauseText))throw new HttpError(400,'GROWTH_SOURCE_INVALID')
  await c.query(`INSERT INTO growth_recommendation_controls(user_id,item_id,state,revision,source_conversation_id,source_message_id,source_quote,origin_request_id)
    VALUES($1,$2,'stopped',1,$3,$4,$5,$6)
    ON CONFLICT(user_id,item_id) DO UPDATE SET state='stopped',revision=growth_recommendation_controls.revision+1,source_conversation_id=EXCLUDED.source_conversation_id,source_message_id=EXCLUDED.source_message_id,source_quote=EXCLUDED.source_quote,origin_request_id=EXCLUDED.origin_request_id,updated_at=now()
    WHERE growth_recommendation_controls.state<>'stopped'`,
    [run.user_id, staged.itemId, run.conversation_id, run.source_message_id, staged.clauseText.slice(0, 200), run.request_id])
  if (!replayed) await c.query('INSERT INTO growth_operations(user_id,request_id,fingerprint,item_id) VALUES($1,$2,$3,$4)', [run.user_id, operationRequestId, createHash('sha256').update(JSON.stringify({ kind: staged.kind, itemId: staged.itemId })).digest('hex'), staged.itemId])
  return {
    status: 'executed',
    kind: 'stop_recommend',
    itemId: staged.itemId,
    revisionBefore: staged.expectedRevision,
    revisionAfter: staged.expectedRevision,
    boundary: 'recommendation_stopped',
    replayed,
  }
}

export async function persistMemoryControl(c: PoolClient, run: Run, staged: StagedMemoryControl): Promise<MemoryControlReceipt> {
  if (staged.kind === 'stop_recommend') return persistRecommendationStop(c, run, staged)
  const operationRequestId = controlOperationRequestId(run.request_id, staged.itemId, staged.kind)
  const replayed = Boolean((await c.query('SELECT 1 FROM growth_operations WHERE user_id=$1 AND request_id=$2', [run.user_id, operationRequestId])).rowCount)
  const applied = await applyGrowthAction(c, run.user_id, staged.itemId, {
    requestId: operationRequestId,
    expectedRevision: staged.expectedRevision,
    action: actionForKind(staged.kind)!,
  })
  return {
    status: 'executed',
    kind: staged.kind,
    itemId: staged.itemId,
    revisionBefore: staged.expectedRevision,
    revisionAfter: applied.revision,
    boundary: staged.kind === 'forget' ? 'purged' : 'paused',
    replayed,
  }
}

export async function persistPendingControlRequest(c: PoolClient, run: Run, pending: PendingMemoryControl): Promise<{ status: 'needs_confirmation'; requestId: string; kind: MemoryControlKind; candidates: { itemId: string; preview: string }[] }> {
  // The pending request is bound to THIS run's request id (FK to runs): one
  // recoverable confirmation per turn, replaying the same finishRun is a
  // no-op, and the confirming operation derives its own idempotent identity
  // from (run request, item, kind).
  await c.query(
    `INSERT INTO growth_control_requests(id,user_id,request_id,conversation_id,source_message_id,kind,clause_text,candidates)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT(user_id,request_id) DO NOTHING`,
    [randomUUID(), run.user_id, run.request_id, run.conversation_id, run.source_message_id, pending.kind, pending.clauseText, JSON.stringify(pending.candidates)],
  )
  return { status: 'needs_confirmation', requestId: run.request_id, kind: pending.kind, candidates: pending.candidates.map(entry => ({ itemId: entry.itemId, preview: entry.preview })) }
}

export type ControlRequestView = {
  id: string; requestId: string; conversationId: string; kind: MemoryControlKind
  clauseText: string; candidates: { itemId: string; preview: string }[]
  status: 'pending' | 'confirmed' | 'cancelled'; createdAt: string; decidedAt: string | null
  conversationTitle: string | null
}

// Fix 4: pending confirmations are ACCOUNT-scoped — a request raised in
// conversation A stays discoverable from any conversation of the same user
// (including a brand-new one), labeled with its source conversation. Rows are
// always filtered by user_id, so nothing ever crosses accounts.
export async function listControlRequests(user: string, conversation?: string): Promise<ControlRequestView[]> {
  const rows = conversation
    ? (await pool.query(`SELECT r.*, c.title AS conversation_title FROM growth_control_requests r LEFT JOIN conversations c ON c.user_id=r.user_id AND c.id=r.conversation_id WHERE r.user_id=$1 AND r.conversation_id=$2 ORDER BY r.created_at DESC,r.id LIMIT 50`, [user, conversation])).rows
    : (await pool.query(`SELECT r.*, c.title AS conversation_title FROM growth_control_requests r LEFT JOIN conversations c ON c.user_id=r.user_id AND c.id=r.conversation_id WHERE r.user_id=$1 AND r.status='pending' ORDER BY r.created_at DESC,r.id LIMIT 50`, [user])).rows
  return rows.map(row => ({
    id: row.id, requestId: row.request_id, conversationId: row.conversation_id, kind: row.kind,
    clauseText: row.clause_text, candidates: row.candidates, status: row.status,
    createdAt: row.created_at.toISOString(), decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    conversationTitle: row.conversation_title ?? null,
  }))
}

export async function resolveControlRequest(user: string, id: string, input: ControlRequestAction): Promise<ControlRequestView & { result: MemoryControlReceipt | null }> {
  return transaction(async c => {
    const row = requireRow((await c.query('SELECT * FROM growth_control_requests WHERE user_id=$1 AND id=$2 FOR UPDATE', [user, id])).rows[0]) as { id: string; user_id: string; request_id: string; conversation_id: string; source_message_id: string; kind: MemoryControlKind; clause_text: string; candidates: { itemId: string; revision: number; preview: string }[]; status: string; created_at: Date; decided_at: Date | null; outcome: unknown }
    const view = (): ControlRequestView => ({
      id: row.id, requestId: row.request_id, conversationId: row.conversation_id, kind: row.kind,
      clauseText: row.clause_text, candidates: row.candidates.map(entry => ({ itemId: entry.itemId, preview: entry.preview })),
      status: row.status as ControlRequestView['status'], createdAt: row.created_at.toISOString(),
      decidedAt: row.decided_at ? row.decided_at.toISOString() : null, conversationTitle: null,
    })
    if (row.status !== 'pending') {
      const saved=row.outcome as (MemoryControlReceipt & {confirmation?:{requestId:string;action:string;itemId?:string}})|null
      if(saved?.confirmation?.requestId===input.requestId){
        if(saved.confirmation.action!==input.action||saved.confirmation.itemId!==input.itemId)throw new HttpError(409,'CONTROL_CONFIRMATION_IDEMPOTENCY_CONFLICT')
        const {confirmation,...receipt}=saved
        return {...view(),result:input.action==='cancel'?null:{...receipt,replayed:true} as MemoryControlReceipt}
      }
      throw new HttpError(409, 'CONTROL_REQUEST_ALREADY_DECIDED')
    }
    if (input.action === 'cancel') {
      await c.query("UPDATE growth_control_requests SET status='cancelled',decided_at=now(),outcome=$3 WHERE user_id=$1 AND id=$2", [user, id,JSON.stringify({confirmation:{requestId:input.requestId,action:input.action}})])
      row.status = 'cancelled'; row.decided_at = new Date()
      return { ...view(), result: null }
    }
    const chosen = row.candidates.find(entry => entry.itemId === input.itemId)
    if (!chosen) throw new HttpError(400, 'CONTROL_TARGET_INVALID')
    const sourceRun = { user_id: user, request_id: row.request_id, conversation_id: row.conversation_id, source_message_id: row.source_message_id } as Run
    const receipt: MemoryControlReceipt = row.kind === 'stop_recommend'
      ? await persistRecommendationStop(c, sourceRun, { kind: row.kind, itemId: chosen.itemId, expectedRevision: chosen.revision, clauseText: row.clause_text })
      : await (async () => {
        const operationRequestId = controlOperationRequestId(row.request_id, chosen.itemId, row.kind)
        const replayed = Boolean((await c.query('SELECT 1 FROM growth_operations WHERE user_id=$1 AND request_id=$2', [user, operationRequestId])).rowCount)
        const applied = await applyGrowthAction(c, user, chosen.itemId, {
          requestId: operationRequestId,
          expectedRevision: chosen.revision,
          action: actionForKind(row.kind)!,
        })
        return {
          status: 'executed' as const, kind: row.kind, itemId: chosen.itemId,
          revisionBefore: chosen.revision, revisionAfter: applied.revision,
          boundary: row.kind === 'forget' ? 'purged' as const : 'paused' as const, replayed,
        }
      })()
    await c.query('UPDATE growth_control_requests SET status=$3,decided_at=now(),outcome=$4 WHERE user_id=$1 AND id=$2', [user, id, 'confirmed', JSON.stringify({...receipt,confirmation:{requestId:input.requestId,action:input.action,itemId:input.itemId}})])
    row.status = 'confirmed'; row.decided_at = new Date()
    return { ...view(), result: receipt }
  })
}

// ---- cross-session recommendation boundaries (fix 2) -----------------------

export type RecommendationControl = { itemId: string; state: 'stopped' | 'resumed'; revision: number; updatedAt: string }

export async function readRecommendationControls(user: string, c: { query: PoolClient['query'] } = pool): Promise<RecommendationControl[]> {
  const rows = (await c.query("SELECT item_id,state,revision,updated_at FROM growth_recommendation_controls WHERE user_id=$1 AND state='stopped' ORDER BY updated_at DESC", [user])).rows as { item_id: string; state: 'stopped' | 'resumed'; revision: number; updated_at: Date }[]
  return rows.map(row => ({ itemId: row.item_id, state: row.state, revision: row.revision, updatedAt: row.updated_at.toISOString() }))
}

export async function resumeRecommendationControl(user: string, itemId: string, input: { requestId: string }): Promise<RecommendationControl> {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(input.requestId)) throw new HttpError(400, 'INVALID_INPUT')
  return transaction(async c => {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['growth:' + user])
    const updated = (await c.query(`UPDATE growth_recommendation_controls SET state='resumed',revision=revision+1,updated_at=now() WHERE user_id=$1 AND item_id=$2 AND state='stopped' RETURNING item_id,state,revision,updated_at`, [user, itemId])).rows[0] as { item_id: string; state: 'stopped' | 'resumed'; revision: number; updated_at: Date } | undefined
    if (!updated) throw new HttpError(404, 'NOT_FOUND')
    return { itemId: updated.item_id, state: updated.state, revision: updated.revision, updatedAt: updated.updated_at.toISOString() }
  })
}
