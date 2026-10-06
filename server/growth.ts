import { randomUUID, createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, transaction, HttpError, requireRow } from './db.ts'
import { checkCampusSource } from './campus.ts'
import { validate } from './contracts.ts'
import { growthCreateSchema, growthActionSchema, type GrowthCreate, type GrowthAction } from './growth-contracts.ts'
import { amendExactClause, carriesPersonalText, fromLegacyText, FragmentError, type Fragment, type Source } from './growth-source-fragments.ts'
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
      // Lineage-aware precise forgetting (P1.5): forgetting a changed fragment
      // also retires the exact superseded old fragment from its parent's
      // original source message — never the whole composite parent quote — and
      // redacts the lineage audit row. Forgetting a parent redacts any remaining
      // lineage quotes derived from it while the independent children stay.
      const changedLineage = (await c.query("SELECT parent_id,parent_revision,superseded_quote FROM growth_item_lineage WHERE user_id=$1 AND child_id=$2 AND fragment_role='changed' AND NOT source_redacted", [user, id])).rows as { parent_id: string; parent_revision: number; superseded_quote: string | null }[]
      for (const row of changedLineage) {
        if (row.superseded_quote) {
          const revision = (await c.query('SELECT snapshot FROM growth_revisions WHERE user_id=$1 AND item_id=$2 AND revision=$3', [user, row.parent_id, row.parent_revision])).rows[0] as { snapshot: { conversationId: string; sources: { type: string; id?: string }[] } } | undefined
          const messageSource = revision?.snapshot?.sources?.find(source => source.type === 'message' && typeof source.id === 'string')
          if (messageSource?.id && revision) await c.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [user, revision.snapshot.conversationId, messageSource.id, row.superseded_quote])
        }
        await c.query('UPDATE growth_item_lineage SET superseded_quote=NULL,source_redacted=true WHERE user_id=$1 AND parent_id=$2 AND parent_revision=$3 AND child_id=$4', [user, row.parent_id, row.parent_revision, id])
      }
      if ((await c.query('SELECT 1 FROM growth_item_lineage WHERE user_id=$1 AND parent_id=$2 AND superseded_quote IS NOT NULL', [user, id])).rowCount) {
        await c.query('UPDATE growth_item_lineage SET superseded_quote=NULL,source_redacted=true WHERE user_id=$1 AND parent_id=$2 AND superseded_quote IS NOT NULL', [user, id])
      }
    }
    await record(c, updated, input.action)
    await c.query('INSERT INTO growth_operations(user_id,request_id,fingerprint,item_id) VALUES($1,$2,$3,$4)', [user, input.requestId, hash, id])
    return item(updated)
  })
}

export type PreparedGrowthMutation =
  | { kind: 'ordinary'; delta: GrowthDelta }
  | {
      kind: 'split_amend'; inputIndex: number;
      parent: { id: string; revision: number };
      beforeQuote: string;
      currentSource: { messageId: string; quote: string };
      fragments: Fragment[];
      changedFragmentIndex: number;
    }
