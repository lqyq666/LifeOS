import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { Type, type Static } from 'typebox'
import { pool, transaction, HttpError, requireRow } from './db.ts'
import { applyGrowthAction,lockGrowth } from './growth.ts'
import { applyExperienceAction,type Run } from './store.ts'
import {detectForgetIntentClauses} from './forget-intent.ts'
import {selectStructuralCandidates} from './experience-content.ts'
import {buildClauseCatalogue} from './clause-catalogue.ts'
import {scanUserClauses} from './user-command-spans.ts'

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

// A chat request naming an entire episode has a wider scope than a single
// fact card. Resolve that scope from verified episode spans, never similarity.
async function episodeForgetScope(c:PoolClient,run:Run,staged:StagedMemoryControl){
  if(staged.kind!=='forget'||!/(?:那段|这段)经历(?:记录)?[。！!\s]*$/.test(staged.clauseText))return null
  if(scanUserClauses(staged.clauseText).some(clause=>clause.quoteSpans.length||clause.codeSpans.length))throw new HttpError(409,'CONTROL_EPISODE_SCOPE_UNVERIFIED')
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[run.user_id+':memory-settings'])
  await lockGrowth(c,run.user_id)
  const primary=requireRow((await c.query('SELECT revision,sources FROM growth_items WHERE user_id=$1 AND id=$2 FOR UPDATE',[run.user_id,staged.itemId])).rows[0])
  if(primary.revision!==staged.expectedRevision)throw new HttpError(409,'GROWTH_REVISION_CONFLICT')
  const native=(await c.query("SELECT e.id,e.revision FROM experiences e WHERE e.user_id=$1 AND e.status<>'deleted' AND EXISTS(SELECT 1 FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value) WHERE r.user_id=e.user_id AND a.value->>'phase'='canonical_contribution_staged' AND a.value->>'experienceId'=e.id::text AND a.value->>'factId'=$2 AND a.value->>'factRevision'=$3) FOR UPDATE",[run.user_id,staged.itemId,String(primary.revision)])).rows
  if(native.length>1)throw new HttpError(409,'CONTROL_EPISODE_AMBIGUOUS')
  if(native.length===1)return {episode:native[0],related:[],sourceSuppressions:[],native:true}
  const episodes=(await c.query("SELECT e.id,e.revision,e.source_message_id,e.source_quote,m.content AS source_text,m.created_at AS reported_at FROM experiences e JOIN messages m ON m.user_id=e.user_id AND m.id=e.source_message_id AND m.role='user' WHERE e.user_id=$1 AND e.status<>'deleted'",[run.user_id])).rows.filter(e=>typeof e.source_quote==='string'&&e.source_quote.length&&e.source_text.includes(e.source_quote))
  const matched=episodes.filter(e=>primary.sources.some((s:any)=>s.type==='message'&&s.id===e.source_message_id&&typeof s.quote==='string'&&s.quote.length&&e.source_quote.includes(s.quote)))
  if(matched.length>1)throw new HttpError(409,'CONTROL_EPISODE_AMBIGUOUS')
  if(!matched.length)throw new HttpError(409,'CONTROL_EPISODE_SCOPE_UNVERIFIED')
  const episode=matched[0]
  const unit=selectStructuralCandidates(episode.source_text,buildClauseCatalogue(episode.source_text),new Date(episode.reported_at).toISOString()).find(unit=>unit.quote===episode.source_quote)
  if(!unit||!unit.quote.startsWith(unit.content.action))throw new HttpError(409,'CONTROL_EPISODE_SCOPE_UNVERIFIED')
  // The legacy action field is only a clause span. A coordinated proposition
  // can hide a skill or another event even when no sibling record was created.
  // It cannot authorize automatic episode-wide expansion.
  if(/也|并|而且|同时|另外|以及|既|又/.test(unit.content.action))throw new HttpError(409,'CONTROL_EPISODE_SCOPE_UNVERIFIED')
  // A legacy comma chain is a display span, not blanket deletion authority.
  // Automatic expansion only handles the absence-only tail implicated by
  // the observed lost-control case. Other compound records need a narrower
  // selection; even a parsed "result" can contain an independent fact.
  const tail=scanUserClauses(unit.quote.slice(unit.content.action.length))
  if(tail.some(clause=>clause.quoted||clause.code||clause.conditional||clause.interrogative||clause.attributedToOther||clause.quoteSpans.length||clause.codeSpans.length
    ||!/^(?:也|但)?(?:还|仍)?(?:没(?:有)?|尚未|未)(?:做分析|收到(?:任何)?反馈)$/.test(clause.text)))throw new HttpError(409,'CONTROL_EPISODE_SCOPE_UNVERIFIED')
  // A subphrase cannot authorize erasing the rest of a compound action clause.
  if(!primary.sources.every((source:any)=>source.quote===unit.content.action))throw new HttpError(409,'CONTROL_EPISODE_SCOPE_UNVERIFIED')
  // A quote repeated outside this span has no safe ownership without offsets.
  // Do not let the shared suppression path hide independent evidence either.
  const inside=(source:any)=>{
    if(source.type!=='message'||source.id!==episode.source_message_id||typeof source.quote!=='string'||!source.quote.length||!episode.source_quote.includes(source.quote))return false
    const first=episode.source_text.indexOf(source.quote)
    if(first<unit.start||first+source.quote.length>unit.end||episode.source_text.indexOf(source.quote,first+1)!==-1)throw new HttpError(409,'CONTROL_EPISODE_SOURCE_AMBIGUOUS')
    return true
  }
  if(!primary.sources.length||!primary.sources.every(inside))throw new HttpError(409,'CONTROL_EPISODE_SOURCE_AMBIGUOUS')
  const rows=(await c.query("SELECT id,revision,text,sources,assertion,dependencies FROM growth_items WHERE user_id=$1 AND status<>'forgotten' AND text<>''",[run.user_id])).rows
  const messages=new Map((await c.query("SELECT id,content FROM messages WHERE user_id=$1 AND role='user' AND id=ANY($2::uuid[])",[run.user_id,[...new Set(rows.flatMap(row=>row.sources.filter((s:any)=>s.type==='message'&&typeof s.id==='string').map((s:any)=>s.id)))]] )).rows.map(row=>[row.id,row.content]))
  const related=rows.filter(row=>{
    const sources=row.sources.filter((s:any)=>s.type==='message'&&typeof s.quote==='string'&&s.quote.length&&messages.get(s.id)?.includes(s.quote))
    const belongs=sources.map(inside)
    if(belongs.some(Boolean)){
      if(sources.length!==row.sources.length||!belongs.every(Boolean))throw new HttpError(409,'CONTROL_EPISODE_SOURCE_AMBIGUOUS')
      if(sources.some((source:any)=>unit.content.action.includes(source.quote)&&source.quote!==unit.content.action))throw new HttpError(409,'CONTROL_EPISODE_SOURCE_AMBIGUOUS')
      return true
    }
    // A later explicitly named interpretation may have its own source. Require
    // an exact unique episode label, not a shared topic or generic similarity.
    const interpretation=/^([^。；！？，,]{4,40})经历(?:并)?(?:不|不能)(?:证明|说明)(?:我|本人)(?:适合|擅长)([^。；！？，,]{1,30})$/.exec(row.text)
    const label=interpretation?.[1]
    if(label&&staged.clauseText.includes(label)&&unit.content.action.includes(label)&&episodes.filter(e=>e.source_quote.includes(label)).length>1)throw new HttpError(409,'CONTROL_EPISODE_AMBIGUOUS')
    return Boolean(label&&staged.clauseText.includes(label)&&unit.content.action.includes(label)&&episodes.filter(e=>e.source_quote.includes(label)).length===1
      &&!/(?:我|本人|但|不过|并|而且|同时|也|另外|和|或|与|及|、|\/)/.test(interpretation![2]!)
      &&sources.length===1&&row.sources.length===1&&sources[0].quote===row.text)
  }).map(row=>({id:row.id,revision:row.revision}))
  // Existing forget semantics recursively invalidate derived observations.
  // Preflight that mutation set so independent mixed facts cannot be swept in.
  const mutationIds=new Set(related.map(row=>row.id))
  mutationIds.add(staged.itemId)
  for(let previous=-1;previous!==mutationIds.size;){
    previous=mutationIds.size
    for(const row of rows.filter(row=>!mutationIds.has(row.id)&&row.dependencies.some((dependency:any)=>mutationIds.has(dependency.id)))){
      if(row.assertion!=='ai_observation'||!row.dependencies.every((dependency:any)=>mutationIds.has(dependency.id))
        ||row.sources.some((source:any)=>source.type!=='growth'||!mutationIds.has(source.id)))throw new HttpError(409,'CONTROL_EPISODE_DEPENDENCY_AMBIGUOUS')
      mutationIds.add(row.id)
    }
  }
  // Forget also redacts historical snapshots. Current provenance alone must
  // never authorize erasing an earlier independent source or correction chain.
  const allowedSources=new Map(rows.filter(row=>mutationIds.has(row.id)).map(row=>[row.id,new Set(row.sources.map((source:any)=>JSON.stringify(source)))]))
  const revisions=(await c.query('SELECT item_id,snapshot FROM growth_revisions WHERE user_id=$1 AND item_id=ANY($2::uuid[])',[run.user_id,[...mutationIds]])).rows
  if(revisions.some(row=>(row.snapshot.sources??[]).some((source:any)=>!allowedSources.get(row.item_id)?.has(JSON.stringify(source)))))throw new HttpError(409,'CONTROL_EPISODE_HISTORY_AMBIGUOUS')
  if((await c.query('SELECT 1 FROM growth_item_lineage WHERE user_id=$1 AND NOT source_redacted AND (child_id=ANY($2::uuid[]) OR parent_id=ANY($2::uuid[])) LIMIT 1',[run.user_id,[...mutationIds]])).rowCount)throw new HttpError(409,'CONTROL_EPISODE_HISTORY_AMBIGUOUS')
  const sourceSuppressions=rows.filter(row=>mutationIds.has(row.id)).flatMap(row=>row.sources.filter((source:any)=>source.type==='message').map((source:any)=>({messageId:source.id,quote:source.quote})))
  return {episode,related,sourceSuppressions,native:false}
}

