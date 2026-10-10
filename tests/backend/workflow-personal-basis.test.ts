import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID,createHash} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {dirname} from 'node:path'
import {fixture} from '../workflows/fixtures.ts'
import {model,resolveModel} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import {CoachProviderBudget} from '../../scripts/coach-provider-budget.ts'
import {captureCoachSource} from '../../scripts/coach-source-freeze.ts'
import {createRuntimeDecisionAdapter} from '../../server/workflows/provider-adapter.ts'
import {createDirectionWorkflow} from '../../server/workflows/direction-decision.ts'
process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
test.after(()=>pool.end())
test('A/B/C personal basis binds the reviewed action to the actual missing evidence, at the same time budget; malicious links fail closed',async()=>{
 const f=fixture();f.request.directions=[{id:'employment',title:'就业'},{id:'freelance',title:'自由职业'}];f.request.modelBudget.maxCostCny=5
 const old={url:model.baseUrl,key:config.apiKey};const wire:any[]=[],cases:any[]=[];let variant='A',malicious=false,publicBasis=false,noStage=false,invalidStage=false
 const publicRef={type:'knowledge' as const,id:randomUUID(),revision:1};f.request.authorizedEvidenceRefs.push(publicRef);f.records.push({ref:publicRef,owner:null,conversationId:null,status:'active',role:'public',approved:true,text:'公开方法：对照目标要求，不能当作本人已经完成的经历。'})
 const budget=new CoachProviderBudget({simulation:true,testDirectory:'simulation-personal-basis-'+randomUUID()});budget.snapshot()
 writeFileSync(dirname(budget.path)+'/development-test-grant-20261005.json',JSON.stringify({kind:'SIMULATED_DEVELOPMENT_TEST_GRANT',amountCny:30,startingCall:0,priorReceiptsSha256:createHash('sha256').update('[]').digest('hex')}));budget.activateCurrentGrant()
 const fake=createServer((req,res)=>{const parts:Buffer[]=[];req.on('data',x=>parts.push(Buffer.from(x)));req.on('end',()=>{
  const p=JSON.parse(Buffer.concat(parts).toString()),ctx=JSON.parse(p.messages[1].content);wire.push({variant,context:ctx})
  let out:any
  if(ctx.path){
   const action=ctx.path.id==='employment'?'employment:portfolio':variant==='B'?'freelance:delivery':'freelance:pause'
   const gap=variant==='A'?'role_evidence':variant==='B'?'adoption':'repeatability'
   out={evidenceIds:publicBasis?['e1','e2']:['e1'],evidenceRelations:[{evidenceId:'e1',relation:variant==='C'&&ctx.path.id==='freelance'?'limit':variant==='B'?'unknown':'support'}],tradeoffIds:variant==='C'?['pause','priority']:['transfer','path'],unknownIds:[gap],actionIds:[action],actionBasis:[{actionId:action,evidenceIds:[malicious?'OTHER_PERSON':publicBasis?'e2':'e1'],unknownIds:[gap],...(!noStage?{stageReasonId:invalidStage?'guaranteed_long_term_fit':variant==='A'?'reuse_evidence':variant==='B'?'verify_result':'respect_priority'}:{})}]}
  }else if(ctx.analyses)out={issues:[{severity:'uncertainty',issueId:'fit',evidenceIds:['e1']}],rejectedDirections:[]}
  else out={directionOrder:variant==='B'?['freelance','employment']:['employment','freelance'],actionIds:[ctx.actions.find((x:any)=>x.action.directionId===(variant==='B'?'freelance':'employment')).id]}
  const base={id:'SCRIPTED_BASIS_'+wire.length,object:'chat.completion.chunk',created:1,model:model.id}
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(out)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:300,completion_tokens:100,total_tokens:400}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));model.baseUrl='http://127.0.0.1:'+(fake.address() as any).port;config.apiKey='synthetic-loopback-only'
 const freezePath=dirname(budget.path)+'/freeze.json';writeFileSync(freezePath,JSON.stringify(captureCoachSource()))
 try{
  const wf=createDirectionWorkflow(async()=>f.records,createRuntimeDecisionAdapter({readEvidence:async()=>f.records,freezePath,budget,syntheticTransport:true,runtime:{...resolveModel('default'),pricing:{inputCnyPerMillion:1,outputCnyPerMillion:2}}}))
  for(const spec of [
   {id:'A',text:'我有三个作品，收到多次客户反馈，本周可用两小时，想深入比较就业还是自由职业。'},
   {id:'B',text:'我只有一次海报交付，对方是否采用我不知道，本周可用两小时，想深入比较就业还是自由职业。'},
   {id:'C',text:'我已有海报作品，本阶段就业优先，暂停扩大接单，本周可用两小时，想深入比较就业还是自由职业。'}
  ]){
   variant=spec.id;f.request.requestId=randomUUID();f.request.traceId=randomUUID();f.request.currentIntent=spec.text;f.records[1].text=spec.text;f.records[1].ref.quote=spec.text
   f.request.budget!.amountMinutes=120;f.records[1].budget!.amountMinutes=120
   const before=wire.length,receipt=await wf.run(f.request);assert.equal(receipt.status,'proposed',JSON.stringify(receipt));assert.equal(receipt.providerCalls,4)
   assert.equal(receipt.proposal!.suggestedStateChanges.length,0)
   const action=receipt.proposal!.nextActions[0];assert.deepEqual(action.evidenceRefs,[f.records[1].ref]);assert.match(action.stopCondition,/个人依据/);assert.ok(action.stopCondition.includes(spec.text));assert.match(action.stopCondition,/仍需核对/)
   assert.match(action.stopCondition,/阶段适用性/)
   assert.match(action.stopCondition,variant==='B'?/\[未知\]/:/\[支持\]/)
   if(variant==='A')assert.match(action.stopCondition,/复用/)
   if(variant==='B'){assert.match(action.description,/交付、采用与付款/);assert.match(action.stopCondition,/采用/)}
   if(variant==='C'){assert.equal(action.directionId,'employment');assert.match(action.stopCondition,/当前重点/);assert.match(receipt.proposal!.alternatives.find(x=>x.directionId==='freelance')!.tradeoffs.join('；'),/暂停扩大接单/);const analysis=wire.slice(before).find(x=>x.context.path?.id==='freelance')!;assert.ok(analysis.context.stageReasons);const reviewedAction=wire.slice(before).find(x=>x.context.analyses)!.context.analyses.flatMap((x:any)=>x.proposal.nextActions).find((x:any)=>x.directionId==='freelance');assert.match(reviewedAction.stopCondition,/\[限制\]/);}
   cases.push({variant,original:spec.text,budget:120,receipt,wire:wire.slice(before)})
  }
  assert.notDeepEqual(cases[0].receipt.proposal.alternatives,cases[1].receipt.proposal.alternatives)
  assert.notEqual(cases[0].receipt.proposal.nextActions[0].stopCondition,cases[2].receipt.proposal.nextActions[0].stopCondition)
  malicious=true;f.request.requestId=randomUUID();f.request.traceId=randomUUID();const bad=await wf.run(f.request);assert.equal(bad.status,'unavailable');assert.equal(bad.failure,'source_invalid');assert.equal(bad.proposal,undefined)
  malicious=false;publicBasis=true;f.request.requestId=randomUUID();f.request.traceId=randomUUID();const borrowed=await wf.run(f.request);assert.equal(borrowed.status,'unavailable');assert.equal(borrowed.failure,'source_invalid');assert.equal(borrowed.proposal,undefined,'public methods are not personal evidence')
  publicBasis=false;invalidStage=true;f.request.requestId=randomUUID();f.request.traceId=randomUUID();const fabricatedStage=await wf.run(f.request);assert.equal(fabricatedStage.failure,'source_invalid');assert.equal(fabricatedStage.proposal,undefined)
  invalidStage=false;noStage=true;f.request.requestId=randomUUID();f.request.traceId=randomUUID();const missingStage=await wf.run(f.request);assert.equal(missingStage.status,'proposed');assert.match(missingStage.proposal!.nextActions[0].stopCondition,/阶段适用性尚未说明/)
  writeFileSync((process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/workflow-integration/evidence/acceptance-20261010')+'/PERSONAL_BASIS_ABC.json',JSON.stringify({evidence:'NATIVE_SDK_SCRIPTED_SELECTION_CONTRACT_ONLY_NOT_REAL_MODEL_GAIN',paidCalls:0,cloudCalls:0,cases,malicious:bad,borrowedPublic:borrowed,fabricatedStage,missingStage},null,2))
 }finally{model.baseUrl=old.url;config.apiKey=old.key;fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()))}
})
