import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {fixture} from '../workflows/fixtures.ts'
import {emptyProposal,type WorkflowReceipt} from '../../server/workflows/contracts.ts'
import {createOrchestrator,type WorkflowNode} from '../../server/workflows/orchestrator.ts'
import {postgresJournal} from '../../server/workflows/task-journal.ts'

test.after(()=>pool.end())
for(const control of ['cancelled','timeout'] as const)test(`terminal transaction preserves ${control} committed after the final graph check`,async()=>{
 const f=fixture(),user='terminal-control-'+randomUUID(),chat=randomUUID()
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC finalization race'})
  f.request.internalActorKey=user;f.request.conversationId=chat
  for(const record of f.records){record.owner=user;record.conversationId=chat}
  let calls=0
  const node:WorkflowNode={id:'analyst',role:'path_analyst',dependencies:[],executionKind:'simulated_provider',maxCostCny:0.02,invoke:async()=>{calls++;return {result:{evidenceRefs:f.request.authorizedEvidenceRefs,summary:'SYNTHETIC no network',issues:[]},providerCalls:1,costCny:0.01}}}
  const journal=postgresJournal(),runner=createOrchestrator({journal,readEvidence:async()=>f.records,finishGraph:async()=>{
   // This hook runs after execute() has completed its last cancellation check.
   await pool.query(control==='cancelled'?'UPDATE lifeos_workflow_tasks SET cancel_requested=true WHERE user_id=$1 AND request_id=$2':"UPDATE lifeos_workflow_tasks SET deadline_at=clock_timestamp()-interval '1 second' WHERE user_id=$1 AND request_id=$2",[user,f.request.requestId])
  }})
  const build=async():Promise<WorkflowReceipt>=>({schemaVersion:2,traceId:f.request.traceId,status:'proposed',proposal:emptyProposal(f.request),providerCalls:0,costCny:0,reservedCostCny:0,executionKind:'simulated_provider',skills:[],fallback:'none'})
  const receipt=await runner.run(f.request,[node],build)
  assert.equal(receipt.status,'unavailable');assert.equal(receipt.failure,control);assert.equal(receipt.proposal,undefined)
  assert.equal(receipt.providerCalls,1);assert.equal(receipt.costCny,0.01);assert.equal(receipt.reservedCostCny,0.02)
  const saved=(await pool.query('SELECT status,receipt FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2',[user,f.request.requestId])).rows[0]
  assert.equal(saved.status,'finished');assert.deepEqual(saved.receipt,JSON.parse(JSON.stringify(receipt)))
  assert.deepEqual(JSON.parse(JSON.stringify(await runner.run(f.request,[node],build))),JSON.parse(JSON.stringify(receipt)));assert.equal(calls,1,'replay cannot repeat the completed graph')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})
