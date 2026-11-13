import { pool, transaction, HttpError, requireRow } from './db.ts'
import {createHash} from 'node:crypto'
import { coachEventView, readCoachEvent, coachEventSourceIdsSql,coachSourceControlKey,type CoachEvent } from './action-coach-events.ts'
import { localEmbedding, embeddingSignature } from './local-embedding.ts'
import {readExperienceVectors,writeExperienceVectors} from './experience-vector-cache.ts'
import {coachSourceBoundaryRefs,sourceBoundaryKey} from './growth-privacy.ts'
import {continuesDecisionContext,compileDecisionConditions,actualDecisionConditionText} from './decision-comparison.ts'

export type EventSearch={query:string;eventId?:string;actionId?:string;object?:string;after?:string;before?:string}
type Encode=(texts:string[],query?:boolean,signal?:AbortSignal)=>Promise<number[][]>

type ExperienceVectorCacheEntry={vectors:number[][]}
// Existing index storage can bind the current source boundary without a new
// table or a global rebuild. Unaffected events retain their existing signature.
const coachSourceIdsSql=coachEventSourceIdsSql
function coachIndexSignature(sourceIds:(string|null)[],refs:{messageId:string;quote:string}[]){
 const key=sourceBoundaryKey(sourceIds,refs)
 return key?embeddingSignature+':'+key:embeddingSignature
}
const experienceVectorCache=new Map<string,ExperienceVectorCacheEntry>()
const EXPERIENCE_VECTOR_CACHE_MAX=2048
export type ExperienceRankOptions={currentConversationId?:string;now?:number;encode?:Encode;cacheDirectory?:string}

export function clearExperienceVectorCache(){experienceVectorCache.clear()}
export function experienceVectorCacheStats(){return {entries:experienceVectorCache.size,limit:EXPERIENCE_VECTOR_CACHE_MAX,signature:embeddingSignature}}
function experienceCacheKey(row:any){
  if(typeof row?.id!=='string'||!Number.isInteger(row?.revision))return null
  const sourceAndContent=createHash('sha256').update(JSON.stringify([row.source_message_id??null,row.source_quote??null,row.content??null])).digest('hex')
  return `${embeddingSignature}:${row.user_id??''}:${row.id}:${row.revision}:${sourceAndContent}`
}
function cachedExperienceVectors(key:string){
  const hit=experienceVectorCache.get(key)
  if(!hit)return null
  experienceVectorCache.delete(key);experienceVectorCache.set(key,hit)
  return hit.vectors
}
function saveExperienceVectors(key:string,vectors:number[][]){
  experienceVectorCache.delete(key);experienceVectorCache.set(key,{vectors})
  while(experienceVectorCache.size>EXPERIENCE_VECTOR_CACHE_MAX)experienceVectorCache.delete(experienceVectorCache.keys().next().value!)
}

// Confirmed experiences have already passed the user's importance/consent gate.
// Retrieval therefore combines semantic relevance with a small, bounded boost
// for recency and continuity of the matter currently being discussed. Relevance
// stays dominant so a recent unrelated episode cannot hide a direct older match.
export function rankExperienceCandidates<T extends {id:unknown;conversation_id?:unknown;updated_at?:unknown}>(rows:T[],semanticScores:number[],options:ExperienceRankOptions={}){
  const now=options.now??Date.now(),halfLifeDays=90,day=86_400_000
  return rows.map((row,index)=>{
    const observed=typeof row.updated_at==='string'||row.updated_at instanceof Date?Date.parse(String(row.updated_at)):NaN
    const recency=Number.isFinite(observed)?Math.exp(-Math.max(0,now-observed)/day*Math.LN2/halfLifeDays):0
    const continuity=options.currentConversationId!==undefined&&row.conversation_id===options.currentConversationId?1:0
    return {row,score:(semanticScores[index]??-Infinity)+0.08*recency+0.08*continuity}
  }).sort((a,b)=>b.score-a.score||String(a.row.id).localeCompare(String(b.row.id))).map(item=>item.row)
}

