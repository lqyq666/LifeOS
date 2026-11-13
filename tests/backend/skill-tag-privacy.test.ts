import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {stageGrowthUpdates,growthView,actOnGrowthItem} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test('star-map skill labels use only current corrected and non-forgotten experience evidence',async()=>{
 const user='skill-source-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
 const tags=async()=>((await store.cognitionGraph(user)).nodes.find((n:any)=>n.type==='self') as any).skillTags.map((x:any)=>x.tag)
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid']);await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0});await store.createConversation(user,{id:chat,title:'标签来源校验'})
  const seed=async(text:string)=>{const run=(await store.startRun(user,chat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]};staged.growth=await stageGrowthUpdates(run,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:run.source_message_id,quote:text}}],[]);await store.stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote:text,links:[],content:{action:text,result:'',occurredAt:''}});await store.finishRun(run,staged,'本轮事实记录已保存。',null,signal);return (await store.listExperiences(user,chat)).find(x=>x.source_message_id===run.source_message_id)!}
  const coding=await seed('昨天我写了Python代码。');assert.ok((await tags()).includes('编程'))
  await store.experienceAction(user,coding.id,{requestId:randomUUID(),expectedRevision:coding.revision,action:'correct',content:{summary:coding.content.summary,action:'我实际整理了纸质记录'}})
  assert.ok(!(await tags()).includes('编程'),'an old summary must not retain the superseded task label')
  const currentNode=(await store.cognitionGraph(user)).nodes.find((n:any)=>n.serverId===coding.id) as any
  assert.ok(!currentNode.skillTags.includes('编程'),'experience insight and central tags use the same current evidence')
  const text='前天我完成了迎新海报排版。';await seed(text);assert.ok((await tags()).includes('设计'))
  const fact=(await growthView(user)).items.find(x=>x.text===text)!;assert.ok(fact)
  await actOnGrowthItem(user,fact.id,{requestId:randomUUID(),expectedRevision:fact.revision,action:'forget'})
  assert.ok(!(await tags()).includes('设计'),'forgotten evidence must not remain in central star-map tags')
 }finally{await localEmbedding.close();await pool.end()}
})
