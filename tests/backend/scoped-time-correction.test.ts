import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {pool} from '../../server/db.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {createGrowthItem,growthContext} from '../../server/growth.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import * as store from '../../server/store.ts'

test('observed pronoun-free time correction replaces one activity allocation and retains the independent clause',async()=>{
 const user='scope-time-'+randomUUID(),chat=randomUUID(),next=randomUUID(),signal=new AbortController().signal
 const old={url:model.baseUrl,key:config.apiKey};let calls=0
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(Buffer.from(c)));req.on('end',()=>{
  calls++;const frame={id:'synthetic-time-correction',object:'chat.completion.chunk',created:1,model:model.id}
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({...frame,choices:[{index:0,delta:{content:JSON.stringify({reply:'本周方向探索的剩余时间更新为三十分钟，其他信息保留。'})},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...frame,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}})+'\n\ndata: [DONE]\n\n')
 })});await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-loopback-only'
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  for(const id of [chat,next])await store.createConversation(user,{id,title:'SYNTHETIC scoped time correction'})
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  const prior=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'constraint',text:'本周只能给方向探索两小时，其他周可用时间还未确认。',validUntil:'2026-12-31T15:59:59Z'})
  const sibling=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'context',text:'我学习电气相关专业。'})
  const text='更正本周的时间：现在只剩三十分钟用于方向探索，之前说本周两小时已不适用。其他周的时间仍未确认。请只更新这项时间理解，保留其他事实，不创建任务。'
  const run=(await store.startRun(user,chat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]}
  const result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
  await store.finishRun(run,staged,result.text,result.usage,signal)
  const items=await growthContext(user,next),active=items.filter(i=>i.status==='active'&&!i.unavailableReason)
  assert.ok(active.some(i=>i.text.includes('三十分钟用于方向探索')))
  assert.ok(!active.some(i=>i.text.includes('方向探索两小时')),'old amount cannot remain active after an acknowledged correction')
  assert.ok(active.some(i=>i.text.includes('其他周可用时间还未确认')),'unmodified source clause survives')
  assert.ok(active.some(i=>i.id===sibling.id&&i.revision===sibling.revision&&i.text===sibling.text))
  assert.ok(staged.growth?.prepared.some(i=>i.kind==='split_amend'))
  assert.ok(calls<=1,'no model retry')
  assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1 AND kind=\'plan\'',[user])).rows[0].n,0)
 }finally{model.baseUrl=old.url;config.apiKey=old.key;fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()));await localEmbedding.close();await pool.end()}
})
