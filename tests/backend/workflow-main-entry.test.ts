import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {readFileSync,appendFileSync} from 'node:fs'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {model} from '../../server/model.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {stageCoachEvent} from '../../server/action-coach-events.ts'
import {readGuideUsage,suggestedGuideUsage} from '../../server/guide-usage.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {indexCoachEventOnce} from '../../server/coach-retrieval.ts'
import * as store from '../../server/store.ts'
import type {KnowledgeCard} from '../../server/campus-knowledge.ts'
test('G2 main Agent automatic candidate + native SDK + 3-session host commits; ordinary chat unchanged (simulated provider)',async()=>{
 const oldURL=model.baseUrl,oldKey=config.apiKey,user='workflow-main-'+randomUUID(),previousFlag=process.env.LIFEOS_ADVANCED_WORKFLOWS
 const requests:any[]=[],receipts:any[]=[],audits:any[][]=[]
 let targetId='',targetRevision=1
 const fake=createServer((req,res)=>{
  const chunks:Buffer[]=[];req.on('data',chunk=>chunks.push(Buffer.from(chunk)));req.on('end',()=>{
   const request=JSON.parse(Buffer.concat(chunks).toString('utf8'));requests.push(request)
   const ctx=JSON.parse(request.messages[1].content),current=ctx.currentUserMessage,text=request.messages.at(-1).content
   if(typeof text!=='string'){res.writeHead(500);res.end();return}
   const isOrdinary=text==='今天食堂有什么清淡的吃法？'
   const reply=isOrdinary?'可以选清淡搭配，按你自己的口味来。':text.includes('不想继续')?'好，先停下。':text.includes('还没有回复')?'现在只知道消息发出后还没回复，原因仍未知；你可以给等待设个停止时间。':'你愿意试这个方法；实际是否发出还未知。'
   const output={reply,...(!isOrdinary?{event:{target:{operation:'continue',eventId:targetId,expectedRevision:targetRevision},nodes:[{kind:'fact',source:{messageId:current.id,quote:text}}]}}:{})}
   res.writeHead(200,{'Content-Type':'text/event-stream'})
   const base={id:'synthetic-main-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id}
   res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\n')
   res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
  })
 })
 await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-loopback-only-key'
 try{
  await localEmbedding.start()
  const read=(file:string)=>readFileSync('.planning/research/evergreen/'+file,'utf8').trim().split('\n').map(x=>JSON.parse(x)),cards=read('KB_GUIDES.jsonl') as KnowledgeCard[]
  await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  const chats=[randomUUID(),randomUUID(),randomUUID()];for(const id of chats)await store.createConversation(user,{id,title:'SYNTHETIC main entry'})
  await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1) ON CONFLICT(user_id) DO UPDATE SET enabled=true,revision=user_memory_settings.revision+1',[user])
  const text='我想向学长甲询问项目课对实习的帮助。',seed=(await store.startRun(user,chats[0],randomUUID(),text)).run
  const event=await stageCoachEvent(seed,{target:{operation:'create',title:'联系学长甲请教项目课',source:{messageId:seed.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:seed.source_message_id,quote:text}}]},'可以先确认一个具体问题。')
  const card=cards.find(x=>x.guide?.canonicalKey==='user-interview')!,usage=suggestedGuideUsage(card,event.eventId)!
  const initial=await store.finishRun(seed,{candidates:[],audit:[],coach:event,guideUsage:[usage]},event.reply,null,new AbortController().signal);targetId=event.eventId;targetRevision=initial.event!.revision
  await indexCoachEventOnce()
  process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
  const engine=createTurnEngine({capabilityVerified:()=>true})
  const chain=['我愿意试这个方法。','按上次办法，我已经发了消息，三天还没有回复。','按上次办法，我不想继续了。']
  for(let i=0;i<3;i++){
   const run=(await store.startRun(user,chats[i],randomUUID(),chain[i])).run,staged:store.Staged={candidates:[],audit:[]},before=requests.length
   const signal=new AbortController().signal,result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}})
   assert.equal(requests.length-before,1,'one existing normal model call, zero additional model calls')
   const payload=JSON.parse(requests.at(-1).messages[1].content)
   if(i<2){assert.ok(payload.workflowHints,'automatic action-review hint on eligible feedback');assert.equal(payload.workflowHints.status,'proposed')}
   else assert.equal(payload.workflowHints,undefined,'refusal takes the existing fast path')
   const saved=await store.finishRun(run,staged,result.text,result.usage,signal);targetRevision=saved.event!.revision
   assert.equal(saved.stateChange.guideUsage.items[0]?.status,['accepted','waiting_result','declined'][i])
   assert.equal((await readGuideUsage(user,chats[i],targetId))[0].status,['accepted','waiting_result','declined'][i])
   receipts.push(saved.stateChange.guideUsage);audits.push(staged.audit)
   for(const row of staged.audit.filter((x:any)=>x.phase==='workflow_trace'))appendFileSync((process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/agent-workflows/evidence')+'/WORKFLOW_EXECUTION_TRACES.jsonl',JSON.stringify(row)+'\n')
   await indexCoachEventOnce()
  }
  for(const flag of ['false','true']){
   process.env.LIFEOS_ADVANCED_WORKFLOWS=flag
   const run=(await store.startRun(user,chats[2],randomUUID(),'今天食堂有什么清淡的吃法？')).run,staged:store.Staged={candidates:[],audit:[]},before=requests.length
   const signal=new AbortController().signal,result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal,emit:()=>{}});assert.equal(requests.length-before,1)
   assert.equal(JSON.parse(requests.at(-1).messages[1].content).workflowHints,undefined);assert.ok(!staged.audit.some((x:any)=>x.phase==='workflow_trace'));await store.finishRun(run,staged,result.text,result.usage,signal)
  }
  appendFileSync((process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/agent-workflows/evidence')+'/G2_MAIN_ENTRY.jsonl',JSON.stringify({evidence:'REAL_HOST_REAL_SDK_REAL_ISOLATED_PG_SIMULATED_PROVIDER',sessions:3,normalSDKCalls:5,additionalCalls:0,actualPaidCalls:0,statuses:receipts.map(x=>x.items[0].status),automaticActionReviewTurns:2,refusalFastPath:true,ordinaryFlagOffOnCalls:[1,1],businessAcceptance:'NOT_TESTED_REAL_PROVIDER',tracesRecorded:true})+'\n')
 }finally{process.env.LIFEOS_ADVANCED_WORKFLOWS=previousFlag;if(previousFlag===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;model.baseUrl=oldURL;config.apiKey=oldKey;await localEmbedding.close();await new Promise<void>(resolve=>fake.close(()=>resolve()));await pool.query('DELETE FROM experiences WHERE user_id=$1',[user]);await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end()}
})
