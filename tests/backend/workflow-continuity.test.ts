import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {config} from '../../server/config.ts'
import {HttpError} from '../../server/db.ts'
import {createWorkflowHost} from '../../server/workflows/task-host.ts'
import {timeBudget} from '../../server/workflows/task-sources.ts'
import {simulatedDecision} from '../workflows/fixtures.ts'
process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
config.entitlementsEnabled=false
test.after(()=>pool.end())
test('short exact personal week budget excludes questions, quotes, conditions, third parties and spent time',()=>{
 for(const text of ['这周六小时','本周我有6小时','本周只有1.5小时','下周六小时','这周大概六小时'])assert.ok(timeBudget(text),text)
 for(const text of ['这周六小时吗？','如果这周六小时','同学说这周六小时','“这周六小时”','这周做作品花了六小时','这周不是六小时','这周六到八小时'])assert.equal(timeBudget(text),undefined,text)
 assert.deepEqual(timeBudget('这周六小时'),{period:'this_week',amountMinutes:360})
})
test('waiting clarification resumes original durable graph once across workers and restart; controls and opaque dispatch never reopen',async()=>{
 const user='workflow-continuity-'+randomUUID(),chat=randomUUID(),other='workflow-other-'+randomUUID()
 for(const id of [user,other])await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[id,id+'@example.invalid'])
 await store.createConversation(user,{id:chat,title:'SYNTHETIC continuity'})
 const original='我是成年大学生，有课程作品，想深入比较就业和考研，还不确定本周空余时间。'
 async function message(text:string){const run=(await store.startRun(user,chat,randomUUID(),text)).run;await store.finishRun(run,{candidates:[],audit:[]},'合成记录，不调用模型。',null,new AbortController().signal);return run.source_message_id}
 const source=await message(original),base=simulatedDecision();let calls=0
 const adapter=simulatedDecision({analyze:async(c,path,skill)=>{calls++;return base.analyze(c,path,skill)},critic:async(c,a,s)=>{calls++;return base.critic(c,a,s)},synthesize:async(c,a,r,s)=>{calls++;return base.synthesize(c,a,r,s)}})
 const a=createWorkflowHost({adapter,synthetic:true}),b=createWorkflowHost({adapter,synthetic:true})
 const body=(id=randomUUID())=>({requestId:id,conversationId:chat,currentMessageId:source,directions:['employment','postgraduate_exam'],consent:true})
 const wait=async(id:string)=>{for(let i=0;i<200;i++){const view=await a.read(user,id);if(!['queued','running'].includes(view.status))return view;await new Promise(done=>setTimeout(done,10))}assert.fail('task not terminal')}
 try{
  const first=body();assert.equal((await a.create(user,first)).status,'waiting_user');assert.equal(calls,0)
  const supplement=await message('这周六小时'),resume={conversationId:chat,currentMessageId:supplement}
  await Promise.all([a.resume(user,first.requestId,resume),b.resume(user,first.requestId,resume)]);assert.equal((await wait(first.requestId)).status,'proposed');assert.equal(calls,4)
  const saved=(await pool.query('SELECT request_payload FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2',[user,first.requestId])).rows[0].request_payload
  assert.equal(saved.currentIntent,original);assert.deepEqual(saved.directions.map((x:any)=>x.id),first.directions);assert.equal(saved.authorizedEvidenceRefs[0].id,source);assert.equal(saved.budget.amountMinutes,360);assert.equal(saved.budget.source.id,supplement)
  const restarted=createWorkflowHost({adapter,synthetic:true});try{assert.equal((await restarted.resume(user,first.requestId,resume)).status,'proposed');assert.equal((await restarted.create(user,first)).status,'proposed')}finally{restarted.close()};assert.equal(calls,4)
  await assert.rejects(()=>a.resume(other,first.requestId,resume),e=>e instanceof HttpError&&e.status===404)
  const changed=await message('这周两小时');await assert.rejects(()=>a.resume(user,first.requestId,{conversationId:chat,currentMessageId:changed}),/WORKFLOW_NOT_WAITING/);assert.equal(calls,4)
  const invalid=body();await a.create(user,invalid);const question=await message('这周六小时吗？')
  await assert.rejects(()=>a.resume(user,invalid.requestId,{conversationId:chat,currentMessageId:question}),/WORKFLOW_TIME_REQUIRED/);assert.equal((await a.read(user,invalid.requestId)).status,'waiting_user');assert.equal(calls,4)
  await a.cancel(user,invalid.requestId);await assert.rejects(()=>a.resume(user,invalid.requestId,{conversationId:chat,currentMessageId:changed}),/WORKFLOW_NOT_WAITING/)
  const expired=body();await a.create(user,expired);const oldTime=await message('这周六小时')
  await pool.query("UPDATE messages SET created_at=now()-interval '14 days' WHERE user_id=$1 AND id=$2",[user,oldTime])
  await assert.rejects(()=>a.resume(user,expired.requestId,{conversationId:chat,currentMessageId:oldTime}),e=>e instanceof HttpError&&e.status===404);assert.equal(calls,4)
  const opaque=body();await a.create(user,opaque)
  await pool.query("INSERT INTO lifeos_workflow_nodes(user_id,request_id,node_id,execution_kind,role,max_cost_cny,status,call_id,input_ref_digest,provider_calls) VALUES($1,$2,'path:employment','simulated_provider','path_analyst',0.02,'unknown',$3,'synthetic',1)",[user,opaque.requestId,randomUUID()])
  await assert.rejects(()=>a.resume(user,opaque.requestId,{conversationId:chat,currentMessageId:changed}),/WORKFLOW_ALREADY_DISPATCHED/);assert.equal(calls,4)
  const stale=body();await a.create(user,stale);await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1) ON CONFLICT(user_id) DO UPDATE SET enabled=true,revision=user_memory_settings.revision+1',[user])
  await assert.rejects(()=>a.resume(user,stale.requestId,{conversationId:chat,currentMessageId:changed}),/WORKFLOW_SOURCE_CHANGED/);assert.equal(calls,4)
 }finally{a.close();b.close();await pool.query('DELETE FROM "user" WHERE id=ANY($1)',[[user,other]])}
})
