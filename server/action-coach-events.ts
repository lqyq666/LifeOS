import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { Value } from 'typebox/value'
import { pool, transaction, HttpError, requireRow } from './db.ts'
import { eventDeltaSchema, type EventDelta } from './action-coach-contracts.ts'
import type { Run } from './store.ts'
import type { CoachKnowledgeRef } from './coach-knowledge.ts'

export type CoachSource={messageId:string;quote:string;conversationId:string}
export type CoachNode={id:string;revision:number;kind:'fact'|'feeling'|'user_interpretation'|'unknown';status:'active'|'resolved'|'declined';content:string;source:CoachSource|null}
export type CoachAction={id:string;revision:number;status:'proposed'|'closed'|'stale';draft:Record<string,unknown>|null;closedReason:string|null;knowledgeRefs?:CoachKnowledgeRef[];requestSources?:CoachSource[];unavailableReasons?:('knowledge_sources_changed_or_unavailable'|'user_sources_unavailable'|'material_withdrawn')[]}
export type CoachProcessTurn={revision:number;sourceMessageId:string;nodeIds:string[];questionsAskedAfterInput:string[];inputSources?:CoachSource[];introducedUnknownNodeIds?:string[]}
export type CoachEvent={id:string;conversationId:string;title:string;revision:number;generation:number;nodes:CoachNode[];actions:CoachAction[];asked:string[];processTurns?:CoachProcessTurn[];createdAt:string;updatedAt:string}
export type CoachStaged={delta:EventDelta;reply:string;eventId:string;actionId?:string;knowledgeRefs?:CoachKnowledgeRef[]}

// Retain only contiguous original input outside node-backed quotes. Union all
// matching ranges first, so overlapping/nested quotes cannot leak old text.
function unquotedRequestParts(content:string,quotes:readonly string[]):string[]{
  const ranges:[number,number][]=[]
  for(const quote of new Set(quotes)){
    if(typeof quote!=='string'||!quote.trim())continue
    for(let at=content.indexOf(quote);at>=0;at=content.indexOf(quote,at+1))ranges.push([at,at+quote.length])
  }
  ranges.sort((a,b)=>a[0]-b[0])
  const parts:string[]=[];let cursor=0
  for(const [start,end] of ranges){if(start>cursor)parts.push(content.slice(cursor,start).trim());cursor=Math.max(cursor,end)}
  parts.push(content.slice(cursor).trim())
  return parts.filter(Boolean)
}

