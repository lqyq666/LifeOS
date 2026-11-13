import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {setMemorySettings} from '../../server/memory.ts'

test.after(async()=>{await localEmbedding.close();await pool.end()})
test('public reply-only update request commits the named existing experience, preserving other accounts and old experiences',async()=>{
 const encode=localEmbedding.encode.bind(localEmbedding),base=model.baseUrl,key=config.apiKey
 localEmbedding.encode=async(texts:string[])=>texts.map(()=>Array(512).fill(0))
 let calls=0
 const fake=createServer((req,res)=>{req.resume();req.on('end',()=>{
  calls++;const envelope={id:'synthetic-existing-supplement',object:'chat.completion.chunk',created:1,model:model.id}
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify({reply:'这些进展会更新到已有的LifeOS经历中，保留BodyMate，不创建任务。'})},finish_reason:null}]})+'\n\n')
  res.end('data: '+JSON.stringify({...envelope,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:120,completion_tokens:40,total_tokens:160,prompt_tokens_details:{cached_tokens:0}}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok))
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-existing-supplement-key'
 const actor='supplement-'+randomUUID(),other='supplement-other-'+randomUUID(),chat=randomUUID(),lifeos=randomUUID(),bodymate=randomUUID(),foreign=randomUUID()
 const beforeContent={title:'LifeOS：从大学迷茫到AI成长伙伴',action:'本人确定产品方向；工程由Codex代执行。',result:'已部署到公网。',reflection:'帮助学生。',occurredAt:'2026-10-23'}
 try{
  for(const user of [actor,other])await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await setMemorySettings(actor,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(actor,{id:chat,title:'SYNTHETIC explicit supplement'})
  const foreignChat=randomUUID();await store.createConversation(other,{id:foreignChat,title:'SYNTHETIC other account'})
  const seed=async(id:string,user:string,content:unknown)=>{
   const prior=(await store.startRun(user,user===actor?chat:foreignChat,randomUUID(),'既有产品实践')).run
   await store.finishRun(prior,{candidates:[],audit:[]},'已保留。',{},AbortSignal.timeout(20000))
   return pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,request_id,source_quote,content,status,revision,confirmed_at,confirm_source) VALUES($1,$2,$3,$4,$5,'既有产品实践',$6,'confirmed',3,now(),'manual')",[id,user,prior.conversation_id,prior.source_message_id,prior.request_id,content])
  }
  await seed(lifeos,actor,beforeContent);await seed(bodymate,actor,{title:'BodyMate',result:'具体结果未知'});await seed(foreign,other,beforeContent)
  await seed(randomUUID(),actor,{title:'我已经把自己的完整个人画像提供给你，用来补齐LifeOS演示账号',result:'仅为画像，不能作为产品经历的目标'})
  const facts='我本人已提供个人画像，要求继续对话测试并保留账号数据；本轮测试和工程操作由Codex代执行。演示视频还没有录制完成，真实学生使用效果和收入仍未知。'
  const text='补充这次LifeOS演示准备的准确进展：'+facts+'请把这些进展更新到已有的LifeOS经历中，保留BodyMate和其他旧经历，不要创建任务，也不要把代执行记成我的个人技术成果。'
  const run=(await store.startRun(actor,chat,randomUUID(),text)).run
  const staged:store.Staged={candidates:[],audit:[]},signal=AbortSignal.timeout(20000)
  const result=await createTurnEngine({capabilityVerified:()=>true})({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
  const receipt=await store.finishRun(run,staged,result.text,result.usage,signal)
  const rows=(await pool.query('SELECT id,content,revision FROM experiences WHERE id=ANY($1::uuid[])',[[lifeos,bodymate,foreign]])).rows
  const updated=rows.find(r=>r.id===lifeos)!
  assert.equal(updated.revision,4,'actual existing revision must advance, not merely promise a write')
  assert.equal(updated.content.result,beforeContent.result+'\n'+facts)
  assert.equal(updated.content.action,beforeContent.action)
  assert.equal(rows.find(r=>r.id===bodymate)!.revision,3)
  assert.equal(rows.find(r=>r.id===foreign)!.revision,3)
  assert.equal((await pool.query('SELECT count(*) FROM experiences WHERE user_id=$1',[actor])).rows[0].count,'3')
  assert.equal(calls,1,'no paid repair or retry is needed')
  assert.ok(JSON.stringify(receipt).includes(lifeos))
  assert.equal(staged.weeklyPlan,undefined)
  const revision=(await pool.query('SELECT snapshot FROM experience_revisions WHERE user_id=$1 AND experience_id=$2 AND revision=4',[actor,lifeos])).rows[0]
  assert.equal(revision.snapshot.quote,facts,'the revision must retain the exact user words, including delegated work and unknown results')
  const graph=JSON.stringify(await store.cognitionGraph(actor))
  assert.ok(graph.includes(lifeos)&&graph.includes('Codex代执行'),'the saved supplement must reach the actual star-map projection')
  await setMemorySettings(actor,{requestId:randomUUID(),enabled:false,expectedRevision:1})
  const paused=(await store.startRun(actor,chat,randomUUID(),text)).run,pausedStaged:store.Staged={candidates:[],audit:[]}
  const pausedResult=await createTurnEngine({capabilityVerified:()=>true})({run:paused,staged:pausedStaged,context:await store.contextForRun(paused),decision:null,signal,emit:()=>{}})
  await store.finishRun(paused,pausedStaged,pausedResult.text,pausedResult.usage,signal)
  assert.equal((await pool.query('SELECT revision FROM experiences WHERE id=$1',[lifeos])).rows[0].revision,4,'disabled memory must prevent an explicit supplement write')
 }finally{model.baseUrl=base;config.apiKey=key;localEmbedding.encode=encode;await new Promise<void>(ok=>fake.close(()=>ok()))}
})
