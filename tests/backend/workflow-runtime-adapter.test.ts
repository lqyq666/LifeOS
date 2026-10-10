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
import {CoachProviderBudget,type CoachCallReceipt} from '../../scripts/coach-provider-budget.ts'
import {captureCoachSource} from '../../scripts/coach-source-freeze.ts'
import {createRuntimeDecisionAdapter,type ProviderNodeAudit} from '../../server/workflows/provider-adapter.ts'
import {createDirectionWorkflow} from '../../server/workflows/direction-decision.ts'
process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
test.after(()=>pool.end())
test('WF01 actual native runtime adapter + SDK + existing ledger class, loopback synthetic wire: whole graph reserved, roles independent, usage recorded and replay free',async()=>{
 const f=fixture();f.request.directions=f.request.directions.slice(0,2);f.request.modelBudget.maxCostCny=5
 const previousURL=model.baseUrl,previousKey=config.apiKey,budget=new CoachProviderBudget({simulation:true,testDirectory:'simulation-workflow-'+randomUUID()})
 budget.snapshot();writeFileSync(dirname(budget.path)+'/development-test-grant-20261005.json',JSON.stringify({kind:'SIMULATED_DEVELOPMENT_TEST_GRANT',amountCny:30,startingCall:0,priorReceiptsSha256:createHash('sha256').update('[]').digest('hex')}));budget.activateCurrentGrant()
 const requests:{role:string;context:Record<string,unknown>}[]=[],audits:ProviderNodeAudit[]=[]
 let incompleteUsage=false
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  const request=JSON.parse(Buffer.concat(chunks).toString()),ctx=JSON.parse(request.messages[1].content),role=request.messages[0].content
  requests.push({role,context:ctx});assert.equal(budget.snapshot().calls.length,incompleteUsage?8:4,'all calls reserved before the first wire')
  const output=ctx.path?{evidenceIds:['e0'],tradeoffIds:['parallel'],unknownIds:['fit'],actionIds:[ctx.actions[0].id]}:ctx.analyses?{issues:[{severity:'uncertainty',issueId:'fit',evidenceIds:['e0']}],rejectedDirections:[]}:{directionOrder:ctx.alternatives.map((x:{directionId:string})=>x.directionId),actionIds:['a0']}
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  const base={id:'synthetic-sdk-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id}
  res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:incompleteUsage?{prompt_tokens:300,total_tokens:300}:{prompt_tokens:300,completion_tokens:100,total_tokens:400}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-workflow-runtime-only-key'
 try{
  const directory='.local/'+randomUUID();mkdirSync(directory);const freezePath=directory+'/freeze.json';writeFileSync(freezePath,JSON.stringify(captureCoachSource()))
  const adapter=createRuntimeDecisionAdapter({readEvidence:async()=>f.records,freezePath,budget,syntheticTransport:true,runtime:{...resolveModel('default'),pricing:{inputCnyPerMillion:1,outputCnyPerMillion:2}},audit:async(_,row)=>{audits.push(row)}})
  const wf=createDirectionWorkflow(async()=>f.records,adapter),receipt=await wf.run(f.request)
  assert.equal(receipt.status,'proposed',JSON.stringify({receipt,trace:wf.trace.rows,audits,wire:requests.length}));assert.equal(receipt.providerCalls,4);assert.equal(requests.length,4);assert.equal(audits.length,4)
  assert.equal(receipt.executionKind,'simulated_provider');assert.ok(receipt.reviewIssues?.some(x=>x.severity==='uncertainty'))
  assert.equal(new Set(requests.map(x=>x.role)).size,3);assert.ok(requests.every(x=>JSON.stringify(x.context).includes(f.records[0].text)))
  const ledger=budget.snapshot();assert.equal(ledger.calls.length,4);assert.ok(ledger.calls.every((c:{status:string;estimatedCostCny:number})=>c.status==='finished'&&c.estimatedCostCny>0))
  assert.ok(audits.every(x=>x.providerResponseId?.startsWith('synthetic-sdk-')&&x.costCny!==null))
  assert.equal((await wf.run(f.request)).status,'proposed');assert.equal(requests.length,4);assert.equal(budget.snapshot().calls.length,4)
  const before=budget.snapshot().calls.length
  assert.throws(()=>budget.reserveGraph([1,2].map(i=>({runId:'synthetic-overflow',purpose:'diagnostic',tier:'default',provider:'synthetic',model:'synthetic',signature:'synthetic',sourceDigest:'synthetic',logicalCallId:'overflow-'+i,reservedCostCny:20}))),/BUDGET/)
  assert.equal(budget.snapshot().calls.length,before,'failed graph reservation is atomic')
  incompleteUsage=true;f.request.requestId=randomUUID();f.request.traceId=randomUUID()
  const partial=await wf.run(f.request);assert.equal(partial.status,'unavailable');assert.equal(partial.costCny,null)
  // The first incomplete analyst may cancel its sibling before the second wire
  // is sent. Both interleavings must retain reservations and forbid later waves.
  const partialWire=requests.slice(4);assert.ok(partialWire.length>=1&&partialWire.length<=2,'one attempt per analyst, no charged retry');assert.ok(partialWire.every(row=>row.context.path),'partial usage stops before critic/synthesis')
  const partialCalls=(budget.snapshot().calls as CoachCallReceipt[]).filter(c=>c.runId===f.request.requestId);assert.equal(partialCalls.length,4);assert.ok(partialCalls.some(c=>c.estimatedCostCny==='unknown'&&(c.reservedCostCny??0)>0));assert.ok(partialCalls.filter(c=>c.outcome==='not_sent').every(c=>c.estimatedCostCny===0));assert.ok(partialCalls.filter(c=>c.outcome==='not_sent').length>=2,'critic and synthesis never sent')
 }finally{model.baseUrl=previousURL;config.apiKey=previousKey;await new Promise<void>(resolve=>fake.close(()=>resolve()))}
})
