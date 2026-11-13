import type { PoolClient } from 'pg'
import {createHash} from 'node:crypto'
import type { DialogueMessage } from './dialogue.ts'
import { pool,HttpError } from './db.ts'
import {scanUserClauses} from './user-command-spans.ts'
import {sourceQuotesOverlap,sourceControlRanges,sourceQuoteRanges,uniqueSourceControlRange,type SourceControlRef} from './clause-catalogue.ts'
import {fullMemorySuppressionSql} from './memory-suppression.ts'
type DB=Pick<PoolClient,'query'>
type ExperienceFactBinding={factId:string;factRevision:number;valid:boolean;actor:string;contentHash:string;skillTags:string[];actionQuote?:string;actionRange?:{start:number;end:number};source?:{source_conversation_id:string;source_conversation_title:string;source_message_id:string;source_quote:string;source_text:string;source_reported_at:Date;range?:{start:number;end:number}}}

export const messageSourceMatches=(text:string,ref:{quote:string;range?:{start:number;end:number}}):boolean=>Boolean(ref.quote?.trim()&&uniqueSourceControlRange(text,ref))

export async function checkMessageSource(c:DB,user:string,conversation:string,ref:{id:string;quote:string;range?:{start:number;end:number}},locking=false){
 if(!ref.quote?.trim())throw new HttpError(400,'CAMPUS_SOURCE_INVALID')
 const source=(await c.query("SELECT content,conversation_id,created_at,(SELECT title FROM conversations c WHERE c.user_id=messages.user_id AND c.id=messages.conversation_id) AS conversation_title FROM messages WHERE user_id=$1 AND id=$2 AND role='user' AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=messages.user_id AND d.conversation_id=messages.conversation_id)"+(locking?' FOR SHARE':''),[user,ref.id])).rows[0]
 if(!source||source.conversation_id!==conversation||!messageSourceMatches(source.content,ref))throw new HttpError(400,'CAMPUS_MESSAGE_SOURCE_INVALID')
 if(await growthQuoteSuppressed(c,user,ref.id,ref.quote,source.content,ref.range)||await messageQuoteCorrected(c,user,ref.id,ref.quote,source.content,ref.range))throw new HttpError(400,'CAMPUS_SOURCE_FORGOTTEN')
 if((await c.query(`SELECT 1 FROM memory_suppressions suppression WHERE user_id=$1 AND source_message_id=$2 AND ${fullMemorySuppressionSql('suppression')} UNION ALL SELECT 1 FROM coach_source_withdrawals WHERE user_id=$1 AND message_id=$2 LIMIT 1`,[user,ref.id])).rowCount)throw new HttpError(400,'CAMPUS_SOURCE_FORGOTTEN')
 return source
}

export async function experienceFactBindings(c:DB,user:string,ids:string[]){
 if(!ids.length)return new Map<string,ExperienceFactBinding>()
 const rows=(await c.query(`SELECT a.value->>'experienceId' AS id,a.value->>'factId' AS fact_id,a.value->>'factRevision' AS fact_revision,a.value->>'actor' AS actor,a.value->>'contentHash' AS content_hash,a.value->'skillTags' AS skill_tags,g.sources,g.conversation_id,COALESCE(a.value->'actionRange',i.value->'actionRange') AS action_range,COALESCE(a.value->>'sourceMessageId',i.value->>'sourceMessageId') AS interpretation_message_id,
   (g.id IS NOT NULL AND g.revision::text=a.value->>'factRevision' AND g.status='active' AND (g.valid_until IS NULL OR g.valid_until>now()) AND (g.valid_from IS NULL OR g.valid_from<=now())) AS valid
   FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value)
   LEFT JOIN growth_items g ON g.user_id=r.user_id AND g.id::text=a.value->>'factId'
   LEFT JOIN LATERAL (SELECT interpretation.value FROM jsonb_array_elements(r.tool_audit) interpretation(value) WHERE interpretation.value->>'phase'='canonical_fact_interpretation' AND interpretation.value->>'itemId'=a.value->>'factId' AND interpretation.value->>'revision'=a.value->>'factRevision' LIMIT 1) i ON true
   WHERE r.user_id=$1 AND r.status='completed' AND a.value->>'phase'='canonical_contribution_staged' AND a.value->>'experienceId'=ANY($2::text[])
   ORDER BY a.value->>'experienceId',CASE WHEN a.value->>'actor' IN ('self','joint') THEN 0 ELSE 1 END,r.finished_at DESC`,[user,ids])).rows
 const bindings=new Map<string,ExperienceFactBinding>()
 for(const row of rows){
  if(bindings.get(row.id)?.valid)continue
   let anchor:ExperienceFactBinding['source'],actionQuote:string|undefined,actionRange:{start:number;end:number}|undefined
  if(row.valid)for(const source of row.sources??[]){
   if(source.type!=='message')continue
    try{
     const checked=await checkMessageSource(c,user,row.conversation_id,source)
     anchor??={source_conversation_id:checked.conversation_id,source_conversation_title:checked.conversation_title,source_message_id:source.id,source_quote:source.quote,source_text:checked.content,source_reported_at:checked.created_at,...(source.range?{range:source.range}:{})}
     const range=row.interpretation_message_id===source.id?row.action_range:undefined
     if(range&&Number.isSafeInteger(range.start)&&Number.isSafeInteger(range.length)&&range.start>=0&&range.length>0&&range.start+range.length<=source.quote.length){
      const selectedAction=source.quote.slice(range.start,range.start+range.length)
      actionQuote=selectedAction
      const ranges=sourceQuoteRanges(checked.content,selectedAction,{quote:source.quote,...(source.range?{range:source.range}:{})})
      if(ranges.length===1)actionRange=ranges[0]
     }
    }catch(error){if(!(error instanceof HttpError))throw error;row.valid=false;break}
  }
   if(actionQuote&&createHash('sha256').update(actionQuote).digest('hex')!==row.content_hash){row.valid=false;actionQuote=undefined}
   if(row.valid&&anchor&&actionQuote)anchor={...anchor,source_quote:actionQuote,...(actionRange?{range:actionRange}:{})}
   bindings.set(row.id,{factId:String(row.fact_id),factRevision:Number(row.fact_revision),valid:row.valid===true,actor:row.actor,contentHash:row.content_hash,skillTags:Array.isArray(row.skill_tags)?row.skill_tags.filter((tag:unknown):tag is string=>typeof tag==='string'):[],...(row.valid&&actionQuote?{actionQuote}:{}),...(row.valid&&actionRange?{actionRange}:{}),...(row.valid&&anchor?{source:anchor}:{})})
 }
 return bindings
}

