import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {fixture} from '../workflows/fixtures.ts'
import {emptyProposal,type WorkflowReceipt} from '../../server/workflows/contracts.ts'
import {createOrchestrator,type WorkflowNode} from '../../server/workflows/orchestrator.ts'
import {postgresJournal} from '../../server/workflows/task-journal.ts'

test.after(()=>pool.end())
test('WF04 PostgreSQL: 257 completions, restart/replay, concurrent workers and crash-after-dispatch never reinvoke',async()=>{
 const f=fixture(),user='workflow-journal-'+randomUUID(),chat=randomUUID()
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await store.createConversation(user,{id:chat,title:'SYNTHETIC journal'})
 f.request.internalActorKey=user;f.request.conversationId=chat
 for(const r of f.records){r.owner=user;r.conversationId=chat}
 let calls=0
 const node:WorkflowNode={id:'analyst',role:'path_analyst',dependencies:[],executionKind:'simulated_provider',maxCostCny:0.02,invoke:async()=>{calls++;return {result:{evidenceRefs:f.request.authorizedEvidenceRefs,summary:'SYNTHETIC no provider wire',issues:[]},providerCalls:1,costCny:0.01}}}
 const build=async(r:typeof f.request):Promise<WorkflowReceipt>=>({schemaVersion:2,traceId:r.traceId,status:'proposed',proposal:emptyProposal(r),providerCalls:0,costCny:0,reservedCostCny:0,executionKind:'simulated_provider',skills:[],fallback:'none'})
 const make=()=>createOrchestrator({journal:postgresJournal(),readEvidence:async()=>f.records,maxEntries:2})
 const runner=make(),requests=Array.from({length:257},()=>({...f.request,requestId:randomUUID(),traceId:randomUUID()}))
 for(const r of requests)assert.equal((await runner.run(r,[node],build)).status,'proposed')
 assert.equal(calls,257)
 assert.equal((await make().run(requests[0],[node],build)).status,'proposed');assert.equal(calls,257)
 const same={...f.request,requestId:randomUUID(),traceId:randomUUID()}
 const both=await Promise.all([make().run(same,[node],build),make().run(same,[node],build)])
 assert.ok(both.every(r=>r.status==='proposed'));assert.equal(calls,258)
 const crash={...f.request,requestId:randomUUID(),traceId:randomUUID()},journal=postgresJournal()
 await journal.claim(crash,createHash('sha256').update(JSON.stringify(crash)).digest('hex'))
 await journal.startNode(crash,node)
 await pool.query("UPDATE lifeos_workflow_tasks SET deadline_at=now()-interval '1 second' WHERE user_id=$1 AND request_id=$2",[user,crash.requestId])
 const unknown=await make().run(crash,[node],build)
 assert.equal(unknown.status,'unavailable');assert.equal(unknown.costCny,null);assert.equal(unknown.reservedCostCny,0.02);assert.equal(unknown.providerCalls,1);assert.equal(calls,258)
 assert.equal((await make().run(crash,[node],build)).costCny,null);assert.equal(calls,258)
 f.records[1].status='withdrawn'
 assert.equal((await make().run(requests[0],[node],build)).failure,'source_invalid');assert.equal(calls,258)
 const count=await pool.query('SELECT count(*)::int AS n FROM lifeos_workflow_nodes WHERE user_id=$1',[user]);assert.equal(count.rows[0].n,259)
 await pool.query('DELETE FROM "user" WHERE id=$1',[user])
})
