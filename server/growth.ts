import { randomUUID, createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, transaction, HttpError, requireRow } from './db.ts'
import { checkCampusSource } from './campus.ts'
import { validate } from './contracts.ts'
import { growthCreateSchema, growthActionSchema, type GrowthCreate, type GrowthAction } from './growth-contracts.ts'
import type { GrowthItem, GrowthRef, GrowthView } from '../src/features/growth/types.ts'

type DB = Pick<PoolClient, 'query'>
type Row = { id: string; user_id: string; conversation_id: string; kind: GrowthItem['kind']; text: string; assertion: GrowthItem['assertion']; status: GrowthItem['status']; sources: GrowthItem['sources']; dependencies: GrowthRef[]; valid_until: Date | null; revision: number; created_at: Date; updated_at: Date }
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const lockGrowth = (c: DB, user: string) => c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['growth:' + user])
async function owner(c: DB, user: string, conversation: string) { requireRow((await c.query('SELECT id FROM conversations WHERE user_id=$1 AND id=$2', [user, conversation])).rows[0]) }
async function enabled(c: DB, user: string) { return (await c.query('SELECT enabled FROM user_memory_settings WHERE user_id=$1', [user])).rows[0]?.enabled === true }
function expiry(value: string | null | undefined): Date | null {
  if (value == null) return null
  // An explicit timezone avoids browser/server timezone disagreement.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new HttpError(400, 'GROWTH_TIME_INVALID')
  return new Date(value)
}
function item(row: Row, reason: string | null = null): GrowthItem {
  const hidden = row.status === 'forgotten' || reason === 'source_revoked'
  return { id: row.id, conversationId: row.conversation_id, kind: row.kind, text: hidden ? '' : row.text, assertion: row.assertion,
    status: reason && ['active','proposed'].includes(row.status) ? 'stale' : row.status, sources: hidden ? [] : row.sources, dependencies: hidden ? [] : row.dependencies,
    validUntil: row.valid_until?.toISOString() ?? null, revision: row.revision, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), unavailableReason: reason }
}
async function availability(c: DB, user: string, row: Row, rows: Map<string, Row>, memoryEnabled: boolean, conversation?: string, seen = new Set<string>()): Promise<string | null> {
  if (['forgotten', 'stale'].includes(row.status)) return row.status === 'forgotten' ? 'source_revoked' : 'changed'
  if (seen.has(row.id)) return 'dependency_cycle'
  if (row.valid_until && row.valid_until.getTime() <= Date.now()) return 'expired'
  if (conversation && row.conversation_id !== conversation && !memoryEnabled) return 'memory_disabled'
  const next = new Set(seen).add(row.id)
  for (const source of row.sources) {
    if (source.type === 'user_edit') continue
    try { await checkCampusSource(c, user, row.conversation_id, memoryEnabled, source) }
    catch (error) { if (!(error instanceof HttpError)) throw error; return 'source_revoked' }
  }
  for (const ref of row.dependencies) {
    const dependency = rows.get(ref.id)
    if (!dependency) return 'dependency_changed'
    const reason = await availability(c, user, dependency, rows, memoryEnabled, conversation, next)
    if (reason === 'source_revoked') return reason
    if (dependency.revision !== ref.revision || reason || !['active','proposed'].includes(dependency.status)) return 'dependency_changed'
  }
  return null
}
export async function growthView(user: string, conversation?: string, c: DB = pool): Promise<GrowthView> {
  if (conversation) await owner(c, user, conversation)
  const memoryEnabled = await enabled(c, user)
  const rows = (await c.query('SELECT * FROM growth_items WHERE user_id=$1 ORDER BY updated_at DESC,id', [user])).rows as Row[]
  const byId = new Map(rows.map(row => [row.id, row]))
  const items: GrowthItem[] = []
  for (const row of rows) {
    if (conversation && row.conversation_id !== conversation && !memoryEnabled) continue
    if (row.status === 'forgotten') continue
    items.push(item(row, await availability(c, user, row, byId, memoryEnabled, conversation)))
  }
  return { memoryEnabled, items }
}
export async function growthContext(user: string, conversation: string) {
  const view = await growthView(user, conversation)
  return view.items.filter(row => !row.unavailableReason && ['active','proposed'].includes(row.status))
}
export const growthSnapshotKey = (items: GrowthItem[]) => fingerprint(items.map(row => [row.id,row.revision,row.status]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))))
export async function assertGrowthSnapshot(c: DB, user: string, conversation: string, refs: GrowthRef[], expectedKey?: string) {
  if (!refs.length && expectedKey === undefined) return
  await lockGrowth(c, user)
  const view = await growthView(user, conversation, c)
  if (expectedKey !== undefined && growthSnapshotKey(view.items.filter(row => !row.unavailableReason && ['active','proposed'].includes(row.status))) !== expectedKey) throw new HttpError(409, 'GROWTH_SNAPSHOT_INVALIDATED')
  for (const ref of refs) {
    const found = view.items.find(row => row.id === ref.id && row.revision === ref.revision)
    if (!found || found.unavailableReason || !['active','proposed'].includes(found.status)) throw new HttpError(409, 'GROWTH_SNAPSHOT_INVALIDATED')
  }
}
async function record(c: DB, row: Row, action: string) {
  await c.query('INSERT INTO growth_revisions(user_id,item_id,revision,action,snapshot) VALUES($1,$2,$3,$4,$5)', [row.user_id, row.id, row.revision, action, item(row)])
}
async function replay(c: DB, user: string, requestId: string, hash: string): Promise<GrowthItem | null> {
  const operation = (await c.query('SELECT fingerprint,item_id FROM growth_operations WHERE user_id=$1 AND request_id=$2', [user, requestId])).rows[0]
  if (!operation) return null
  if (operation.fingerprint !== hash) throw new HttpError(409, 'REQUEST_ID_REUSED')
  return item(requireRow((await c.query('SELECT * FROM growth_items WHERE user_id=$1 AND id=$2', [user, operation.item_id])).rows[0]))
}
export async function createGrowthItem(user: string, raw: GrowthCreate): Promise<GrowthItem> {
  const input = validate(growthCreateSchema, raw), hash = fingerprint(input), validUntil = expiry(input.validUntil)
  if (input.kind === 'constraint' && !validUntil) throw new HttpError(400, 'GROWTH_TIME_REQUIRED')
  return transaction(async c => {
    await lockGrowth(c, user)
    const previous = await replay(c, user, input.requestId, hash); if (previous) return previous
    await owner(c, user, input.conversationId)
    const view = await growthView(user, input.conversationId, c)
    for (const ref of input.dependencies ?? []) {
      const found = view.items.find(row => row.id === ref.id && row.revision === ref.revision)
      if (!found || found.unavailableReason || !['active','proposed'].includes(found.status)) throw new HttpError(409, 'GROWTH_DEPENDENCY_INVALID')
    }
    const row = (await c.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,valid_until) VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$9) RETURNING *", [randomUUID(), user, input.conversationId, input.kind, input.text, input.kind === 'unknown' ? 'unknown' : 'user_edit', JSON.stringify([{ type: 'user_edit', quote: input.text }]), JSON.stringify(input.dependencies ?? []), validUntil])).rows[0] as Row
    await record(c, row, 'create')
    await c.query('INSERT INTO growth_operations(user_id,request_id,fingerprint,item_id) VALUES($1,$2,$3,$4)', [user, input.requestId, hash, row.id])
    return item(row)
  })
}
export async function actOnGrowthItem(user: string, id: string, raw: GrowthAction): Promise<GrowthItem> {
  const input = validate(growthActionSchema, raw), hash = fingerprint({ id, ...input })
  if (input.action === 'correct' && !input.text?.trim()) throw new HttpError(400, 'GROWTH_TEXT_REQUIRED')
  const validUntil = expiry(input.validUntil)
  return transaction(async c => {
    await lockGrowth(c, user)
    const previous = await replay(c, user, input.requestId, hash); if (previous) return previous
    const row = requireRow((await c.query('SELECT * FROM growth_items WHERE user_id=$1 AND id=$2 FOR UPDATE', [user, id])).rows[0]) as Row
    if (row.revision !== input.expectedRevision) throw new HttpError(409, 'GROWTH_REVISION_CONFLICT')
    if (row.status === 'forgotten') throw new HttpError(409, 'GROWTH_FORGOTTEN')
    if (input.action !== 'correct' && (input.text !== undefined || input.validUntil !== undefined)) throw new HttpError(400, 'GROWTH_ACTION_INVALID')
    if (input.action === 'correct' && row.kind === 'constraint' && !(input.validUntil === undefined ? row.valid_until : validUntil)) throw new HttpError(400, 'GROWTH_TIME_REQUIRED')
    const status = input.action === 'correct' ? 'active' : ({ pause: 'paused', complete: 'completed', reject: 'rejected', forget: 'forgotten' } as const)[input.action]
    const forgotten = status === 'forgotten'
    const updated = (await c.query('UPDATE growth_items SET text=$3,assertion=$4,status=$5,sources=$6,valid_until=$7,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *', [user, id,
      forgotten ? '' : input.text ?? row.text, input.action === 'correct' ? row.kind === 'unknown' ? 'unknown' : 'user_edit' : row.assertion,
      status, JSON.stringify(forgotten ? [] : input.action === 'correct' ? [{ type: 'user_edit', quote: input.text }] : row.sources), input.validUntil === undefined ? row.valid_until : validUntil])).rows[0] as Row
    if (forgotten) {
      // Purge retained quotes and historical snapshots, including transitive derivatives.
      const ids = [id]
      for (let index = 0; index < ids.length; index++) {
        const dependents = (await c.query("SELECT id FROM growth_items WHERE user_id=$1 AND dependencies @> $2::jsonb", [user, JSON.stringify([{ id: ids[index] }])])).rows
        for (const dependent of dependents) if (!ids.includes(dependent.id)) ids.push(dependent.id)
      }
      await c.query("UPDATE growth_items SET text='',sources='[]',dependencies='[]',status=CASE WHEN id=$2 THEN 'forgotten' ELSE 'stale' END,revision=CASE WHEN id=$2 THEN revision ELSE revision+1 END,updated_at=now() WHERE user_id=$1 AND id=ANY($3::uuid[])", [user, id, ids])
      await c.query("UPDATE growth_revisions SET snapshot=jsonb_build_object('id',item_id,'revision',revision,'redacted',true) WHERE user_id=$1 AND item_id=ANY($2::uuid[])", [user, ids])
    }
    await record(c, updated, input.action)
    await c.query('INSERT INTO growth_operations(user_id,request_id,fingerprint,item_id) VALUES($1,$2,$3,$4)', [user, input.requestId, hash, id])
    return item(updated)
  })
}
