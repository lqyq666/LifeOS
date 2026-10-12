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
import {createProductionWorkflowBudget,type WorkflowProviderBudget} from '../../server/workflows/production-budget.ts'
import {setProviderBudget,providerBudgetView} from '../../server/provider-spend.ts'
import {postgresJournal} from '../../server/workflows/task-journal.ts'
import * as store from '../../server/store.ts'
process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
test.after(()=>pool.end())
test('WF01 actual native runtime adapter + SDK + existing ledger class, loopback synthetic wire: whole graph reserved, roles independent, usage recorded and replay free',async()=>{
 const f=fixture();f.request.directions=f.request.directions.slice(0,2);f.request.modelBudget.maxCostCny=5
 const previousURL=model.baseUrl,previousKey=config.apiKey,budget=new CoachProviderBudget({simulation:true,testDirectory:'simulation-workflow-'+randomUUID()})
 budget.snapshot();writeFileSync(dirname(budget.path)+'/development-test-grant-20261005.json',JSON.stringify({kind:'SIMULATED_DEVELOPMENT_TEST_GRANT',amountCny:30,startingCall:0,priorReceiptsSha256:createHash('sha256').update('[]').digest('hex')}));budget.activateCurrentGrant()
 let wireBudget:WorkflowProviderBudget=budget
 const requests:{role:string;context:Record<string,unknown>}[]=[],audits:ProviderNodeAudit[]=[]
 let incompleteUsage=false,duplicateSelection=false,expectedReservations=4,criticVariant='normal',singleMalformed=false
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  const request=JSON.parse(Buffer.concat(chunks).toString()),ctx=JSON.parse(request.messages[1].content),role=request.messages[0].content
  requests.push({role,context:ctx});assert.equal(wireBudget.snapshot().calls.length,expectedReservations,'all calls reserved before the first wire')
  assert.equal(JSON.stringify(request.response_format).includes('uniqueItems'),false,'actual SDK request uses supported provider schema')
  const selection=request.response_format?.json_schema?.schema
  if(ctx.path){assert.deepEqual(selection.properties.evidenceIds.items.enum,ctx.facts.map((x:any)=>x.id));assert.deepEqual(selection.properties.actionIds.items.enum,ctx.actions.map((x:any)=>x.id))}
  if(ctx.analyses){assert.deepEqual(selection.properties.rejectedDirections.items.enum,ctx.directions.map((x:any)=>x.id));assert.ok(selection.properties.issues.items.anyOf.every((branch:any)=>JSON.stringify(branch.properties.claimIds).includes(ctx.claims[0].id)));assert.ok(!selection.properties.issues.items.anyOf[1].properties.severity.enum.includes('blocker'))}
  const output:any=ctx.path?{evidenceIds:['e0'],tradeoffIds:['parallel'],unknownIds:['fit'],actionIds:[ctx.actions[0].id]}:ctx.analyses?{issues:[{severity:'uncertainty',issueId:'fit',evidenceIds:['e0']}],rejectedDirections:[]}:{directionOrder:ctx.alternatives.map((x:{directionId:string})=>x.directionId),actionIds:['a0']}
  if(ctx.paths){
   delete output.directionOrder;delete output.actionIds
   assert.equal(selection.properties.actionIds,undefined,'single selection has no conflicting global action chooser')
   output.selections=Object.fromEntries(ctx.paths.map((path:any)=>{
    assert.deepEqual(path.facts,ctx.paths[0].facts,'same authorized facts across directions')
    assert.deepEqual(selection.properties.selections.properties[path.path.id].properties.evidenceIds.items.enum,path.facts.map((x:any)=>x.id))
    assert.equal(selection.properties.selections.properties[path.path.id].properties.evidenceIds.minItems,1)
    return [path.path.id,{evidenceIds:['e0'],tradeoffIds:['parallel'],unknownIds:['fit'],actionIds:[path.actions[0].id],evidenceRelations:[{evidenceId:'e0',relation:'unknown'}],actionBasis:[{actionId:path.actions[0].id,evidenceIds:['e0'],unknownIds:['fit'],stageReasonId:'explore'}]}]
   }))
   output.directionOrder=ctx.paths.map((path:any)=>path.path.id)
   if(singleMalformed){const first=output.selections[ctx.paths[0].path.id];first.actionIds=['invented:action'];first.actionBasis[0].actionId='invented:action'}
  }
  if(ctx.path){const result=output as any;result.evidenceRelations??=result.evidenceIds.map((id:string)=>({evidenceId:id,relation:'unknown'}));result.actionBasis??=result.actionIds.map((id:string)=>({actionId:id,evidenceIds:result.evidenceIds,unknownIds:result.unknownIds,stageReasonId:'explore'}))}
  if(duplicateSelection&&ctx.path)output.evidenceIds=['e0','e0']
  if(ctx.analyses&&criticVariant==='unknown_blocker')output.issues=[{severity:'blocker',issueId:'unknown',evidenceIds:['e0']}]
  if(ctx.analyses&&criticVariant==='unsupported_blocker')output.issues=[{severity:'blocker',issueId:'unsupported',evidenceIds:['e0'],claimIds:[ctx.claims?.[0]?.id??'p0:pros:0']}]
  if(ctx.analyses&&criticVariant==='unexplained_rejection')output.rejectedDirections=[ctx.directions[0].id]
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
  incompleteUsage=true;expectedReservations=8;f.request.requestId=randomUUID();f.request.traceId=randomUUID()
  const partial=await wf.run(f.request);assert.equal(partial.status,'unavailable');assert.equal(partial.costCny,null)
  // The first incomplete analyst may cancel its sibling before the second wire
  // is sent. Both interleavings must retain reservations and forbid later waves.
  const partialWire=requests.slice(4);assert.ok(partialWire.length>=1&&partialWire.length<=2,'one attempt per analyst, no charged retry');assert.ok(partialWire.every(row=>row.context.path),'partial usage stops before critic/synthesis')
  const partialCalls=(budget.snapshot().calls as CoachCallReceipt[]).filter(c=>c.runId===f.request.requestId);assert.equal(partialCalls.length,4);assert.ok(partialCalls.some(c=>c.estimatedCostCny==='unknown'&&(c.reservedCostCny??0)>0));assert.ok(partialCalls.filter(c=>c.outcome==='not_sent').every(c=>c.estimatedCostCny===0));assert.ok(partialCalls.filter(c=>c.outcome==='not_sent').length>=2,'critic and synthesis never sent')
  incompleteUsage=false;duplicateSelection=true;expectedReservations=12;f.request.requestId=randomUUID();f.request.traceId=randomUUID();const duplicateWireStart=requests.length
  const duplicate=await wf.run(f.request);assert.equal(duplicate.status,'unavailable');assert.equal(duplicate.failure,'invalid_contract')
  assert.equal(typeof wf.trace.rows.filter(row=>row.error==='invalid_contract').at(-1)?.costCny,'number','invalid response preserves its known paid usage; a cancelled sibling may still keep the whole graph cost unknown')
  assert.ok(requests.slice(duplicateWireStart).every(row=>row.context.path),'invalid duplicate selections never reach critic/synthesis or retry')
  assert.ok(audits.some(row=>row.failureCode==='WORKFLOW_invalid_contract'))
  duplicateSelection=false
  for(const variant of ['unknown_blocker','unsupported_blocker','unexplained_rejection']){
   criticVariant=variant;expectedReservations+=4;f.request.requestId=randomUUID();f.request.traceId=randomUUID()
   const begin:number=requests.length,reviewed=await wf.run(f.request)
   assert.equal(reviewed.status,'unavailable');assert.equal(reviewed.failure,variant==='unsupported_blocker'?'constraint_conflict':'invalid_contract',variant)
   assert.equal(requests.length-begin,3,'bad review never runs synthesis or paid repair')
   assert.equal(typeof reviewed.costCny,'number','known failure fees retained')
  }
  criticVariant='normal';expectedReservations+=1;f.request.requestId=randomUUID();f.request.traceId=randomUUID()
  // Separate arms persist identical student words in different message rows.
  // Those storage IDs must not make equal comparison inputs appear unequal.
  const oldBudgetSourceId=f.request.budget!.source.id,newBudgetSourceId=randomUUID()
  for(const ref of f.request.authorizedEvidenceRefs)if(ref.id===oldBudgetSourceId)ref.id=newBudgetSourceId
  for(const record of f.records)if(record.ref.id===oldBudgetSourceId)record.ref.id=newBudgetSourceId
  f.request.budget!.source={...f.request.budget!.source,id:newBudgetSourceId}
  const singleStart=requests.length,single=await wf.run(f.request,undefined,'single')
  assert.equal(single.status,'proposed',JSON.stringify(single));assert.equal(single.providerCalls,1);assert.equal(requests.length-singleStart,1)
  assert.equal(single.proposal!.alternatives.length,2);assert.equal(single.proposal!.nextActions.length,2);assert.deepEqual(single.reviewIssues,[],'single arm does not claim a critic execution')
  const normalizedFacts=(rows:any[])=>rows.map(({ref,...fact})=>({...fact,sourceType:ref.type,sourceRevision:ref.revision,sourceQuote:ref.quote}))
  assert.deepEqual(normalizedFacts((requests.at(-1)!.context.paths as any[])[0].facts),normalizedFacts(requests[0].context.facts as any[]),'single and multi use the same facts and provenance, apart from storage IDs')
  assert.equal(audits.at(-1)!.decisionInputDigest,audits[0].decisionInputDigest,'same comparison input digest across arms')
  assert.equal((await wf.run(f.request,undefined,'single')).status,'proposed');assert.equal(requests.length-singleStart,1,'no paid replay')
  singleMalformed=true;expectedReservations+=1;f.request.requestId=randomUUID();f.request.traceId=randomUUID()
  const malformed=await wf.run(f.request,undefined,'single');assert.equal(malformed.status,'unavailable');assert.equal(typeof malformed.costCny,'number','bad single output preserves its fee')
  singleMalformed=false;f.request.directions.push({id:'entrepreneurship',title:'创业'});expectedReservations+=1;f.request.requestId=randomUUID();f.request.traceId=randomUUID()
  const three=await wf.run(f.request,undefined,'single');assert.equal(three.status,'proposed',JSON.stringify(three));assert.equal(three.providerCalls,1);assert.equal(three.proposal!.alternatives.length,3)
  const oldBudgetEnabled=config.providerBudgetEnabled,oldBudgetId=config.providerBudgetId
  config.providerBudgetEnabled=true;config.providerBudgetId='native-pg-budget-'+randomUUID()
  try{
   await setProviderBudget(config.providerBudgetId,5)
   const user=f.request.internalActorKey;await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
   f.request.internalActorKey=user;f.request.requestId=randomUUID();f.request.traceId=randomUUID();f.request.conversationId=randomUUID()
   await store.createConversation(user,{id:f.request.conversationId,title:'SYNTHETIC native PG bridge'})
   assert.match((await pool.query('SELECT current_database() AS name')).rows[0].name,/^lifeos_dialogue_test_/)
   const pgBudget=createProductionWorkflowBudget()
   // Mark only this verified disposable PG harness as simulated; the actual
   // production adapter's guard and authoritative budget methods stay intact.
   wireBudget={...pgBudget,path:'simulation:isolated-postgresql'};expectedReservations=5
   const pgFreeze=directory+'/production-budget-freeze.json';writeFileSync(pgFreeze,JSON.stringify(captureCoachSource()))
   const pgAdapter=createRuntimeDecisionAdapter({readEvidence:async()=>f.records,freezePath:pgFreeze,budget:wireBudget,syntheticTransport:true,runtime:{...resolveModel('default'),pricing:{inputCnyPerMillion:1,outputCnyPerMillion:2}}})
   const pgWorkflow=createDirectionWorkflow(async()=>f.records,pgAdapter,undefined,postgresJournal()),pgStart=requests.length,pgReceipt=await pgWorkflow.run(f.request)
   assert.equal(pgReceipt.status,'proposed',JSON.stringify(pgReceipt));assert.equal(pgReceipt.providerCalls,5);assert.equal(requests.length-pgStart,5)
   const rows=(await pool.query('SELECT call_index,status,settled_cny,workflow_request_id FROM lifeos_provider_spend WHERE user_id=$1 ORDER BY call_index',[user])).rows
   assert.deepEqual(rows.map(x=>x.call_index),[1,2,3,4,5]);assert.ok(rows.every(x=>x.status==='known'&&Number(x.settled_cny)>0&&x.workflow_request_id===f.request.requestId))
   assert.equal((await providerBudgetView()).unknown_or_active_calls,0)
   assert.equal((await pgWorkflow.run(f.request)).status,'proposed');assert.equal(requests.length-pgStart,5,'durable PG replay sends no extra SDK requests')
   assert.equal(createProductionWorkflowBudget().snapshot().calls.length,0,'fresh process mirrors do not manufacture receipts or erase authoritative PG rows')
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM lifeos_provider_spend WHERE user_id=$1',[user])).rows[0].n,5)
  }finally{config.providerBudgetEnabled=oldBudgetEnabled;config.providerBudgetId=oldBudgetId}
 }finally{model.baseUrl=previousURL;config.apiKey=previousKey;await new Promise<void>(resolve=>fake.close(()=>resolve()))}
})
