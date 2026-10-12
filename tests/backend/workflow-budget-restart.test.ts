import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import * as store from '../../server/store.ts'
import {fixture} from '../workflows/fixtures.ts'
import {createProductionWorkflowBudget} from '../../server/workflows/production-budget.ts'
import {postgresJournal} from '../../server/workflows/task-journal.ts'
import {setProviderBudget,providerBudgetView,reserveProviderSpend} from '../../server/provider-spend.ts'

test.after(()=>pool.end())
async function setup(){
 assert.match((await pool.query('SELECT current_database() AS name')).rows[0].name,/^lifeos_dialogue_test_/)
 const previous={enabled:config.providerBudgetEnabled,id:config.providerBudgetId},f=fixture(),user='restart-budget-'+randomUUID()
 config.providerBudgetEnabled=true;config.providerBudgetId='restart-budget-'+randomUUID();f.request.internalActorKey=user
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await store.createConversation(user,{id:f.request.conversationId,title:'SYNTHETIC crash boundary'})
 await postgresJournal().claim(f.request,'synthetic-restart')
 await setProviderBudget(config.providerBudgetId,0.3)
 const entries=Array.from({length:2},(_,i)=>({runId:f.request.requestId,logicalCallId:'restart-'+i,purpose:'diagnostic' as const,tier:'default',provider:'synthetic',model:'synthetic',signature:'synthetic',sourceDigest:'synthetic',reservedCostCny:0.06}))
 const expire=async()=>{await pool.query("UPDATE lifeos_workflow_tasks SET deadline_at=now()-interval '1 second' WHERE user_id=$1 AND request_id=$2",[user,f.request.requestId]);return (await postgresJournal().claim(f.request,'synthetic-restart')).receipt!}
 return {f,user,entries,expire,restore(){config.providerBudgetEnabled=previous.enabled;config.providerBudgetId=previous.id}}
}
test('restart before dispatch releases only durably prepared workflow slots without reinvocation',async()=>{
 const s=await setup()
 try{
  await createProductionWorkflowBudget().reserveGraph(s.entries,s.user)
  const receipt=await s.expire()
  assert.equal(Number((await providerBudgetView()).accounted_cny),0,'a lost in-memory graph must not strand proven undispatched slots')
  assert.equal(receipt.providerCalls,0);assert.equal(receipt.costCny,0);assert.equal(receipt.reservedCostCny,0)
  assert.deepEqual((await pool.query('SELECT status FROM lifeos_provider_spend WHERE user_id=$1 ORDER BY call_index',[s.user])).rows.map(x=>x.status),['not_sent','not_sent'])
 }finally{s.restore()}
})
test('restart after durable dispatch boundary retains the ambiguous call and releases later prepared slots',async()=>{
 const s=await setup()
 try{
  const slots=await createProductionWorkflowBudget().reserveGraph(s.entries,s.user)
  await postgresJournal().startNode(s.f.request,{id:'path:employment',role:'path_analyst',dependencies:[],executionKind:'real_provider',maxCostCny:0.06,callId:slots[0].callId,invoke:async()=>{throw Error('NO_PROVIDER_DISPATCH_IN_TEST')}})
  const receipt=await s.expire()
  assert.equal(Number((await providerBudgetView()).accounted_cny),0.06,'unknown dispatch remains held; an untouched later slot is released')
  assert.equal(receipt.providerCalls,1);assert.equal(receipt.costCny,null);assert.equal(receipt.reservedCostCny,0.06)
  assert.equal(receipt.receiptIncomplete,true);assert.equal(receipt.providerCallsAreUpperBound,true)
 }finally{s.restore()}
})
test('legacy workflow reservations with no dispatch proof remain held and visible in restart receipts',async()=>{
 const s=await setup()
 try{
  await reserveProviderSpend({user:s.user,requestId:s.f.request.requestId,callIndex:1,provider:'synthetic',model:'legacy',ceilingCny:0.06,workflow:true})
  const receipt=await s.expire()
  assert.equal(Number((await providerBudgetView()).accounted_cny),0.06)
  assert.equal(receipt.costCny,null);assert.equal(receipt.reservedCostCny,0.06,'legacy unknown holds cannot disappear from the terminal accounting')
  assert.equal(receipt.receiptIncomplete,true);assert.equal(receipt.providerCallsAreUpperBound,true)
 }finally{s.restore()}
})
test('legacy journal and spend rows cannot be counted as two independent provider calls',async()=>{
 const s=await setup()
 try{
  await reserveProviderSpend({user:s.user,requestId:s.f.request.requestId,callIndex:1,provider:'synthetic',model:'legacy',ceilingCny:0.06,workflow:true})
  await postgresJournal().startNode(s.f.request,{id:'legacy-path',role:'path_analyst',dependencies:[],executionKind:'real_provider',maxCostCny:0.06,callId:randomUUID(),invoke:async()=>{throw Error('NO_PROVIDER_DISPATCH_IN_TEST')}})
  const receipt=await s.expire()
  assert.equal(receipt.providerCalls,1,'legacy unbound journal and ledger representations must not double-count the same graph')
  assert.equal(receipt.reservedCostCny,0.06);assert.equal(receipt.costCny,null);assert.equal(receipt.receiptIncomplete,true)
 }finally{s.restore()}
})
test('a not-sent settlement after the durable started boundary must retain the unknown liability',async()=>{
 const s=await setup()
 try{
  const budget=createProductionWorkflowBudget(),slots=await budget.reserveGraph(s.entries,s.user)
  await postgresJournal().startNode(s.f.request,{id:'boundary-path',role:'path_analyst',dependencies:[],executionKind:'real_provider',maxCostCny:0.06,callId:slots[0].callId,invoke:async()=>{throw Error('NO_PROVIDER_DISPATCH_IN_TEST')}})
  const receipt=await budget.finish(slots[0].callId,{outcome:'not_sent',usage:{providerCalls:0},estimatedCostCny:0,providerResponseId:null})
  assert.equal(Number((await providerBudgetView()).accounted_cny),0.12,'a conflicting process-local no-send label cannot release a durable ambiguous boundary')
  assert.equal(receipt.estimatedCostCny,'unknown')
  const recovered=await s.expire();assert.equal(recovered.costCny,null);assert.equal(recovered.reservedCostCny,0.06)
 }finally{s.restore()}
})
test('a terminal journal node with an unsettled started spend remains explicitly incomplete',async()=>{
 const s=await setup()
 try{
  const [slot]=await createProductionWorkflowBudget().reserveGraph([s.entries[0]],s.user)
  await postgresJournal().startNode(s.f.request,{id:'terminal-path',role:'path_analyst',dependencies:[],executionKind:'real_provider',maxCostCny:0.06,callId:slot.callId,invoke:async()=>{throw Error('NO_PROVIDER_DISPATCH_IN_TEST')}})
  await postgresJournal().finishNode(s.f.request,'terminal-path',null,0,0,'cancelled')
  const receipt=await s.expire();assert.equal(receipt.costCny,null);assert.equal(receipt.receiptIncomplete,true);assert.equal(receipt.providerCallsAreUpperBound,true);assert.equal(receipt.providerCalls,1)
 }finally{s.restore()}
})
test('live terminal persistence cannot publish a zero-cost receipt over an unresolved durable spend',async()=>{
 const s=await setup()
 try{
  const [slot]=await createProductionWorkflowBudget().reserveGraph([s.entries[0]],s.user),journal=postgresJournal()
  await journal.startNode(s.f.request,{id:'live-terminal',role:'path_analyst',dependencies:[],executionKind:'real_provider',maxCostCny:0.06,callId:slot.callId,invoke:async()=>{throw Error('NO_PROVIDER_DISPATCH_IN_TEST')}})
  await journal.finishNode(s.f.request,'live-terminal',null,0,0,'cancelled')
  const result=await journal.finish(s.f.request,{schemaVersion:2,traceId:s.f.request.traceId,status:'unavailable',failure:'cancelled',providerCalls:0,costCny:0,reservedCostCny:0,executionKind:'real_provider',skills:[],fallback:'existing_single_agent'})
  assert.ok(result);assert.equal(result.costCny,null);assert.equal(result.receiptIncomplete,true);assert.equal(result.providerCallsAreUpperBound,true)
  assert.equal((await journal.claim(s.f.request,'synthetic-restart')).receipt?.costCny,null)
  assert.equal(Number((await providerBudgetView()).accounted_cny),0.06)
 }finally{s.restore()}
})
