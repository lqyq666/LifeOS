import type {PoolClient} from 'pg'
import {pool,HttpError,requireRow} from './db.ts'
import type {CampusSource,Inquiry,InquiryPayload,EvidenceLink} from './campus-contracts.ts'
import type {KnowledgeRecord} from './campus-knowledge.ts'
// Saved V1.2 records are read-only. New writes use action-coach-events.ts.
type DB=Pick<PoolClient,'query'>
async function owner(c:DB,user:string,conversation:string){requireRow((await c.query('SELECT id FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0])}
async function settings(c:DB,user:string){return (await c.query('SELECT enabled FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]?.enabled===true}
function allLinks(payload:InquiryPayload):EvidenceLink[]{
  return [...payload.evidence,...payload.opportunities.flatMap(item=>item.evidence),...payload.hypotheses.flatMap(item=>item.evidence)]
}
function allSources(payload:InquiryPayload):CampusSource[]{return [payload.questionSource,...payload.studentContext.map(item=>item.source),...allLinks(payload).map(item=>item.source)]}
function activeSources(payload:InquiryPayload):CampusSource[]{return [payload.questionSource,...payload.studentContext.map(item=>item.source),...payload.evidence.map(item=>item.source),...payload.opportunities.flatMap(item=>item.evidence.map(link=>link.source)),...payload.hypotheses.filter(item=>!['rejected','stale'].includes(item.status)).flatMap(item=>item.evidence.map(link=>link.source))]}
const sourceKey=(ref:CampusSource)=>JSON.stringify([ref.type,ref.id,'revision' in ref?ref.revision:null,ref.quote])
export async function checkCampusSource(c:DB,user:string,conversation:string,enabled:boolean,ref:CampusSource,locking=false){
  if(typeof ref.quote!=='string'||!ref.quote.trim())throw new HttpError(400,'CAMPUS_SOURCE_INVALID')
  const share=locking?' FOR SHARE':''
  if(ref.type==='message'){
    const source=(await c.query("SELECT content,conversation_id FROM messages WHERE user_id=$1 AND id=$2 AND role='user'"+share,[user,ref.id])).rows[0]
    if(!source||source.conversation_id!==conversation||!ref.quote.trim()||!source.content.includes(ref.quote))throw new HttpError(400,'CAMPUS_MESSAGE_SOURCE_INVALID')
    const suppressed=(await c.query('SELECT 1 FROM memory_suppressions WHERE user_id=$1 AND source_message_id=$2 LIMIT 1',[user,ref.id])).rowCount
    if(suppressed)throw new HttpError(400,'CAMPUS_SOURCE_FORGOTTEN')
    if((await c.query('SELECT 1 FROM coach_source_withdrawals WHERE user_id=$1 AND message_id=$2',[user,ref.id])).rowCount)throw new HttpError(400,'CAMPUS_SOURCE_FORGOTTEN')
    if((await c.query("SELECT 1 FROM experiences WHERE user_id=$1 AND source_message_id=$2 AND status='deleted' LIMIT 1",[user,ref.id])).rowCount)throw new HttpError(400,'CAMPUS_SOURCE_DELETED')
    return {label:'本段对话',text:ref.quote,verified:false}
  }
  if(ref.type==='knowledge'){
    const source=(await c.query('SELECT * FROM campus_knowledge WHERE id=$1'+share,[ref.id])).rows[0] as KnowledgeRecord|undefined
    if(!source||source.revision!==ref.revision||source.status!=='verified'||source.valid_until&&Date.parse(String(source.valid_until))<=Date.now())throw new HttpError(400,'CAMPUS_KNOWLEDGE_STALE')
    if(!source.payload.excerpt.includes(ref.quote)&&!source.payload.claim.includes(ref.quote))throw new HttpError(400,'CAMPUS_KNOWLEDGE_QUOTE_INVALID')
    return {label:source.kind==='policy'?'有范围的规则':source.kind==='case'?'外部案例':'外部方法',text:ref.quote,url:source.payload.url,scope:source.payload.scope,limitations:source.payload.limitations,verified:true,synthetic:source.synthetic}
  }
  if(ref.type==='experience'){
    const source=(await c.query('SELECT * FROM experiences WHERE user_id=$1 AND id=$2'+share,[user,ref.id])).rows[0]
    if(source?.status==='deleted')throw new HttpError(400,'CAMPUS_SOURCE_DELETED')
    if(!source||source.status!=='confirmed'||source.revision!==ref.revision)throw new HttpError(400,'CAMPUS_EXPERIENCE_STALE')
    if(source.conversation_id!==conversation&&!enabled)throw new HttpError(400,'CAMPUS_MEMORY_DISABLED')
    const validText=[source.content?.summary,source.content?.action,source.content?.result,source.content?.reflection].filter(value=>typeof value==='string')
    // A corrected experience's current content takes precedence over the historical source quote.
    if(!validText.some(value=>value.includes(ref.quote)))throw new HttpError(400,'CAMPUS_EXPERIENCE_QUOTE_INVALID')
    return {label:'你的经历',text:ref.quote,verified:false}
  }
  const source=(await c.query("SELECT * FROM memory_items WHERE user_id=$1 AND id=$2 AND kind='fact'"+share,[user,ref.id])).rows[0]
  if(source?.status==='revoked')throw new HttpError(400,'CAMPUS_MEMORY_FORGOTTEN')
  if(!enabled)throw new HttpError(400,'CAMPUS_MEMORY_DISABLED')
  if(!source)throw new HttpError(400,'CAMPUS_MEMORY_STALE')
  if(source.status!=='active'||source.revision!==ref.revision||source.valid_until&&Date.parse(source.valid_until)<=Date.now())throw new HttpError(400,'CAMPUS_MEMORY_STALE')
  if(source.scope==='task'&&!source.source_refs.some((item:any)=>item.conversationId===conversation))throw new HttpError(400,'CAMPUS_TASK_MEMORY_OUT_OF_SCOPE')
  if(typeof source.value!=='string'||!source.value.includes(ref.quote))throw new HttpError(400,'CAMPUS_MEMORY_QUOTE_INVALID')
  return {label:'已保存背景',text:ref.quote,verified:false}
}
async function sourceState(c:DB,user:string,conversation:string,enabled:boolean,inquiry:Inquiry){
  const sources=[]
  let stale=inquiry.stale
  let redactedForRevocation=false
  const active=new Set(activeSources(inquiry.payload).map(sourceKey))
  for(const ref of allSources(inquiry.payload)){
    try{sources.push({source:ref,...await checkCampusSource(c,user,conversation,enabled,ref),valid:true})}
    catch(error){if(!(error instanceof HttpError))throw error;if(active.has(sourceKey(ref))&&error.code!=='CAMPUS_MEMORY_DISABLED')stale=true;if(['CAMPUS_MEMORY_FORGOTTEN','CAMPUS_SOURCE_FORGOTTEN','CAMPUS_SOURCE_DELETED'].includes(error.code))redactedForRevocation=true;const label=error.code==='CAMPUS_MEMORY_FORGOTTEN'||error.code==='CAMPUS_SOURCE_FORGOTTEN'?'你已忘记这条依据':error.code==='CAMPUS_MEMORY_DISABLED'?'长期记忆已关闭':error.code==='CAMPUS_KNOWLEDGE_STALE'?'外部资料版本或有效期已变化':error.code==='CAMPUS_EXPERIENCE_STALE'||error.code==='CAMPUS_EXPERIENCE_QUOTE_INVALID'?'这段经历已更正或撤回':error.code==='CAMPUS_SOURCE_DELETED'?'这段来源已删除':'原依据已更正、删除或失效';sources.push({source:{type:ref.type,id:ref.id,...('revision' in ref?{revision:ref.revision}:{})},valid:false,label})}
  }
  for(const experiment of inquiry.payload.experiments)if(experiment.result&&!experiment.result.invalidated){const reason=await resultInvalidation(c,user,experiment.result);if(reason)stale=true;if(reason==='forgotten'||reason==='removed')redactedForRevocation=true}
  return {stale,sources,redactedForRevocation}
}
async function resultInvalidation(c:DB,user:string,result:NonNullable<InquiryPayload['experiments'][number]['result']>):Promise<'forgotten'|'corrected'|'removed'|null>{
  const message=(await c.query("SELECT conversation_id FROM messages WHERE user_id=$1 AND id=$2 AND role='user'",[user,result.source.id])).rows[0]
  if(!message)return 'removed'
  if((await c.query('SELECT 1 FROM memory_suppressions WHERE user_id=$1 AND source_message_id=$2 LIMIT 1',[user,result.source.id])).rowCount)return 'forgotten'
  if((await c.query('SELECT 1 FROM coach_source_withdrawals WHERE user_id=$1 AND message_id=$2',[user,result.source.id])).rowCount)return 'forgotten'
  if((await c.query("SELECT 1 FROM experiences WHERE user_id=$1 AND source_message_id=$2 AND status='deleted' LIMIT 1",[user,result.source.id])).rowCount)return 'removed'
  if(result.candidateId){
    const candidate=(await c.query('SELECT status,content FROM experiences WHERE user_id=$1 AND id=$2',[user,result.candidateId])).rows[0]
    if(!candidate||candidate.status==='deleted')return 'removed'
    if(candidate.status==='revoked')return 'forgotten'
    if(candidate.content?.summary!==result.text)return 'corrected'
  }
  return null
}
export async function campusView(user:string,conversation:string){
  await owner(pool,user,conversation)
  const enabled=await settings(pool,user)
  const current=(await pool.query('SELECT inquiry_id FROM campus_current WHERE user_id=$1 AND conversation_id=$2',[user,conversation])).rows[0]?.inquiry_id??null
  const rows=(await pool.query('SELECT * FROM campus_inquiries WHERE user_id=$1 AND (conversation_id=$2 OR $3) ORDER BY updated_at DESC LIMIT 30',[user,conversation,enabled])).rows as Inquiry[]
  const inquiries=[]
  const reportedInquiryIds=new Set<string>()
  for(const row of rows){
    const validity=await sourceState(pool,user,row.conversation_id,enabled,row)
    if(validity.redactedForRevocation){
      const payload:InquiryPayload={domain:row.payload.domain,question:'这条历史记录的依据已被忘记或撤回，内容已隐藏。',questionSource:{...row.payload.questionSource,quote:'[已隐藏]'},criteria:[],readiness:'clarify',questions:[],studentContext:[],pathways:[],opportunities:[],evidence:[],hypotheses:[],experiments:[],changes:[]}
      inquiries.push({...row,payload,stale:true,stale_reason:'source_revoked',sources:[],redactedForRevocation:true})
      continue
    }
    const experiments=[]
    for(const action of row.payload.experiments){
      const reason=action.result&&!action.result.invalidated?await resultInvalidation(pool,user,action.result):null
      experiments.push(reason?{...action,result:{...action.result!,text:'',source:{...action.result!.source,quote:'[已隐藏]'},invalidated:true,invalidationReason:reason}}:action)
    }
    const hiddenReportIds=new Set(experiments.flatMap(item=>item.result?.invalidated?[item.result.source.id]:[]))
    const changes=row.payload.changes.filter(change=>!change.sourceMessageId||!hiddenReportIds.has(change.sourceMessageId))
    const payload={...row.payload,changes,hypotheses:validity.stale?row.payload.hypotheses.map(item=>item.status==='rejected'||item.status==='stale'?item:{...item,status:'stale' as const}):row.payload.hypotheses,experiments:validity.stale?experiments.map(item=>item.status==='reported'?item:{...item,needsReview:true}):experiments}
    inquiries.push({...row,payload,stale:validity.stale,sources:validity.sources,redactedForRevocation:false})
    if(!current&&enabled)for(const action of experiments)if(action.result?.source.type==='message'&&!action.result.invalidated&&(await pool.query('SELECT 1 FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role=\'user\'',[user,conversation,action.result.source.id])).rowCount)reportedInquiryIds.add(row.id)
  }
  return {currentId:current,reportedInquiryId:reportedInquiryIds.size===1?[...reportedInquiryIds][0]:null,inquiries,memoryEnabled:enabled}
}
