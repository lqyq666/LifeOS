import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {cozePreflight,verifyCozeReceipt} from '../../scripts/workflow-coze-real.ts'
import {parseCozeDirectionReceipt} from '../../server/workflows/coze-direction-adapter.ts'
import {workflowRuntimeVersion} from '../../server/workflows/runtime-version.ts'
import {fixture as workflowFixture,proposal as workflowProposal} from '../workflows/fixtures.ts'
import {pool} from '../../server/db.ts'
test.after(()=>pool.end())
test('restored scope without a bound copy or its own runtime budget stays zero-dispatch and read-only',()=>{
 const path='.local/v1.3-action-coach/paid/provider-calls.json',hash=()=>existsSync(path)?createHash('sha256').update(readFileSync(path)).digest('hex'):'MISSING_NOT_COPIED',before=hash(),pre=cozePreflight()
 assert.equal(pre.status,'BLOCKED_CONFIG_NOT_RUN');assert.equal(pre.scopeRestored,true);assert.equal(pre.cloudDispatches,0);assert.equal(pre.uploads,0);assert.equal(pre.newProjects,0);assert.ok(pre.blocks.includes('TARGET_BATCH_AUTHORIZATION_BINDING_MISSING'));assert.ok(pre.blocks.includes('LEGACY_CNY_EXECUTOR_CANNOT_SPEND_COZE_CREDITS'));assert.equal(hash(),before)
})
test('local current-copy contract refuses cancelled, source conflicts, wrong releases, malformed and missing usage receipts',()=>{
 const expected={projectId:'7693388932939300905',businessRole:'growth' as const,release:'synthetic-only',sourceDigest:'a'.repeat(64),contentHash:'b'.repeat(64)},valid={schemaVersion:2,status:'proposed',runtime:expected,suggestedStateChanges:[],receipt:{id:'synthetic-local',usageCompleteness:'unknown',providerCalls:4,skills:[]}}
 assert.equal(verifyCozeReceipt(valid,expected).receipt.usageCompleteness,'unknown')
 for(const body of [{...valid,runtime:{...expected,projectId:'another'}},{...valid,runtime:{...expected,sourceDigest:'c'.repeat(64)}},{...valid,runtime:{...expected,release:'old'}},{...valid,suggestedStateChanges:[{kind:'goal'}]},{...valid,receipt:null},{...valid,receipt:{...valid.receipt,providerCalls:6}}])assert.throws(()=>verifyCozeReceipt(body,expected))
 assert.throws(()=>verifyCozeReceipt(valid,expected,true),/CANCELLED/)
})

test('observed cloud roles bind parsers and reject swapped projects, missing roles and legacy growth output',()=>{
 const common={release:'synthetic-only',sourceDigest:'a'.repeat(64),contentHash:'b'.repeat(64)}
 const expected={...common,projectId:'7693465311558795327',businessRole:'public_knowledge' as const}
 const valid={schemaVersion:1,items:[],runtime:expected,receipt:{id:'synthetic-public',usageCompleteness:'unknown'}}
 assert.equal(verifyCozeReceipt(valid,expected).items.length,0)
 assert.throws(()=>verifyCozeReceipt({...valid,runtime:{...expected,businessRole:'growth'}},expected),/ROLE/)
 const {businessRole:_,...withoutRole}=expected
 assert.throws(()=>verifyCozeReceipt({...valid,runtime:withoutRole},expected),/ROLE/)
 const swapped={...expected,projectId:'7693388932939300905'}
 assert.throws(()=>verifyCozeReceipt({...valid,runtime:swapped},swapped),/ROLE/)
 const growth={...common,projectId:'7693388932939300905',businessRole:'growth' as const}
 assert.throws(()=>verifyCozeReceipt({schemaVersion:1,reply:'legacy',runtime:growth,receipt:valid.receipt},growth))
})

test('Coze receipt rejects a reviewed-priority marker when the reviewed result contains multiple actions',()=>{
 const f=workflowFixture(),candidate=workflowProposal(f.request),second={...candidate.nextActions[0],description:'再核实另一个方向的机会要求'}
 candidate.actionSelection='reviewed_priority';candidate.nextActions.push(second)
 const body={schemaVersion:2,requestId:f.request.requestId,traceId:f.request.traceId,executionKind:'real_provider',receiptIncomplete:false,workerFinishedAtReturn:true,suggestedStateChanges:[],status:'proposed',providerCalls:5,reservedCostCny:0.05,costCny:0.02,proposal:candidate,reviewedProposalFields:{alternatives:candidate.alternatives,nextActions:candidate.nextActions},reviewIssues:[],skills:workflowRuntimeVersion.skills.filter(s=>['lifeos-direction-analysis','lifeos-experience-evidence'].includes(s.name)).map(s=>({name:s.name,loaded:true,sha256:s.sha256,version:s.version}))}
 assert.throws(()=>parseCozeDirectionReceipt(body,f.request,f.records),/invalid_contract/)
 const noPriority=workflowProposal(f.request);noPriority.actionSelection='no_priority'
 assert.throws(()=>parseCozeDirectionReceipt({...body,proposal:noPriority,reviewedProposalFields:{alternatives:noPriority.alternatives,nextActions:noPriority.nextActions}},f.request,f.records),/invalid_contract/)
 const legacy=workflowProposal(f.request),{actionSelection:_,...legacyProposal}=legacy
 const parsed=parseCozeDirectionReceipt({...body,proposal:legacyProposal,reviewedProposalFields:{alternatives:legacy.alternatives,nextActions:legacy.nextActions}},f.request,f.records)
 assert.equal(parsed.proposal?.actionSelection,'unranked_options')
})