// A weak interpretation is hidden only while a source-valid confirmed
// experience still has the same exact current action. Persisted shadow links
// are audit history, not visibility state: correction and forgetting must take
// effect from the current canonical records without a repair write.
export async function activeShadowedFactIds(c:DB,user:string,facts:readonly {id:string;revision:number}[]){
 if(!facts.length)return new Set<string>()
 const current=new Map(facts.map(fact=>[fact.id,fact.revision]))
 const shadowed=new Set<string>()
 // Order-independent convergence: a tentative report may predate the stronger
 // owned report. Its own candidate remains the weak source of truth, but any
 // later source-valid confirmed record with the same exact action shadows it.
 const weakRows=(await c.query(`SELECT DISTINCT ON (a.value->>'factId') a.value->>'factId' AS fact_id,a.value->>'factRevision' AS fact_revision,a.value->>'experienceId' AS experience_id
   FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value)
   WHERE r.user_id=$1 AND r.status='completed' AND a.value->>'phase'='canonical_contribution_staged' AND a.value->>'actor'='unknown' AND a.value->>'factId'=ANY($2::text[])
   ORDER BY a.value->>'factId',r.finished_at DESC,r.request_id DESC`,[user,[...current.keys()]])).rows.filter(row=>current.get(String(row.fact_id))===Number(row.fact_revision))
 const candidateIds=[...new Set(weakRows.map(row=>String(row.experience_id)))]
 if(!candidateIds.length)return shadowed
 const pending=new Set((await c.query("SELECT id FROM experiences WHERE user_id=$1 AND id=ANY($2::uuid[]) AND status='candidate'",[user,candidateIds])).rows.map(row=>String(row.id)))
 const bindings=await experienceFactBindings(c,user,[...pending])
 const actions=[...new Set([...bindings.values()].filter(binding=>binding.valid&&binding.actor==='unknown'&&binding.actionQuote).map(binding=>binding.actionQuote!))]
 if(!actions.length)return shadowed
 const strong=(await c.query("SELECT * FROM experiences WHERE user_id=$1 AND status='confirmed' AND content->>'action'=ANY($2::text[])",[user,actions])).rows
 const strongActions=new Set((await filterAvailableExperienceSources(c,user,strong)).map(row=>String(row.content?.action??'')))
 for(const row of weakRows){const binding=bindings.get(String(row.experience_id));if(pending.has(String(row.experience_id))&&binding?.valid&&binding.actionQuote&&strongActions.has(binding.actionQuote))shadowed.add(String(row.fact_id))}
 return shadowed
}

// Ownership is a visibility property of the canonical fact, not a special
// case in each downstream projection. Unknown actors stay source-backed for
// later confirmation, but cannot silently become ordinary personal evidence.
export async function unknownOwnershipFactIds(c:DB,user:string,facts:readonly {id:string;revision:number}[]){
 if(!facts.length)return new Set<string>()
 const current=new Map(facts.map(fact=>[fact.id,fact.revision]))
 const rows=(await c.query(`SELECT DISTINCT ON (a.value->>'itemId') a.value->>'itemId' AS item_id,a.value->>'revision' AS revision,a.value->>'actor' AS actor
   FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value)
   WHERE r.user_id=$1 AND r.status='completed' AND a.value->>'phase'='canonical_fact_interpretation' AND a.value->>'itemId'=ANY($2::text[])
   ORDER BY a.value->>'itemId',r.finished_at DESC,r.request_id DESC`,[user,[...current.keys()]])).rows
 return new Set(rows.filter(row=>row.actor==='unknown'&&current.get(String(row.item_id))===Number(row.revision)).map(row=>String(row.item_id)))
}

