import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, transaction, HttpError } from './db.ts'
import { validateId, type MemoryKey } from './contracts.ts'
import type {ActionCoachTurn} from './action-coach-contracts.ts'
import { requestsCrossExperienceReview, type DialogueTask, type ProfileFact } from './dialogue.ts'
import {rankConfirmedCoachExperiences} from './coach-retrieval.ts'
import { invalidateCoachSources } from './action-coach-events.ts'
import { growthQuoteSuppressed,redactExperienceResultSources,messageQuoteCorrected,filterAvailableExperienceSources,currentExperienceEvidence } from './growth-privacy.ts'
import {scanUserClauses} from './user-command-spans.ts'
import { derivePatternProposals } from './experience-patterns.ts'
import {fullMemorySuppressionSql,scopedMemorySuppressionKey,scopedMemorySuppressionKind} from './memory-suppression.ts'
import {selectedSourceRange,sourceQuoteRanges,uniqueSourceControlRange,type SourceControlRef} from './clause-catalogue.ts'

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const advisory=(c:PoolClient,key:string)=>c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key])
type Queryable=Pick<PoolClient,'query'>
export type MemorySettings={enabled:boolean;revision:number}
export type ConfirmedMemoryExperience={id:string;revision:number;content:any;conversationId:string;conversationTitle:string;sourceMessageId:string;quote:string}
export type MemorySnapshot={settings:MemorySettings;profile:ProfileFact[];writeProfile:ProfileFact[];confirmedExperiences:ConfirmedMemoryExperience[];suppressedMessageIds?:string[]}
export type MemoryChange={kind:'fact';key:MemoryKey;value:string|null;status:'active'|'unknown'|'declined';assertion:'user_reported';scope:'user'|'task';taskType:DialogueTask|null;taskInquiryId:string|null;taskConversationId:string|null;expectedMemoryId:string|null;expectedRevision:number;evidence:{messageId:string;quote:string;conversationId:string;range?:{start:number;end:number}}}
const userScopeKeys=new Set<MemoryKey>(['education.school','education.major','education.stage','skills'])
const safeMemoryValue=(value:string)=>!/(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|1[3-9]\d{9}|\d{17}[\dXx]|(?:sk|key|token|secret)[-_:=][A-Za-z0-9_-]{16,}|[A-Za-z0-9_-]{40,}|抑郁|双相|精神病|心理诊断|确诊|慢性病|残疾|性取向|同性恋|宗教信仰|政治立场|银行卡|银行账户|欠债|家庭暴力|性侵|犯罪记录)/i.test(value)
function memoryExpiry(key:MemoryKey,observedAt:Date){
  const days=key==='education.stage'?180:key==='skills'?365:key==='taskGoal'?90:['currentConcern','availableTime','taskConstraints','priorAttempts','optionsUnderConsideration'].includes(key)?30:null
  return days===null?null:new Date(observedAt.getTime()+days*86400000)
}
function parseSourceRefs(value:unknown):any[]{return Array.isArray(value)?value.filter(x=>x&&typeof x==='object'):[]}
export function patternSuppressionKey(value:unknown){
  const refs=parseSourceRefs(value).filter(ref=>ref.type==='experience').map(ref=>({experienceId:ref.experienceId,revision:ref.revision})).sort((a,b)=>String(a.experienceId).localeCompare(String(b.experienceId))||a.revision-b.revision)
  return 'pattern:'+hash(refs)
}
async function factMessageSource(c:Queryable,user:string,ref:any):Promise<{status:'valid';content:string;title:string;createdAt:Date}|{status:'revoked'|'invalid'}>{
  const source=(await c.query(`SELECT m.content,c.title,m.created_at FROM messages m JOIN conversations c ON c.user_id=m.user_id AND c.id=m.conversation_id
    WHERE m.user_id=$1 AND m.conversation_id=$2 AND m.id=$3 AND m.role='user'
      AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=m.user_id AND d.conversation_id=m.conversation_id)
      AND NOT EXISTS(SELECT 1 FROM memory_suppressions suppression WHERE suppression.user_id=m.user_id AND suppression.source_conversation_id=m.conversation_id AND suppression.source_message_id=m.id AND ${fullMemorySuppressionSql('suppression')})
      AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)`,[user,ref.conversationId,ref.messageId])).rows[0]
  if(!source){
    const retained=(await c.query("SELECT 1 FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role='user'",[user,ref.conversationId,ref.messageId])).rowCount!==0
    return {status:retained?'revoked':'invalid'}
  }
  if(typeof ref.quote!=='string'||!uniqueSourceControlRange(source.content,ref))return {status:'invalid'}
  if(await growthQuoteSuppressed(c,user,ref.messageId,ref.quote,source.content,ref.range)||await messageQuoteCorrected(c,user,ref.messageId,ref.quote,source.content,ref.range))return {status:'revoked'}
  return {status:'valid',content:source.content,title:source.title,createdAt:new Date(source.created_at)}
}
async function factSourceValid(user:string,row:any,c:Queryable=pool){
  const refs=parseSourceRefs(row.source_refs)
  if(!refs.length)return false
  for(const ref of refs){
    if(ref.type==='message'){
      if((await factMessageSource(c,user,ref)).status!=='valid')return false
    }else if(ref.type==='user_edit'){
      if(!(await c.query('SELECT 1 FROM user_operations WHERE user_id=$1 AND request_id=$2',[user,ref.requestId])).rowCount)return false
    }else return false
  }
  return true
}
function profileItem(row:any):ProfileFact{
  const source=parseSourceRefs(row.source_refs)[0]??{}
  return {id:row.id,key:row.key,value:row.value,scope:row.scope,taskType:row.task_type,taskInquiryId:row.task_inquiry_id??null,taskConversationId:row.task_conversation_id??null,observedAt:new Date(row.observed_at).toISOString(),validUntil:row.valid_until?new Date(row.valid_until).toISOString():null,revision:row.revision,status:row.status,source:{type:source.type==='user_edit'?'user_edit':'message',...(typeof source.conversationId==='string'?{conversationId:source.conversationId}:{}),...(typeof source.messageId==='string'?{messageId:source.messageId}:{}),...(typeof source.quote==='string'?{quote:source.quote}:{})}}
}
function freshProfile(rows:any[],now=Date.now()):ProfileFact[]{return rows.map(profileItem).map(item=>item.status==='active'&&item.validUntil&&Date.parse(item.validUntil)<=now?{...item,status:'stale' as const}:item)}