export async function persistMemoryControl(c: PoolClient, run: Run, staged: StagedMemoryControl): Promise<MemoryControlReceipt> {
  if (staged.kind === 'stop_recommend') return persistRecommendationStop(c, run, staged)
  const operationRequestId = controlOperationRequestId(run.request_id, staged.itemId, staged.kind)
  // The primary fact operation alone cannot prove that an episode-wide control
  // committed. Bind the requested scope and its receipt in the SAME transaction.
  const scopeId=deterministicUuid(operationRequestId+':scope-v1')
  const scopeHash=createHash('sha256').update(JSON.stringify({version:1,kind:staged.kind,itemId:staged.itemId,expectedRevision:staged.expectedRevision,clauseText:staged.clauseText})).digest('hex')
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[run.user_id+':memory-control:'+scopeId])
  const scopeRecord=(await c.query('SELECT fingerprint,response FROM user_operations WHERE user_id=$1 AND request_id=$2',[run.user_id,scopeId])).rows[0]
  if(scopeRecord){
    if(scopeRecord.fingerprint!==scopeHash)throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED')
    return {...scopeRecord.response,replayed:true}
  }
  const input=(await c.query("SELECT content FROM messages WHERE user_id=$1 AND id=$2 AND conversation_id=$3 AND role='user'",[run.user_id,run.source_message_id,run.conversation_id])).rows[0]?.content
  if(typeof input!=='string'||!detectForgetIntentClauses(input).some(clause=>clause.kind===staged.kind&&clause.clauseText===staged.clauseText))throw new HttpError(400,'CONTROL_SOURCE_INVALID')
  const replayed = Boolean((await c.query('SELECT 1 FROM growth_operations WHERE user_id=$1 AND request_id=$2', [run.user_id, operationRequestId])).rowCount)
  if(replayed&&staged.kind==='forget'&&/经历(?:记录)?[。！!\s]*$/.test(staged.clauseText))throw new HttpError(409,'CONTROL_SCOPE_NOT_RECORDED')
  const episodeScope=replayed?null:await episodeForgetScope(c,run,staged)
  if(episodeScope?.native){
    await applyExperienceAction(c,run.user_id,episodeScope.episode.id,{requestId:deterministicUuid(run.request_id+':episode:'+episodeScope.episode.id),expectedRevision:episodeScope.episode.revision,action:'delete'})
    const current=requireRow((await c.query('SELECT revision,status FROM growth_items WHERE user_id=$1 AND id=$2',[run.user_id,staged.itemId])).rows[0])
    if(current.status!=='forgotten')throw new HttpError(409,'CONTROL_EPISODE_SCOPE_UNVERIFIED')
    const receipt:MemoryControlReceipt={status:'executed',kind:staged.kind,itemId:staged.itemId,revisionBefore:staged.expectedRevision,revisionAfter:current.revision,boundary:'purged',replayed:false}
    await c.query('INSERT INTO user_operations(user_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4)',[run.user_id,scopeId,scopeHash,receipt])
    return receipt
  }
  // Capture verified source tombstones BEFORE a primary forget can redact a
  // dependent interpretation's revisions. The same transaction rolls back all.
  if(episodeScope)for(const source of episodeScope.sourceSuppressions)await c.query("INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) SELECT user_id,conversation_id,id,$3 FROM messages WHERE user_id=$1 AND id=$2 AND role='user' AND strpos(content,$3)>0 ON CONFLICT DO NOTHING",[run.user_id,source.messageId,source.quote])
  const applied = await applyGrowthAction(c, run.user_id, staged.itemId, {
    requestId: operationRequestId,
    expectedRevision: staged.expectedRevision,
    action: actionForKind(staged.kind)!,
  })
  if(episodeScope){
    for(const related of episodeScope.related.filter(item=>item.id!==staged.itemId)){
      const current=(await c.query('SELECT revision,status,text FROM growth_items WHERE user_id=$1 AND id=$2',[run.user_id,related.id])).rows[0]
      if(!current||!current.text&&['forgotten','stale'].includes(current.status))continue
      if(current.revision!==related.revision)throw new HttpError(409,'GROWTH_REVISION_CONFLICT')
      await applyGrowthAction(c,run.user_id,related.id,{requestId:controlOperationRequestId(run.request_id,related.id,'forget'),expectedRevision:related.revision,action:'forget'})
    }
    const currentEpisode=requireRow((await c.query('SELECT revision FROM experiences WHERE user_id=$1 AND id=$2 FOR UPDATE',[run.user_id,episodeScope.episode.id])).rows[0])
    await applyExperienceAction(c,run.user_id,episodeScope.episode.id,{requestId:deterministicUuid(run.request_id+':episode:'+episodeScope.episode.id),expectedRevision:currentEpisode.revision,action:'delete'})
  }
  const receipt:MemoryControlReceipt={
    status: 'executed',
    kind: staged.kind,
    itemId: staged.itemId,
    revisionBefore: staged.expectedRevision,
    revisionAfter: applied.revision,
    boundary: staged.kind === 'forget' ? 'purged' : 'paused',
    replayed,
  }
  await c.query('INSERT INTO user_operations(user_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4)',[run.user_id,scopeId,scopeHash,receipt])
  return receipt
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
    const receipt=await persistMemoryControl(c,sourceRun,{kind:row.kind,itemId:chosen.itemId,expectedRevision:chosen.revision,clauseText:row.clause_text})
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