// Called under the growth/privacy transaction BEFORE its source revisions and
// interpretation references are scrubbed. Raw chat and paid receipts remain.
export async function redactForgottenContributions(c:DB,user:string,ids:string[],refs:SourceControlRef[]){
 const forgotten=new Set(ids)
 const proofs=(await c.query("SELECT a.value AS proof,r.source_message_id FROM runs r CROSS JOIN LATERAL jsonb_array_elements(r.tool_audit) a(value) WHERE r.user_id=$1 AND a.value->>'phase' IN ('canonical_contribution_staged','canonical_fact_interpretation')",[user])).rows
 const results=new Set(proofs.filter(row=>row.proof.phase==='canonical_fact_interpretation'&&forgotten.has(row.proof.resultFact?.id)).map(row=>row.proof.itemId))
 const messages=new Map((await c.query('SELECT id,content FROM messages WHERE user_id=$1 AND id=ANY($2::uuid[])',[user,[...new Set(refs.map(ref=>ref.messageId))]])).rows.map(row=>[row.id,row.content as string]))
 const matches=(source:any)=>source&&typeof source.messageId==='string'&&typeof source.quote==='string'&&refs.some(ref=>ref.messageId===source.messageId&&sourceQuotesOverlap(messages.get(ref.messageId)??'',source,ref))
 const resultSources=(await c.query("SELECT experience_id,snapshot->'resultSource' AS source FROM experience_revisions WHERE user_id=$1 AND snapshot#>>'{resultSource,messageId}'=ANY($2::text[])",[user,[...messages.keys()]])).rows
 const affected=[...new Set<string>([...proofs.filter(row=>row.proof.phase==='canonical_contribution_staged'&&(forgotten.has(row.proof.factId)||results.has(row.proof.factId))).map(row=>row.proof.experienceId),...resultSources.filter(row=>matches(row.source)).map(row=>row.experience_id)])]
 // Completion receipts contain derived growth descriptions, not the original
 // chat body. Scrub just the withdrawn record IDs in both persisted copies.
 const cacheIds=[...new Set([...ids,...affected])]
 for(const [table,column] of [['runs','response'],['lifeos_workflow_tasks','host_commit']] as const){
  const deltas=`CASE WHEN jsonb_typeof(${column}#>'{stateChange,growthDiff}')='array' THEN ${column}#>'{stateChange,growthDiff}' ELSE '[]'::jsonb END`
  await c.query(`UPDATE ${table} SET ${column}=jsonb_set(${column},'{stateChange,growthDiff}',
   (SELECT COALESCE(jsonb_agg(CASE WHEN d.value->>'itemId'=ANY($2::text[]) THEN jsonb_build_object('schemaVersion',d.value->'schemaVersion','itemId',d.value->'itemId','before','此前存在的一条记录','now','原依据已改变或撤回，之前的解释停止使用。','evidenceRefs','[]'::jsonb,'unknowns','[]'::jsonb,'needsConfirmation',false,'change','withdrawn') ELSE d.value END ORDER BY d.ordinality),'[]'::jsonb) FROM jsonb_array_elements(${deltas}) WITH ORDINALITY d(value,ordinality)))
   WHERE user_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(${deltas}) d(value) WHERE d.value->>'itemId'=ANY($2::text[]))`,[user,cacheIds])
 }
 if(!affected.length)return
 const bindings=await experienceFactBindings(c,user,affected)
 const episodes=(await c.query('SELECT * FROM experiences WHERE user_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE',[user,affected])).rows
 for(const episode of episodes){
  const actionMessages=new Set(proofs.filter(row=>row.proof.phase==='canonical_contribution_staged'&&row.proof.experienceId===episode.id&&forgotten.has(row.proof.factId)).map(row=>row.source_message_id))
  const revisions=(await c.query('SELECT revision,snapshot FROM experience_revisions WHERE user_id=$1 AND experience_id=$2 ORDER BY revision',[user,episode.id])).rows
  const manual=(snapshot:any,key:string)=>snapshot?.manualFields?.includes(key)||snapshot?.correction?.changedFields?.includes(key)&&!snapshot.fromMessageId
  const currentManual=(key:string)=>[...revisions].reverse().some(row=>manual(row.snapshot,key)&&JSON.stringify(row.snapshot.content?.[key])===JSON.stringify(episode.content?.[key]))
  const latestResult=[...revisions].reverse().find(row=>row.snapshot.resultSource||manual(row.snapshot,'result'))?.snapshot
  const resultGone=matches(latestResult?.resultSource)&&!currentManual('result')
  const current={...episode.content},binding=bindings.get(episode.id)
  const surviving=episode.status==='candidate'
   ?Boolean(binding?.valid&&binding.actor==='unknown'&&binding.actionQuote&&binding.contentHash===createHash('sha256').update(binding.actionQuote).digest('hex'))
   :bindingMatches(binding,episode.content?.action)
  if(actionMessages.size&&!surviving){
   for(const key of ['action','summary','title','reflection','occurredAt'])if(!currentManual(key)&&!(key==='title'&&currentManual('summary')&&current.title===String(current.summary).slice(0,36)))current[key]=''
   if(!latestResult?.resultSource&&!currentManual('result'))current.result=''
  }
  if(resultGone){current.result='';for(const key of ['summary','title','reflection'])if(!currentManual(key)&&current[key]!==current.action&&current[key]!==String(current.action??'').slice(0,36))current[key]=''}
  const sourceGone=actionMessages.has(episode.source_message_id),quote=sourceGone?'[redacted:'+episode.id+']':episode.source_quote
  let resultOrigin:any=null,actionOrigin=episode.source_message_id
  const manualValues=new Map<string,unknown>()
  for(const revision of revisions){
   const before=revision.snapshot,snapshot=structuredClone(before)
   const origin=snapshot.fromMessageId??snapshot.source?.sourceMessageId??snapshot.sourceAnchor?.messageId??snapshot.sourceMessageId
   if(origin)actionOrigin=origin
   for(const [key,value] of Object.entries(snapshot.content??{}))if(manual(snapshot,key))manualValues.set(key,value)
   const protectedField=(key:string)=>manualValues.has(key)&&JSON.stringify(manualValues.get(key))===JSON.stringify(snapshot.content?.[key])
   if(snapshot.resultSource?.quote)resultOrigin=snapshot.resultSource
   if(protectedField('result'))resultOrigin=null
   const oldAction=actionMessages.has(actionOrigin),oldResult=matches(resultOrigin)
   if(oldAction&&snapshot.content)for(const key of ['action','summary','title','reflection','occurredAt'])if(!protectedField(key)&&!(key==='title'&&protectedField('summary')&&snapshot.content.title===String(snapshot.content.summary).slice(0,36)))snapshot.content[key]=''
   if(oldResult&&snapshot.content&&!protectedField('result'))snapshot.content.result=''
   if(oldAction){delete snapshot.quote;if(snapshot.source){delete snapshot.source.quote;delete snapshot.source.content}}
   if(oldResult){if(snapshot.resultSource){const {messageId,range}=snapshot.resultSource;snapshot.resultSource={messageId,...(range?{range}:{}),redacted:true}}if(snapshot.source?.content)delete snapshot.source.content.result}
   if(matches(snapshot.sourceAnchor)){const {messageId,range}=snapshot.sourceAnchor;snapshot.sourceAnchor={messageId,...(range?{range}:{}),redacted:true}}
   if(Array.isArray(snapshot.sourceCorrections)){
    const removed=snapshot.sourceCorrections.filter(matches)
    snapshot.sourceCorrections=snapshot.sourceCorrections.filter((ref:any)=>!matches(ref))
    snapshot.sourceControls=[...snapshot.sourceControls??[],...removed.flatMap((ref:any)=>sourceControlRanges(messages.get(ref.messageId)??'',ref).map(range=>({messageId:ref.messageId,range}))) ]
   }
   if(JSON.stringify(before)!==JSON.stringify(snapshot))await c.query('UPDATE experience_revisions SET snapshot=$4 WHERE user_id=$1 AND experience_id=$2 AND revision=$3',[user,episode.id,revision.revision,snapshot])
  }
  let revision=episode.revision
  if(JSON.stringify(current)!==JSON.stringify(episode.content)||quote!==episode.source_quote){
   const updated=(await c.query('UPDATE experiences SET content=$3,source_quote=$4,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING revision',[user,episode.id,current,quote])).rows[0]
   revision=updated.revision
   await c.query("INSERT INTO experience_revisions(user_id,experience_id,revision,action,snapshot) VALUES($1,$2,$3,'correct',$4)",[user,episode.id,updated.revision,{content:current,sourceRedacted:true,sourceMessageId:bindings.get(episode.id)?.source?.source_message_id??episode.source_message_id,manualFields:Object.keys(current).filter(currentManual)}])
  }
  const currentSource=bindings.get(episode.id)?.source
  await c.query("UPDATE user_operations SET response=$3 WHERE user_id=$1 AND response->>'id'=$2",[user,episode.id,{...episode,content:current,revision,source_quote:currentSource?.source_quote??(sourceGone?'':quote),...(currentSource?{source_message_id:currentSource.source_message_id}:{})}])
 }
}
const bindingMatches=(binding:ExperienceFactBinding|undefined,action:unknown)=>Boolean(binding?.valid&&typeof action==='string'&&binding.contentHash===createHash('sha256').update(action).digest('hex'))