export type GrowthStaged={changes:GrowthDelta[];prepared:PreparedGrowthMutation[];skipped?:{quote:string,reason:'reasserted_prior_message'|'unverifiable_constraint_time'|'unverified_span'|'dropped_dependency'}[]}
const asFragmentError=(error:unknown):never=>{if(error instanceof FragmentError)throw new HttpError(400,error.code);throw error}
const toFragmentSources=(sources:GrowthItem['sources']):Source[]=>sources.map(source=>source.type==='message'?{type:'message',id:source.id,quote:source.quote}:{type:'user_edit',quote:source.quote})
export async function stageGrowthUpdates(run:Run,changes:GrowthInputDelta[],authorized:GrowthItem[]):Promise<GrowthStaged> {
  const current=requireRow((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role='user'",[run.user_id,run.conversation_id,run.source_message_id])).rows[0])
  // Models routinely re-assert facts the user already stated in an earlier
  // message of this conversation, binding the old quote to the current message
  // id. Those items are dropped idempotently instead of failing the turn:
  // nothing is re-saved, nothing withdrawn is resurrected, and a quote that is
  // the user's verbatim words nowhere remains a hard fabrication failure.
  const earlier=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND role='user' AND id<>$3",[run.user_id,run.conversation_id,run.source_message_id])).rows as {content:string}[]
  const saidEarlier=(quote:string)=>earlier.some(row=>row.content.includes(quote))
  const skipped:{quote:string,reason:'reasserted_prior_message'|'unverifiable_constraint_time'|'unverified_span'|'dropped_dependency'}[]=[]
  const skippedIndexes=new Set<number>()
  const constraintTimeVerifiable=(change:GrowthInputDelta):boolean=>{
    if(change.kind!=='constraint')return true
    const value='validUntil'in change?change.validUntil:undefined
    if(!value)return false
    try{expiry(value)}catch{return false}
    if(/学期|暑假|寒假/.test(change.source.quote)){
      // A semester/vacation name supplies no cutoff; require its explicit end
      // date in this verified span instead of fabricating an academic calendar.
      const cutoff=Date.parse(value),day=Number.isFinite(cutoff)?new Date(cutoff).toISOString().slice(0,10):''
      const end=change.source.quote.match(/(?:截至|截止|直到|至|到|结束于)\s*(20\d{2})(?:年|-)(\d{1,2})(?:月|-)(\d{1,2})日?/)
      const stated=end?`${end[1]}-${end[2].padStart(2,'0')}-${end[3].padStart(2,'0')}`:null
      if(!stated||stated!==day)return false
    }
    return true
  }
  for(const [index,change] of changes.entries()){
    if(typeof (change.assertion==='user_reported'&&change.text===undefined?change.source.quote:change.text)!=='string')throw new HttpError(400,'GROWTH_SOURCE_INVALID')
    if(change.source.messageId===run.source_message_id&&change.source.quote.trim()&&!current.content.includes(change.source.quote)&&saidEarlier(change.source.quote)){
      skippedIndexes.add(index);skipped.push({quote:change.source.quote,reason:'reasserted_prior_message'});continue
    }
    if(change.source.messageId===run.source_message_id&&change.source.quote.trim()&&!current.content.includes(change.source.quote)){
      // The quote is the user's verbatim words nowhere in this conversation:
      // never save it, but one paraphrasing item must not fail its verified
      // siblings — drop it and keep the turn.
      skippedIndexes.add(index);skipped.push({quote:change.source.quote,reason:'unverified_span'});continue
    }
    if(change.source.messageId!==run.source_message_id||!change.source.quote.trim()||!current.content.includes(change.source.quote))throw new HttpError(400,'GROWTH_SOURCE_INVALID')
    if(!constraintTimeVerifiable(change)){
      // A constraint whose expiry the user never verifiably stated is unsafe to
      // save; dropping that one item keeps the turn's verified facts intact.
      skippedIndexes.add(index);skipped.push({quote:change.source.quote,reason:'unverifiable_constraint_time'});continue
    }
  }
  // Observations may only stand on facts that actually persisted this turn.
  for(let pass=0;pass<changes.length;pass++){
    let cascaded=false
    for(const [index,change] of changes.entries()){
      if(skippedIndexes.has(index)||change.assertion!=='ai_observation')continue
      if(change.dependencies.some(ref=>'updateIndex'in ref&&skippedIndexes.has(ref.updateIndex))){skippedIndexes.add(index);skipped.push({quote:change.source.quote,reason:'dropped_dependency'});cascaded=true}
    }
    if(!cascaded)break
  }
  const replacements=new Set<string>()
  const unique:GrowthDelta[]=[]
  const prepared:PreparedGrowthMutation[]=[]
  const positions:number[]=[]
  for(const [index,change] of changes.entries()){
    if(skippedIndexes.has(index)){positions.push(-1);continue}
    // Select one source span once. Derivation adds no claim and never repairs a
    // supplied paraphrase: legacy text remains subject to the same exact guard.
    const selectedText=change.assertion==='user_reported'&&change.text===undefined?change.source.quote:change.text
    if(typeof selectedText!=='string')throw new HttpError(400,'GROWTH_SOURCE_INVALID')
    const delta:GrowthDelta={...change,text:selectedText}
    await checkCampusSource(pool,run.user_id,run.conversation_id,true,{type:'message',id:delta.source.messageId,quote:delta.source.quote})
    if(delta.assertion==='user_reported'&&(!delta.text.trim()||delta.text.length>4000||!delta.source.quote.includes(delta.text)))throw new HttpError(400,'GROWTH_SOURCE_INVALID')
    let mutation:PreparedGrowthMutation
    if(delta.target.operation==='replace'||delta.target.operation==='amend'){
      const selected=delta.target
      const target=authorized.find(row=>row.id===selected.itemId&&row.revision===selected.expectedRevision)
      if(!target||replacements.has(target.id)||(target.kind!==delta.kind&&target.kind!=='unknown'))throw new HttpError(400,'GROWTH_TARGET_INVALID')
      if(selected.operation==='amend'){
        // amend corrects ONE clause of a user-supplied composite of the same
        // field; unknown→answer and explicit whole-item rewrites stay on replace,
        // and the model never supplies the merged text.
        if(change.text!==undefined)throw new HttpError(400,'GROWTH_SOURCE_INVALID')
        if(target.kind!==delta.kind||!['user_reported','user_edit'].includes(target.assertion)||target.unavailableReason)throw new HttpError(400,'GROWTH_TARGET_INVALID')
        const analysis=(()=>{try{
          return amendExactClause(fromLegacyText(target.text,toFragmentSources(target.sources)),selected.beforeQuote,{type:'message',id:run.source_message_id,quote:delta.source.quote},current.content)
        }catch(error){throw asFragmentError(error)}})()
        const changedFragmentIndex=analysis.fragments.findIndex(part=>part.source.type==='message'&&part.source.id===run.source_message_id)
        const personal=analysis.fragments.filter(part=>carriesPersonalText(part.text))
        // One full clause in the old item: exchange that fact in place under
        // CAS (no split); anything else splits with retained siblings.
        mutation=(changedFragmentIndex>=0&&personal.length===1&&personal[0]===analysis.fragments[changedFragmentIndex])
          ?{kind:'ordinary',delta}
          :{kind:'split_amend',inputIndex:-1,parent:{id:selected.itemId,revision:selected.expectedRevision},beforeQuote:selected.beforeQuote,currentSource:{messageId:run.source_message_id,quote:delta.source.quote},fragments:analysis.fragments,changedFragmentIndex}
      }else{
        if(target.text===delta.text||target.text.includes(delta.text))throw new HttpError(400,'GROWTH_UNCHANGED')
        mutation={kind:'ordinary',delta}
      }
      replacements.add(target.id)
    }else mutation={kind:'ordinary',delta}
    if(delta.assertion==='ai_observation'){
      if(!delta.limitation.trim())throw new HttpError(400,'GROWTH_OBSERVATION_INVALID')
      if(!delta.dependencies.length)throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
      for(const ref of delta.dependencies){
        if('updateIndex'in ref){
          if(!Number.isInteger(ref.updateIndex)||ref.updateIndex<0||ref.updateIndex>=changes.length||changes[ref.updateIndex].assertion!=='user_reported')throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
          const basis=changes[ref.updateIndex]
          if('validUntil'in basis&&basis.validUntil&&expiry(basis.validUntil)!.getTime()<=Date.now())throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
        }else if(!authorized.some(row=>row.id===ref.id&&row.revision===ref.revision&&!row.unavailableReason&&['active','proposed'].includes(row.status)))throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
      }
    }
    if('validUntil'in delta)expiry(delta.validUntil)
    if(delta.kind==='feedback'&&(!('progressState'in delta)||!delta.progressState))throw new HttpError(400,'GROWTH_FEEDBACK_INVALID')
    if(delta.kind!=='feedback'&&'progressState'in delta&&delta.progressState)throw new HttpError(400,'GROWTH_FEEDBACK_INVALID')
    const existing=unique.findIndex(row=>row.target.operation==='create'&&delta.target.operation==='create'&&row.kind===delta.kind&&row.assertion==='user_reported'&&delta.assertion==='user_reported'&&row.text===delta.text&&row.source.quote===delta.source.quote&&('validUntil'in row?row.validUntil:null)===('validUntil'in delta?delta.validUntil:null)&&('progressState'in row?row.progressState:null)===('progressState'in delta?delta.progressState:null))
    positions.push(existing<0?unique.length:existing)
    if(existing<0){
      if(mutation.kind==='split_amend')mutation.inputIndex=unique.length
      unique.push(delta)
      prepared.push(mutation)
    }
  }
  // References describe the authorized pre-turn snapshot. Replacing their
  // target in this same batch would invalidate them regardless of write order;
  // never silently upgrade a model's evidence to the new revision.
  if(prepared.some(entry=>entry.kind==='ordinary'&&entry.delta.assertion==='ai_observation'&&entry.delta.dependencies.some(ref=>'id'in ref&&replacements.has(ref.id))))throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
  // Map explicit input positions through duplicate removal without changing
  // which verified fact the model selected; raw provider output stays intact.
  for(let uniqueIndex=0;uniqueIndex<unique.length;uniqueIndex++){
    const delta=unique[uniqueIndex]!
    if(delta.assertion!=='ai_observation')continue
    const remapped={...delta,dependencies:delta.dependencies.map(ref=>'updateIndex'in ref?{updateIndex:positions[ref.updateIndex]!}:ref)}
    unique[uniqueIndex]=remapped
    const mutation=prepared[uniqueIndex]!
    if(mutation.kind==='ordinary')prepared[uniqueIndex]={kind:'ordinary',delta:remapped}
  }
  return {changes:unique,prepared,skipped:skipped.length?skipped:undefined}
}
export async function persistGrowthUpdates(c:PoolClient,run:Run,staged:GrowthStaged):Promise<{ids:string[];changedIds:string[];retainedIds:string[]}> {
  if(!staged.changes.length)return {ids:[],changedIds:[],retainedIds:[]}
  await lockGrowth(c,run.user_id)
  const ids:string[]=[],changedIds:string[]=[],retainedIds:string[]=[],written=new Map<number,Row>()
  const replacements=new Set(staged.prepared.flatMap(entry=>entry.kind==='ordinary'&&entry.delta.target.operation==='replace'?[entry.delta.target.itemId]:entry.kind==='split_amend'?[entry.parent.id]:[]))
  // Keep external references strict, even if an internal caller bypassed stage.
  for(const entry of staged.prepared)if(entry.kind==='ordinary'&&entry.delta.assertion==='ai_observation')for(const ref of entry.delta.dependencies)if('id'in ref&&replacements.has(ref.id))throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
  const order=staged.prepared.map((mutation,index)=>({mutation,index})).sort((a,b)=>Number(a.mutation.kind==='ordinary'&&a.mutation.delta.assertion==='ai_observation')-Number(b.mutation.kind==='ordinary'&&b.mutation.delta.assertion==='ai_observation'))
  for(const {mutation,index} of order){
    if(mutation.kind==='split_amend'){
      // P1.3 steps 1–8: everything is re-derived under the row lock from the
      // authoritative parent row and current message; staged fragments were an
      // early, advisory validation only.
      const delta=requireRow(staged.changes[mutation.inputIndex]) as GrowthDelta
      const parent=(await c.query('SELECT * FROM growth_items WHERE user_id=$1 AND id=$2 FOR UPDATE',[run.user_id,mutation.parent.id])).rows[0] as Row|undefined
      if(!parent||parent.revision!==mutation.parent.revision||!['active','proposed'].includes(parent.status)||!['user_reported','user_edit'].includes(parent.assertion))throw new HttpError(409,'GROWTH_SNAPSHOT_INVALIDATED')
      const message=requireRow((await c.query("SELECT content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role='user'",[run.user_id,run.conversation_id,run.source_message_id])).rows[0]) as {content:string}
      const parentSources=toFragmentSources(parent.sources)
      for(const source of parentSources){
        // Withdrawn or unauthorized originals fail the whole mutation.
        if(source.type==='message')await checkCampusSource(c,run.user_id,parent.conversation_id,true,source,true)
      }
      const analysis=(()=>{try{
        return amendExactClause(fromLegacyText(parent.text,parentSources),mutation.beforeQuote,{type:'message',id:run.source_message_id,quote:mutation.currentSource.quote},message.content)
      }catch(error){throw asFragmentError(error)}})()
      const changedFragmentIndex=analysis.fragments.findIndex(part=>part.source.type==='message'&&part.source.id===run.source_message_id)
      const personal=analysis.fragments.filter(part=>carriesPersonalText(part.text))
      if(changedFragmentIndex>=0&&personal.length===1&&personal[0]===analysis.fragments[changedFragmentIndex]){
        // The old item held exactly one full clause: exchange that fact in
        // place under CAS; no split, no lineage (P1.3 step 6).
        const updatedRow=(await c.query("UPDATE growth_items SET kind=$4,text=$5,assertion='user_reported',status='active',sources=$6,dependencies='[]',valid_until=$7,limitation='',progress_state=$8,origin_request_id=$9,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 AND revision=$3 AND status IN ('active','proposed') RETURNING *",[run.user_id,parent.id,mutation.parent.revision,delta.kind,analysis.text,JSON.stringify([{type:'message',id:run.source_message_id,quote:mutation.currentSource.quote}]),'validUntil'in delta?expiry(delta.validUntil):null,delta.kind==='feedback'?(delta as Extract<GrowthDelta,{kind:'feedback'}>).progressState:null,run.request_id])).rows[0] as Row|undefined
        if(!updatedRow)throw new HttpError(409,'GROWTH_SNAPSHOT_INVALIDATED')
        await record(c,updatedRow,'amend')
        ids[mutation.inputIndex]=updatedRow.id;changedIds.push(updatedRow.id);written.set(mutation.inputIndex,updatedRow)
        continue
      }
      // Step 2: the parent becomes stale history (text kept), revision+1, with
      // a supersede audit — never a deletion.
      const supersededRow=(await c.query("UPDATE growth_items SET status='stale',revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 AND revision=$3 AND status IN ('active','proposed') RETURNING *",[run.user_id,parent.id,mutation.parent.revision])).rows[0] as Row|undefined
      if(!supersededRow)throw new HttpError(409,'GROWTH_SNAPSHOT_INVALIDATED')
      await record(c,supersededRow,'supersede')
      // Steps 3–5: retained clauses become independent items pointing at their
      // ORIGINAL user sources; the corrected clause points at this message with
      // its own validity; lineage records the evidence-backed split.
      for(const [fragmentIndex,fragment] of analysis.fragments.entries()){
        if(!carriesPersonalText(fragment.text))continue
        const isChanged=fragmentIndex===changedFragmentIndex
        // Retained clauses drop standalone leading/trailing delimiters from the
        // slice; the trimmed text stays a verbatim substring of the original
        // user message, so provenance is unchanged.
        const childText=isChanged?fragment.text:fragment.text.replace(/^[，,；;。！？!?\n]+/,'').replace(/[，,；;。！？!?\n]+$/,'')
        if(!childText)continue
        if(!isChanged&&fragment.source.type==='message')await checkCampusSource(c,run.user_id,parent.conversation_id,true,fragment.source,true)
        const childSource=isChanged?{type:'message' as const,id:run.source_message_id,quote:childText}:{...fragment.source,quote:childText}
        const child=(await c.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,valid_until,limitation,progress_state,origin_request_id) VALUES($1,$2,$3,$4,$5,$6,'active',$7,'[]',$8,'',$9,$10) RETURNING *",[randomUUID(),run.user_id,isChanged?run.conversation_id:parent.conversation_id,isChanged?delta.kind:parent.kind,childText,isChanged?'user_reported':parent.assertion,JSON.stringify([childSource]),isChanged&&'validUntil'in delta?expiry(delta.validUntil):null,isChanged&&delta.kind==='feedback'?(delta as Extract<GrowthDelta,{kind:'feedback'}>).progressState:null,run.request_id])).rows[0] as Row
        await record(c,child,'split')
        await c.query("INSERT INTO growth_item_lineage(user_id,parent_id,parent_revision,child_id,relation,fragment_role,superseded_quote) VALUES($1,$2,$3,$4,'split_from',$5,$6)",[run.user_id,parent.id,supersededRow.revision,child.id,isChanged?'changed':'retained',isChanged?mutation.beforeQuote:null])
        if(isChanged){ids[mutation.inputIndex]=child.id;changedIds.push(child.id);written.set(mutation.inputIndex,child)}
        else retainedIds.push(child.id)
      }
      // Steps 7–8: this updateIndex resolves to the changed item; old dependents
      // lose availability on their own through the parent's stale revision and
      // are never auto-upgraded.
      continue
    }
    const delta=mutation.delta
    const source={type:'message' as const,id:run.source_message_id,quote:delta.assertion==='user_reported'?delta.text:delta.source.quote}
    await checkCampusSource(c,run.user_id,run.conversation_id,true,source,true)
    const refs:GrowthRef[]=delta.assertion==='ai_observation'?delta.dependencies.map(ref=>{
      if('id'in ref)return ref
      const dependency=written.get(ref.updateIndex)
      if(!dependency||staged.changes[ref.updateIndex]?.assertion!=='user_reported')throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
      return {id:dependency.id,revision:dependency.revision}
    }):[]
    for(const ref of refs){const dependency=(await c.query('SELECT revision,status,valid_until FROM growth_items WHERE user_id=$1 AND id=$2 FOR SHARE',[run.user_id,ref.id])).rows[0];if(!dependency||dependency.revision!==ref.revision||!['active','proposed'].includes(dependency.status)||dependency.valid_until&&dependency.valid_until.getTime()<=Date.now())throw new HttpError(409,'GROWTH_SNAPSHOT_INVALIDATED')}
    const status=delta.assertion==='ai_observation'?'proposed':'active',limitation=delta.assertion==='ai_observation'?delta.limitation:'',validUntil='validUntil'in delta?expiry(delta.validUntil):null,progressState='progressState'in delta?delta.progressState??null:null
    let row:Row
    if(delta.target.operation==='create'){
      const existing=(await c.query('SELECT * FROM growth_items WHERE user_id=$1 AND kind=$2 AND text=$3 AND status IN (\'active\',\'proposed\') AND sources @> $4::jsonb AND assertion=$5 AND dependencies=$6::jsonb AND limitation=$7',[run.user_id,delta.kind,delta.text,JSON.stringify([source]),delta.assertion,JSON.stringify(refs),limitation])).rows[0]
      if(existing){ids[index]=existing.id;written.set(index,existing);continue}
      row=(await c.query('INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,valid_until,limitation,progress_state,origin_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[randomUUID(),run.user_id,run.conversation_id,delta.kind,delta.text,delta.assertion,status,JSON.stringify([source]),JSON.stringify(refs),validUntil,limitation,progressState,run.request_id])).rows[0]
    }else{
      // CAS update: a missing row is a revision conflict, never a silent
      // re-read of the newer revision (P1.6).
      const updatedRow=(await c.query('UPDATE growth_items SET kind=$4,text=$5,assertion=$6,status=$7,sources=$8,dependencies=$9,valid_until=$10,limitation=$11,progress_state=$12,origin_request_id=$13,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 AND revision=$3 AND status IN (\'active\',\'proposed\') RETURNING *',[run.user_id,delta.target.itemId,delta.target.expectedRevision,delta.kind,delta.text,delta.assertion,status,JSON.stringify([source]),JSON.stringify(refs),validUntil,limitation,progressState,run.request_id])).rows[0] as Row|undefined
      if(!updatedRow)throw new HttpError(409,'GROWTH_SNAPSHOT_INVALIDATED')
      row=updatedRow
    }
    await record(c,row,delta.target.operation==='create'?'extract':delta.target.operation);ids[index]=row.id;written.set(index,row)
    if(delta.target.operation!=='create')changedIds.push(row.id)
  }
  return {ids,changedIds,retainedIds}
}
