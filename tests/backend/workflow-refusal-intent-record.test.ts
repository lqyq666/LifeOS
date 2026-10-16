import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import {createGrowthItem,growthContext} from '../../server/growth.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {listControlRequests} from '../../server/memory-controls.ts'
import * as store from '../../server/store.ts'

test.after(async()=>{await localEmbedding.close();await pool.end()})
test('refusal binds an explicit personal task intent even when the stored kind is feedback',async()=>{
 const user='refusal-intent-'+randomUUID(),chats=[randomUUID(),randomUUID()]
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 for(const id of chats)await store.createConversation(user,{id,title:'SYNTHETIC intent classification'})
 await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
 const target=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chats[0],kind:'feedback',text:'我想先处理作业第九题'})
 const excluded=[]
 for(const text of ['“我想先处理作业第八题”','如果我想先处理作业第七题，就下周再说','同学说我想先处理作业第六题','我想先听你说','我想先处理作业第五题吗？']){
  excluded.push(await createGrowthItem(user,{requestId:randomUUID(),conversationId:chats[0],kind:'feedback',text}))
 }
 const run=(await store.startRun(user,chats[1],randomUUID(),'之前那件作业的事我暂时不打算继续做，别再给它安排任务了。')).run
 const staged:store.Staged={candidates:[],audit:[]},signal=new AbortController().signal
 const result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
 const saved=await store.finishRun(run,staged,result.text,result.usage,signal)
 assert.equal((result.usage as {llmCallCount:number}).llmCallCount,0)
 assert.equal(saved.stateChange.memoryControl?.status,'needs_confirmation','reassurance alone cannot stand in for the durable boundary')
 const pending=await listControlRequests(user)
 assert.ok(pending.some(x=>x.candidates.some(c=>c.itemId===target.id)))
 assert.ok(excluded.every(item=>pending.every(x=>x.candidates.every(c=>c.itemId!==item.id))),'quotes, conditions, attribution, conversation preferences and questions are not personal tasks')
 assert.ok((await growthContext(user,chats[1])).some(x=>x.id===target.id&&x.text===target.text),'original record retained')
})
