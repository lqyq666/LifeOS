import {createHash} from 'node:crypto'
import {Type} from 'typebox'
import {pool,transaction,HttpError,requireRow} from '../db.ts'
import {validate} from '../contracts.ts'
import {config} from '../config.ts'
import {RequestScheduler} from '../request-scheduler.ts'
import {entitlementView} from '../entitlements.ts'
import {growthView,growthSnapshotKey} from '../growth.ts'
import {selectRelevantGrowth} from '../growth-selection.ts'
import {loadSnapshot} from '../memory.ts'
import * as store from '../store.ts'
import {weeklyPlanIntent,applicableTimeBudget} from '../turn-obligations.ts'
import {resolveTimeWindow} from '../growth-time.ts'
import {scanUserClauses,currentConversationOnly} from '../user-command-spans.ts'
import {WorkflowError,parseRequest,type WorkflowRequest,type WorkflowReceipt} from './contracts.ts'
import {validateEvidence,validateProposal} from './evidence-gate.ts'
import {workflowControls,readWorkflowEvidence,selectWorkflowBudget} from './task-sources.ts'
import {workflowRuntimeVersion,workflowAdoptionVersionDigest} from './runtime-version.ts'
import {createDirectionWorkflow,type DecisionAdapter} from './direction-decision.ts'
import {createRuntimeDecisionAdapter} from './provider-adapter.ts'
import {configuredCozeDirectionAdapter} from './coze-direction-adapter.ts'
import {workflowMethodReader} from './method-context.ts'
import {postgresJournal} from './task-journal.ts'
import {advancedWorkflowsEnabled} from './router.ts'
import {workflowReceiptDigest} from './task-commit.ts'
import {assertCoachKnowledge} from '../coach-knowledge.ts'

