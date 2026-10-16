import {readFileSync,realpathSync,lstatSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve,sep} from 'node:path'

const registryPath='.planning/research/workflow-integration/INDEPENDENT_EXECUTION_BINDINGS.json'
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
function artifactBytes(path:string,expected:string){
 if(typeof path!=='string'||! /^(?:evidence\/|\.planning\/research\/)[\w./-]+$/.test(path)||path.split('/').includes('..')||! /^[a-f0-9]{64}$/.test(expected))throw Error('INDEPENDENT_ARTIFACT_BINDING_INVALID')
 const root=realpathSync(process.cwd()),full=resolve(root,path)
 if(lstatSync(full).isSymbolicLink()||!realpathSync(full).startsWith(root+sep))throw Error('INDEPENDENT_ARTIFACT_PATH_INVALID')
 const bytes=readFileSync(full);if(sha(bytes)!==expected)throw Error('INDEPENDENT_ARTIFACT_CHANGED')
 return bytes
}
const artifact=(path:string,expected:string)=>JSON.parse(artifactBytes(path,expected).toString('utf8'))
// IDs only select reports whose original bytes were read back from the actual
// independent execution. A caller cannot submit its own reviewer name/verdict.
export function readIndependentExecution(id:string){
 const registry=JSON.parse(readFileSync(registryPath,'utf8'))
 if(registry.kind!=='OBSERVED_INDEPENDENT_EXECUTION_BINDINGS')throw Error('INDEPENDENT_REGISTRY_INVALID')
 const binding=registry.executions.find((x:any)=>x.id===id)
 if(!binding)throw Error('INDEPENDENT_EXECUTION_NOT_BOUND')
 const proof=artifact(binding.proofPath,binding.proofSha256),report=artifact(binding.reportPath,binding.reportSha256),input=artifact(binding.inputPath,binding.inputSha256)
 const taskId=report.session??report.execution?.taskId,executor=report.executor??report.execution?.executor
 if(proof.kind!=='OBSERVED_COZE_INDEPENDENT_REPORT_BYTES'||proof.projectId!=='7693465311558795327'||proof.taskId!==binding.taskId||proof.cloudCommit!==binding.cloudCommit||proof.reportHashes[binding.reportPath.split('/').at(-1)!]!==binding.reportSha256||taskId!==binding.taskId||executor==='current-main-codex'||!executor||! /^[a-f0-9]{40}$/.test(binding.cloudCommit))throw Error('INDEPENDENT_EXECUTION_PROOF_INVALID')
 return {binding,proof,report,input,reviewerId:`coze:${proof.projectId}:${proof.sessionId}:${proof.cloudCommit}`}
}
export function readOriginalCardReview(executionId:string,card:{id:string;revision:number;guide?:{contentHash:string;claims:{id:string;basis:string;evidenceIds:string[]}[]}},sources:any[],evidence:any[]){
 const execution=readIndependentExecution(executionId),{binding,report}=execution
 if(binding.scope!=='kb_original_card_review'||report.kind!=='INDEPENDENT_ORIGINAL_CARD_REVIEW'||report.execution?.projectId!==execution.proof.projectId||report.execution?.sessionId!==execution.proof.sessionId)throw Error('INDEPENDENT_CARD_SCOPE_INVALID')
 const review=report.cards?.find((c:any)=>c.guideId===card.id&&c.revision===card.revision&&c.contentHash===card.guide?.contentHash)
 if(!review||review.decision!=='ready_for_owner_approval'||!Array.isArray(review.claimChecks)||review.claimChecks.length!==card.guide!.claims.length||new Set(review.claimChecks.map((c:any)=>c.claimId)).size!==review.claimChecks.length)throw Error('INDEPENDENT_CARD_VERSION_OR_DECISION_INVALID')
 const read=(remotePath:string,expected:string)=>{
  const registered=binding.artifacts?.find((a:any)=>a.remotePath===remotePath&&a.sha256===expected)
  if(!registered)throw Error('INDEPENDENT_ORIGINAL_NOT_BOUND')
  return artifactBytes(registered.path,registered.sha256)
 }
 for(const claim of card.guide!.claims){
  const check=review.claimChecks.find((c:any)=>c.claimId===claim.id)
  if(!check||check.basis!==claim.basis||typeof check.reason!=='string'||!check.reason.trim())throw Error('INDEPENDENT_CLAIM_NOT_CHECKED')
  if(claim.basis==='editorial_adaptation'){if(check.decision!=='supported_as_editorial')throw Error('INDEPENDENT_EDITORIAL_NOT_CHECKED');continue}
  if(!['source_supported','bounded_synthesis'].includes(claim.basis)||check.decision!=='supported'||!Array.isArray(check.evidenceChecks)||!claim.evidenceIds.length||check.evidenceChecks.length!==claim.evidenceIds.length||new Set(check.evidenceChecks.map((x:any)=>x.evidenceId)).size!==claim.evidenceIds.length||claim.evidenceIds.some(id=>!check.evidenceChecks.some((x:any)=>x.evidenceId===id)))throw Error('INDEPENDENT_CLAIM_UNSUPPORTED')
  for(const locator of check.evidenceChecks){
   const ev=evidence.find(e=>e.evidence_id===locator.evidenceId&&claim.evidenceIds.includes(e.evidence_id)),source=ev&&sources.find(s=>s.source_id===ev.source_id&&s.source_revision===ev.source_revision)
   const original=report.originals?.find((o:any)=>o.sourceId===source?.source_id&&o.sourceRevision===source?.source_revision&&o.normalizedTextPath===locator.normalizedTextPath)
   if(!ev||!source||source.access_status!=='body_accessible'||!original||original.boundSourceFingerprint!==source.original_fingerprint||original.canonicalUrl!==source.canonical_url||locator.sourceId!==source.source_id||locator.sourceRevision!==source.source_revision||ev.quote!==locator.quote||ev.content_hash!==locator.quoteSha256||!['INDEPENDENT_HTTP_FULL_ORIGINAL_READ','HASH_VERIFIED_DOWNLOADED_ORIGINAL_FULL_BODY_READ'].includes(original.acquisition))throw Error('INDEPENDENT_SOURCE_OR_QUOTE_INVALID')
   read(original.artifactPath,original.artifactBytesSha256)
   const text=read(original.normalizedTextPath,original.normalizedTextSha256).toString('utf8')
   if(!Number.isSafeInteger(locator.start)||!Number.isSafeInteger(locator.end)||locator.start<0||locator.end<=locator.start||text.slice(locator.start,locator.end)!==locator.quote||sha(Buffer.from(locator.quote))!==locator.quoteSha256)throw Error('INDEPENDENT_QUOTE_LOCATION_INVALID')
  }
 }
 return {executionId,reviewerId:execution.reviewerId,review,taskId:binding.taskId,cloudCommit:binding.cloudCommit,reportPath:binding.reportPath,reportSha256:binding.reportSha256}
}
export function availableOriginalCardReviews(card:Parameters<typeof readOriginalCardReview>[1],sources:any[],evidence:any[]){
 const registry=JSON.parse(readFileSync(registryPath,'utf8'))
 return registry.executions.filter((b:any)=>b.scope==='kb_original_card_review').flatMap((b:any)=>{try{return [readOriginalCardReview(b.id,card,sources,evidence)]}catch{return []}})
}
export function readReviewedPilotContinuation(id:string){
 const execution=readIndependentExecution(id),{binding,report,input}=execution
 if(binding.scope!=='real_small_pilot'||report.kind!=='small5_independent_sixaxis_review_r3'||report.inputSha256!==binding.inputSha256)throw Error('INDEPENDENT_PILOT_BINDING_INVALID')
 const original=[...input.ordinary.cases,...input.complex.cases],rows=report.samples
 if(!Array.isArray(rows)||rows.length!==5||original.length!==5||new Set(rows.map((x:any)=>x.caseId)).size!==5||rows.some((row:any)=>!original.some((x:any)=>x.caseId===row.caseId)||row.artifactSha!==binding.inputSha256||['technicalCompleted','semanticCorrect','necessaryStateCommitted','intentRespected'].some(k=>row.axis?.[k]!=='PASS')||!['PASS','PASS_NO_EXTERNAL_CLAIM'].includes(row.axis?.sourceSupported)||row.axis?.crossSessionContinuity!=='NOT_TESTED_SINGLE_TURN'))throw Error('INDEPENDENT_PILOT_NOT_ELIGIBLE')
 return {executionId:id,reviewerId:execution.reviewerId,nextStage:'four_chains',priorSamples:5,priorVersions:{ordinary:input.ordinary.source.head,complex:input.complex.source.head},continuity:'NOT_TESTED_SINGLE_TURN',sameVersionFinalPerformance:'NOT_ACCEPTED_BY_PILOT',originalRequestsReissued:false,releaseEligible:false}
}
