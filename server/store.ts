import {reserveEntitlement,lockEntitlement,consumeEntitlement} from './entitlements.ts'
import { randomUUID, createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, transaction, HttpError, requireRow } from './db.ts'
import { validate, candidateSchema, retrievalSchema, type Candidate, type ExperienceAction } from './contracts.ts'
import {clauseExpressesWishToAct,clauseReportsCompleted} from './experience-content.ts'
import {scanUserClauses} from './user-command-spans.ts'
import { assertMemoryEvidence, assertSnapshotStillValid, invalidatePatternsForExperience, persistChanges, type MemorySnapshot, type MemoryChange } from './memory.ts'
import type { DialoguePath } from './dialogue.ts'
import seed from '../src/features/cognition/data/lifeos-graph.seed.json' with { type: 'json' }
import { persistCoachEvent, invalidateCoachSources, assertCoachEvidence, coachEventView, type CoachStaged } from './action-coach-events.ts'
import { assertCoachKnowledge, type CoachKnowledgeRef } from './coach-knowledge.ts'
import {persistGuideUsage,type GuideUsage} from './guide-usage.ts'
import { assertGrowthSnapshot, persistGrowthUpdates, growthView, type GrowthStaged } from './growth.ts'
import { persistDirectionControls, readDirectionControls, directionControlsSnapshotKey, directionScopeLabel, type PreparedDirectionControls } from './growth-controls.ts'
import { persistMemoryControl, persistPendingControlRequest, type MemoryControlReceipt, type PendingMemoryControl, type StagedMemoryControl } from './memory-controls.ts'
import { persistWeeklyPlan, type PersistedWeeklyPlan } from './weekly-plans.ts'
import { derivePatternProposals } from './experience-patterns.ts'
import { findEpisode, mergeContent,timeContradiction } from './experience-episodes.ts'
import { projectUserThemes, linkExperienceToThemes, reconcileThemesWithGrowth, rankPrimaryThemes, themeNextStep, themeHasPursuitSource } from './user-themes.ts'
import { matchPathTheme } from './path-lexicon.ts'
import { projectIdentityClaims, recordChangeEvent, reconcileIdentityClaims, identityClaimAction } from './identity.ts'
import { extractSkillTags, isBlockedExperience, isExternalFeedback, readSkillTags } from './starmap-enrichment.ts'
import { buildExperienceRelations } from './starmap-enrichment.ts'
import { applicableExperienceOutcomes, generateInsight, summarizeExperience } from './experience-insight.ts'
import {taskOutcomeReadback} from './turn-contract.ts'
import {commitWorkflowSelection,type WorkflowAdoption} from './workflows/task-commit.ts'
import {committedGrowthDiff,committedSnapshot,validGrowthDiff} from './workflows/committed-growth-diff.ts'
import {advancedWorkflowsEnabled} from './workflows/router.ts'

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
  // N4.1: each assistant message carries ITS OWN run's stateChange receipt —
  // never the account's latest receipt, never a fabricated demo receipt.
  const receiptRows = (await pool.query(`SELECT request_id, response->'stateChange' AS \"stateChange\" FROM runs WHERE user_id=$1 AND status='completed' AND response ? 'stateChange'`,[user])).rows as {request_id:string;stateChange:unknown}[]
  const receipts=new Map<string,unknown>(await Promise.all(receiptRows.map(async row=>{const state=row.stateChange as {growthDiff?:import('./workflows/growth-diff.ts').GrowthDelta[]};const message=messages.find(m=>m.run_request_id===row.request_id);return [row.request_id,state?.growthDiff?.length&&message?{...state,growthDiff:await validGrowthDiff(user,message.conversation_id,state.growthDiff)}:state] as const})))
  return chats.map(chat=>({ ...chat, messages: messages.filter((m:{conversation_id:string})=>m.conversation_id===chat.id).map((m:Record<string,unknown>)=>m.role==='assistant'&&typeof m.run_request_id==='string'&&receipts.has(m.run_request_id)?{...m,stateChange:receipts.get(m.run_request_id)??null}:m) }))
}
export async function decisionVersions(user:string,conversation:string) {
  requireRow((await pool.query('SELECT id FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0])
  return (await pool.query('SELECT version,payload,created_at FROM decision_versions WHERE user_id=$1 AND conversation_id=$2 ORDER BY version DESC',[user,conversation])).rows
}
export async function listExperiences(user:string,conversation?:string) {
  if (conversation) requireRow((await pool.query('SELECT id FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0])
  const rows = (await pool.query('SELECT e.*, m.content AS source_text, c.title AS conversation_title FROM experiences e JOIN messages m ON m.user_id=e.user_id AND m.id=e.source_message_id JOIN conversations c ON c.user_id=e.user_id AND c.id=e.conversation_id WHERE e.user_id=$1 AND e.status<>\'deleted\' AND ($2::uuid IS NULL OR e.conversation_id=$2) ORDER BY e.updated_at DESC,e.id',[user,conversation??null])).rows
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
export type Staged = { workflowAdoption?:WorkflowAdoption; guideUsage?:GuideUsage[]; candidates:Candidate[]; audit:unknown[]; backReferenceMerge?:{experienceId:string;quote:string;result:string;occurredAt:string}; serverGoals?:{text:string;quote:string;messageId:string}[];serverBudgets?:{text:string;quote:string;messageId:string}[];starMapSnapshot?:{themes:{id:string;revision:number}[];links:{experienceId:string;themeId:string;revision:number}[]}; snapshot?:MemorySnapshot;  dialoguePath?:DialoguePath; memoryChanges?:MemoryChange[]; usedMemoryRefs?:{memoryId:string;revision:number}[];usedExperienceRefs?:{id:string;revision:number}[];usedGrowthRefs?:{id:string;revision:number}[];growthSnapshotKey?:string;growthBoundaryKey?:string;growth?:GrowthStaged;usedEventRefs?:{eventId:string;revision:number;generation:number}[];usedKnowledgeRefs?:CoachKnowledgeRef[]; upstreamCalls?:number; modelUsage?:unknown;coach?:CoachStaged;directionControls?:PreparedDirectionControls;directionControlSnapshotKey?:string;turnObligations?:import('./turn-obligations.ts').TurnObligations;weeklyPlan?:import('./weekly-plans.ts').PreparedWeeklyPlan;memoryControl?:StagedMemoryControl;pendingMemoryControl?:PendingMemoryControl }
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
  if(/(?:没(?:有)?|尚未|还未|未曾).{0,6}(?:开始|做|尝试|完成|交付)/.test(candidate.quote)&&!scanUserClauses(candidate.quote).some(clause=>!clause.conditional&&!clause.quoted&&!clause.code&&!clause.interrogative&&clauseReportsCompleted(clause.text)))throw new HttpError(400,'PLANNED_ACTION_IS_NOT_EXPERIENCE')
  // Acceptance and standing skills are not completed events, even when an LLM proposes them.
  if(/(?:我接受|我同意|可以试|愿意试)/.test(candidate.quote)&&/(?:不代表|不等于|还没|尚未|未).{0,8}(?:完成|发生|开始|行动)/.test(candidate.quote))throw new HttpError(400,'PLANNED_ACTION_IS_NOT_EXPERIENCE')
  if(/^(?:我)?(?:会|能使用|掌握|学过|熟悉)[^，。；！？\n]{0,80}[。！]?$/u.test(candidate.quote))throw new HttpError(400,'SKILL_IS_NOT_EXPERIENCE')
  const completedPast=/(?:去年|上学期|上个月|上月|上周|昨天|此前|之前|当时)/.test(candidate.quote)&&/(?:完成|做完|交付|提交|通过|按时)/.test(candidate.quote)&&!/(?:假设|如果|可能|没有|还没|未完成|未开始|没开始)/.test(candidate.quote)
  // A shortened idea quote must not hide a nearby explicit denial of acting on it.
  // Bound the check to the quoted sentence, so an unrelated unfinished event cannot revoke a real action.
  const quotedSentence=source.content.slice(source.content.indexOf(candidate.quote),source.content.indexOf(candidate.quote)+candidate.quote.length+80).split(/[。！？\n]/,1)[0]
  if(!completedPast&&/(?:考虑|想过|设想|构想|想象)/.test(candidate.quote)&&/(?:没有|还没|并未|尚未|未).{0,8}(?:开始|动手|行动|执行|实施)/.test(quotedSentence))throw new HttpError(400,'PLANNED_ACTION_IS_NOT_EXPERIENCE')
  if(/打算|希望|将要|下次|明天|以后/.test(candidate.quote)||(!completedPast&&(/计划|准备|建议/.test(candidate.quote)||clauseExpressesWishToAct(candidate.quote))))throw new HttpError(400,'PLANNED_ACTION_IS_NOT_EXPERIENCE')
  if(new Set(candidate.links.map(l=>l.valueId)).size!==candidate.links.length)throw new HttpError(400,'DUPLICATE_VALUE_LINK')
  if(!staged.candidates.some(c=>c.sourceMessageId===candidate.sourceMessageId&&c.quote===candidate.quote))staged.candidates.push(candidate)
  return {staged:true,status:'confirmed',autoConfirmed:true}
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
    // G1.3 快照校验先于本轮任何写入：他端在生成期间改动了被使用的主题或
    // 连线（确认/撤销/更正）时，本轮基于旧证据的建议被阻止提交；本轮自己
    // 的正常更新发生在校验之后，不会自撞。
    if(staged.starMapSnapshot?.themes?.length||staged.starMapSnapshot?.links?.length)await assertStarMapSnapshot(c,run.user_id,staged.starMapSnapshot)
    const diffEnabled=advancedWorkflowsEnabled()&&Boolean(staged.growth||staged.serverGoals?.length||staged.serverBudgets?.length||staged.workflowAdoption||staged.candidates.length||staged.backReferenceMerge)
    const diffBefore=diffEnabled?await committedSnapshot(c,run.user_id,run.conversation_id):[]
    const themesBeforeAdoption=staged.workflowAdoption?(await c.query('SELECT id,revision FROM user_themes WHERE user_id=$1',[run.user_id])).rows:[]
    const workflowCommit=staged.workflowAdoption?await commitWorkflowSelection(c,run,staged.workflowAdoption):null
    const candidateIds:string[]=[],mergedExperienceIds:string[]=[]
    // 反述直连：命中既有经历的追述在事务内合并（身份不变、只补结果/反思）。
    if(staged.backReferenceMerge){
      const merge=staged.backReferenceMerge
      const episode=requireRow((await c.query("SELECT * FROM experiences WHERE user_id=$1 AND id=$2 AND status='confirmed' FOR UPDATE",[run.user_id,merge.experienceId])).rows[0])
      const merged=mergeContent(episode.content??{},{action:'',result:merge.result,occurredAt:merge.occurredAt})
      const nextContent={...episode.content,action:merged.action,result:merged.result,reflection:merged.reflection,occurredAt:merged.occurredAt}
      const updated=(await c.query("UPDATE experiences SET content=$3, revision=revision+1, updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING revision",[run.user_id,episode.id,nextContent])).rows[0]
      await c.query("INSERT INTO experience_revisions(user_id,experience_id,revision,action,snapshot) VALUES($1,$2,$3,'correct',$4)",[run.user_id,episode.id,updated.revision,{merged:true,fromMessageId:run.source_message_id,quote:merge.quote}])
      await c.query("UPDATE experience_theme_links SET relation='correction', revision=revision+1 WHERE user_id=$1 AND experience_id=$2 AND status='active'",[run.user_id,episode.id])
      await invalidatePatternsForExperience(c,run.user_id,episode.id)
      mergedExperienceIds.push(String(episode.id))
    }
    // 同一事件的多轮讲述合并进原经历：先在既有已确认经历里找同源片段，
    // 找到就只更新内容并推进修订，不另立新行。
    const existingEpisodes=(await c.query("SELECT id, source_quote, content FROM experiences WHERE user_id=$1 AND status='confirmed'",[run.user_id])).rows
    for(const candidate of staged.candidates) {
      const id=randomUUID()
      const content={title:candidate.quote.slice(0,36),summary:candidate.quote,action:candidate.content?.action??'',result:candidate.content?.result??'',reflection:'',occurredAt:candidate.content?.occurredAt??'',source:'用户对话原话',tags:[]}
      const episode=findEpisode(existingEpisodes,candidate.quote,content.action,content.result)
      if(episode){
        const merged=mergeContent(episode.content??{},{action:content.action,result:content.result,occurredAt:content.occurredAt})
        const nextContent={...episode.content,action:merged.action,result:merged.result,reflection:merged.reflection,occurredAt:merged.occurredAt}
        const updated=(await c.query('UPDATE experiences SET content=$3, revision=revision+1, updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING revision',[run.user_id,episode.id,nextContent])).rows[0]
        await c.query("INSERT INTO experience_revisions(user_id,experience_id,revision,action,snapshot) VALUES($1,$2,$3,'correct',$4)",[run.user_id,episode.id,updated.revision,{merged:true,fromMessageId:candidate.sourceMessageId,content:nextContent}])
        // 反馈修正了原有认识：该经历的既有主题关系升级为 correction。
        await c.query("UPDATE experience_theme_links SET relation='correction', revision=revision+1 WHERE user_id=$1 AND experience_id=$2 AND status='active'",[run.user_id,episode.id])
        // 结果被后续反馈修正后，引用这段经历的旧模式观察随之失效。
        await invalidatePatternsForExperience(c,run.user_id,episode.id)
        mergedExperienceIds.push(String(episode.id))
        continue
      }
      const inserted=await c.query('INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,\'confirmed\',now(),\'auto\',2) ON CONFLICT(user_id,source_message_id,source_quote) DO NOTHING RETURNING id',[id,run.user_id,run.conversation_id,candidate.sourceMessageId,candidate.quote,run.request_id,content])
      if(!inserted.rowCount)continue
      candidateIds.push(id)
      for(const link of candidate.links)await c.query('INSERT INTO experience_links(user_id,experience_id,value_id,reason,disposition) VALUES($1,$2,$3,$4,\'proposed\')',[run.user_id,id,link.valueId,link.reason])
      await c.query('INSERT INTO experience_revisions(user_id,experience_id,revision,action,snapshot) VALUES($1,$2,1,\'propose\',$3),($1,$2,2,\'confirm\',\'{"auto":true}\'::jsonb)',[run.user_id,id,{content,status:'confirmed',source:candidate}])
    }
    for(const id of candidateIds)await proposeExperiencePatterns(c,run.user_id,id)
    for(const ref of knowledgeRefs)await c.query('INSERT INTO coach_reply_sources(user_id,request_id,source_id,revision) VALUES($1,$2,$3,$4)',[run.user_id,run.request_id,ref.sourceId,ref.revision])
    const coach=staged.coach?await persistCoachEvent(c,run,staged.coach):null
    if(staged.guideUsage?.length)await persistGuideUsage(c,run,staged.guideUsage)
    let growth=staged.growth?await persistGrowthUpdates(c,run,staged.growth):null
    // 主题投影：本轮已提交的 growth 事实（用户亲述的目标/方向/优先级/偏好）
    // 确定性上投影为“我的成长主题”；随后的经历再挂到主题上。同一事务、
    // 零新增模型调用。
    // P2: 经历间关联——新经历与既有经历建 similar/follows 边
    for(const id of candidateIds){
      const row=(await c.query('SELECT source_quote, content FROM experiences WHERE user_id=$1 AND id=$2',[run.user_id,id])).rows[0]
      if(row)await buildExperienceRelations(c,run.user_id,String(id),row.source_quote+' '+(row.content?.action??'')+' '+(row.content?.result??''))
    }
    // 确定性目标捕获落盘：未被模型通道覆盖的显式决定句，按原话写入
    // growth（与模型写入同构：user_reported、来源=当轮消息、修订可追溯）。
    const serverGoalIds:string[]=[]
    for(const goal of staged.serverGoals??[]){
      // Capture runs before model deltas are staged; recheck committed facts
      // in this same transaction, independent of the model's kind label.
      const source={type:'message',id:goal.messageId,quote:goal.quote}
      if((await c.query("SELECT 1 FROM growth_items WHERE user_id=$1 AND status IN ('active','proposed') AND assertion='user_reported' AND sources @> $2::jsonb",[run.user_id,JSON.stringify([source])])).rowCount)continue
      const id=randomUUID()
      await c.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,revision) VALUES($1,$2,$3,'goal',$4,'user_reported','active',$5,'[]'::jsonb,1)",[id,run.user_id,run.conversation_id,goal.text,JSON.stringify([{type:'message',id:goal.messageId,quote:goal.quote}])])
      await c.query("INSERT INTO growth_revisions(user_id,item_id,revision,action,snapshot) VALUES($1,$2,1,'server_capture',$3)",[run.user_id,id,JSON.stringify({text:goal.text,quote:goal.quote,reason:'explicit decision clause not covered by model growth lane'})])
      serverGoalIds.push(id)
    }
    const serverBudgetIds:string[]=[]
    for(const budget of staged.serverBudgets??[]){
      // 模型通道通常也会保存同一预算事实：同 text 已存在时服务器捕获跳过，
      // 避免重复行干扰更正打分。
      if((await c.query("SELECT 1 FROM growth_items WHERE user_id=$1 AND text=$2 AND status='active'",[run.user_id,budget.text])).rowCount)continue
      const id=randomUUID()
      await c.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,revision) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]'::jsonb,1)",[id,run.user_id,run.conversation_id,budget.text,JSON.stringify([{type:'message',id:budget.messageId,quote:budget.quote}])])
      await c.query("INSERT INTO growth_revisions(user_id,item_id,revision,action,snapshot) VALUES($1,$2,1,'server_capture',$3)",[run.user_id,id,JSON.stringify({text:budget.text,quote:budget.quote,reason:'explicit weekly budget clause not covered by model growth lane'})])
      serverBudgetIds.push(id)
    }
    if(serverGoalIds.length||serverBudgetIds.length){
      growth??={ids:[],createdIds:[],changedIds:[],retainedIds:[],byInputIndex:new Map()}
      growth.ids.push(...serverGoalIds,...serverBudgetIds)
      growth.createdIds.push(...serverGoalIds,...serverBudgetIds)
    }
    const themeFactIds=[...new Set([...(growth?.createdIds??[]),...(growth?.changedIds??[]),...(workflowCommit?[workflowCommit.itemId]:[])])]
    let themeChangedIds:string[]=[];let facts:any[]=[]
    if(themeFactIds.length){
      facts=(await c.query('SELECT id,kind,text,assertion,status FROM growth_items WHERE user_id=$1 AND id=ANY($2::uuid[])',[run.user_id,themeFactIds])).rows
      themeChangedIds=await projectUserThemes(c,run.user_id,facts)
    }
    if(workflowCommit){const now=(await c.query('SELECT id,revision FROM user_themes WHERE user_id=$1',[run.user_id])).rows;themeChangedIds=[...new Set([...themeChangedIds,...now.filter(row=>!themesBeforeAdoption.some(old=>old.id===row.id&&old.revision===row.revision)).map(row=>row.id)])]}
    if(themeFactIds.length||candidateIds.length||mergedExperienceIds.length)await reconcileThemesWithGrowth(c,run.user_id)
    await reconcileIdentityClaims(c,run.user_id)
    // 身份投影：本轮自述认同（“我是那种……”）进入身份层，幂等。
    const identityFacts=[...(facts??[]),...(staged.serverGoals??[]).map(goal=>({id:'server-'+goal.messageId+goal.text.length,kind:'goal',text:goal.text,assertion:'user_reported',status:'active'}))]
    await projectIdentityClaims(c,run.user_id,identityFacts as any)
    // 变更事件：经历创建与合并（真实迁移才记录）。
    for(const id of candidateIds)await recordChangeEvent(c,run.user_id,{subjectType:'experience',subjectId:id,transition:'created',reason:'对话中报告的已发生行动',impact:'星图中外轨新增经历',unknowns:'后续反馈和长期意义还未知'})
    for(const id of mergedExperienceIds)await recordChangeEvent(c,run.user_id,{subjectType:'experience',subjectId:id,transition:'merged',reason:'同一事件的后续反馈并入原经历',impact:'经历结果更新，相关连线转为修正',unknowns:'新反馈是否形成稳定模式仍待更多证据'})
    for(const experienceId of [...candidateIds,...mergedExperienceIds]){
      const row=(await c.query('SELECT source_quote, content FROM experiences WHERE user_id=$1 AND id=$2',[run.user_id,experienceId])).rows[0]
      if(row)await linkExperienceToThemes(c,run.user_id,experienceId,`${row.source_quote} ${row.content?.action??''} ${row.content?.result??''}`,true)
    }
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
    // P6 closeout A2: chat-derived memory controls commit HERE — in the run's
    // final transaction, after every snapshot assertion — so control and reply
    // commit or roll back together, and the receipt reflects the real write.
    // A revision conflict raised by the control fails the whole run instead of
    // silently dropping the user's operation behind a successful-looking reply.
    const memoryControlReceipt:MemoryControlReceipt|null=staged.memoryControl?await persistMemoryControl(c,run,staged.memoryControl):null
    const memoryControl=memoryControlReceipt??(staged.pendingMemoryControl?await persistPendingControlRequest(c,run,staged.pendingMemoryControl):null)
    // P5.5 state-change receipt: what actually committed, computed from real
    // writes — never from the model's own claim of completion.
    const requiredEffects=staged.turnObligations?.requiredEffects??[]
    const requiredGrowth=requiredEffects.some(effect=>effect.type==='weekly_time'||effect.type==='remaining_time')
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
    const growthDiff=diffEnabled?await committedGrowthDiff(c,run.user_id,run.conversation_id,run.request_id,diffBefore,[...themeFactIds,...candidateIds,...mergedExperienceIds],row=>staged.audit.push({phase:'workflow_trace',...row})):[]
        const stateChange={
          growthDiff,
          growthDiffStatus:staged.audit.some((row:any)=>row.phase==='workflow_trace'&&row.agentRole==='skill'&&['lifeos-growth-diff','lifeos-experience-evidence'].includes(row.skill)&&row.status==='failed')?'unavailable':'applied',
          workflow:workflowCommit,
          growth:{status:growthStatus,createdIds:growth?growth.createdIds:[],changedIds:growth?growth.changedIds:[],retainedIds:growth?growth.retainedIds:[],skipped:(staged.growth?.skipped??[]).map(skip=>({inputIndex:skip.inputIndex,code:skip.reason}))},
          controls:{changedScopes,effects:controlEffects},
          memoryControl,
          material:materialAction&&materialAction.draft?{actionId:materialAction.id,revision:materialAction.revision,readiness:materialAction.draft.readiness as 'template'|'draft_for_user_review',missingRequired:materialAction.draft.missingRequired??[]}:null,
          plan:plan?{itemId:plan.itemId,revision:plan.revision,status:'proposed',budgetRef:plan.budgetRef}:null,
          experiences:{createdIds:candidateIds,mergedIds:mergedExperienceIds},
          themes:{changedIds:themeChangedIds},
          guideUsage:{status:staged.guideUsage?.length?'applied':'not_requested',items:(staged.guideUsage??[]).map(({guideId,revision,branch,stepId,status,eventId})=>({guideId,revision,branch,stepId,status,eventId}))},
        }
    const memoryIds=staged.snapshot&&staged.memoryChanges?.length?await persistChanges(c,run.user_id,run.conversation_id,staged.memoryChanges,new Date()):[]
    await consumeEntitlement(c,run.user_id,current.entitlement_reserved)
    await c.query('INSERT INTO messages(id,user_id,conversation_id,role,content,run_request_id) VALUES($1,$2,$3,\'assistant\',$4,$5)',[randomUUID(),run.user_id,run.conversation_id,text,run.request_id])
    const response={requestId:run.request_id,decisionVersion:version,candidateIds,mergedExperienceIds,themeChangedIds,memoryIds,memorySavedCount:memoryIds.length,growthIds:growth?growth.ids:[],growthCreatedIds:growth?growth.createdIds:[],growthChangedIds:growth?growth.changedIds:[],growthRetainedIds:growth?growth.retainedIds:[],growthWrite:growth??null,stateChange,...(memoryControl?{memoryControl}:{}),...(directionControls?{directionControls:{changedScopes,effects:controlEffects}}:{}),dialoguePath,upstreamCalls,usage,...(coach?{event:coach}:{})}
    if(workflowCommit)await c.query("UPDATE lifeos_workflow_tasks SET host_commit=$3,receipt=jsonb_set(receipt,'{status}','\"persisted\"'::jsonb) WHERE user_id=$1 AND request_id=$2",[run.user_id,workflowCommit.taskId,JSON.stringify(response)])
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
  if(response?.stateChange?.growthDiff?.length){const run=(await pool.query('SELECT conversation_id FROM runs WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0];response={...response,stateChange:{...response.stateChange,growthDiff:await validGrowthDiff(user,run.conversation_id,response.stateChange.growthDiff)}}}
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
// 行为模式生成：同类已确认经历≥2段且新经历参与时，提出一条待核对观察。
// 已存在同 behaviorKey 的候选（pending/accepted）不重提；被拒绝过的读法不再出现。
async function proposeExperiencePatterns(c: PoolClient, user: string, newExperienceId: string) {
  const rows = (await c.query(`SELECT e.id, e.revision, e.conversation_id, e.source_message_id, e.source_quote, e.content, array_remove(array_agg(l.value_id) FILTER (WHERE l.disposition <> 'rejected'), NULL) AS value_ids FROM experiences e LEFT JOIN experience_links l ON l.user_id = e.user_id AND l.experience_id = e.id WHERE e.user_id = $1 AND e.status = 'confirmed' GROUP BY e.id`, [user])).rows
  const experiences = rows.map((row: any) => ({
    id: row.id, revision: row.revision, conversationId: row.conversation_id, sourceMessageId: row.source_message_id,
    quote: row.source_quote, action: String(row.content?.action ?? ''), result: String(row.content?.result ?? ''), valueIds: row.value_ids ?? [],
  }))
  for (const proposal of derivePatternProposals(experiences, newExperienceId)) {
    const existing = (await c.query(`SELECT 1 FROM memory_items WHERE user_id = $1 AND kind = 'pattern_candidate' AND value->>'behaviorKey' = $2`, [user, proposal.behaviorKey])).rowCount
    if (existing) continue
    await c.query(`INSERT INTO memory_items(id, user_id, kind, value, assertion, scope, source_refs, observed_at, valid_from, status) VALUES($1, $2, 'pattern_candidate', $3, 'system_pattern_candidate', 'user', $4, now(), now(), 'pending')`, [
      randomUUID(), user,
      JSON.stringify({ behaviorKey: proposal.behaviorKey, context: proposal.context, behavior: proposal.behavior, outcome: proposal.outcome, limitations: proposal.limitations }),
      JSON.stringify(proposal.supporting.map(experience => ({ type: 'experience', experienceId: experience.id, revision: experience.revision, conversationId: experience.conversationId, messageId: experience.sourceMessageId, quote: experience.quote }))),
    ])
  }
}

// 用户对主题的操作：置顶/取消置顶、重命名、暂缓、恢复、撤销。撤销或暂缓
// 会同步退休其经历连线；恢复则重新激活。修订校验+幂等键，全部持久化。
export type ThemeAction = { requestId:string; expectedRevision:number; action:'pin'|'unpin'|'rename'|'pause'|'resume'|'revoke'; title?:string }
export async function themeAction(user:string,id:string,input:ThemeAction) {
  return transaction(async c=>{
    await lock(c,user+':operation:'+input.requestId)
    const fingerprint=hash({id,...input})
    const old=(await c.query('SELECT * FROM user_operations WHERE user_id=$1 AND request_id=$2',[user,input.requestId])).rows[0]
    if(old){if(old.fingerprint!==fingerprint)throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED');return old.response}
    const theme=requireRow((await c.query('SELECT * FROM user_themes WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,id])).rows[0])
    if(theme.revision!==input.expectedRevision)throw new HttpError(409,'THEME_REVISION_CONFLICT')
    if(input.action==='rename'&&!input.title?.trim())throw new HttpError(400,'TITLE_REQUIRED')
    if(input.action!=='rename'&&input.title)throw new HttpError(400,'UNEXPECTED_TITLE')
    const nextStatus=input.action==='pause'?'paused':input.action==='resume'?(theme.origin==='user_stated'?'active':'pending'):input.action==='revoke'?'retired':theme.status
    const updated=(await c.query("UPDATE user_themes SET title=COALESCE($3,title), title_locked=CASE WHEN $4='rename' THEN true ELSE title_locked END, pinned=CASE WHEN $4='pin' THEN true WHEN $4='unpin' THEN false ELSE pinned END, status=$5, revision=revision+1, updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *",[user,id,input.action==='rename'?input.title!.trim().slice(0,60):null,input.action,nextStatus])).rows[0]
    if(input.action==='revoke'||input.action==='pause')await c.query("UPDATE experience_theme_links SET status='retired', revision=revision+1 WHERE user_id=$1 AND theme_id=$2 AND status='active'",[user,id])
    if(input.action==='resume')await c.query("UPDATE experience_theme_links SET status='active', revision=revision+1 WHERE user_id=$1 AND theme_id=$2 AND status='retired'",[user,id])
    await c.query('INSERT INTO user_operations(user_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4)',[user,input.requestId,fingerprint,updated])
    return updated
  })
}

// 焦点身份的归属校验：只返回本人且仍可用的标题。
export async function themeOwnership(user:string,id:string):Promise<string|null>{
  const row=(await pool.query("SELECT title FROM user_themes WHERE user_id=$1 AND id=$2 AND status IN ('active','pending')",[user,id])).rows[0]
  return row?row.title:null
}
export async function experienceOwnership(user:string,id:string):Promise<string|null>{
  const row=(await pool.query("SELECT content->>'title' AS title FROM experiences WHERE user_id=$1 AND id=$2 AND status='confirmed'",[user,id])).rows[0]
  return row?(row.title??null):null
}

// 链接的用户裁决：确认（可信已连线）或撤销（不再进入任何决策）。
export type ThemeLinkAction={requestId:string;action:'confirm'|'revoke'}
export async function themeLinkAction(user:string,experienceId:string,themeId:string,input:ThemeLinkAction){
  return transaction(async c=>{
    await lock(c,user+':operation:'+input.requestId)
    const fingerprint=hash({experienceId,themeId,...input})
    const old=(await c.query('SELECT * FROM user_operations WHERE user_id=$1 AND request_id=$2',[user,input.requestId])).rows[0]
    if(old){if(old.fingerprint!==fingerprint)throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED');return old.response}
    const link=requireRow((await c.query('SELECT * FROM experience_theme_links WHERE user_id=$1 AND experience_id=$2 AND theme_id=$3 FOR UPDATE',[user,experienceId,themeId])).rows[0])
    if(input.action==='revoke'&&link.status==='retired')return link
    const updated=(await c.query("UPDATE experience_theme_links SET confirmed=CASE WHEN $4='confirm' THEN true ELSE confirmed END, status=CASE WHEN $4='revoke' THEN 'retired' ELSE status END, revision=revision+1 WHERE user_id=$1 AND experience_id=$2 AND theme_id=$3 RETURNING *", [user,experienceId,themeId,input.action])).rows[0]
    await recordChangeEvent(c,user,{subjectType:'link',subjectId:experienceId+'->'+themeId,transition:input.action==='confirm'?'confirmed':'revoked',oldSnapshot:{status:link.status,confirmed:link.confirmed},newSnapshot:{status:updated.status,confirmed:updated.confirmed},reason:input.action==='confirm'?'用户确认这条连线成立':'用户撤销这条连线',sourceRefs:[{experienceId,themeId}],impact:input.action==='confirm'?'该关系进入可信已确认':'该关系退出所有决策与展示',userConfirmation:input.action==='confirm'?'confirmed':'rejected'})
    await c.query('INSERT INTO user_operations(user_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4)',[user,input.requestId,fingerprint,updated])
    return updated
  })
}

// 快照校验：生成（读取星图）与提交（finishRun）之间主题若被并发修改，
// 阻止保存并要求重试，绝不基于过期理解落盘。
export async function assertStarMapSnapshot(c: PoolClient, user: string, snapshot: { themes: { id: string; revision: number }[]; links: { experienceId: string; themeId: string; revision: number }[] }): Promise<void> {
  for (const entry of snapshot.themes ?? []) {
    const row = (await c.query('SELECT revision FROM user_themes WHERE user_id=$1 AND id=$2', [user, entry.id])).rows[0]
    if (!row || row.revision !== entry.revision) throw new HttpError(409, 'STARMAP_SNAPSHOT_INVALIDATED')
  }
  for (const entry of snapshot.links ?? []) {
    const row = (await c.query('SELECT revision FROM experience_theme_links WHERE user_id=$1 AND experience_id=$2 AND theme_id=$3', [user, entry.experienceId, entry.themeId])).rows[0]
    if (!row || row.revision !== entry.revision) throw new HttpError(409, 'STARMAP_SNAPSHOT_INVALIDATED')
  }
}

export async function claimAction(user:string,id:string,input:{requestId:string;action:'deny'|'correct'|'stop';text?:string}){
  return transaction(async c=>{
    await lock(c,user+':operation:'+input.requestId)
    const fingerprint=hash({id,...input})
    const old=(await c.query('SELECT * FROM user_operations WHERE user_id=$1 AND request_id=$2',[user,input.requestId])).rows[0]
    if(old){if(old.fingerprint!==fingerprint)throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED');return old.response}
    await identityClaimAction(c,user,id,input)
    await c.query('INSERT INTO user_operations(user_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4)',[user,input.requestId,fingerprint,{ok:true}])
    return {ok:true}
  })
}

export async function cognitionGraph(user:string) {
  const experiences=(await listExperiences(user)).filter(e=>e.status==='confirmed')
  const outcomeSources=(await pool.query("SELECT sources FROM growth_items WHERE user_id=$1 AND status='active'",[user])).rows
  const outcomeMessageIds=[...new Set<string>(outcomeSources.flatMap(row=>(row.sources??[]).filter((s:any)=>s.type==='message').map((s:any)=>String(s.id))))]
  const outcomeMessages=(await pool.query("SELECT m.id,m.content FROM messages m WHERE m.user_id=$1 AND m.id=ANY($2::uuid[]) AND m.role='user' AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE s.user_id=m.user_id AND s.source_message_id=m.id) ORDER BY m.created_at,m.id",[user,outcomeMessageIds])).rows
  // A short performed action can inherit identity from one earlier, explicit
  // personal contact intention in its own session, or an explicit prior-action
  // back-reference while memory is enabled. It remains identity context,
  // never proof of action or effect. Multiple intentions stay ambiguous.
  const contactIntentions=(await pool.query(`SELECT g.conversation_id,g.text,m.created_at FROM growth_items g
   JOIN messages m ON m.user_id=g.user_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(g.sources) s WHERE s->>'type'='message' AND s->>'id'=m.id::text)
   WHERE g.user_id=$1 AND g.kind IN ('goal','context') AND g.status='active' AND g.assertion='user_reported' AND m.role='user'
   AND EXISTS(SELECT 1 FROM user_memory_settings WHERE user_id=$1 AND enabled=true)
   AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE s.user_id=m.user_id AND s.source_message_id=m.id)
   AND NOT EXISTS(SELECT 1 FROM growth_source_suppressions s WHERE s.user_id=m.user_id AND s.message_id=m.id AND strpos(g.text,s.quote)>0)`,[user])).rows
  const identityEpisodes=experiences.map(episode=>{
   if(!/发了消息|发了邮件|发了封邮件/.test(episode.source_quote??'')||/(?:学长|学姐|导师|老师|客户|同学)[甲乙丙丁A-Z]/.test(episode.source_quote??''))return episode
   const contexts=contactIntentions.filter(g=>(g.conversation_id===episode.conversation_id||/按上次|上次那|之前说的/.test(episode.source_quote??''))&&g.created_at<=episode.created_at&&scanUserClauses(g.text).some(c=>!c.quoted&&!c.code&&!c.conditional&&!c.interrogative&&!c.attributedToOther&&/(?:想|打算|决定).{0,12}(?:请教|联系)|(?:想|打算|决定).{0,4}(?:向|给).{0,12}(?:请教|联系)/.test(c.text)&&/(?:学长|学姐|导师|老师|同学)[甲乙丙丁A-Z]/.test(c.text)))
   const localContexts=contexts.filter(g=>g.conversation_id===episode.conversation_id)
   const identityContexts=localContexts.length?localContexts:contexts
   return identityContexts.length===1?{...episode,identityOriginalQuote:episode.source_quote,source_quote:identityContexts[0].text.replace(/^(?:我|本人)/,'')}:episode
  })
  // 登录图的核心节点是“当前自我”+该用户自己的成长主题（最多三个，不足不
  // 强制）。固定三维度不再作为展示节点；experience_links 的 value 通道继续
  // 作为内部辅助分类写入，只是不出现在图上。
  const selfRow=seed.nodes.find(n=>n.type==='self')!
  // 中央“当前的我”三分组：用户认可的自述 / 正在探索的身份可能 / 有证据
  // 待核对的观察（当前 AI 观察不自动生成，组保持空白而非编造）。
  const claims=(await pool.query("SELECT id, text, origin, confirmed_by_user FROM identity_claims WHERE user_id=$1 AND status='active' ORDER BY updated_at DESC LIMIT 4",[user])).rows
  const accepted=claims.filter(c=>c.confirmed_by_user).map(c=>c.text)
  const observations=claims.filter(c=>!c.confirmed_by_user).map(c=>c.text)
  const skillTagList = await readSkillTags(pool, user)
  // Recorded tasks establish evidence about those tasks, not an identity level.
  const selfDescriptionParts=[...(accepted.length?[`我认可的自述：${accepted.join('；')}`]:[]),...(observations.length?[`待核对的观察：${observations.join('；')}`]:[]),...(skillTagList.length?[`本次任务涉及：${skillTagList.map(t=>t.tag).join('、')}；稳定能力仍未知`]:[])]
  const self={...selfRow,description:selfDescriptionParts.join('\n')||'当前还没有本人确认的自我描述。',identityAccepted:accepted,identityObservations:observations,skillTags:skillTagList} as any
  const changeEvents=(await pool.query("SELECT subject_type,subject_id,transition,reason,committed_at,user_confirmation,unknowns,old_snapshot FROM identity_change_events WHERE user_id=$1 ORDER BY committed_at DESC LIMIT 12",[user])).rows
  // Recency is not a user-confirmed priority. Read current source statements;
  // historical unstarted-status projections never become a current pursuit.
  const pausedThemeLabels=new Set((await readDirectionControls(user)).filter(control=>control.state==='paused').map(control=>{const label=directionScopeLabel(control.scope);return matchPathTheme(label)?.title??label}))
  const nodes=[self] as any[]
  const storedThemes=(await pool.query(`SELECT t.*,
    count(l.experience_id) FILTER (WHERE l.status='active')::int AS "linkedExperienceCount",
    count(l.experience_id) FILTER (WHERE l.status='active' AND l.confirmed=true)::int AS "confirmedExperienceCount"
    FROM user_themes t LEFT JOIN experience_theme_links l ON l.user_id=t.user_id AND l.theme_id=t.id
    WHERE t.user_id=$1 AND t.status IN ('active','pending')
    GROUP BY t.user_id,t.id`,[user])).rows
  const invalidThemeIds=new Set(storedThemes.filter(theme=>!themeHasPursuitSource(theme)).map(theme=>theme.id))
  const validThemes=storedThemes.filter(theme=>!invalidThemeIds.has(theme.id))
  const themes=rankPrimaryThemes(validThemes)
  const pursuitFacts=(await growthView(user)).items.filter(item=>item.status==='active'&&!item.unavailableReason&&!item.recommendationStopped)
  const starmapNextStep=themeNextStep(themes,pausedThemeLabels,pursuitFacts)
  const edges:any[]=[]
  const THEME_KIND_LABEL:Record<string,string>={goal:'目标',pursuit:'阶段追求',valued_point:'重视点',interest:'兴趣探索'}
  for(const theme of themes){
    const nodeId='theme-'+theme.id
    const effectiveThemeStatus=pausedThemeLabels.has(theme.title)?'paused':theme.status
    nodes.push({id:nodeId,type:'value',title:theme.title,description:`${THEME_KIND_LABEL[theme.kind]??theme.kind} · ${effectiveThemeStatus==='paused'?'已暂停推荐':effectiveThemeStatus==='pending'?'待核对':'进行中'}
${theme.summary}`,overviewOrder:nodes.length,themeId:theme.id,themeKind:theme.kind,themeStatus:theme.status,recommendationBoundary:pausedThemeLabels.has(theme.title)?'direction_paused':null,themePinned:theme.pinned,themeRevision:theme.revision,themeUpdatedAt:theme.updated_at.toISOString(),primaryKeywordReason:theme.primaryReason,media:[]} as any)
    // createGraph requires every value node to carry the self root link.
    edges.push({id:'has-'+theme.id,type:'HAS_VALUE',sourceId:self.id,targetId:nodeId,status:'confirmed_structure'} as any)
  }
  for(const e of experiences){
    const id='exp-'+e.id
    const taskOutcomes=taskOutcomeReadback('') as Record<string,any>
    for(const message of outcomeMessages){
      const taskIdentity=scanUserClauses(message.content).find(clause=>!clause.interrogative&&!clause.conditional&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&/(?:我|本人).{0,30}(?:请教|联系|发送|发了|交付|交给|访谈|聊过|问了|问过)/.test(clause.text))?.text??''
      const matches=identityEpisodes.filter(episode=>!timeContradiction(episode.identityOriginalQuote??episode.source_quote,message.content)&&findEpisode([episode],message.content,taskIdentity,''))
      if(message.id!==e.source_message_id&&(matches.length!==1||matches[0].id!==e.id))continue
      const authorizedQuotes=new Set<string>(outcomeSources.flatMap(row=>(row.sources??[]).filter((s:any)=>s.type==='message'&&s.id===message.id).map((s:any)=>String(s.quote))))
      for(const [key,outcome] of Object.entries(taskOutcomeReadback(message.content,authorizedQuotes)))if(outcome.status!=='unknown')taskOutcomes[key]={...outcome,sourceMessageId:message.id}
    }
    const expAction = String(e.content?.action ?? ''), expResult = String(e.content?.result ?? ''), expSummary = String(e.content?.summary ?? '')
    const expBlocked = isBlockedExperience(expAction, expResult, e.source_quote ?? '')
    const expExternal = isExternalFeedback(expResult, e.source_quote ?? '')
    const expSkills = extractSkillTags(expAction, expResult, expSummary)
    // 为每个经历节点生成洞察（零模型调用，基于已有数据）
    const expThemes = (await pool.query("SELECT t.title, l.relation FROM experience_theme_links l JOIN user_themes t ON t.user_id=l.user_id AND t.id=l.theme_id WHERE l.user_id=$1 AND l.experience_id=$2 AND l.status='active'", [user, e.id])).rows
    const expRelated = (await pool.query("SELECT e2.content->>'title' as title, er.score FROM experience_relations er JOIN experiences e2 ON e2.user_id=er.user_id AND e2.id=er.to_experience WHERE er.user_id=$1 AND er.from_experience=$2 AND NOT (er.relation='follows' AND er.reason='时间上先后发生') ORDER BY er.score DESC LIMIT 3", [user, e.id])).rows
    const expInsight = generateInsight({
      title: e.content.title, summary: expSummary, action: expAction, result: expResult,
      occurredAt: String(e.content?.occurredAt ?? ''), skillTags: expSkills,
      blocked: expBlocked, externalFeedback: expExternal,
      connectedThemes: expThemes.map(t => ({ title: t.title, relation: t.relation })),
      relatedExperiences: expRelated.map(r => ({ title: String(r.title ?? ''), score: Number(r.score) })),
      identityLevel: 0, identityName: '', nextIdentity: '', identityNextHint: '',
    })
    const outcomeKeys=applicableExperienceOutcomes({summary:expSummary,action:expAction,result:expResult,sourceQuote:String(e.source_quote??'')})
    const applicableTaskOutcomes=Object.fromEntries(outcomeKeys.map(key=>[key,taskOutcomes[key]]))
    const experienceSummary=summarizeExperience({summary:expSummary,action:expAction,result:expResult,reflection:String(e.content?.reflection??''),outcomes:applicableTaskOutcomes,applicableOutcomes:outcomeKeys})
    nodes.push({id,type:'experience',...e.content,title:e.content.title,contentStatus:e.confirm_source==='auto'?'auto_confirmed':'user_confirmed',evidenceStatus:'user_testimony',overviewOrder:nodes.length,media:[],serverId:e.id,serverRevision:e.revision,extractionSource:e.extraction_source??'model',conversationId:e.conversation_id,conversationTitle:e.conversation_title,sourceMessageId:e.source_message_id,blocked:expBlocked,externalFeedback:expExternal,taskOutcomes:applicableTaskOutcomes,outcomeKeys,skillTags:expSkills,insight:expInsight,experienceSummary} as any)
  }
  const themeLinks=(await pool.query("SELECT * FROM experience_theme_links WHERE user_id=$1 AND status='active'",[user])).rows
  const expRelations=(await pool.query("SELECT * FROM experience_relations WHERE user_id=$1 AND NOT (relation='follows' AND reason='时间上先后发生') ORDER BY created_at DESC LIMIT 10",[user])).rows
  const nodeIds=new Set(nodes.map(n=>n.id))
  for(const rel of expRelations){
    const sourceId='exp-'+rel.from_experience,targetId='exp-'+rel.to_experience
    if(!nodeIds.has(sourceId)||!nodeIds.has(targetId))continue
    edges.push({id:'exp-rel-'+rel.from_experience+'-'+rel.to_experience,type:'RELATES_TO_EXPERIENCE',sourceId,targetId,reason:rel.reason||rel.relation,status:rel.relation,sourceEvidence:[],confidence:rel.score,sourceEvidenceType:'experience_relation'} as any)
  }
  for(const link of themeLinks){
    const sourceId='exp-'+link.experience_id,targetId='theme-'+link.theme_id
    if(!nodeIds.has(sourceId)||!nodeIds.has(targetId))continue
    const experience=experiences.find(e=>e.id===link.experience_id)
    edges.push({id:'rel-'+link.experience_id+'-'+link.theme_id,type:'RELATES_TO_VALUE',sourceId,targetId,reason:link.reason,status:link.relation,sourceEvidence:experience?[experience.source_quote]:[],confirmed:link.confirmed,confidence:null} as any)
  }
  const valueOrder=themes.map(theme=>'theme-'+theme.id)
  return {...seed,purpose:'当前登录用户的成长星图：主题来自本人陈述的目标与追求',notice:'主题来自你亲口说的目标和追求，可置顶、重命名、暂缓或撤销；经历由对话自动收入，可随时修改或删除。',nodes,edges,
    viewConfig:{...seed.viewConfig,valueOrder,overviewExperienceOrder:experiences.map(e=>'exp-'+e.id)},storage:'postgresql',interpretationsAutomaticallyConfirmed:false,starmapNextStep,changeEvents:changeEvents.filter(event=>event.subject_type!=='theme'||!invalidThemeIds.has(event.subject_id)).map(event=>{
      const current=event.subject_type==='theme'?validThemes.find(x=>x.id===event.subject_id)?.title:event.subject_type==='experience'?experiences.find(x=>x.id===event.subject_id)?.content?.title:event.subject_type==='identity_claim'?claims.find(x=>x.id===event.subject_id)?.text:undefined
      return {subjectType:event.subject_type,transition:event.transition,reason:current?event.reason:'原记录已改变、结束或撤回，不再展示历史原话。',committedAt:event.committed_at,userConfirmation:event.user_confirmation,before:event.old_snapshot?'此前记录已被更新；历史原话不在此重新展示。':undefined,now:current?String(current):'这项记录当前不可用于建议。',unknowns:current?event.unknowns:''}
    })}
}
