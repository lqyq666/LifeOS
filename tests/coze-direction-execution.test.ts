import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {fixture} from './workflows/fixtures.ts'
import {CoachProviderBudget} from '../scripts/coach-provider-budget.ts'
import {CozeCreditBudget} from '../scripts/coze-credit-budget.ts'
import {captureCoachSource} from '../scripts/coach-source-freeze.ts'
import {createCozeDirectionAdapter,type CozeDirectionConfig} from '../server/workflows/coze-direction-adapter.ts'
import {workflowRuntimeVersion} from '../server/workflows/runtime-version.ts'
import {simulationJournal} from '../server/workflows/task-journal.ts'

// Isolated synthetic accounting and in-memory transport ONLY. No credentials,
// actual ledger, provider, Coze service, student acceptance or approval.
const sha=(s:string)=>createHash('sha256').update(s).digest('hex')
const frozen=captureCoachSource()
function setup(fetchImpl:typeof fetch){
 const root=mkdtempSync(join(tmpdir(),'lifeos-coze-executor-test-')),e=join(root,'evidence/v1.2.1-reliability/20261003-authorized300-11');mkdirSync(e,{recursive:true})
 writeFileSync(join(e,'PROVIDER_AUTHORIZATION.json'),JSON.stringify({runs:[],batchMaximumCalls:300,observedStarts:0,unreservedRemaining:300,unknownUsageCalls:0,knownEstimatedSubtotalCny:0}))
 const budget=new CoachProviderBudget({root,simulation:true,testDirectory:'simulation-test'});budget.snapshot()
 writeFileSync(join(dirname(budget.path),'development-test-grant-20261005.json'),JSON.stringify({kind:'SIMULATED_DEVELOPMENT_TEST_GRANT',amountCny:30,startingCall:0,priorReceiptsSha256:sha('[]')}));budget.activateCurrentGrant()
 const creditPath=join(root,'credits.jsonl'),credits=CozeCreditBudget.initialize(creditPath,100,sha('synthetic authorization NOT real funding')),freezePath=join(root,'freeze.json');writeFileSync(freezePath,JSON.stringify(frozen))
 const config:CozeDirectionConfig={projectId:'7693388932939300905',endpoint:'https://synthetic-test.coze.site/run',token:'synthetic-existing-token-only-not-real',binding:{hostSourceDigest:workflowRuntimeVersion.sourceDigest,cloudCommit:'a'.repeat(40),cloudSourceDigest:'b'.repeat(64),contentHash:workflowRuntimeVersion.contentHash,skillsDigest:'c'.repeat(64)},approval:{kind:'OWNER_APPROVED_LIFEOS_COZE_CORE_LAUNCH',approvalSource:'CURRENT_CHAT_DIRECT_HUMAN_REPLY',cozePauseLifted:true,productModelPauseLifted:true,directHttpRouteApproval:{source:'CURRENT_CHAT_DIRECT_HUMAN_REPLY',exactAnswer:'批准新的实现路线，仍只用已有额度',newBudget:0,automaticPaidRetry:false,publishBeforeCoreGates:false}},creditsLedgerPath:creditPath,maxCreditsPerGraph:10,journalDirectory:join(root,'journal')}
 const f=fixture(),journal={...simulationJournal(),durable:true},finished:any[]=[];journal.finishNode=async(_r,id,_result,cost,calls,error)=>{finished.push({id,cost,calls,error})}
 const adapter=createCozeDirectionAdapter({config,freezePath,readEvidence:async()=>f.records,readMethods:async()=>[],budget,credits,fetchImpl,syntheticTransport:true})
 return {...f,budget,credits,journal,adapter,finished,root}
}
test('opaque network failure holds every original-like reservation and duplicate request never dispatches again',async()=>{
 let posts=0;const f=setup(async()=>{posts++;throw Error('synthetic connection lost AFTER POST')})
 const first=await f.adapter.runRemoteGraph!(f.request,f.journal)
 assert.equal(posts,2);assert.equal(first.failure,'unavailable');assert.equal(first.providerCalls,5);assert.equal(first.providerCallsAreUpperBound,true);assert.equal(first.costCny,null)
 assert.equal(f.budget.snapshot().calls.length,5);assert.ok(f.budget.snapshot().calls.every((c:any)=>c.estimatedCostCny==='unknown'));assert.equal(f.credits.balance().heldCredits,10)
 assert.deepEqual(await f.adapter.runRemoteGraph!(f.request,f.journal),first);assert.equal(posts,2)
})
test('source invalidation before POST produces no charged retry and known zero actual dispatch',async()=>{
 let posts=0;const f=setup(async()=>{posts++;throw Error('must not dispatch')});f.records[0].status='withdrawn'
 const receipt=await f.adapter.runRemoteGraph!(f.request,f.journal)
 assert.equal(receipt.failure,'source_invalid');assert.equal(receipt.providerCalls,0);assert.equal(receipt.costCny,0);assert.equal(posts,0);assert.equal(f.budget.snapshot().calls.length,0);assert.equal(f.credits.balance().heldCredits,0)
})
test('cancel before POST after reservation releases only proven unsent CNY; credit cost stays unknown',async()=>{
 let posts=0,checks=0;const f=setup(async()=>{posts++;throw Error('must not dispatch')});f.journal.cancelled=async()=>++checks>=2
 const receipt=await f.adapter.runRemoteGraph!(f.request,f.journal)
 assert.equal(receipt.failure,'cancelled');assert.equal(receipt.providerCalls,0);assert.equal(posts,0)
 assert.ok(f.budget.snapshot().calls.every((c:any)=>c.outcome==='not_sent'&&c.estimatedCostCny===0));assert.equal(f.credits.balance().heldCredits,10)
})
test('cancel acknowledgement does not settle missing original response or abort its cleanup connection',async()=>{
 const controller=new AbortController();let posts=0,originalSignal:AbortSignal|undefined
 const f=setup(async(_url,init)=>{
  posts++;const body=JSON.parse(init!.body as string)
  if(body.host_request.operation==='cancel')return new Response(JSON.stringify({host_receipt:{status:'cancel_requested',receiptIncomplete:true,workerFinishedAtReturn:false}}))
  if(body.host_request.operation==='readback')return new Response(JSON.stringify({host_receipt:{status:'unavailable',receiptIncomplete:true,workerFinishedAtReturn:false}}))
  originalSignal=init!.signal as AbortSignal;queueMicrotask(()=>controller.abort())
  await new Promise(resolve=>setTimeout(resolve,20));throw Error('synthetic original reply lost')
 })
 const receipt=await f.adapter.runRemoteGraph!(f.request,f.journal,controller.signal)
 assert.equal(posts,3);assert.equal(originalSignal?.aborted,false);assert.equal(receipt.failure,'cancelled');assert.equal(receipt.costCny,null);assert.equal(receipt.providerCallsAreUpperBound,true);assert.equal(receipt.workerFinishedAtReturn,false);assert.equal(receipt.receiptIncomplete,true);assert.equal(receipt.cancelAcknowledged,true);assert.equal(f.credits.balance().heldCredits,10)
 const rows=readFileSync(f.budget.path,'utf8');assert.match(rows,/unknown/)
})
