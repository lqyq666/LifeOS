import {readFileSync,writeFileSync,mkdirSync,existsSync,appendFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {captureCoachSource,assertCoachSourceFreeze} from './coach-source-freeze.ts'
import {CoachProviderBudget,activeCoachFunding} from './coach-provider-budget.ts'
import {validateCodeEndpoint,parseCodeWorkflowBusinessBody} from '../server/coze-code-workflow.ts'
const digest=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex')
const bundlePath='.planning/research/workflow-integration/COZE_COMPATIBILITY_CANDIDATE.json'
export const cozeProjectRoles={'7693388932939300905':'growth','7693465311558795327':'public_knowledge'} as const
type CozeBusinessRole=typeof cozeProjectRoles[keyof typeof cozeProjectRoles]
export function cozePreflight(path?:string){
 const source=captureCoachSource(),bundle=JSON.parse(readFileSync(bundlePath,'utf8')),ledgerPath='.local/v1.3-action-coach/paid/provider-calls.json',bytes=existsSync(ledgerPath)?readFileSync(ledgerPath):null,ledger=bytes?JSON.parse(bytes.toString()):null,auth=path?JSON.parse(readFileSync(path,'utf8')):null,blocks:string[]=[]
 const launchPath='.planning/research/workflow-integration/LAUNCH_AUTHORIZATION.json',launch=existsSync(launchPath)?JSON.parse(readFileSync(launchPath,'utf8')):null
 const scopeRestored=launch?.kind==='OWNER_APPROVED_LIFEOS_COZE_CORE_LAUNCH'&&launch.cozePauseLifted===true&&launch.approvalSource==='CURRENT_CHAT_DIRECT_HUMAN_REPLY'
 if(auth?.kind!=='OWNER_APPROVED_LIFEOS_COZE_BATCH'||auth.pauseLifted!==true)blocks.push(scopeRestored?'TARGET_BATCH_AUTHORIZATION_BINDING_MISSING':'EXPLICIT_COZE_PAUSE_NOT_LIFTED')
 // This legacy executor reserves CNY from the model-development ledger. An
 // account credit balance must never enable spending from that different pool.
 blocks.push('LEGACY_CNY_EXECUTOR_CANNOT_SPEND_COZE_CREDITS')
 if(bundle.sourceDigest!==source.digest)blocks.push('LOCAL_CANDIDATE_SOURCE_STALE_REGENERATE_LOCAL_ONLY')
 if(auth&&(auth.head!==execFileSync('git',['rev-parse','HEAD']).toString().trim()||auth.sourceDigest!==source.digest||auth.contentHash!==bundle.contentHash||auth.ledgerSha256!==(bytes?digest(bytes):null)))blocks.push('AUTHORIZATION_BINDING_MISMATCH')
 if(auth&&(!auth.ownerApprovalEvidence||!existsSync(auth.ownerApprovalEvidence)||digest(readFileSync(auth.ownerApprovalEvidence))!==auth.ownerApprovalSha256||Date.parse(auth.expiresAt)<=Date.now()||!Number.isFinite(Date.parse(auth.expiresAt))))blocks.push('OWNER_APPROVAL_MISSING_OR_EXPIRED')
 const funding=ledger?activeCoachFunding(ledger):null
 if(!funding||funding.paused||typeof funding.remainingCny!=='number'||funding.remainingCny<=0)blocks.push('EXISTING_BUDGET_NOT_AVAILABLE')
 if(auth&&(!(auth.maxSpendCny>0)||!funding||auth.maxSpendCny>funding.remainingCny||auth.fundingScopeAllowsCoze!==true))blocks.push('NO_NEW_BUDGET_OR_UNAPPROVED_FUNDING_SCOPE')
 if(auth){
  if(!Array.isArray(auth.projects)||auth.projects.length!==2)blocks.push('EXACT_TWO_EXISTING_PROJECTS_REQUIRED')
  for(const project of bundle.projects){const target=auth.projects?.find((x:any)=>x.projectId===project.projectId)
   if(project.businessRole!==cozeProjectRoles[project.projectId as keyof typeof cozeProjectRoles]||target?.businessRole!==project.businessRole)blocks.push('PROJECT_BUSINESS_ROLE_MISMATCH_'+project.projectId)
   if(!target||!target.endpoint||!target.tokenEnv||!process.env[target.tokenEnv]||!target.release||!(target.maxCostPerRequestCny>0)||!target.copyReadbackEvidence||!existsSync(target.copyReadbackEvidence)||digest(readFileSync(target.copyReadbackEvidence))!==target.copyReadbackSha256)blocks.push('CURRENT_COPY_CONFIG_OR_COST_CAP_MISSING_'+project.projectId)
   else try{const checked=validateCodeEndpoint(target.endpoint);if(new URL(checked.url).pathname!==`/v1/fs/${project.projectId}/run`)blocks.push('PROJECT_ENDPOINT_MISMATCH')}catch{blocks.push('ENDPOINT_NOT_ALLOWED')}
  }
  if(auth.projects?.reduce((s:number,p:any)=>s+p.maxCostPerRequestCny*3,0)>auth.maxSpendCny)blocks.push('FIRST_ATTEMPTS_EXCEED_EXISTING_AUTHORIZED_CAP')
 }
 return {status:blocks.length?(scopeRestored?'BLOCKED_CONFIG_NOT_RUN':'PAUSED_NOT_RUN'):'READY_FOR_AUTHORIZED_CLOUD_FIRST_ATTEMPTS',scopeRestored,sourceDigest:source.digest,contentHash:bundle.contentHash,cloudDispatches:0,newProjects:0,uploads:0,blocks,auth,bundle}
}
export function verifyCozeReceipt(body:any,expected:{projectId:string;businessRole:CozeBusinessRole;release:string;sourceDigest:string;contentHash:string},cancelled=false){
 if(cancelled)throw new Error('CANCELLED_RECEIPT_REJECTED')
 if(cozeProjectRoles[expected.projectId as keyof typeof cozeProjectRoles]!==expected.businessRole||body?.runtime?.businessRole!==expected.businessRole)throw new Error('CLOUD_BUSINESS_ROLE_CONFLICT')
 if(!body||typeof body!=='object'||Array.isArray(body)||!body.runtime||body.runtime.projectId!==expected.projectId||body.runtime.release!==expected.release||body.runtime.sourceDigest!==expected.sourceDigest||body.runtime.contentHash!==expected.contentHash)throw new Error('CLOUD_RUNTIME_VERSION_OR_SOURCE_CONFLICT')
 if(!body.receipt||typeof body.receipt.id!=='string'||!body.receipt.id||!['complete','unknown'].includes(body.receipt.usageCompleteness))throw new Error('CLOUD_USAGE_RECEIPT_MISSING')
 if(expected.businessRole==='public_knowledge')parseCodeWorkflowBusinessBody(body)
 else if(body.schemaVersion!==2||!['proposed','rejected','cancelled'].includes(body.status)||!Array.isArray(body.suggestedStateChanges)||body.suggestedStateChanges.length||!body.receipt||!Number.isInteger(body.receipt.providerCalls)||body.receipt.providerCalls>5||body.receipt.providerCalls<0||!Array.isArray(body.receipt.skills))throw new Error('CLOUD_WORKFLOW_RECEIPT_INVALID')
 return body
}
export async function executeCozeFirstAttempts(path:string,output:string){
 const pre=cozePreflight(path);if(pre.status!=='READY_FOR_AUTHORIZED_CLOUD_FIRST_ATTEMPTS')return {...pre,auth:undefined}
 mkdirSync(output,{recursive:true});const journal=resolve(output,'coze-first-attempts.jsonl');if(existsSync(journal))throw new Error('FIRST_ATTEMPTS_ALREADY_EXIST_NO_REISSUE')
 const freeze=resolve(output,'coze-source-freeze.json');writeFileSync(freeze,JSON.stringify(captureCoachSource()));const ledger=new CoachProviderBudget(),results:any[]=[]
 for(const project of pre.bundle.projects){const target=pre.auth.projects.find((x:any)=>x.projectId===project.projectId),expected={projectId:project.projectId,businessRole:project.businessRole,release:target.release,sourceDigest:pre.sourceDigest,contentHash:pre.contentHash}
  // Pre-wire cancellation is local and costs nothing; in-flight cancellation
  // remains unknown and fully reserved, never zero-settled or reissued.
  for(const scenario of ['normal','source_conflict','in_flight_cancel']){
   assertCoachSourceFreeze(freeze);if(Date.parse(pre.auth.expiresAt)<=Date.now())throw new Error('AUTHORIZATION_EXPIRED')
   const id=randomUUID(),started=performance.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),scenario==='in_flight_cancel'?50:30000)
   const reserved=ledger.reserve({runId:id,purpose:'diagnostic',tier:'coze',provider:'coze',model:project.projectId,signature:target.release,sourceDigest:pre.sourceDigest,logicalCallId:id,reservedCostCny:target.maxCostPerRequestCny})
   appendFileSync(journal,JSON.stringify({type:'started',id,projectId:project.projectId,scenario,reservedCostCny:target.maxCostPerRequestCny})+'\n')
   let body:any=null,failure:string|null=null
   try{
    const response=await fetch(target.endpoint,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+process.env[target.tokenEnv],'Content-Type':'application/json'},body:JSON.stringify({...project.input,acceptance:{scenario,...expected,sourceDigest:scenario==='source_conflict'?'0'.repeat(64):expected.sourceDigest,syntheticAdult:true},requestId:id}),signal:controller.signal})
    if(!response.ok)throw new Error('CLOUD_HTTP_'+response.status)
    const reader=response.body?.getReader();if(!reader)throw new Error('CLOUD_EMPTY_BODY');let raw='',size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>256*1024){await reader.cancel();throw new Error('CLOUD_RECEIPT_TOO_LARGE')}raw+=Buffer.from(part.value).toString()}
    body=JSON.parse(raw);verifyCozeReceipt(body,expected,controller.signal.aborted)
    if(project.allowlist&&body.items.some((hit:any)=>!project.allowlist.some((card:any)=>card.guideId===hit.documentId&&hit.revision===card.revision&&hit.contentHash===card.contentHash)))throw new Error('CLOUD_UNAPPROVED_OR_WRONG_VERSION_PUBLIC_CARD')
    if(project.businessRole==='growth'&&body.receipt.skills.some((skill:any)=>!pre.bundle.skills.some((local:any)=>local.name===skill.name&&local.sha256===skill.sha256&&local.version===skill.version)))throw new Error('CLOUD_SKILL_VERSION_CONFLICT')
    if(scenario==='source_conflict'&&body.status!=='rejected'&&body.error!=='SOURCE_CONFLICT')throw new Error('CLOUD_DID_NOT_REJECT_SOURCE_CONFLICT')
   }catch(error){failure=error instanceof Error?error.message:'UNKNOWN'}finally{clearTimeout(timer)}
   // Provider cost receipts need reconciliation, so preserve unknown with the
   // full existing reservation even if a cloud response claims cost=0.
   ledger.finish(reserved.callId,{outcome:controller.signal.aborted?'cancelled':failure?'failed':'completed',estimatedCostCny:'unknown',usage:{receiptObserved:Boolean(body),scenario},providerResponseId:typeof body?.receipt?.id==='string'?body.receipt.id:null})
   results.push({projectId:project.projectId,scenario,requestId:id,body,failure,latencyMs:performance.now()-started,costCny:'unknown',reservedCostCny:target.maxCostPerRequestCny,stateCommitAllowed:false})
   appendFileSync(journal,JSON.stringify({type:'finished',...results.at(-1)})+'\n');writeFileSync(resolve(output,'COZE_RESULTS.json'),JSON.stringify({status:'ACTUAL_FIRST_ATTEMPTS_WAITING_INDEPENDENT_RECEIPT_AND_USAGE_REVIEW',sourceDigest:pre.sourceDigest,results},null,2)+'\n')
  }
 }
 return {status:'ACTUAL_CLOUD_RESULTS_WAITING_INDEPENDENT_REVIEW',results,autoPublish:false}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve('scripts/workflow-coze-real.ts')){const args=process.argv.slice(2),auth=args.find(x=>x.startsWith('--authorization='))?.slice(16),out=resolve(args.find(x=>x.startsWith('--output='))?.slice(9)??'.local/coze-batch-preflight');mkdirSync(out,{recursive:true});const result=args.includes('--execute')&&auth?await executeCozeFirstAttempts(auth,out):cozePreflight(auth);writeFileSync(resolve(out,'preflight.json'),JSON.stringify({...result,auth:undefined},null,2)+'\n');console.log(JSON.stringify({...result,auth:undefined,bundle:undefined}))}
