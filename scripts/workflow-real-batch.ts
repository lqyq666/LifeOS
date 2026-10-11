import {readFileSync,writeFileSync,existsSync,mkdirSync,appendFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {captureCoachSource,assertCoachSourceFreeze} from './coach-source-freeze.ts'
import {modelCapabilityVerified,resolveModel,modelSignatureFor} from '../server/model.ts'
import {maximumProviderCallCostCny,estimateProviderCallCostCny} from '../server/cost-workload.ts'
import {CoachProviderBudget,activeCoachFunding} from './coach-provider-budget.ts'
import {readReviewedPilotContinuation,readIndependentExecution} from '../server/independent-review.ts'
export const realBatchStages=['small','four_chains','complex20_pairs','ordinary20','coze_two_projects'] as const
export function selectRealPilotCases(auth:{smallOrdinaryOnly?:boolean;smallComplexOnly?:boolean},pairs:any[],ordinary:any[]){
 if(auth.smallOrdinaryOnly&&auth.smallComplexOnly)throw new Error('PILOT_SCOPE_CONFLICT_ZERO_DISPATCH')
 const complex=auth.smallOrdinaryOnly?[]:[pairs.find(x=>x.directions.length===2),pairs.find(x=>x.directions.length===3)]
 if(complex.some(x=>!x))throw new Error('PILOT_TWO_THREE_DIRECTION_CASES_MISSING')
 return {complex,ordinary:auth.smallComplexOnly?[]:ordinary.slice(0,3)}
}
export function readRepairPilotCases(auth:any){
 if(!auth.repairPilotInput)return null
 const {path,sha256}=auth.repairPilotInput
 if(!auth.smallOrdinaryOnly||typeof path!=='string'||!/^\.planning\/research\/workflow-integration\/REPAIR_PILOT_[A-Z0-9_]+\.json$/.test(path))throw new Error('REPAIR_PILOT_SCOPE_INVALID')
 const bytes=readFileSync(path);if(hash(bytes)!==sha256)throw new Error('REPAIR_PILOT_HASH_INVALID')
 const cases=JSON.parse(bytes.toString()).cases
 if(!Array.isArray(cases)||!cases.length||cases.length>8||new Set(cases.map((c:any)=>c.caseId)).size!==cases.length||cases.some((c:any)=>typeof c.caseId!=='string'||typeof c.input!=='string'||!c.input.trim()||c.input.length>4000||!Number.isInteger(c.session)||c.session<0||c.session>7))throw new Error('REPAIR_PILOT_CASES_INVALID')
 return cases as {caseId:string;input:string;session:number}[]
}
export function realMetrics(rows:any[]){
 const percentile=(values:number[],p:number)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(p*values.length)-1]:null
 const ordinary=rows.filter(r=>r.stage==='ordinary20'&&!r.deepInput),first=ordinary.map(r=>r.firstUsefulMs).filter((n):n is number=>typeof n==='number'&&n>0),whole=ordinary.map(r=>r.replyCompleteMs).filter((n):n is number=>typeof n==='number'&&n>0)
 const pilot=rows.filter(r=>r.stage==='small'&&!r.deepInput),pilotFirst=pilot.map(r=>r.firstUsefulMs).filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0),pilotWhole=pilot.map(r=>r.replyCompleteMs).filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0)
 return {allFirstAttempts:rows.length,ordinaryFirstAttempts:ordinary.length,firstContentObserved:first.length,noFirstContent:ordinary.length-first.length,completeReplyObserved:whole.length,noCompleteReply:ordinary.length-whole.length,failedOrCancelled:rows.filter(r=>r.failure||r.deep?.status==='cancelled').length,firstContentP50Ms:percentile(first,0.5),firstContentP95Ms:percentile(first,0.95),wholeReplyP95Ms:whole.length===ordinary.length?percentile(whole,0.95):null,observedCompleteReplyP95Ms:percentile(whole,0.95),observedPercentilesAreConditionalOnContentExistence:true,businessQualifiedSamples:'WAITING_INDEPENDENT_REVIEW',performanceStatus:ordinary.length>=20&&first.length===ordinary.length&&whole.length===ordinary.length&&!ordinary.some(r=>r.failure)?'WAITING_BUSINESS_QUALIFICATION':'NOT_ACCEPTED_INCOMPLETE_OR_FAILED',unknownCostSamples:rows.filter(r=>r.costCny==='unknown').length,smallOrdinary:{firstAttempts:pilot.length,firstContentObserved:pilotFirst.length,noFirstContent:pilot.length-pilotFirst.length,completeReplyObserved:pilotWhole.length,noCompleteReply:pilot.length-pilotWhole.length,firstContentP50Ms:percentile(pilotFirst,0.5),firstContentP95Ms:percentile(pilotFirst,0.95),observedCompleteReplyP95Ms:percentile(pilotWhole,0.95),countedTowardOrdinary20:false,status:'PILOT_ONLY_NOT_ACCEPTED'}}
}
const hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex')
const root='.planning/research/workflow-integration/'
// Match server/index.ts: local retrieval must be ready before HTTP accepts a
// student request. Startup is measured separately; first attempts stay intact.
export async function startRealAcceptanceHttp(app:import('node:http').Server,embedding:{start():Promise<unknown>;close():Promise<unknown>},port:number){
 const started=performance.now()
 try{
  await embedding.start()
  await new Promise<void>((resolve,reject)=>{app.once('error',reject);app.listen(port,'127.0.0.1',()=>{app.removeListener('error',reject);resolve()})})
  return {type:'acceptance_runtime_ready',startupMs:performance.now()-started,localEmbeddingReady:true,startupSeparateFromInteraction:true,productDispatches:0}
 }catch(error){
  if(app.listening)await new Promise<void>(resolve=>app.close(()=>resolve()))
  await embedding.close();throw error
 }
}
export function realBatchPreflight(authorizationPath?:string){
 const source=captureCoachSource(),ledgerPath=resolve('.local/v1.3-action-coach/paid/provider-calls.json'),ledgerBytes=existsSync(ledgerPath)?readFileSync(ledgerPath):null,ledger=ledgerBytes?JSON.parse(ledgerBytes.toString()):null
 const corpusPath='.planning/research/evergreen/KB_GUIDES.jsonl',contentHash=hash(readFileSync(corpusPath)),head=execFileSync('git',['rev-parse','HEAD']).toString().trim(),blocks:string[]=[]
 const auth=authorizationPath?JSON.parse(readFileSync(authorizationPath,'utf8')):null
 const launchPath=root+'LAUNCH_AUTHORIZATION.json',launch=existsSync(launchPath)?JSON.parse(readFileSync(launchPath,'utf8')):null
 const scopeRestored=launch?.kind==='OWNER_APPROVED_LIFEOS_COZE_CORE_LAUNCH'&&launch.productModelPauseLifted===true&&launch.approvalSource==='CURRENT_CHAT_DIRECT_HUMAN_REPLY'
 if(!auth||auth.kind!=='OWNER_APPROVED_LIFEOS_REAL_BATCH'||auth.pauseLifted!==true)blocks.push(scopeRestored?'TARGET_BATCH_AUTHORIZATION_BINDING_MISSING':'EXPLICIT_MODEL_PAUSE_NOT_LIFTED')
 if(auth&&(auth.head!==head||auth.sourceDigest!==source.digest||auth.contentHash!==contentHash||auth.ledgerSha256!==(ledgerBytes?hash(ledgerBytes):null)))blocks.push('AUTHORIZATION_VERSION_OR_LEDGER_MISMATCH')
 if(auth&&(!auth.ownerApprovalEvidence||!existsSync(auth.ownerApprovalEvidence)||hash(readFileSync(auth.ownerApprovalEvidence))!==auth.ownerApprovalSha256))blocks.push('OWNER_APPROVAL_EVIDENCE_MISSING')
 if(auth&&(!Number.isFinite(Date.parse(auth.expiresAt))||Date.parse(auth.expiresAt)<=Date.now()))blocks.push('AUTHORIZATION_EXPIRED')
 const funding=ledger?activeCoachFunding(ledger):null
 if(!funding||funding.paused||typeof funding.remainingCny!=='number'||funding.remainingCny<=0)blocks.push('EXISTING_BUDGET_NOT_AVAILABLE')
 if(auth&&(!(auth.maxSpendCny>0)||!funding||auth.maxSpendCny>funding.remainingCny))blocks.push('NO_NEW_BUDGET_ALLOWED')
 const runtime=resolveModel('default');if(!runtime.available)blocks.push('MODEL_CONFIGURATION_UNAVAILABLE');if(!runtime.pricing)blocks.push('MODEL_PRICE_UNKNOWN')
 if(!modelCapabilityVerified('default'))blocks.push('CURRENT_MODEL_CAPABILITY_NOT_VERIFIED')
 if(auth&&auth.modelSignature!==modelSignatureFor('default'))blocks.push('MODEL_SIGNATURE_MISMATCH')
 if(auth?.smallOrdinaryOnly&&auth?.smallComplexOnly)blocks.push('PILOT_SCOPE_CONFLICT_ZERO_DISPATCH')
 try{readRepairPilotCases(auth??{})}catch{blocks.push('REPAIR_PILOT_INPUT_INVALID_ZERO_DISPATCH')}
 let pilotContinuation:ReturnType<typeof readReviewedPilotContinuation>|null=null
 if(auth?.reviewedPilotExecutionId){
  if(auth.smallOrdinaryOnly||auth.smallComplexOnly)blocks.push('PILOT_CONTINUATION_SCOPE_CONFLICT')
  try{pilotContinuation=readReviewedPilotContinuation(auth.reviewedPilotExecutionId)}catch(error){blocks.push(error instanceof Error?error.message:'INDEPENDENT_PILOT_INVALID')}
 }
 const ordinary=JSON.parse(readFileSync(root+'ORDINARY_PERFORMANCE_PROTOCOL.json','utf8')),pairs=JSON.parse(readFileSync(root+'COMPLEX_DECISION_AB_EVAL.json','utf8'))
 if(ordinary.cases.length<20||pairs.cases.length<20)blocks.push('COHORT_INCOMPLETE')
 const status=blocks.length?(scopeRestored?'BLOCKED_CONFIG_NOT_RUN':'PAUSED_NOT_RUN'):'READY_FOR_AUTHORIZED_STAGES'
 return {status,scopeRestored,head,sourceDigest:source.digest,contentHash,ledgerSha256:ledgerBytes?hash(ledgerBytes):null,modelSignature:modelSignatureFor('default'),blocks,pilotContinuation,productDispatches:0,cloudDispatches:0,unknownCostsPreserved:true,newBudget:0,stages:realBatchStages.map(stage=>({stage,status:blocks.length?status:stage==='small'&&pilotContinuation?'PREVIOUS_REAL_FIRST_SAMPLES_INDEPENDENTLY_REVIEWED_NOT_REISSUED':'READY',...(stage==='coze_two_projects'?{projectIds:['7693388932939300905','7693465311558795327'],authorizationRequired:launch?.cozePauseLifted?'CURRENT_CLOUD_VERSION_AND_NATIVE_CREDIT_BINDING':'SEPARATE_EXPLICIT_COZE_PAUSE_LIFT'}:{})})),authorization:auth}
}