// Creation, display and acceptance share the current, authorized evidence.
// Original quotes remain in history; a versioned correction is the current
// testimony for that record, never permission to revive withdrawn sources.
export async function loadPatternEvidence(c: Pick<PoolClient, 'query'>, user: string, ids?: string[], locking = true) {
  ids = ids?.filter(id => { try { validateId(id); return true } catch { return false } })
  if (ids && !ids.length) return []
  const rows = (await c.query(`SELECT e.id,e.revision,e.conversation_id,e.source_message_id,e.source_quote,e.content,c.title AS conversation_title,
    ARRAY(SELECT l.value_id FROM experience_links l WHERE l.user_id=e.user_id AND l.experience_id=e.id AND l.disposition<>'rejected') AS value_ids
    FROM experiences e JOIN conversations c ON c.user_id=e.user_id AND c.id=e.conversation_id
    JOIN messages m ON m.user_id=e.user_id AND m.conversation_id=e.conversation_id AND m.id=e.source_message_id
    WHERE e.user_id=$1 AND e.status='confirmed' AND m.role='user' AND btrim(e.source_quote)<>'' AND strpos(m.content,e.source_quote)>0
      AND ($2::uuid[] IS NULL OR e.id=ANY($2::uuid[])) ORDER BY e.created_at DESC,e.id LIMIT $3 ${locking ? 'FOR SHARE OF e,m' : ''}`, [user, ids ?? null, ids ? ids.length : 64])).rows
  const available = await filterAvailableExperienceSources(c, user, await redactExperienceResultSources(c, user, rows))
  const usable = []
  for (const row of available) {
    if (!await growthQuoteSuppressed(c, user, row.source_message_id, row.source_quote)) usable.push(row)
  }
  return (await currentExperienceEvidence(c, user, usable)).map(row => ({
    ...row, quote: String(row.source_quote),
  }))
}

function currentPatternMeaning(item: any, evidence: Map<string, any>): boolean {
  // Historical user-reviewed interpretations without an automatic rule key
  // retain their existing source/revision validation.
  if (typeof item.value?.behaviorKey !== 'string') return true
  const sources = parseSourceRefs(item.source_refs).map(ref => evidence.get(ref.experienceId)).filter(Boolean)
  const proposals = derivePatternProposals(sources.map(row => ({
    id: row.id, revision: row.revision, conversationId: row.conversation_id, sourceMessageId: row.source_message_id,
    quote: row.quote, action: '', result: '', valueIds: row.value_ids ?? [],
  })))
  return proposals.some(proposal => proposal.behaviorKey === item.value.behaviorKey)
}

