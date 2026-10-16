import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {setProviderBudget,providerBudgetView,reserveProviderSpend,settleProviderSpend} from '../../server/provider-spend.ts'
import {createProductionWorkflowBudget} from '../../server/workflows/production-budget.ts'
import {postgresJournal} from '../../server/workflows/task-journal.ts'
import {fixture} from '../workflows/fixtures.ts'
import * as store from '../../server/store.ts'

test.after(()=>pool.end())
test('production multi-agent accounting shares the existing PG cap; unknown and not-dispatched differ',async()=>{
 const oldEnabled=config.providerBudgetEnabled,oldId=config.providerBudgetId
 config.providerBudgetEnabled=true;config.providerBudgetId='workflow-budget-'+randomUUID()
 const user='wf-budget-'+randomUUID();await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setProviderBudget(config.providerBudgetId,0.2)
  async function graphId(){const f=fixture();f.request.internalActorKey=user;await store.createConversation(user,{id:f.request.conversationId,title:'SYNTHETIC budget'});await postgresJournal().claim(f.request,'synthetic');return f.request.requestId}
  const budget=createProductionWorkflowBudget(),entry={runId:await graphId(),logicalCallId:'first',purpose:'diagnostic' as const,tier:'default',provider:'bailian',model:'qwen3.8-flash',signature:'synthetic',sourceDigest:'synthetic',reservedCostCny:0.06}
  const rows=await budget.reserveGraph([entry,{...entry,logicalCallId:'second'}],user)
  assert.equal(rows.length,2);assert.equal(Number((await providerBudgetView()).accounted_cny),0.12)
  await budget.finish(rows[0].callId,{outcome:'transport_error',usage:'unknown',estimatedCostCny:'unknown',providerResponseId:null})
  await budget.finish(rows[1].callId,{outcome:'not_sent',usage:{providerCalls:0},estimatedCostCny:0,providerResponseId:null})
  assert.equal(Number((await providerBudgetView()).accounted_cny),0.06,'unknown retains the full hold; proven unstarted node releases only its own hold')
  assert.equal((await providerBudgetView()).unknown_or_active_calls,1)
  const tooLarge=await graphId();await assert.rejects(async()=>budget.reserveGraph([{...entry,runId:tooLarge,reservedCostCny:0.15}],user),/PROVIDER_BUDGET_EXHAUSTED/)
  assert.equal(Number((await providerBudgetView()).accounted_cny),0.06,'failed graph never adds a paid dispatch or resets history')
  const partial=await budget.reserveGraph([{...entry,runId:await graphId()}],user)
  await budget.finish(partial[0].callId,{outcome:'stop',usage:{totalTokens:2},estimatedCostCny:0.01,providerResponseId:'synthetic'})
  assert.equal(Number((await providerBudgetView()).accounted_cny),0.07)
  const fiveId=await graphId(),five=await budget.reserveGraph(Array.from({length:5},(_,i)=>({...entry,runId:fiveId,logicalCallId:'five-'+i,reservedCostCny:0.01})),user)
  const slots=(await pool.query('SELECT call_index,workflow_request_id FROM lifeos_provider_spend WHERE user_id=$1 AND request_id=$2 ORDER BY call_index',[user,fiveId])).rows
  assert.deepEqual(slots.map(x=>x.call_index),[1,2,3,4,5]);assert.ok(slots.every(x=>x.workflow_request_id===fiveId))
  for(const row of five)await budget.finish(row.callId,{outcome:'not_sent',usage:{providerCalls:0},estimatedCostCny:0,providerResponseId:null})
  const partialId=await graphId();await assert.rejects(async()=>budget.reserveGraph(Array.from({length:3},(_,i)=>({...entry,runId:partialId,logicalCallId:'partial-'+i})),user),/PROVIDER_BUDGET_EXHAUSTED/)
  assert.equal(Number((await providerBudgetView()).accounted_cny),0.07,'a partially reserved but entirely unstarted graph releases its own slots')
  await assert.rejects(async()=>budget.finish(rows[0].callId,{outcome:'stop',usage:{},estimatedCostCny:0,providerResponseId:null}),/ALREADY_SETTLED/)
  await assert.rejects(()=>reserveProviderSpend({user,requestId:randomUUID(),callIndex:3,provider:'synthetic',model:'synthetic',ceilingCny:0.01}),/check constraint/,'ordinary dialogue still cannot dispatch a third call')
 }finally{config.providerBudgetEnabled=oldEnabled;config.providerBudgetId=oldId}
})