// Uses the same authenticated HTTP host and native SDK, existing unique ledger,
// no retries and no model self-grading. A later stage needs an independent
// six-axis verdict on the preceding actual transcript hash, not a role name.
export async function executeRealBatch(authPath:string,directory:string){
 const preflight=realBatchPreflight(authPath);if(preflight.status!=='READY_FOR_AUTHORIZED_STAGES')return preflight
 const auth=preflight.authorization,freezePath=resolve(directory,'source-freeze.json');writeFileSync(freezePath,JSON.stringify(captureCoachSource()))
 const {config}=await import('../server/config.ts')
 if(!/^lifeos_dialogue_test_/.test(new URL(config.databaseUrl).pathname.slice(1)))throw new Error('REAL_ACCEPTANCE_REQUIRES_DISPOSABLE_DATABASE')
 // Bind the exact local origin before Better Auth is constructed. Keep its
 // origin guard intact; changing config after importing HTTP left it stale.
 const {createServer}=await import('node:net'),portProbe=createServer()
 await new Promise<void>(r=>portProbe.listen(0,'127.0.0.1',r));const port=(portProbe.address() as {port:number}).port
 await new Promise<void>((r,j)=>portProbe.close(e=>e?j(e):r()))
 const oldOrigin=config.origin,origin='http://127.0.0.1:'+port;config.origin=origin
 const {createApp}=await import('../server/http.ts'),{createTurnEngine}=await import('../server/agent.ts'),{pool}=await import('../server/db.ts'),{createWorkflowHost}=await import('../server/workflows/task-host.ts'),{createRuntimeDecisionAdapter}=await import('../server/workflows/provider-adapter.ts'),{readWorkflowEvidence}=await import('../server/workflows/task-sources.ts'),{workflowMethodReader}=await import('../server/workflows/method-context.ts'),store=await import('../server/store.ts')
 class BatchBudget extends CoachProviderBudget {override reserveGraph(inputs:Parameters<CoachProviderBudget['reserveGraph']>[0]){if(inputs.reduce((s,x)=>s+(x.reservedCostCny??Infinity),0)>remaining())throw new Error('BATCH_EXISTING_BUDGET_EXHAUSTED');return super.reserveGraph(inputs)}}
 const ledger=new BatchBudget(),starting=ledger.snapshot(),calls=new Map<string,any>(),counts=new Map<string,number>(),journal=resolve(directory,'attempts.jsonl')
 const record=(row:unknown)=>appendFileSync(journal,JSON.stringify(row)+'\n')
 if(existsSync(journal))throw new Error('FIRST_ATTEMPTS_ALREADY_EXIST_NO_REISSUE')
 const remaining=()=>{const now=ledger.snapshot(),newCalls=now.calls.slice(starting.calls.length);return auth.maxSpendCny-newCalls.reduce((sum:number,c:any)=>sum+(typeof c.estimatedCostCny==='number'?c.estimatedCostCny:c.reservedCostCny),0)}
 const oldAdvanced=process.env.LIFEOS_ADVANCED_WORKFLOWS;process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
 const decisionAudits=new Map<string,any[]>()
 let comparisonMode:'single'|'multi'='multi'
 const host=auth.smallOrdinaryOnly?undefined:createWorkflowHost({comparisonMode:()=>comparisonMode,adapter:createRuntimeDecisionAdapter({readEvidence:readWorkflowEvidence,readMethods:workflowMethodReader(),freezePath,budget:ledger,audit:async(r,row)=>{decisionAudits.set(r.requestId,[...(decisionAudits.get(r.requestId)??[]),row]);record({type:'deep_provider',requestId:r.requestId,...row});await pool.query('UPDATE lifeos_workflow_nodes SET provider_usage=$4 WHERE user_id=$1 AND request_id=$2 AND call_id=$3',[r.internalActorKey,r.requestId,row.callId,JSON.stringify(row)])}})})
 const engine=createTurnEngine({providerCallObserver:{allowRepair:false,before:call=>{
  assertCoachSourceFreeze(freezePath);const n=counts.get(call.requestId)??0;if(n>=1)throw new Error('ORDINARY_MAX_ONE_NO_PAID_REPAIR')
  const rt=resolveModel(call.tier),maximum=maximumProviderCallCostCny(rt.model.contextWindow,call.outputTokenLimit,rt.pricing);if(typeof maximum!=='number'||maximum>remaining())throw new Error('BATCH_EXISTING_BUDGET_EXHAUSTED')
  const receipt=ledger.reserve({runId:call.requestId,purpose:'turn',tier:call.tier,provider:call.provider,model:call.model,signature:modelSignatureFor(call.tier),sourceDigest:preflight.sourceDigest,logicalCallId:call.requestId+':ordinary',reservedCostCny:maximum});calls.set(call.callId,receipt);counts.set(call.requestId,n+1);record({type:'ordinary_started',callId:receipt.callId,requestId:call.requestId,reservedCostCny:maximum})
 },after:call=>{const receipt=calls.get(call.callId);if(!receipt)return;const complete=call.usageCompleteness==='complete',rt=resolveModel(call.tier),cost=complete?estimateProviderCallCostCny((call.uncachedInputTokens??0)+(call.cacheWriteInputTokens??0),call.cachedInputTokens??0,call.outputTokens??0,rt.pricing):'unknown';ledger.finish(receipt.callId,{outcome:call.outcome,usage:call,estimatedCostCny:cost,providerResponseId:call.providerResponseId});record({type:'ordinary_finished',receiptId:receipt.callId,costCny:cost,outcome:call.outcome})}}})
 const app=createApp(engine,120000,host),{localEmbedding}=await import('../server/local-embedding.ts')
 try{record(await startRealAcceptanceHttp(app,localEmbedding,port))}catch(error){
  config.origin=oldOrigin;oldAdvanced===undefined?delete process.env.LIFEOS_ADVANCED_WORKFLOWS:process.env.LIFEOS_ADVANCED_WORKFLOWS=oldAdvanced;await pool.end();throw error
 }
 let cookie='',actor='';const request=(path:string,body?:unknown)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
 const json=async(path:string,body?:unknown)=>{const response=await request(path,body),out=await response.json();if(!response.ok)throw new Error(out.error??'HTTP_FAILED');return out}
 const chat=async()=>{const id=randomUUID();await json('/api/conversations',{id,title:'SYNTHETIC ADULT REAL ACCEPTANCE'});return id}
 const results:any[]=[]
 async function turn(stage:string,caseId:string,conversation:string,text:string,directions?:string[]){
  const requestId=randomUUID(),started=performance.now();let firstUsefulMs:number|null=null,replyCompleteMs:number|null=null,done:any=null,failure:string|null=null,frames:any[]=[]
  record({type:'first_attempt',stage,caseId,requestId,conversation,text,startedAt:new Date().toISOString()})
  try{
   if(directions){
    // Precommit only the authorized synthetic input; zero preliminary model calls.
    // This is an API harness, not a claim of paid ordinary-chat/UI acceptance.
    const input=(await store.startRun(actor,conversation,requestId,text)).run
    await store.finishRun(input,{candidates:[],audit:[]},'验收输入已保存，尚未生成建议。',null,new AbortController().signal,'direct',0)
    const deepId=randomUUID();await json('/api/workflows',{requestId:deepId,conversationId:conversation,currentMessageId:input.source_message_id,directions,consent:true})
    let deep:any;do{deep=await json('/api/workflows/'+deepId);if(!['queued','running'].includes(deep.status))break;await new Promise(r=>setTimeout(r,250))}while(performance.now()-started<120000)
    if(['queued','running'].includes(deep.status)){await json('/api/workflows/'+deepId+'/cancel',{});deep=await json('/api/workflows/'+deepId);failure='FIRST_ATTEMPT_TIMEOUT_CANCELLED_NO_RETRY'}
    if(deep.receipt?.providerCalls>5)throw new Error('COMPLEX_MAX_FIVE_EXCEEDED')
    const readback={run:await json('/api/runs/'+requestId),growth:await json('/api/growth?conversation='+conversation),starMap:await json('/api/cognition'),messages:await json('/api/conversations')}
    results.push({stage,caseId,requestId,deepId,input:text,deepInput:true,inputHarness:'AUTHORIZED_SYNTHETIC_INPUT_COMMIT_ZERO_GENERATION',deep,readback,firstUsefulMs:null,wholeTurnMs:performance.now()-started,failure:failure??(['proposed','plan_saved','direction_saved'].includes(deep.status)?null:'DEEP_'+deep.status),checks:{technicalCompleted:deep.status==='proposed',semanticCorrect:'WAITING_INDEPENDENT_REVIEW',sourceSupported:'WAITING_INDEPENDENT_REVIEW',necessaryStateCommitted:'WAITING_API_READBACK_REVIEW',intentRespected:'WAITING_INDEPENDENT_REVIEW',crossSessionContinuity:'WAITING_INDEPENDENT_REVIEW'},costCny:deep.receipt?.costCny??'unknown'})
   }else{
   const res=await request('/api/conversations/'+conversation+'/messages',{requestId,text});if(!res.ok)throw new Error('HTTP_'+res.status)
   const reader=res.body!.getReader();let pending='';while(true){const part=await reader.read();if(part.done)break;pending+=Buffer.from(part.value).toString();const lines=pending.split('\n');pending=lines.pop()!;for(const line of lines.filter(x=>x.startsWith('data: '))){const event=JSON.parse(line.slice(6));frames.push(event);if(firstUsefulMs===null&&['delta','draft'].includes(event.type)&&typeof event.text==='string'&&event.text.trim())firstUsefulMs=performance.now()-started;if(event.type==='draft_discarded')firstUsefulMs=null;if(event.type==='done'){done=event;replyCompleteMs=performance.now()-started};if(event.type==='error')failure=event.code??'STREAM_FAILED'}}
   if(!done)failure??='NO_COMMITTED_DONE'
   const readback=done?{run:await json('/api/runs/'+requestId),growth:await json('/api/growth?conversation='+conversation),starMap:await json('/api/cognition'),messages:await json('/api/conversations')}:null
   const charged=ledger.snapshot().calls.filter((c:any)=>c.runId===requestId),costCny=charged.length&&charged.every((c:any)=>typeof c.estimatedCostCny==='number')?charged.reduce((s:number,c:any)=>s+c.estimatedCostCny,0):'unknown'
   results.push({stage,caseId,requestId,input:text,frames,done,readback,firstUsefulMs,replyCompleteMs,wholeTurnMs:performance.now()-started,failure,checks:{technicalCompleted:Boolean(done),semanticCorrect:'WAITING_INDEPENDENT_REVIEW',sourceSupported:'WAITING_INDEPENDENT_REVIEW',necessaryStateCommitted:'WAITING_API_READBACK_REVIEW',intentRespected:'WAITING_INDEPENDENT_REVIEW',crossSessionContinuity:'WAITING_INDEPENDENT_REVIEW'},costCny})
   }
  }catch(e){results.push({stage,caseId,requestId,input:text,deepInput:Boolean(directions),frames,done,firstUsefulMs,replyCompleteMs,wholeTurnMs:performance.now()-started,failure:e instanceof Error?e.message:'UNKNOWN',costCny:'unknown'})}
  record({type:'first_result',...results.at(-1)});writeFileSync(resolve(directory,'results.json'),JSON.stringify({status:'REAL_RESULTS_AWAITING_INDEPENDENT_REVIEW',source:preflight,metrics:realMetrics(results),results},null,2)+'\n')
 }
 const gate=(stage:string)=>{const rows=results.filter(x=>x.stage===stage),digest=hash(JSON.stringify(rows));const path=auth.reviewReceipts?.[stage];if(!path||!existsSync(path))return false;const receipt=JSON.parse(readFileSync(path,'utf8'));try{const execution=readIndependentExecution(receipt.executionId);if(execution.binding.scope!=='real_batch_stage'||execution.binding.reportSha256!==hash(readFileSync(path))||execution.reviewerId===auth.generatorIdentity)return false}catch{return false}return receipt.kind==='INDEPENDENT_EXECUTED_SIX_AXIS_REVIEW'&&receipt.transcriptSha256===digest&&receipt.executionEvidence&&existsSync(receipt.executionEvidence)&&receipt.reviewerIdentity!==auth.generatorIdentity&&receipt.outcome==='pass'&&['technical','semantic','source','state','intent','continuity'].every(k=>receipt.axes?.[k]==='pass')}
 const waitForReview=async(stage:string)=>{
  writeFileSync(resolve(directory,'review-needed.json'),JSON.stringify({stage,transcriptSha256:hash(JSON.stringify(results.filter(x=>x.stage===stage))),receiptPath:auth.reviewReceipts?.[stage]??null,kind:'INDEPENDENT_EXECUTED_SIX_AXIS_REVIEW',axes:['technical','semantic','source','state','intent','continuity'],generatorSelfRatingAccepted:false},null,2)+'\n')
  if(!auth.waitForIndependentReview||!auth.reviewReceipts?.[stage])return gate(stage)
  // Keeps the isolated account/database alive during one approved batch. No
  // reissue or new budget: an external reviewer supplies the actual evidence.
  while(!gate(stage)){
   assertCoachSourceFreeze(freezePath)
   if(Date.parse(auth.expiresAt)<=Date.now())return false
   const path=auth.reviewReceipts[stage];if(existsSync(path)&&JSON.parse(readFileSync(path,'utf8')).outcome==='fail')return false
   await new Promise(r=>setTimeout(r,1000))
  }
  return true
 }
 async function syntheticAccount(){
  const signup=await request('/api/auth/sign-up/email',{email:'real-synthetic-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID(),name:'Synthetic adult'})
  if(!signup.ok)throw new Error('SYNTHETIC_ACCOUNT_NOT_AVAILABLE')
  actor=(await signup.json()).user.id;cookie=signup.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')
  await json('/api/memory/settings',{requestId:randomUUID(),enabled:true,expectedRevision:0})
 }
 try{
  await syntheticAccount()
  const pairs=JSON.parse(readFileSync(root+'COMPLEX_DECISION_AB_EVAL.json','utf8')).cases,ordinary=JSON.parse(readFileSync(root+'ORDINARY_PERFORMANCE_PROTOCOL.json','utf8')).cases
  const repairPilot=readRepairPilotCases(auth),pilot=repairPilot?{complex:[],ordinary:repairPilot}:selectRealPilotCases(auth,pairs,ordinary)
  if(preflight.pilotContinuation){record({type:'independent_pilot_continuation',...preflight.pilotContinuation})}
  else{
   for(const c of pilot.complex)await turn('small',c.caseId,await chat(),c.input,c.directions)
   const repairChats=new Map<number,string>()
   for(const c of pilot.ordinary){
    // A separately labeled, predeclared repair set never replaces old samples.
    // Shared session ids exercise actual short-answer and state continuation.
    if(repairPilot){readRepairPilotCases(auth);const session=(c as {session:number}).session;if(!repairChats.has(session))repairChats.set(session,await chat());await turn('small',c.caseId,repairChats.get(session)!,c.input)}
    else await turn('small',c.caseId,await chat(),c.input)
   }
  }
  if(auth.smallOrdinaryOnly)return {status:'REAL_ORDINARY_SMALL_WAITING_INDEPENDENT_REVIEW',results:results.length,cozeComplex:'NOT_TESTED_SEPARATE_CURRENT_CLOUD_ENTRY_REQUIRED',fullPerformanceAcceptance:'NOT_TESTED_LESS_THAN_TWENTY',autoContinuation:false}
  if(auth.smallComplexOnly)return {status:'REAL_COMPLEX_SMALL_WAITING_INDEPENDENT_REVIEW',results:results.length,ordinarySamples:'PREVIOUS_FIRST3_PRESERVED_NOT_REISSUED',cozeComplex:'NOT_TESTED_SEPARATE_CURRENT_CLOUD_ENTRY_REQUIRED',autoContinuation:false}
  if(!preflight.pilotContinuation&&!await waitForReview('small'))return {status:'WAITING_INDEPENDENT_SMALL_BATCH_REVIEW',results:results.length,stagesRemaining:realBatchStages.slice(1)}
  const chains=JSON.parse(readFileSync('tests/fixtures/workflow-student16.json','utf8')).students.slice(0,4)
  for(const chain of chains){await syntheticAccount();const chats=[await chat(),await chat(),await chat()];for(const [i,r]of chain.rounds.entries())await turn('four_chains',chain.id+'-'+i,chats[r.session],r.text)}
  if(!await waitForReview('four_chains'))return {status:'WAITING_INDEPENDENT_CHAIN_REVIEW'}
  await json('/api/memory/settings',{requestId:randomUUID(),enabled:false,expectedRevision:1})
  const blinded:any[]=[]
  for(const c of pairs){const arms=Math.random()<0.5?['single','multi']:['multi','single'];record({type:'private_blind_pair_assignment',caseId:c.caseId,arms});const answers:any[]=[];for(const arm of arms){comparisonMode=arm as 'single'|'multi';await turn('complex20_pairs',c.caseId+'-'+arm,await chat(),c.input,c.directions);const row=results.at(-1);const nodes=decisionAudits.get(row.deepId)??[];const inputs=nodes.filter(x=>x.decisionInputDigest).map(x=>({inputDigest:x.decisionInputDigest,modelSignature:x.modelSignature,sourceDigest:x.sourceDigest}));answers.push({label:answers.length?'B':'A',decisionInputs:inputs,answer:row.deep?.receipt?.proposal??null,failure:row.failure})}const fingerprints=answers.flatMap(a=>a.decisionInputs.map((x:any)=>JSON.stringify(x)));const comparable=answers.every(a=>a.decisionInputs.length>0)&&new Set(fingerprints).size===1;blinded.push({pair:c.caseId,input:c.input,authorizedEvidence:c.authorizedEvidence,comparisonContract:'same_structured_proposal_facts_methods_budget_model_one_vs_at_most_five_calls',comparable,answers});writeFileSync(resolve(directory,'BLIND_REVIEW_INPUT.json'),JSON.stringify({kind:'ANONYMIZED_VALUE_SET_NOT_SELF_GRADED',pairs:blinded},null,2)+'\n')}
  comparisonMode='multi'
  if(!await waitForReview('complex20_pairs'))return {status:'WAITING_INDEPENDENT_BLIND_PAIR_REVIEW_NO_GAIN_CLAIM'}
  for(const c of ordinary)await turn('ordinary20',c.caseId,await chat(),c.input)
  return {status:'REAL_RESULTS_WAITING_REVIEW',coze:'NOT_TESTED_CURRENT_CLOUD_VERSION_AND_NATIVE_CREDIT_BINDING_REQUIRED',results:results.length}
 }finally{config.origin=oldOrigin;oldAdvanced===undefined?delete process.env.LIFEOS_ADVANCED_WORKFLOWS:process.env.LIFEOS_ADVANCED_WORKFLOWS=oldAdvanced;app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));const {localEmbedding}=await import('../server/local-embedding.ts');await localEmbedding.close();await pool.end()}
}
async function main(){const args=process.argv.slice(2),auth=args.find(x=>x.startsWith('--authorization='))?.slice(16),directory=resolve(args.find(x=>x.startsWith('--output='))?.slice(9)??'.local/real-batch-preflight');mkdirSync(directory,{recursive:true});const report=args.includes('--execute')&&auth?await executeRealBatch(auth,directory):realBatchPreflight(auth);writeFileSync(resolve(directory,'preflight.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,authorization:undefined}))}
if(process.argv[1]&&resolve(process.argv[1])===resolve('scripts/workflow-real-batch.ts'))await main()