// The caller supplies only owner/grant/source-validated confirmed records.
// This shares the existing offline encoder and retains complete fields.
export async function rankConfirmedCoachExperiences(rows:any[],query:string,limit=4,options:ExperienceRankOptions={}){
  if(!rows.length)return []
  if(!query.trim())return rows.slice(0,limit)
  const encode=options.encode??localEmbedding.encode.bind(localEmbedding)
  const vector=(await encode([query],true))[0]
  const rowParts=rows.map(row=>[...new Set([row.content?.summary,row.content?.action,row.content?.result,row.content?.reflection].filter(value=>typeof value==='string'&&value.trim()))] as string[])
  const scores=new Map<number,number>()
  const misses:{rowIndex:number;texts:string[];key:string|null}[]=[]
  const directory=options.cacheDirectory??process.env.LIFEOS_EXPERIENCE_VECTOR_CACHE_DIR
  for(const [rowIndex,row] of rows.entries()){
    const key=experienceCacheKey(row),persistentDirectory=typeof row.user_id==='string'?directory:undefined
    const cached=key?(cachedExperienceVectors(key)??await readExperienceVectors(persistentDirectory,key)):null
    if(cached&&cached.length===rowParts[rowIndex]!.length){
      if(key)saveExperienceVectors(key,cached)
      for(const embedding of cached){const score=embedding.reduce((sum,value,dimension)=>sum+value*vector[dimension],0);scores.set(rowIndex,Math.max(scores.get(rowIndex)??-Infinity,score))}
    }else misses.push({rowIndex,texts:rowParts[rowIndex]!,key})
  }
  const flat=misses.flatMap(miss=>miss.texts.map((text,partIndex)=>({text,partIndex,...miss})))
  const encodedByRow=new Map<number,number[][]>()
  for(let start=0;start<flat.length;start+=32){
    const batch=flat.slice(start,start+32),encoded=await encode(batch.map(part=>part.text))
    batch.forEach((part,index)=>{
      const embedding=encoded[index]!,score=embedding.reduce((sum,value,dimension)=>sum+value*vector[dimension],0)
      scores.set(part.rowIndex,Math.max(scores.get(part.rowIndex)??-Infinity,score))
      const vectors=encodedByRow.get(part.rowIndex)??[];vectors[part.partIndex]=embedding;encodedByRow.set(part.rowIndex,vectors)
    })
  }
  for(const miss of misses)if(miss.key&&encodedByRow.get(miss.rowIndex)?.length===miss.texts.length){
    const vectors=encodedByRow.get(miss.rowIndex)!;saveExperienceVectors(miss.key,vectors)
    await writeExperienceVectors(typeof rows[miss.rowIndex]?.user_id==='string'?directory:undefined,miss.key,vectors)
  }
  return rankExperienceCandidates(rows,rows.map((_,index)=>scores.get(index)??-Infinity),options).slice(0,limit)
}