// Literal display metadata, not a semantic classifier or a generation gate.
// Materials, code, quoted speech and URLs are not questions to the user.
export function visibleCoachQuestions(reply:string,material?:string):string[]{
  const visible=(material?reply.split(material).join('\n'):reply)
    .replace(/```[\s\S]*?```|`[^`]*`/g,'\n')
    .replace(/[“「『][\s\S]*?[”」』]/g,quote=>/[？?]/.test(quote)?'\n':quote)
    .replace(/https?:\/\/\S+/g,'\n')
  return [...new Set((visible.match(/[^。！？!?;；\n]*[？?]/g)??[]).map(question=>question.trim().replace(/^[\d.、\-#*\s]+/,'')))]
}

async function enabled(c:PoolClient,user:string){
  return (await c.query('SELECT enabled FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]?.enabled===true
}
async function eventFor(c:PoolClient,user:string,conversation:string,id:string,lock=false){
  const row=requireRow((await c.query(`SELECT * FROM coach_events WHERE user_id=$1 AND id=$2 AND status='active'${lock?' FOR UPDATE':''}`,[user,id])).rows[0])
  if(row.conversation_id!==conversation&&!await enabled(c,user))throw new HttpError(403,'MEMORY_DISABLED')
  return row
}
async function sourceContent(c:PoolClient,user:string,source:CoachSource):Promise<string|null>{
  const row=(await c.query(`SELECT m.content FROM messages m
    WHERE m.user_id=$1 AND m.conversation_id=$2 AND m.id=$3 AND m.role='user'
    AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE s.user_id=m.user_id AND s.source_message_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM experiences e WHERE e.user_id=m.user_id AND e.source_message_id=m.id AND e.status='deleted')`,[user,source.conversationId,source.messageId])).rows[0]
  return row?.content??null
}
async function sourceAvailable(c:PoolClient,user:string,source:CoachSource){
  const content=await sourceContent(c,user,source)
  return Boolean(content&&source.quote.trim()&&content.includes(source.quote))
}
async function currentSource(c:PoolClient,run:Run,source:{messageId:string;quote:string}):Promise<CoachSource>{
  if(source.messageId!==run.source_message_id)throw new HttpError(400,'COACH_CURRENT_SOURCE_REQUIRED')
  const ref={...source,conversationId:run.conversation_id}
  const content=await sourceContent(c,run.user_id,ref)
  // Repair guidance carries the exact mismatch so a bounded repair can fix the
  // quoted span deterministically instead of guessing which reference failed.
  if(content===null||!source.quote.trim()||!content.includes(source.quote))throw new HttpError(400,'COACH_SOURCE_INVALID',undefined,{quote:source.quote.slice(0,400),currentText:content?.slice(0,2000)??null,currentMessageId:run.source_message_id})
  return ref
}
async function checkDelta(c:PoolClient,run:Run,delta:EventDelta,reply:string){
  if(!Value.Check(eventDeltaSchema,delta))throw new HttpError(400,'COACH_DELTA_INVALID')
  if(delta.target.operation==='create'){
    await currentSource(c,run,delta.target.source)
    if(delta.corrections?.length||delta.resolveUnknowns?.length||delta.declineUnknowns?.length||delta.action&&delta.action.operation!=='create')throw new HttpError(400,'COACH_NEW_EVENT_TARGET_INVALID')
  }else{
    const event=await eventFor(c,run.user_id,run.conversation_id,delta.target.eventId)
    if(event.revision!==delta.target.expectedRevision)throw new HttpError(409,'COACH_EVENT_REVISION_CONFLICT')
    if(!await sourceAvailable(c,run.user_id,event.title_source))throw new HttpError(409,'COACH_SOURCE_REVOKED')
    for(const correction of delta.corrections??[]){
      const node=(await c.query("SELECT kind,status FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,event.id,correction.nodeId])).rows[0]
      if(!node||node.status==='withdrawn')throw new HttpError(404,'COACH_NODE_NOT_FOUND')
    }
    const resolved=new Set(delta.resolveUnknowns??[])
    if((delta.declineUnknowns??[]).some(id=>resolved.has(id)))throw new HttpError(400,'COACH_UNKNOWN_DISPOSITION_CONFLICT')
    for(const id of delta.resolveUnknowns??[]){
      if(!(await c.query("SELECT 1 FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND id=$3 AND kind='unknown' AND status='active'",[run.user_id,event.id,id])).rowCount)throw new HttpError(400,'COACH_UNKNOWN_NOT_FOUND')
    }
    for(const id of delta.declineUnknowns??[]){
      if(!(await c.query("SELECT 1 FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND id=$3 AND kind='unknown' AND status='active'",[run.user_id,event.id,id])).rowCount)throw new HttpError(400,'COACH_UNKNOWN_NOT_FOUND')
    }
    if(delta.action&&delta.action.operation!=='create'){
      const action=(await c.query('SELECT revision,status,coach_knowledge_refs_valid(knowledge_refs) AS knowledge_valid,draft=$4::jsonb AS draft_unchanged FROM coach_actions WHERE user_id=$1 AND event_id=$2 AND id=$3',[run.user_id,event.id,delta.action.actionId,delta.action.operation==='modify'?JSON.stringify(delta.action.draft):null])).rows[0]
      if(!action)throw new HttpError(404,'COACH_ACTION_NOT_FOUND')
      if(action.revision!==delta.action.expectedRevision)throw new HttpError(409,'COACH_ACTION_REVISION_CONFLICT')
      if(delta.action.operation==='reuse'&&(action.status!=='proposed'||!action.knowledge_valid||delta.corrections?.length))throw new HttpError(409,'COACH_ACTION_REVIEW_REQUIRED')
      if(delta.action.operation==='modify'&&action.status==='closed')throw new HttpError(409,'COACH_ACTION_CLOSED')
      if(delta.action.operation==='modify'&&action.status==='proposed'&&action.knowledge_valid&&action.draft_unchanged&&!delta.corrections?.length)throw new HttpError(400,'COACH_ACTION_UNCHANGED')
    }
  }
  let recordedContents:Set<string>|undefined
  if(delta.target.operation!=='create')recordedContents=new Set((await c.query("SELECT content FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND status<>'withdrawn'",[run.user_id,delta.target.eventId])).rows.map(row=>row.content as string))
  // A redundant re-emission of an already-recorded verbatim node is skipped,
  // not failed: it carries no new claim and the reply stays unchanged. Any
  // other non-current quote remains a blocking source error.
  const nodeSource=async(node:{kind:string;source?:{messageId:string;quote:string}}):Promise<CoachSource|null>=>{
    if(node.kind==='unknown')return null
    try{return await currentSource(c,run,node.source!)}
    catch(error){
      if(error instanceof HttpError&&error.code==='COACH_SOURCE_INVALID'&&recordedContents?.has(node.source!.quote))return null
      throw error
    }
  }
  for(const node of delta.nodes??[])await nodeSource(node)
  for(const correction of delta.corrections??[])await currentSource(c,run,correction.source)
  if(delta.action&&'draft' in delta.action){
    if(!delta.action.draft.content.trim()||!reply.includes(delta.action.draft.content))throw new HttpError(400,'COACH_MATERIAL_NOT_VISIBLE')
  }
}

export async function stageCoachEvent(run:Run,delta:EventDelta,reply:string):Promise<CoachStaged>{
  const staged={delta:structuredClone(delta),reply,eventId:delta.target.operation==='create'?randomUUID():delta.target.eventId,...(delta.action?.operation==='create'?{actionId:randomUUID()}: {})}
  await transaction(c=>checkDelta(c,run,staged.delta,reply))
  return staged
}

export async function persistCoachEvent(c:PoolClient,run:Run,staged:CoachStaged):Promise<CoachEvent>{
  // Called inside finishRun's transaction. Re-check everything at commit time;
  // staged validation is not authority for a later revision or memory grant.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[run.user_id+':memory-settings'])
  const delta=staged.delta
  if(delta.target.operation==='continue')await eventFor(c,run.user_id,run.conversation_id,staged.eventId,true)
  await checkDelta(c,run,delta,staged.reply)
  if(delta.target.operation==='create'){
    await c.query('INSERT INTO coach_events(id,user_id,conversation_id,title,title_source) VALUES($1,$2,$3,$4,$5)',[staged.eventId,run.user_id,run.conversation_id,delta.target.title,await currentSource(c,run,delta.target.source)])
  }else{
    await c.query('UPDATE coach_events SET revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2',[run.user_id,staged.eventId])
  }
  for(const node of delta.nodes??[]){
    let source:CoachSource|null=null
    if(node.kind!=='unknown'){
      try{source=await currentSource(c,run,node.source)}
      catch(error){
        if(error instanceof HttpError&&error.code==='COACH_SOURCE_INVALID'&&(await c.query("SELECT 1 FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND status<>'withdrawn' AND source IS NOT NULL AND content=$3",[run.user_id,staged.eventId,node.source.quote])).rowCount)continue
        throw error
      }
    }
    const content=node.kind==='unknown'?node.question:node.source.quote
    const duplicate=(await c.query("SELECT 1 FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND status='active' AND kind=$3 AND content=$4 AND source IS NOT DISTINCT FROM $5::jsonb",[run.user_id,staged.eventId,node.kind,content,source?JSON.stringify(source):null])).rowCount
    if(!duplicate)await c.query('INSERT INTO coach_nodes(id,user_id,event_id,kind,content,source) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),run.user_id,staged.eventId,node.kind,content,source])
  }
  for(const correction of delta.corrections??[]){
    await c.query("UPDATE coach_nodes SET source=$4,content=$5,kind=CASE WHEN kind='unknown' THEN 'fact' ELSE kind END,status='active',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,correction.nodeId,await currentSource(c,run,correction.source),correction.source.quote])
  }
  for(const id of delta.resolveUnknowns??[])await c.query("UPDATE coach_nodes SET status='resolved',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,id])
  for(const id of delta.declineUnknowns??[])await c.query("UPDATE coach_nodes SET status='declined',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,id])
  if(delta.corrections?.length)await c.query("UPDATE coach_actions SET status='stale',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND status='proposed'",[run.user_id,staged.eventId])
  const change=delta.action
  if(change){
    if(change.operation==='create'||change.operation==='modify'){
      const sources=(await c.query("SELECT DISTINCT source->>'messageId' AS id FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND status='active' AND source IS NOT NULL",[run.user_id,staged.eventId])).rows.map(row=>row.id as string)
      if(change.operation==='modify'){
        // A drafting request can carry effort/contact limits without becoming a
        // fact node. Recover its owned lineage from actual material changes,
        // including older revisions that previously lost the request pointer.
        // Keep unquoted request portions in mixed inputs, while node-backed
        // facts remain governed by current node sources rather than old text.
        const requests=(await c.query(`SELECT DISTINCT m.id,m.content,
          ARRAY(SELECT n#>>'{source,quote}' FROM coach_event_revisions h,jsonb_array_elements(COALESCE(h.snapshot#>'{event,nodes}','[]'::jsonb)) n WHERE h.user_id=r.user_id AND h.event_id=r.event_id AND n#>>'{source,messageId}'=m.id::text) AS node_quotes
          FROM coach_event_revisions r
          JOIN runs t ON t.user_id=r.user_id AND t.request_id=r.request_id
          JOIN messages m ON m.user_id=t.user_id AND m.id=t.source_message_id
          WHERE r.user_id=$1 AND r.event_id=$2 AND m.role='user'
          AND r.snapshot->>'actionChange' IN ('create','modify')
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(r.snapshot#>'{event,actions}','[]'::jsonb)) a WHERE a->>'id'=$3 AND a->>'status'='proposed')
          AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE s.user_id=m.user_id AND s.source_message_id=m.id)
          AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)
          AND NOT EXISTS(SELECT 1 FROM experiences e WHERE e.user_id=m.user_id AND e.source_message_id=m.id AND e.status='deleted')`,[run.user_id,staged.eventId,change.actionId])).rows
        sources.push(...requests.filter(row=>unquotedRequestParts(row.content,row.node_quotes).length).map(row=>row.id as string))
      }
      sources.push(run.source_message_id)
      if(change.operation==='create'){
        await c.query("UPDATE coach_actions SET status='closed',closed_reason='replaced',revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND status='proposed'",[run.user_id,staged.eventId])
        await c.query('INSERT INTO coach_actions(id,user_id,event_id,draft,source_message_ids,knowledge_refs) VALUES($1,$2,$3,$4,$5,$6)',[staged.actionId,run.user_id,staged.eventId,change.draft,[...new Set(sources)],JSON.stringify(staged.knowledgeRefs??[])])
      }else{
        await c.query("UPDATE coach_actions SET draft=$4,status='proposed',source_message_ids=$5,knowledge_refs=$6,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,change.actionId,change.draft,[...new Set(sources)],JSON.stringify(staged.knowledgeRefs??[])])
      }
    }else if(change.operation==='close'){
      await c.query("UPDATE coach_actions SET status='closed',closed_reason=$4,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND id=$3",[run.user_id,staged.eventId,change.actionId,change.reason])
    }
  }
  await c.query('INSERT INTO coach_current(user_id,conversation_id,event_id) VALUES($1,$2,$3) ON CONFLICT(user_id,conversation_id) DO UPDATE SET event_id=EXCLUDED.event_id',[run.user_id,run.conversation_id,staged.eventId])
  const event=await readCoachEvent(c,run.user_id,run.conversation_id,staged.eventId)
  const askedThisTurn=visibleCoachQuestions(staged.reply,change&&'draft'in change?change.draft.content:undefined)
  event.asked=[...new Set([...event.asked,...askedThisTurn])]
  // Process chronology is reconstructed from owned runs/messages, not copied
  // recursively into each revision snapshot or classified as answered/refused.
  const {processTurns,...snapshotEvent}=event
  snapshotEvent.actions=event.actions.map(({requestSources,...action})=>action)
  await c.query('INSERT INTO coach_event_revisions(user_id,event_id,revision,generation,request_id,snapshot) VALUES($1,$2,$3,$4,$5,$6)',[run.user_id,event.id,event.revision,event.generation,run.request_id,{event:snapshotEvent,askedThisTurn,actionChange:change?.operation??null}])
  return readCoachEvent(c,run.user_id,run.conversation_id,event.id)
}

export async function readCoachEvent(c:PoolClient,user:string,conversation:string,id:string):Promise<CoachEvent>{
  const row=await eventFor(c,user,conversation,id)
  const rows=(await c.query("SELECT * FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND status<>'withdrawn' ORDER BY created_at,id",[user,id])).rows
  const actionRows=(await c.query('SELECT *,coach_knowledge_refs_valid(knowledge_refs) AS knowledge_valid FROM coach_actions WHERE user_id=$1 AND event_id=$2 ORDER BY created_at,id',[user,id])).rows
  const history=(await c.query("SELECT r.revision,r.snapshot->'askedThisTurn' AS asked,r.snapshot#>'{event,nodes}' AS nodes,r.snapshot->>'actionChange' AS action_change,ARRAY(SELECT a->>'id' FROM jsonb_array_elements(COALESCE(r.snapshot#>'{event,actions}','[]'::jsonb)) a WHERE a->>'status'='proposed') AS action_ids,t.source_message_id FROM coach_event_revisions r JOIN runs t ON t.user_id=r.user_id AND t.request_id=r.request_id WHERE r.user_id=$1 AND r.event_id=$2 ORDER BY r.revision",[user,id])).rows
  const recent=history.slice(-8)
  const ids=[...new Set([row.title_source.messageId,...rows.flatMap(node=>node.source?[node.source.messageId]:[]),...actionRows.flatMap(action=>action.source_message_ids),...recent.map(turn=>turn.source_message_id)])]
  const available=(await c.query(`SELECT m.id,m.content,m.conversation_id FROM messages m
    WHERE m.user_id=$1 AND m.id=ANY($2::uuid[]) AND m.role='user'
    AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE s.user_id=m.user_id AND s.source_message_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM experiences e WHERE e.user_id=m.user_id AND e.source_message_id=m.id AND e.status='deleted') ORDER BY m.created_at,m.id`,[user,ids])).rows
  const sources=new Map(available.map(message=>[message.id,message]))
  const valid=(source:CoachSource)=>{const message=sources.get(source.messageId);return Boolean(message&&message.conversation_id===source.conversationId&&source.quote.trim()&&message.content.includes(source.quote))}
  if(!valid(row.title_source))throw new HttpError(409,'COACH_SOURCE_REVOKED')
  const nodes:CoachNode[]=rows.filter(node=>!node.source||valid(node.source)).map(node=>({id:node.id,revision:node.revision,kind:node.kind,status:node.status,content:node.content,source:node.source}))
  const nodeQuotes=new Map<string,string[]>()
  for(const node of [...nodes,...history.flatMap(turn=>Array.isArray(turn.nodes)?turn.nodes:[])]){
    if(node.source)nodeQuotes.set(node.source.messageId,[...nodeQuotes.get(node.source.messageId)??[],node.source.quote])
  }
  const actions:CoachAction[]=actionRows.map(action=>{
    const unavailableReasons:NonNullable<CoachAction['unavailableReasons']>=[]
    if(!action.knowledge_valid)unavailableReasons.push('knowledge_sources_changed_or_unavailable')
    if(action.source_message_ids.some((sourceId:string)=>!sources.has(sourceId)))unavailableReasons.push('user_sources_unavailable')
    if(action.status==='stale'&&!unavailableReasons.length)unavailableReasons.push('material_withdrawn')
    const stale=unavailableReasons.length>0
    const requestIds=new Set(history.filter(turn=>['create','modify'].includes(turn.action_change)&&turn.action_ids.includes(action.id)).map(turn=>turn.source_message_id))
    const requests=stale?[]:available.filter(message=>action.source_message_ids.includes(message.id)&&requestIds.has(message.id)).map(message=>unquotedRequestParts(message.content,nodeQuotes.get(message.id)??[]).map(quote=>({messageId:message.id,conversationId:message.conversation_id,quote}))).filter(parts=>parts.length)
    // Keep the original request plus recent changes, without interpreting them
    // as facts, accepted commitments or stable personal background.
    const requestSources=(requests.length>8?[requests[0],...requests.slice(-7)]:requests).flat()
    return {id:action.id,revision:action.revision,status:stale?'stale':action.status,draft:stale?null:action.draft,closedReason:stale?null:action.closed_reason,...(requestSources.length?{requestSources}:{}),...(stale?{unavailableReasons}:action.knowledge_refs.length?{knowledgeRefs:action.knowledge_refs}:{})}
  })
  // Reusing whole historical inputs could resurrect a corrected statement.
  // Keep valid node references and exact non-node input fragments. Historical
  // node-backed text stays excluded so corrections cannot resurrect old facts;
  // no fragment is classified as answered/refused or promoted to a profile.
  const unknownIntroductions=new Map<string,number>()
  for(const turn of history)for(const node of Array.isArray(turn.nodes)?turn.nodes:[]){
    if(node.kind==='unknown'&&!unknownIntroductions.has(node.id))unknownIntroductions.set(node.id,turn.revision)
  }
  const processTurns:CoachProcessTurn[]=recent.flatMap(turn=>{
    const nodeIds=nodes.filter(node=>node.source?.messageId===turn.source_message_id).map(node=>node.id)
    const introducedUnknownNodeIds=nodes.filter(node=>node.kind==='unknown'&&unknownIntroductions.get(node.id)===turn.revision).map(node=>node.id)
    const message=sources.get(turn.source_message_id)
    const inputSources=message?unquotedRequestParts(message.content,nodeQuotes.get(message.id)??[]).map(quote=>({messageId:message.id,conversationId:message.conversation_id,quote})):[]
    return (nodeIds.length||inputSources.length)&&Array.isArray(turn.asked)?[{revision:turn.revision,sourceMessageId:turn.source_message_id,nodeIds,questionsAskedAfterInput:turn.asked,...(inputSources.length?{inputSources}:{}),...(introducedUnknownNodeIds.length?{introducedUnknownNodeIds}:{})}]:[]
  })
  return {id:row.id,conversationId:row.conversation_id,title:row.title,revision:row.revision,generation:row.generation,nodes,actions,asked:[...new Set(history.flatMap(entry=>entry.asked??[]))],processTurns,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()}
}

export async function coachEventView(user:string,conversation:string,id?:string){
  return transaction(async c=>{
    requireRow((await c.query('SELECT id FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0])
    const selected=id??(await c.query('SELECT event_id FROM coach_current WHERE user_id=$1 AND conversation_id=$2',[user,conversation])).rows[0]?.event_id
    return selected?await readCoachEvent(c,user,conversation,selected):null
  })
}

export async function assertCoachEvidence(c:PoolClient,user:string,conversation:string,refs:{eventId:string;revision:number;generation:number}[]){
  for(const ref of refs){
    let event
    try{event=await eventFor(c,user,conversation,ref.eventId,true)}catch(error){
      if(error instanceof HttpError&&error.code==='NOT_FOUND')throw new HttpError(409,'COACH_SNAPSHOT_INVALIDATED')
      throw error
    }
    if(event.revision!==ref.revision||event.generation!==ref.generation||!await sourceAvailable(c,user,event.title_source))throw new HttpError(409,'COACH_SNAPSHOT_INVALIDATED')
  }
}

// Existing memory/experience corrections invoke this inside their transaction.
// Tombstones and source withdrawal survive subsequent retrieval and rebuilds.
export async function invalidateCoachSources(c:PoolClient,user:string,messageIds:string[],forget:boolean){
  if(!messageIds.length)return
  await c.query(`INSERT INTO coach_source_withdrawals(user_id,message_id,conversation_id,reason)
    SELECT user_id,id,conversation_id,$3 FROM messages WHERE user_id=$1 AND id=ANY($2::uuid[])
    ON CONFLICT(user_id,message_id) DO UPDATE SET reason=CASE WHEN coach_source_withdrawals.reason='forgotten' THEN 'forgotten' ELSE EXCLUDED.reason END`,[user,messageIds,forget?'forgotten':'corrected'])
  const affected=(await c.query(`SELECT DISTINCT event_id FROM coach_nodes WHERE user_id=$1 AND source->>'messageId'=ANY($2::text[]) AND status<>'withdrawn'
    UNION SELECT id FROM coach_events WHERE user_id=$1 AND title_source->>'messageId'=ANY($2::text[]) AND status='active'
    UNION SELECT event_id FROM coach_actions WHERE user_id=$1 AND source_message_ids && $2::uuid[]
    UNION SELECT r.event_id FROM coach_event_revisions r JOIN runs t ON t.user_id=r.user_id AND t.request_id=r.request_id
      WHERE r.user_id=$1 AND t.source_message_id=ANY($2::uuid[]) AND r.snapshot ? 'event'`,[user,messageIds])).rows.map(row=>row.event_id as string)
  for(const id of affected){
    await c.query('SELECT id FROM coach_events WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,id])
    await c.query("UPDATE coach_nodes SET status='withdrawn',content=NULL,source=NULL,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND source->>'messageId'=ANY($3::text[])",[user,id,messageIds])
    await c.query("UPDATE coach_nodes SET status='withdrawn',content=NULL,source=NULL,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND kind='unknown' AND status<>'withdrawn'",[user,id])
    await c.query("UPDATE coach_actions SET status='stale',draft=CASE WHEN $4 THEN NULL ELSE draft END,closed_reason=NULL,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND source_message_ids && $3::uuid[]",[user,id,messageIds,forget])
    await c.query("UPDATE coach_events SET revision=revision+1,generation=generation+1,status=CASE WHEN title_source->>'messageId'=ANY($3::text[]) THEN 'forgotten' ELSE status END,title=CASE WHEN title_source->>'messageId'=ANY($3::text[]) THEN '' ELSE title END,title_source=CASE WHEN title_source->>'messageId'=ANY($3::text[]) THEN '{}'::jsonb ELSE title_source END,updated_at=now() WHERE user_id=$1 AND id=$2",[user,id,messageIds])
    const withdrawn=(await c.query("SELECT 1 FROM coach_events WHERE user_id=$1 AND id=$2 AND status='forgotten'",[user,id])).rowCount
    if(withdrawn){
      await c.query("UPDATE coach_nodes SET status='withdrawn',content=NULL,source=NULL,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2 AND status<>'withdrawn'",[user,id])
      await c.query("UPDATE coach_actions SET status='stale',draft=NULL,closed_reason=NULL,revision=revision+1,updated_at=now() WHERE user_id=$1 AND event_id=$2",[user,id])
    }
    // Historical event snapshots can contain derived quotes/materials. Keep a
    // content-free revision marker instead of making them a resurrection path.
    await c.query("UPDATE coach_event_revisions SET snapshot=jsonb_build_object('withdrawn',true) WHERE user_id=$1 AND event_id=$2",[user,id])
    await c.query("DELETE FROM coach_current p USING coach_events e WHERE p.user_id=$1 AND p.event_id=e.id AND e.user_id=p.user_id AND e.status='forgotten'",[user])
  }
}