test('a failed unstarted graph cleanup attempts later slots and reports the unreleased hold',async()=>{
 const database=(await pool.query('SELECT current_database() AS name')).rows[0].name
 assert.match(database,/^lifeos_dialogue_test_/)
 const oldEnabled=config.providerBudgetEnabled,oldId=config.providerBudgetId
 config.providerBudgetEnabled=true;config.providerBudgetId='cleanup-budget-'+randomUUID()
 const user='cleanup-user-'+randomUUID(),f=fixture();f.request.internalActorKey=user
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await store.createConversation(user,{id:f.request.conversationId,title:'SYNTHETIC cleanup failure'})
 await postgresJournal().claim(f.request,'synthetic')
 try{
  await setProviderBudget(config.providerBudgetId,0.17)
  await pool.query(`CREATE FUNCTION test_workflow_cleanup_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF OLD.call_index=1 AND NEW.status='not_sent' THEN RAISE EXCEPTION 'SYNTHETIC_SETTLEMENT_FAILURE'; END IF;
   RETURN NEW; END $$;
   CREATE TRIGGER test_workflow_cleanup_failure BEFORE UPDATE ON lifeos_provider_spend FOR EACH ROW EXECUTE FUNCTION test_workflow_cleanup_failure()`)
  const budget=createProductionWorkflowBudget(),entry={runId:f.request.requestId,purpose:'diagnostic' as const,tier:'default',provider:'synthetic',model:'synthetic',signature:'synthetic',sourceDigest:'synthetic',reservedCostCny:0.06}
  await assert.rejects(async()=>budget.reserveGraph(Array.from({length:3},(_,i)=>({...entry,logicalCallId:'cleanup-'+i})),user),(error:any)=>error instanceof AggregateError&&error.message==='WORKFLOW_RESERVATION_CLEANUP_FAILED'&&error.errors.length===2&&error.errors[0].code==='PROVIDER_BUDGET_EXHAUSTED'&&error.errors[1].message==='SYNTHETIC_SETTLEMENT_FAILURE','both the preparation failure and the unreleased slot are reported')
  const rows=(await pool.query('SELECT call_index,status,reserved_cny,settled_cny FROM lifeos_provider_spend WHERE user_id=$1 ORDER BY call_index',[user])).rows
  assert.deepEqual(rows.map(x=>({slot:x.call_index,status:x.status})),[{slot:1,status:'reserved'},{slot:2,status:'not_sent'}],'a failed first settlement must not prevent cleanup of a later provably unstarted slot')
  assert.equal(Number((await providerBudgetView()).accounted_cny),0.06,'only the unreleased hold remains authoritative; it is not guessed free')
  assert.equal(budget.snapshot().calls.length,0,'failed preparation never hands a graph to the SDK')
 }finally{
  await pool.query('DROP TRIGGER IF EXISTS test_workflow_cleanup_failure ON lifeos_provider_spend; DROP FUNCTION IF EXISTS test_workflow_cleanup_failure()')
  // This isolated test operator knows these particular graph slots were never sent.
  for(const row of (await pool.query("SELECT id FROM lifeos_provider_spend WHERE user_id=$1 AND status='reserved'",[user])).rows)await settleProviderSpend(row.id,0,true)
  config.providerBudgetEnabled=oldEnabled;config.providerBudgetId=oldId
 }
})

test('simultaneous workflow requests cannot exceed the shared production cap',async()=>{
 const oldEnabled=config.providerBudgetEnabled,oldId=config.providerBudgetId
 config.providerBudgetEnabled=true;config.providerBudgetId='concurrent-budget-'+randomUUID()
 const budget=createProductionWorkflowBudget()
 try{
  await setProviderBudget(config.providerBudgetId,0.12)
  const inputs=[]
  for(let i=0;i<4;i++){
   const user='concurrent-user-'+randomUUID(),f=fixture();f.request.internalActorKey=user
   await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
   await store.createConversation(user,{id:f.request.conversationId,title:'SYNTHETIC simultaneous cap'})
   await postgresJournal().claim(f.request,'synthetic')
   inputs.push({user,entry:{runId:f.request.requestId,logicalCallId:'only',purpose:'diagnostic' as const,tier:'default',provider:'synthetic',model:'synthetic',signature:'synthetic',sourceDigest:'synthetic',reservedCostCny:0.08}})
  }
  const outcomes=await Promise.allSettled(inputs.map(x=>budget.reserveGraph([x.entry],x.user)))
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1,'all accounts share one authoritative budget-row lock')
  assert.ok(outcomes.filter(x=>x.status==='rejected').every(x=>x.status==='rejected'&&x.reason.code==='PROVIDER_BUDGET_EXHAUSTED'))
  assert.equal(Number((await providerBudgetView()).accounted_cny),0.08)
  for(const outcome of outcomes)if(outcome.status==='fulfilled')await budget.finish(outcome.value[0].callId,{outcome:'not_sent',usage:{providerCalls:0},estimatedCostCny:0,providerResponseId:null})
  assert.equal(Number((await providerBudgetView()).accounted_cny),0)
 }finally{config.providerBudgetEnabled=oldEnabled;config.providerBudgetId=oldId}
})