export async function loadSnapshot(user:string,conversation:string,query:string):Promise<MemorySnapshot>{
  try{
    const owner=(await pool.query('SELECT c.id FROM conversations c WHERE c.user_id=$1 AND c.id=$2 AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=c.user_id AND d.conversation_id=c.id)',[user,conversation])).rows[0]
    if(!owner)throw new HttpError(404,'NOT_FOUND')
    const settingsRow=(await pool.query('SELECT enabled,revision FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]
    const settings:MemorySettings=settingsRow?{enabled:settingsRow.enabled,revision:settingsRow.revision}:{enabled:false,revision:0}
    const [profileRows,suppressions,deletedSources,experienceRows]=await Promise.all([
      (async()=>settings.enabled?(await pool.query("SELECT * FROM memory_items WHERE user_id=$1 AND kind='fact' AND scope='user' AND status IN ('active','unknown','declined') ORDER BY updated_at DESC,id",[user])).rows:[])(),
      (async()=>(await pool.query(`SELECT source_message_id,key FROM memory_suppressions suppression WHERE user_id=$1 AND source_conversation_id=$2 AND ${fullMemorySuppressionSql('suppression')}`,[user,conversation])).rows)(),
      (async()=>{
        const rows=(await pool.query("SELECT e.source_message_id,m.content,jsonb_agg(e.source_quote) AS quotes FROM experiences e JOIN messages m ON m.user_id=e.user_id AND m.id=e.source_message_id WHERE e.user_id=$1 AND e.conversation_id=$2 AND e.status='deleted' GROUP BY e.source_message_id,m.content",[user,conversation])).rows
        const full=rows.filter(row=>scanUserClauses(row.content).every(clause=>row.quotes.some((quote:string)=>quote.includes(clause.text)))).map(row=>({source_message_id:row.source_message_id}))
        return [...full,...(await pool.query('SELECT message_id AS source_message_id FROM coach_source_withdrawals WHERE user_id=$1 AND conversation_id=$2',[user,conversation])).rows]
      })(),
      (async()=>(await pool.query("SELECT e.user_id,e.id,e.revision,e.content,e.conversation_id,e.source_message_id,e.source_quote,e.updated_at,c.title AS conversation_title FROM experiences e JOIN conversations c ON c.user_id=e.user_id AND c.id=e.conversation_id JOIN messages m ON m.user_id=e.user_id AND m.conversation_id=e.conversation_id AND m.id=e.source_message_id WHERE e.user_id=$1 AND ($2 OR e.conversation_id=$3) AND e.status='confirmed' AND m.role='user' AND btrim(e.source_quote)<>'' AND strpos(m.content,e.source_quote)>0 ORDER BY e.updated_at DESC,e.id",[user,settings.enabled,conversation])).rows)(),
    ])
    const checkedProfile=await Promise.all(profileRows.map(async row=>({row,valid:await factSourceValid(user,row)})))
    const writeProfile=freshProfile(checkedProfile.map(({row,valid})=>valid?row:{...row,status:'stale'}))
    const profile=writeProfile
    const usableExperiences=[]
    for(const row of await filterAvailableExperienceSources(pool,user,await redactExperienceResultSources(pool,user,experienceRows)))if(!await growthQuoteSuppressed(pool,user,row.source_message_id,row.source_quote))usableExperiences.push(row)
    const includePatternSources=requestsCrossExperienceReview(query)
    return {settings,profile,writeProfile,confirmedExperiences:(await rankConfirmedCoachExperiences(usableExperiences,includePatternSources?'':query,includePatternSources?6:4,{currentConversationId:conversation})).map(row=>({id:row.id,revision:row.revision,content:row.content,conversationId:row.conversation_id,conversationTitle:row.conversation_title,sourceMessageId:row.source_message_id,quote:row.content?.summary||row.source_quote})),suppressedMessageIds:[...new Set([...suppressions,...deletedSources].map(item=>String(item.source_message_id)))]}
  }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(503,'MEMORY_LOAD_FAILED',15)}
}
export async function getMemoryView(user:string,conversation?:string){
  return transaction(async c => {
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
  const settingsRow=(await c.query('SELECT enabled,revision,updated_at FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]
  const settings:MemorySettings=settingsRow?{enabled:settingsRow.enabled,revision:settingsRow.revision}:{enabled:false,revision:0}
  if(conversation&&!(await c.query('SELECT 1 FROM conversations source WHERE source.user_id=$1 AND source.id=$2 AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=source.user_id AND d.conversation_id=source.id)',[user,conversation])).rowCount)throw new HttpError(404,'NOT_FOUND')
  const rows=(await c.query("SELECT m.*,c.title AS source_conversation_title FROM memory_items m LEFT JOIN conversations c ON c.user_id=m.user_id AND c.id=NULLIF(m.source_refs->0->>'conversationId','')::uuid WHERE m.user_id=$1 AND ((m.kind='fact' AND m.status IN ('active','unknown','declined')) OR (m.kind='pattern_candidate' AND m.status IN ('pending','accepted','rejected','revoked'))) ORDER BY m.updated_at DESC,m.id LIMIT 100",[user])).rows
  const patternIds = [...new Set(rows.filter(row => row.kind === 'pattern_candidate').flatMap(row => parseSourceRefs(row.source_refs).filter(ref => ref.type === 'experience').map(ref => String(ref.experienceId))))]
  const patternEvidence = new Map((await loadPatternEvidence(c, user, patternIds, false)).map(row => [row.id, row]))
  const items=[]
  for(const row of rows){
    if (row.kind === 'pattern_candidate' && ['pending', 'accepted'].includes(row.status) && !currentPatternMeaning(row, patternEvidence)) continue
    const refs=parseSourceRefs(row.source_refs)
    const sources=[]
    let valid=true
    let growthForgotten=false
    for(const ref of refs){
      if(ref.type==='message'){
        const source=await factMessageSource(c,user,ref)
        if(source.status!=='valid'){
          if(source.status==='revoked')growthForgotten=true
          valid=false;break
        }
        sources.push({type:'message',conversationTitle:source.title,quote:ref.quote,observedAt:new Date(row.observed_at).toISOString()})
      }else if(ref.type==='user_edit'){
        const edit=(await c.query('SELECT 1 FROM user_operations WHERE user_id=$1 AND request_id=$2',[user,ref.requestId])).rowCount
        if(!edit){valid=false;break}
        sources.push({type:'user_edit',label:'你手动修改',observedAt:new Date(row.updated_at).toISOString()})
      }
      else if(ref.type==='experience'){
        const source = patternEvidence.get(ref.experienceId)
        if(!source||source.revision!==ref.revision||source.conversation_id!==ref.conversationId||source.source_message_id!==ref.messageId||source.quote!==ref.quote){valid=false;sources.length=0;break}
        sources.push({type:'experience',conversationTitle:source.conversation_title,quote:source.quote,experienceId:ref.experienceId,revision:ref.revision})
      }
    }
    if(growthForgotten)continue
    if(!valid&&row.kind==='fact')sources.length=0
    else if(!valid&&row.status!=='revoked')continue
    const expired=row.valid_until&&Date.parse(row.valid_until)<=Date.now()
    items.push({id:row.id,kind:row.kind,key:row.key,value:row.value,assertion:row.assertion,scope:row.scope,taskType:row.task_type,taskInquiryId:row.task_inquiry_id??null,taskConversationId:row.task_conversation_id??null,observedAt:new Date(row.observed_at).toISOString(),validFrom:row.valid_from?new Date(row.valid_from).toISOString():null,validUntil:row.valid_until?new Date(row.valid_until).toISOString():null,revision:row.revision,status:!valid&&row.kind==='fact'?'stale':expired&&row.status==='active'?'stale':row.status,sources,sourceValidity:valid?'valid':'changed'})
  }
  return {settings,items}
  })
}
export async function setMemorySettings(user:string,input:{requestId:string;enabled:boolean;expectedRevision:number}){
  return transaction(async c=>{
    await advisory(c,user+':memory-settings:'+input.requestId)
    await advisory(c,user+':memory-settings')
    const fingerprint=hash(input),old=(await c.query('SELECT fingerprint,response FROM user_operations WHERE user_id=$1 AND request_id=$2',[user,input.requestId])).rows[0]
    if(old){if(old.fingerprint!==fingerprint)throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED');return old.response}
    const current=(await c.query('SELECT enabled,revision FROM user_memory_settings WHERE user_id=$1 FOR UPDATE',[user])).rows[0]
    const revision=current?.revision??0
    if(revision!==input.expectedRevision)throw new HttpError(409,'MEMORY_REVISION_CONFLICT')
    const updated=(await c.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,revision=EXCLUDED.revision,updated_at=now() RETURNING enabled,revision',[user,input.enabled,revision+1])).rows[0]
    const response={enabled:updated.enabled,revision:updated.revision}
    await c.query('INSERT INTO user_operations(user_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4)',[user,input.requestId,fingerprint,response])
    return response
  })
}
export async function stageCoachBackground(user:string,conversation:string,currentMessageId:string,background:NonNullable<ActionCoachTurn['background']>,snapshot:MemorySnapshot):Promise<MemoryChange[]>{
  const source=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role='user'",[user,conversation,currentMessageId])).rows[0]
  if(!source)throw new HttpError(400,'COACH_BACKGROUND_INVALID')
  const unique=new Map<MemoryKey,{fact:typeof background[number];range:{start:number;end:number}}>()
  for(const fact of background){
    const ranges=sourceQuoteRanges(source.content,fact.source.quote),selected=selectedSourceRange(fact.source)
    const range=selected?ranges.find(range=>range.start===selected.start&&range.end===selected.end):ranges.length===1?ranges[0]:undefined
    if(!userScopeKeys.has(fact.key)||fact.source.messageId!==currentMessageId||!fact.source.quote.trim()||!range||!fact.source.quote.includes(fact.value)||!safeMemoryValue(fact.value))throw new HttpError(400,'COACH_BACKGROUND_INVALID')
    const previous=unique.get(fact.key)
    if(previous&&previous.fact.value!==fact.value)throw new HttpError(400,'COACH_BACKGROUND_INVALID')
    // The model supplies a clause handle; only the server-owned exact range can
    // disambiguate repeated text. A bare duplicate literal fails closed.
    unique.set(fact.key,{fact,range})
  }
  if(!snapshot.settings.enabled)return []
  return [...unique.values()].map(({fact,range})=>{
    const old=snapshot.writeProfile.find(item=>item.key===fact.key&&item.scope==='user'&&item.taskType===null)
    return {kind:'fact',key:fact.key,value:fact.value,status:'active',assertion:'user_reported',scope:'user',taskType:null,taskInquiryId:null,taskConversationId:null,expectedMemoryId:old?.id??null,expectedRevision:old?.revision??0,evidence:{...fact.source,conversationId:conversation,range}}
  })
}
export async function assertMemoryEvidence(user:string,id:string,revision:number,enabled:boolean){
  if(!enabled)throw new HttpError(400,'MEMORY_CITATION_NOT_ALLOWED')
  const row=(await pool.query("SELECT value,revision,status,kind,source_refs FROM memory_items WHERE user_id=$1 AND id=$2",[user,id])).rows[0]
  if(!row||row.kind!=='fact'||row.status!=='active'||row.revision!==revision)throw new HttpError(400,'MEMORY_EVIDENCE_STALE')
  if(!await factSourceValid(user,row))throw new HttpError(400,'MEMORY_EVIDENCE_STALE')
  return row.value
}
function itemSnapshot(item:any){return {kind:item.kind,key:item.key,value:item.value,assertion:item.assertion,scope:item.scope,taskType:item.task_type,sourceRefs:item.source_refs,observedAt:item.observed_at,validFrom:item.valid_from,validUntil:item.valid_until,status:item.status,revision:item.revision}}
async function revision(c:PoolClient,user:string,item:any,action:string,sourceCorrections?:SourceControlRef[],sourceControls?:SourceControlRef[]){await c.query('INSERT INTO memory_revisions(user_id,memory_item_id,revision,action,snapshot) VALUES($1,$2,$3,$4,$5)',[user,item.id,item.revision,action,{...itemSnapshot(item),...(sourceCorrections?{sourceCorrections}:{}),...(sourceControls?.length?{sourceControls:sourceControls.flatMap(ref=>ref.range?[{messageId:ref.messageId,range:ref.range}]:[])}:{})}])}
export async function persistChanges(c:PoolClient,user:string,conversation:string,changes:MemoryChange[],now:Date){
  const saved:string[]=[],facts=changes.filter((x):x is MemoryChange=>x.kind==='fact')
  for(const change of facts){
    const suppressed=await c.query('SELECT 1 FROM memory_suppressions WHERE user_id=$1 AND source_conversation_id=$2 AND source_message_id=$3 AND key=$4',[user,change.evidence.conversationId,change.evidence.messageId,change.key])
    if(suppressed.rowCount)continue
    const source=await factMessageSource(c,user,{conversationId:change.evidence.conversationId,messageId:change.evidence.messageId,quote:change.evidence.quote,...(change.evidence.range?{range:change.evidence.range}:{})})
    if(source.status!=='valid')throw new HttpError(409,'MEMORY_SOURCE_CHANGED')
    const observedAt=source.createdAt
    const taskType=change.taskType??null
    const taskInquiryId=change.scope==='task'?change.taskInquiryId:null
    const taskConversationId=change.scope==='task'?(change.taskConversationId??(taskInquiryId?null:conversation)):null
    const old=(await c.query('SELECT * FROM memory_items WHERE user_id=$1 AND kind=\'fact\' AND key=$2 AND task_type IS NOT DISTINCT FROM $3 AND task_inquiry_id IS NOT DISTINCT FROM $4 AND task_conversation_id IS NOT DISTINCT FROM $5 AND status IN (\'active\',\'unknown\',\'declined\') FOR UPDATE',[user,change.key,taskType,taskInquiryId,taskConversationId])).rows[0]
    if((old?.id??null)!==change.expectedMemoryId||(old?.revision??0)!==change.expectedRevision)throw new HttpError(409,'MEMORY_REVISION_CONFLICT')
    if(old&&new Date(old.observed_at).getTime()>observedAt.getTime())continue
    if(old&&old.status===change.status&&JSON.stringify(old.value??null)===JSON.stringify(change.value??null)&&change.key!=='education.stage')continue
    if(old){const superseded={...old,status:'superseded',revision:old.revision+1,updated_at:now};await c.query("UPDATE memory_items SET status='superseded',revision=$3,updated_at=$4 WHERE user_id=$1 AND id=$2",[user,old.id,superseded.revision,now]);await revision(c,user,superseded,'supersede')}
    const id=randomUUID(),validUntil=change.status==='active'?memoryExpiry(change.key,observedAt):null
    const inserted=(await c.query('INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,task_type,task_inquiry_id,task_conversation_id,source_refs,observed_at,valid_from,valid_until,status) VALUES($1,$2,\'fact\',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',[id,user,change.key,JSON.stringify(change.value),change.assertion,change.scope,taskType,taskInquiryId,taskConversationId,JSON.stringify([{type:'message',conversationId:change.evidence.conversationId,messageId:change.evidence.messageId,quote:change.evidence.quote,...(change.evidence.range?{range:change.evidence.range}:{})}]),observedAt,observedAt,validUntil,change.status])).rows[0]
    await revision(c,user,inserted,'create');saved.push(id)
  }
  return saved
}
export async function assertSnapshotStillValid(c:PoolClient,user:string,snapshot:MemorySnapshot,usedMemoryRefs:{memoryId:string;revision:number}[]){
  await advisory(c,user+':memory-settings')
  const current=(await c.query('SELECT enabled,revision FROM user_memory_settings WHERE user_id=$1 FOR UPDATE',[user])).rows[0]
  const enabled=current?.enabled??false,revisionNow=current?.revision??0
  if(enabled!==snapshot.settings.enabled||revisionNow!==snapshot.settings.revision)throw new HttpError(409,'MEMORY_SNAPSHOT_INVALIDATED')
  for(const ref of usedMemoryRefs){
    const row=(await c.query("SELECT revision,status,kind,source_refs FROM memory_items WHERE user_id=$1 AND id=$2 FOR UPDATE",[user,ref.memoryId])).rows[0]
    if(!row||row.revision!==ref.revision||row.status!=='active'||row.kind!=='fact')throw new HttpError(409,'MEMORY_SNAPSHOT_INVALIDATED')
    if(!await factSourceValid(user,row,c))throw new HttpError(409,'MEMORY_SNAPSHOT_INVALIDATED')
  }
}
type ForgetSourceControls={scoped:SourceControlRef[];fullMessageIds:string[]}
async function addForgetSuppressions(c:PoolClient,user:string,row:any):Promise<ForgetSourceControls>{
  const refs=[...parseSourceRefs(row.source_refs)]
  const history=(await c.query('SELECT snapshot FROM memory_revisions WHERE user_id=$1 AND memory_item_id=$2',[user,row.id])).rows
  for(const entry of history)refs.push(...parseSourceRefs(entry.snapshot?.sourceRefs??entry.snapshot?.source_refs))
  const grouped=new Map<string,{conversationId:string;messageId:string;refs:any[]}>()
  for(const ref of refs){
    if(!((ref.type==='message'||row.kind==='pattern_candidate'&&ref.type==='experience')&&ref.conversationId&&ref.messageId))continue
    const id=`${ref.conversationId}:${ref.messageId}`,group=grouped.get(id)??{conversationId:ref.conversationId,messageId:ref.messageId,refs:[] as any[]}
    group.refs.push(ref);grouped.set(id,group)
  }
  const key=row.kind==='pattern_candidate'
    ? typeof row.value?.behaviorKey === 'string' ? 'pattern:behavior:' + row.value.behaviorKey : patternSuppressionKey(row.source_refs)
    : row.key
  const result:ForgetSourceControls={scoped:[],fullMessageIds:[]}
  for(const group of grouped.values()){
    const inserted=await c.query('INSERT INTO memory_suppressions(user_id,source_conversation_id,source_message_id,key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING 1',[user,group.conversationId,group.messageId,key])
    if(row.kind!=='fact')continue
    const marker=scopedMemorySuppressionKey(key)
    const existingScoped=(await c.query('SELECT 1 FROM memory_suppressions WHERE user_id=$1 AND source_conversation_id=$2 AND source_message_id=$3 AND key=$4 AND suppression_kind=$5',[user,group.conversationId,group.messageId,marker,scopedMemorySuppressionKind])).rowCount!==0
    if(!inserted.rowCount&&!existingScoped){result.fullMessageIds.push(group.messageId);continue}
    const source=(await c.query("SELECT content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role='user'",[user,group.conversationId,group.messageId])).rows[0]
    const controls=group.refs.map(ref=>{
      const quote=typeof ref.quote==='string'?ref.quote:''
      const suppliedRange=ref.range!==undefined
      const range=ref.range&&Number.isSafeInteger(ref.range.start)&&Number.isSafeInteger(ref.range.end)&&ref.range.start>=0&&ref.range.end>ref.range.start&&ref.range.end-ref.range.start===quote.length?{start:ref.range.start,end:ref.range.end}:undefined
      if(suppliedRange&&!range)return null
      const anchored=Boolean(source&&uniqueSourceControlRange(source.content,{quote,...(suppliedRange?{range:ref.range}:{})}))
      if(!quote.trim()||quote.length>8000||!anchored)return null
      return {messageId:group.messageId,quote,...(range?{range}:{})} as SourceControlRef
    })
    if(!controls.length||controls.some(control=>control===null)){
      if(existingScoped)await c.query('DELETE FROM memory_suppressions WHERE user_id=$1 AND source_conversation_id=$2 AND source_message_id=$3 AND key=$4 AND suppression_kind=$5',[user,group.conversationId,group.messageId,marker,scopedMemorySuppressionKind])
      result.fullMessageIds.push(group.messageId);continue
    }
    for(const control of new Map(controls.map(control=>[JSON.stringify(control),control!] as const)).values()){
      if(!control.range)await c.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[user,group.conversationId,group.messageId,control.quote])
      result.scoped.push(control)
    }
    if(inserted.rowCount)await c.query('INSERT INTO memory_suppressions(user_id,source_conversation_id,source_message_id,key,suppression_kind) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[user,group.conversationId,group.messageId,marker,scopedMemorySuppressionKind])
  }
  return result
}
export async function applyMemoryAction(user:string,id:string,input:{requestId:string;expectedRevision:number;action:'correct'|'forget'|'accept'|'reject';value?:string}){
  return transaction(async c=>{
    await advisory(c,user+':operation:'+input.requestId)
    await advisory(c,user+':memory-settings')
    const fingerprint=hash({id,...input}),oldOperation=(await c.query('SELECT fingerprint,response FROM user_operations WHERE user_id=$1 AND request_id=$2',[user,input.requestId])).rows[0]
    if(oldOperation){if(oldOperation.fingerprint!==fingerprint)throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED');return oldOperation.response}
    // Correct/forget can add a suppression or source withdrawal used by the
    // raw interview chronology predicate. Lock before the memory row so the
    // finishRun order remains memory-settings -> chronology -> item rows.
    if(input.action==='correct'||input.action==='forget'){
      await advisory(c,'growth:'+user)
      await advisory(c,user+':interview-chronology')
    }
    const item=(await c.query('SELECT * FROM memory_items WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,id])).rows[0]
    if(!item||item.status==='revoked'||item.status==='superseded')throw new HttpError(404,'NOT_FOUND')
    if(item.revision!==input.expectedRevision)throw new HttpError(409,'MEMORY_REVISION_CONFLICT')
    if(input.action!=='correct'&&input.value!==undefined)throw new HttpError(400,'UNEXPECTED_VALUE')
    let response:any
    if(input.action==='correct'){
      if(item.kind!=='fact'||typeof input.value!=='string'||!input.value.trim()||!safeMemoryValue(input.value))throw new HttpError(400,'MEMORY_VALUE_REJECTED')
      const sourceCorrections=parseSourceRefs(item.source_refs).filter(ref=>ref.type==='message'&&typeof ref.quote==='string').map(ref=>({messageId:ref.messageId,quote:ref.quote,...(ref.range?{range:ref.range}:{})}))
      const now=new Date(),refs=[{type:'user_edit',requestId:input.requestId,quote:input.value.trim()}]
      const updated=(await c.query("UPDATE memory_items SET value=$3,assertion='user_edit',source_refs=$4,status='active',observed_at=$5::timestamptz,valid_from=$5::timestamptz,valid_until=CASE WHEN key='education.stage' THEN $5::timestamptz+interval '180 days' WHEN key='skills' THEN $5::timestamptz+interval '365 days' WHEN key IN ('currentConcern','availableTime','taskConstraints','priorAttempts','optionsUnderConsideration') THEN $5::timestamptz+interval '30 days' WHEN key='taskGoal' THEN $5::timestamptz+interval '90 days' ELSE NULL END,revision=revision+1,updated_at=$5::timestamptz WHERE user_id=$1 AND id=$2 RETURNING *",[user,id,JSON.stringify(input.value.trim()),JSON.stringify(refs),now])).rows[0]
      await revision(c,user,updated,'correct',sourceCorrections);response={id:updated.id,revision:updated.revision,status:updated.status}
      await invalidateCoachSources(c,user,sourceCorrections.map(ref=>ref.messageId),false,true,sourceCorrections)
    }else if(input.action==='forget'){
      const targets=item.kind==='fact'?(await c.query("SELECT * FROM memory_items WHERE user_id=$1 AND kind='fact' AND key IS NOT DISTINCT FROM $2 AND task_type IS NOT DISTINCT FROM $3 AND task_inquiry_id IS NOT DISTINCT FROM $4 AND task_conversation_id IS NOT DISTINCT FROM $5 AND status IN ('active','unknown','declined','superseded') FOR UPDATE",[user,item.key,item.task_type,item.task_inquiry_id??null,item.task_conversation_id??null])).rows:[item]
      const scoped:SourceControlRef[]=[],fullMessageIds:string[]=[]
      for(const target of targets){
        const controls=await addForgetSuppressions(c,user,target);scoped.push(...controls.scoped);fullMessageIds.push(...controls.fullMessageIds)
        await c.query("UPDATE memory_revisions SET snapshot=jsonb_build_object('key',$3::text,'forgotten',true) WHERE user_id=$1 AND memory_item_id=$2",[user,target.id,target.key])
        const updated=(await c.query("UPDATE memory_items SET value=NULL,source_refs='[]'::jsonb,status='revoked',revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *",[user,target.id])).rows[0]
        await revision(c,user,updated,'forget',undefined,controls.scoped)
        if(target.id===id)response={id:updated.id,revision:updated.revision,status:updated.status}
      }
      const full=[...new Set(fullMessageIds)]
      const exact=[...new Map(scoped.filter(ref=>!full.includes(ref.messageId)).map(ref=>[JSON.stringify(ref),ref])).values()]
      if(full.length)await invalidateCoachSources(c,user,full,true)
      if(exact.length)await invalidateCoachSources(c,user,[...new Set(exact.map(ref=>ref.messageId))],true,true,exact)
    }else{
      if(item.kind!=='pattern_candidate'||item.status!=='pending')throw new HttpError(409,'PATTERN_NOT_PENDING')
      if(input.action==='accept'){
        const refs=parseSourceRefs(item.source_refs)
        if(refs.length<2||refs.some(ref=>ref.type!=='experience')||new Set(refs.map(ref=>ref.experienceId)).size<2)throw new HttpError(409,'PATTERN_SOURCES_CHANGED')
        const quotes=new Set<string>()
        const available = new Map((await loadPatternEvidence(c, user, refs.map(ref => ref.experienceId))).map(row => [row.id, row]))
        if (!currentPatternMeaning(item, available)) throw new HttpError(409, 'PATTERN_SOURCES_CHANGED')
        for(const ref of refs){
          const source=available.get(ref.experienceId)
          if(!source||source.revision!==ref.revision||source.conversation_id!==ref.conversationId||source.source_message_id!==ref.messageId||source.quote!==ref.quote)throw new HttpError(409,'PATTERN_SOURCES_CHANGED')
          quotes.add(ref.quote.trim().toLocaleLowerCase())
        }
        if(quotes.size<2)throw new HttpError(409,'PATTERN_SOURCES_CHANGED')
      }
      const status=input.action==='accept'?'accepted':'rejected'
      if(input.action==='reject')await addForgetSuppressions(c,user,item)
      const updated=(await c.query('UPDATE memory_items SET status=$3,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *',[user,id,status])).rows[0]
      await revision(c,user,updated,input.action);response={id:updated.id,revision:updated.revision,status:updated.status}
    }
    await c.query('INSERT INTO user_operations(user_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4)',[user,input.requestId,fingerprint,response])
    return response
  })
}
export async function invalidatePatternsForExperience(c:PoolClient,user:string,experienceId:string){
  const rows=(await c.query("SELECT * FROM memory_items WHERE user_id=$1 AND kind='pattern_candidate' AND status IN ('pending','accepted') AND source_refs @> $2::jsonb FOR UPDATE",[user,JSON.stringify([{experienceId}])])).rows
  for(const row of rows){const updated=(await c.query("UPDATE memory_items SET status='revoked',revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *",[user,row.id])).rows[0];await revision(c,user,updated,'invalidate')}
}
