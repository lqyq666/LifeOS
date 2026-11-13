import { randomUUID, createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, transaction, HttpError, requireRow } from './db.ts'
import { checkCampusSource } from './campus.ts'
import { validate } from './contracts.ts'
import { growthCreateSchema, growthActionSchema, type GrowthCreate, type GrowthAction } from './growth-contracts.ts'
import { amendExactClause, carriesPersonalText, fromLegacyText, FragmentError, sliceSource, type Fragment, type Source } from './growth-source-fragments.ts'
import { scanUserClauses,unstartedActivityOnlyClause } from './user-command-spans.ts'
import { resolveTimeWindow, legacyValidUntilMatchesQuote, quoteStatedCutoff, TimeEvidenceError, type TimeWindow, type Zone } from './growth-time.ts'
import { redactDirectionControlsForMessages } from './growth-controls.ts'
import type { GrowthItem, GrowthRef, GrowthView } from '../src/features/growth/types.ts'
import type { GrowthDelta,ResolvedGrowthDelta } from './growth-model-contracts.ts'
import type { Run } from './store.ts'
import { reconcileThemesWithGrowth, projectUserThemes,pursuitLevel } from './user-themes.ts'
import {reconcileIdentityClaims,projectIdentityClaims} from './identity.ts'
import {hoursIn,applicableTimeBudget,planExplicitCorrection,type CorrectionCandidate} from './turn-obligations.ts'
import {assistantInstructionClause,conversationPreferenceClause,deferredPursuitClause,refusalPreferenceClause,scopedTaskPauseClause,scopedTaskPauseTarget} from './user-command-spans.ts'
import {matchPathTheme} from './path-lexicon.ts'
import {persistMemoryControl} from './memory-controls.ts'
import {clauseReportsAttempted,clauseReportsPastAction} from './experience-content.ts'
import {taskOutcomeReadback} from './turn-contract.ts'
import {activeShadowedFactIds,checkMessageSource,coachSourceBoundaryRefs,redactForgottenContributions,unknownOwnershipFactIds} from './growth-privacy.ts'
import {invalidateCoachSourceQuotes} from './action-coach-events.ts'
import {detectUnconfirmedLabelRejection,explicitlyConfirmsLabel,samePersonalLabel} from './forget-intent.ts'
import {sourceQuoteRanges,sourceControlRanges,uniqueSourceControlRange,selectedSourceRange,reportedContribution,inheritReportedContribution,type SourceControlRef} from './clause-catalogue.ts'

