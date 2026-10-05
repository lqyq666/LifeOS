import { randomUUID, createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, transaction, HttpError, requireRow } from './db.ts'
import { checkCampusSource } from './campus.ts'
import { validate } from './contracts.ts'
import { growthCreateSchema, growthActionSchema, type GrowthCreate, type GrowthAction } from './growth-contracts.ts'
import type { GrowthItem, GrowthRef, GrowthView } from '../src/features/growth/types.ts'
import type { GrowthDelta,GrowthInputDelta } from './growth-model-contracts.ts'
import type { Run } from './store.ts'

type DB = Pick<PoolClient, 'query'>
type Row = { id: string; user_id: string; conversation_id: string; kind: GrowthItem['kind']; text: string; assertion: GrowthItem['assertion']; status: GrowthItem['status']; sources: GrowthItem['sources']; dependencies: GrowthRef[]; valid_until: Date | null; revision: number; created_at: Date; updated_at: Date; limitation?:string;progress_state?:GrowthItem['progressState'] }
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
    validUntil: row.valid_until?.toISOString() ?? null, revision: row.revision, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), unavailableReason: reason,limitation:hidden?'':row.limitation??'',progressState:hidden?null:row.progress_state??null }
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
export async function growthBoundaryContext(user:string,conversation:string){
  return (await growthView(user,conversation)).items.filter(row=>!row.unavailableReason&&['rejected','paused'].includes(row.status))
}
export const growthSnapshotKey = (items: GrowthItem[]) => fingerprint(items.map(row => [row.id,row.revision,row.status]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))))
export async function assertGrowthSnapshot(c: DB, user: string, conversation: string, refs: GrowthRef[], expectedKey?: string, boundaryKey?:string) {
  if (!refs.length && expectedKey === undefined && boundaryKey===undefined) return
  await lockGrowth(c, user)
  const view = await growthView(user, conversation, c)
  if(boundaryKey!==undefined&&growthSnapshotKey(view.items.filter(row=>!row.unavailableReason&&['rejected','paused'].includes(row.status)))!==boundaryKey)throw new HttpError(409,'GROWTH_SNAPSHOT_INVALIDATED')
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
  if(input.kind!=='feedback'&&input.progressState!==undefined)throw new HttpError(400,'GROWTH_FEEDBACK_INVALID')
  return transaction(async c => {
    await lockGrowth(c, user)
    const previous = await replay(c, user, input.requestId, hash); if (previous) return previous
    await owner(c, user, input.conversationId)
    const view = await growthView(user, input.conversationId, c)
    for (const ref of input.dependencies ?? []) {
      const found = view.items.find(row => row.id === ref.id && row.revision === ref.revision)
      if (!found || found.unavailableReason || !['active','proposed'].includes(found.status)) throw new HttpError(409, 'GROWTH_DEPENDENCY_INVALID')
    }
    const row = (await c.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,valid_until,progress_state) VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10) RETURNING *", [randomUUID(), user, input.conversationId, input.kind, input.text, input.kind === 'unknown' ? 'unknown' : 'user_edit', JSON.stringify([{ type: 'user_edit', quote: input.text }]), JSON.stringify(input.dependencies ?? []), validUntil,input.kind==='feedback'?input.progressState??'unknown':null])).rows[0] as Row
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
    if (input.action !== 'correct' && (input.text !== undefined || input.validUntil !== undefined || input.progressState!==undefined)) throw new HttpError(400, 'GROWTH_ACTION_INVALID')
    if(row.kind!=='feedback'&&input.progressState!==undefined)throw new HttpError(400,'GROWTH_FEEDBACK_INVALID')
    if(input.action==='accept'){
      if(row.status!=='proposed'||row.assertion!=='ai_observation')throw new HttpError(400,'GROWTH_ACTION_INVALID')
      const available=(await growthView(user,row.conversation_id,c)).items.find(entry=>entry.id===id)
      if(!available||available.unavailableReason)throw new HttpError(409,'GROWTH_DEPENDENCY_INVALID')
    }
    if (input.action === 'correct' && row.kind === 'constraint' && !(input.validUntil === undefined ? row.valid_until : validUntil)) throw new HttpError(400, 'GROWTH_TIME_REQUIRED')
    const status = input.action === 'correct' ? 'active' : ({ accept:'active',pause: 'paused', complete: 'completed', reject: 'rejected', forget: 'forgotten' } as const)[input.action]
    const forgotten = status === 'forgotten'
    const updated = (await c.query('UPDATE growth_items SET text=$3,assertion=$4,status=$5,sources=$6,valid_until=$7,limitation=$8,progress_state=$9,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *', [user, id,
      forgotten ? '' : input.text ?? row.text, input.action === 'correct' ? row.kind === 'unknown' ? 'unknown' : 'user_edit' : row.assertion,
      status, JSON.stringify(forgotten ? [] : input.action === 'correct' ? [{ type: 'user_edit', quote: input.text }] : row.sources), input.validUntil === undefined ? row.valid_until : validUntil,
      forgotten||input.action==='correct'?'':row.limitation??'',forgotten?null:row.kind==='feedback'?input.progressState??row.progress_state??'unknown':null])).rows[0] as Row
    if (forgotten) {
      // Preserve independent facts from the same message: tombstones cover
      // exact reported spans, rather than suppressing the whole source message.
      const prior=(await c.query('SELECT snapshot FROM growth_revisions WHERE user_id=$1 AND item_id=$2',[user,id])).rows
      for(const history of prior){
        if(!['user_reported','user_edit','unknown'].includes(history.snapshot.assertion))continue
        for(const source of history.snapshot.sources??[])if(source.type==='message')await c.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[user,history.snapshot.conversationId,source.id,source.quote])
      }
      // Purge retained quotes and historical snapshots, including transitive derivatives.
      const ids = [id]
      for (let index = 0; index < ids.length; index++) {
        const dependents = (await c.query("SELECT id FROM growth_items WHERE user_id=$1 AND dependencies @> $2::jsonb", [user, JSON.stringify([{ id: ids[index] }])])).rows
        for (const dependent of dependents) if (!ids.includes(dependent.id)) ids.push(dependent.id)
      }
      await c.query("UPDATE growth_items SET text='',limitation='',progress_state=NULL,sources='[]',dependencies='[]',status=CASE WHEN id=$2 THEN 'forgotten' ELSE 'stale' END,revision=CASE WHEN id=$2 THEN revision ELSE revision+1 END,updated_at=now() WHERE user_id=$1 AND id=ANY($3::uuid[])", [user, id, ids])
      await c.query("UPDATE growth_revisions SET snapshot=jsonb_build_object('id',item_id,'revision',revision,'redacted',true) WHERE user_id=$1 AND item_id=ANY($2::uuid[])", [user, ids])
    }
    await record(c, updated, input.action)
    await c.query('INSERT INTO growth_operations(user_id,request_id,fingerprint,item_id) VALUES($1,$2,$3,$4)', [user, input.requestId, hash, id])
    return item(updated)
  })
}