const id=Type.String({pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'})
export const directionLabels={employment:'就业与实习',postgraduate_exam:'考研',postgraduate_recommendation:'保研',entrepreneurship:'创业',independent_development:'独立开发',freelance:'自由职业',overseas_study:'留学',public_service:'考公考编',undergraduate_upgrade:'专升本'} as const
const directionIds=Object.keys(directionLabels) as (keyof typeof directionLabels)[]
export const deepTaskSchema=Type.Object({requestId:id,conversationId:id,currentMessageId:id,directions:Type.Array(Type.Union(directionIds.map(x=>Type.Literal(x))),{minItems:2,maxItems:3,uniqueItems:true}),consent:Type.Literal(true)},{additionalProperties:false})
export const taskActionSchema=Type.Object({requestId:id,conversationId:id,kind:Type.Union([Type.Literal('action'),Type.Literal('direction'),Type.Literal('reject')]),index:Type.Integer({minimum:0,maximum:5})},{additionalProperties:false})
const resumeTaskSchema=Type.Object({conversationId:id,currentMessageId:id},{additionalProperties:false})
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function createWorkflowHost(options:{adapter?:DecisionAdapter;synthetic?:boolean;comparisonMode?:()=>'single'|'multi'}={}){
 const durableJournal=postgresJournal(),methodRefs=new Map<string,{sourceId:string;revision:number}[]>(),methodReader=workflowMethodReader()
 const readMethods=async(r:WorkflowRequest)=>{const methods=await methodReader(r);methodRefs.set(r.internalActorKey+':'+r.requestId,methods.map(m=>({sourceId:m.id as string,revision:m.revision as number})));return methods}
 const journal={...durableJournal,async finish(r:WorkflowRequest,receipt:WorkflowReceipt){receipt.adoptionVersionDigest=r.hostSnapshot?.adoptionVersionDigest;if(receipt.status==='proposed'){receipt.methodRefs=methodRefs.get(r.internalActorKey+':'+r.requestId)??[];await transaction(c=>assertCoachKnowledge(c,receipt.methodRefs!))}await durableJournal.finish(r,receipt);methodRefs.delete(r.internalActorKey+':'+r.requestId)}},scheduler=new RequestScheduler(config.generationConcurrency,config.generationQueueLimit),active=new Map<string,AbortController>()
 let adapter=options.adapter,blocked='深入分析的候选服务尚未开放，原有聊天仍可继续。'
 if(!adapter&&advancedWorkflowsEnabled()&&process.env.LIFEOS_REAL_WORKFLOWS==='true'&&process.env.LIFEOS_WORKFLOW_FREEZE){
  try{adapter=process.env.LIFEOS_COZE_GROWTH==='true'?configuredCozeDirectionAdapter({readEvidence:readWorkflowEvidence,readMethods,freezePath:process.env.LIFEOS_WORKFLOW_FREEZE,audit:async(r,row)=>{await pool.query('UPDATE lifeos_workflow_nodes SET provider_usage=$4 WHERE user_id=$1 AND request_id=$2 AND node_id=$3',[r.internalActorKey,r.requestId,row.nodeId??'',JSON.stringify(row)])}}):createRuntimeDecisionAdapter({readEvidence:readWorkflowEvidence,readMethods,freezePath:process.env.LIFEOS_WORKFLOW_FREEZE,audit:async(r,row)=>{await pool.query('UPDATE lifeos_workflow_nodes SET provider_usage=$4 WHERE user_id=$1 AND request_id=$2 AND call_id=$3',[r.internalActorKey,r.requestId,row.callId,JSON.stringify(row)])}})}catch{blocked='模型费用或候选版本尚未核验，深入分析暂未开始。'}
 }
 const wf=adapter?createDirectionWorkflow(readWorkflowEvidence,adapter,undefined,journal):null
 const key=(user:string,id:string)=>user+':'+id
 async function read(user:string,id:string,conversation?:string){
  let task=requireRow((await pool.query('SELECT *,deadline_at<now() AS expired FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0])
  const r=parseRequest(task.request_payload),controls=await workflowControls(user)
  if(r.mode!=='direction_decision')throw new HttpError(404,'NOT_FOUND')
  if(conversation){requireRow((await pool.query('SELECT id FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0]);if(!controls.memory.enabled&&conversation!==r.conversationId)throw new HttpError(403,'MEMORY_DISABLED')}
  if(task.status!=='finished'&&task.expired){await journal.claim(r,task.input_digest);task=requireRow((await pool.query('SELECT * FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0])}
  let receipt=task.receipt as WorkflowReceipt|null,valid=true
  try{if(r.hostSnapshot?.runtimeDigest!==workflowRuntimeVersion.sourceDigest||r.hostSnapshot?.adoptionVersionDigest!==workflowAdoptionVersionDigest||r.hostSnapshot?.controlsDigest!==controls.digest)throw new WorkflowError('stale_snapshot');const records=await readWorkflowEvidence(r);validateEvidence(r,r.authorizedEvidenceRefs,records);if(receipt?.proposal){validateProposal(r,receipt.proposal,records);await transaction(c=>assertCoachKnowledge(c,receipt!.methodRefs??[]))}}catch(error){valid=false;receipt={...receipt,schemaVersion:2,traceId:r.traceId,status:'unavailable',proposal:undefined,failure:error instanceof WorkflowError?error.code:'source_invalid',providerCalls:receipt?.providerCalls??0,costCny:receipt?.costCny??null,reservedCostCny:receipt?.reservedCostCny??0,executionKind:receipt?.executionKind??adapter?.executionKind??'local_deterministic',skills:receipt?.skills??[],fallback:'existing_single_agent'}}
  const nodes=(await pool.query('SELECT node_id,role,status,call_id,provider_calls,cost_cny,max_cost_cny,started_at,finished_at,provider_usage,input_ref_digest,output_ref_digest FROM lifeos_workflow_nodes WHERE user_id=$1 AND request_id=$2 ORDER BY started_at,node_id',[user,id])).rows
  const status=!valid?'failed':task.cancel_requested?'cancelled':task.host_commit?.stateChange?.workflow?.status??(task.status!=='finished'?task.status:receipt?.status==='waiting_user'?'waiting_user':receipt?.status==='proposed'?'proposed':receipt?.failure==='cancelled'?'cancelled':receipt?.status==='rejected'?'rejected':'failed')
  const commit=valid&&task.host_commit?await store.validRunResponse(user,task.host_commit.requestId,task.host_commit):null
  return {id:r.requestId,traceId:r.traceId,conversationId:r.conversationId,status,question:valid?r.currentIntent:'所依据的信息已改变或撤回。',receipt,commit,nodes:nodes.map(n=>({id:n.node_id,role:n.role,status:n.status,callId:n.call_id,providerCalls:n.provider_calls,costCny:n.cost_cny===null?null:Number(n.cost_cny),reservedCostCny:Number(n.max_cost_cny),startedAt:n.started_at,finishedAt:n.finished_at,providerUsage:n.provider_usage,inputRefDigest:n.input_ref_digest,outputRefDigest:n.output_ref_digest,latencyMs:n.finished_at?new Date(n.finished_at).getTime()-new Date(n.started_at).getTime():null})),version:r.hostSnapshot?.runtimeDigest,executionKind:receipt?.executionKind??adapter?.executionKind??'local_deterministic'}
 }
 async function create(user:string,raw:unknown){
  if(!wf||!adapter||!advancedWorkflowsEnabled())throw new HttpError(503,'WORKFLOW_UNAVAILABLE',undefined,{message:blocked})
  const body=validate(deepTaskSchema,raw),old=(await pool.query('SELECT request_payload FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2',[user,body.requestId])).rows[0]
  if(old){const r=parseRequest(old.request_payload);if(r.conversationId!==body.conversationId||r.authorizedEvidenceRefs[0]?.id!==body.currentMessageId||JSON.stringify(r.directions.map(x=>x.id))!==JSON.stringify(body.directions))throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED');return read(user,body.requestId,body.conversationId)}
  const entitlement=await entitlementView(user);if(entitlement.required&&(!entitlement.enabled||(entitlement.remaining??0)<=0))throw new HttpError(403,'ACCESS_NOT_ENABLED')
  const current=requireRow((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role='user'",[user,body.conversationId,body.currentMessageId])).rows[0])
  const controls=await workflowControls(user),view=await growthView(user,body.conversationId)
  const relevant=selectRelevantGrowth(view.items.filter(x=>!x.unavailableReason&&x.status==='active'&&['user_reported','user_edit'].includes(x.assertion)&&!x.recommendationStopped),current.content,{maxItems:8,maxChars:12000}).selected
  const clauses=scanUserClauses(current.content).filter(x=>!x.quoted&&!x.code&&!x.conditional&&!x.attributedToOther),text=clauses.map(x=>x.text).join('；')
  const forbidden:string[]=controls.directions.filter(x=>x.state==='paused').map(x=>x.scope)
  if(forbidden.includes('entrepreneurship'))forbidden.push('independent_development','freelance')
  const r:WorkflowRequest={schemaVersion:2,traceId:body.requestId,requestId:body.requestId,mode:'direction_decision',internalActorKey:user,conversationId:body.conversationId,authorizedEvidenceRefs:[{type:'message',id:body.currentMessageId,revision:1,quote:current.content},...relevant.map(x=>({type:'growth' as const,id:x.id,revision:x.revision}))],hostSnapshot:{controlsDigest:controls.digest,runtimeDigest:workflowRuntimeVersion.sourceDigest,adoptionVersionDigest:workflowAdoptionVersionDigest,budgetQuestion:{period:weeklyPlanIntent(current.content)?.period==='next_week'||applicableTimeBudget(current.content)?.period==='next_week'?'next_week':'this_week',question:'本人本周或下周可用或剩余时间',anchor:new Date().toISOString()}},currentIntent:current.content,consent:{continueReview:false,deepAnalysis:true},controls:{memoryEnabled:controls.memory.enabled,listeningOnly:currentConversationOnly(current.content)||/只想倾诉|只听我说/.test(text),refuseAdvice:/不要建议|不想要建议/.test(text),memoryControl:/忘掉|忘记这|删除这/.test(text),recommendationsPaused:false,forbiddenDirections:forbidden},budget:null,modelBudget:{maxProviderCalls:5,maxCostCny:Math.min(30,adapter.maxCostPerCallCny*(body.directions.length+2)),deadlineMs:120000},directions:body.directions.map(id=>({id,title:directionLabels[id]})),synthetic:options.synthetic===true}
  const records=await readWorkflowEvidence(r);validateEvidence(r,r.authorizedEvidenceRefs,records)
  r.budget=selectWorkflowBudget(r,records)
  parseRequest(r)
  const inserted=await pool.query(`INSERT INTO lifeos_workflow_tasks(user_id,request_id,conversation_id,trace_id,input_digest,source_snapshot,request_payload,status,deadline_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,'queued',now()+interval '120 seconds') ON CONFLICT DO NOTHING RETURNING request_id`,[user,r.requestId,r.conversationId,r.traceId,digest(r),JSON.stringify(r.authorizedEvidenceRefs),JSON.stringify(r)])
  if(!inserted.rowCount){
   const concurrent=requireRow((await pool.query('SELECT input_digest FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2',[user,r.requestId])).rows[0])
   if(concurrent.input_digest!==digest(r))throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED')
  }
  if(inserted.rowCount){
   if(!r.budget){await journal.finish(r,{schemaVersion:2,traceId:r.traceId,status:'waiting_user',providerCalls:0,costCny:0,reservedCostCny:0,executionKind:'local_deterministic',skills:[],fallback:'existing_single_agent',reviewIssues:[{severity:'needs_clarification',category:'unknown',affectedClaims:[],resolution:'ask_user',text:'还没有本人可用时间的明确依据。可以在聊天里补充目标周的可用时间、估计或上限，也可以暂不继续，再按新情况比较。',evidenceRefs:[]}]});return read(user,r.requestId,r.conversationId)}
   launch(r)
  }
  return read(user,r.requestId,r.conversationId)
 }
 function launch(r:WorkflowRequest){
  const user=r.internalActorKey,controller=new AbortController();active.set(key(user,r.requestId),controller)
  void (async()=>{let release:(()=>void)|undefined;try{release=await scheduler.acquire(user,controller.signal);await wf!.run(r,controller.signal,options.comparisonMode?.()??'multi')}catch(error){const nodes=(await pool.query("SELECT cost_cny,max_cost_cny FROM lifeos_workflow_nodes WHERE user_id=$1 AND request_id=$2 AND execution_kind<>'local_deterministic'",[user,r.requestId])).rows;const failure:WorkflowReceipt={schemaVersion:2,traceId:r.traceId,status:'unavailable',failure:controller.signal.aborted?'cancelled':error instanceof WorkflowError?error.code:'unavailable',providerCalls:nodes.length,costCny:nodes.some(n=>n.cost_cny===null)?null:nodes.reduce((sum,n)=>sum+Number(n.cost_cny),0),reservedCostCny:nodes.reduce((sum,n)=>sum+Number(n.max_cost_cny),0),executionKind:adapter!.executionKind,skills:[],fallback:'existing_single_agent'};await journal.finish(r,failure)}finally{release?.();active.delete(key(user,r.requestId))}})().catch(()=>{})
 }
 async function resume(user:string,taskId:string,raw:unknown){
  if(!wf||!adapter||!advancedWorkflowsEnabled())throw new HttpError(503,'WORKFLOW_UNAVAILABLE',undefined,{message:blocked})
  const body=validate(resumeTaskSchema,raw),entitlement=await entitlementView(user)
  if(entitlement.required&&(!entitlement.enabled||(entitlement.remaining??0)<=0))throw new HttpError(403,'ACCESS_NOT_ENABLED')
  const request=await transaction(async c=>{
   const task=requireRow((await c.query('SELECT * FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2 FOR UPDATE',[user,taskId])).rows[0]),r=parseRequest(task.request_payload)
   if(r.mode!=='direction_decision'||r.conversationId!==body.conversationId)throw new HttpError(403,'WORKFLOW_CONVERSATION_MISMATCH')
   if(task.cancel_requested||task.host_commit)throw new HttpError(409,'WORKFLOW_NOT_WAITING')
   // Reopen only an unsent clarification. Unknown, failed and paid graphs are
   // never restartable. A repeated supplement reads the same durable graph.
   if(task.status!=='finished'||task.receipt?.status!=='waiting_user'){
    if(r.authorizedEvidenceRefs.some(x=>x.type==='message'&&x.id===body.currentMessageId)&&r.authorizedEvidenceRefs[0]?.id!==body.currentMessageId)return null
    throw new HttpError(409,'WORKFLOW_NOT_WAITING')
   }
   const nodes=await c.query('SELECT node_id FROM lifeos_workflow_nodes WHERE user_id=$1 AND request_id=$2',[user,taskId])
   if(nodes.rowCount||task.receipt.providerCalls!==0||task.receipt.reservedCostCny!==0)throw new HttpError(409,'WORKFLOW_ALREADY_DISPATCHED')
   if(r.hostSnapshot?.runtimeDigest!==workflowRuntimeVersion.sourceDigest||r.hostSnapshot?.adoptionVersionDigest!==workflowAdoptionVersionDigest)throw new HttpError(409,'WORKFLOW_SOURCE_CHANGED')
   const controls=await workflowControls(user,c)
   if(controls.digest!==r.hostSnapshot?.controlsDigest)throw new HttpError(409,'WORKFLOW_SOURCE_CHANGED')
   const current=requireRow((await c.query("SELECT content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role='user' AND created_at>=$4 AND created_at>=(date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')",[user,body.conversationId,body.currentMessageId,task.created_at])).rows[0])
   const intent=scanUserClauses(current.content).filter(x=>!x.quoted&&!x.code&&!x.conditional&&!x.attributedToOther&&!x.interrogative).map(x=>x.text).join('；')
   if(currentConversationOnly(current.content)||/先别分析|不要分析|不想继续|拒绝继续|取消|只想倾诉|只听我说|不要建议|不想要建议/.test(intent)){await c.query('UPDATE lifeos_workflow_tasks SET cancel_requested=true WHERE user_id=$1 AND request_id=$2',[user,taskId]);return null}
   if(/改(?:为|成|方向)|转向|优先.{0,10}(?:就业|考研|创业)|不再比较/.test(intent))throw new HttpError(409,'WORKFLOW_INTENT_CHANGED')
   if(!r.hostSnapshot?.budgetQuestion)throw new HttpError(409,'WORKFLOW_TIME_QUESTION_REQUIRED')
   const question=r.hostSnapshot.budgetQuestion,token=question.period==='next_week'?'下周':'这周'
   const window=resolveTimeWindow({kind:'calendar_week',which:question.period==='next_week'?'next':'this',quote:token},token,question.anchor,'Asia/Shanghai')
   if(Date.now()>=Date.parse(window.validUntil))throw new HttpError(409,'WORKFLOW_TIME_CONTEXT_EXPIRED')
   if(/下周/.test(intent)&&!/这周|本周/.test(intent))r.hostSnapshot.budgetQuestion.period='next_week'
   const ref={type:'message' as const,id:body.currentMessageId,revision:1,quote:current.content}
   r.authorizedEvidenceRefs.push(ref)
   const records=await readWorkflowEvidence(r,c);validateEvidence(r,r.authorizedEvidenceRefs,records)
   const selected=selectWorkflowBudget(r,records.filter(x=>x.ref.id===ref.id))
   if(!selected)throw new HttpError(400,'WORKFLOW_TIME_REQUIRED',undefined,{message:'还不能确定本人可用时间；可以说估计或上限，也可以暂不继续。原来的比较会保留。'})
   r.budget=selected;parseRequest(r)
   await c.query("UPDATE lifeos_workflow_tasks SET input_digest=$3,source_snapshot=$4,request_payload=$5,status='queued',receipt=NULL,finished_at=NULL,deadline_at=now()+interval '120 seconds' WHERE user_id=$1 AND request_id=$2",[user,taskId,digest(r),JSON.stringify(r.authorizedEvidenceRefs),JSON.stringify(r)])
   return r
  })
  if(request)launch(request)
  return read(user,taskId,body.conversationId)
 }
 async function cancel(user:string,id:string){
  requireRow((await pool.query("UPDATE lifeos_workflow_tasks SET cancel_requested=true WHERE user_id=$1 AND request_id=$2 AND host_commit IS NULL RETURNING request_id",[user,id])).rows[0]);active.get(key(user,id))?.abort('cancelled')
  return read(user,id)
 }
 async function act(user:string,id:string,raw:unknown){
  const body=validate(taskActionSchema,raw),task=requireRow((await pool.query('SELECT * FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0])
  const view=await read(user,id,body.conversationId)
  if(view.status==='failed'||view.status==='cancelled')throw new HttpError(409,'WORKFLOW_SOURCE_CHANGED')
  if(task.host_commit){const previous=task.host_commit.stateChange?.workflow;if(previous?.kind!==body.kind||previous?.index!==body.index)throw new HttpError(409,'IDEMPOTENCY_KEY_REUSED');return view.commit}
  if(body.kind==='reject'){
   await transaction(async c=>{const row=requireRow((await c.query('SELECT * FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2 FOR UPDATE',[user,id])).rows[0]);if(row.host_commit||row.cancel_requested||row.status!=='finished'||!['proposed','rejected'].includes(row.receipt?.status))throw new HttpError(409,'WORKFLOW_NOT_PROPOSED');await c.query("UPDATE lifeos_workflow_tasks SET receipt=jsonb_set(receipt,'{status}','\"rejected\"'::jsonb) WHERE user_id=$1 AND request_id=$2 AND status='finished'",[user,id])})
   return {status:'rejected',factsChanged:false}
  }
   const proposal=view.receipt?.proposal,selected=body.kind==='action'?proposal?.nextActions[body.index]:proposal?.alternatives[body.index]
  if(!selected)throw new HttpError(400,'WORKFLOW_SELECTION_INVALID')
  const text=body.kind==='action'?'我采纳这个小探索计划，尚未执行：'+proposal!.nextActions[body.index].description:'我确认本阶段优先'+proposal!.alternatives[body.index].title
  const started=await store.startRun(user,body.conversationId,body.requestId,text)
  if(started.replay){if(started.run.status!=='completed')throw new HttpError(409,'RUN_IN_PROGRESS');return store.validRunResponse(user,body.requestId,started.run.response)}
  try{
   const snapshot=await loadSnapshot(user,body.conversationId,text),growth=await growthView(user,body.conversationId),controls=await workflowControls(user)
   const staged:store.Staged={candidates:[],audit:[{phase:'workflow_user_selection',taskId:id,kind:body.kind,index:body.index,providerCalls:0}],snapshot,usedGrowthRefs:parseRequest(task.request_payload).authorizedEvidenceRefs.filter(x=>x.type==='growth').map(x=>({id:x.id,revision:x.revision})),growthSnapshotKey:growthSnapshotKey(growth.items.filter(x=>!x.unavailableReason&&['active','proposed'].includes(x.status))),directionControlSnapshotKey:controls.directionKey,workflowAdoption:{taskId:id,kind:body.kind,index:body.index,receiptDigest:workflowReceiptDigest(view.receipt)}}
   return await store.finishRun(started.run,staged,body.kind==='action'?'已保存你采纳的小探索计划，状态为尚未执行。完成或遇到卡点后，可以在这里继续反馈。':'已保存你明确确认的阶段方向。实际行动与结果仍需分别反馈。',{source:'deterministic',llmCallCount:0},new AbortController().signal,'direct',0)
  }catch(error){await store.terminateRun(user,body.requestId,'failed',error instanceof HttpError?error.code:'WORKFLOW_COMMIT_FAILED');throw error}
 }
 return {create,read,resume,cancel,act,capabilities:()=>({enabled:Boolean(wf&&advancedWorkflowsEnabled()),reason:blocked,directions:directionLabels,executionKind:adapter?.executionKind??null,version:workflowRuntimeVersion.sourceDigest}),async list(user:string,conversation:string){if(!advancedWorkflowsEnabled())return [];requireRow((await pool.query('SELECT id FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0]);const controls=await workflowControls(user),rows=(await pool.query("SELECT request_id FROM lifeos_workflow_tasks WHERE user_id=$1 AND ($3 OR conversation_id=$2) AND request_payload->>'mode'='direction_decision' ORDER BY created_at DESC LIMIT 10",[user,conversation,controls.memory.enabled])).rows;return Promise.all(rows.map(row=>read(user,row.request_id,conversation)))},close(){for(const controller of active.values())controller.abort('SERVER_SHUTTING_DOWN')}}
}
export type WorkflowHost=ReturnType<typeof createWorkflowHost>
