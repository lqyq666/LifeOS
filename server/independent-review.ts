import {readFileSync,realpathSync,lstatSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve,sep} from 'node:path'

const registryPath='.planning/research/workflow-integration/INDEPENDENT_EXECUTION_BINDINGS.json'
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
function artifact(path:string,expected:string){
 if(typeof path!=='string'||! /^(?:evidence\/|\.planning\/research\/)[\w./-]+$/.test(path)||path.split('/').includes('..')||! /^[a-f0-9]{64}$/.test(expected))throw Error('INDEPENDENT_ARTIFACT_BINDING_INVALID')
 const root=realpathSync(process.cwd()),full=resolve(root,path)
 if(lstatSync(full).isSymbolicLink()||!realpathSync(full).startsWith(root+sep))throw Error('INDEPENDENT_ARTIFACT_PATH_INVALID')
 const bytes=readFileSync(full);if(sha(bytes)!==expected)throw Error('INDEPENDENT_ARTIFACT_CHANGED')
 return JSON.parse(bytes.toString('utf8'))
}
// IDs only select reports whose original bytes were read back from the actual
// independent execution. A caller cannot submit its own reviewer name/verdict.
export function readIndependentExecution(id:string){
 const registry=JSON.parse(readFileSync(registryPath,'utf8'))
 if(registry.kind!=='OBSERVED_INDEPENDENT_EXECUTION_BINDINGS')throw Error('INDEPENDENT_REGISTRY_INVALID')
 const binding=registry.executions.find((x:any)=>x.id===id)
 if(!binding)throw Error('INDEPENDENT_EXECUTION_NOT_BOUND')
 const proof=artifact(binding.proofPath,binding.proofSha256),report=artifact(binding.reportPath,binding.reportSha256),input=artifact(binding.inputPath,binding.inputSha256)
 if(proof.kind!=='OBSERVED_COZE_INDEPENDENT_REPORT_BYTES'||proof.projectId!=='7693465311558795327'||proof.taskId!==binding.taskId||proof.cloudCommit!==binding.cloudCommit||proof.reportHashes[binding.reportPath.split('/').at(-1)!]!==binding.reportSha256||report.session!==binding.taskId||report.executor==='current-main-codex'||!report.executor||! /^[a-f0-9]{40}$/.test(binding.cloudCommit))throw Error('INDEPENDENT_EXECUTION_PROOF_INVALID')
 return {binding,proof,report,input,reviewerId:`coze:${proof.projectId}:${proof.sessionId}:${proof.cloudCommit}`}
}
export function readReviewedPilotContinuation(id:string){
 const execution=readIndependentExecution(id),{binding,report,input}=execution
 if(binding.scope!=='real_small_pilot'||report.kind!=='small5_independent_sixaxis_review_r3'||report.inputSha256!==binding.inputSha256)throw Error('INDEPENDENT_PILOT_BINDING_INVALID')
 const original=[...input.ordinary.cases,...input.complex.cases],rows=report.samples
 if(!Array.isArray(rows)||rows.length!==5||original.length!==5||new Set(rows.map((x:any)=>x.caseId)).size!==5||rows.some((row:any)=>!original.some((x:any)=>x.caseId===row.caseId)||row.artifactSha!==binding.inputSha256||['technicalCompleted','semanticCorrect','necessaryStateCommitted','intentRespected'].some(k=>row.axis?.[k]!=='PASS')||!['PASS','PASS_NO_EXTERNAL_CLAIM'].includes(row.axis?.sourceSupported)||row.axis?.crossSessionContinuity!=='NOT_TESTED_SINGLE_TURN'))throw Error('INDEPENDENT_PILOT_NOT_ELIGIBLE')
 return {executionId:id,reviewerId:execution.reviewerId,nextStage:'four_chains',priorSamples:5,priorVersions:{ordinary:input.ordinary.source.head,complex:input.complex.source.head},continuity:'NOT_TESTED_SINGLE_TURN',sameVersionFinalPerformance:'NOT_ACCEPTED_BY_PILOT',originalRequestsReissued:false,releaseEligible:false}
}