// Jobs contain only identity/version. User text is read afresh and encoded locally.
export async function indexCoachEventOnce(encode:Encode=localEmbedding.encode.bind(localEmbedding)){
  const job=await transaction(async c=>{
    const row=(await c.query("SELECT * FROM coach_index_jobs WHERE status='pending' OR (status='processing' AND locked_at<now()-interval '5 minutes') ORDER BY attempts,event_id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0]
    if(row)await c.query("UPDATE coach_index_jobs SET status='processing',attempts=attempts+1,locked_at=now() WHERE user_id=$1 AND event_id=$2 AND revision=$3 AND generation=$4",[row.user_id,row.event_id,row.revision,row.generation])
    return row
  })
  if(!job)return false
  const keys=[job.user_id,job.event_id,job.revision,job.generation]
  try{
    const row=(await pool.query(`SELECT e.conversation_id,${coachSourceIdsSql} AS source_ids FROM coach_events e WHERE e.user_id=$1 AND e.id=$2`,[job.user_id,job.event_id])).rows[0]
    const event=row?await coachEventView(job.user_id,row.conversation_id,job.event_id):null
    if(!event||event.revision!==job.revision||event.generation!==job.generation){await pool.query('DELETE FROM coach_index_jobs WHERE user_id=$1 AND event_id=$2 AND revision=$3 AND generation=$4',keys);return true}
    const signature=coachIndexSignature(row.source_ids,await coachSourceBoundaryRefs(pool,job.user_id))
    const texts=[event.title,...event.nodes.filter(node=>node.source).map(node=>node.content)]
    const vectors:number[][]=[]
    for(let i=0;i<texts.length;i+=32)vectors.push(...await encode(texts.slice(i,i+32)))
    await transaction(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[job.user_id+':memory-settings'])
      const latest=(await c.query("SELECT * FROM coach_events WHERE user_id=$1 AND id=$2 AND status='active' FOR UPDATE",keys.slice(0,2))).rows[0]
      const liveJob=(await c.query('SELECT 1 FROM coach_index_jobs WHERE user_id=$1 AND event_id=$2 AND revision=$3 AND generation=$4',keys)).rowCount
      if(!liveJob||!latest||latest.revision!==job.revision||latest.generation!==job.generation)return
      await readCoachEvent(c,job.user_id,latest.conversation_id,job.event_id) // sources may have been withdrawn during encoding
      const live=(await c.query(`SELECT ${coachSourceIdsSql} AS source_ids FROM coach_events e WHERE e.user_id=$1 AND e.id=$2`,keys.slice(0,2))).rows[0]
      if(coachIndexSignature(live.source_ids,await coachSourceBoundaryRefs(c,job.user_id))!==signature){
        await c.query("UPDATE coach_index_jobs SET status='pending',locked_at=NULL,attempts=greatest(attempts-1,0) WHERE user_id=$1 AND event_id=$2 AND revision=$3 AND generation=$4",keys)
        return
      }
      await c.query('DELETE FROM coach_semantic_index WHERE user_id=$1 AND event_id=$2',keys.slice(0,2))
      for(let part=0;part<vectors.length;part++)await c.query('INSERT INTO coach_semantic_index(user_id,event_id,revision,generation,signature,part,embedding) VALUES($1,$2,$3,$4,$5,$6,$7)',[...keys,signature,part,vectors[part]])
      await c.query('DELETE FROM coach_index_jobs WHERE user_id=$1 AND event_id=$2 AND revision=$3 AND generation=$4',keys)
    })
  }catch(error){
    if(error instanceof HttpError&&['NOT_FOUND','COACH_SOURCE_REVOKED'].includes(error.code))await pool.query('DELETE FROM coach_index_jobs WHERE user_id=$1 AND event_id=$2 AND revision=$3 AND generation=$4',keys)
    else if(error instanceof HttpError&&error.code==='CANCELLED')await pool.query("UPDATE coach_index_jobs SET status='pending',attempts=greatest(attempts-1,0),locked_at=NULL WHERE user_id=$1 AND event_id=$2 AND revision=$3 AND generation=$4",keys)
    else await pool.query("UPDATE coach_index_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,locked_at=NULL WHERE user_id=$1 AND event_id=$2 AND revision=$3 AND generation=$4",keys)
    throw error
  }
  return true
}