type DB = Pick<PoolClient, 'query'>
type Row = { id: string; user_id: string; conversation_id: string; kind: GrowthItem['kind']; text: string; assertion: GrowthItem['assertion']; status: GrowthItem['status']; sources: Source[]; dependencies: GrowthRef[]; valid_until: Date | null; valid_from: Date | null; time_basis: Record<string, unknown> | null; direction_scopes: string[] | null; structured_plan: Record<string, unknown> | null; revision: number; created_at: Date; updated_at: Date; limitation?:string;progress_state?:GrowthItem['progressState'] }
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function preciseIsoFromEpochMicros(value:unknown,fallback:unknown):string{
  try{
    const micros=BigInt(String(value)),seconds=micros/1000000n,fraction=micros%1000000n
    const whole=new Date(Number(seconds)*1000).toISOString().replace('.000Z','')
    return `${whole}.${fraction.toString().padStart(6,'0')}Z`
  }catch{
    return fallback instanceof Date?fallback.toISOString():String(fallback)
  }
}
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
  const pauseTarget=!hidden&&row.assertion==='user_reported'?scopedTaskPauseTarget(row.text):null
  const taskBoundary=pauseTarget?{kind:'pause' as const,scope:'current_matter' as const,targetText:pauseTarget,sourceConversationId:row.conversation_id,sourceMessageId:row.sources.find(source=>source.type==='message')?.id??null,matterBinding:'needs_same_matter_confirmation' as const,expiresAt:row.valid_until?.toISOString()??null,quote:row.text}:undefined
  // A context source is not proof of a conversation with a task recipient.
  // Explicit reply/read/use reports remain readable without inventing that link.
  const outcomes=taskOutcomeReadback(row.text,undefined,row.kind==='feedback',true)
  const feedbackEvidence=!hidden&&row.assertion==='user_reported'&&(row.kind==='feedback'||Object.values(outcomes).some(value=>value.status!=='unknown'))?{reportedAt:row.created_at.toISOString(),taskBinding:'unknown' as const,outcomes}:undefined
  const kind=['goal','direction'].includes(row.kind)&&row.assertion==='user_reported'&&(unstartedActivityOnlyClause(row.text)||pursuitLevel(row.text)===null)?'context':row.kind
  return { ...(feedbackEvidence?{feedbackEvidence}:{}),id: row.id, conversationId: row.conversation_id, kind, text: hidden ? '' : row.text, assertion: row.assertion,
    status: reason && reason!=='not_yet_active' && ['active','proposed'].includes(row.status) ? 'stale' : row.status, sources: hidden ? [] : row.sources.map(source=>source.type==='message'?{type:source.type,id:source.id,quote:source.quote}:source), dependencies: hidden ? [] : row.dependencies,
    validUntil: row.valid_until?.toISOString() ?? null, validFrom: row.valid_from?.toISOString() ?? null, timeBasis: row.time_basis ?? null, revision: row.revision, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), unavailableReason: reason,limitation:hidden?'':row.limitation??'',progressState:hidden?null:row.progress_state??null,directionScopes:row.direction_scopes??[],structuredPlan:hidden?null:row.structured_plan??null,...(taskBoundary?{taskBoundary}:{}) }
}
async function availability(c: DB, user: string, row: Row, rows: Map<string, Row>, memoryEnabled: boolean, sourceMessages:ReadonlyMap<string,string>, conversation?: string, seen = new Set<string>()): Promise<string | null> {
  if (['forgotten', 'stale'].includes(row.status)) return row.status === 'forgotten' ? 'source_revoked' : 'changed'
  if(row.assertion!=='user_edit'&&!refusalPreferenceClause(row.text)&&!scopedTaskPauseClause(row.text))for(const source of row.sources){
    if(source.type!=='message')continue
    const message=sourceMessages.get(source.id)
    if(!message||!source.quote||!message.includes(source.quote))return 'source_revoked'
    const clauses=scanUserClauses(message)
    const ranges=sourceControlRanges(message,source)
    if(ranges.length!==1)return 'ambiguous_source_span'
    const {start,end}=ranges[0]!
    const matching=clauses.filter(clause=>clause.start<end&&clause.end>start)
    if(matching.length&&matching.every(clause=>assistantInstructionClause(message,clause,clauses)||conversationPreferenceClause(clause.text)))return 'conversation_instruction'
  }

  if (seen.has(row.id)) return 'dependency_cycle'
  if (row.valid_until && row.valid_until.getTime() <= Date.now()) return 'expired'
  // A future window (下周…) is not yet a current fact: today's state keeps the
  // previous value until the window opens.
  if (row.valid_from && row.valid_from.getTime() > Date.now()) return 'not_yet_active'
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
    const reason = await availability(c, user, dependency, rows, memoryEnabled, sourceMessages, conversation, next)
    if (reason === 'source_revoked') return reason
    if (dependency.revision !== ref.revision || reason || !['active','proposed'].includes(dependency.status)) return 'dependency_changed'
  }
  return null
}
export type GrowthMessageSourceLocation={sourceId:string;conversationId?:string;start?:number;quote:string;contextText?:string;createdAt?:string;ambiguous?:true}
// The public message contract is 16,000 Unicode characters, which can occupy
// up to 32,000 UTF-16 code units (the offsets stored by the TypeScript parser).
// Exact authoritative DB spans therefore use the actual message length; this
// ceiling only prevents an unverified persisted offset from allocating freely.
const maxGrowthSourceContextCodeUnits=32000
function inferredMessageSourceLocation(contextText:string,quote:string):{start?:number;ambiguous?:true}{
  const first=contextText.indexOf(quote)
  if(first<0)return {}
  const end=first+quote.length
  if(!Number.isSafeInteger(first)||!Number.isSafeInteger(end)||first<0||end>contextText.length||end>maxGrowthSourceContextCodeUnits)return {ambiguous:true}
  return contextText.indexOf(quote,first+1)>=0?{ambiguous:true}:{start:first}
}
export function growthMessageSourceLocations(sources:readonly Source[],sourceMessages?:ReadonlyMap<string,string>,sourceCreatedAt?:ReadonlyMap<string,string>,sourceConversationIds?:ReadonlyMap<string,string>):GrowthMessageSourceLocation[]{
  const authoritativeMessagesProvided=sourceMessages!==undefined
  const resolved=sources.flatMap(source=>{
    if(source.type!=='message')return []
    const sourceText=sourceMessages?.get(source.id)
    let location:{start?:number;ambiguous?:true}={}
    if(source.range){
      const sourceLimit=sourceText===undefined?maxGrowthSourceContextCodeUnits:Math.min(sourceText.length,maxGrowthSourceContextCodeUnits)
      const valid=Number.isSafeInteger(source.range.start)&&Number.isSafeInteger(source.range.end)&&source.range.start>=0&&source.range.end<=sourceLimit&&source.range.end===source.range.start+source.quote.length
        &&(!authoritativeMessagesProvided||(sourceText!==undefined&&sourceText.slice(source.range.start,source.range.end)===source.quote))
      location=valid?{start:source.range.start}:{ambiguous:true}
    }else if(sourceText!==undefined)location=inferredMessageSourceLocation(sourceText,source.quote)
    else if(authoritativeMessagesProvided)location={ambiguous:true}
    return [{source,...location}]
  })
  const authorizedContexts=new Map<string,string>()
  for(const sourceId of new Set(resolved.map(entry=>entry.source.id))){
    const spans=resolved.filter(entry=>entry.source.id===sourceId&&entry.start!==undefined&&!entry.ambiguous)
    if(!spans.length)continue
    const ordered=[...spans].sort((left,right)=>left.start!-right.start!),end=Math.max(...ordered.map(entry=>entry.start!+entry.source.quote.length)),characters=Array<string>(end).fill(' ')
    let coveredEnd=ordered[0]!.start!+ordered[0]!.source.quote.length
    for(const entry of ordered.slice(1)){
      if(entry.start!>coveredEnd){
        const hidden=sourceMessages?.get(sourceId)?.slice(coveredEnd,entry.start!)
        // Only a single structural delimiter may bridge independently saved
        // adjacent clauses. Hidden words remain an anonymous hard boundary.
        characters[coveredEnd]=hidden?.length===1&&/[，,；;、：:]/.test(hidden)?hidden:'。'
      }
      coveredEnd=Math.max(coveredEnd,entry.start!+entry.source.quote.length)
    }
    for(const entry of ordered)for(let index=0;index<entry.source.quote.length;index++)characters[entry.start!+index]=entry.source.quote[index]!
    authorizedContexts.set(sourceId,characters.join(''))
  }
  return resolved.map(({source,...location})=>{
    const contextText=location.start===undefined?undefined:authorizedContexts.get(source.id)
    const createdAt=sourceCreatedAt?.get(source.id)
    const conversationId=sourceConversationIds?.get(source.id)
    return {sourceId:source.id,quote:source.quote,...location,...(contextText===undefined?{}:{contextText}),...(createdAt===undefined?{}:{createdAt}),...(conversationId===undefined?{}:{conversationId})}
  })
}
type InternalGrowthView=GrowthView&{sourceLocations:ReadonlyMap<string,readonly GrowthMessageSourceLocation[]>}
async function rawGrowthView(user: string, conversation?: string, c: DB = pool): Promise<InternalGrowthView> {
  if (conversation) await owner(c, user, conversation)
  const memoryEnabled = await enabled(c, user)
  const rows = (await c.query('SELECT * FROM growth_items WHERE user_id=$1 ORDER BY updated_at DESC,id', [user])).rows as Row[]
  const byId = new Map(rows.map(row => [row.id, row]))
  const messageIds=[...new Set(rows.filter(row=>row.status!=='forgotten'&&(!conversation||memoryEnabled||row.conversation_id===conversation)).flatMap(row=>row.sources.filter(source=>source.type==='message').map(source=>source.id)))]
  const sourceMessageRows=messageIds.length?(await c.query("SELECT m.id,m.conversation_id,m.content,m.created_at,floor(extract(epoch FROM m.created_at)*1000000)::text AS created_micros FROM messages m WHERE m.user_id=$1 AND m.id=ANY($2::uuid[]) AND m.role='user' AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=m.user_id AND d.conversation_id=m.conversation_id)",[user,messageIds])).rows:[]
  const sourceMessages=new Map<string,string>(sourceMessageRows.map(row=>[row.id,row.content]))
  const sourceCreatedAt=new Map<string,string>(sourceMessageRows.map(row=>[row.id,preciseIsoFromEpochMicros(row.created_micros,row.created_at)]))
  const sourceConversationIds=new Map<string,string>(sourceMessageRows.map(row=>[row.id,row.conversation_id]))

  const visibleRows=rows.filter(row=>(!conversation||memoryEnabled||row.conversation_id===conversation)&&row.status!=='forgotten')
  const availabilityById=new Map<string,string|null>()
  for(const row of visibleRows)availabilityById.set(row.id,await availability(c,user,row,byId,memoryEnabled,sourceMessages,conversation))
  // Separate growth rows from one user message remain one authorized source
  // chain. Rebuild only from active, available, user-authored exact spans;
  // forgotten, inferred or unavailable neighbors cannot re-enter context.
  const sharedLocations=growthMessageSourceLocations(visibleRows
    .filter(row=>row.status==='active'&&availabilityById.get(row.id)===null&&['user_reported','user_edit'].includes(row.assertion))
    .flatMap(row=>row.sources),sourceMessages,sourceCreatedAt,sourceConversationIds)
  const sharedContexts=new Map(sharedLocations.filter(location=>!location.ambiguous&&location.contextText!==undefined).map(location=>[location.sourceId,location.contextText!]))
  const items: GrowthItem[] = []
  const sourceLocations=new Map<string,readonly GrowthMessageSourceLocation[]>()
  for (const row of visibleRows) {
    items.push(item(row,availabilityById.get(row.id)??null))
    const locations=growthMessageSourceLocations(row.sources,sourceMessages,sourceCreatedAt,sourceConversationIds).map(location=>{
      const contextText=!location.ambiguous?sharedContexts.get(location.sourceId):undefined
      return contextText===undefined?location:{...location,contextText}
    })
    if(locations.length)sourceLocations.set(row.id,locations)
  }
  // Fix 2: user-scoped recommendation boundaries ride along on the items so
  // every session (and the workspace UI) can distinguish "paused evidence"
  // from "active fact that must not be proactively recommended".
  const stopped = new Set(((await c.query("SELECT item_id FROM growth_recommendation_controls WHERE user_id=$1 AND state='stopped'", [user])).rows as { item_id: string }[]).map(row => row.item_id))
  for (const entry of items) if (stopped.has(entry.id)) entry.recommendationStopped = true
  // Control clauses remain exact source-backed context rows. Associate only
  // instructions from the SAME source message, never nearby conversations.
  const controlsByMessage=new Map<string,GrowthItem[]>()
  for(const entry of items.filter(item=>!item.unavailableReason&&item.assertion==='user_reported'))for(const source of entry.sources){
    if(source.type!=='message'||source.quote!==entry.text)continue
    controlsByMessage.set(source.id,[...(controlsByMessage.get(source.id)??[]),entry])
  }
  for(const [messageId,group] of controlsByMessage){
    const rejection=detectUnconfirmedLabelRejection(group.map(entry=>entry.text).join('；'))
    if(!rejection)continue
    const carrier=group.find(entry=>entry.text.includes(rejection.label))
    if(!carrier)continue
    const confirmedLater=items.some(entry=>entry.status==='active'&&!entry.unavailableReason&&Date.parse(entry.createdAt)>Date.parse(carrier.createdAt)
      &&((entry.assertion==='user_reported'&&explicitlyConfirmsLabel(entry.text,rejection.label))||(entry.assertion==='user_edit'&&entry.kind==='preference'&&samePersonalLabel(entry.text,rejection.label))))
    carrier.inferenceBoundary={kind:'do_not_infer_label',label:rejection.label,active:!confirmedLater,sourceMessageId:messageId,instructionQuotes:rejection.boundaryQuotes}
  }
  return { memoryEnabled, items,sourceLocations }
}
export async function growthView(user: string, conversation?: string, c: DB = pool): Promise<GrowthView> {
  const internal=await rawGrowthView(user,conversation,c),{sourceLocations:_,...view}=internal
  const tentative=await unknownOwnershipFactIds(c,user,view.items)
  return tentative.size?{...view,items:view.items.filter(row=>!tentative.has(row.id))}:view
}
export type FactInterpretation={itemId:string;revision:number;actor:'self'|'joint'|'other'|'unknown';proposedActor?:'self'|'joint';actionQuote:string;reportedText?:string;reportedProgress?:GrowthItem['progressState'];resultFact?:{id:string;revision:number}}
// Only current, permitted facts may carry an earlier model interpretation.
// A revision change invalidates that interpretation without changing siblings.
async function factInterpretations(c:DB,user:string,items:GrowthItem[]):Promise<FactInterpretation[]>{
  const current=new Map(items.filter(item=>item.status==='active'&&!item.unavailableReason&&item.assertion==='user_reported').map(item=>[item.id,item]))
  if(!current.size)return []
  const resolvedUnknown=new Set<string>((await c.query("SELECT DISTINCT a.value->>'factId' AS id FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value) JOIN experiences e ON e.user_id=r.user_id AND e.id::text=a.value->>'experienceId' WHERE r.user_id=$1 AND r.status='completed' AND a.value->>'phase'='canonical_contribution_staged' AND a.value->>'actor'='unknown' AND a.value->>'factId'=ANY($2::text[]) AND e.status='confirmed'",[user,[...current.keys()]])).rows.map(row=>String(row.id)))
  const shadowed=await activeShadowedFactIds(c,user,[...current.values()])
  const rows=(await c.query("SELECT a.value AS interpretation FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value) WHERE r.user_id=$1 AND r.status='completed' AND a.value->>'phase'='canonical_fact_interpretation' AND a.value->>'itemId'=ANY($2::text[]) ORDER BY r.finished_at DESC",[user,[...current.keys()]])).rows
  const selected=new Map<string,FactInterpretation>()
  for(const {interpretation:proof} of rows){
    const fact=current.get(proof.itemId)
    if(!fact||fact.revision!==proof.revision||resolvedUnknown.has(fact.id)||shadowed.has(fact.id)||selected.has(fact.id)||!['self','joint','other','unknown'].includes(proof.actor))continue
    const source=fact.sources.find(source=>source.type==='message'&&source.id===proof.sourceMessageId),range=proof.actionRange
    if(!source||!range||!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.length)||range.start<0||range.length<0||range.start+range.length>source.quote.length)continue
    const actionQuote=source.quote.slice(range.start,range.start+range.length)
    const result=proof.resultFact?current.get(proof.resultFact.id):undefined
    selected.set(fact.id,{itemId:fact.id,revision:fact.revision,actor:proof.actor,...(proof.actor==='unknown'?{reportedText:fact.text,...(fact.progressState?{reportedProgress:fact.progressState}:{}),...(['self','joint'].includes(proof.proposedActor)?{proposedActor:proof.proposedActor}:{})}:{}),actionQuote,...(result&&result.revision===proof.resultFact.revision?{resultFact:{id:result.id,revision:result.revision}}:{})})
  }
  return [...selected.values()]
}
export async function currentFactInterpretations(user:string,items:GrowthItem[]):Promise<FactInterpretation[]>{
  return factInterpretations(pool,user,items)
}
export type FactInterpretationRef=Pick<FactInterpretation,'itemId'|'revision'|'actor'|'proposedActor'|'actionQuote'>
export async function assertFactInterpretations(c:DB,user:string,conversation:string,refs:readonly FactInterpretationRef[]){
  if(!refs.length)return
  const view=await rawGrowthView(user,conversation,c),active=view.items.filter(row=>!row.unavailableReason&&['active','proposed'].includes(row.status))
  const current=await factInterpretations(c,user,active)
  for(const ref of refs)if(!current.some(row=>row.itemId===ref.itemId&&row.revision===ref.revision&&row.actor===ref.actor&&row.actionQuote===ref.actionQuote&&(row.proposedActor??null)===(ref.proposedActor??null)))throw new HttpError(409,'GROWTH_SNAPSHOT_INVALIDATED')
}
export async function growthSemanticContext(user:string,conversation:string,c:DB=pool){
  const view=await rawGrowthView(user,conversation,c)
  const active=view.items.filter(row=>!row.unavailableReason&&['active','proposed'].includes(row.status))
  const interpretations=await factInterpretations(c,user,active)
  const tentative=await unknownOwnershipFactIds(c,user,active)
  return {items:active.filter(row=>!tentative.has(row.id)),tentativeItems:active.filter(row=>tentative.has(row.id)),interpretations,sourceLocations:view.sourceLocations}
}
export async function growthContext(user: string, conversation: string) {
  return (await growthSemanticContext(user,conversation)).items
}
export async function growthBoundaryContext(user:string,conversation:string){
  return (await growthView(user,conversation)).items.filter(isGrowthBoundary)
}
const isGrowthBoundary=(row:GrowthItem)=>!row.unavailableReason&&(['rejected','paused'].includes(row.status)||row.inferenceBoundary?.active===true)
export const growthSnapshotKey = (items: GrowthItem[]) => fingerprint(items.map(row => [row.id,row.revision,row.status]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))))
export async function assertGrowthSnapshot(c: DB, user: string, conversation: string, refs: GrowthRef[], expectedKey?: string, boundaryKey?:string) {
  if (!refs.length && expectedKey === undefined && boundaryKey===undefined) return
  await lockGrowth(c, user)
  const view = await growthView(user, conversation, c)
  if(boundaryKey!==undefined&&growthSnapshotKey(view.items.filter(isGrowthBoundary))!==boundaryKey)throw new HttpError(409,'GROWTH_SNAPSHOT_INVALIDATED')
  const contextItems=view.items.filter(row => !row.unavailableReason && ['active','proposed'].includes(row.status))
  if (expectedKey !== undefined && growthSnapshotKey(contextItems) !== expectedKey) throw new HttpError(409, 'GROWTH_SNAPSHOT_INVALIDATED')
  for (const ref of refs) {
    const found = contextItems.find(row => row.id === ref.id && row.revision === ref.revision)
    if (!found || found.unavailableReason || !['active','proposed'].includes(found.status)) throw new HttpError(409, 'GROWTH_SNAPSHOT_INVALIDATED')
  }
}
async function record(c: DB, row: Row, action: string,sourceCorrections?:SourceControlRef[]) {
  await c.query('INSERT INTO growth_revisions(user_id,item_id,revision,action,snapshot) VALUES($1,$2,$3,$4,$5)', [row.user_id, row.id, row.revision, action, {...item(row),sources:row.sources,...(sourceCorrections?{sourceControls:sourceCorrections.map(({messageId,range})=>({messageId,range}))}:{})}])
}
async function replay(c: DB, user: string, requestId: string, hash: string): Promise<GrowthItem | null> {
  const operation = (await c.query('SELECT fingerprint,item_id FROM growth_operations WHERE user_id=$1 AND request_id=$2', [user, requestId])).rows[0]
  if (!operation) return null
  if (operation.fingerprint !== hash) throw new HttpError(409, 'REQUEST_ID_REUSED')
  return item(requireRow((await c.query('SELECT * FROM growth_items WHERE user_id=$1 AND id=$2', [user, operation.item_id])).rows[0]))
}
export async function createGrowthItem(user: string, raw: GrowthCreate, client?:PoolClient): Promise<GrowthItem> {
  const input = validate(growthCreateSchema, raw), hash = fingerprint(input), validUntil = expiry(input.validUntil)
  if (input.kind === 'constraint' && !validUntil) throw new HttpError(400, 'GROWTH_TIME_REQUIRED')
  if(input.kind!=='feedback'&&input.progressState!==undefined)throw new HttpError(400,'GROWTH_FEEDBACK_INVALID')
  const write=async(c:PoolClient)=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])
    await lockGrowth(c, user)
    const previous = await replay(c, user, input.requestId, hash)
    await owner(c, user, input.conversationId)
    const view = await growthView(user, input.conversationId, c)
    // Idempotency avoids a second write; it does not authorize reading sources
    // that have since been corrected, forgotten or hidden by Memory OFF.
    if(previous){
      const visible=view.items.find(row=>row.id===previous.id)
      if(!visible||visible.unavailableReason)throw new HttpError(409,'GROWTH_DEPENDENCY_INVALID')
      return visible
    }
    for (const ref of input.dependencies ?? []) {
      const found = view.items.find(row => row.id === ref.id && row.revision === ref.revision)
      if (!found || found.unavailableReason || !['active','proposed'].includes(found.status)) throw new HttpError(409, 'GROWTH_DEPENDENCY_INVALID')
    }
    const row = (await c.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,valid_until,progress_state,time_basis) VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11) RETURNING *", [randomUUID(), user, input.conversationId, input.kind, input.text, input.kind === 'unknown' ? 'unknown' : 'user_edit', JSON.stringify([{ type: 'user_edit', quote: input.text }]), JSON.stringify(input.dependencies ?? []), validUntil,input.kind==='feedback'?input.progressState??'unknown':null,validUntil?JSON.stringify({kind:'user_edit',zone:'Asia/Shanghai',anchor:new Date().toISOString()}):null])).rows[0] as Row
    await record(c, row, 'create')
    await c.query('INSERT INTO growth_operations(user_id,request_id,fingerprint,item_id) VALUES($1,$2,$3,$4)', [user, input.requestId, hash, row.id])
    await projectUserThemes(c, user, [{ id: row.id, kind: row.kind, text: row.text, assertion: row.assertion, status: row.status }])
    await reconcileThemesWithGrowth(c, user)
    await projectIdentityClaims(c,user,[row])
    return item(row)
  }
  return client?write(client):transaction(write)
}
export async function actOnGrowthItem(user: string, id: string, raw: GrowthAction): Promise<GrowthItem> {
  const input = validate(growthActionSchema, raw)
  return transaction(async c => applyGrowthAction(c, user, id, input))
}
// The full action contract on a CALLER-SUPPLIED client: the standalone API
// wraps it in its own transaction; finishRun executes staged memory controls
// with the same rules inside the run's final transaction so control and reply
// commit (or roll back) together.
export async function applyGrowthAction(c: PoolClient, user: string, id: string, input: GrowthAction, forgetSourceScope?:readonly SourceControlRef[]): Promise<GrowthItem> {
  const hash = fingerprint({ id, ...input })
  if (input.action === 'correct' && !input.text?.trim()) throw new HttpError(400, 'GROWTH_TEXT_REQUIRED')
  const validUntil = expiry(input.validUntil)
  {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])
    await lockGrowth(c, user)
    if(input.action==='correct'||input.action==='forget')await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':interview-chronology'])
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
    const boundaryBefore=input.action==='correct'||forgotten?new Set((await coachSourceBoundaryRefs(c,user)).map(ref=>JSON.stringify([ref.messageId,ref.quote,ref.range??null]))):null
    // A user-edit date input is its own evidence; a cleared date clears the basis.
    const nextBasis = forgotten ? null : input.validUntil === undefined ? row.time_basis : input.validUntil === null ? null : { kind: 'user_edit', zone: 'Asia/Shanghai', anchor: new Date().toISOString() } as Record<string, unknown>
    const updated = (await c.query('UPDATE growth_items SET text=$3,assertion=$4,status=$5,sources=$6,valid_until=$7,limitation=$8,progress_state=$9,time_basis=$10,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *', [user, id,
      forgotten ? '' : input.text ?? row.text, input.action === 'correct' ? row.kind === 'unknown' ? 'unknown' : 'user_edit' : row.assertion,
      status, JSON.stringify(forgotten ? [] : input.action === 'correct' ? [{ type: 'user_edit', quote: input.text }] : row.sources), input.validUntil === undefined ? row.valid_until : validUntil,
      forgotten||input.action==='correct'?'':row.limitation??'',forgotten?null:row.kind==='feedback'?input.progressState??row.progress_state??'unknown':null,nextBasis===null?null:JSON.stringify(nextBasis)])).rows[0] as Row
    const sourceCorrections:SourceControlRef[]=forgetSourceScope?[...forgetSourceScope]:[]
    if (forgotten) {
      // Preserve independent facts from the same message: tombstones cover
      // exact reported spans, rather than suppressing the whole source message.
      const prior=(await c.query('SELECT snapshot FROM growth_revisions WHERE user_id=$1 AND item_id=$2',[user,id])).rows
      if(!forgetSourceScope)for(const history of prior){
          if(!['user_reported','user_edit','unknown'].includes(history.snapshot.assertion))continue
          for(const source of history.snapshot.sources??[])if(source.type==='message'){
            if(source.range){sourceCorrections.push({messageId:source.id,quote:source.quote,range:source.range});continue}
            await c.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[user,history.snapshot.conversationId,source.id,source.quote])
          }
        }
      // Forgetting the original words also redacts direction-control provenance
      // tied to those messages; the pause setting itself stays until an
      // explicit resume.
      if(!forgetSourceScope)await redactDirectionControlsForMessages(c,user,[...new Set(prior.flatMap(history=>(history.snapshot?.sources??[]).filter((source:{type:string;id?:string})=>source.type==='message'&&typeof source.id==='string').map((source:{id:string})=>source.id)))])
      // Purge retained quotes and historical snapshots, including transitive derivatives.
      const ids = [id]
      for (let index = 0; index < ids.length; index++) {
        const dependents = (await c.query("SELECT id FROM growth_items WHERE user_id=$1 AND dependencies @> $2::jsonb", [user, JSON.stringify([{ id: ids[index] }])])).rows
        for (const dependent of dependents) if (!ids.includes(dependent.id)) ids.push(dependent.id)
      }
      await c.query("UPDATE growth_items SET text='',limitation='',progress_state=NULL,sources='[]',dependencies='[]',structured_plan=NULL,direction_scopes='{}',status=CASE WHEN id=$2 THEN 'forgotten' ELSE 'stale' END,revision=CASE WHEN id=$2 THEN revision ELSE revision+1 END,updated_at=now() WHERE user_id=$1 AND id=ANY($3::uuid[])", [user, id, ids])
      await redactForgottenContributions(c,user,ids,sourceCorrections)
      await c.query("UPDATE growth_revisions SET snapshot=jsonb_build_object('id',item_id,'revision',revision,'redacted',true) || CASE WHEN snapshot ? 'sourceControls' THEN jsonb_build_object('sourceControls',snapshot->'sourceControls') ELSE '{}'::jsonb END WHERE user_id=$1 AND item_id=ANY($2::uuid[])", [user, ids])
      await c.query(`UPDATE runs r SET tool_audit=(SELECT COALESCE(jsonb_agg(
        CASE WHEN a.value->>'phase'='canonical_contribution_staged' AND a.value->>'factId'=ANY($2::text[])
          THEN jsonb_build_object('phase',a.value->>'phase','experienceId',a.value->>'experienceId','factId',a.value->>'factId','factRevision',a.value->'factRevision','redacted',true)
        WHEN a.value->>'phase'='canonical_fact_interpretation' AND a.value->>'itemId'=ANY($2::text[])
          THEN jsonb_build_object('phase',a.value->>'phase','itemId',a.value->>'itemId','revision',a.value->'revision','redacted',true)
        WHEN a.value->>'phase'='canonical_fact_interpretation' AND a.value#>>'{resultFact,id}'=ANY($2::text[]) THEN a.value-'resultFact'
        ELSE a.value END ORDER BY a.ordinality),'[]'::jsonb) FROM jsonb_array_elements(r.tool_audit) WITH ORDINALITY a(value,ordinality))
        WHERE r.user_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.tool_audit) a(value) WHERE (a.value->>'phase'='canonical_contribution_staged' AND a.value->>'factId'=ANY($2::text[])) OR (a.value->>'phase'='canonical_fact_interpretation' AND (a.value->>'itemId'=ANY($2::text[]) OR a.value#>>'{resultFact,id}'=ANY($2::text[]))))`,[user,ids])
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
    await record(c, updated, input.action,sourceCorrections.length?sourceCorrections:undefined)
    if(boundaryBefore)await invalidateCoachSourceQuotes(c,user,(await coachSourceBoundaryRefs(c,user)).filter(ref=>!boundaryBefore.has(JSON.stringify([ref.messageId,ref.quote,ref.range??null]))),forgotten)
    await c.query('INSERT INTO growth_operations(user_id,request_id,fingerprint,item_id) VALUES($1,$2,$3,$4)', [user, input.requestId, hash, id])
    await reconcileThemesWithGrowth(c, user)
    await reconcileIdentityClaims(c,user,[id])
    await projectIdentityClaims(c,user,[updated])
    return item(updated)
  }
}