export type GrowthStaged={changes:GrowthDelta[]}
export async function stageGrowthUpdates(run:Run,changes:GrowthInputDelta[],authorized:GrowthItem[]):Promise<GrowthStaged> {
  const current=requireRow((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role='user'",[run.user_id,run.conversation_id,run.source_message_id])).rows[0])
  const replacements=new Set<string>()
  const unique:GrowthDelta[]=[]
  for(const change of changes){
    // Select one source span once. Derivation adds no claim and never repairs a
    // supplied paraphrase: legacy text remains subject to the same exact guard.
    const selectedText=change.assertion==='user_reported'&&change.text===undefined?change.source.quote:change.text
    if(typeof selectedText!=='string')throw new HttpError(400,'GROWTH_SOURCE_INVALID')
    const delta:GrowthDelta={...change,text:selectedText}
    if(delta.source.messageId!==run.source_message_id||!delta.source.quote.trim()||!current.content.includes(delta.source.quote))throw new HttpError(400,'GROWTH_SOURCE_INVALID')
    await checkCampusSource(pool,run.user_id,run.conversation_id,true,{type:'message',id:delta.source.messageId,quote:delta.source.quote})
    if(delta.assertion==='user_reported'&&(!delta.text.trim()||delta.text.length>4000||!delta.source.quote.includes(delta.text)))throw new HttpError(400,'GROWTH_SOURCE_INVALID')
    if(delta.target.operation==='replace'){
      const selected=delta.target
      const target=authorized.find(row=>row.id===selected.itemId&&row.revision===selected.expectedRevision)
      if(!target||replacements.has(target.id)||(target.kind!==delta.kind&&target.kind!=='unknown'))throw new HttpError(400,'GROWTH_TARGET_INVALID')
      if(target.text===delta.text||target.text.includes(delta.text))throw new HttpError(400,'GROWTH_UNCHANGED')
      replacements.add(target.id)
    }
    if(delta.assertion==='ai_observation'){
      if(!delta.limitation.trim())throw new HttpError(400,'GROWTH_OBSERVATION_INVALID')
      if(!delta.dependencies.length)throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
      for(const ref of delta.dependencies)if(!authorized.some(row=>row.id===ref.id&&row.revision===ref.revision&&!row.unavailableReason&&['active','proposed'].includes(row.status)))throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
    }
    if('validUntil'in delta)expiry(delta.validUntil)
    if(delta.kind==='constraint'&&(!('validUntil'in delta)||!delta.validUntil))throw new HttpError(400,'GROWTH_TIME_REQUIRED')
    if(delta.kind==='feedback'&&(!('progressState'in delta)||!delta.progressState))throw new HttpError(400,'GROWTH_FEEDBACK_INVALID')
    if(delta.kind!=='feedback'&&'progressState'in delta&&delta.progressState)throw new HttpError(400,'GROWTH_FEEDBACK_INVALID')
    if(!unique.some(row=>row.target.operation==='create'&&delta.target.operation==='create'&&row.kind===delta.kind&&row.text===delta.text))unique.push(delta)
  }
  return {changes:unique}
}
export async function persistGrowthUpdates(c:PoolClient,run:Run,staged:GrowthStaged):Promise<string[]> {
  if(!staged.changes.length)return []
  await lockGrowth(c,run.user_id)
  const ids:string[]=[]
  for(const delta of staged.changes){
    const source={type:'message' as const,id:run.source_message_id,quote:delta.assertion==='user_reported'?delta.text:delta.source.quote}
    await checkCampusSource(c,run.user_id,run.conversation_id,true,source,true)
    const refs=delta.assertion==='ai_observation'?delta.dependencies:[]
    for(const ref of refs){const dependency=(await c.query('SELECT revision,status FROM growth_items WHERE user_id=$1 AND id=$2 FOR SHARE',[run.user_id,ref.id])).rows[0];if(!dependency||dependency.revision!==ref.revision||!['active','proposed'].includes(dependency.status))throw new HttpError(409,'GROWTH_SNAPSHOT_INVALIDATED')}
    const status=delta.assertion==='ai_observation'?'proposed':'active',limitation=delta.assertion==='ai_observation'?delta.limitation:'',validUntil='validUntil'in delta?expiry(delta.validUntil):null,progressState='progressState'in delta?delta.progressState??null:null
    let row:Row
    if(delta.target.operation==='create'){
      const existing=(await c.query('SELECT * FROM growth_items WHERE user_id=$1 AND kind=$2 AND text=$3 AND status IN (\'active\',\'proposed\') AND sources @> $4::jsonb',[run.user_id,delta.kind,delta.text,JSON.stringify([source])])).rows[0]
      if(existing){ids.push(existing.id);continue}
      row=(await c.query('INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,valid_until,limitation,progress_state,origin_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[randomUUID(),run.user_id,run.conversation_id,delta.kind,delta.text,delta.assertion,status,JSON.stringify([source]),JSON.stringify(refs),validUntil,limitation,progressState,run.request_id])).rows[0]
    }else{
      row=requireRow((await c.query('UPDATE growth_items SET kind=$4,text=$5,assertion=$6,status=$7,sources=$8,dependencies=$9,valid_until=$10,limitation=$11,progress_state=$12,origin_request_id=$13,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 AND revision=$3 AND status IN (\'active\',\'proposed\') RETURNING *',[run.user_id,delta.target.itemId,delta.target.expectedRevision,delta.kind,delta.text,delta.assertion,status,JSON.stringify([source]),JSON.stringify(refs),validUntil,limitation,progressState,run.request_id])).rows[0])
    }
    await record(c,row,delta.target.operation==='create'?'extract':'replace');ids.push(row.id)
  }
  return ids
}
