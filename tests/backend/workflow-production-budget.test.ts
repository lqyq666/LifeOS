import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {setProviderBudget,providerBudgetView,reserveProviderSpend} from '../../server/provider-spend.ts'
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
