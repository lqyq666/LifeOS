import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {CoachProviderBudget} from '../scripts/coach-provider-budget.ts'
import {reserveCozeHostPermit,verifyCozeHostPermit,deriveCozePermitSecret,retainUnknownCozeGraph,settleCozeHostReceipt} from '../scripts/coze-host-permit.ts'
const sha=(x:string)=>createHash('sha256').update(x).digest('hex')
const binding={hostSourceDigest:'a'.repeat(64),cloudCommit:'b'.repeat(40),cloudSourceDigest:'c'.repeat(64),contentHash:'d'.repeat(64),skillsDigest:'e'.repeat(64)}
const approval={kind:'OWNER_APPROVED_LIFEOS_COZE_CORE_LAUNCH',approvalSource:'CURRENT_CHAT_DIRECT_HUMAN_REPLY',cozePauseLifted:true,productModelPauseLifted:true,directHttpRouteApproval:{source:'CURRENT_CHAT_DIRECT_HUMAN_REPLY',exactAnswer:'批准新的实现路线，仍只用已有额度',newBudget:0,automaticPaidRetry:false,publishBeforeCoreGates:false}}
const secret=deriveCozePermitSecret('synthetic-existing-runtime-token-not-a-real-secret')
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'lifeos-host-permit-test-')),evidence=join(root,'evidence/v1.2.1-reliability/20261003-authorized300-11')
 mkdirSync(evidence,{recursive:true})
 writeFileSync(join(evidence,'PROVIDER_AUTHORIZATION.json'),JSON.stringify({runs:[],batchMaximumCalls:300,observedStarts:0,unreservedRemaining:300,unknownUsageCalls:0,knownEstimatedSubtotalCny:0}))
 const budget=new CoachProviderBudget({root,simulation:true,testDirectory:'simulation-test'});budget.snapshot()
 writeFileSync(join(dirname(budget.path),'development-test-grant-20261005.json'),JSON.stringify({kind:'SIMULATED_DEVELOPMENT_TEST_GRANT',amountCny:30,startingCall:0,priorReceiptsSha256:sha('[]')}))
 budget.activateCurrentGrant()
 const payload={schemaVersion:2,businessRole:'growth',syntheticAdult:true,requestId:randomUUID(),mode:'direction_decision',directions:[{id:'employment'},{id:'freelance'}],modelBudget:{maxProviderCalls:4,maxCostCny:0.16,deadlineMs:90000},currentIntent:'合成成年学生：就业优先，交付过一次，采用和付款未知。',evidenceRecords:[{text:'交付一次，采用和付款未知',role:'user'}]}
 return {budget,payload,binding,approval,secret,nodeIds:['path:employment','path:freelance','critic','synthesize'],maxCostPerCallCny:0.04,journalPath:join(root,'first-attempt.jsonl'),now:1791643000000}
}
test('whole graph is durably reserved in the existing budget before a signed cloud request exists',()=>{
 const input=fixture(),wire=reserveCozeHostPermit(input),decoded=verifyCozeHostPermit(wire,secret,binding,input.now+1)
 assert.deepEqual(decoded.payload,input.payload)
 assert.equal(decoded.claims.slots.length,4);assert.equal(input.budget.snapshot().calls.length,4)
 assert.equal(input.budget.snapshot().currentGrant.remainingCny,29.84)
 assert.match(readFileSync(input.journalPath,'utf8'),/first_graph_intent/)
 const serialized=JSON.stringify(wire)
 assert.ok(!serialized.includes(secret));assert.ok(!serialized.includes('provider-calls.json'))
 assert.throws(()=>reserveCozeHostPermit(input),/EEXIST/)
 assert.equal(input.budget.snapshot().calls.length,4)
})
test('tampered payload, forged signature, wrong real build and expired permit are refused',()=>{
 const input=fixture(),wire=reserveCozeHostPermit(input)
 assert.throws(()=>verifyCozeHostPermit({...wire,payloadB64:Buffer.from(JSON.stringify({...input.payload,currentIntent:'改变目标'})).toString('base64')},secret,binding,input.now),/CONFLICT/)
 assert.throws(()=>verifyCozeHostPermit({...wire,signature:'0'.repeat(64)},secret,binding,input.now),/SIGNATURE/)
 assert.throws(()=>verifyCozeHostPermit(wire,secret,{...binding,cloudCommit:'f'.repeat(40)},input.now),/CONFLICT/)
 assert.throws(()=>verifyCozeHostPermit(wire,secret,binding,input.now-1),/CLOCK/)
 assert.throws(()=>verifyCozeHostPermit(wire,secret,binding,input.now+300000),/EXPIRED/)
 const claims=JSON.parse(Buffer.from(wire.claimsB64,'base64').toString()),claimsB64=Buffer.from(JSON.stringify({...claims,maxOutputTokens:8192})).toString('base64')
 assert.throws(()=>verifyCozeHostPermit({...wire,claimsB64,signature:createHmac('sha256',secret).update(claimsB64).digest('hex')},secret,binding,input.now),/LIMIT_CONFLICT/)
})
test('missing direct-human route approval and unbounded graphs reserve nothing',()=>{
 for(const mutation of [
  (x:ReturnType<typeof fixture>)=>({...x,approval:{...approval,directHttpRouteApproval:undefined}}),
  (x:ReturnType<typeof fixture>)=>({...x,binding:{...binding,cloudCommit:'unknown'}}),
  (x:ReturnType<typeof fixture>)=>({...x,nodeIds:[...x.nodeIds,'hidden_retry']}),
  (x:ReturnType<typeof fixture>)=>({...x,maxCostPerCallCny:0.00001}),
  (x:ReturnType<typeof fixture>)=>({...x,payload:{...x.payload,modelBudget:{...x.payload.modelBudget,maxCostCny:0.01}}})
 ]){const x=fixture();assert.throws(()=>reserveCozeHostPermit(mutation(x)));assert.equal(x.budget.snapshot().calls.length,0)}
})
test('a normal authorized account is signed with syntheticAdult false without changing its identity',()=>{
 const input=fixture(),payload={...input.payload,syntheticAdult:false}
 const wire=reserveCozeHostPermit({...input,payload})
 assert.equal(verifyCozeHostPermit(wire,secret,binding,input.now).payload.syntheticAdult,false)
 assert.equal(input.budget.snapshot().calls.length,4)
})
test('cancelled or missing cloud receipt keeps full unknown reserve across process recreation',()=>{
 const input=fixture(),wire=reserveCozeHostPermit(input)
 retainUnknownCozeGraph(wire,secret,binding,input.budget,'cancelled',input.journalPath)
 const after=input.budget.snapshot()
 assert.equal(after.currentGrant.accountedCny,0.16)
 assert.ok(after.calls.every((row:any)=>row.estimatedCostCny==='unknown'&&row.providerResponseId===null))
 assert.throws(()=>retainUnknownCozeGraph(wire,secret,binding,input.budget,'cancelled',input.journalPath),/RESERVATION_CONFLICT/)
 assert.throws(()=>reserveCozeHostPermit({...input,journalPath:input.journalPath+'.new'}),/DUPLICATE_PROVIDER_LOGICAL_CALL/)
 assert.equal(input.budget.snapshot().calls.length,4)
})
test('database/ledger lock failure cannot produce a signed graph or partially reserve nodes',()=>{
 const input=fixture()
 writeFileSync(input.budget.path+'.lock',JSON.stringify({pid:process.pid}))
 assert.throws(()=>reserveCozeHostPermit(input),/BUDGET_LOCKED/)
 const persisted=JSON.parse(readFileSync(input.budget.path,'utf8'));assert.equal(persisted.calls.length,0)
})
test('three directions reserve exactly five calls, never an extra synthesis or automatic repair',()=>{
 const input=fixture(),payload={...input.payload,directions:[...input.payload.directions,{id:'entrepreneurship'}],modelBudget:{...input.payload.modelBudget,maxProviderCalls:5,maxCostCny:0.2}},nodeIds=[...input.nodeIds.slice(0,2),'path:entrepreneurship','critic','synthesize']
 const wire=reserveCozeHostPermit({...input,payload,nodeIds})
 assert.equal(verifyCozeHostPermit(wire,secret,binding,input.now).claims.slots.length,5)
 assert.equal(input.budget.snapshot().calls.length,5)
})