// Shared by vector caches and in-flight answer evidence. This describes source
// controls only; it does not infer facts or require a new persisted version.
export function sourceBoundaryKey(sourceIds:(string|null)[],refs:SourceControlRef[]){
 const ids=new Set(sourceIds),boundary=[...new Set(refs.filter(ref=>ids.has(ref.messageId)).map(ref=>JSON.stringify([ref.messageId,ref.quote,ref.range??null])))].sort()
 return boundary.length?createHash('sha256').update(JSON.stringify(boundary)).digest('hex'):null
}

// Full-source withdrawals share one availability gate across graph, retrieval,
// memory snapshots and linked summaries. Scoped growth tombstones stay scoped.
export const experienceActionSourceRange=Symbol('experienceActionSourceRange')
export const experienceResultSource=Symbol('experienceResultSource')
export async function filterAvailableExperienceSources<T extends {id:string;source_message_id:string;revision?:number;status?:string;content:any}>(c:DB,user:string,rows:T[]):Promise<T[]> {
 if(!rows.length)return rows
 // Pattern suppression withdraws an interpretation, not its underlying facts.
 const hidden=new Set((await c.query(`SELECT source_message_id AS id FROM memory_suppressions suppression WHERE user_id=$1 AND ${fullMemorySuppressionSql('suppression')} UNION SELECT message_id AS id FROM coach_source_withdrawals WHERE user_id=$1 AND reason='forgotten'`,[user])).rows.map(row=>String(row.id)))
 const withdrawn=new Set((await c.query("SELECT message_id FROM coach_source_withdrawals WHERE user_id=$1 AND reason='corrected'",[user])).rows.map(row=>String(row.message_id)))
 const bindings=await experienceFactBindings(c,user,rows.map(row=>row.id))
 const userConfirmedCandidates=new Set((await c.query("SELECT id FROM experiences WHERE user_id=$1 AND id=ANY($2::uuid[]) AND status='confirmed' AND confirm_source='user'",[user,rows.map(row=>row.id)])).rows.map(row=>String(row.id)))
 const actionCorrections=(await c.query(`SELECT DISTINCT ON (experience_id) experience_id,revision,snapshot FROM experience_revisions WHERE user_id=$1 AND experience_id=ANY($2::uuid[]) AND action='correct' AND snapshot#>>'{correction,version}'='1' AND snapshot#>'{correction,changedFields}' ? 'action' ORDER BY experience_id,revision DESC`,[user,rows.map(row=>row.id)])).rows
 const available=rows.map(row=>{
   const binding=bindings.get(row.id),source=binding&&(['self','joint'].includes(binding.actor)||row.status==='candidate'||userConfirmedCandidates.has(String(row.id)))?binding.source:undefined
  if(!source)return /^\[redacted:[0-9a-f-]+\]$/.test(String((row as any).source_quote??''))?{...row,source_quote:'',...('source_text'in row?{source_text:''}:{})}:row
   return {...row,source_message_id:source.source_message_id,source_quote:source.source_quote,...(binding?.actionRange?{[experienceActionSourceRange]:binding.actionRange}:{}),...('conversation_id'in row?{conversation_id:source.source_conversation_id}:{}),...('conversation_title'in row?{conversation_title:source.source_conversation_title}:{}),...('source_text'in row?{source_text:source.source_quote}:{}),...('source_reported_at'in row?{source_reported_at:source.source_reported_at}:{})}
 }).filter(row=>{
   const binding=bindings.get(row.id)
  const actionCorrection=actionCorrections.find(change=>change.experience_id===row.id)
   const correctedAction=typeof row.content?.action==='string'&&row.content.action.trim()&&actionCorrection?.revision<=row.revision!&&!actionCorrection.snapshot.fromMessageId&&actionCorrection.snapshot?.content?.action===row.content.action
  if(binding&&!binding.valid&&!correctedAction)return false
  if(hidden.has(String(row.source_message_id)))return false
  if(!withdrawn.has(String(row.source_message_id)))return true
  // A direct versioned correction is new testimony for this record alone.
  // It cannot authorize another record sharing the withdrawn old message.
   return Boolean(correctedAction)
 })
 const sourceIds=[...new Set(available.map(row=>String(row.source_message_id)).filter(Boolean))]
 const sourceTexts=new Map<string,string>(sourceIds.length?(await c.query("SELECT id,content FROM messages WHERE user_id=$1 AND id=ANY($2::uuid[]) AND role='user'",[user,sourceIds])).rows.map(row=>[String(row.id),String(row.content)]):[])
 const sourceAvailable:T[]=[]
 for(const row of available){
  const actionCorrection=actionCorrections.find(change=>change.experience_id===row.id)
  const directlyCorrected=Boolean(typeof row.content?.action==='string'&&row.content.action.trim()&&row.revision!==undefined&&actionCorrection&&actionCorrection.revision<=row.revision&&!actionCorrection.snapshot.fromMessageId&&actionCorrection.snapshot?.content?.action===row.content.action)
  if(directlyCorrected){
   // The user's current edit stands on its own. The superseded conversation
   // quote is no longer the source for the displayed action. Replace a
   // summary derived verbatim from that old action, keeping separate fields.
   const oldAction=actionCorrection.snapshot.sourceAnchor?.quote
   const derivedSummary=typeof oldAction==='string'&&row.content.summary===oldAction&&!actionCorrection.snapshot.correction.changedFields.includes('summary')
   const content=derivedSummary?{...row.content,summary:row.content.action,...(row.content.title===oldAction.slice(0,36)?{title:row.content.action.slice(0,36)}:{})}:row.content
   sourceAvailable.push({...row,content,...('source_quote'in row?{source_quote:''}:{}),...('source_text'in row?{source_text:''}:{})})
   continue
  }
  const messageId=String(row.source_message_id),quote=String((row as any).source_quote??''),sourceText=sourceTexts.get(messageId),binding=bindings.get(row.id)
  const storedAction=typeof row.content?.action==='string'?row.content.action:''
  const controlledQuote=binding?.actionQuote&&sourceText?.includes(binding.actionQuote)?binding.actionQuote:storedAction&&sourceText?.includes(storedAction)?storedAction:quote
  // Legacy rows can carry an unverifiable display quote and are projected as
  // such by their readers. Do not silently delete them here; this shared gate
  // only applies an exact scoped control when the quote is anchored in source.
  if(!sourceText||!controlledQuote||!sourceText.includes(controlledQuote)){sourceAvailable.push(row);continue}
  const range=binding?.source?.source_message_id===messageId&&binding.actionQuote===controlledQuote?binding.actionRange:undefined
  if(await growthQuoteSuppressed(c,user,messageId,controlledQuote,sourceText,range)||await messageQuoteCorrected(c,user,messageId,controlledQuote,sourceText,range))continue
  sourceAvailable.push(row)
 }
 const candidateFacts=sourceAvailable.filter(row=>row.status==='candidate').flatMap(row=>{
  const binding=bindings.get(row.id)
  return binding?.valid?[{id:binding.factId,revision:binding.factRevision}]:[]
 })
 if(!candidateFacts.length)return sourceAvailable
 const shadowed=await activeShadowedFactIds(c,user,candidateFacts)
 return sourceAvailable.filter(row=>row.status!=='candidate'||!shadowed.has(bindings.get(row.id)?.factId??''))
}

