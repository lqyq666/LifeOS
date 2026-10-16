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
 const body={schemaVersion:2,requestId:f.request.requestId,traceId:f.request.traceId,executionKind:'real_provider',status:'proposed',failure:null,suggestedStateChanges:[],proposal:p,reviewedProposalFields:{alternatives:p.alternatives,nextActions:p.nextActions},reviewIssues:[{severity:'uncertainty',text:'采用与付款仍未知',evidenceRefs:[],resolution:'waiting_user'}],trace:[...f.request.directions.map(d=>({nodeId:'path:'+d.id,status:'ok'})),{nodeId:'critic',status:'ok'},{nodeId:'synthesize',status:'ok'}],providerCalls:5,costCny:0.001,reservedCostCny:0.1,skills:workflowRuntimeVersion.skills.filter(s=>['lifeos-direction-analysis','lifeos-experience-evidence'].includes(s.name)).map(s=>({...s,loaded:'True'}))}
 return {...f,body}
}
test('actual-shaped receipt preserves proposal, unknown review and versioned Skill metadata',()=>{
 const f=sample(),r=parseCozeDirectionReceipt(f.body,f.request,f.records)
 assert.equal(r.status,'proposed');assert.equal(r.providerCalls,5)
 assert.equal(r.reviewIssues?.[0].resolution,'keep_unknown');assert.deepEqual(r.proposal,f.body.proposal)
 assert.deepEqual(r.skillLoadReceipts,f.body.skills.map(s=>({...s,loaded:true})))
})

