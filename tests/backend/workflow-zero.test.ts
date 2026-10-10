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
const {createRuntimeDecisionAdapter}=await import('../../server/workflows/provider-adapter'+(process.env.LIFEOS_ZERO_BASELINE==='true'?'-zero-baseline':'')+'.ts')
import {createDirectionWorkflow} from '../../server/workflows/direction-decision.ts'
process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
test.after(()=>pool.end())
test('zero and tiny budgets produce legal empty or bounded actions through actual native SDK, not fabricated minutes',async()=>{
 const f=fixture();f.request.directions=f.request.directions.slice(0,2);f.request.modelBudget.maxCostCny=5
 const oldURL=model.baseUrl,oldKey=config.apiKey,directory='.planning/research/workflow-integration/evidence/local-time-20261010';mkdirSync(directory,{recursive:true})
 const budget=new CoachProviderBudget({simulation:true,testDirectory:'simulation-workflow-personalization-'+randomUUID()});budget.snapshot()
 writeFileSync(dirname(budget.path)+'/development-test-grant-20261005.json',JSON.stringify({kind:'SIMULATED_DEVELOPMENT_TEST_GRANT',amountCny:30,startingCall:0,priorReceiptsSha256:createHash('sha256').update('[]').digest('hex')}));budget.activateCurrentGrant()
 const freezePath=dirname(budget.path)+'/freeze.json'
 const wire:any[]=[],cases:any[]=[];let variant='portfolio',fabricate=false
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  const request=JSON.parse(Buffer.concat(chunks).toString()),ctx=JSON.parse(request.messages[1].content);wire.push({variant,context:ctx})
  const preferred=ctx.path?.id==='employment'?'employment:'+variant:'postgraduate_exam:'+(variant==='portfolio'?'preview':'motivation')
  const output=ctx.path?{evidenceIds:['e0'],tradeoffIds:variant==='portfolio'?['path','transfer']:['path','cost'],unknownIds:['fit'],actionIds:fabricate?['I_HAVE_TEN_PAYING_CLIENTS']:ctx.actions.length?[ctx.actions[0].id]:[]}:ctx.analyses?{issues:[{severity:'uncertainty',issueId:'fit',evidenceIds:['e0']}],rejectedDirections:[]}:{directionOrder:ctx.alternatives.map((x:any)=>x.directionId),actionIds:ctx.actions.length?['a0']:[]}
  // The old contract has no transfer handle; keep this baseline comparison valid.
  if(ctx.path&&!ctx.tradeoffs.transfer&&!fabricate)output.tradeoffIds=['path','cost']
  res.writeHead(200,{'Content-Type':'text/event-stream'});const base={id:'synthetic-personalization-'+wire.length,object:'chat.completion.chunk',created:1,model:model.id}
  res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:300,completion_tokens:100,total_tokens:400}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(done=>fake.listen(0,'127.0.0.1',done));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-personalization-key'
 writeFileSync(freezePath,JSON.stringify(captureCoachSource()))
 try{
  const adapter=createRuntimeDecisionAdapter({readEvidence:async()=>f.records,freezePath,budget,syntheticTransport:true,runtime:{...resolveModel('default'),pricing:{inputCnyPerMillion:1,outputCnyPerMillion:2}}})
  const wf=createDirectionWorkflow(async()=>f.records,adapter)
  for(const minutes of [0,1,4,120]){
   variant=String(minutes);f.request.requestId=randomUUID();f.request.traceId=randomUUID();f.records[0].text='这周'+minutes+'分钟，深入比较就业和考研。';f.request.currentIntent=f.records[0].text
   f.request.budget!.amountMinutes=minutes;f.records[1].budget!.amountMinutes=minutes
   const start=wire.length,receipt=await wf.run(f.request)
   cases.push({minutes,receipt,catalogues:wire.slice(start).filter(x=>x.context.path).map(x=>x.context.actions)})
   writeFileSync(directory+(process.env.LIFEOS_ZERO_BASELINE==='true'?'/ZERO_RED.json':'/ZERO_GREEN.json'),JSON.stringify({evidence:'NATIVE_SDK_LOOPBACK_SCRIPTED_SELECTION',realProviderCalls:0,cases},null,2))
   assert.equal(receipt.status,'proposed',JSON.stringify(receipt));assert.equal(receipt.providerCalls,4)
   if(minutes===0)assert.deepEqual(receipt.proposal!.nextActions,[])
   for(const catalogue of cases.at(-1).catalogues)assert.ok(catalogue.every((a:any)=>a.estimatedMinutes>=1&&a.estimatedMinutes<=minutes))
   assert.ok(receipt.proposal!.nextActions.reduce((n,a)=>n+(a.estimatedMinutes??0),0)<=minutes)
  }
  fabricate=true;f.request.requestId=randomUUID();f.request.traceId=randomUUID();const bad=await wf.run(f.request);assert.equal(bad.status,'unavailable');assert.equal(bad.failure,'source_invalid');assert.equal(bad.proposal,undefined)
 }finally{model.baseUrl=oldURL;config.apiKey=oldKey;fake.closeAllConnections();await new Promise<void>(done=>fake.close(()=>done()))}
})
