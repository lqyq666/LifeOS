import { pool, transaction, HttpError, requireRow } from './db.ts'
import { coachEventView, readCoachEvent, type CoachEvent } from './action-coach-events.ts'
import { localEmbedding, embeddingSignature } from './local-embedding.ts'

export type EventSearch={query:string;eventId?:string;actionId?:string;object?:string;after?:string;before?:string}
type Encode=(texts:string[],query?:boolean,signal?:AbortSignal)=>Promise<number[][]>

// The caller supplies only owner/grant/source-validated confirmed records.
// This shares the existing offline encoder and retains complete fields.
export async function rankConfirmedCoachExperiences(rows:any[],query:string,limit=4){
  if(!rows.length)return []
  if(!query.trim())return rows.slice(0,limit)
  const vector=(await localEmbedding.encode([query],true))[0]
  const parts=rows.flatMap((row,index)=>[...new Set([row.content?.summary,row.content?.action,row.content?.result,row.content?.reflection].filter(value=>typeof value==='string'&&value.trim()))].map(text=>({index,text:text as string})))
  const scores=new Map<number,number>()
  for(let start=0;start<parts.length;start+=32){
    const batch=parts.slice(start,start+32),encoded=await localEmbedding.encode(batch.map(part=>part.text))
    batch.forEach((part,index)=>{const score=encoded[index].reduce((sum,value,dimension)=>sum+value*vector[dimension],0);scores.set(part.index,Math.max(scores.get(part.index)??-Infinity,score))})
  }
  return rows.map((row,index)=>({row,score:scores.get(index)??-Infinity})).sort((a,b)=>b.score-a.score||String(a.row.id).localeCompare(String(b.row.id))).slice(0,limit).map(item=>item.row)
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
    const row=(await pool.query('SELECT conversation_id FROM coach_events WHERE user_id=$1 AND id=$2',[job.user_id,job.event_id])).rows[0]
    const event=row?await coachEventView(job.user_id,row.conversation_id,job.event_id):null
    if(!event||event.revision!==job.revision||event.generation!==job.generation){await pool.query('DELETE FROM coach_index_jobs WHERE user_id=$1 AND event_id=$2 AND revision=$3 AND generation=$4',keys);return true}
    const texts=[event.title,...event.nodes.filter(node=>node.source).map(node=>node.content)]
    const vectors:number[][]=[]
    for(let i=0;i<texts.length;i+=32)vectors.push(...await encode(texts.slice(i,i+32)))
    await transaction(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[job.user_id+':memory-settings'])
      const latest=(await c.query("SELECT * FROM coach_events WHERE user_id=$1 AND id=$2 AND status='active' FOR UPDATE",keys.slice(0,2))).rows[0]
      const liveJob=(await c.query('SELECT 1 FROM coach_index_jobs WHERE user_id=$1 AND event_id=$2 AND revision=$3 AND generation=$4',keys)).rowCount
      if(!liveJob||!latest||latest.revision!==job.revision||latest.generation!==job.generation)return
      await readCoachEvent(c,job.user_id,latest.conversation_id,job.event_id) // sources may have been withdrawn during encoding
      await c.query('DELETE FROM coach_semantic_index WHERE user_id=$1 AND event_id=$2',keys.slice(0,2))
      for(let part=0;part<vectors.length;part++)await c.query('INSERT INTO coach_semantic_index(user_id,event_id,revision,generation,signature,part,embedding) VALUES($1,$2,$3,$4,$5,$6,$7)',[...keys,embeddingSignature,part,vectors[part]])
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
  const vector=input.query.trim()&&!input.eventId&&!input.actionId?(await localEmbedding.encode([input.query],true,signal))[0]:null
  return transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])
    requireRow((await c.query('SELECT 1 FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0])
    const enabled=(await c.query('SELECT enabled FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]?.enabled===true
    const rows=(await c.query(`SELECT e.id,e.revision,e.generation,e.created_at,e.updated_at,e.title,
      i.embedding FROM coach_events e LEFT JOIN coach_semantic_index i ON i.user_id=e.user_id AND i.event_id=e.id
      AND i.revision=e.revision AND i.generation=e.generation AND i.signature=$3
      WHERE e.user_id=$1 AND e.status='active' AND ($4::boolean OR e.conversation_id=$2)
      AND ($5::uuid IS NULL OR e.id=$5) AND ($6::uuid IS NULL OR EXISTS(SELECT 1 FROM coach_actions a WHERE a.user_id=e.user_id AND a.event_id=e.id AND a.id=$6))
      AND ($7::text IS NULL OR position($7 in e.title)>0 OR EXISTS(SELECT 1 FROM coach_nodes n WHERE n.user_id=e.user_id AND n.event_id=e.id AND n.status<>'withdrawn' AND position($7 in n.content)>0))
      AND ($8::timestamptz IS NULL OR e.created_at >= $8) AND ($9::timestamptz IS NULL OR e.created_at <= $9)`,[user,conversation,embeddingSignature,enabled,input.eventId??null,input.actionId??null,input.object??null,input.after??null,input.before??null])).rows
    const ranked=new Map<string,{score:number;row:any}>(),pending=new Set<string>()
    for(const row of rows){
      signal?.throwIfAborted()
      if(vector&&!row.embedding){pending.add(row.id);continue}
      const score=vector?row.embedding.reduce((sum:number,value:number,index:number)=>sum+value*vector[index],0):1
      if(!ranked.has(row.id)||ranked.get(row.id)!.score<score)ranked.set(row.id,{score,row})
    }
    const selected=[...ranked.values()].sort((a,b)=>b.score-a.score||Date.parse(b.row.updated_at)-Date.parse(a.row.updated_at))
    const events:CoachEvent[]=[]
    for(const match of selected){
      try{events.push(await readCoachEvent(c,user,conversation,match.row.id))}catch(error){if(!(error instanceof HttpError)||!['NOT_FOUND','COACH_SOURCE_REVOKED','MEMORY_DISABLED'].includes(error.code))throw error}
      if(events.length===3)break
    }
    signal?.throwIfAborted()
    // Similar candidates are navigation only. Do not switch current event or infer facts.
    return {events,ambiguous:events.length>1&&(!vector||selected.length>1&&Math.abs(selected[0].score-selected[1].score)<0.04),indexPending:pending.size}
  })
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
