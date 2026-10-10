import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync,appendFileSync} from 'node:fs'
import {fixture} from '../workflows/fixtures.ts'
import {reviewAction,resolveActionCase,type ActionCase} from '../../server/workflows/action-review.ts'
import {createActionWorkflow} from '../../server/workflows/action-workflow.ts'
import {readActionEnvelope} from '../../server/workflows/adapters.ts'
import {WorkflowError,type EvidenceRef,type WorkflowRequest} from '../../server/workflows/contracts.ts'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {createApp} from '../../server/http.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {stageCoachEvent} from '../../server/action-coach-events.ts'
import {suggestedGuideUsage,classifyGuideFeedback,readGuideUsage} from '../../server/guide-usage.ts'
import * as store from '../../server/store.ts'
import type {KnowledgeCard} from '../../server/campus-knowledge.ts'
const tracePath=(process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/agent-workflows/evidence')+'/WORKFLOW_EXECUTION_TRACES.jsonl'
after(async()=>{await pool.end()})
function actionFixture(text:string){
 const f=fixture();f.request.mode='action_review';f.request.consent.continueReview=true;f.request.consent.deepAnalysis=false
 const current=f.request.authorizedEvidenceRefs[1];current.quote=text;f.request.currentIntent=text;f.records[1].text=text
 const actionCase:ActionCase={eventId:f.request.eventId!,revision:1,object:'学长甲',request:'项目课选课问题',known:{sent:false,read:false,replied:false,used:false,effect:null},usage:[],answeredQuestions:[]}
 return {...f,current,actionCase}
}
test('G2 suggested != accepted != executed; copied, quoted, conditional and third-party excluded',()=>{
 for(const text of ['如果我发了没回复怎么办？','同学说他发了没人回。','“我发了”这句话是什么意思？','我复制了草稿。','我打算发给他。']){
  const f=actionFixture(text),r=reviewAction(f.request,f.actionCase,f.current);assert.equal(r.feedback,null,text);assert.equal(r.stages.sent,false,text)
 }
 const accepted=actionFixture('我愿意试这个方法。'),r=reviewAction(accepted.request,accepted.actionCase,accepted.current);assert.equal(r.feedback,'accepted');assert.equal(r.stages.sent,false)
})
test('G2 sent/read/replied/used/effect are independent, no reply is not rejection',()=>{
 const f=actionFixture('我已经发了消息，三天还没有回复。'),r=reviewAction(f.request,f.actionCase,f.current)
 assert.equal(r.feedback,'waiting_result');assert.equal(r.stages.sent,true);assert.equal(r.stages.read,false);assert.equal(r.stages.replied,false);assert.equal(r.stages.used,false);assert.equal(r.stages.effect,null)
 assert.ok(r.reply.includes('原因仍未知'));assert.equal(r.proposal.nextActions[0].estimatedMinutes,5)
 const g=actionFixture('我收到回复了。'),rr=reviewAction(g.request,g.actionCase,g.current);assert.equal(rr.stages.replied,true);assert.equal(rr.stages.used,false);assert.notEqual(rr.feedback,'completed')
})
test('G2 explicit stop suppresses suggestions, later continuation needs new consent',()=>{
 const f=actionFixture('我不想继续了。'),r=reviewAction(f.request,f.actionCase,f.current);assert.equal(r.feedback,'declined');assert.deepEqual(r.proposal.nextActions,[])
 f.actionCase.usage=[{status:'declined',source:f.current}];f.current.quote='我还在等回复。';const stopped=reviewAction(f.request,f.actionCase,f.current);assert.deepEqual(stopped.proposal.nextActions,[])
 f.actionCase.usage.push({status:'attempted',source:f.current});const stillStopped=reviewAction(f.request,f.actionCase,f.current);assert.deepEqual(stillStopped.proposal.nextActions,[],'a later execution report does not silently remove prior refusal')
})
test('G2 similar event titles never resolve ambiguous identity and no repeated answered question',()=>{
 const f=actionFixture('我卡住了。'),other={...f.actionCase,eventId:randomUUID()}
 f.request.authorizedEvidenceRefs.push({type:'event',id:other.eventId,revision:1});delete f.request.eventId
 assert.throws(()=>resolveActionCase(f.request,[f.actionCase,other]),(e:unknown)=>e instanceof WorkflowError&&e.code==='ambiguous_event')
 f.request.eventId=f.actionCase.eventId;f.actionCase.answeredQuestions=['消息已经发出了吗？'];const r=reviewAction(f.request,f.actionCase,f.current);assert.notEqual(r.reply,'消息已经发出了吗？')
})
test('G2 asynchronous caller mutations cannot change the authorized action or feedback snapshot',async()=>{
 const previousFlag=process.env.LIFEOS_ADVANCED_WORKFLOWS;process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
 try{
  const f=actionFixture('我已经发了消息，三天还没有回复。')
  let release!:()=>void,entered!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{entered=resolve})
  const wf=createActionWorkflow(async()=>{entered();await gate;return structuredClone(f.records)})
  const pending=wf.run(f.request,[f.actionCase],f.current)
  await started
  f.actionCase.object='不同的对象';f.actionCase.revision=9;f.current.quote='我做完了。'
  release()
  const output=await pending
  assert.equal(output.receipt.status,'proposed');assert.equal(output.review?.feedback,'waiting_result');assert.ok(output.review?.reply.includes('学长甲'))
 }finally{if(previousFlag===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=previousFlag}
})

test('G2 actual host transaction: contact → no reply → refusal across 3 owned sessions, repeat reads and two-event isolation',async()=>{
 process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
 const read=(file:string)=>readFileSync('.planning/research/evergreen/'+file,'utf8').trim().split('\n').map(x=>JSON.parse(x))
 const cards=read('KB_GUIDES.jsonl') as KnowledgeCard[];await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
 const card=cards.find(c=>c.guide?.canonicalKey==='user-interview')!,server=createApp()
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port
 let user=''
 try{
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({email:'workflow-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID(),name:'Synthetic adult'})});assert.equal(signup.status,200)
  const cookie=signup.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');user=(await (await fetch(origin+'/api/session',{headers:{Cookie:cookie}})).json()).id
  const chats=[randomUUID(),randomUUID(),randomUUID()];for(const id of chats)await store.createConversation(user,{id,title:'SYNTHETIC workflow session'})
  await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1) ON CONFLICT(user_id) DO UPDATE SET enabled=true,revision=user_memory_settings.revision+1',[user])
  const text='我愿意试这个方法，向学长甲询问项目课。',run=(await store.startRun(user,chats[0],randomUUID(),text)).run
  const coach=await stageCoachEvent(run,{target:{operation:'create',title:'学长甲的项目课问题',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},'你接受了这个方法；消息是否发出仍未知。')
  const suggestion=suggestedGuideUsage(card,coach.eventId)!,accepted={...suggestion,status:'accepted' as const,sourceMessageId:run.source_message_id,sourceQuote:text}
  const first=await store.finishRun(run,{candidates:[],audit:[],coach,guideUsage:[accepted]},coach.reply,null,new AbortController().signal)
  assert.equal(first.stateChange.guideUsage.items[0].status,'accepted')
  // A similar second event is saved separately; it must not receive the first event's progress.
  const secondText='我想向学长乙问另一门项目课。',otherRun=(await store.startRun(user,chats[0],randomUUID(),secondText)).run
  const secondCoach=await stageCoachEvent(otherRun,{target:{operation:'create',title:'学长乙的项目课问题',source:{messageId:otherRun.source_message_id,quote:secondText}}},'这是另一件事。')
  await store.finishRun(otherRun,{candidates:[],audit:[],coach:secondCoach,guideUsage:[{...suggestion,eventId:secondCoach.eventId}]},secondCoach.reply,null,new AbortController().signal)
  const statuses=['accepted']
  for(const [index,feedback] of [[1,'我已经发了消息，三天还没有回复。'],[2,'我不想继续了。']] as const){
   const currentRun=(await store.startRun(user,chats[index],randomUUID(),feedback)).run,current:EvidenceRef={type:'message',id:currentRun.source_message_id,revision:1,quote:feedback}
   // Resolve event A explicitly; a newer, similar event B cannot hijack this feedback.
   const f=fixture(),request:WorkflowRequest={...f.request,requestId:currentRun.request_id,traceId:randomUUID(),internalActorKey:user,conversationId:chats[index],eventId:coach.eventId,mode:'action_review',currentIntent:feedback,consent:{continueReview:true,deepAnalysis:false},budget:null,directions:[],authorizedEvidenceRefs:[{type:'event',id:coach.eventId,revision:first.event!.revision},current],modelBudget:{maxProviderCalls:0,maxCostCny:0,deadlineMs:5000}}
   const envelope=await readActionEnvelope(request)
   request.authorizedEvidenceRefs[0].revision=envelope.event.revision
   const wf=createActionWorkflow(async r=>(await readActionEnvelope(r)).records,row=>appendFileSync(tracePath,JSON.stringify(row)+'\n'))
   const reviewed=await wf.run(request,[envelope.actionCase],current)
   assert.equal(reviewed.receipt.status,'proposed');assert.equal(reviewed.receipt.providerCalls,0);assert.ok(reviewed.review)
   const review=reviewed.review!,status=review.feedback!;assert.equal(status,index===1?'waiting_result':'declined');assert.equal(classifyGuideFeedback(feedback),status)
   if(index===1)assert.ok(review.reply.includes('原因仍未知'));else assert.deepEqual(review.proposal.nextActions,[])
   const delta=await stageCoachEvent(currentRun,{target:{operation:'continue',eventId:coach.eventId,expectedRevision:envelope.event.revision},nodes:[{kind:'fact',source:{messageId:currentRun.source_message_id,quote:feedback}}]},review.reply)
   const saved=await store.finishRun(currentRun,{candidates:[],audit:[],coach:delta,guideUsage:[{...suggestion,status,sourceMessageId:current.id,sourceQuote:feedback}]},review.reply,null,new AbortController().signal)
   assert.equal(saved.stateChange.guideUsage.items[0].status,status);statuses.push(status)
   for(let n=0;n<2;n++){const readback=await readGuideUsage(user,chats[index],coach.eventId);assert.equal(readback[0].status,status)}
   assert.equal((await readGuideUsage(user,chats[index],secondCoach.eventId))[0].status,'suggested')
   first.event=saved.event
  }
  assert.deepEqual(statuses,['accepted','waiting_result','declined'])
  const eventA=await pool.query('SELECT revision FROM coach_events WHERE user_id=$1 AND id=$2',[user,coach.eventId]);assert.equal(eventA.rows[0].revision,3)
  await pool.query('UPDATE user_memory_settings SET enabled=false WHERE user_id=$1',[user])
  await assert.rejects(()=>readGuideUsage(user,chats[2],coach.eventId),/MEMORY_DISABLED/)
  await pool.query('UPDATE user_memory_settings SET enabled=true WHERE user_id=$1',[user])
  await assert.rejects(()=>readGuideUsage('another-account',chats[2],coach.eventId),/NOT_FOUND/)
  await pool.query("UPDATE kb_sources SET status='retired' WHERE source_id=$1",[card.guide!.sourceGroups[0]]);assert.deepEqual(await readGuideUsage(user,chats[2],coach.eventId),[])
  appendFileSync((process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/agent-workflows/evidence')+'/G2_CONTINUOUS_CHAIN.jsonl',JSON.stringify({evidence:'REAL_ISOLATED_POSTGRESQL_SYNTHETIC_ADULT_NO_PROVIDER',sessions:3,statuses,twoEventIsolation:true,repeatReads:true,memoryOffDenied:true,crossAccountDenied:true,sourceWithdrawalHidesUsage:true,paidCalls:0,normalMainEntry:'NOT_INTEGRATED'})+'\n')
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));if(user)await pool.query('DELETE FROM "user" WHERE id=$1',[user]);delete process.env.LIFEOS_ADVANCED_WORKFLOWS}
})