// Versioned manual corrections invalidate only their original quoted fields.
// Keep this separate from forgetting: the corrected experience itself remains
// readable, while its old message wording is no longer a current fact.
export async function scopedMessageCorrections(c:DB,user:string):Promise<SourceControlRef[]>{
  const rows=(await c.query(`SELECT x AS ref FROM (
    SELECT snapshot FROM experience_revisions WHERE user_id=$1 AND action IN ('correct','delete')
    UNION ALL SELECT snapshot FROM memory_revisions WHERE user_id=$1 AND action='correct'
    UNION ALL SELECT snapshot FROM growth_revisions WHERE user_id=$1 AND action='forget'
    UNION ALL SELECT jsonb_build_object('sourceCorrections',jsonb_build_array(jsonb_build_object('messageId',s->>'id','quote',s->>'quote','range',s->'range')))
      FROM growth_revisions prior CROSS JOIN LATERAL jsonb_array_elements(COALESCE(prior.snapshot->'sources','[]'::jsonb)) s
      WHERE prior.user_id=$1 AND s->>'type'='message' AND prior.snapshot->>'assertion'='user_reported'
      AND EXISTS(SELECT 1 FROM growth_revisions changed WHERE changed.user_id=prior.user_id AND changed.item_id=prior.item_id AND changed.action='correct' AND changed.revision>prior.revision)
    UNION ALL SELECT jsonb_build_object('sourceCorrections',jsonb_build_array(jsonb_build_object('messageId',e.source_message_id,'quote',e.source_quote))) FROM experiences e
      JOIN messages m ON m.user_id=e.user_id AND m.id=e.source_message_id AND m.role='user'
      WHERE e.user_id=$1 AND e.status='deleted' AND btrim(e.source_quote)<>'' AND strpos(m.content,e.source_quote)>0
      AND NOT EXISTS(SELECT 1 FROM experience_revisions d WHERE d.user_id=e.user_id AND d.experience_id=e.id AND d.action='delete' AND d.snapshot ? 'sourceCorrections')
  ) r CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.snapshot->'sourceCorrections','[]'::jsonb)) x`,[user])).rows
  const refs=rows.map(row=>row.ref).filter(ref=>typeof ref.messageId==='string'&&typeof ref.quote==='string'&&ref.quote.trim())
  const controls=(await c.query("SELECT x AS ref FROM (SELECT snapshot FROM growth_revisions WHERE user_id=$1 AND snapshot ? 'sourceControls' UNION ALL SELECT snapshot FROM memory_revisions WHERE user_id=$1 AND action='forget' UNION ALL SELECT snapshot FROM experience_revisions WHERE user_id=$1 AND snapshot ? 'sourceControls') r CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.snapshot->'sourceControls','[]'::jsonb)) x",[user])).rows.map(row=>row.ref)
  const messages=controls.length?(await c.query("SELECT id,content FROM messages WHERE user_id=$1 AND id=ANY($2::uuid[]) AND role='user'",[user,[...new Set(controls.map(ref=>ref.messageId))]])).rows:[]
  for(const ref of controls){const message=messages.find(message=>message.id===ref.messageId);if(message&&ref.range&&Number.isSafeInteger(ref.range.start)&&Number.isSafeInteger(ref.range.end)&&ref.range.start>=0&&ref.range.end>ref.range.start&&ref.range.end<=message.content.length)refs.push({...ref,quote:message.content.slice(ref.range.start,ref.range.end)})}
  return refs
}
export async function messageQuoteCorrected(c:DB,user:string,messageId:string,quote:string,sourceText?:string,range?:{start:number;end:number}){
  const text=sourceText??(await c.query("SELECT content FROM messages WHERE user_id=$1 AND id=$2 AND role='user'",[user,messageId])).rows[0]?.content??''
  return Boolean(quote.trim()&&(await scopedMessageCorrections(c,user)).some(ref=>ref.messageId===messageId&&sourceQuotesOverlap(text,{quote,...(range?{range}:{})},ref)))
}

