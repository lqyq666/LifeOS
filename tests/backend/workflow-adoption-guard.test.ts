import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {pool,transaction} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {config} from '../../server/config.ts'
import {createWorkflowHost} from '../../server/workflows/task-host.ts'
import {commitWorkflowSelection,workflowReceiptDigest} from '../../server/workflows/task-commit.ts'
import {simulatedDecision,proposal} from '../workflows/fixtures.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {readFileSync} from 'node:fs'
import {postgresJournal} from '../../server/workflows/task-journal.ts'
process.env.LIFEOS_ADVANCED_WORKFLOWS='true';config.entitlementsEnabled=false
test.after(()=>pool.end())
test('adoption transaction rejects changed receipt, incomplete terminal, changed controls and withdrawn method before any growth write',async()=>{
 const user='adoption-'+randomUUID(),chat=randomUUID()
 let withdrawnSource:{source_id:string;status:string}|undefined
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await store.createConversation(user,{id:chat,title:'SYNTHETIC adoption'})
 const source=(await store.startRun(user,chat,randomUUID(),'这周本人有六小时，深入比较就业与考研。')).run
 await store.finishRun(source,{candidates:[],audit:[]},'合成消息记录。',null,new AbortController().signal)
 const host=createWorkflowHost({synthetic:true,adapter:simulatedDecision({analyze:async(c,path)=>({result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'SCRIPTED',issues:[],proposal:proposal(c.request,[path])},providerCalls:1,costCny:0}),critic:async c=>({result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'SCRIPTED',issues:[]},providerCalls:1,costCny:0}),synthesize:async c=>({result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'SCRIPTED',issues:[],proposal:proposal(c.request)},providerCalls:1,costCny:0})})})
 const id=randomUUID();await host.create(user,{requestId:id,conversationId:chat,currentMessageId:source.source_message_id,directions:['employment','postgraduate_exam'],consent:true})
 let view:any;for(let i=0;i<100;i++){view=await host.read(user,id);if(!['queued','running'].includes(view.status))break;await new Promise(r=>setTimeout(r,10))}assert.equal(view.status,'proposed')
 const run=(await store.startRun(user,chat,randomUUID(),'我采纳这个计划，尚未执行。')).run,selection={taskId:id,kind:'action' as const,index:0,receiptDigest:workflowReceiptDigest(view.receipt)}
 const commit=()=>transaction(c=>commitWorkflowSelection(c,run,selection))
 try{
  const payloadBefore=(await pool.query('SELECT request_payload FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0].request_payload
  await pool.query('UPDATE lifeos_workflow_tasks SET request_payload=$3 WHERE user_id=$1 AND request_id=$2',[user,id,{...payloadBefore,hostSnapshot:{...payloadBefore.hostSnapshot,adoptionVersionDigest:'f'.repeat(64)}}]);await assert.rejects(commit,/WORKFLOW_VERSION_CHANGED/)
  await pool.query('UPDATE lifeos_workflow_tasks SET request_payload=$3 WHERE user_id=$1 AND request_id=$2',[user,id,payloadBefore])
  const remote={...view.receipt,verifiedRuntimeBinding:{cloudCommit:'f'.repeat(40)}}
  selection.receiptDigest=workflowReceiptDigest(remote);await pool.query('UPDATE lifeos_workflow_tasks SET receipt=$3 WHERE user_id=$1 AND request_id=$2',[user,id,remote]);await assert.rejects(commit,/WORKFLOW_CLOUD_VERSION_CHANGED/)
  selection.receiptDigest=workflowReceiptDigest(view.receipt);await pool.query('UPDATE lifeos_workflow_tasks SET receipt=$3 WHERE user_id=$1 AND request_id=$2',[user,id,view.receipt])
  const changed={...view.receipt,proposal:{...view.receipt.proposal,nextActions:[{...view.receipt.proposal.nextActions[0],description:'另一条未批准行动'}]}}
  await pool.query('UPDATE lifeos_workflow_tasks SET receipt=$3 WHERE user_id=$1 AND request_id=$2',[user,id,changed]);await assert.rejects(commit,/WORKFLOW_SELECTION_CHANGED/)
  await pool.query('UPDATE lifeos_workflow_tasks SET receipt=$3 WHERE user_id=$1 AND request_id=$2',[user,id,{...view.receipt,receiptIncomplete:true}]);await assert.rejects(commit,/WORKFLOW_NOT_PROPOSED/)
  await pool.query('UPDATE lifeos_workflow_tasks SET receipt=$3 WHERE user_id=$1 AND request_id=$2',[user,id,view.receipt]);await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1)',[user]);await assert.rejects(commit,/stale_snapshot/);await pool.query('DELETE FROM user_memory_settings WHERE user_id=$1',[user])
  const root='.planning/research/evergreen/',lines=(n:string)=>readFileSync(root+n,'utf8').trim().split('\n').map(line=>JSON.parse(line)),card=lines('KB_GUIDES.jsonl').find(c=>c.guide.canonicalKey==='campus-resource')
  await importEvergreenCorpus([card],lines('KB_SOURCE_REGISTRY.jsonl'),lines('KB_EVIDENCE.jsonl'))
  const withMethod={...view.receipt,methodRefs:[{sourceId:card.id,revision:card.revision}]};selection.receiptDigest=workflowReceiptDigest(withMethod)
  await pool.query('UPDATE lifeos_workflow_tasks SET receipt=$3 WHERE user_id=$1 AND request_id=$2',[user,id,withMethod]);withdrawnSource=(await pool.query('SELECT source_id,status FROM kb_sources WHERE source_id=$1',[Object.keys(card.guide.review.sourceRevisions)[0]])).rows[0];await pool.query("UPDATE kb_sources SET status='retired' WHERE source_id=$1",[Object.keys(card.guide.review.sourceRevisions)[0]])
  await assert.rejects(commit,/COACH_KNOWLEDGE_INVALIDATED/)
  assert.equal(Number((await pool.query('SELECT count(*) n FROM growth_items WHERE user_id=$1',[user])).rows[0].n),0)
  const original=(await pool.query('SELECT request_payload FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0].request_payload
  const expired={...original,requestId:randomUUID(),traceId:randomUUID()},digest=createHash('sha256').update(JSON.stringify(expired)).digest('hex'),journal=postgresJournal()
  await journal.claim(expired,digest);await journal.startNode(expired,{id:'opaque',role:'path_analyst',dependencies:[],executionKind:'simulated_provider',maxCostCny:.02,invoke:async()=>{throw Error('NO_DISPATCH_ALLOWED')}})
  await pool.query("UPDATE lifeos_workflow_tasks SET deadline_at=now()-interval '1 second' WHERE user_id=$1 AND request_id=$2",[user,expired.requestId])
  const uncertain=(await journal.claim(expired,digest)).receipt!;assert.equal(uncertain.providerCallsAreUpperBound,true);assert.equal(uncertain.receiptIncomplete,true);assert.equal(uncertain.workerFinishedAtReturn,false);assert.equal(uncertain.costCny,null)
 }finally{if(withdrawnSource)await pool.query('UPDATE kb_sources SET status=$2 WHERE source_id=$1',[withdrawnSource.source_id,withdrawnSource.status]);host.close();await store.terminateRun(user,run.request_id,'failed','SYNTHETIC_TEST_DONE');await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})
