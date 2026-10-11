import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture,proposal} from './workflows/fixtures.ts'
import {parseCozeDirectionReceipt,createCozeDirectionAdapter,type CozeDirectionConfig} from '../server/workflows/coze-direction-adapter.ts'
import {workflowRuntimeVersion} from '../server/workflows/runtime-version.ts'
import {validateReviewedFields} from '../server/workflows/reviewed-fields.ts'

// Protocol unit fixtures only: these never stand for real Coze execution,
// independent review, owner approval, student benefit or actual costs.
function sample(){
 const f=fixture(),p=proposal(f.request)
 const body={schemaVersion:2,requestId:f.request.requestId,traceId:f.request.traceId,executionKind:'real_provider',status:'proposed',failure:null,suggestedStateChanges:[],proposal:p,reviewedProposalFields:{alternatives:p.alternatives,nextActions:p.nextActions},reviewIssues:[{severity:'uncertainty',text:'采用与付款仍未知',evidenceRefs:[],resolution:'waiting_user'}],providerCalls:5,costCny:0.001,reservedCostCny:0.1,skills:workflowRuntimeVersion.skills.filter(s=>['lifeos-direction-analysis','lifeos-experience-evidence'].includes(s.name)).map(s=>({...s,loaded:'True'}))}
 return {...f,body}
}
test('actual-shaped receipt preserves proposal, unknown review and versioned Skill metadata',()=>{
 const f=sample(),r=parseCozeDirectionReceipt(f.body,f.request,f.records)
 assert.equal(r.status,'proposed');assert.equal(r.providerCalls,5)
 assert.equal(r.reviewIssues?.[0].resolution,'keep_unknown');assert.deepEqual(r.proposal,f.body.proposal)
})
test('synthesis cannot add a claim or restore an unreviewed action',()=>{
 for(const mutate of [
  (x:ReturnType<typeof sample>)=>{x.body.proposal.alternatives[0].pros.push('已付款且效果很好')},
  (x:ReturnType<typeof sample>)=>{x.body.proposal.nextActions[0].description='扩大接单'},
 ]){
  const f=sample();f.body.reviewedProposalFields=structuredClone(f.body.reviewedProposalFields);mutate(f)
  assert.throws(()=>parseCozeDirectionReceipt(f.body,f.request,f.records),/source_invalid/)
 }
})
test('cancel acknowledgements and incomplete worker cleanup never expose a proposal',()=>{
 const f=sample()
 for(const x of [{...f.body,status:'cancel_requested',failure:'cancelled'}, {...f.body,workerFinishedAtReturn:false}, {...f.body,receiptIncomplete:true}])assert.throws(()=>parseCozeDirectionReceipt(x,f.request,f.records))
})
test('withdrawn source, cross-account evidence, wrong trace and wrong Skill version are refused',()=>{
 const f=sample()
 assert.throws(()=>parseCozeDirectionReceipt(f.body,f.request,f.records.map(x=>({...x,status:'withdrawn'}))))
 assert.throws(()=>parseCozeDirectionReceipt(f.body,f.request,f.records.map(x=>({...x,owner:'someone-else'}))))
 assert.throws(()=>parseCozeDirectionReceipt({...f.body,traceId:'wrong'},f.request,f.records))
 assert.throws(()=>parseCozeDirectionReceipt({...f.body,skills:f.body.skills.map(s=>({...s,version:'old'}))},f.request,f.records))
 assert.throws(()=>parseCozeDirectionReceipt({...f.body,skills:f.body.skills.map(s=>({...s,loaded:'False'}))},f.request,f.records))
})
test('invalid call counts and fabricated zero or negative accounting cannot expose a candidate',()=>{
 const f=sample()
 for(const row of [{providerCalls:6},{providerCalls:0},{costCny:-1},{reservedCostCny:999},{costCny:undefined}])assert.throws(()=>parseCozeDirectionReceipt({...f.body,...row},f.request,f.records),/invalid_contract/)
})
test('same field gate serves both remote and existing native synthesis',()=>{
 const f=sample();validateReviewedFields(f.body.proposal,{...f.body.reviewedProposalFields,hypotheses:[]})
 assert.throws(()=>validateReviewedFields({...f.body.proposal,hypotheses:[{text:'已经适合创业',limitation:'未知',needsConfirmation:true}]},{...f.body.reviewedProposalFields,hypotheses:[]}),/source_invalid/)
})
test('missing binding, original runtime credit ceiling or wrong project stops before dispatch',()=>{
 const cfg:CozeDirectionConfig={projectId:'7693388932939300905',endpoint:'https://synthetic-test.coze.site/run',token:'synthetic-existing-test-runtime-token',binding:{hostSourceDigest:workflowRuntimeVersion.sourceDigest,cloudCommit:'a'.repeat(40),cloudSourceDigest:'b'.repeat(64),contentHash:workflowRuntimeVersion.contentHash,skillsDigest:'c'.repeat(64)},approval:{kind:'test-only-not-authorization',approvalSource:'test'},creditsLedgerPath:'not-a-real-ledger',maxCreditsPerGraph:0,journalDirectory:'not-a-real-journal'}
 let wire=0
 assert.throws(()=>createCozeDirectionAdapter({config:cfg,freezePath:'not-a-freeze',readEvidence:async()=>[],readMethods:async()=>[],fetchImpl:async()=>{wire++;throw Error('must not dispatch')}}))
 assert.equal(wire,0)
})