test('complete three-direction review has a signed byte cap backed by the full worst-case reserve',()=>{
 const insufficient=fixture()
 assert.throws(()=>reserveCozeHostPermit({...insufficient,maxCostPerCallCny:.02}),/BUDGET_INVALID/)
 assert.equal(insufficient.budget.snapshot().calls.length,0)
 const input=fixture(),wire=reserveCozeHostPermit(input)
 const decoded=verifyCozeHostPermit(wire,secret,binding,input.now)
 assert.equal(decoded.claims.maxPromptUtf8Bytes,32768)
 assert.ok(decoded.claims.slots.every(s=>s.reservedCostCny>=(36864*.8+2048*2.7)/1e6))
 const claims={...decoded.claims,maxPromptUtf8Bytes:32769}
 const claimsB64=Buffer.from(JSON.stringify(claims)).toString('base64')
 assert.throws(()=>verifyCozeHostPermit({...wire,claimsB64,signature:createHmac('sha256',secret).update(claimsB64).digest('hex')},secret,binding,input.now),/LIMIT_CONFLICT/)
})

test('historical small permits remain readable with their original limits and reservations',()=>{
 const input=fixture(),wire=reserveCozeHostPermit(input)
 const claims=JSON.parse(Buffer.from(wire.claimsB64,'base64').toString())
 claims.maxPromptUtf8Bytes=12000
 claims.slots=claims.slots.map((s:any)=>({...s,reservedCostCny:.02}))
 const claimsB64=Buffer.from(JSON.stringify(claims)).toString('base64')
 const old={...wire,claimsB64,signature:createHmac('sha256',secret).update(claimsB64).digest('hex')}
 assert.equal(verifyCozeHostPermit(old,secret,binding,input.now).claims.maxPromptUtf8Bytes,12000)
 claims.maxPromptUtf8Bytes=32768
 const widened=Buffer.from(JSON.stringify(claims)).toString('base64')
 assert.throws(()=>verifyCozeHostPermit({...old,claimsB64:widened,signature:createHmac('sha256',secret).update(widened).digest('hex')},secret,binding,input.now),/BUDGET_INVALID/)
})

