import test from 'node:test'
import assert from 'node:assert/strict'
import {classifyGuideFeedback} from '../../server/guide-usage.ts'
import {pool} from '../../server/db.ts'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {config} from '../../server/config.ts'
import {model} from '../../server/model.ts'
import {createApp} from '../../server/http.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {stageCoachEvent} from '../../server/action-coach-events.ts'
import {suggestedGuideUsage} from '../../server/guide-usage.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {indexCoachEventOnce} from '../../server/coach-retrieval.ts'
import * as store from '../../server/store.ts'
test.after(()=>pool.end())
test('feedback preserves waiting versus blocking, negative progress, and source ownership',()=>{
 assert.equal(classifyGuideFeedback('我已经发了消息，对方没有回复。'),'waiting_result')
 assert.equal(classifyGuideFeedback('我没有开始上次课程复习，材料打不开。'),'blocked')
 assert.equal(classifyGuideFeedback('我已经尝试课程复习，但第一题卡住了。'),'blocked')
 assert.equal(classifyGuideFeedback('我交付了文件，能不能算完成了？'),'attempted')
 assert.equal(classifyGuideFeedback('同学已经尝试了，但卡住了。'),null)
 assert.equal(classifyGuideFeedback('“我已经发了，没回复”是模板。'),null)
 assert.equal(classifyGuideFeedback('我已经发了消息，对方还没回复，我不想继续了。'),'declined')
})

test('normal authenticated HTTP reuses the approved branch across three sessions, records blockage and respects refusal without a new tutorial',async()=>{
 const old={url:model.baseUrl,key:config.apiKey,origin:config.origin,flag:process.env.LIFEOS_ADVANCED_WORKFLOWS,access:config.entitlementsEnabled}
 const wire:any[]=[],saved:any[]=[];let event:any,expected=''
 const fake=createServer((req,res)=>{const parts:Buffer[]=[];req.on('data',x=>parts.push(Buffer.from(x)));req.on('end',()=>{
  const payload=JSON.parse(Buffer.concat(parts).toString()),ctx=JSON.parse(payload.messages[1].content),text=payload.messages.at(-1).content
  wire.push({text,context:ctx,evidence:'SCRIPTED_LOOPBACK_NO_REAL_MODEL'})
  const output={reply:expected,event:{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:ctx.currentUserMessage.id,quote:text}}]}}
  const base={id:'SCRIPTED_GUIDE_'+wire.length,object:'chat.completion.chunk',created:1,model:model.id}
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:300,completion_tokens:100,total_tokens:400}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));model.baseUrl='http://127.0.0.1:'+(fake.address() as any).port;config.apiKey='synthetic-loopback-only';config.entitlementsEnabled=false;process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
 const app=createApp(createTurnEngine({capabilityVerified:()=>true}));await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));config.origin='http://127.0.0.1:'+(app.address() as any).port
 let cookie=''
 const req=(path:string,data?:unknown)=>fetch(config.origin+path,{method:data===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:config.origin,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})})
 const json=async(path:string,data?:unknown)=>{const res=await req(path,data),body=await res.json();assert.ok(res.ok,JSON.stringify({path,status:res.status,body}));return body}
 try{
  await localEmbedding.start()
  const read=(n:string)=>readFileSync('.planning/research/evergreen/'+n,'utf8').trim().split('\n').map(x=>JSON.parse(x)),cards=read('KB_GUIDES.jsonl')
  await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
  const signup=await req('/api/auth/sign-up/email',{email:'continuity-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID(),name:'Synthetic adult'});assert.equal(signup.status,200)
  cookie=signup.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');const user=(await json('/api/session')).id
  await json('/api/memory/settings',{requestId:randomUUID(),enabled:true,expectedRevision:0})
  const chats=[randomUUID(),randomUUID(),randomUUID()];for(const id of chats)await json('/api/conversations',{id,title:'SYNTHETIC blocked course'})
  const card=cards.find((c:any)=>c.guide.canonicalKey==='priority-budget'),branch=card.guide.branches.at(-1),text='我想平衡课程复习与备考，本周时间有限。'
  const seed=(await store.startRun(user,chats[0],randomUUID(),text)).run
  const coach=await stageCoachEvent(seed,{target:{operation:'create',title:'课程复习与备考',source:{messageId:seed.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:seed.source_message_id,quote:text}}]},'按当前任务考虑时间。')
  event=(await store.finishRun(seed,{candidates:[],audit:[],coach,guideUsage:[suggestedGuideUsage(card,coach.eventId,branch.id)!]},'按当前任务考虑时间。',null,new AbortController().signal)).event
  await indexCoachEventOnce()
  const rounds=[['我愿意试这个方法。','保存选择，尚未开始。','accepted'],['按上次办法，我没有开始课程复习，材料打不开，怎么办？','先核对可访问的材料，尚未开始；不增加练习量。','blocked'],['按上次办法，我不想继续了。','这件事先停下，不再安排练习。','declined']]
  for(const [i,round] of rounds.entries()){
   expected=round[1];const id=randomUUID(),before=wire.length,res=await req('/api/conversations/'+chats[i]+'/messages',{requestId:id,text:round[0]});assert.equal(res.status,200)
   const frames=(await res.text()).split('\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6))),done=frames.find(x=>x.type==='done');assert.ok(done,JSON.stringify(frames))
   assert.equal(wire.length-before,1);event=done.event
   const readback=await json('/api/runs/'+id),usage=await json('/api/conversations/'+chats[i]+'/guide-usage?event='+event.id)
   assert.equal(readback.status,'completed');assert.equal(usage.items[0].status,round[2]);assert.equal(usage.items[0].branch,branch.id)
   if(i===1){
    const ctx=wire.at(-1).context,method=ctx.knowledge.find((x:any)=>x.id===card.id)
    assert.ok(ctx.lastActionGuideUsage.length);assert.equal(method.branch,branch.id);assert.equal(method.continuation.status,'blocked');assert.equal(method.feedback,card.guide.feedbackBranches.blocked);assert.equal(method.steps,undefined)
    assert.ok(!ctx.knowledge.some((x:any)=>x.id!==card.id),'blocked review must not jump to an unrelated first tutorial')
   }
   if(i===2)assert.equal(wire.at(-1).context.knowledge.length,0)
   saved.push({session:i+1,status:round[2],run:readback.response,usage});await indexCoachEventOnce()
  }
  const e=process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/workflow-integration/evidence/acceptance-20261010'
  writeFileSync(e+'/GUIDE_CONTINUATION_HTTP.json',JSON.stringify({evidence:'REAL_AUTH_HTTP_PG_NATIVE_SDK_SCRIPTED_PROVIDER',sessions:3,paidCalls:0,cloudCalls:0,wire,saved},null,2))
 }finally{
  app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()));await localEmbedding.close();model.baseUrl=old.url;config.apiKey=old.key;config.origin=old.origin;config.entitlementsEnabled=old.access;if(old.flag===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=old.flag
 }
})
