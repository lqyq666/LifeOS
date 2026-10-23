import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {stageGrowthUpdates,growthContext,growthView} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

const observation='回来反馈：我把奖学金材料按三条规则整理了一次，第二天大约20秒找到通知，但目前只发生过一次。不要把一次成功当成职业适合。'
const pause='我今天没精力继续验证，先暂停这个方向，不要再安排动作。只给一句阶段理解，等我以后主动回来再继续。'
test.after(async()=>{await localEmbedding.close();await pool.end()})
test('a pause preview uses available prior sources without announcing the uncommitted control',async()=>{
 const previous={url:model.baseUrl,key:config.apiKey,budget:config.providerBudgetEnabled,encode:localEmbedding.encode}
 localEmbedding.encode=async texts=>texts.map(()=>Array(512).fill(0));config.providerBudgetEnabled=false
 let calls=0
 const fake=createServer((req,res)=>{req.on('data',()=>{});req.on('end',()=>{
  calls++
  const raw=JSON.stringify({reply:'阶段理解：这次记录是一个有限的个例，尚不能判断职业适合，先停在这里。'})
  const envelope={id:'synthetic-timed-preview',object:'chat.completion.chunk',created:1,model:model.id}
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  setTimeout(()=>res.end('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{content:raw},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n'),100)
 })})
 await new Promise<void>(done=>fake.listen(0,'127.0.0.1',done))
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-timed-preview'
 try{
  for(const mode of ['active','stale','partial','disabled']){
   const user='timed-preview-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
   await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
   await store.createConversation(user,{id:chat,title:'SYNTHETIC source-authorized preview'})
   await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
   const seed=(await store.startRun(user,chat,randomUUID(),observation)).run
   const growth=await stageGrowthUpdates(seed,[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{messageId:seed.source_message_id,quote:mode==='partial'?'第二天大约20秒找到通知':observation.slice(0,-1)}}] as any,[])
   await store.finishRun(seed,{candidates:[],audit:[],growth},'这是一条有限样本记录。',null,signal)
   if(mode==='stale')await pool.query("UPDATE growth_items SET status='stale' WHERE user_id=$1",[user])
   if(mode==='disabled')await setMemorySettings(user,{requestId:randomUUID(),enabled:false,expectedRevision:1})
   const run=(await store.startRun(user,chat,randomUUID(),pause)).run
   const staged:store.Staged={candidates:[],audit:[]},frames:any[]=[],before=calls
   const result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:frame=>{
    frames.push(frame)
    if(frame.type==='draft'){
     assert.equal(calls,before,'verified preview precedes even the provider request')
     assert.equal(typeof frame.text,'string')
     assert.doesNotMatch(String(frame.text),/已暂停|已保存|已停止/)
    }
   }})
   const verified=frames.filter(frame=>frame.type==='draft'&&frame.verifiedFeedback)
   // Memory OFF permits the current conversation; only cross-session reuse
   // is disabled by the existing product contract.
   assert.equal(verified.length,mode==='active'||mode==='disabled'?1:0,mode)
   if(verified.length)assert.match(verified[0].text,/20秒.*不能证明稳定效果或职业适合/)
   assert.equal(calls,before+1,'normal provider call remains; no retry')
   await store.finishRun(run,staged,result.text,result.usage,signal)
   if(mode!=='disabled')assert.ok((await growthView(user,chat)).items.some(item=>item.taskBoundary?.kind==='pause'))
   assert.equal((await growthContext(user,chat)).some(item=>item.text.includes('职业适合')&&item.kind==='ability'),false)
  }
 }finally{
  fake.closeAllConnections();await new Promise<void>(done=>fake.close(()=>done()))
  model.baseUrl=previous.url;config.apiKey=previous.key;config.providerBudgetEnabled=previous.budget;localEmbedding.encode=previous.encode
 }
})
