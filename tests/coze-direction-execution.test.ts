import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname,resolve} from 'node:path'
import {fixture,proposal} from './workflows/fixtures.ts'
import {CoachProviderBudget} from '../scripts/coach-provider-budget.ts'
import {CozeCreditBudget} from '../scripts/coze-credit-budget.ts'
import {captureCoachSource} from '../scripts/coach-source-freeze.ts'
import {createCozeDirectionAdapter,prepareCozeJournalDirectory,type CozeDirectionConfig} from '../server/workflows/coze-direction-adapter.ts'
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
 f.request.modelBudget.maxCostCny=adapter.maxCostPerCallCny*(f.request.directions.length+2)
 return {...f,budget,credits,journal,adapter,finished,root,config}
}

test('an older smaller request budget cannot silently fund the enlarged input envelope',async()=>{
 let posts=0;const f=setup(async()=>{posts++;throw Error('must not dispatch')})
 f.request.modelBudget.maxCostCny=.1
 const receipt=await f.adapter.runRemoteGraph!(f.request,f.journal)
 assert.equal(receipt.status,'unavailable');assert.equal(posts,0)
 assert.equal(f.budget.snapshot().calls.length,0);assert.equal(f.credits.balance().heldCredits,0)
})

function proposedReceipt(wire:any,config:CozeDirectionConfig,request:ReturnType<typeof fixture>['request']){
 const claims=JSON.parse(Buffer.from(wire.claimsB64,'base64').toString('utf8'))
 const trace=claims.slots.map((slot:any,index:number)=>({callId:slot.callId,nodeId:slot.nodeId,reservedCostCny:slot.reservedCostCny,status:slot.nodeId==='critic'?'failed':'ok',started:100+index,ended:200+index,usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},providerResponseId:'synthetic-provider-'+index,model:claims.model,actualPromptBytes:100}))
 const costCny=trace.reduce((sum:number,row:any)=>sum+(row.usage.prompt_tokens*claims.inputCnyPerMillion+row.usage.completion_tokens*claims.outputCnyPerMillion)/1e6,0)
 const canonical=JSON.parse(readFileSync('.planning/research/workflow-integration/COZE_CANONICAL_PUBLIC_ASSETS.json','utf8'))
 const approvedSubsetHash=sha(canonical.cards.map((c:any)=>sha(String(c.claim??'')+'\n'+String(c.excerpt??'')+'\n'+(c.mechanisms??[]).map(String).join(' ')+'\n'+String(c.limitations??''))).sort().join(''))
 return {schemaVersion:2,requestId:claims.requestId,traceId:request.traceId,executionKind:'real_provider',status:'proposed',failure:null,receiptIncomplete:false,workerFinishedAtReturn:true,suggestedStateChanges:[],runtime:{projectId:config.projectId,businessRole:'growth',hostSourceDigest:config.binding.hostSourceDigest,cloudCommit:config.binding.cloudCommit,cloudSourceDigest:config.binding.cloudSourceDigest,canonicalContentHash:config.binding.contentHash,canonicalSourceRegistryHash:workflowRuntimeVersion.sourceRegistryHash,canonicalEvidenceHash:workflowRuntimeVersion.contentEvidenceHash,approvedSubsetHash,fullCorpusHash:config.binding.contentHash,candidateRelease:'0.2.0-candidate',skillsDigest:config.binding.skillsDigest},trace,providerCalls:trace.length,costCny,reservedCostCny:trace.reduce((sum:number,row:any)=>sum+row.reservedCostCny,0),proposal:proposal(request),reviewedProposalFields:{alternatives:proposal(request).alternatives,nextActions:proposal(request).nextActions},reviewIssues:[],skills:workflowRuntimeVersion.skills.filter(s=>['lifeos-direction-analysis','lifeos-experience-evidence'].includes(s.name)).map(s=>({...s,loaded:'True'}))}
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

test('known failed critic usage settles before its proposed graph is rejected',async()=>{
 let f!:ReturnType<typeof setup>,posts=0
 f=setup(async(_url,init)=>{
  posts++
  const body=JSON.parse(init!.body as string)
  return new Response(JSON.stringify({host_receipt:proposedReceipt(body.host_request,f.config,f.request)}))
 })
 const receipt=await f.adapter.runRemoteGraph!(f.request,f.journal)
 const rows=f.budget.snapshot().calls as any[]
 assert.equal(posts,1,JSON.stringify({receipt}))
 assert.equal(receipt.status,'unavailable')
 assert.equal(receipt.failure,'invalid_contract')
 assert.equal(receipt.proposal,undefined)
 assert.equal(receipt.providerCalls,5)
 assert.ok(Math.abs(Number(receipt.costCny)-0.00175)<1e-12)
 assert.equal(rows.length,5)
 assert.ok(rows.every(row=>typeof row.estimatedCostCny==='number'))
 assert.ok(Math.abs(rows.reduce((sum,row)=>sum+row.estimatedCostCny,0)-0.00175)<1e-12)
 assert.equal(f.finished.length,5)
 assert.ok(f.finished.some(row=>row.id==='critic'&&row.error==='unavailable'))
})

