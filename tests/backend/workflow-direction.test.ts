import test from 'node:test'
import assert from 'node:assert/strict'
import {appendFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {createDirectionWorkflow} from '../../server/workflows/direction-decision.ts'
import {fixture,simulatedDecision,proposal} from '../workflows/fixtures.ts'
import {WorkflowError,type AgentResult} from '../../server/workflows/contracts.ts'
import type {TraceRow} from '../../server/workflows/trace.ts'
const tracePath=(process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/agent-workflows/evidence')+'/WORKFLOW_EXECUTION_TRACES.jsonl'
const runFixture=()=>{const f=fixture();return {...f,reader:async()=>f.records}}
process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
test('G3 3 analysts run in parallel then independent critic and synthesizer: 5 simulated invocations, zero personal writes',async()=>{
 const f=runFixture(),events:string[]=[],rows:TraceRow[]=[]
 let waiting=0,release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve})
 const adapter=simulatedDecision({analyze:async(c,path)=>{events.push('start:'+path.id);if(++waiting===3)release();await barrier;events.push('end:'+path.id);return {result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'synthetic '+path.title,issues:[],proposal:proposal(c.request,[path])},providerCalls:1,costCny:0.01}}})
 const wf=createDirectionWorkflow(f.reader,adapter,row=>{rows.push(row);appendFileSync(tracePath,JSON.stringify(row)+'\n')})
 const receipt=await wf.run(f.request);assert.equal(receipt.status,'proposed');assert.equal(receipt.executionKind,'simulated_provider');assert.equal(receipt.providerCalls,5);assert.equal(receipt.costCny,0.05);assert.deepEqual(receipt.proposal!.suggestedStateChanges,[])
 assert.ok(events.slice(0,3).every(x=>x.startsWith('start:')))
 const completed=rows.filter(x=>x.status==='succeeded').map(x=>x.agentRole)
 assert.deepEqual(completed,['skill','path_analyst','path_analyst','path_analyst','constraint_validator','independent_critic','evidence_guardian','decision_synthesizer'])
 assert.ok(receipt.proposal!.nextActions.reduce((n,x)=>n+x.estimatedMinutes!,0)<=360)
 appendFileSync((process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/agent-workflows/evidence')+'/G3_SIMULATED_RUNS.jsonl',JSON.stringify({evidence:'SIMULATED_PROVIDER_ACTUAL_LOCAL_DAG',analysts:3,parallelBarrier:true,independentCritic:true,simulatedCalls:receipt.providerCalls,simulatedCostCny:receipt.costCny,actualPaidCalls:0,actualPaidCostCny:0,personalWrites:0})+'\n')
})
test('G3 forbidden direction removed before analysis: 2 analysts + critic + synthesis',async()=>{
 const f=runFixture();f.request.controls.forbiddenDirections=['postgraduate_exam'];let analyzed:string[]=[]
 const original=simulatedDecision(),adapter=simulatedDecision({analyze:async(c,path,skill)=>{analyzed.push(path.id);assert.ok(skill.includes('lifeos-direction-analysis'));return original.analyze(c,path,skill)}})
 const receipt=await createDirectionWorkflow(f.reader,adapter).run(f.request);assert.equal(receipt.status,'proposed');assert.equal(receipt.providerCalls,4);assert.ok(!analyzed.includes('postgraduate_exam'));assert.equal(receipt.proposal?.alternatives.length,2)
})
test('G3 unsupported quote/source conflict stops before critic and synthesis',async()=>{
 const f=runFixture();let synthesis=0,critic=0
 const adapter=simulatedDecision({analyze:async c=>({result:{evidenceRefs:[{type:'message',id:randomUUID(),revision:1}],summary:'fabricated source',issues:[]},providerCalls:1,costCny:0.01}),critic:async()=>{critic++;throw new Error('should not run')},synthesize:async()=>{synthesis++;throw new Error('should not run')}})
 const receipt=await createDirectionWorkflow(f.reader,adapter).run(f.request);assert.equal(receipt.status,'unavailable');assert.equal(receipt.failure,'scope_denied');assert.equal(critic,0);assert.equal(synthesis,0)
})
test('G3 analyst time exceeds 6h source budget: hard rejection, no critic',async()=>{
 const f=runFixture();let critic=0
 const adapter=simulatedDecision({analyze:async(c,path)=>{const p=proposal(c.request,[path]);p.alternatives[0].weeklyMinutes=480;return {result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'over budget',issues:[],proposal:p},providerCalls:1,costCny:0.01}},critic:async()=>{critic++;throw new Error('should not run')}})
 const receipt=await createDirectionWorkflow(f.reader,adapter).run(f.request);assert.equal(receipt.failure,'constraint_conflict');assert.equal(critic,0);assert.equal(receipt.providerCalls,3)
})
test('G3 independent critic conflict is retained and prevents synthesizer',async()=>{
 const f=runFixture();let synthesis=0
 const adapter=simulatedDecision({critic:async c=>({result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'证据互相冲突，需要本人核实',issues:[{severity:'blocker',text:'来源只说明一次交付，不能推出稳定能力',evidenceRefs:c.request.authorizedEvidenceRefs}]},providerCalls:1,costCny:0.01}),synthesize:async()=>{synthesis++;throw new Error('should not run')}})
 const receipt=await createDirectionWorkflow(f.reader,adapter).run(f.request);assert.equal(receipt.failure,'constraint_conflict');assert.equal(synthesis,0)
 assert.equal(receipt.providerCalls,4)
 // Critic rejection is a deterministic node before any synthesizer reservation/invocation.
 assert.equal(receipt.costCny,0.04)
})
test('G3 total request budget preflight rejects insufficient calls/cost with zero model invocations',async()=>{
 for(const cap of ['calls','cost']){const f=runFixture();if(cap==='calls')f.request.modelBudget.maxProviderCalls=4;else f.request.modelBudget.maxCostCny=0.09;let called=0
  const adapter=simulatedDecision({analyze:async()=>{called++;throw new Error('should not run')}}),receipt=await createDirectionWorkflow(f.reader,adapter).run(f.request)
  assert.equal(receipt.failure,'budget_exceeded');assert.equal(receipt.providerCalls,0);assert.equal(called,0)
 }
})
test('G3 no deep consent, default disabled, unresolved context and real paid adapter are blocked',async()=>{
 const f=runFixture();f.request.consent.deepAnalysis=false
 await assert.rejects(()=>createDirectionWorkflow(f.reader,simulatedDecision()).run(f.request),/scope_denied/)
 f.request.consent.deepAnalysis=true;delete process.env.LIFEOS_ADVANCED_WORKFLOWS
 await assert.rejects(()=>createDirectionWorkflow(f.reader,simulatedDecision()).run(f.request),/scope_denied/)
 process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
 await assert.rejects(()=>createDirectionWorkflow(f.reader,{...simulatedDecision(),executionKind:'real_provider'}).run(f.request),/unavailable/)
})
test('G3 cancellation/deadline have no synthesized proposal, no retries and unknown reserved costs',async()=>{
 for(const mode of ['cancel','timeout']){
  const f=runFixture(),controller=new AbortController();f.request.modelBudget.deadlineMs=30
  const wf=createDirectionWorkflow(f.reader,simulatedDecision({analyze:async()=>{if(mode==='cancel')controller.abort();return new Promise(()=>{})}}))
  const receipt=await wf.run(f.request,controller.signal);assert.equal(receipt.status,'unavailable');assert.equal(receipt.failure,mode==='cancel'?'cancelled':'timeout');assert.equal(receipt.proposal,undefined);assert.equal(receipt.costCny,null);assert.ok(receipt.reservedCostCny<=0.1)
 }
})
test('G3 replay revalidates withdrawal and cannot resurrect a cached proposal',async()=>{
 const f=runFixture(),wf=createDirectionWorkflow(f.reader,simulatedDecision());assert.equal((await wf.run(f.request)).status,'proposed')
 f.records[1].status='withdrawn';const replay=await wf.run(f.request);assert.equal(replay.status,'unavailable');assert.equal(replay.failure,'source_invalid');assert.equal(replay.proposal,undefined)
})
test('G3 malformed final schema or missing path cannot become approved/persisted',async()=>{
 const f=runFixture(),adapter=simulatedDecision({synthesize:async c=>({result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'incomplete',issues:[],proposal:proposal(c.request,[c.request.directions[0]])},costCny:0.01,providerCalls:1})})
 const receipt=await createDirectionWorkflow(f.reader,adapter).run(f.request);assert.equal(receipt.failure,'invalid_contract');assert.equal(receipt.status,'unavailable')
})
