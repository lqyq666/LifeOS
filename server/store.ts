import {reserveEntitlement,lockEntitlement,consumeEntitlement} from './entitlements.ts'
import { randomUUID, createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, transaction, HttpError, requireRow } from './db.ts'
import { validate, candidateSchema, retrievalSchema, type Candidate, type ExperienceAction } from './contracts.ts'
import { assertMemoryEvidence, assertSnapshotStillValid, invalidatePatternsForExperience, persistChanges, type MemorySnapshot, type MemoryChange } from './memory.ts'
import type { DialoguePath } from './dialogue.ts'
import seed from '../src/features/cognition/data/lifeos-graph.seed.json' with { type: 'json' }
import { persistCoachEvent, invalidateCoachSources, assertCoachEvidence, coachEventView, type CoachStaged } from './action-coach-events.ts'
import { assertCoachKnowledge, type CoachKnowledgeRef } from './coach-knowledge.ts'
import { assertGrowthSnapshot, persistGrowthUpdates, type GrowthStaged } from './growth.ts'
import { persistDirectionControls, readDirectionControls, directionControlsSnapshotKey, type PreparedDirectionControls } from './growth-controls.ts'
import { persistWeeklyPlan, type PersistedWeeklyPlan } from './weekly-plans.ts'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const lock = (client: PoolClient, key: string) => client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key])
export async function createConversation(user: string, input: { id: string; title: string }) {
  return transaction(async c => {
    await c.query('INSERT INTO conversations(id,user_id,title) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[input.id,user,input.title])
    return requireRow((await c.query('SELECT * FROM conversations WHERE id=$1 AND user_id=$2',[input.id,user])).rows[0])
  })
}
export async function patchConversation(user:string,id:string,patch:{ title?:string;renamed?:boolean;pinned?:boolean;projectId?:string|null }) {
  return requireRow((await pool.query('UPDATE conversations SET title=COALESCE($3,title),renamed=COALESCE($4,renamed),pinned=COALESCE($5,pinned),project_id=CASE WHEN $6 THEN $7 ELSE project_id END,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *',[user,id,patch.title??null,patch.renamed??null,patch.pinned??null,patch.projectId!==undefined,patch.projectId??null])).rows[0])
}
export async function listConversations(user:string) {
  const chats = (await pool.query('SELECT * FROM conversations WHERE user_id=$1 ORDER BY updated_at DESC,id',[user])).rows
  const messages = (await pool.query('SELECT m.*,CASE WHEN m.role=\'assistant\' AND NOT coach_reply_sources_valid(m.user_id,m.run_request_id) THEN \'这条回复引用的资料已更新或失效，请重新核验。\' ELSE m.content END AS content FROM messages m JOIN runs r ON r.user_id=m.user_id AND r.request_id=m.run_request_id WHERE m.user_id=$1 AND (m.role=\'user\' OR r.status=\'completed\') ORDER BY m.created_at,m.id',[user])).rows
  return chats.map(chat=>({ ...chat, messages: messages.filter(m=>m.conversation_id===chat.id) }))
}
export async function decisionVersions(user:string,conversation:string) {
  requireRow((await pool.query('SELECT id FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0])
  return (await pool.query('SELECT version,payload,created_at FROM decision_versions WHERE user_id=$1 AND conversation_id=$2 ORDER BY version DESC',[user,conversation])).rows
}
export async function listExperiences(user:string,conversation?:string) {
  if (conversation) requireRow((await pool.query('SELECT id FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0])
  const rows = (await pool.query('SELECT e.*, m.content AS source_text FROM experiences e JOIN messages m ON m.user_id=e.user_id AND m.id=e.source_message_id WHERE e.user_id=$1 AND e.status<>\'deleted\' AND ($2::uuid IS NULL OR e.conversation_id=$2) ORDER BY e.updated_at DESC,e.id',[user,conversation??null])).rows
  const links = (await pool.query('SELECT * FROM experience_links WHERE user_id=$1',[user])).rows
  return rows.map(e=>({ ...e, links: links.filter(link=>link.experience_id===e.id) }))
}
// The retrieval seam is deliberately small. It returns only this session user's explicitly confirmed records.
export async function retrieveExperiences(user:string,input:unknown,signal?:AbortSignal) {
  const { query,limit }=validate(retrievalSchema,input); signal?.throwIfAborted()
  const rows=(await pool.query('SELECT e.id,e.content,e.source_quote,e.revision,e.confirmed_at FROM experiences e JOIN messages m ON m.user_id=e.user_id AND m.conversation_id=e.conversation_id AND m.id=e.source_message_id WHERE e.user_id=$1 AND e.status=\'confirmed\' AND m.role=\'user\' AND btrim(e.source_quote)<>\'\' AND strpos(m.content,e.source_quote)>0 AND ($2=\'\' OR strpos(lower(e.content::text),lower($2))>0) ORDER BY e.updated_at DESC,e.id LIMIT $3',[user,query,limit])).rows
  signal?.throwIfAborted()
  return { records: rows, method: 'postgresql-basic', scope: 'session-user-confirmed', interpretationsAutomaticallyConfirmed: false }
}
export type Run = { user_id:string; request_id:string; conversation_id:string; source_message_id:string; expected_version:number; status:string; response:any }
export type Staged = { candidates:Candidate[]; audit:unknown[]; snapshot?:MemorySnapshot;  dialoguePath?:DialoguePath; memoryChanges?:MemoryChange[]; usedMemoryRefs?:{memoryId:string;revision:number}[];usedExperienceRefs?:{id:string;revision:number}[];usedGrowthRefs?:{id:string;revision:number}[];growthSnapshotKey?:string;growthBoundaryKey?:string;growth?:GrowthStaged;usedEventRefs?:{eventId:string;revision:number;generation:number}[];usedKnowledgeRefs?:CoachKnowledgeRef[]; upstreamCalls?:number; modelUsage?:unknown;coach?:CoachStaged;directionControls?:PreparedDirectionControls;directionControlSnapshotKey?:string;turnObligations?:import('./turn-obligations.ts').TurnObligations;weeklyPlan?:import('./weekly-plans.ts').PreparedWeeklyPlan }
export async function startRun(user:string,conversation:string,requestId:string,text:string) {
  return transaction(async c=>{
    await lock(c,user+':'+requestId)
    const previous=(await c.query('SELECT * FROM runs WHERE user_id=$1 AND request_id=$2',[user,requestId])).rows[0]
    const fingerprint=hash({conversation,text})
    if(previous) { if(previous.fingerprint!==fingerprint)throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED'); return {run:previous as Run,replay:true} }
    const entitlementReserved=await reserveEntitlement(c,user)
    const chat=requireRow((await c.query('SELECT * FROM conversations WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,conversation])).rows[0])
    if((await c.query('SELECT 1 FROM runs WHERE user_id=$1 AND conversation_id=$2 AND status=\'running\'',[user,conversation])).rowCount)throw new HttpError(409,'CONVERSATION_BUSY')
    const version=(await c.query('SELECT COALESCE(max(version),0)::int AS version FROM decision_versions WHERE user_id=$1 AND conversation_id=$2',[user,conversation])).rows[0].version
    const source=randomUUID()
    await c.query('INSERT INTO messages(id,user_id,conversation_id,role,content,run_request_id) VALUES($1,$2,$3,\'user\',$4,$5)',[source,user,conversation,text,requestId])
    const run=(await c.query('INSERT INTO runs(user_id,request_id,conversation_id,source_message_id,fingerprint,status,expected_version) VALUES($1,$2,$3,$4,$5,\'running\',$6) RETURNING *',[user,requestId,conversation,source,fingerprint,version])).rows[0] as Run
    if(entitlementReserved)await c.query('UPDATE runs SET entitlement_reserved=true WHERE user_id=$1 AND request_id=$2',[user,requestId])
    await c.query('UPDATE conversations SET title=CASE WHEN renamed THEN title ELSE $3 END,updated_at=now() WHERE user_id=$1 AND id=$2',[user,conversation,chat.title==='新对话'?text.slice(0,30):chat.title])
    return {run,replay:false}
  })
}
export async function contextForRun(run:Run) {
  const rows=(await pool.query('SELECT m.id,m.role,m.content,m.created_at FROM messages m JOIN runs r ON r.user_id=m.user_id AND r.request_id=m.run_request_id WHERE m.user_id=$1 AND m.conversation_id=$2 AND (m.role=\'user\' OR (r.status=\'completed\' AND coach_reply_sources_valid(m.user_id,m.run_request_id))) ORDER BY m.created_at DESC,m.id DESC LIMIT 16',[run.user_id,run.conversation_id])).rows.reverse()
  let chars=0; const bounded:typeof rows=[]
  for(const row of [...rows].reverse()) { if(chars+row.content.length>12000&&bounded.length>0)continue; bounded.unshift(row); chars+=row.content.length }
  return bounded
}
export async function sourceQuote(run:Run,sourceId:string,quote:string) {
  const source=requireRow((await pool.query('SELECT content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role=\'user\'',[run.user_id,run.conversation_id,sourceId])).rows[0])
  if(!quote.trim()||!source.content.includes(quote))throw new HttpError(400,'SOURCE_QUOTE_MISMATCH')
  return source
}
export async function stageCandidate(run:Run,staged:Staged,input:unknown,signal?:AbortSignal) {
  signal?.throwIfAborted(); const candidate=validate(candidateSchema,input); const source=await sourceQuote(run,candidate.sourceMessageId,candidate.quote)
  if(candidate.sourceMessageId!==run.source_message_id)throw new HttpError(400,'EXPERIENCE_SOURCE_NOT_CURRENT_MESSAGE')
  if(staged.candidates.length>=5)throw new HttpError(400,'CANDIDATE_LIMIT')
  // Acceptance and standing skills are not completed events, even when an LLM proposes them.
  if(/(?:我接受|我同意|可以试|愿意试)/.test(candidate.quote)&&/(?:不代表|不等于|还没|尚未|未).{0,8}(?:完成|发生|开始|行动)/.test(candidate.quote))throw new HttpError(400,'PLANNED_ACTION_IS_NOT_EXPERIENCE')
  if(/^(?:我)?(?:会|能使用|掌握|学过|熟悉)[^，。；！？\n]{0,80}[。！]?$/u.test(candidate.quote))throw new HttpError(400,'SKILL_IS_NOT_EXPERIENCE')
  const completedPast=/(?:去年|上学期|上个月|上月|上周|昨天|此前|之前|当时)/.test(candidate.quote)&&/(?:完成|做完|交付|提交|通过|按时)/.test(candidate.quote)&&!/(?:假设|如果|可能|没有|还没|未完成|未开始|没开始)/.test(candidate.quote)
  // A shortened idea quote must not hide a nearby explicit denial of acting on it.
  // Bound the check to the quoted sentence, so an unrelated unfinished event cannot revoke a real action.
  const quotedSentence=source.content.slice(source.content.indexOf(candidate.quote),source.content.indexOf(candidate.quote)+candidate.quote.length+80).split(/[。！？\n]/,1)[0]
  if(!completedPast&&/(?:考虑|想过|设想|构想|想象)/.test(candidate.quote)&&/(?:没有|还没|并未|尚未|未).{0,8}(?:开始|动手|行动|执行|实施)/.test(quotedSentence))throw new HttpError(400,'PLANNED_ACTION_IS_NOT_EXPERIENCE')
  if(/打算|希望|将要|下次|明天|以后/.test(candidate.quote)||(!completedPast&&/计划|准备|建议/.test(candidate.quote)))throw new HttpError(400,'PLANNED_ACTION_IS_NOT_EXPERIENCE')
  if(new Set(candidate.links.map(l=>l.valueId)).size!==candidate.links.length)throw new HttpError(400,'DUPLICATE_VALUE_LINK')
  if(!staged.candidates.some(c=>c.sourceMessageId===candidate.sourceMessageId&&c.quote===candidate.quote))staged.candidates.push(candidate)
  return {staged:true,status:'candidate',requiresUserConfirmation:true}
}
export async function finishRun(run:Run,staged:Staged,text:string,usage:unknown,signal:AbortSignal,dialoguePath:DialoguePath=staged.dialoguePath??'direct',upstreamCalls=staged.upstreamCalls??0) {
  signal.throwIfAborted()
  if(!text.trim()||text.length>16000)throw new HttpError(502,'INVALID_MODEL_RESPONSE')
  if(staged.coach&&staged.coach.reply!==text)throw new HttpError(400,'COACH_REPLY_MISMATCH')
  return transaction(async c=>{
    await lockEntitlement(c,run.user_id)
    const current=requireRow((await c.query('SELECT * FROM runs WHERE user_id=$1 AND request_id=$2 FOR UPDATE',[run.user_id,run.request_id])).rows[0])
    if(current.status!=='running'||signal.aborted)throw new HttpError(409,'RUN_NO_LONGER_ACTIVE')
    const allKnowledgeRefs=[...(staged.usedKnowledgeRefs??[]),...(staged.coach?.knowledgeRefs??[])]
    await assertCoachKnowledge(c,allKnowledgeRefs)
    const knowledgeRefs=[...new Map(allKnowledgeRefs.map(ref=>[ref.sourceId,ref])).values()]
    if(staged.snapshot){
      await assertSnapshotStillValid(c,run.user_id,staged.snapshot,staged.usedMemoryRefs??[])
    }
    await assertCoachEvidence(c,run.user_id,run.conversation_id,staged.usedEventRefs??[])
    await assertGrowthSnapshot(c,run.user_id,run.conversation_id,staged.usedGrowthRefs??[],staged.growthSnapshotKey,staged.growthBoundaryKey)
    for(const ref of staged.usedExperienceRefs??[]){
      const source=(await c.query("SELECT revision FROM experiences WHERE user_id=$1 AND id=$2 AND status='confirmed' FOR SHARE",[run.user_id,ref.id])).rows[0]
      if(!source||source.revision!==ref.revision)throw new HttpError(409,'EXPERIENCE_SNAPSHOT_INVALIDATED')
    }
    const version=(await c.query('SELECT COALESCE(max(version),0)::int AS version FROM decision_versions WHERE user_id=$1 AND conversation_id=$2',[run.user_id,run.conversation_id])).rows[0].version
    const candidateIds:string[]=[]
    for(const candidate of staged.candidates) {
      const id=randomUUID()
      const content={title:candidate.quote.slice(0,36),summary:candidate.quote,action:'',result:'',reflection:'',occurredAt:'',source:'用户对话原话',tags:[]}
      const inserted=await c.query('INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status) VALUES($1,$2,$3,$4,$5,$6,$7,\'candidate\') ON CONFLICT(user_id,source_message_id,source_quote) DO NOTHING RETURNING id',[id,run.user_id,run.conversation_id,candidate.sourceMessageId,candidate.quote,run.request_id,content])
      if(!inserted.rowCount)continue
      candidateIds.push(id)
      for(const link of candidate.links)await c.query('INSERT INTO experience_links(user_id,experience_id,value_id,reason,disposition) VALUES($1,$2,$3,$4,\'proposed\')',[run.user_id,id,link.valueId,link.reason])
      await c.query('INSERT INTO experience_revisions(user_id,experience_id,revision,action,snapshot) VALUES($1,$2,1,\'propose\',$3)',[run.user_id,id,{content,status:'candidate',source:candidate}])
    }
    for(const ref of knowledgeRefs)await c.query('INSERT INTO coach_reply_sources(user_id,request_id,source_id,revision) VALUES($1,$2,$3,$4)',[run.user_id,run.request_id,ref.sourceId,ref.revision])
    const coach=staged.coach?await persistCoachEvent(c,run,staged.coach):null
    const growth=staged.growth?await persistGrowthUpdates(c,run,staged.growth):null
    // Direction controls commit in the same transaction, after growth, under
    // the same advisory lock; a control snapshot changed by another device
    // during generation is a 409 conflict, never silently replayed.
    // N1.4: the expected key is the PRE-generation snapshot set on every
    // direction-affected turn; a change by another device during generation is
    // a 409 that rolls the whole run back — including turns without new
    // control changes of their own.
    const controlsBefore=await readDirectionControls(run.user_id,c)
    if(staged.directionControlSnapshotKey!==undefined&&directionControlsSnapshotKey(controlsBefore)!==staged.directionControlSnapshotKey)throw new HttpError(409,'DIRECTION_CONTROL_CONFLICT')
    const directionControls=staged.directionControls?await persistDirectionControls(c,run,staged.directionControls):null
    // P5.5 state-change receipt: what actually committed, computed from real
    // writes — never from the model's own claim of completion.
    const requiredEffects=staged.turnObligations?.requiredEffects??[]
    const requiredGrowth=requiredEffects.some(effect=>effect.type==='weekly_time')
    const growthStatus=!staged.growth?'not_requested'
      :requiredGrowth&&!growth?.changedIds.length&&!growth?.createdIds.length?'needs_confirmation'
      :staged.growth.skipped?.length?'partial'
      :'applied'
    // N1.6: the receipt is built ONLY from this transaction's own results —
    // persistCoachEvent's return (read through the same client) and the
    // before/after control effects. No pool re-read, no catch-to-null.
    // N2.2 order: facts → controls → plan; the plan's budget/basis resolve
    // against THIS transaction's growth writes and authorized facts.
    const plan:PersistedWeeklyPlan|null=staged.weeklyPlan?await persistWeeklyPlan(c,run,staged.weeklyPlan,growth,(await (await import('./growth.ts')).growthView(run.user_id,run.conversation_id,c)).items):null
    const materialAction=coach?.actions.find(action=>action.status==='proposed'&&action.draft&&action.draft.readiness)
    const controlEffects=directionControls?directionControls.effects:[]
    const changedScopes=controlEffects.filter(effect=>effect.before!==effect.after).map(effect=>effect.scope)
    const stateChange={
      growth:{status:growthStatus,createdIds:growth?growth.createdIds:[],changedIds:growth?growth.changedIds:[],retainedIds:growth?growth.retainedIds:[],skipped:(staged.growth?.skipped??[]).map(skip=>({inputIndex:skip.inputIndex,code:skip.reason}))},
      controls:{changedScopes,effects:controlEffects},
      material:materialAction&&materialAction.draft?{actionId:materialAction.id,revision:materialAction.revision,readiness:materialAction.draft.readiness as 'template'|'draft_for_user_review',missingRequired:materialAction.draft.missingRequired??[]}:null,
      plan:plan?{itemId:plan.itemId,revision:plan.revision,status:'proposed',budgetRef:plan.budgetRef}:null,
    }
    const memoryIds=staged.snapshot&&staged.memoryChanges?.length?await persistChanges(c,run.user_id,run.conversation_id,staged.memoryChanges,new Date()):[]
    await consumeEntitlement(c,run.user_id,current.entitlement_reserved)
    await c.query('INSERT INTO messages(id,user_id,conversation_id,role,content,run_request_id) VALUES($1,$2,$3,\'assistant\',$4,$5)',[randomUUID(),run.user_id,run.conversation_id,text,run.request_id])
    const response={requestId:run.request_id,decisionVersion:version,candidateIds,memoryIds,memorySavedCount:memoryIds.length,growthIds:growth?growth.ids:[],growthCreatedIds:growth?growth.createdIds:[],growthChangedIds:growth?growth.changedIds:[],growthRetainedIds:growth?growth.retainedIds:[],growthWrite:growth??null,stateChange,...(directionControls?{directionControls:{changedScopes,effects:controlEffects}}:{}),dialoguePath,upstreamCalls,usage,...(coach?{event:coach}:{})}
    await c.query('UPDATE runs SET status=\'completed\',response=$3,usage=$4,tool_audit=$5,finished_at=now() WHERE user_id=$1 AND request_id=$2',[run.user_id,run.request_id,response,usage,JSON.stringify(staged.audit)])
    await c.query('UPDATE conversations SET updated_at=now() WHERE user_id=$1 AND id=$2',[run.user_id,run.conversation_id])
    signal.throwIfAborted()
    return response
  })
}
export async function terminateRun(user:string,id:string,status:'cancelled'|'failed',code:string) {
  return requireRow((await pool.query('UPDATE runs SET status=CASE WHEN status=\'running\' THEN $3 ELSE status END,error_code=CASE WHEN status=\'running\' THEN $4 ELSE error_code END,finished_at=COALESCE(finished_at,now()) WHERE user_id=$1 AND request_id=$2 RETURNING status',[user,id,status,code])).rows[0])
}
export async function runStatus(user:string,id:string) {
  const run=requireRow((await pool.query('SELECT request_id,status,error_code,usage,response FROM runs WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0])
  if(run.status==='completed')run.response=await validRunResponse(user,id,run.response)
  return run
}
export async function validRunResponse(user:string,id:string,response:any){
  requireRow((await pool.query('SELECT 1 FROM runs WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0])
  const valid=(await pool.query('SELECT coach_reply_sources_valid($1,$2) AS valid',[user,id])).rows[0].valid
  if(!valid)return {...response,event:null,sourcesInvalidated:true}
  if(response?.event){
    try{return {...response,event:await coachEventView(user,response.event.conversationId,response.event.id)}}catch(error){if(error instanceof HttpError&&['NOT_FOUND','COACH_SOURCE_REVOKED','MEMORY_DISABLED'].includes(error.code))return {...response,event:null,sourcesInvalidated:true};throw error}
  }
  return response
}
export async function experienceAction(user:string,id:string,input:ExperienceAction) {
  return transaction(async c=>{
    await lock(c,user+':operation:'+input.requestId)
    await lock(c,user+':memory-settings')
    const fingerprint=hash({id,...input})
    const old=(await c.query('SELECT * FROM user_operations WHERE user_id=$1 AND request_id=$2',[user,input.requestId])).rows[0]
    if(old){if(old.fingerprint!==fingerprint)throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED');return old.response}
    const e=requireRow((await c.query('SELECT * FROM experiences WHERE user_id=$1 AND id=$2 AND status<>\'deleted\' FOR UPDATE',[user,id])).rows[0])
    if(e.revision!==input.expectedRevision)throw new HttpError(409,'EXPERIENCE_REVISION_CONFLICT')
    if(input.action==='correct'&&!input.content)throw new HttpError(400,'CONTENT_REQUIRED')
    if(input.action==='review'&&!input.link)throw new HttpError(400,'LINK_REQUIRED')
    if(input.action!=='correct'&&input.content)throw new HttpError(400,'UNEXPECTED_CONTENT')
    if(input.action==='delete'&&input.link)throw new HttpError(400,'UNEXPECTED_LINK')
    const status=input.action==='delete'?'deleted':input.action==='confirm'?'confirmed':e.status
    const content=input.content?{...e.content,...input.content,title:input.content.summary.slice(0,36)}:e.content
    if(input.action==='correct')await c.query('UPDATE experience_links SET disposition=\'proposed\' WHERE user_id=$1 AND experience_id=$2',[user,id])
    if(input.link){
      const link=input.link
      const changed=await c.query('UPDATE experience_links SET reason=$4,disposition=$5 WHERE user_id=$1 AND experience_id=$2 AND value_id=$3',[user,id,link.valueId,link.reason,link.disposition])
      if(!changed.rowCount)throw new HttpError(404,'LINK_NOT_FOUND')
    }
    const updated=(await c.query('UPDATE experiences SET content=$3,status=$4,revision=revision+1,confirmed_at=CASE WHEN $4=\'confirmed\' THEN COALESCE(confirmed_at,now()) ELSE NULL END,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *',[user,id,content,status])).rows[0]
    if(input.action==='correct'||input.action==='delete'){
      await invalidatePatternsForExperience(c,user,id)
      await invalidateCoachSources(c,user,[e.source_message_id],input.action==='delete')
    }
    await c.query('INSERT INTO experience_revisions(user_id,experience_id,revision,action,snapshot) VALUES($1,$2,$3,$4,$5)',[user,id,updated.revision,input.action,{content,status,link:input.link??null}])
    await c.query('INSERT INTO user_operations(user_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4)',[user,input.requestId,fingerprint,updated])
    return updated
  })
}
export async function cognitionGraph(user:string) {
  const experiences=(await listExperiences(user)).filter(e=>e.status==='confirmed')
  const nodes=seed.nodes.filter(n=>n.type!=='experience').map(n=>({...n,description:n.type==='value'?'经历浏览分类；不是永久价值观认定':n.description}))
  const edges=seed.edges.filter(e=>e.type==='HAS_VALUE').map(e=>({...e,status:'category',reason:'浏览分类，不代表已确认的永久价值观',sourceEvidence:[]}))
  for(const e of experiences){
    const id='exp-'+e.id
    nodes.push({id,type:'experience',...e.content,title:e.content.title,contentStatus:'user_confirmed',evidenceStatus:'user_testimony',overviewOrder:nodes.length,media:[],serverId:e.id,serverRevision:e.revision} as any)
    for(const link of e.links.filter((l:any)=>l.disposition!=='rejected'))edges.push({id:'rel-'+e.id+'-'+link.value_id,type:'RELATES_TO_VALUE',sourceId:id,targetId:link.value_id,reason:link.reason,status:link.disposition,sourceEvidence:[e.source_quote],confidence:null} as any)
  }
  return {...seed,purpose:'当前登录用户的正式经历；价值节点仅作浏览分类',notice:'经历由用户确认，个人解释仍可修改，不是永久价值观。',nodes,edges,
    viewConfig:{...seed.viewConfig,overviewExperienceOrder:experiences.map(e=>'exp-'+e.id)},storage:'postgresql',interpretationsAutomaticallyConfirmed:false}
}