test('durable cancellation winning finalization cannot be replaced by a local Coze proposal',async()=>{
 let f!:ReturnType<typeof setup>
 f=setup(async(_url,init)=>{
  const body=JSON.parse(init!.body as string),receipt=proposedReceipt(body.host_request,f.config,f.request)
  receipt.trace.forEach((row:any)=>{row.status='ok'})
  return new Response(JSON.stringify({host_receipt:receipt}))
 })
 const finish=f.journal.finish;let persisted:any
 f.journal.finish=async(r,receipt)=>{
  assert.equal(receipt.status,'proposed','cloud proposal must reach the terminal persistence race')
  persisted={...receipt,status:'unavailable',failure:'cancelled',proposal:undefined}
  await finish(r,persisted);return persisted
 }
 const receipt=await f.adapter.runRemoteGraph!(f.request,f.journal)
 assert.equal(receipt.status,'unavailable');assert.equal(receipt.failure,'cancelled');assert.equal(receipt.proposal,undefined)
 assert.deepEqual(receipt,persisted)
 assert.deepEqual(await f.adapter.runRemoteGraph!(f.request,f.journal),persisted)
 assert.equal(f.budget.snapshot().calls.length,5,'terminal replay must not create a second graph')
 assert.equal(f.credits.balance().heldCredits,10,'canonical cancellation cannot refund unknown Coze costs')
})

test('Coze transport and cleanup share the original graph deadline without a paid retry',async()=>{
 let graphs=0
 const f=setup(async(_url,init)=>{
  const body=JSON.parse(init!.body as string)
  if(body.host_request.operation)return new Response(JSON.stringify({host_receipt:{status:'unavailable',receiptIncomplete:true,workerFinishedAtReturn:false}}))
  graphs++
  await new Promise((_resolve,reject)=>{const signal=init!.signal!;if(signal.aborted)reject(Error('deadline'));else signal.addEventListener('abort',()=>reject(Error('deadline')),{once:true})})
  throw Error('unreachable')
 })
 f.request.modelBudget.deadlineMs=300
 const started=Date.now(),receipt=await f.adapter.runRemoteGraph!(f.request,f.journal)
 assert.ok(Date.now()-started<1000,'the original deadline includes transport and cleanup')
 assert.equal(receipt.failure,'timeout');assert.equal(receipt.proposal,undefined);assert.equal(graphs,1)
 assert.equal(receipt.costCny,null);assert.equal(receipt.receiptIncomplete,true)
 assert.equal(f.credits.balance().heldCredits,10)
})

test('cancellation journal read failure cannot fabricate an authenticated cancellation',async()=>{
 let f!:ReturnType<typeof setup>,checks=0
 f=setup(async(_url,init)=>{
  const body=JSON.parse(init!.body as string)
  if(body.host_request.operation==='cancel')return new Response(JSON.stringify({host_receipt:{status:'cancel_requested',receiptIncomplete:true,workerFinishedAtReturn:false}}))
  if(!body.host_request.operation)await new Promise(resolve=>setTimeout(resolve,180))
  const receipt=proposedReceipt(body.host_request,f.config,f.request);receipt.trace.forEach((row:any)=>{row.status='ok'})
  return new Response(JSON.stringify({host_receipt:receipt}))
 })
 f.journal.cancelled=async()=>{if(++checks>2)throw Error('synthetic database read failure');return false}
 const receipt=await f.adapter.runRemoteGraph!(f.request,f.journal)
 assert.equal(receipt.failure,'unavailable');assert.equal(receipt.proposal,undefined)
 assert.notEqual(receipt.failure,'cancelled','no user or durable cancellation was observed')
 assert.equal(f.credits.balance().heldCredits,10)
})
test('real Coze graph rejects journals outside the persistent Coze state mount before dispatch',()=>{
 const f=setup(async()=>{throw Error('must not dispatch')})
 const config={...f.config,creditsLedgerPath:resolve('.local/coze-launch/credits-ledger.jsonl'),journalDirectory:join(f.root,'ephemeral-journal')}
 assert.throws(()=>createCozeDirectionAdapter({config,freezePath:f.freezePath,readEvidence:async()=>f.records,readMethods:async()=>[],budget:new CoachProviderBudget(),credits:new CozeCreditBudget(config.creditsLedgerPath)}),(error:any)=>error?.code==='scope_denied')
})

test('persistent Coze journal rejects a symlink or junction that escapes its state mount',()=>{
 const workspace=mkdtempSync(join(tmpdir(),'lifeos-coze-journal-path-test-')),root=join(workspace,'.local','coze-launch'),outside=join(workspace,'outside'),link=join(root,'journal-link')
 mkdirSync(root,{recursive:true});mkdirSync(outside)
 try{
  symlinkSync(outside,link,process.platform==='win32'?'junction':'dir')
  assert.throws(()=>prepareCozeJournalDirectory(workspace,root,link),(error:any)=>error?.code==='scope_denied')
 }finally{rmSync(link,{recursive:true,force:true});rmSync(workspace,{recursive:true,force:true})}
})