export async function coachSourceBoundaryRefs(c:DB,user:string):Promise<SourceControlRef[]>{
 const suppressed=(await c.query('SELECT message_id AS "messageId",quote FROM growth_source_suppressions WHERE user_id=$1',[user])).rows as {messageId:string;quote:string}[]
 return [...await scopedMessageCorrections(c,user),...suppressed].filter(ref=>typeof ref.messageId==='string'&&typeof ref.quote==='string'&&ref.quote.trim())
}

// Model/current-understanding projection only. Keep original records and their
// source quotes unchanged for history, review and revision validation.
export async function currentExperienceEvidence<T extends {id:string;content:any;quote?:string;source_quote?:string}>(c:DB,user:string,rows:T[]){
  if(!rows.length)return rows.map(row=>({...row,correctionProjection:false}))
  const changes=(await c.query(`SELECT r.experience_id,r.snapshot,COALESCE(r.snapshot#>>'{sourceAnchor,quote}',e.source_quote) AS original_quote,COALESCE(r.snapshot#>>'{sourceAnchor,messageId}',e.source_message_id::text) AS original_message_id,r.snapshot#>'{sourceAnchor,range}' AS original_range,m.content AS original_message
    FROM experience_revisions r JOIN experiences e ON e.user_id=r.user_id AND e.id=r.experience_id
    JOIN messages m ON m.user_id=e.user_id AND m.id::text=COALESCE(r.snapshot#>>'{sourceAnchor,messageId}',e.source_message_id::text) AND m.role='user'
    WHERE r.user_id=$1 AND r.experience_id=ANY($2::uuid[]) AND r.action='correct' AND r.snapshot->'sourceCorrections' IS NOT NULL ORDER BY r.revision`,[user,rows.map(row=>row.id)])).rows
  return rows.map(row=>{
    const revisions=changes.filter(change=>change.experience_id===row.id)
    const refs=revisions.flatMap(change=>Array.isArray(change.snapshot?.sourceCorrections)?change.snapshot.sourceCorrections:[]).filter(ref=>typeof ref.quote==='string'&&ref.quote.trim())
    if(!revisions.length)return {...row,correctionProjection:false}
    const current=(value:unknown)=>{
      if(typeof value!=='string')return value
      const original = revisions[0]?.original_quote
      const authorized = typeof original === 'string' && revisions[0]?.original_message?.includes(original)
      const clauses=scanUserClauses(value),keep=clauses.filter(clause=>authorized && original.includes(clause.text) && !refs.some(ref=>ref.messageId===revisions[0]?.original_message_id&&sourceQuotesOverlap(revisions[0].original_message,clause.text,ref,{quote:original,range:revisions[0].original_range??undefined})))
      return keep.length===clauses.length?value:keep.map(clause=>clause.text).join('；')
    }
    const field=(key:string)=>{
      const latest=[...revisions].reverse().find(change=>change.snapshot?.correction?.changedFields?.includes(key))
      return latest&&latest.snapshot.content?.[key]===row.content?.[key]?row.content[key]:current(row.content?.[key])
    }
    const content={...row.content,title:'',summary:field('summary'),action:field('action'),result:field('result'),reflection:field('reflection')}
    const text=[...new Set([content.summary,content.action,content.result,content.reflection].filter(value=>typeof value==='string'&&value.trim()))].join('；')
    return {...row,content,quote:text,source_quote:text,correctionProjection:true,correctionBasis:'本人版本化更正后的当前字段；旧标题和摘要中的失效陈述不作当前事实'}
  })
}

