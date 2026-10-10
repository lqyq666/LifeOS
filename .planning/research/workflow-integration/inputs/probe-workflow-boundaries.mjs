/**
 * Original-function diagnostics only. No DB/network/model calls, no source-file writes.
 * Run from the repository with its existing tsx dependency:
 *   node --import tsx <path-to-this-file> "D:\aaaLife\LifeOS"
 * All providers below are explicit simulated fixtures. WF01 only exercises the
 * currently blocked real_provider selector; remove that case if the gate is replaced
 * by a real network adapter in a future implementation.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] || process.cwd());
const load = rel => import(pathToFileURL(resolve(root, rel)).href);
const {fixture, simulatedDecision, proposal} = await load('tests/workflows/fixtures.ts');
const {createDirectionWorkflow} = await load('server/workflows/direction-decision.ts');
const {createOrchestrator} = await load('server/workflows/orchestrator.ts');
const {reviewAction} = await load('server/workflows/action-review.ts');
const {emptyProposal} = await load('server/workflows/contracts.ts');
process.env.LIFEOS_ADVANCED_WORKFLOWS = 'true';
const emit = item => console.log(JSON.stringify(item));

const f=fixture();
try {
  await createDirectionWorkflow(async()=>f.records,
    {...simulatedDecision(),executionKind:'real_provider'}).run(f.request);
  emit({id:'WF01',realAdapter:'guard_changed_or_success'});
} catch(e) {emit({id:'WF01',realAdapter:e.code??e.message});}

const r=fixture();r.request.mode='action_review';r.request.consent.continueReview=true;
const current={type:'message',id:randomUUID(),revision:1,
  quote:'更正一下，我之前说错了：对方没有回复，也没有使用我发的材料。'};
r.request.authorizedEvidenceRefs.push(current);
const reviewed=reviewAction(r.request,{eventId:r.request.eventId,revision:1,
  object:'学长',request:'请教请求',known:{sent:true,read:true,replied:true,used:true,effect:'之前误报有效'},
  usage:[],answeredQuestions:[]},current);
emit({id:'WF02',current:current.quote,feedback:reviewed.feedback,stages:reviewed.stages,reply:reviewed.reply});

const c=fixture();let synthesisCalls=0;
const critic=await createDirectionWorkflow(async()=>c.records,simulatedDecision({
  critic:async ctx=>({result:{evidenceRefs:ctx.request.authorizedEvidenceRefs,
    summary:'当前没有证据冲突，只有非阻断的不确定项',
    issues:['仍不知道是否喜欢科研，可以保留未知并做小探索']},providerCalls:1,costCny:0.01}),
  synthesize:async()=>{synthesisCalls++;throw new Error('not_expected');}
})).run(c.request);
emit({id:'WF03',status:critic.status,failure:critic.failure,synthesisCalls});

const k=fixture(),runner=createOrchestrator({readEvidence:async()=>k.records,maxEntries:2});
const build=req=>Promise.resolve({schemaVersion:2,traceId:req.traceId,status:'proposed',
  proposal:emptyProposal(req),providerCalls:0,costCny:0,reservedCostCny:0,
  executionKind:'local_deterministic',fallback:'none',skills:[]});
const outputs=[];
for(let i=0;i<3;i++){
  const req={...k.request,requestId:randomUUID(),traceId:randomUUID()};
  try {outputs.push((await runner.run(req,[],build)).status);}
  catch(e){outputs.push(e.code??e.message);}
}
emit({id:'WF04',capacity:2,completedRequests:outputs});

const t=fixture();
const sem=await createDirectionWorkflow(async()=>t.records,simulatedDecision({
  synthesize:async ctx=>{const p=proposal(ctx.request);
    p.alternatives[0].pros=['用户已有十个付费客户，月收入稳定过万元'];
    return {result:{evidenceRefs:ctx.request.authorizedEvidenceRefs,
      summary:'未经原始事实支持的结论',issues:[],proposal:p},providerCalls:1,costCny:0.01};}
})).run(t.request);
emit({id:'WF05',status:sem.status,unsupportedConclusion:sem.proposal?.alternatives[0]?.pros[0],
  sourceScope:'原夹具仅含大三和6小时时间预算'});
