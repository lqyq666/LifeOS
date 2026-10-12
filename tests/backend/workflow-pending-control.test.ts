import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import * as store from '../../server/store.ts'
import {createGrowthItem} from '../../server/growth.ts'
import {resolveControlRequest,listControlRequests} from '../../server/memory-controls.ts'
import {workflowControls} from '../../server/workflows/task-sources.ts'
import {createWorkflowHost} from '../../server/workflows/task-host.ts'

test.after(()=>pool.end())
test('pending target confirmation blocks deep dispatch and changes its snapshot; confirmation preserves the original goal',async()=>{
 const user='pending-deep-'+randomUUID(),chat=randomUUID(),oldFlag=process.env.LIFEOS_ADVANCED_WORKFLOWS,oldAccess=config.entitlementsEnabled
 process.env.LIFEOS_ADVANCED_WORKFLOWS='true';config.entitlementsEnabled=false
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await store.createConversation(user,{id:chat,title:'SYNTHETIC pending guard'})
 const goal=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'goal',text:'我想完成课程作业'})
 const question=(await store.startRun(user,chat,randomUUID(),'本周剩两小时，请深入比较就业和考研。')).run
 await store.finishRun(question,{candidates:[],audit:[]},'合成输入已保存。',null,new AbortController().signal)
 const before=await workflowControls(user),control=(await store.startRun(user,chat,randomUUID(),'别再给课程作业安排任务。')).run
 await store.finishRun(control,{candidates:[],audit:[],pendingMemoryControl:{kind:'stop_recommend',clauseText:'别再给课程作业安排任务',candidates:[{itemId:goal.id,revision:goal.revision,preview:goal.text}]}},'请确认原事项。',null,new AbortController().signal)
 let calls=0
 const never=async()=>{calls++;throw new Error('MUST_NOT_DISPATCH')}
 const host=createWorkflowHost({synthetic:true,adapter:{executionKind:'simulated_provider',maxCostPerCallCny:0.01,analyze:never,critic:never,synthesize:never}})
 try{
  const pending=await workflowControls(user);assert.notEqual(pending.digest,before.digest);assert.equal(pending.pending.length,1)
  assert.equal((await workflowControls('another-actor')).pending.length,0)
  await assert.rejects(()=>host.create(user,{requestId:randomUUID(),conversationId:chat,currentMessageId:question.source_message_id,directions:['employment','postgraduate_exam'],consent:true}),(e:any)=>e.code==='WORKFLOW_CONTROL_CONFIRMATION_REQUIRED')
  assert.equal(calls,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM lifeos_workflow_tasks WHERE user_id=$1',[user])).rows[0].n,0)
  const request=(await listControlRequests(user))[0];await resolveControlRequest(user,request.id,{requestId:randomUUID(),action:'confirm',itemId:goal.id})
  const after=await workflowControls(user);assert.equal(after.pending.length,0);assert.ok(after.stopped.some(x=>x.itemId===goal.id));assert.notEqual(after.digest,pending.digest)
  assert.equal((await pool.query('SELECT status FROM growth_items WHERE user_id=$1 AND id=$2',[user,goal.id])).rows[0].status,'active')
 }finally{host.close();config.entitlementsEnabled=oldAccess;oldFlag===undefined?delete process.env.LIFEOS_ADVANCED_WORKFLOWS:process.env.LIFEOS_ADVANCED_WORKFLOWS=oldFlag}
})