export async function growthQuoteSuppressed(c:DB,user:string,messageId:string,quote:string,sourceText?:string,range?:{start:number;end:number}) {
  const text=sourceText??(await c.query("SELECT content FROM messages WHERE user_id=$1 AND id=$2 AND role='user'",[user,messageId])).rows[0]?.content??''
  return (await c.query('SELECT quote FROM growth_source_suppressions WHERE user_id=$1 AND message_id=$2',[user,messageId])).rows.some(row=>sourceQuotesOverlap(text,{quote,...(range?{range}:{})},row.quote))
}
// All experience readers use the same source projection. A later result keeps
// its own source; withdrawing it blanks only that field, never restores an
// older outcome or erases the independently sourced original episode.
export async function redactExperienceResultSources(c:DB,user:string,rows:any[]){
  if(!rows.length)return rows
  const revisions=(await c.query(`SELECT DISTINCT ON (r.experience_id) r.experience_id,r.snapshot || CASE WHEN r.snapshot ? 'resultSource' THEN jsonb_build_object('fromMessageId',r.snapshot#>>'{resultSource,messageId}','quote',r.snapshot#>>'{resultSource,quote}') ELSE '{}'::jsonb END AS snapshot,m.conversation_id AS result_conversation_id
    FROM experience_revisions r LEFT JOIN messages m ON m.user_id=r.user_id AND m.id::text=COALESCE(r.snapshot#>>'{resultSource,messageId}',r.snapshot->>'fromMessageId') AND m.role='user'
    WHERE r.user_id=$1 AND r.experience_id=ANY($2::uuid[]) AND ((r.action='correct' AND r.snapshot#>>'{correction,version}'='1' AND r.snapshot#>'{correction,changedFields}' ? 'result') OR (r.action IN ('propose','correct') AND r.snapshot ? 'resultSource'))
    ORDER BY r.experience_id,r.revision DESC`,[user,rows.map(row=>row.id)])).rows
  const byId=new Map(revisions.map(row=>[row.experience_id,row]))
  const projected=[]
  for(const row of rows){
    const revision=byId.get(row.id),source=revision?.snapshot?.fromMessageId,quote=revision?.snapshot?.quote
    if(!source||revision.snapshot.content?.result!==row.content?.result){projected.push(row);continue}
    const range=revision.snapshot.resultSource?.range
    let evidence:(SourceControlRef&{reportedAt:Date})|undefined
    if(revision.result_conversation_id&&typeof quote==='string'&&quote.length>0){
      try{
        const verified=await checkMessageSource(c,user,revision.result_conversation_id,{id:source,quote,range})
        evidence={messageId:source,quote,range,reportedAt:verified.created_at}
      }catch(error){if(!(error instanceof HttpError))throw error}
    }
    projected.push(evidence?{...row,result_source_message_id:source,[experienceResultSource]:evidence}:{...row,content:{...row.content,result:''}})
  }
  return projected
}
export async function redactGrowthHistory<T extends DialogueMessage>(user:string,messages:T[]):Promise<T[]> {
  if(!messages.length)return messages
  const suppressions=(await pool.query('SELECT s.message_id,s.quote,m.run_request_id FROM growth_source_suppressions s JOIN messages m ON m.user_id=s.user_id AND m.id=s.message_id WHERE s.user_id=$1',[user])).rows
  const corrections=await scopedMessageCorrections(pool,user)
  if(corrections.length){
    const runs=new Map((await pool.query('SELECT id,run_request_id FROM messages WHERE user_id=$1 AND id=ANY($2::uuid[])',[user,[...new Set(corrections.map(ref=>ref.messageId))]])).rows.map(row=>[row.id,row.run_request_id]))
    suppressions.push(...corrections.map(ref=>({message_id:ref.messageId,quote:ref.quote,range:ref.range,run_request_id:runs.get(ref.messageId)})))
  }
  if(!suppressions.length)return messages
  const derivedRuns=(await pool.query("SELECT origin_request_id FROM growth_items WHERE user_id=$1 AND text='' AND status IN ('forgotten','stale') AND origin_request_id IS NOT NULL",[user])).rows
  const hiddenRuns=[...new Set([...suppressions.map(row=>row.run_request_id),...derivedRuns.map(row=>row.origin_request_id)])]
  const hiddenAssistantIds=new Set((await pool.query("SELECT id FROM messages WHERE user_id=$1 AND role='assistant' AND run_request_id=ANY($2::uuid[])",[user,hiddenRuns])).rows.map(row=>row.id))
  return messages.filter(message=>!hiddenAssistantIds.has(message.id)).map(message=>{
    let content=message.content
    if(message.role==='assistant'){
      for(const row of suppressions)content=content.split(row.quote).join('[这项信息已停止使用]')
      return {...message,content}
    }
    const spans=suppressions.filter(row=>row.message_id===message.id).flatMap(row=>sourceControlRanges(message.content,row)).sort((a,b)=>a.start-b.start||b.end-a.end)
    const merged:{start:number;end:number}[]=[]
    for(const span of spans){const prior=merged.at(-1);if(prior&&span.start<=prior.end)prior.end=Math.max(prior.end,span.end);else merged.push({...span})}
    for(const span of merged.reverse())content=content.slice(0,span.start)+'[这项信息已停止使用]'+content.slice(span.end)
    return {...message,content}
  })
}