export type PreparedGrowthMutation =
  | { kind: 'ordinary'; delta: GrowthDelta; time?: TimeWindow }
  | {
      kind: 'split_amend'; normalizedIndex: number;
      parent: { id: string; revision: number };
      beforeQuote: string;
      field?:'education.major';
      currentSource: { messageId: string; quote: string };
      fragments: Fragment[];
      changedFragmentIndex: number;
      time?: TimeWindow;
    }
// N1.3: what actually wrote, with the PROVIDER's original array positions
// bound to the changed/created facts. retainedIds are split siblings and can
// never satisfy a time-correction obligation.
export type GrowthWriteResult={
  ids:string[];createdIds:string[];changedIds:string[];retainedIds:string[]
  byInputIndex:ReadonlyMap<number,{id:string;revision:number}>
}
export type GrowthStaged={changes:GrowthDelta[];prepared:PreparedGrowthMutation[];inputIndexBindings:ReadonlyMap<number,number>;skipped?:{inputIndex:number;quote:string,reason:'reasserted_prior_message'|'unverifiable_constraint_time'|'unverified_span'|'dropped_dependency'|'conversation_instruction'}[]}
const asFragmentError=(error:unknown):never=>{if(error instanceof FragmentError)throw new HttpError(400,error.code);throw error}
type GrowthAmendment=ReturnType<typeof amendExactClause>&{field?:{text:string;sources:Source[];supersededSources:Source[];withdrawn?:SourceControlRef}}
function amendGrowthSource(parent:Pick<GrowthItem,'id'|'revision'|'kind'|'assertion'|'text'|'sources'>,beforeQuote:string,currentSource:Extract<Source,{type:'message'}>,currentText:string,field?:'education.major',authorized:readonly CorrectionCandidate[]=[]):GrowthAmendment{
  if(field||planExplicitCorrection(currentText,[parent])?.target?.field){
    // Re-derive the narrow field authority both at staging and under the
    // commit lock. A provider or stale staged fragment cannot grant it.
    const plan=planExplicitCorrection(currentText,authorized)
    if(field!=='education.major'||!plan?.target||plan.target.field!==field||plan.target.itemId!==parent.id||plan.target.expectedRevision!==parent.revision||plan.target.beforeQuote!==beforeQuote||plan.newQuote!==currentSource.quote)throw new HttpError(400,'GROWTH_FIELD_CORRECTION_INVALID')
    const parentSources=toFragmentSources(parent.sources)
    const original=beforeQuote===parent.text?undefined:fromLegacyText(parent.text,parentSources)[0]!
    const at=parent.text.indexOf(beforeQuote)
    const prefix=parent.text.slice(0,at),suffix=parent.text.slice(at+beforeQuote.length)
    const age=/[0-9零一二两三四五六七八九十]{1,3}岁/.exec(prefix)?.[0]
    // Retained facts remain exact source spans with complete field meanings.
    // Never save grammatical leftovers such as 我是20岁的 or 专业大二学生.
    const retained=[age,suffix].filter((value):value is string=>Boolean(value))
    const fragments:Fragment[]=[...(original?retained.map(value=>({text:value,source:sliceSource(original.source,value)})):[]),{text:currentSource.quote,source:currentSource}]
    const supersededSources=original?[sliceSource(original.source,beforeQuote,at)]:parentSources
    const parts=plan.majorSourceParts
    if(!parts)return {text:fragments.map(part=>part.text).join('，'),fragments,sources:fragments.map(part=>part.source),field:{text:currentSource.quote,sources:[currentSource],supersededSources}}
    const range=uniqueSourceControlRange(currentText,currentSource)
    if(!range)throw new HttpError(400,'GROWTH_FIELD_CORRECTION_INVALID')
    const source={...currentSource,range},quote=source.quote
    const label=quote.slice(parts.labelStart,parts.labelEnd),current=quote.slice(parts.currentStart)
    const sources=[sliceSource(source,label,parts.labelStart),sliceSource(source,current,parts.currentStart)]
    const withdrawn={messageId:source.id,quote:quote.slice(parts.labelEnd,parts.currentStart),range:{start:range.start+parts.labelEnd,end:range.start+parts.currentStart}}
    return {text:fragments.map(part=>part.text).join('，'),fragments,sources:fragments.map(part=>part.source),field:{text:label+current,sources,supersededSources,withdrawn}}
  }
  return amendExactClause(fromLegacyText(parent.text,toFragmentSources(parent.sources)),beforeQuote,currentSource,currentText)
}
const sameClause=(text:string,left:number,right:number)=>{
  for(const clause of scanUserClauses(text)){
    const lo=Math.min(left,right),hi=Math.max(left,right)
    if(lo>=clause.start&&lo<clause.end&&hi>=clause.start&&hi<clause.end)return true
    if(lo<clause.start&&hi>=clause.end)continue
    if(hi>=clause.start&&hi<clause.end&&lo<clause.start)return false
    if(lo>=clause.start&&lo<clause.end&&hi>=clause.end)return false
  }
  return false
}
// PC07: a calendar-week marker may sit in an EARLIER clause of the same
// sentence ("这周课程赶，只剩两小时") — the week scopes the whole sentence,
// mirroring the obligation detector's own inheritance. Explicit dates and
// durations stay same-clause only: a cutoff named for another matter must
// never be borrowed across clauses.
const sentenceStartAt=(text:string,index:number)=>{
  for(const clause of scanUserClauses(text))if(index>=clause.start&&index<clause.end)return clause.sentenceStart
  return null
}
const sameSentence=(text:string,left:number,right:number)=>{
  const a=sentenceStartAt(text,Math.min(left,right)),b=sentenceStartAt(text,Math.max(left,right))
  return a!==null&&a===b
}
const carriesClauseText=(text:string)=>/[\p{L}\p{N}]/u.test(text)
const toFragmentSources=(sources:GrowthItem['sources']):Source[]=>sources.map(source=>({...source}))
function growthMessageSource(source:{messageId:string;quote:string},quote=source.quote):Extract<Source,{type:'message'}>{
  const range=selectedSourceRange(source)
  return sliceSource({type:'message',id:source.messageId,quote:source.quote,...(range?{range}:{})},quote) as Extract<Source,{type:'message'}>
}
export async function stageGrowthUpdates(run:Run,changes:ResolvedGrowthDelta[],authorized:GrowthItem[],options:{allowedDirectionScopes?:readonly string[]}={}):Promise<GrowthStaged> {
  const current=requireRow((await pool.query("SELECT content,created_at FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role='user'",[run.user_id,run.conversation_id,run.source_message_id])).rows[0]) as {content:string;created_at:Date}
  changes=changes.map(change=>{
    if(reportedContribution(change))return change
    if(change.assertion!=='user_reported'||!scopedTaskPauseClause(change.source.quote))return change
    const own=scanUserClauses(current.content).find(clause=>clause.text===change.source.quote&&!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&!clause.interrogative)
    if(!own)return change
    const explicitWeek=own.text.match(/这周|本周|下周/)?.[0]
    if(explicitWeek)return {...change,kind:'constraint',timeEvidence:{kind:'calendar_week',which:explicitWeek==='下周'?'next':'this',quote:explicitWeek}} as ResolvedGrowthDelta
    const budget=applicableTimeBudget(current.content,undefined,undefined,{retainReportedBudget:true})
    const token=budget?.period==='next_week'?'下周':budget?.period==='this_week'?(/本周/.test(budget.quote)?'本周':'这周'):null
    if(token&&sameSentence(current.content,own.start,current.content.indexOf(budget!.quote)))return {...change,kind:'constraint',timeEvidence:{kind:'calendar_week',which:budget!.period==='next_week'?'next':'this',quote:token}} as ResolvedGrowthDelta
    return {...change,kind:'context'} as ResolvedGrowthDelta
  })
  // Models routinely re-assert facts the user already stated in an earlier
  // message of this conversation, binding the old quote to the current message
  // id. Those items are dropped idempotently instead of failing the turn:
  // nothing is re-saved, nothing withdrawn is resurrected, and a quote that is
  // the user's verbatim words nowhere remains a hard fabrication failure.
  const earlier=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND role='user' AND id<>$3",[run.user_id,run.conversation_id,run.source_message_id])).rows as {content:string}[]
  const saidEarlier=(quote:string)=>earlier.some(row=>row.content.includes(quote))
  const skipped:{inputIndex:number;quote:string,reason:'reasserted_prior_message'|'unverifiable_constraint_time'|'unverified_span'|'dropped_dependency'|'conversation_instruction'}[]=[]
  const skippedIndexes=new Set<number>()
  const resolvedTimes=new Map<number,TimeWindow|null>()
  // Every expiry is derived server-side from explicit user words (P2): the
  // model may only point at time evidence in this message. A supplied legacy
  // validUntil is accepted only when the user's own quote states the same
  // cutoff; anything else is GROWTH_TIME_UNVERIFIED, never silently dropped
  // and counted as a complete update. The anchor is the source message time,
  // so retries never shift a window.
  const zone:Zone='Asia/Shanghai'
  const anchorIso=new Date(current.created_at).toISOString()
  const resolveGrowthTime=(change:ResolvedGrowthDelta):TimeWindow|null=>{
    const evidence='timeEvidence'in change?change.timeEvidence:undefined
    const legacy='validUntil'in change?change.validUntil:undefined
    // P1: unverifiable SUPPLIED time evidence resolves to null for every kind.
    // The caller then skips a CONSTRAINT item entirely (nothing with an
    // invented window is ever saved) and saves a NON-constraint fact windowless
    // — those kinds never carry a window anyway. The one remaining hard error
    // is a legacy expiry that CONTRADICTS otherwise-valid evidence: the model
    // verified a real window and then asserted a different fabricated one.
    if(evidence){
      let window:TimeWindow|null=null
      try{window=resolveTimeWindow(evidence,current.content,anchorIso,zone)}catch(error){if(!(error instanceof TimeEvidenceError))throw error}
      if(window){
        // N1.3: the evidence quote must support THIS fact — both spans must sit
        // in the same clause of the current message, so a date stated for
        // another matter in the same message can never be borrowed. A
        // calendar-week marker may sit in an earlier clause of the same
        // sentence (PC07: 这周课程赶，只剩两小时).
        const factIndex=selectedSourceRange(change.source)?.start??current.content.indexOf(change.source.quote)
        const relativeEvidenceIndex=change.source.quote.indexOf(evidence.quote)
        const evidenceIndex=relativeEvidenceIndex>=0?factIndex+relativeEvidenceIndex:current.content.indexOf(evidence.quote)
        if(factIndex>=0&&evidenceIndex>=0){
          const factSpanEnd=factIndex+change.source.quote.length
          const insideFactSpan=evidenceIndex>=factIndex&&evidenceIndex+evidence.quote.length<=factSpanEnd
          if(!insideFactSpan&&!sameClause(current.content,factIndex,evidenceIndex)&&!(evidence.kind==='calendar_week'&&evidenceIndex<factIndex&&sameSentence(current.content,factIndex,evidenceIndex)))window=null
        }else window=null
      }
      if(!window)return null
      if(legacy&&legacy!==window.validUntil)throw new HttpError(400,'GROWTH_TIME_UNVERIFIED')
      return window
    }
    if(legacy){
      if(!legacyValidUntilMatchesQuote(legacy,change.source.quote,zone))return null
      const stated=quoteStatedCutoff(change.source.quote,zone)!
      return {validFrom:anchorIso,validUntil:legacy,basis:{kind:'date_inclusive',date:stated.date,quote:stated.quote,anchor:anchorIso,zone,endExclusive:true}}
    }
    return null
  }
  for(const [index,change] of changes.entries()){
    if(typeof (change.assertion==='user_reported'&&change.text===undefined?change.source.quote:change.text)!=='string')throw new HttpError(400,'GROWTH_SOURCE_INVALID')
    if(change.source.messageId===run.source_message_id&&change.source.quote.trim()&&!current.content.includes(change.source.quote)&&saidEarlier(change.source.quote)){
      skippedIndexes.add(index);skipped.push({inputIndex:index,quote:change.source.quote,reason:'reasserted_prior_message'});continue
    }
    if(change.source.messageId===run.source_message_id&&change.source.quote.trim()&&!current.content.includes(change.source.quote)){
      // The quote is the user's verbatim words nowhere in this conversation:
      // never save it, but one paraphrasing item must not fail its verified
      // siblings — drop it and keep the turn.
      skippedIndexes.add(index);skipped.push({inputIndex:index,quote:change.source.quote,reason:'unverified_span'});continue
    }
    if(change.source.messageId!==run.source_message_id||!change.source.quote.trim()||!current.content.includes(change.source.quote))throw new HttpError(400,'GROWTH_SOURCE_INVALID')
    if(!refusalPreferenceClause(change.source.quote)&&!scopedTaskPauseClause(change.source.quote)){
      const start=selectedSourceRange(change.source)?.start??current.content.indexOf(change.source.quote),end=start+change.source.quote.length
      const allClauses=scanUserClauses(current.content),clauses=allClauses.filter(clause=>clause.start<end&&clause.end>start)
      // An observation's dependencies do not make a recording instruction a
      // personal source. Apply the same source boundary on write and readback.
      if(clauses.length&&clauses.every(clause=>assistantInstructionClause(current.content,clause,allClauses)||(!clause.quoted&&!clause.code&&!clause.conditional&&!clause.attributedToOther&&conversationPreferenceClause(clause.text)))){
        skippedIndexes.add(index);skipped.push({inputIndex:index,quote:change.source.quote,reason:'conversation_instruction'});continue
      }
    }
    const resolved=change.kind==='constraint'?resolveGrowthTime(change):null
    resolvedTimes.set(index,resolved)
    if(change.kind==='constraint'&&!resolved){
      // A constraint whose expiry the user never verifiably stated is unsafe to
      // save; dropping that one item keeps the turn's verified facts intact.
      skippedIndexes.add(index);skipped.push({inputIndex:index,quote:change.source.quote,reason:'unverifiable_constraint_time'});continue
    }
  }
  // Observations may only stand on facts that actually persisted this turn.
  for(let pass=0;pass<changes.length;pass++){
    let cascaded=false
    for(const [index,change] of changes.entries()){
      if(skippedIndexes.has(index)||change.assertion!=='ai_observation')continue
      if(change.dependencies.some(ref=>'updateIndex'in ref&&skippedIndexes.has(ref.updateIndex))){skippedIndexes.add(index);skipped.push({inputIndex:index,quote:change.source.quote,reason:'dropped_dependency'});cascaded=true}
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
    const contribution=reportedContribution(change),contributionAction=contribution?.pendingActionQuote??contribution?.actionQuote
    // A canonical contribution owns exactly the model-selected action, even
    // when it is the only contribution in a longer clause. Results and sibling
    // facts keep their own semantic records; correction/forgetting can never
    // grant this action authority over unrelated source text.
    const selectedText=contributionAction
      ?contributionAction
      :change.assertion==='user_reported'&&change.text===undefined?change.source.quote:change.text
    if(typeof selectedText!=='string')throw new HttpError(400,'GROWTH_SOURCE_INVALID')
    const resolvedTime=resolvedTimes.get(index)??null
    // The ONLY expiry that ever persists is the server-resolved window. A
    // model-supplied legacy validUntil the user's clause never verified must
    // not leak through the spread (G1: a seeded goal expired minutes after
    // creation, emptying the authorized set for the later correction turn).
    const {validUntil:legacyExpiry, ...withoutLegacyExpiry}=change as {validUntil?:unknown}
    void legacyExpiry
    const delta:GrowthDelta={...withoutLegacyExpiry,text:selectedText,...(resolvedTime?{validUntil:resolvedTime.validUntil}:{})} as GrowthDelta
    inheritReportedContribution(change,delta)
    // Use the same pursuit eligibility as the star map. An autobiographical
    // event or incomplete tentative intent remains sourced context.
    if(delta.assertion==='user_reported'&&['goal','direction'].includes(delta.kind)
      &&(clauseReportsPastAction(delta.source.quote)||pursuitLevel(delta.source.quote)===null)){
      ;(delta as {kind:string}).kind='context'
    }
    if(!reportedContribution(change)&&delta.assertion==='user_reported'&&['context','goal','feedback'].includes(delta.kind)){
      const quote=delta.source.quote
      // A task can be unfinished after a genuine attempt. Only explicit
      // non-start language provides authority for the unattempted state.
      const notStarted=/^(?:我(?:目前|现在|还|仍)?|(?:但|也)?(?:还|仍)?)?(?:没(?:有)?|尚未|还未|未)(?:开始|动手|问|访谈|联系|复习|准备)/.test(quote)
      const adoption=/^(?:我)?(?:愿意|同意|接受|决定|打算|(?:先)?准备)(?:先)?(?:试|尝试|问|整理|用|使用|采纳|这个|这样)|^(?:先从|那先).{1,30}(?:开始|整理)/.test(quote)
      const performed=/(?:我|本人).{0,20}(?:已经.{0,12}(?:列完|列出来|整理好|发出)|实际问了|交给.{0,10}了)/.test(quote)&&!/(?:还没|没有|尚未)/.test(quote)
      if(notStarted||adoption||performed){
        ;(delta as {kind:string}).kind='feedback'
        ;(delta as {progressState:string}).progressState=performed?'completed':notStarted||/(?:还没|没有|尚未)(?:开始|动手|问)/.test(quote)?'unattempted':'unknown'
      }
    }
    await checkCampusSource(pool,run.user_id,run.conversation_id,true,growthMessageSource(delta.source))
    if(delta.assertion==='user_reported'&&(!delta.text.trim()||delta.text.length>4000||!delta.source.quote.includes(delta.text)))throw new HttpError(400,'GROWTH_SOURCE_INVALID')
    if(!reportedContribution(change)&&delta.assertion==='user_reported'&&delta.kind==='feedback'){
      // Declining the next attempt does not erase an already performed one.
      if(/(?:暂时|先)不继续|不想继续|拒绝继续/.test(delta.source.quote))delta.progressState='unknown'
      // Preserve a genuine adoption report even when a provider incorrectly
      // labels it as execution. Willingness alone proves no action state.
      const reports=scanUserClauses(delta.source.quote).filter(c=>!c.quoted&&!c.code&&!c.conditional&&!c.interrogative&&!c.attributedToOther)
      const adoption=reports.some(c=>/^(?:我)?(?:愿意|同意|接受|决定|打算|准备)(?:试|尝试|用|使用|采纳|这个|这样)/.test(c.text.trim()))
      const action=reports.some(c=>/(?:已经|已|开始|尝试了|试了|做了|发了|交了|完成了)/.test(c.text)&&!/(?:没|没有|尚未|还未|未曾)[^；。]{0,12}(?:开始|尝试|完成|做|发|交)/.test(c.text))
      if(/^(?:但|也|还|仍|对方|客户|他们|她们|他|她|学长|导师)/.test(delta.source.quote)&&/(?:看过|读过|已读|回复|回应|采用|使用|用了|没用|付款|付费|感兴趣|有意思)/.test(delta.source.quote))delta.progressState='unknown'
      if(/^我(?:目前|现在)?(?:不想|不打算|不愿意)(?:改到|转到|催促)/.test(delta.source.quote))delta.progressState='unknown'
      if(adoption&&!action)delta.progressState=reports.some(c=>/(?:没|没有|尚未|还未)[^；。]{0,8}(?:开始|尝试|做)/.test(c.text))?'unattempted':'unknown'
    }
    let mutation:PreparedGrowthMutation
    if(delta.target.operation==='replace'||delta.target.operation==='amend'){
      const selected=delta.target
      const target=authorized.find(row=>row.id===selected.itemId&&row.revision===selected.expectedRevision)
      if(!target||replacements.has(target.id)||(target.kind!==delta.kind&&target.kind!=='unknown'))throw new HttpError(400,'GROWTH_TARGET_INVALID')
      if(delta.target.operation==='replace'){
        // N1.3: a plain model replace onto a composite target can silently
        // erase sibling facts; such targets must go through amend (or an
        // explicit user whole-item edit). Only single-fact targets replace.
        const personalClauses=scanUserClauses(target.text).filter(clause=>carriesClauseText(clause.text))
        if(personalClauses.length>1)throw new HttpError(400,'GROWTH_COMPOSITE_REQUIRES_REVIEW')
      }
      if(selected.operation==='amend'){
        if(!selected.beforeQuote?.trim())throw new HttpError(400,'GROWTH_SOURCE_INVALID')
        // amend corrects ONE clause of a user-supplied composite of the same
        // field; unknown→answer and explicit whole-item rewrites stay on replace,
        // and the model never supplies the merged text.
        if(change.text!==undefined)throw new HttpError(400,'GROWTH_SOURCE_INVALID')
        if(target.kind!==delta.kind||!['user_reported','user_edit'].includes(target.assertion)||target.unavailableReason)throw new HttpError(400,'GROWTH_TARGET_INVALID')
        const analysis=(()=>{try{
          return amendGrowthSource(target,selected.beforeQuote,growthMessageSource(delta.source),current.content,selected.field,authorized.filter(row=>!row.unavailableReason))
        }catch(error){throw asFragmentError(error)}})()
        const changedFragmentIndex=analysis.fragments.findIndex(part=>part.source.type==='message'&&part.source.id===run.source_message_id)
        const personal=analysis.fragments.filter(part=>carriesPersonalText(part.text))
        // One full clause in the old item: exchange that fact in place under
        // CAS (no split); anything else splits with retained siblings.
        mutation=(!selected.field&&changedFragmentIndex>=0&&personal.length===1&&personal[0]===analysis.fragments[changedFragmentIndex])
          ?{kind:'ordinary',delta,...(resolvedTime?{time:resolvedTime}:{})}
          :{kind:'split_amend',normalizedIndex:-1,parent:{id:selected.itemId,revision:selected.expectedRevision},beforeQuote:selected.beforeQuote,...(selected.field?{field:selected.field}:{}),currentSource:delta.source,fragments:analysis.fragments,changedFragmentIndex,...(resolvedTime?{time:resolvedTime}:{})}
      }else{
        if(target.text===delta.text||target.text.includes(delta.text))throw new HttpError(400,'GROWTH_UNCHANGED')
        mutation={kind:'ordinary',delta,...(resolvedTime?{time:resolvedTime}:{})}
      }
      replacements.add(target.id)
    }else mutation={kind:'ordinary',delta,...(resolvedTime?{time:resolvedTime}:{})}
    if(delta.assertion==='ai_observation'){
      if(!delta.limitation.trim())throw new HttpError(400,'GROWTH_OBSERVATION_INVALID')
      // N2.4: direction-bearing observations declare their scopes; scopes the
      // user paused this turn (effective overlay) are refused outright.
      if('directionScopes'in delta&&Array.isArray(delta.directionScopes)){
        for(const scope of delta.directionScopes)if(options.allowedDirectionScopes&&!options.allowedDirectionScopes.includes(scope))throw new HttpError(400,'DIRECTION_SCOPE_BLOCKED')
      }
      if(!delta.dependencies.length)throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
      for(const ref of delta.dependencies){
        if('updateIndex'in ref){
          if(!Number.isInteger(ref.updateIndex)||ref.updateIndex<0||ref.updateIndex>=changes.length||changes[ref.updateIndex].assertion!=='user_reported')throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
          const basis=changes[ref.updateIndex]
          if(reportedContribution(basis)?.actor==='unknown')throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
          const basisWindow=resolvedTimes.get(ref.updateIndex)
          if(basisWindow&&Date.parse(basisWindow.validUntil)<=Date.now())throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
          if('validUntil'in basis&&basis.validUntil&&expiry(basis.validUntil)!.getTime()<=Date.now())throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
        }else if(!authorized.some(row=>row.id===ref.id&&row.revision===ref.revision&&!row.unavailableReason&&['active','proposed'].includes(row.status)))throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
      }
    }
    if('validUntil'in delta)expiry(delta.validUntil)
    if(delta.kind==='feedback'&&(!('progressState'in delta)||!delta.progressState))throw new HttpError(400,'GROWTH_FEEDBACK_INVALID')
    if(delta.kind!=='feedback'&&'progressState'in delta&&delta.progressState)throw new HttpError(400,'GROWTH_FEEDBACK_INVALID')
    const existing=unique.findIndex(row=>row.target.operation==='create'&&delta.target.operation==='create'&&row.kind===delta.kind&&row.assertion==='user_reported'&&delta.assertion==='user_reported'&&row.text===delta.text&&row.source.quote===delta.source.quote&&JSON.stringify(selectedSourceRange(row.source))===JSON.stringify(selectedSourceRange(delta.source))&&JSON.stringify(reportedContribution(row))===JSON.stringify(reportedContribution(delta))&&('validUntil'in row?row.validUntil:null)===('validUntil'in delta?delta.validUntil:null)&&('progressState'in row?row.progressState:null)===('progressState'in delta?delta.progressState:null))
    positions.push(existing<0?unique.length:existing)
    if(existing<0){
      if(mutation.kind==='split_amend')mutation.normalizedIndex=unique.length
      unique.push(delta)
      prepared.push(mutation)
    }
  }
  // References describe the authorized pre-turn snapshot. Replacing their
  // target in this same batch would invalidate them regardless of write order;
  // never silently upgrade a model's evidence to the new revision.
  if(prepared.some(entry=>entry.kind==='ordinary'&&entry.delta.assertion==='ai_observation'&&entry.delta.dependencies.some(ref=>'id'in ref&&replacements.has(ref.id))))throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
  for(let uniqueIndex=0;uniqueIndex<unique.length;uniqueIndex++){
    const delta=unique[uniqueIndex]!
    if(delta.assertion!=='ai_observation')continue
    const remapped={...delta,dependencies:delta.dependencies.map(ref=>'updateIndex'in ref?{updateIndex:positions[ref.updateIndex]!}:ref)}
    unique[uniqueIndex]=remapped
    const mutation=prepared[uniqueIndex]!
    if(mutation.kind==='ordinary')prepared[uniqueIndex]={kind:'ordinary',delta:remapped}
  }
  // Original provider positions → normalized unique positions; observations'
  // updateIndex refs already remap through positions above.
  const inputIndexBindings=new Map<number,number>()
  for(const [original,normalized] of positions.entries())if(normalized>=0)inputIndexBindings.set(original,normalized)
  return {changes:unique,prepared,inputIndexBindings,skipped:skipped.length?skipped:undefined}
}
export async function persistGrowthUpdates(c:PoolClient,run:Run,staged:GrowthStaged):Promise<GrowthWriteResult> {
  if(!staged.changes.length)return {ids:[],createdIds:[],changedIds:[],retainedIds:[],byInputIndex:new Map()}
  await lockGrowth(c,run.user_id)
  const ids:string[]=[],createdIds:string[]=[],changedIds:string[]=[],retainedIds:string[]=[],written=new Map<number,Row>()
  const replacements=new Set(staged.prepared.flatMap(entry=>entry.kind==='ordinary'&&entry.delta.target.operation==='replace'?[entry.delta.target.itemId]:entry.kind==='split_amend'?[entry.parent.id]:[]))
  // Keep external references strict, even if an internal caller bypassed stage.
  for(const entry of staged.prepared)if(entry.kind==='ordinary'&&entry.delta.assertion==='ai_observation')for(const ref of entry.delta.dependencies)if('id'in ref&&replacements.has(ref.id))throw new HttpError(400,'GROWTH_DEPENDENCY_INVALID')
  const order=staged.prepared.map((mutation,index)=>({mutation,index})).sort((a,b)=>Number(a.mutation.kind==='ordinary'&&a.mutation.delta.assertion==='ai_observation')-Number(b.mutation.kind==='ordinary'&&b.mutation.delta.assertion==='ai_observation'))
  for(const {mutation,index} of order){
    if(mutation.kind==='split_amend'){
      // P1.3 steps 1–8: everything is re-derived under the row lock from the
      // authoritative parent row and current message; staged fragments were an
      // early, advisory validation only.
      const delta=requireRow(staged.changes[mutation.normalizedIndex]) as GrowthDelta
      const parent=(await c.query('SELECT * FROM growth_items WHERE user_id=$1 AND id=$2 FOR UPDATE',[run.user_id,mutation.parent.id])).rows[0] as Row|undefined
      if(!parent||parent.revision!==mutation.parent.revision||!['active','proposed'].includes(parent.status)||!['user_reported','user_edit'].includes(parent.assertion))throw new HttpError(409,'GROWTH_SNAPSHOT_INVALIDATED')
      const message=requireRow((await c.query("SELECT content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role='user'",[run.user_id,run.conversation_id,run.source_message_id])).rows[0]) as {content:string}
      const parentSources=toFragmentSources(parent.sources)
      const previousMessages=new Map<string,string>()
      for(const source of parentSources){
        // Withdrawn or unauthorized originals fail the whole mutation.
        if(source.type==='message')previousMessages.set(source.id,(await checkMessageSource(c,run.user_id,parent.conversation_id,source,true)).content)
      }
      // Recheck ambiguity under the shared growth lock, including a second
      // matching fact inserted after staging. A provider cannot select a copy.
      const fieldCandidates=parent.kind==='context'?(await c.query("SELECT id,revision,kind,assertion,text FROM growth_items WHERE user_id=$1 AND status IN ('active','proposed') AND kind='context' AND assertion IN ('user_reported','user_edit') AND (valid_until IS NULL OR valid_until>now())",[run.user_id])).rows as CorrectionCandidate[]:[]
      const analysis=(()=>{try{
        return amendGrowthSource(parent,mutation.beforeQuote,growthMessageSource(mutation.currentSource),message.content,mutation.field,fieldCandidates)
      }catch(error){throw asFragmentError(error)}})()
      const changedFragmentIndex=analysis.fragments.findIndex(part=>part.source.type==='message'&&part.source.id===run.source_message_id)
      const personal=analysis.fragments.filter(part=>carriesPersonalText(part.text))
      const sourceCorrections:SourceControlRef[]=analysis.field?.supersededSources.flatMap(source=>{
        if(source.type!=='message')return []
        const range=uniqueSourceControlRange(previousMessages.get(source.id)??'',source)
        if(!range)throw new HttpError(400,'GROWTH_FIELD_CORRECTION_INVALID')
        return [{messageId:source.id,quote:source.quote,range}]
      })??[]
      if(analysis.field?.withdrawn)sourceCorrections.push(analysis.field.withdrawn)
      if(changedFragmentIndex>=0&&personal.length===1&&personal[0]===analysis.fragments[changedFragmentIndex]){
        // The old item held exactly one full clause: exchange that fact in
        // place under CAS; no split, no lineage (P1.3 step 6).
        const updatedRow=(await c.query("UPDATE growth_items SET kind=$4,text=$5,assertion='user_reported',status='active',sources=$6,dependencies='[]',valid_until=$7,limitation='',progress_state=$8,origin_request_id=$9,valid_from=$10,time_basis=$11,conversation_id=$12,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 AND revision=$3 AND status IN ('active','proposed') RETURNING *",[run.user_id,parent.id,mutation.parent.revision,delta.kind,analysis.field?.text??analysis.text,JSON.stringify(analysis.field?.sources??[growthMessageSource(mutation.currentSource)]),'validUntil'in delta?expiry(delta.validUntil):null,delta.kind==='feedback'?(delta as Extract<GrowthDelta,{kind:'feedback'}>).progressState:null,run.request_id,mutation.time?mutation.time.validFrom:null,mutation.time?JSON.stringify(mutation.time.basis):null,run.conversation_id])).rows[0] as Row|undefined
        if(!updatedRow)throw new HttpError(409,'GROWTH_SNAPSHOT_INVALIDATED')
        await record(c,updatedRow,'amend',sourceCorrections.length?sourceCorrections:undefined)
        if(sourceCorrections.length)await invalidateCoachSourceQuotes(c,run.user_id,sourceCorrections)
        ids[mutation.normalizedIndex]=updatedRow.id;changedIds.push(updatedRow.id);written.set(mutation.normalizedIndex,updatedRow)
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
        const childText=isChanged?analysis.field?.text??fragment.text:fragment.text.replace(/^[，,；;。！？!?\n]+/,'').replace(/[，,；;。！？!?\n]+$/,'')
        if(!childText)continue
        if(!isChanged&&fragment.source.type==='message')await checkCampusSource(c,run.user_id,parent.conversation_id,true,fragment.source,true)
        const childSources=isChanged?analysis.field?.sources??[growthMessageSource(mutation.currentSource,childText)]:[sliceSource(fragment.source,childText)]
        const child=(await c.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,valid_until,limitation,progress_state,origin_request_id,valid_from,time_basis) VALUES($1,$2,$3,$4,$5,$6,'active',$7,'[]',$8,'',$9,$10,$11,$12) RETURNING *",[randomUUID(),run.user_id,isChanged?run.conversation_id:parent.conversation_id,isChanged?delta.kind:parent.kind,childText,isChanged?'user_reported':parent.assertion,JSON.stringify(childSources),isChanged&&'validUntil'in delta?expiry(delta.validUntil):null,isChanged&&delta.kind==='feedback'?(delta as Extract<GrowthDelta,{kind:'feedback'}>).progressState:null,run.request_id,isChanged&&mutation.time?mutation.time.validFrom:null,isChanged&&mutation.time?JSON.stringify(mutation.time.basis):null])).rows[0] as Row
        await record(c,child,'split',isChanged&&sourceCorrections.length?sourceCorrections:undefined)
        await c.query("INSERT INTO growth_item_lineage(user_id,parent_id,parent_revision,child_id,relation,fragment_role,superseded_quote) VALUES($1,$2,$3,$4,'split_from',$5,$6)",[run.user_id,parent.id,supersededRow.revision,child.id,isChanged?'changed':'retained',isChanged?mutation.beforeQuote:null])
        if(isChanged){ids[mutation.normalizedIndex]=child.id;changedIds.push(child.id);written.set(mutation.normalizedIndex,child)}
        else retainedIds.push(child.id)
      }
      if(sourceCorrections.length)await invalidateCoachSourceQuotes(c,run.user_id,sourceCorrections)
      // Steps 7–8: this updateIndex resolves to the changed item; old dependents
      // lose availability on their own through the parent's stale revision and
      // are never auto-upgraded.
      continue
    }
    const delta=mutation.delta
    const source=growthMessageSource(delta.source,delta.assertion==='user_reported'?delta.text:delta.source.quote)
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
      row=(await c.query('INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,valid_until,limitation,progress_state,origin_request_id,valid_from,time_basis,direction_scopes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',[randomUUID(),run.user_id,run.conversation_id,delta.kind,delta.text,delta.assertion,status,JSON.stringify([source]),JSON.stringify(refs),validUntil,limitation,progressState,run.request_id,mutation.time?mutation.time.validFrom:null,mutation.time?JSON.stringify(mutation.time.basis):null,delta.assertion==='ai_observation'&&'directionScopes'in delta&&Array.isArray(delta.directionScopes)?delta.directionScopes:[]])).rows[0]
    }else{
      // CAS update: a missing row is a revision conflict, never a silent
      // re-read of the newer revision (P1.6).
      const updatedRow=(await c.query('UPDATE growth_items SET kind=$4,text=$5,assertion=$6,status=$7,sources=$8,dependencies=$9,valid_until=$10,limitation=$11,progress_state=$12,origin_request_id=$13,conversation_id=$14,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 AND revision=$3 AND status IN (\'active\',\'proposed\') RETURNING *',[run.user_id,delta.target.itemId,delta.target.expectedRevision,delta.kind,delta.text,delta.assertion,status,JSON.stringify([source]),JSON.stringify(refs),validUntil,limitation,progressState,run.request_id,run.conversation_id])).rows[0] as Row|undefined
      if(!updatedRow)throw new HttpError(409,'GROWTH_SNAPSHOT_INVALIDATED')
      row=updatedRow
    }
    await record(c,row,delta.target.operation==='create'?'extract':delta.target.operation);ids[index]=row.id;written.set(index,row)
    // Only an explicit, identical matter advances an earlier non-action fact.
    // Keep that earlier report and its source as paused history; similar tasks
    // or ambiguous omitted references never retire one another.
    if(row.assertion==='user_reported'&&clauseReportsAttempted(row.text)){
      const task=/^我(?:已经尝试|尝试了|试做了|开始尝试)(.+)$/.exec(row.text)?.[1]?.trim()
      if(task){
        const priorRows=(await c.query("SELECT id,revision,text FROM growth_items WHERE user_id=$1 AND id<>$2 AND kind='context' AND assertion='user_reported' AND status='active' ORDER BY id FOR UPDATE",[run.user_id,row.id])).rows
        for(const prior of priorRows){
          const oldTask=/^我(?:还没有|还没|尚未|未曾)(?:开始|尝试)(.+)$/.exec(prior.text)?.[1]?.trim()
          if(oldTask===task){await applyGrowthAction(c,run.user_id,prior.id,{requestId:randomUUID(),expectedRevision:prior.revision,action:'pause'});changedIds.push(prior.id)}
        }
      }
    }
    if(row.assertion==='user_reported'&&(/^(?:这次|刚才那次).{0,12}(?:访谈|行动|任务)我(?:暂时|先)不继续/.test(row.text)||refusalPreferenceClause(row.text)))
      await persistMemoryControl(c,run,{kind:'stop_recommend',itemId:row.id,expectedRevision:row.revision,clauseText:row.text})
    // A new general availability report for the identical calendar week
    if(row.assertion==='user_reported'&&['goal','direction'].includes(row.kind)&&/优先/.test(row.text)){
      const currentPath=matchPathTheme(row.text)?.title
      if(currentPath){
        const deferred=(await c.query("SELECT id,revision,text FROM growth_items WHERE user_id=$1 AND id<>$2 AND kind='context' AND assertion='user_reported' AND status='active' ORDER BY id FOR UPDATE",[run.user_id,row.id])).rows
        for(const prior of deferred)if(deferredPursuitClause(prior.text)&&matchPathTheme(prior.text)?.title===currentPath){
          await applyGrowthAction(c,run.user_id,prior.id,{requestId:randomUUID(),expectedRevision:prior.revision,action:'pause'});changedIds.push(prior.id)
        }
      }
    }
    // supersedes earlier amounts. Preserve history through the existing pause
    // action; its revision invalidates plans based on the older amount. Scoped
    // course/project allowances and other weeks remain independent.
    if(row.kind==='constraint'&&row.assertion==='user_reported'&&mutation.time?.basis.kind==='calendar_week'&&
      hoursIn(row.text)!==null&&!/(?:课程|备考|考研|创业|项目|实习|兼职|工作|接单|自由职业|科研|社团)/.test(row.text)){
      // A compact zero-time quote such as "可用时间是零" may omit the week
      // token because the immediately adjacent user clause supplies it. The
      // committed calendar-week evidence already binds the row to that week;
      // reuse that scope when comparing its budget field to prior rows.
      const budgetContext={period:mutation.time.basis.which==='next'?'next_week' as const:'this_week' as const,question:'本人可用时间',anchor:mutation.time.basis.quote}
      const currentBudget=applicableTimeBudget(row.text,budgetContext,undefined,{retainReportedBudget:true})
      const older=(await c.query("SELECT id,revision,text FROM growth_items WHERE user_id=$1 AND id<>$2 AND kind='constraint' AND assertion='user_reported' AND status='active' AND valid_until=$3 AND time_basis->>'kind'='calendar_week' ORDER BY id FOR UPDATE",[run.user_id,row.id,row.valid_until])).rows
      for(const prior of older)if(hoursIn(prior.text)!==null&&hoursIn(prior.text)!==hoursIn(row.text)&&!/(?:课程|备考|考研|创业|项目|实习|兼职|工作|接单|自由职业|科研|社团)/.test(prior.text)){
        const priorBudget=applicableTimeBudget(prior.text,undefined,undefined,{retainReportedBudget:true})
        // Only supersede a prior amount when both facts resolve to the same
        // budget field. A newly reported zero available-time limit is the
        // exception: it closes the whole week's remaining capacity, including
        // a prior value phrased as "剩余时间". An unparsed scope remains unknown.
        const zeroClosesWeek=currentBudget?.amountMinutes===0&&['available','remaining'].includes(currentBudget.scope)&&['available','remaining'].includes(priorBudget?.scope??'')
        if(!currentBudget||!priorBudget||currentBudget.period!==priorBudget.period||currentBudget.scope!==priorBudget.scope&&!zeroClosesWeek)continue
        await applyGrowthAction(c,run.user_id,prior.id,{requestId:randomUUID(),expectedRevision:prior.revision,action:'pause'});changedIds.push(prior.id)
      }
    }
    if(delta.target.operation==='create')createdIds.push(row.id)
    else changedIds.push(row.id)
  }
  // Map the provider's ORIGINAL growthUpdates positions to the facts that
  // actually wrote (created or changed); retained siblings and stale parents
  // are never bound to an input position.
  const byInputIndex=new Map<number,{id:string;revision:number}>()
  for(const [original,normalized] of staged.inputIndexBindings){
    const row=written.get(normalized)
    if(row)byInputIndex.set(original,{id:row.id,revision:row.revision})
  }
  return {ids,createdIds,changedIds,retainedIds,byInputIndex}
}
