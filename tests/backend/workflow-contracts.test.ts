import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,appendFileSync,mkdirSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {parseRequest,parseProposal,WorkflowError,type WorkflowReceipt} from '../../server/workflows/contracts.ts'
import {routeWorkflow,advancedWorkflowsEnabled} from '../../server/workflows/router.ts'
import {validateEvidence,validateProposal} from '../../server/workflows/evidence-gate.ts'
import {createOrchestrator,type WorkflowNode} from '../../server/workflows/orchestrator.ts'
import {createTrace} from '../../server/workflows/trace.ts'
import {fixture,proposal,result} from '../workflows/fixtures.ts'

const unavailable=(code:string)=>(e:unknown)=>e instanceof WorkflowError&&e.code===code
const baseReceipt=(traceId:string):WorkflowReceipt=>({schemaVersion:2,traceId,status:'proposed',providerCalls:0,costCny:0,reservedCostCny:0,executionKind:'local_deterministic',skills:[],fallback:'none'})
const output=(process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/agent-workflows/evidence')+'/WORKFLOW_EXECUTION_TRACES.jsonl'
mkdirSync(process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/agent-workflows/evidence',{recursive:true})
test('G1 v2 schema rejects unknown fields, excessive cost/calls and model writes',()=>{
 const {request}=fixture();assert.equal(parseRequest(request).schemaVersion,2)
 for(const invalid of [{...request,schemaVersion:1},{...request,modelBudget:{...request.modelBudget,maxProviderCalls:6}},{...request,secret:'fake-secret'},{...request,modelBudget:{...request.modelBudget,maxCostCny:NaN}}])assert.throws(()=>parseRequest(invalid),unavailable('invalid_contract'))
 assert.throws(()=>parseProposal({...proposal(request),suggestedStateChanges:[{identity:'upgrade'}]}),unavailable('invalid_contract'))
})
test('G1 frozen 16 routing categories, default flag off and no provider usage',()=>{
 assert.equal(advancedWorkflowsEnabled({}),false)
 const fixtures=JSON.parse(readFileSync('tests/fixtures/workflow-routing-v2.json','utf8')) as {name:string;patch:Record<string,unknown>;controls?:Record<string,unknown>;consent?:Record<string,unknown>;expected:string}[]
 assert.equal(fixtures.length,16)
 for(const row of fixtures){const {request}=fixture();Object.assign(request,row.patch);Object.assign(request.controls,row.controls);Object.assign(request.consent,row.consent);assert.equal(routeWorkflow(request,true).route,row.expected,row.name);assert.equal(routeWorkflow(request,false).route,'fast',row.name)}
})
test('G1 cross account, Memory OFF and assistant evidence denied',()=>{
 const {request,records}=fixture()
 assert.throws(()=>validateEvidence(request,request.authorizedEvidenceRefs,[{...records[0],owner:'other'},records[1]]),unavailable('scope_denied'))
 request.controls.memoryEnabled=false;records[1].conversationId=randomUUID();assert.throws(()=>validateEvidence(request,request.authorizedEvidenceRefs,records),unavailable('scope_denied'))
 records[1].conversationId=request.conversationId;records[1].role='assistant';assert.throws(()=>validateEvidence(request,request.authorizedEvidenceRefs,records),unavailable('source_invalid'))
})
test('G1 withdrawal, paused/rejected source, revision and exact quote checked',()=>{
 for(const status of ['withdrawn','paused','rejected'] as const){const {request,records}=fixture();records[0].status=status;assert.throws(()=>validateEvidence(request,request.authorizedEvidenceRefs,records),unavailable('source_invalid'))}
 const {request,records}=fixture();records[0].ref={...records[0].ref,revision:2};assert.throws(()=>validateEvidence(request,request.authorizedEvidenceRefs,records),unavailable('stale_snapshot'))
 const f=fixture();f.records[1].text='unrelated';assert.throws(()=>validateEvidence(f.request,f.request.authorizedEvidenceRefs,f.records),unavailable('source_invalid'))
})
test('G1 unapproved public source and event identity mismatch denied',()=>{
 const {request,records}=fixture();records[0].eventId=randomUUID();assert.throws(()=>validateEvidence(request,request.authorizedEvidenceRefs,records),unavailable('scope_denied'))
 const ref={type:'knowledge' as const,id:randomUUID(),revision:1};request.authorizedEvidenceRefs=[ref]
 assert.throws(()=>validateEvidence(request,[ref],[{ref,owner:null,conversationId:null,status:'active',role:'public',text:'public',approved:false}]),unavailable('source_invalid'))
})
test('G1 constraints use source-backed period budget, proposed actions summed',()=>{
 const {request,records}=fixture();const p=proposal(request)
 p.nextActions[0].estimatedMinutes=361;assert.throws(()=>validateProposal(request,p,records),unavailable('constraint_conflict'))
 p.nextActions[0].estimatedMinutes=30;p.alternatives[0].directionId='forbidden';assert.throws(()=>validateProposal(request,p,records),unavailable('constraint_conflict'))
})
test('G1 right source ID with invented amount or different time period cannot pass the budget gate',()=>{
 const {request,records}=fixture(),p=proposal(request)
 request.budget!.amountMinutes=480;assert.throws(()=>validateProposal(request,p,records),unavailable('constraint_conflict'))
 request.budget!.amountMinutes=360;request.budget!.period='next_week';assert.throws(()=>validateProposal(request,p,records),unavailable('constraint_conflict'))
})
test('G1 in-flight and terminal idempotency, conflicting request cannot bill again',async()=>{
 const {request,records}=fixture();let calls=0
 const runner=createOrchestrator({readEvidence:async()=>records,traceSink:row=>appendFileSync(output,JSON.stringify(row)+'\n')})
 const nodes:WorkflowNode[]=[{id:'n',role:'case_resolver',dependencies:[],executionKind:'local_deterministic',maxCostCny:0,invoke:async()=>{calls++;return {result:result(request.authorizedEvidenceRefs),costCny:0,providerCalls:0}}}]
 const [a,b]=await Promise.all([runner.run(request,nodes,async r=>baseReceipt(r.traceId)),runner.run(request,nodes,async r=>baseReceipt(r.traceId))]);assert.deepEqual(a,b);assert.equal(calls,1)
 await runner.run(request,nodes,async r=>baseReceipt(r.traceId));assert.equal(calls,1)
 await assert.rejects(()=>runner.run({...request,currentIntent:'different'},nodes,async r=>baseReceipt(r.traceId)),unavailable('request_conflict'))
})
test('G1 zero budget prevents invocations before the wire',async()=>{
 const {request,records}=fixture();request.modelBudget.maxProviderCalls=0;request.modelBudget.maxCostCny=0;let calls=0
 const runner=createOrchestrator({readEvidence:async()=>records})
 const receipt=await runner.run(request,[{id:'p',role:'path_analyst',dependencies:[],executionKind:'simulated_provider',maxCostCny:0.02,invoke:async()=>{calls++;return {result:result(request.authorizedEvidenceRefs),costCny:0.01,providerCalls:1}}}],async r=>baseReceipt(r.traceId))
 assert.equal(receipt.failure,'budget_exceeded');assert.equal(calls,0);assert.equal(receipt.providerCalls,0)
})
test('G1 cancellation handles provider ignoring AbortSignal and late return',async()=>{
 const {request,records}=fixture(),controller=new AbortController();let resolveLate!:(value:any)=>void
 const runner=createOrchestrator({readEvidence:async()=>records})
 const run=runner.run(request,[{id:'p',role:'path_analyst',dependencies:[],executionKind:'simulated_provider',maxCostCny:0.02,invoke:()=>new Promise(resolve=>{resolveLate=resolve;controller.abort()})}],async r=>baseReceipt(r.traceId),controller.signal)
 const receipt=await run;assert.equal(receipt.failure,'cancelled');assert.equal(receipt.costCny,null);assert.equal(receipt.reservedCostCny,0.02);assert.equal(receipt.status,'unavailable')
 resolveLate({result:result(request.authorizedEvidenceRefs),costCny:0.01,providerCalls:1});await new Promise(resolve=>setImmediate(resolve));assert.equal(runner.trace.rows.filter(x=>x.status==='succeeded').length,0)
})
test('G1 deadline bounds hung evidence reader and provider without retries',async()=>{
 const f=fixture();f.request.modelBudget.deadlineMs=20
 const hungReader=createOrchestrator({readEvidence:()=>new Promise(()=>{})});assert.equal((await hungReader.run(f.request,[],async r=>baseReceipt(r.traceId))).failure,'timeout')
 const runner=createOrchestrator({readEvidence:async()=>f.records});assert.equal((await runner.run(f.request,[{id:'n',role:'case_resolver',dependencies:[],executionKind:'local_deterministic',maxCostCny:0,invoke:()=>new Promise(()=>{})}],async r=>baseReceipt(r.traceId))).failure,'timeout')
})
test('G1 changed snapshot during execution invalidates entire result',async()=>{
 const f=fixture();const runner=createOrchestrator({readEvidence:async()=>f.records})
 const receipt=await runner.run(f.request,[{id:'n',role:'case_resolver',dependencies:[],executionKind:'local_deterministic',maxCostCny:0,invoke:async()=>{f.records[0].ref={...f.records[0].ref,revision:2};return {result:result(f.request.authorizedEvidenceRefs),costCny:0,providerCalls:0}}}],async r=>baseReceipt(r.traceId))
 assert.equal(receipt.failure,'stale_snapshot');assert.equal(receipt.status,'unavailable')
})
test('G1 malformed DAG and per-node billing overrun have no successful receipt',async()=>{
 const f=fixture();let calls=0;const runner=createOrchestrator({readEvidence:async()=>f.records})
 assert.equal((await runner.run(f.request,[{id:'n',role:'case_resolver',dependencies:['absent'],executionKind:'local_deterministic',maxCostCny:0,invoke:async()=>{calls++;return {result:result([]),costCny:0,providerCalls:0}}}],async r=>baseReceipt(r.traceId))).failure,'invalid_contract');assert.equal(calls,0)
 const f2=fixture(),r2=createOrchestrator({readEvidence:async()=>f2.records})
 assert.equal((await r2.run(f2.request,[{id:'p',role:'path_analyst',dependencies:[],executionKind:'simulated_provider',maxCostCny:0.01,invoke:async()=>({result:result(f2.request.authorizedEvidenceRefs),costCny:0.02,providerCalls:1})}],async r=>baseReceipt(r.traceId))).failure,'budget_exceeded')
})
test('G1 trace retains hashed refs and safe errors only, observer cannot change output',async()=>{
 const f=fixture();f.request.currentIntent='SECRET_PRIVATE_QUOTE'
 const runner=createOrchestrator({readEvidence:async()=>f.records,traceSink:()=>{throw new Error('raw credential')}})
 const receipt=await runner.run(f.request,[{id:'n',role:'case_resolver',dependencies:[],executionKind:'local_deterministic',maxCostCny:0,invoke:async()=>{throw new Error('raw credential SECRET_PRIVATE_QUOTE')}}],async r=>baseReceipt(r.traceId))
 const trace=JSON.stringify(runner.trace.rows);assert.equal(receipt.failure,'unavailable');assert.ok(!trace.includes('SECRET_PRIVATE_QUOTE'));assert.ok(!trace.includes('credential'));assert.ok(!trace.includes(f.request.internalActorKey));assert.ok(!trace.includes(f.request.authorizedEvidenceRefs[0].id))
 const t=createTrace();assert.notEqual(t.digest('same'),createTrace().digest('same'))
})