function receiptFor(input:ReturnType<typeof fixture>,wire:ReturnType<typeof reserveCozeHostPermit>){
 const {claims}=verifyCozeHostPermit(wire,secret,binding,input.now)
 return {schemaVersion:2,requestId:input.payload.requestId,traceId:input.payload.requestId,status:'proposed',executionKind:'real_provider',suggestedStateChanges:[],providerCalls:4,reservedCostCny:.16,costCny:.0014,runtime:{projectId:'7693388932939300905',businessRole:'growth',hostSourceDigest:binding.hostSourceDigest,cloudCommit:binding.cloudCommit,cloudSourceDigest:binding.cloudSourceDigest,canonicalContentHash:binding.contentHash,skillsDigest:binding.skillsDigest},trace:claims.slots.map(s=>({...s,status:'ok',started:100,ended:200,providerResponseId:'actual-response-'+s.nodeId,model:'qwen3.8-flash',usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},actualPromptBytes:200,finishReason:'stop'}))}
}
test('actual bound per-slot receipt settles the existing ledger atomically; duplicate never settles again',()=>{
 const input=fixture(),wire=reserveCozeHostPermit(input),receipt=receiptFor(input,wire)
 const out=settleCozeHostReceipt({wire,secret,binding,budget:input.budget,receipt,journalPath:input.journalPath})
 assert.equal(out.providerCalls,4);assert.equal(out.costCny,.0014)
 assert.equal(input.budget.snapshot().currentGrant.accountedCny,.0014)
 assert.throws(()=>settleCozeHostReceipt({wire,secret,binding,budget:input.budget,receipt,journalPath:input.journalPath}),/RESERVATION_CONFLICT/)
})
test('signed content registry, evidence, approved subset, full corpus and release require exact actual receipt fields',()=>{
 const contentBinding={canonicalContentHash:binding.contentHash,canonicalSourceRegistryHash:'1'.repeat(64),canonicalEvidenceHash:'2'.repeat(64),approvedSubsetHash:'3'.repeat(64),fullCorpusHash:'4'.repeat(64),candidateRelease:'0.2.0-candidate'}
 for(const key of Object.keys(contentBinding)){
  const input=fixture(),wire=reserveCozeHostPermit({...input,payload:{...input.payload,contentBinding}}),receipt:any=receiptFor(input,wire)
  receipt.workerFinishedAtReturn=true;Object.assign(receipt.runtime,contentBinding);receipt.runtime[key]=key==='candidateRelease'?'old-release':'f'.repeat(64)
  assert.throws(()=>settleCozeHostReceipt({wire,secret,binding,budget:input.budget,receipt,journalPath:input.journalPath}),/INVALID/);assert.ok(input.budget.snapshot().calls.every((c:any)=>c.status==='reserved'))
 }
 const input=fixture(),wire=reserveCozeHostPermit({...input,payload:{...input.payload,contentBinding}}),receipt:any=receiptFor(input,wire);receipt.workerFinishedAtReturn=true;Object.assign(receipt.runtime,contentBinding)
 assert.equal(settleCozeHostReceipt({wire,secret,binding,budget:input.budget,receipt,journalPath:input.journalPath}).providerCalls,4)
})
test('missing usage keeps its full reserve; only explicit unstarted slots release as not-sent',()=>{
 const input=fixture(),wire=reserveCozeHostPermit(input),receipt=receiptFor(input,wire)
 receipt.trace[0].usage=null as any;receipt.costCny=null as any
 Object.assign(receipt.trace[3],{status:'not_sent',started:null,ended:null,providerResponseId:null,usage:null,model:null,actualPromptBytes:null,finishReason:null});receipt.providerCalls=3;receipt.status='unavailable'
 const out=settleCozeHostReceipt({wire,secret,binding,budget:input.budget,receipt,journalPath:input.journalPath})
 assert.equal(out.costCny,null);assert.equal(out.providerCalls,3)
 const calls=input.budget.snapshot().calls
 assert.equal(calls[0].estimatedCostCny,'unknown');assert.equal(calls[3].outcome,'not_sent');assert.equal(calls[3].estimatedCostCny,0)
 assert.ok(Math.abs(input.budget.snapshot().currentGrant.accountedCny-.0407)<1e-9)
})
test('wrong runtime, omitted/duplicated slots, altered usage/call ids and incomplete receipt change no reservations',()=>{
 for(const mutate of [
  (r:any)=>r.runtime.cloudCommit='f'.repeat(40),
  (r:any)=>r.trace.pop(),
  (r:any)=>r.trace[3]={...r.trace[0]},
  (r:any)=>r.trace[0].callId=randomUUID(),
  (r:any)=>r.trace[0].usage.prompt_tokens=-1,
  (r:any)=>r.trace[0].usage.completion_tokens=2049,
  (r:any)=>r.providerCalls=0,
  (r:any)=>r.costCny=0,
  (r:any)=>r.receiptIncomplete=true,
  (r:any)=>r.workerFinishedAtReturn=false,
 ]){
  const input=fixture(),wire=reserveCozeHostPermit(input),receipt=receiptFor(input,wire);mutate(receipt)
  assert.throws(()=>settleCozeHostReceipt({wire,secret,binding,budget:input.budget,receipt,journalPath:input.journalPath}))
  assert.ok(input.budget.snapshot().calls.every((c:any)=>c.status==='reserved'));assert.equal(input.budget.snapshot().currentGrant.accountedCny,.16)
 }
})