export async function searchCoachEvents(user:string,conversation:string,input:EventSearch,signal?:AbortSignal):Promise<{events:CoachEvent[];ambiguous:boolean;indexPending:number}>{
  signal?.throwIfAborted()
  requireRow((await pool.query('SELECT 1 FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0])
  if([input.after,input.before].some(date=>date!==undefined&&!Number.isFinite(Date.parse(date))))throw new HttpError(400,'RETRIEVAL_DATE_INVALID')
  if(input.query.length>16000)throw new HttpError(400,'RETRIEVAL_INPUT_LIMIT')
  // An empty owner event corpus cannot yield a semantic match. Avoid encoding
  // a potentially long query just to discover zero rows. Any active event,
  // including one awaiting indexing, retains the existing guarded search.
  const semanticQuery=Boolean(input.query.trim()&&!input.eventId&&!input.actionId)
  if(semanticQuery&&!(await pool.query("SELECT 1 FROM coach_events WHERE user_id=$1 AND status='active' LIMIT 1",[user])).rowCount){
    signal?.throwIfAborted()
    return {events:[],ambiguous:false,indexPending:0}
  }
  const vector=semanticQuery?(await localEmbedding.encode([input.query],true,signal))[0]:null
  return transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])
    requireRow((await c.query('SELECT 1 FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0])
    const enabled=(await c.query('SELECT enabled FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]?.enabled===true
    const rows=(await c.query(`SELECT e.id,e.revision,e.generation,e.created_at,e.updated_at,e.title,e.title_source,${coachSourceIdsSql} AS source_ids,
      i.embedding,i.signature FROM coach_events e LEFT JOIN coach_semantic_index i ON i.user_id=e.user_id AND i.event_id=e.id
      AND i.revision=e.revision AND i.generation=e.generation AND $3::text<>''
      WHERE e.user_id=$1 AND e.status='active' AND ($4::boolean OR e.conversation_id=$2)
      AND ($5::uuid IS NULL OR e.id=$5) AND ($6::uuid IS NULL OR EXISTS(SELECT 1 FROM coach_actions a WHERE a.user_id=e.user_id AND a.event_id=e.id AND a.id=$6))
      AND ($7::text IS NULL OR position($7 in e.title)>0 OR EXISTS(SELECT 1 FROM coach_nodes n WHERE n.user_id=e.user_id AND n.event_id=e.id AND n.status<>'withdrawn' AND position($7 in n.content)>0))
      AND ($8::timestamptz IS NULL OR e.created_at >= $8) AND ($9::timestamptz IS NULL OR e.created_at <= $9)`,[user,conversation,embeddingSignature,enabled,input.eventId??null,input.actionId??null,input.object??null,input.after??null,input.before??null])).rows
    const ranked=new Map<string,{score:number;row:any}>(),pending=new Map<string,any>()
    // Older controls did not advance the event generation. Never rank a
    // recovered title using its pre-withdrawal cached vectors.
    const boundaries=vector?await coachSourceBoundaryRefs(c,user):[]
    const signatures=new Map<string,string>()
    for(const row of rows){
      signal?.throwIfAborted()
      if(!signatures.has(row.id))signatures.set(row.id,coachIndexSignature(row.source_ids,boundaries))
      if(vector&&(!row.embedding||row.signature!==signatures.get(row.id))){pending.set(row.id,row);continue}
      const score=vector?row.embedding.reduce((sum:number,value:number,index:number)=>sum+value*vector[index],0):1
      if(!ranked.has(row.id)||ranked.get(row.id)!.score<score)ranked.set(row.id,{score,row})
    }
    // A just-saved revision is readable before the background index catches up.
    // Rank at most three recent pending titles with the existing offline encoder;
    // they remain navigation candidates and still pass readCoachEvent below.
    if(vector&&pending.size){
      const recent=[...pending.values()].sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at)).slice(0,3)
      const visible:{row:any;event:CoachEvent}[]=[]
      for(const row of recent){
        try{
          visible.push({row,event:await readCoachEvent(c,user,conversation,row.id)})
          await c.query('INSERT INTO coach_index_jobs(user_id,event_id,revision,generation) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[user,row.id,row.revision,row.generation])
        }catch(error){if(!(error instanceof HttpError)||!['NOT_FOUND','COACH_SOURCE_REVOKED','MEMORY_DISABLED'].includes(error.code))throw error}
      }
      const embeddings=visible.length?await localEmbedding.encode(visible.map(({event})=>[event.title,...event.nodes.filter(node=>node.source).map(node=>node.content)].join('；')),false,signal):[]
      visible.forEach(({row},index)=>ranked.set(row.id,{row,score:embeddings[index].reduce((sum,value,dimension)=>sum+value*vector[dimension],0)}))
    }
    const selected=[...ranked.values()].sort((a,b)=>b.score-a.score||Date.parse(b.row.updated_at)-Date.parse(a.row.updated_at))
    const events:CoachEvent[]=[]
    for(const match of selected){
      try{const event=await readCoachEvent(c,user,conversation,match.row.id);if(!input.object||event.title.includes(input.object)||event.nodes.some(node=>node.content.includes(input.object!)))events.push(event)}catch(error){if(!(error instanceof HttpError)||!['NOT_FOUND','COACH_SOURCE_REVOKED','MEMORY_DISABLED'].includes(error.code))throw error}
      if(events.length===3)break
    }
    signal?.throwIfAborted()
    // Similar candidates are navigation only. Do not switch current event or infer facts.
    return {events,ambiguous:events.length>1&&(!vector||selected.length>1&&Math.abs(selected[0].score-selected[1].score)<0.04),indexPending:pending.size}
  })
}

// Explicit cross-matter requests need a bounded working set rather than the
// top three semantic matches. Canonical reads retain all privacy/source gates.
export async function readMatterWorkingSet(user:string,conversation:string,signal?:AbortSignal,relatedIds:string[]=[],basisIds:string[]=[]){
 return transaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])
  requireRow((await c.query('SELECT 1 FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0])
  const enabled=(await c.query('SELECT enabled FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]?.enabled===true
  const basis=[...new Set(basisIds)].slice(0,14)
  const rows=basis.length?[]:(await c.query("SELECT id FROM coach_events WHERE user_id=$1 AND status='active' AND ($3 OR conversation_id=$2) ORDER BY updated_at DESC,id LIMIT 25",[user,conversation,enabled])).rows
  const recentIds=rows.slice(0,24).map(row=>row.id as string),available:CoachEvent[]=[],sourceControls:Record<string,string>={}
  for(const id of basis.length?basis:[...new Set([...recentIds,...relatedIds.slice(0,4)])]){
   signal?.throwIfAborted()
   try{const event=await readCoachEvent(c,user,conversation,id);available.push(event);sourceControls[id]=await coachSourceControlKey(c,user,id)}
   catch(error){if(!(error instanceof HttpError)||!['NOT_FOUND','COACH_SOURCE_REVOKED','MEMORY_DISABLED'].includes(error.code))throw error}
  }
  const quiet=(event:CoachEvent)=>event.matterProgress?.recommendationStopped||['paused','ended','completed'].includes(event.matterProgress?.state??'')
  const recent=available.filter(event=>recentIds.includes(event.id))
  const primary=[...recent.filter(event=>!quiet(event)).slice(0,8),...recent.filter(quiet).slice(0,2)]
  const events=basis.length?available:[...primary,...available.filter(event=>relatedIds.includes(event.id)&&!primary.some(selected=>selected.id===event.id))]
  return {events,sourceControls,coverage:{scope:'CURRENT_AUTHORIZED_BOUNDED_WORKING_SET',candidateLimit:24,relatedCaseLimit:4,...(basis.length?{comparisonBasis:true,basisCaseLimit:14,basisUnavailableCount:basis.length-events.length}:{}),moreAvailable:basis.length?basisIds.length>14||basis.length>events.length:rows.length>24||available.length>events.length||relatedIds.length>4,selection:basis.length?'same previously supplied matters, re-read under current authority; missing sources are not replaced by unrelated matters':'recent open matters plus recent stops and supplied related cases; not a priority ranking or complete task inventory'}}
 })
}

// References only: old prose is never restored as factual authority. The
// selected IDs still pass the canonical current-source reader above.
export async function readPriorDecision(user:string,conversation:string){
 const row=(await pool.query(`SELECT r.source_message_id AS "sourceMessageId",m.created_at::text AS "createdAt", coach_reply_sources_valid(r.user_id,r.request_id) AS "sourceValid",r.tool_audit @> '[{"phase":"decision_comparison_read_only"}]'::jsonb AS "isTrial",
  (SELECT a->'eventRefs' FROM jsonb_array_elements(r.tool_audit) a WHERE a->>'phase'='coach_context_bound' LIMIT 1) AS "eventRefs",
  (SELECT a FROM jsonb_array_elements(r.tool_audit) a WHERE a->>'phase'='decision_proposal' LIMIT 1) AS proposal,
  (SELECT a->>'sourceMessageId' FROM jsonb_array_elements(r.tool_audit) a WHERE a->>'phase'='decision_comparison_baseline_bound' LIMIT 1) AS "baselineSourceMessageId",
  (SELECT a->'messageIds' FROM jsonb_array_elements(r.tool_audit) a WHERE a->>'phase'='decision_condition_sources' LIMIT 1) AS "conditionSources"
  FROM runs r JOIN messages m ON m.user_id=r.user_id AND m.id=r.source_message_id
  WHERE r.user_id=$1 AND r.conversation_id=$2 AND r.status='completed'
   AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=r.user_id AND d.conversation_id=r.conversation_id)
   AND (r.tool_audit @> '[{"phase":"matter_working_set_bound"}]'::jsonb OR r.tool_audit @> '[{"phase":"decision_comparison_read_only"}]'::jsonb)
  ORDER BY m.created_at DESC,m.id DESC LIMIT 1`,[user,conversation])).rows[0]
 if(row?.sourceValid!==true)return null
 // Page through the contiguous supplement sequence. Retain only references to
 // latest field sources and its closing boundary, never a first/last-window gap
 // or raw reconstructed values. The engine re-reads/redacts those references.
 let cursorAt=row.createdAt,cursorId=row.sourceMessageId,projected=compileDecisionConditions('',''),closed=false
 const sourceIds=new Map<string,string>();let boundary:string|null=null
 while(!closed){
  const page=(await pool.query(`SELECT m.id,m.content,r.status,m.created_at::text AS cursor_at FROM messages m JOIN runs r ON r.user_id=m.user_id AND r.request_id=m.run_request_id
   WHERE m.user_id=$1 AND m.conversation_id=$2 AND m.role='user'
    AND (m.created_at,m.id)>($3::timestamptz,$4::uuid)
   ORDER BY m.created_at,m.id LIMIT 64`,[user,conversation,cursorAt,cursorId])).rows
  for(const item of page){
   if(item.status!=='completed'||!continuesDecisionContext(item.content)){boundary=item.id;closed=true;break}
   const next=compileDecisionConditions(projected,actualDecisionConditionText(item.content))
   for(const key of Object.keys(projected.sources))if(!Object.hasOwn(next.sources,key))sourceIds.delete(key)
   for(const [key,quote] of Object.entries(next.sources))if(projected.sources[key]!==quote)sourceIds.set(key,item.id)
   projected=next;cursorAt=item.cursor_at;cursorId=item.id
  }
  if(page.length<64)break
 }
 const supplementFieldSources=Object.fromEntries([...sourceIds].map(([field,messageId])=>[field,{messageId,valueDigest:createHash('sha256').update(JSON.stringify(Object.hasOwn(projected,field)?(projected as unknown as Record<string,unknown>)[field]:projected.unavailableResources.includes(field))).digest('hex')}]))
 return {...row,supplementFieldSources,conditionSources:[...new Set([...(row.conditionSources??[]),...sourceIds.values(),...(boundary?[boundary]:[])])]}
}

export function startCoachIndexing(){
  let working=false,stopped=false
  const controller=new AbortController()
  let finished:(()=>void)|undefined
  const timer=setInterval(async()=>{
    if(working||stopped)return
    working=true
    try{for(let i=0;i<8&&!stopped;i++)if(!await indexCoachEventOnce((texts,query)=>localEmbedding.encode(texts,query,controller.signal)))break}catch{if(!stopped)console.error('COACH_INDEX_JOB_FAILED')}
    finally{working=false;finished?.()}
  },500)
  timer.unref()
  return async()=>{stopped=true;controller.abort();clearInterval(timer);if(working)await new Promise<void>(resolve=>{finished=resolve})}
}