test('actual Python review issues normalize only null optional fields',()=>{
 const f=sample(),body=structuredClone(f.body) as any
 Object.assign(body.reviewIssues[0],{category:null,affectedClaims:null})
 const issue=parseCozeDirectionReceipt(body,f.request,f.records).reviewIssues![0]
 assert.equal(issue.resolution,'keep_unknown')
 assert.equal(Object.hasOwn(issue,'category'),false)
 assert.equal(Object.hasOwn(issue,'affectedClaims'),false)
 body.reviewIssues[0].resolution=null
 assert.equal(Object.hasOwn(parseCozeDirectionReceipt(body,f.request,f.records).reviewIssues![0],'resolution'),false)
 for(const bad of [{text:null},{evidenceRefs:null},{category:'invented'},{affectedClaims:'invented'},{unexpected:null}]){
  const invalid=structuredClone(body);Object.assign(invalid.reviewIssues[0],bad)
  assert.throws(()=>parseCozeDirectionReceipt(invalid,f.request,f.records),/invalid_contract/)
 }
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
test('remote synthesis preserves only comparison hypotheses returned by independent review',()=>{
 const f=sample(),hypothesis={text:'先比较两条路径各自有无可核实实践反馈',limitation:'现有信息不能替本人选择路径，需本人确认',needsConfirmation:true as const}
 f.body.proposal.hypotheses=[hypothesis]
 f.body.reviewedProposalFields.hypotheses=[hypothesis]
 assert.deepEqual(parseCozeDirectionReceipt(f.body,f.request,f.records).proposal?.hypotheses,[hypothesis])
 const unreviewed=structuredClone(f.body);unreviewed.reviewedProposalFields.hypotheses=[]
 assert.throws(()=>parseCozeDirectionReceipt(unreviewed,f.request,f.records),/source_invalid/)
})
test('cancel acknowledgements and incomplete worker cleanup never expose a proposal',()=>{
 const f=sample()
 for(const x of [{...f.body,status:'cancel_requested',failure:'cancelled'}, {...f.body,workerFinishedAtReturn:false}, {...f.body,receiptIncomplete:true}])assert.throws(()=>parseCozeDirectionReceipt(x,f.request,f.records))
})
test('a proposed receipt requires every direction, critic and synthesis node to succeed',()=>{
 const f=sample()
 for(const nodeId of [...f.request.directions.map(d=>'path:'+d.id),'critic','synthesize']){
  for(const status of ['failed','cancelled']){
   const body=structuredClone(f.body),node=body.trace.find((row:any)=>row.nodeId===nodeId)!
   node.status=status
   assert.throws(()=>parseCozeDirectionReceipt(body,f.request,f.records),/invalid_contract/)
  }
 }
})
test('withdrawn source, cross-account evidence, wrong trace and wrong Skill version are refused',()=>{
 const f=sample()
 assert.throws(()=>parseCozeDirectionReceipt(f.body,f.request,f.records.map(x=>({...x,status:'withdrawn'}))))
 assert.throws(()=>parseCozeDirectionReceipt(f.body,f.request,f.records.map(x=>({...x,owner:'someone-else'}))))
 assert.throws(()=>parseCozeDirectionReceipt({...f.body,traceId:'wrong'},f.request,f.records))
 assert.throws(()=>parseCozeDirectionReceipt({...f.body,skills:f.body.skills.map(s=>({...s,version:'old'}))},f.request,f.records))
 assert.throws(()=>parseCozeDirectionReceipt({...f.body,skills:f.body.skills.map(s=>({...s,loaded:'False'}))},f.request,f.records))
})
test('every claimed Skill load is allowlisted, unique, version-bound and hash-bound',()=>{
 const f=sample(),optional=workflowRuntimeVersion.skills.find(s=>s.name==='lifeos-action-review')!
 const withOptional=structuredClone(f.body);withOptional.skills.push({...optional,loaded:true})
 const accepted=parseCozeDirectionReceipt(withOptional,f.request,f.records)
 assert.deepEqual(accepted.skillLoadReceipts,withOptional.skills.map(s=>({...s,loaded:true})))
 const cases=[
  (body:any)=>{body.skills.push({name:'unknown-skill',version:'0.2.0-candidate',sha256:'0'.repeat(64),loaded:true})},
  (body:any)=>{body.skills[2].sha256='0'.repeat(64)},
  (body:any)=>{body.skills.push({...body.skills[0]})},
 ]
 for(const mutate of cases){const body=structuredClone(withOptional);mutate(body);assert.throws(()=>parseCozeDirectionReceipt(body,f.request,f.records),/source_invalid/)}
})
test('invalid call counts and fabricated zero or negative accounting cannot expose a candidate',()=>{
 const f=sample()
 for(const row of [{providerCalls:6},{providerCalls:0},{costCny:-1},{reservedCostCny:999},{costCny:undefined}])assert.throws(()=>parseCozeDirectionReceipt({...f.body,...row},f.request,f.records),/invalid_contract/)
})

test('cloud main companion Skill is preserved with exact frozen metadata, never trusted by name alone',()=>{
 const f=sample(),main={name:'lifeos-personal-companion',version:workflowRuntimeVersion.skillVersion,sha256:workflowRuntimeVersion.mainSkillDigest,loaded:'True'}
 f.body.skills.push(main)
 const accepted=parseCozeDirectionReceipt(f.body,f.request,f.records)
 assert.deepEqual(accepted.skillLoadReceipts?.find(s=>s.name===main.name),{...main,loaded:true})
 assert.ok(accepted.skills.includes(main.name))
 for(const patch of [{sha256:'0'.repeat(64)},{version:'old'},{loaded:'False'},{name:'invented-companion'}]){
  const body=structuredClone(f.body);Object.assign(body.skills.at(-1)!,patch)
  assert.throws(()=>parseCozeDirectionReceipt(body,f.request,f.records),/source_invalid/)
 }
 const duplicate=structuredClone(f.body);duplicate.skills.push({...main})
 assert.throws(()=>parseCozeDirectionReceipt(duplicate,f.request,f.records),/source_invalid/)
 const mainOnly={...f.body,skills:[main]}
 assert.throws(()=>parseCozeDirectionReceipt(mainOnly,f.request,f.records),/source_invalid/)
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
