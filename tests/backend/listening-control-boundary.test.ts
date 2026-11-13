import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {pool} from '../../server/db.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {createGrowthItem,growthContext,stageGrowthUpdates} from '../../server/growth.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import * as store from '../../server/store.ts'

test('listening requests never become goals; one rejected label remains a sourced cross-session boundary',async()=>{
 const user='listening-controls-'+randomUUID(),a=randomUUID(),b=randomUUID(),signal=new AbortController().signal
 const old={url:model.baseUrl,key:config.apiKey,budget:config.providerBudgetEnabled};let calls=0
 const fake=createServer((_req,res)=>{calls++;res.writeHead(500);res.end()});await new Promise<void>(done=>fake.listen(0,'127.0.0.1',done))
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-listening-control';config.providerBudgetEnabled=false
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  for(const id of [a,b])await store.createConversation(user,{id,title:'SYNTHETIC listening control'})
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  const related=await createGrowthItem(user,{requestId:randomUUID(),conversationId:a,kind:'context',text:'我参与过销售活动'})
  const text='我现在只想被听见，不想分析方向。'
  const run=(await store.startRun(user,a,randomUUID(),text)).run
  const growth=await stageGrowthUpdates(run,[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{messageId:run.source_message_id,quote:'我现在只想被听见'}}],await growthContext(user,a))
  assert.equal(growth.changes.length,0,'a provider misclassification cannot persist a listening request')
  await store.finishRun(run,{candidates:[],audit:[],growth},'我听着。',null,signal)
  const denied='忘掉“我喜欢销售”这个从未由我确认的错误标签。'
  const rejected=(await store.startRun(user,a,randomUUID(),denied)).run,staged:store.Staged={candidates:[],audit:[]}
  const result=await createTurnEngine({capabilityVerified:()=>true})({run:rejected,staged,context:await store.contextForRun(rejected),decision:null,signal,emit:()=>{}})
  await store.finishRun(rejected,staged,result.text,result.usage,signal)
  assert.equal(calls,0,'a pure control needs no model call')
  const next=await growthContext(user,b),boundaries=next.filter(item=>item.inferenceBoundary?.active&&item.inferenceBoundary.label==='我喜欢销售')
  assert.equal(boundaries.length,1,'one combined source record, not duplicate clause facts')
  assert.deepEqual(boundaries[0]!.inferenceBoundary!.instructionQuotes,['忘掉“我喜欢销售”这个从未由我确认的错误标签'])
  assert.ok(next.some(item=>item.id===related.id),'related actual experience remains available')
  assert.ok(!next.some(item=>item.kind==='goal'&&item.text.includes('被听见')))
 }finally{
  model.baseUrl=old.url;config.apiKey=old.key;config.providerBudgetEnabled=old.budget
  fake.closeAllConnections();await new Promise<void>(done=>fake.close(()=>done()));await localEmbedding.close();await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end()
 }
})
