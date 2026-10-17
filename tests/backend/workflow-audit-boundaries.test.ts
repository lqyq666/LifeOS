import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {fixture,simulatedDecision,proposal} from '../workflows/fixtures.ts'
import {reviewAction,reconcileActionStages,type ActionCase} from '../../server/workflows/action-review.ts'
import {createDirectionWorkflow} from '../../server/workflows/direction-decision.ts'
import {createOrchestrator} from '../../server/workflows/orchestrator.ts'
import {emptyProposal,type WorkflowReceipt} from '../../server/workflows/contracts.ts'
process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
test('WF02 explicit unknown clears established use, while questions, hypotheses and third-party reports cannot change it',()=>{
 const known={sent:true,read:true,replied:true,used:true,effect:'原效果'},reported:string[]=[]
 const next=reconcileActionStages(known,'按上次，我现在不知道对方是否采用。',field=>reported.push(field))
 assert.equal(next.used,null);assert.equal(next.effect,null);assert.equal(next.sent,true);assert.deepEqual(reported,['used'])
 for(const quote of ['如果我没有采用怎么办？','同学说他没有采用。','我想问：对方没有采用吗？','我引用他说的“没有采用”。'])assert.deepEqual(reconcileActionStages(known,quote),known,quote)
})
test('WF02 confirmed read-to wording advances only the read stage',()=>{
 const before={sent:null,read:null,replied:null,used:null,effect:null}
 assert.deepEqual(reconcileActionStages(before,'回来反馈：我发了PDF；导师确认已经读到；但还没有说是否采用其中建议；也没有给效果反馈'),{sent:true,read:true,replied:null,used:null,effect:null})
})
test('WF02 exact saved correction clears false reply/use and their dependent effect, preserving independent sent/read',()=>{
 const f=fixture();f.request.mode='action_review';f.request.consent.continueReview=true
 const current={type:'message' as const,id:randomUUID(),revision:1,quote:'更正一下，我之前说错了：对方没有回复，也没有使用我发的材料。'}
 f.request.authorizedEvidenceRefs.push(current)
 const old:ActionCase={eventId:f.request.eventId!,revision:1,object:'学长',request:'请教请求',known:{sent:true,read:true,replied:true,used:true,effect:'之前误报有效'},usage:[],answeredQuestions:[]}
 const actual=reviewAction(f.request,old,current)
 assert.equal(actual.stages.replied,false);assert.equal(actual.stages.used,false);assert.equal(actual.stages.effect,null)
 assert.equal(actual.stages.sent,true);assert.equal(actual.stages.read,true);assert.equal(actual.feedback,'waiting_result')
})
test('WF03 ordinary unknown is retained and allows the final synthesis without a sixth call',async()=>{
 const f=fixture(),base=simulatedDecision();let syntheses=0
 const actual=await createDirectionWorkflow(async()=>f.records,simulatedDecision({
  critic:async c=>({result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'没有证据冲突',issues:['仍不知道是否喜欢科研，可以保留未知并做小探索']},providerCalls:1,costCny:0.01}),
  synthesize:async(c,a,r,s)=>{syntheses++;return base.synthesize(c,a,r,s)}
 })).run(f.request)
 assert.equal(actual.status,'proposed');assert.equal(syntheses,1);assert.equal(actual.providerCalls,5)
 assert.ok(JSON.stringify(actual).includes('仍不知道是否喜欢科研'))
})
test('WF05 lawful IDs cannot authorize newly fabricated final personal facts in any visible field',async()=>{
 for(const invented of ['用户已有十个付费客户，月收入稳定过万元','客户没说不好，因此明确认可本人','团队成绩都是本人独立完成的','愿意尝试说明用户已经选择并执行了','有案例所以保证用户成功']){
  const f=fixture(),actual=await createDirectionWorkflow(async()=>f.records,simulatedDecision({synthesize:async c=>{
   const p=proposal(c.request);p.alternatives[0].pros=[invented]
   return {result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'新增无来源断言',issues:[],proposal:p},providerCalls:1,costCny:0.01}
  }})).run(f.request)
  assert.equal(actual.status,'unavailable',invented);assert.equal(actual.proposal,undefined,invented);assert.ok(actual.providerCalls<=5)
 }
})
test('WF04 completed requests beyond process cache capacity remain replayable without dispatching again',async()=>{
 const f=fixture(),runner=createOrchestrator({readEvidence:async()=>f.records,maxEntries:2});let dispatches=0
 const build=async(r:typeof f.request):Promise<WorkflowReceipt>=>({schemaVersion:2,traceId:r.traceId,status:'proposed',proposal:emptyProposal(r),providerCalls:0,costCny:0,reservedCostCny:0,executionKind:'local_deterministic',fallback:'none',skills:[]})
 const node={id:'local',role:'case_resolver' as const,dependencies:[],executionKind:'local_deterministic' as const,maxCostCny:0,invoke:async()=>{dispatches++;return {result:{evidenceRefs:f.request.authorizedEvidenceRefs,summary:'模拟已完成',issues:[]},costCny:0,providerCalls:0}}}
 const requests=Array.from({length:3},()=>({...f.request,requestId:randomUUID(),traceId:randomUUID()}))
 for(const r of requests)assert.equal((await runner.run(r,[node],build)).status,'proposed')
 assert.equal((await runner.run(requests[0],[node],build)).status,'proposed');assert.equal(dispatches,3)
})
