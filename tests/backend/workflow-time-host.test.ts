import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {config} from '../../server/config.ts'
import {createWorkflowHost} from '../../server/workflows/task-host.ts'
import {simulatedDecision,proposal} from '../workflows/fixtures.ts'
process.env.LIFEOS_ADVANCED_WORKFLOWS='true';config.entitlementsEnabled=false
test.after(()=>pool.end())
test('durable own-time questions accept omissions, estimates, upper bounds and next week; refusal and conflicts dispatch nothing',async()=>{
 const user='time-host-'+randomUUID(),chat=randomUUID();let calls=0
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await store.createConversation(user,{id:chat,title:'SYNTHETIC time host'})
 const message=async(text:string)=>{const run=(await store.startRun(user,chat,randomUUID(),text)).run;await store.finishRun(run,{candidates:[],audit:[]},'合成消息记录。',null,new AbortController().signal);return run.source_message_id}
 const bounded=(r:any,paths=r.directions)=>{const p=proposal(r,paths);p.alternatives.forEach(x=>x.weeklyMinutes=0);p.nextActions=[];return p}
 const host=createWorkflowHost({synthetic:true,adapter:simulatedDecision({
  analyze:async(c,path)=>{calls++;return {result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'SCRIPTED',issues:[],proposal:bounded(c.request,[path])},providerCalls:1,costCny:0}},
  critic:async c=>{calls++;return {result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'SCRIPTED',issues:[]},providerCalls:1,costCny:0}},
  synthesize:async c=>{calls++;return {result:{evidenceRefs:c.request.authorizedEvidenceRefs,summary:'SCRIPTED',issues:[],proposal:bounded(c.request)},providerCalls:1,costCny:0}},
 })})
 const create=async(text='想深入比较就业和考研，还算不准本周本人可用时间。')=>{const body={requestId:randomUUID(),conversationId:chat,currentMessageId:await message(text),directions:['employment','postgraduate_exam'],consent:true};await host.create(user,body);return body.requestId}
 const finish=async(id:string)=>{for(let i=0;i<100;i++){const v=await host.read(user,id);if(!['queued','running'].includes(v.status))return v;await new Promise(r=>setTimeout(r,10))}assert.fail('not finished')}
 try{
  for(const [text,amount,period,qualification] of [['六小时',360,'this_week','exact'],['大概六小时',360,'this_week','estimate'],['大概两小时吧，还是刚才这两条路。',120,'this_week','estimate'],['最多六小时',360,'this_week','upper_bound'],['其实只剩两小时',120,'this_week','exact'],['下周六小时，这周没空',0,'this_week','exact'],['下周六小时',360,'next_week','exact']] as const){
   const id=await create(),before=calls,ref=await message(text)
   await host.resume(user,id,{conversationId:chat,currentMessageId:ref});assert.equal((await finish(id)).status,'proposed');assert.equal(calls-before,4)
   const r=(await pool.query('SELECT request_payload FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0].request_payload
   assert.equal(r.budget.amountMinutes,amount);assert.equal(r.budget.period,period);assert.equal(r.budget.qualification,qualification);assert.equal(r.budget.source.id,ref)
  }
  for(const text of ['我还算不准','这周六小时，这周两小时','同学有六小时','我已经做了六小时','如果有六小时']){const id=await create(),before=calls;
   const messageRef=await message(text);await assert.rejects(()=>host.resume(user,id,{conversationId:chat,currentMessageId:messageRef}),/WORKFLOW_TIME_REQUIRED/);assert.equal(calls,before);assert.equal((await host.read(user,id)).status,'waiting_user')}
  const id=await create(),before=calls;await host.resume(user,id,{conversationId:chat,currentMessageId:await message('先别分析了，六小时')});assert.equal((await host.read(user,id)).status,'cancelled');assert.equal(calls,before)
  const changed=await create();
  const messageRef=await message('我改为就业优先，这周六小时');await assert.rejects(()=>host.resume(user,changed,{conversationId:chat,currentMessageId:messageRef}),/WORKFLOW_INTENT_CHANGED/)
  const old=await create();  // Use an ISO anchor just as the real persisted host does.
  await pool.query("UPDATE lifeos_workflow_tasks SET request_payload=jsonb_set(request_payload,'{hostSnapshot,budgetQuestion,anchor}',to_jsonb($2::text)) WHERE request_id=$1",[old,new Date(Date.now()-14*86400000).toISOString()])
  const fresh=await message('六小时');await assert.rejects(()=>host.resume(user,old,{conversationId:chat,currentMessageId:fresh}),/WORKFLOW_TIME_CONTEXT_EXPIRED/)
  const ids=[await create(),await create()],supplement=await message('六小时'),start=calls
  await Promise.all(ids.map(id=>host.resume(user,id,{conversationId:chat,currentMessageId:supplement})));await Promise.all(ids.map(finish));assert.equal(calls-start,8);assert.equal(new Set(ids).size,2)
  const mixed=await create('我每周能拿出六小时，但这周只剩两小时，深入比较就业和考研。');assert.equal((await finish(mixed)).status,'proposed');const r=(await pool.query('SELECT request_payload FROM lifeos_workflow_tasks WHERE request_id=$1',[mixed])).rows[0].request_payload;assert.equal(r.budget.amountMinutes,120)
  const beforeControls=calls
  await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1) ON CONFLICT(user_id) DO UPDATE SET revision=user_memory_settings.revision+1',[user])
  const stale=await host.read(user,mixed)
  assert.equal(stale.status,'failed');assert.equal(stale.receipt?.failure,'stale_snapshot');assert.equal(stale.receipt?.proposal,undefined);assert.equal(calls,beforeControls)
 }finally{host.close();await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})
