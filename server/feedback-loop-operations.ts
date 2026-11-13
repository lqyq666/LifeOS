import {createHash} from 'node:crypto'
import {pool,HttpError} from './db.ts'
import {coachEventView,visibleCoachQuestions} from './action-coach-events.ts'

export type LoopReview={userId:string;eventId:string;sourceDigest:string;understandingRequestId:string;understandingReplySha256:string;nextHelpRequestId:string;nextHelpReplySha256:string;effective:boolean;reason:string;extraRequestIds?:string[];questionJudgments?:{requestId:string;replySha256:string;unnecessary:boolean;repeated:boolean;reason:string}[]}
export type LoopObservation={users:string[];from:string;to:string;reviews?:LoopReview[]}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const runKey=(userId:string,requestId:string)=>JSON.stringify([userId,requestId])
const instant=(value:string|Date)=>value instanceof Date?value.getTime():Date.parse(value)
export async function feedbackLoopStats(input:LoopObservation){
 const start=Date.parse(input.from),end=Date.parse(input.to)
 if(!input.users.length||input.users.length>50||new Set(input.users).size!==input.users.length||input.users.some(user=>typeof user!=='string'||!user||user.length>128)||![input.from,input.to].every(value=>/(?:Z|[+-]\d{2}:\d{2})$/.test(value))||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new HttpError(400,'LOOP_OBSERVATION_INVALID')
 const rows=(await pool.query("SELECT user_id,id,conversation_id FROM coach_events WHERE user_id=ANY($1::text[]) AND status='active' AND created_at<$2 ORDER BY user_id,id",[input.users,input.to])).rows
 const trace:{userId:string;eventId:string;sourceDigest:string;acceptedSourceMessageId:string;acceptedReportedAt:string;feedbackSourceMessageIds:string[];relatedRequestIds:string[];reviewStatus:'missing'|'verified'|'invalid'|'no_feedback';reviewedEffective:boolean|null}[]=[]
 const excluded:{eventId:string;reason:string}[]=[]
 for(const row of rows){
  let event
  try{event=await coachEventView(row.user_id,row.conversation_id,row.id)}catch(error){
   if(!(error instanceof HttpError)||!['NOT_FOUND','COACH_SOURCE_REVOKED','MEMORY_DISABLED'].includes(error.code))throw error
   excluded.push({eventId:row.id,reason:error.code});continue
  }
  const reports=(event?.matterProgress?.reports??[]).filter(report=>Date.parse(report.reportedAt)<end)
  const accepted=reports.find(report=>report.choice==='accepted'&&Date.parse(report.reportedAt)>=start)
  if(!event||!accepted)continue
  const feedback=reports.filter(report=>report.sourceMessageId!==accepted.sourceMessageId&&Date.parse(report.reportedAt)>=Date.parse(accepted.reportedAt)&&Date.parse(report.reportedAt)<end&&report.state&&['unattempted','attempted','partial','waiting_result','adjusted','paused','ended','completed','blocked'].includes(report.state))
  trace.push({userId:row.user_id,eventId:event.id,sourceDigest:digest({userId:row.user_id,eventId:event.id,generation:event.generation,reports,nodes:event.nodes.map(node=>[node.id,node.revision,node.status,node.content,node.source])}),acceptedSourceMessageId:accepted.sourceMessageId,acceptedReportedAt:accepted.reportedAt,feedbackSourceMessageIds:[...new Set(feedback.map(report=>report.sourceMessageId))],relatedRequestIds:[],reviewStatus:'missing',reviewedEffective:null})
 }
 // Context binding establishes traceability only. A separate, source-bound
 // semantic assessment must establish updated understanding and changed help.
 const runs=(await pool.query(`SELECT r.user_id,r.request_id,r.source_message_id,r.conversation_id,r.started_at,r.status,r.usage,r.tool_audit,r.response,
   (SELECT m.content FROM messages m WHERE m.user_id=r.user_id AND m.run_request_id=r.request_id AND m.role='assistant') AS reply
   FROM runs r WHERE r.user_id=ANY($1::text[]) AND r.started_at<$2 ORDER BY r.started_at,r.request_id`,[input.users,input.to])).rows
 const revisions=(await pool.query('SELECT user_id,event_id,request_id FROM coach_event_revisions WHERE user_id=ANY($1::text[]) AND created_at<$2',[input.users,input.to])).rows
 const sha=(text:string)=>createHash('sha256').update(text).digest('hex')
 const questionTurns=new Map<string,{requestId:string;replySha256:string;questions:string[];reviews:{unnecessary:boolean;repeated:boolean;reason:string}[]}>()
 const relatedIds=new Set<string>()
 for(const item of trace){
  const direct=new Set(revisions.filter(row=>row.user_id===item.userId&&row.event_id===item.eventId).map(row=>String(row.request_id)))
  const supplied=(run:any)=>Array.isArray(run.tool_audit)&&run.tool_audit.some((audit:any)=>audit.phase==='coach_context_bound'&&audit.eventRefs?.some((ref:any)=>ref.eventId===item.eventId))
  const assessments=(input.reviews??[]).filter(review=>review.userId===item.userId&&review.eventId===item.eventId)
  const review=assessments.length===1?assessments[0]:undefined
  const extra=new Set(review?.extraRequestIds??[])
  const related=runs.filter(run=>run.user_id===item.userId&&(direct.has(run.request_id)||supplied(run)||extra.has(run.request_id)))
  item.relatedRequestIds=related.map(run=>run.request_id);for(const id of item.relatedRequestIds)relatedIds.add(runKey(item.userId,id))
  const before=related.find(run=>run.request_id===review?.understandingRequestId),after=related.find(run=>run.request_id===review?.nextHelpRequestId)
  const valid=Boolean(review&&review.sourceDigest===item.sourceDigest&&typeof review.effective==='boolean'&&review.reason?.trim()
   &&before?.status==='completed'&&after?.status==='completed'&&typeof before.reply==='string'&&typeof after.reply==='string'
   &&item.feedbackSourceMessageIds.includes(before.source_message_id)&&before.request_id!==after.request_id
   &&instant(after.started_at)>instant(before.started_at)&&before.conversation_id!==after.conversation_id
   &&sha(before.reply)===review.understandingReplySha256&&sha(after.reply)===review.nextHelpReplySha256)
  item.reviewStatus=!item.feedbackSourceMessageIds.length?'no_feedback':valid?'verified':assessments.length?'invalid':'missing';item.reviewedEffective=!item.feedbackSourceMessageIds.length?false:valid?review!.effective:null
  for(const run of related){
   if(run.status!=='completed'||typeof run.reply!=='string'||instant(run.started_at)<Math.max(start,Date.parse(item.acceptedReportedAt)))continue
   const material=run.response?.event?.actions?.find((action:any)=>action.status==='proposed')?.draft?.content
   const questions=visibleCoachQuestions(run.reply,typeof material==='string'?material:undefined)
   if(!questions.length)continue
   const key=runKey(run.user_id,run.request_id),current=questionTurns.get(key)??{requestId:run.request_id,replySha256:sha(run.reply),questions,reviews:[] as {unnecessary:boolean;repeated:boolean;reason:string}[]}
   if(valid)for(const judgment of review!.questionJudgments??[])if(judgment.requestId===run.request_id&&judgment.replySha256===current.replySha256&&typeof judgment.unnecessary==='boolean'&&typeof judgment.repeated==='boolean'&&judgment.reason?.trim())current.reviews.push({unnecessary:judgment.unnecessary,repeated:judgment.repeated,reason:judgment.reason})
   questionTurns.set(key,current)
  }
 }
 const reviewedQuestionTurns=[...questionTurns.values()].map(turn=>({...turn,judgment:turn.reviews.length&&turn.reviews.every(review=>review.unnecessary===turn.reviews[0].unnecessary&&review.repeated===turn.reviews[0].repeated)?turn.reviews[0].unnecessary&&turn.reviews[0].repeated:null}))
 const unknownQuestionTurns=reviewedQuestionTurns.filter(turn=>turn.judgment===null).length
 const literalRepeatCandidates:{eventId:string;requestId:string;questionSha256:string}[]=[]
 for(const item of trace){
  const seen=new Set<string>()
  for(const id of item.relatedRequestIds){
   for(const question of questionTurns.get(runKey(item.userId,id))?.questions??[]){
    const normalized=question.replace(/[\s，。！？、,.;!?：:“”「」]/g,'')
    if(seen.has(normalized))literalRepeatCandidates.push({eventId:item.eventId,requestId:id,questionSha256:sha(normalized)})
    seen.add(normalized)
   }
  }
 }
 // Include failed attempts and repairs, as well as unrelated observed calls in
 // this explicit cohort. Shared requests are counted once, never once per node.
 const observed=runs.filter(run=>instant(run.started_at)>=start||relatedIds.has(runKey(run.user_id,run.request_id)))
 const spend=(await pool.query('SELECT user_id,request_id,call_index,status,settled_cny,provider,model,created_at FROM lifeos_provider_spend WHERE user_id=ANY($1::text[]) AND created_at<$2',[input.users,input.to])).rows
 let knownCost=0,unknownCostRequests=0
 const receipts=observed.map(run=>{
  const calls=spend.filter(row=>row.user_id===run.user_id&&row.request_id===run.request_id)
  const known=calls.reduce((sum,row)=>sum+(row.settled_cny===null?0:Number(row.settled_cny)),0)
  const unknown=calls.some(row=>row.settled_cny===null)||run.usage?.llmCallCount>calls.length||(!calls.length&&run.usage?.llmCallCount!==0&&run.usage?.zeroLlm!==true)
  knownCost+=known;if(unknown)unknownCostRequests++
  return {userId:run.user_id,requestId:run.request_id,status:run.status,calls:calls.length,knownCny:known,unknown,associatedWithAcceptedMatter:relatedIds.has(runKey(run.user_id,run.request_id))}
 })
 const observedIds=new Set(observed.map(run=>runKey(run.user_id,run.request_id)))
 for(const key of new Set<string>(spend.filter(row=>!observedIds.has(runKey(row.user_id,row.request_id))&&instant(row.created_at)>=start&&instant(row.created_at)<end).map(row=>runKey(row.user_id,row.request_id)))){
  const [userId,requestId]=JSON.parse(key) as [string,string]
  const calls=spend.filter(row=>row.user_id===userId&&row.request_id===requestId),known=calls.reduce((sum,row)=>sum+(row.settled_cny===null?0:Number(row.settled_cny)),0),unknown=calls.some(row=>row.settled_cny===null)
  knownCost+=known;if(unknown)unknownCostRequests++
  receipts.push({userId,requestId,status:'provider_receipt_without_chat_run',calls:calls.length,knownCny:known,unknown,associatedWithAcceptedMatter:false})
 }
 const feedbackMatters=trace.filter(item=>item.feedbackSourceMessageIds.length).length
 const effectiveClosedLoops=trace.some(item=>item.reviewedEffective===null)?null:trace.filter(item=>item.reviewedEffective).length
 const round=(value:number)=>Math.round(value*1e8)/1e8
 return {observation:{fromInclusive:input.from,toExclusive:input.to,timeBasis:'UTC instants; first explicit acceptance within [from,to), including renewed consent; each matter once per window; subsequent feedback before to; sources reflect current privacy and correction state, not an historical as-of snapshot',capturedAt:new Date().toISOString(),users:input.users.length},acceptedMatters:trace.length,feedbackMatters,feedbackRate:{numerator:feedbackMatters,denominator:trace.length,value:trace.length?feedbackMatters/trace.length:null},effectiveClosedLoops,verifiedEffectiveClosedLoops:trace.filter(item=>item.reviewedEffective===true).length,unreviewedMatters:trace.filter(item=>item.reviewedEffective===null).length,costPerClosedLoopCny:effectiveClosedLoops&&!unknownCostRequests?round(knownCost/effectiveClosedLoops):null,billing:{knownCny:round(knownCost),totalCny:unknownCostRequests?null:round(knownCost),unknownCostRequests,receipts,costScope:'all observed cohort runs in period plus linked earlier preparation, including failed and repair calls; provider receipts created before observation end, settlement at capture; missing expected call receipts remain unknown'},unnecessaryRepeatedQuestions:unknownQuestionTurns?null:reviewedQuestionTurns.filter(turn=>turn.judgment===true).length,questionReview:{denominator:'completed assistant question turns linked to accepted matters, in period and after this window acceptance',total:questionTurns.size,unreviewed:unknownQuestionTurns,reviewed:questionTurns.size-unknownQuestionTurns,rate:questionTurns.size&&!unknownQuestionTurns?reviewedQuestionTurns.filter(turn=>turn.judgment).length/questionTurns.size:null,literalRepeatCandidates,turns:reviewedQuestionTurns.map(({questions,reviews,...turn})=>({...turn,questionSha256:questions.map(sha)}))},trace,excluded,scope:'semantic loop effectiveness and unnecessary-question judgments are explicit operator reviews bound to source and reply hashes; provided context alone is not value; no retention or revenue claim'}
}
