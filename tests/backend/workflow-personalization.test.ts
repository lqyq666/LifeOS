import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID,createHash} from 'node:crypto'
import {writeFileSync,mkdirSync} from 'node:fs'
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
test('opposite personal evidence can select different reviewed actions and time estimates without authoring facts',async()=>{
 const f=fixture();f.request.directions=f.request.directions.slice(0,2);f.request.modelBudget.maxCostCny=5
 const oldURL=model.baseUrl,oldKey=config.apiKey,directory=process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/workflow-integration/evidence/continuation';mkdirSync(directory,{recursive:true})
 const budget=new CoachProviderBudget({simulation:true,testDirectory:'simulation-workflow-personalization-'+randomUUID()});budget.snapshot()
 writeFileSync(dirname(budget.path)+'/development-test-grant-20261005.json',JSON.stringify({kind:'SIMULATED_DEVELOPMENT_TEST_GRANT',amountCny:30,startingCall:0,priorReceiptsSha256:createHash('sha256').update('[]').digest('hex')}));budget.activateCurrentGrant()
 const freezePath=dirname(budget.path)+'/freeze.json'
 const wire:any[]=[],cases:any[]=[];let variant='portfolio',fabricate=false
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  const request=JSON.parse(Buffer.concat(chunks).toString()),ctx=JSON.parse(request.messages[1].content);wire.push({variant,context:ctx})
  const preferred=ctx.path?.id==='employment'?'employment:'+variant:'postgraduate_exam:'+(variant==='portfolio'?'preview':'motivation')
  const output:any=ctx.path?{evidenceIds:['e0'],tradeoffIds:variant==='portfolio'?['path','transfer']:['path','cost'],unknownIds:['fit'],actionIds:[fabricate?'I_HAVE_TEN_PAYING_CLIENTS':ctx.actions.find((x:any)=>x.id===preferred)?.id??ctx.actions[0]?.id]}:ctx.analyses?{issues:[{severity:'uncertainty',issueId:'fit',evidenceIds:['e0']}],rejectedDirections:[]}:{directionOrder:ctx.alternatives.map((x:any)=>x.directionId),actionIds:['a0']}
  // The old contract has no transfer handle; keep this baseline comparison valid.
  if(ctx.path)output.evidenceRelations=[{evidenceId:'e0',relation:variant==='portfolio'?'support':'limit'}]
  if(ctx.path&&!ctx.tradeoffs.transfer&&!fabricate)output.tradeoffIds=['path','cost']
  if(ctx.path){const result=output as any;result.evidenceRelations??=result.evidenceIds.map((id:string)=>({evidenceId:id,relation:'unknown'}));result.actionBasis??=result.actionIds.map((id:string)=>({actionId:id,evidenceIds:result.evidenceIds,unknownIds:result.unknownIds,stageReasonId:'explore'}))}
  res.writeHead(200,{'Content-Type':'text/event-stream'});const base={id:'synthetic-personalization-'+wire.length,object:'chat.completion.chunk',created:1,model:model.id}
  res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:300,completion_tokens:100,total_tokens:400}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(done=>fake.listen(0,'127.0.0.1',done));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-personalization-key'
 writeFileSync(freezePath,JSON.stringify(captureCoachSource()))
 try{
  const adapter=createRuntimeDecisionAdapter({readEvidence:async()=>f.records,freezePath,budget,syntheticTransport:true,runtime:{...resolveModel('default'),pricing:{inputCnyPerMillion:1,outputCnyPerMillion:2}}})
  const wf=createDirectionWorkflow(async()=>f.records,adapter)
  for(const c of [
   {variant:'portfolio',text:'我是成年大学生，已完成一个课程项目，有想申请的岗位，想先把作品证据与岗位要求对照。每周有6小时，深入比较就业和考研。'},
   {variant:'requirements',text:'我是成年大学生，不喜欢这项工作，还没有目标岗位和作品，也没有读研动机，期末课程优先。每周有2小时，深入比较就业和考研。'}
  ]){
   variant=c.variant;f.request.requestId=randomUUID();f.request.traceId=randomUUID();f.records[0].text=c.text;f.request.currentIntent=c.text
   f.request.budget!.amountMinutes=variant==='portfolio'?360:120;f.records[1].budget!.amountMinutes=f.request.budget!.amountMinutes
   const start=wire.length,receipt=await wf.run(f.request);assert.equal(receipt.status,'proposed',JSON.stringify(receipt));assert.equal(receipt.providerCalls,4)
   cases.push({variant,original:c.text,receipt,catalogues:wire.slice(start).filter(x=>x.context.path).map(x=>({direction:x.context.path.id,actions:x.context.actions,tradeoffs:x.context.tradeoffs})),replayCalls:0})
   const count=wire.length;assert.equal((await wf.run(f.request)).status,'proposed');assert.equal(wire.length,count)
  }
  const actions=cases.map(c=>c.receipt.proposal.nextActions[0]),varies=actions[0].description!==actions[1].description&&actions[0].estimatedMinutes!==actions[1].estimatedMinutes
  writeFileSync(directory+'/PERSONALIZATION_CONTRAST.json',JSON.stringify({status:varies?'PASS_LOCAL_CONTRACT':'FAIL_FIXED_ACTION_AND_DURATION',evidence:'ACTUAL_NATIVE_SDK_SCRIPTED_SELECTIONS_SYNTHETIC_PROVIDER_NOT_REAL_SEMANTIC_ACCEPTANCE',cases,realProviderCalls:0},null,2)+'\n')
  assert.ok(varies,'opposite evidence still limited to the same per-path action and uniform five minutes')
  assert.deepEqual(cases[1].receipt.proposal.alternatives[0].pros,[],'a valid negative quote is not automatically a pro')
  assert.ok(cases[1].receipt.proposal.alternatives[0].tradeoffs.some((text:string)=>text.includes('不喜欢这项工作')))
  assert.notDeepEqual(cases[0].receipt.proposal.alternatives[0].tradeoffs,cases[1].receipt.proposal.alternatives[0].tradeoffs)
  for(const c of cases){assert.equal(c.receipt.proposal.suggestedStateChanges.length,0);assert.ok(c.receipt.proposal.alternatives.every((p:any)=>p.weeklyMinutes===null));assert.ok(!JSON.stringify(c.receipt).includes('十名客户'))}
  fabricate=true;f.request.requestId=randomUUID();f.request.traceId=randomUUID();const bad=await wf.run(f.request);assert.equal(bad.status,'unavailable');assert.equal(bad.failure,'source_invalid');assert.equal(bad.proposal,undefined)
 }finally{model.baseUrl=oldURL;config.apiKey=oldKey;fake.closeAllConnections();await new Promise<void>(done=>fake.close(()=>done()))}
})
