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
  // purged; paused items keep their text but leave the active evidence set.
  boundary: 'purged' | 'paused'
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

const actionForKind = (kind: MemoryControlKind): 'forget' | 'pause' =>
  kind === 'forget' ? 'forget' : 'pause'

export async function persistMemoryControl(c: PoolClient, run: Run, staged: StagedMemoryControl): Promise<MemoryControlReceipt> {
  const operationRequestId = controlOperationRequestId(run.request_id, staged.itemId, staged.kind)
  const replayed = Boolean((await c.query('SELECT 1 FROM growth_operations WHERE user_id=$1 AND request_id=$2', [run.user_id, operationRequestId])).rowCount)
  const applied = await applyGrowthAction(c, run.user_id, staged.itemId, {
    requestId: operationRequestId,
    expectedRevision: staged.expectedRevision,
    action: actionForKind(staged.kind),
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
}

export async function listControlRequests(user: string, conversation?: string): Promise<ControlRequestView[]> {
  const rows = conversation
    ? (await pool.query('SELECT * FROM growth_control_requests WHERE user_id=$1 AND conversation_id=$2 ORDER BY created_at DESC,id LIMIT 50', [user, conversation])).rows
    : (await pool.query("SELECT * FROM growth_control_requests WHERE user_id=$1 AND status='pending' ORDER BY created_at DESC,id LIMIT 50", [user])).rows
  return rows.map(row => ({
    id: row.id, requestId: row.request_id, conversationId: row.conversation_id, kind: row.kind,
    clauseText: row.clause_text, candidates: row.candidates, status: row.status,
    createdAt: row.created_at.toISOString(), decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
  }))
}

export async function resolveControlRequest(user: string, id: string, input: ControlRequestAction): Promise<ControlRequestView & { result: MemoryControlReceipt | null }> {
  return transaction(async c => {
    const row = requireRow((await c.query('SELECT * FROM growth_control_requests WHERE user_id=$1 AND id=$2 FOR UPDATE', [user, id])).rows[0]) as { id: string; user_id: string; request_id: string; conversation_id: string; source_message_id: string; kind: MemoryControlKind; clause_text: string; candidates: { itemId: string; revision: number; preview: string }[]; status: string; created_at: Date; decided_at: Date | null; outcome: unknown }
    if (row.status !== 'pending') throw new HttpError(409, 'CONTROL_REQUEST_ALREADY_DECIDED')
    const view = (): ControlRequestView => ({
      id: row.id, requestId: row.request_id, conversationId: row.conversation_id, kind: row.kind,
      clauseText: row.clause_text, candidates: row.candidates.map(entry => ({ itemId: entry.itemId, preview: entry.preview })),
      status: row.status as ControlRequestView['status'], createdAt: row.created_at.toISOString(),
      decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    })
    if (input.action === 'cancel') {
      await c.query("UPDATE growth_control_requests SET status='cancelled',decided_at=now(),outcome=jsonb_build_object('cancelledBy',NULL) WHERE user_id=$1 AND id=$2", [user, id])
      row.status = 'cancelled'; row.decided_at = new Date()
      return { ...view(), result: null }
    }
    const chosen = row.candidates.find(entry => entry.itemId === input.itemId)
    if (!chosen) throw new HttpError(400, 'CONTROL_TARGET_INVALID')
    const operationRequestId = controlOperationRequestId(row.request_id, chosen.itemId, row.kind)
    const replayed = Boolean((await c.query('SELECT 1 FROM growth_operations WHERE user_id=$1 AND request_id=$2', [user, operationRequestId])).rowCount)
    const applied = await applyGrowthAction(c, user, chosen.itemId, {
      requestId: operationRequestId,
      expectedRevision: chosen.revision,
      action: actionForKind(row.kind),
    })
    const receipt: MemoryControlReceipt = {
      status: 'executed', kind: row.kind, itemId: chosen.itemId,
      revisionBefore: chosen.revision, revisionAfter: applied.revision,
      boundary: row.kind === 'forget' ? 'purged' : 'paused', replayed,
    }
    await c.query('UPDATE growth_control_requests SET status=$3,decided_at=now(),outcome=$4 WHERE user_id=$1 AND id=$2', [user, id, 'confirmed', JSON.stringify(receipt)])
    row.status = 'confirmed'; row.decided_at = new Date()
    return { ...view(), result: receipt }
  })
}
