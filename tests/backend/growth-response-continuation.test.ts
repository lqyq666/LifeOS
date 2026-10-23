import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {stageGrowthUpdates,growthContext} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
test.after(async()=>{await pool.end()})
test('the observed event-free teacher continuation amends old clauses and retains the other person',async()=>{
 const user='event-free-response-'+randomUUID(),chats=[randomUUID(),randomUUID(),randomUUID()],signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
 for(const id of chats)await store.createConversation(user,{id,title:'SYNTHETIC growth-only response'})
 const texts=['老师没回复只是结果未知，不等于拒绝我','更正并区分两件事：老师那封邮件是未回复；另一位同学试过我做的表格后明确说不适合他']
 const oldIds:string[]=[]
 for(const [index,text] of texts.entries()){
  const run=(await store.startRun(user,chats[index]!,randomUUID(),text)).run
  const quotes=index===0?[text,'老师没回复只是结果未知']:[text,'更正并区分两件事：老师那封邮件是未回复']
  const growth=await stageGrowthUpdates(run,quotes.map(quote=>({target:{operation:'create' as const},kind:'context' as const,assertion:'user_reported' as const,source:{messageId:run.source_message_id,quote}})),await growthContext(user,chats[index]!),{})
  const receipt=await store.finishRun(run,{candidates:[],audit:[],growth},'按原话保存。',null,signal);oldIds.push(...receipt.growthCreatedIds)
 }
 const previous={url:model.baseUrl,key:config.apiKey,budget:config.providerBudgetEnabled,encode:localEmbedding.encode};let calls=0
 const fake=createServer((req,res)=>{calls++;res.writeHead(500);res.end()});await new Promise<void>(done=>fake.listen(0,'127.0.0.1',done))
 localEmbedding.encode=async texts=>texts.map(()=>Array(512).fill(0));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-no-generation-only';config.providerBudgetEnabled=false
 try{
  const run=(await store.startRun(user,chats[2]!,randomUUID(),'回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。请只更新各自相关状态。')).run
  const staged:store.Staged={candidates:[],audit:[]}
  const result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
  await store.finishRun(run,staged,result.text,result.usage,signal)
  assert.equal(calls,0);assert.ok(!staged.coach,'existing growth sources do not require inventing an event')
  const current=await growthContext(user,chats[2]!)
  assert.ok(!current.some(item=>/老师[^；。]*未回复|老师没回复/.test(item.text)),'the historical no-response cannot remain current')
  assert.ok(current.some(item=>/老师后来回复说这周忙/.test(item.text)))
  assert.ok(current.some(item=>item.text==='另一位同学试过我做的表格后明确说不适合他'),'amending the teacher clause retains the other actor in the composite record')
  assert.ok(current.some(item=>item.text==='不等于拒绝我'),'the unrelated interpretation remains available')
  const revisions=(await pool.query("SELECT count(*)::int AS count FROM growth_revisions WHERE user_id=$1 AND item_id=ANY($2::uuid[])",[user,oldIds])).rows[0].count
  assert.ok(revisions>oldIds.length,'the original records retain versioned corrections')
 }finally{
  fake.closeAllConnections();await new Promise<void>(done=>fake.close(()=>done()))
  model.baseUrl=previous.url;config.apiKey=previous.key;config.providerBudgetEnabled=previous.budget;localEmbedding.encode=previous.encode
 }
})
