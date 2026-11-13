import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync,appendFileSync} from 'node:fs'
import type {PoolClient} from 'pg'
import {fixture} from '../workflows/fixtures.ts'
import {reviewAction,resolveActionCase,type ActionCase} from '../../server/workflows/action-review.ts'
import {createActionWorkflow} from '../../server/workflows/action-workflow.ts'
import {readActionEnvelope} from '../../server/workflows/adapters.ts'
import {WorkflowError,type EvidenceRef,type WorkflowRequest} from '../../server/workflows/contracts.ts'
import {pool,transaction} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {createApp} from '../../server/http.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {stageCoachEvent,coachEventView,deliverableIntent,invalidateCoachSourceQuotes} from '../../server/action-coach-events.ts'
import {suggestedGuideUsage,classifyGuideFeedback,guideFeedbackSource,readGuideUsage} from '../../server/guide-usage.ts'
import * as store from '../../server/store.ts'
import type {KnowledgeCard} from '../../server/campus-knowledge.ts'
import {setMemorySettings,applyMemoryAction} from '../../server/memory.ts'
import {buildClauseCatalogue,clauseMessageSource} from '../../server/clause-catalogue.ts'
import {campusView} from '../../server/campus.ts'
import {messageSourceMatches} from '../../server/growth-privacy.ts'
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
  assert.ok(wf.trace.rows.some(row=>row.skill==='lifeos-action-review'&&row.skillPhase==='output_validated'&&row.usedEvidenceIds.includes(f.current.id)))
  assert.equal(output.receipt.status,'proposed');assert.equal(output.review?.feedback,'waiting_result');assert.ok(output.review?.reply.includes('学长甲'))
 }finally{if(previousFlag===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=previousFlag}
})

test('G2 actual host transaction: contact → no reply → refusal across 3 owned sessions, repeat reads and two-event isolation',async()=>{
 process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
 const read=(file:string)=>readFileSync('.planning/research/evergreen/'+file,'utf8').trim().split('\n').map(x=>JSON.parse(x))
 const cards=read('KB_GUIDES.jsonl') as KnowledgeCard[];await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
 const card=cards.find(c=>c.guide?.canonicalKey==='user-interview')!,server=createApp()
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port
 let user='',withdrawnSource:{source_id:string;status:string}|undefined
 try{
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({email:'workflow-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID(),name:'Synthetic adult'})});assert.equal(signup.status,200)
  const cookie=signup.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');user=(await (await fetch(origin+'/api/session',{headers:{Cookie:cookie}})).json()).id
  const chats=[randomUUID(),randomUUID(),randomUUID()];for(const id of chats)await store.createConversation(user,{id,title:'SYNTHETIC workflow session'})
  await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1) ON CONFLICT(user_id) DO UPDATE SET enabled=true,revision=user_memory_settings.revision+1',[user])
  const text='我愿意试这个方法，向学长甲询问项目课。',run=(await store.startRun(user,chats[0],randomUUID(),text)).run
  const coach=await stageCoachEvent(run,{target:{operation:'create',title:'学长甲的项目课问题',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},'你接受了这个方法；消息是否发出仍未知。')
  const suggestion=suggestedGuideUsage(card,coach.eventId)!,acceptedSource=guideFeedbackSource(text,'accepted',{title:'学长甲的项目课问题',task:card.guide!.branches.find(branch=>branch.id===suggestion.branch)!.task})!,accepted={...suggestion,status:'accepted' as const,sourceMessageId:run.source_message_id,sourceQuote:acceptedSource.quote,sourceRange:acceptedSource.range}
  const first=await store.finishRun(run,{candidates:[],audit:[],coach,guideUsage:[accepted]},coach.reply,null,new AbortController().signal)
  assert.equal(first.stateChange.guideUsage.items[0].status,'accepted')
  // A similar second event is saved separately; it must not receive the first event's progress.
  const secondText='我想向学长乙问另一门项目课。',otherRun=(await store.startRun(user,chats[0],randomUUID(),secondText)).run
  const secondCoach=await stageCoachEvent(otherRun,{target:{operation:'create',title:'学长乙的项目课问题',source:{messageId:otherRun.source_message_id,quote:secondText}}},'这是另一件事。')
  await store.finishRun(otherRun,{candidates:[],audit:[],coach:secondCoach,guideUsage:[{...suggestion,eventId:secondCoach.eventId}]},secondCoach.reply,null,new AbortController().signal)
  const invalidLegacyId=randomUUID()
  await pool.query('INSERT INTO kb_guide_usage(id,user_id,event_id,guide_id,revision,branch,step_id,status,source_message_id,source_quote,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[invalidLegacyId,user,secondCoach.eventId,suggestion.guideId,suggestion.revision,suggestion.branch,suggestion.stepId,'blocked',otherRun.source_message_id,'还是卡住了',randomUUID()])
  assert.ok(!(await readGuideUsage(user,chats[0],secondCoach.eventId)).some(row=>row.id===invalidLegacyId),'legacy guide usage whose quote is absent from its source fails closed')
  const forgedText='还是卡住了；已经完成了',forgedRun=(await store.startRun(user,chats[0],randomUUID(),forgedText)).run
  await store.finishRun(forgedRun,{candidates:[],audit:[]},'已记录。',null,new AbortController().signal)
  const forgedLegacyId=randomUUID(),forgedStart=forgedText.indexOf('已经完成了')
  await pool.query('INSERT INTO kb_guide_usage(id,user_id,event_id,guide_id,revision,branch,step_id,status,source_message_id,source_quote,request_id,source_start,source_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[forgedLegacyId,user,secondCoach.eventId,suggestion.guideId,suggestion.revision,suggestion.branch,suggestion.stepId,'blocked',forgedRun.source_message_id,'还是卡住了',randomUUID(),forgedStart,forgedStart+'已经完成了'.length])
  assert.ok(!(await readGuideUsage(user,chats[0],secondCoach.eventId)).some(row=>row.id===forgedLegacyId),'stored coordinates must select the exact persisted quote')
  const statuses=['accepted']
  for(const [index,feedback] of [[1,'按上次办法，我已经发了消息，三天还没有回复。'],[2,'这次行动我不想继续了。']] as const){
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
   const statusSource=guideFeedbackSource(feedback,status,{title:envelope.event.title,task:card.guide!.branches.find(branch=>branch.id===suggestion.branch)!.task})!
   const saved=await store.finishRun(currentRun,{candidates:[],audit:[],coach:delta,guideUsage:[{...suggestion,status,sourceMessageId:current.id,sourceQuote:statusSource.quote,sourceRange:statusSource.range}]},review.reply,null,new AbortController().signal)
   assert.equal(saved.stateChange.guideUsage.items[0].status,status);statuses.push(status)
   for(let n=0;n<2;n++){const readback=await readGuideUsage(user,chats[index],coach.eventId);assert.equal(readback[0].status,status)}
   assert.equal((await readGuideUsage(user,chats[index],secondCoach.eventId))[0].status,'suggested')
   first.event=saved.event
  }
  assert.deepEqual(statuses,['accepted','waiting_result','declined'])
  const eventA=await pool.query('SELECT revision FROM coach_events WHERE user_id=$1 AND id=$2',[user,coach.eventId]);assert.equal(eventA.rows[0].revision,3)
  await store.deleteConversation(user,chats[1])
  const afterDeletedFeedback=await readGuideUsage(user,chats[2],coach.eventId)
  assert.ok(!afterDeletedFeedback.some(row=>row.status==='waiting_result'),'deleting the feedback-only conversation revokes that guide update')
  assert.equal(afterDeletedFeedback[0]?.status,'declined','independently sourced later feedback remains available')
  await pool.query('UPDATE user_memory_settings SET enabled=false WHERE user_id=$1',[user])
  await assert.rejects(()=>readGuideUsage(user,chats[2],coach.eventId),/MEMORY_DISABLED/)
  await pool.query('UPDATE user_memory_settings SET enabled=true WHERE user_id=$1',[user])
  await assert.rejects(()=>readGuideUsage('another-account',chats[2],coach.eventId),/NOT_FOUND/)
  withdrawnSource=(await pool.query('SELECT source_id,status FROM kb_sources WHERE source_id=$1',[card.guide!.sourceGroups[0]])).rows[0]
  await pool.query("UPDATE kb_sources SET status='retired' WHERE source_id=$1",[card.guide!.sourceGroups[0]]);assert.deepEqual(await readGuideUsage(user,chats[2],coach.eventId),[])
  appendFileSync((process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/agent-workflows/evidence')+'/G2_CONTINUOUS_CHAIN.jsonl',JSON.stringify({evidence:'REAL_ISOLATED_POSTGRESQL_SYNTHETIC_ADULT_NO_PROVIDER',sessions:3,statuses,twoEventIsolation:true,repeatReads:true,memoryOffDenied:true,crossAccountDenied:true,sourceWithdrawalHidesUsage:true,paidCalls:0,normalMainEntry:'NOT_INTEGRATED'})+'\n')
 }finally{if(withdrawnSource)await pool.query('UPDATE kb_sources SET status=$2 WHERE source_id=$1',[withdrawnSource.source_id,withdrawnSource.status]);await new Promise<void>(resolve=>server.close(()=>resolve()));if(user)await pool.query('DELETE FROM "user" WHERE id=$1',[user]);delete process.env.LIFEOS_ADVANCED_WORKFLOWS}
})

test('workflow and historical campus reads retain a second exact occurrence when only the first is forgotten',async()=>{
 const user='workflow-ranged-source-'+randomUUID(),chat=randomUUID(),message='我联系了导师；我联系了导师',quote='我联系了导师'
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC exact workflow source'})
  const run=(await store.startRun(user,chat,randomUUID(),message)).run
  const clauses=buildClauseCatalogue(message).filter(clause=>clause.text===quote),second=clauses[1]!
  assert.ok(second)
  const boundSource=clauseMessageSource(run.source_message_id,second)
  const coach=await stageCoachEvent(run,{target:{operation:'create',title:'联系导师',source:boundSource},nodes:[{kind:'fact',source:boundSource}]},'已记录第二次联系。')
  const saved=await store.finishRun(run,{candidates:[],audit:[],coach},coach.reply,null,new AbortController().signal)
  const firstRange={start:clauses[0]!.start,end:clauses[0]!.end},secondRange={start:second.start,end:second.end},memoryId=randomUUID(),inquiryId=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(quote),JSON.stringify([{type:'message',conversationId:chat,messageId:run.source_message_id,quote,range:firstRange}])])
  await pool.query('INSERT INTO campus_inquiries(id,user_id,conversation_id,payload) VALUES($1,$2,$3,$4)',[inquiryId,user,chat,{domain:'life_goal',question:'联系导师',questionSource:{type:'message',id:run.source_message_id,quote,range:secondRange},criteria:[],readiness:'act',questions:[],studentContext:[],pathways:[],opportunities:[],evidence:[],hypotheses:[],experiments:[{id:randomUUID(),status:'reported',action:'联系导师',result:{text:quote,source:{type:'message',id:run.source_message_id,quote,range:secondRange},candidateId:null,reportedAt:new Date().toISOString()}}],changes:[]}])
  await applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})

  const base=fixture().request,request:WorkflowRequest={...base,requestId:randomUUID(),traceId:randomUUID(),internalActorKey:user,conversationId:chat,eventId:coach.eventId,currentIntent:'继续复盘',controls:{...base.controls,memoryEnabled:true},authorizedEvidenceRefs:[{type:'event',id:coach.eventId,revision:saved.event!.revision},{type:'message',id:run.source_message_id,revision:1,quote}]}
  const envelope=await readActionEnvelope(request)
  assert.ok(envelope.records.some(record=>record.ref.type==='message'&&record.ref.id===run.source_message_id&&record.text===quote),'workflow retrieval keeps the independently bound second occurrence')
  const historical=(await campusView(user,chat)).inquiries.find(inquiry=>inquiry.id===inquiryId)!
  assert.equal(historical.payload.experiments[0]!.result?.text,quote,'historical result keeps the independently bound second occurrence')
  assert.equal(historical.payload.experiments[0]!.result?.invalidated,undefined)
  assert.ok(!JSON.stringify(historical.payload).includes('"range"'),'historical API payload strips internal exact coordinates')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('workflow process evidence retains the second exact occurrence when only the first process fragment is forgotten',async()=>{
 const user='workflow-process-ranged-source-'+randomUUID(),chat=randomUUID(),processQuote='还是卡住了',factQuote='我联系了导师',message=processQuote+' '+factQuote+' '+processQuote
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC exact process source'})
  const run=(await store.startRun(user,chat,randomUUID(),message)).run,factStart=message.indexOf(factQuote),factClause={...buildClauseCatalogue(factQuote)[0]!,start:factStart,end:factStart+factQuote.length},factSource=clauseMessageSource(run.source_message_id,factClause)
  const coach=await stageCoachEvent(run,{target:{operation:'create',title:'联系导师',source:factSource},nodes:[{kind:'fact',source:factSource}]},'已记录联系；两段过程反馈仍按各自位置保存。')
  await store.finishRun(run,{candidates:[],audit:[],coach},coach.reply,null,new AbortController().signal)
  const firstRange={start:0,end:processQuote.length},memoryId=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(processQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:run.source_message_id,quote:processQuote,range:firstRange}])])
  await applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const revision=Number((await pool.query('SELECT revision FROM coach_events WHERE user_id=$1 AND id=$2',[user,coach.eventId])).rows[0].revision),base=fixture().request
  const request:WorkflowRequest={...base,requestId:randomUUID(),traceId:randomUUID(),internalActorKey:user,conversationId:chat,eventId:coach.eventId,currentIntent:'继续复盘',controls:{...base.controls,memoryEnabled:true},authorizedEvidenceRefs:[{type:'event',id:coach.eventId,revision},{type:'message',id:run.source_message_id,revision:1,quote:processQuote}]}
  const envelope=await readActionEnvelope(request),processRecords=envelope.records.filter(record=>record.ref.type==='message'&&record.ref.id===run.source_message_id&&record.text===processQuote)
  assert.equal(processRecords.length,1,'the surviving process occurrence remains authorized')
  assert.equal((envelope.event.processTurns??[]).flatMap(turn=>turn.inputSources??[]).filter(source=>source.quote===processQuote).length,1)
  assert.ok(!JSON.stringify(envelope.event).includes('"range"'),'public event sources keep their compatible range-free shape')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('workflow evidence fails closed when one range-free quote matches both a node and a different process occurrence',async()=>{
 const user='workflow-cross-kind-ambiguity-'+randomUUID(),chat=randomUUID(),processQuote='还是卡住了',factQuote='我联系了导师',message=processQuote+' '+factQuote+' '+processQuote
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC cross-kind ambiguity'})
  const run=(await store.startRun(user,chat,randomUUID(),message)).run
  const template=buildClauseCatalogue(processQuote)[0]!,firstSource=clauseMessageSource(run.source_message_id,{...template,start:0,end:processQuote.length,sentenceStart:0,sentenceEnd:message.length})
  const factStart=message.indexOf(factQuote),factSource=clauseMessageSource(run.source_message_id,{...buildClauseCatalogue(factQuote)[0]!,start:factStart,end:factStart+factQuote.length,sentenceStart:0,sentenceEnd:message.length})
  const coach=await stageCoachEvent(run,{target:{operation:'create',title:'联系导师受阻',source:factSource},nodes:[{kind:'fact',source:firstSource},{kind:'fact',source:factSource}]},'已记录联系与受阻情况。')
  const saved=await store.finishRun(run,{candidates:[],audit:[],coach},coach.reply,null,new AbortController().signal)
  const base=fixture().request,request:WorkflowRequest={...base,requestId:randomUUID(),traceId:randomUUID(),internalActorKey:user,conversationId:chat,eventId:coach.eventId,currentIntent:'继续复盘',controls:{...base.controls,memoryEnabled:true},authorizedEvidenceRefs:[{type:'event',id:coach.eventId,revision:saved.event!.revision},{type:'message',id:run.source_message_id,revision:1,quote:processQuote}]}
  await assert.rejects(readActionEnvelope(request),(error:unknown)=>error instanceof WorkflowError&&error.code==='source_invalid','a range-free ref cannot choose silently between node and process occurrences')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('workflow validates the title source selected by current event authority after correction rebinding',async()=>{
 const user='workflow-title-rebind-'+randomUUID(),chat=randomUUID(),message='原事项标题；仍在推进同一事项'
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC title source rebind'})
  const run=(await store.startRun(user,chat,randomUUID(),message)).run,clauses=buildClauseCatalogue(message),titleSource=clauseMessageSource(run.source_message_id,clauses[0]!),nodeSource=clauseMessageSource(run.source_message_id,clauses[1]!)
  const coach=await stageCoachEvent(run,{target:{operation:'create',title:'原事项标题',source:titleSource},nodes:[{kind:'fact',source:nodeSource}]},'已记录同一事项。')
  await store.finishRun(run,{candidates:[],audit:[],coach},coach.reply,null,new AbortController().signal)
  const memoryId=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(titleSource.quote),JSON.stringify([{type:'message',conversationId:chat,messageId:run.source_message_id,quote:titleSource.quote,range:{start:clauses[0]!.start,end:clauses[0]!.end}}])])
  await applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'correct',value:'更正后的事项标题'})
  const revision=Number((await pool.query('SELECT revision FROM coach_events WHERE user_id=$1 AND id=$2',[user,coach.eventId])).rows[0].revision),base=fixture().request
  const request:WorkflowRequest={...base,requestId:randomUUID(),traceId:randomUUID(),internalActorKey:user,conversationId:chat,eventId:coach.eventId,currentIntent:'继续复盘',controls:{...base.controls,memoryEnabled:true},authorizedEvidenceRefs:[{type:'event',id:coach.eventId,revision}]}
  const envelope=await readActionEnvelope(request)
  assert.equal(envelope.event.title,'部分来源已更新的事项')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('persisted coach coordinates cannot rebind to another matching occurrence',async()=>{
 const user='workflow-forged-range-'+randomUUID(),chat=randomUUID(),message='其他内容；请写预算',quote='请写预算'
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC forged coach range'})
  const run=(await store.startRun(user,chat,randomUUID(),message)).run,source=clauseMessageSource(run.source_message_id,buildClauseCatalogue(message)[1]!)
  const coach=await stageCoachEvent(run,{target:{operation:'create',title:quote,source}},'已记录。')
  await store.finishRun(run,{candidates:[],audit:[],coach},coach.reply,null,new AbortController().signal)
  await pool.query("UPDATE coach_events SET title_source=jsonb_set(title_source,'{range}',$3::jsonb) WHERE user_id=$1 AND id=$2",[user,coach.eventId,JSON.stringify({start:0,end:4})])
  const follow=(await store.startRun(user,chat,randomUUID(),'继续这个事项')).run,revision=Number((await pool.query('SELECT revision FROM coach_events WHERE user_id=$1 AND id=$2',[user,coach.eventId])).rows[0].revision)
  await assert.rejects(()=>stageCoachEvent(follow,{target:{operation:'continue',eventId:coach.eventId,expectedRevision:revision}},'继续。'),(error:any)=>error?.code==='COACH_SOURCE_REVOKED')
  await assert.rejects(()=>coachEventView(user,chat,coach.eventId),(error:any)=>error?.code==='COACH_SOURCE_REVOKED')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('range-free legacy duplicate sources fail closed instead of choosing a matter',async()=>{
 const user='workflow-legacy-duplicate-source-'+randomUUID(),chat=randomUUID(),quote='请继续',message='求职访谈，请继续；创业访谈，请继续',first=message.indexOf(quote)
 assert.equal(messageSourceMatches(message,{quote}),false,'a range-free duplicate is not one authoritative source')
 assert.equal(messageSourceMatches(message,{quote,range:{start:first,end:first+quote.length}}),true,'an exact persisted occurrence remains authoritative')
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC legacy duplicate source'})
  const run=(await store.startRun(user,chat,randomUUID(),message)).run
  await assert.rejects(()=>stageCoachEvent(run,{target:{operation:'create',title:'继续访谈',source:{messageId:run.source_message_id,quote}}},'继续。'),(error:any)=>error?.code==='COACH_SOURCE_INVALID')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('an action source cannot be rebound to an older identical message',async()=>{
 const user='workflow-action-current-source-'+randomUUID(),chat=randomUUID(),title='预算事项',quote='请写一份预算表',draft='本周预算表',signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC current action source'})
  const oldRun=(await store.startRun(user,chat,randomUUID(),quote)).run
  await store.finishRun(oldRun,{candidates:[],audit:[]},'旧请求已收到。',null,signal)
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')
  const event=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
  const currentRun=(await store.startRun(user,chat,randomUUID(),quote)).run
  try{
   await assert.rejects(()=>stageCoachEvent(currentRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:oldRun.source_message_id,quote},draft:{content:draft}}},draft),(error:any)=>error?.code==='COACH_CURRENT_SOURCE_REQUIRED')
  }finally{await store.terminateRun(user,currentRun.request_id,'cancelled','TEST_CLEANUP')}
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('commit rejects an action source forgotten after staging but before persistence',async()=>{
 const user='workflow-action-stage-forget-'+randomUUID(),chat=randomUUID(),title='提交前遗忘事项',quote='请写一份预算表',draft='预算表\n项目 | 金额\n资料 | 100',signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC stage forget action'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  const event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const actionRun=(await store.startRun(user,chat,randomUUID(),quote)).run
  const staged=await stageCoachEvent(actionRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:actionRun.source_message_id,quote},draft:{content:draft}}},draft)
  const memoryId=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(quote),JSON.stringify([{type:'message',conversationId:chat,messageId:actionRun.source_message_id,quote,range:{start:0,end:quote.length}}])])
  await applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  await assert.rejects(()=>store.finishRun(actionRun,{candidates:[],audit:[],coach:staged},draft,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_INVALID','commit revalidation must observe scoped memory controls created after staging')
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_actions WHERE user_id=$1',[user])).rows[0].n,0)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('an autobiographical fact cannot authorize an unrequested material action',async()=>{
 const user='workflow-action-request-required-'+randomUUID(),chat=randomUUID(),text='我昨天完成了报告。',signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC action request required'})
  const run=(await store.startRun(user,chat,randomUUID(),text)).run
  try{
   await assert.rejects(()=>stageCoachEvent(run,{target:{operation:'create',title:'报告进度',source:{messageId:run.source_message_id,quote:text}},action:{operation:'create',draft:{content:'一份未经请求的预算表'}}},'一份未经请求的预算表'),(error:any)=>error?.code==='COACH_ACTION_SOURCE_INVALID')
  }finally{await store.terminateRun(user,run.request_id,'cancelled','TEST_CLEANUP')}
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('exact title forget preserves its action until that exact request is corrected',async()=>{
 const user='workflow-title-action-'+randomUUID(),chat=randomUUID(),titleText='独立事项标题',actionQuote='请给我一条跟进消息',unrelatedQuote='请给我一份本周预算表',actionRequest=actionQuote+'；'+unrelatedQuote+'。',draft='请确认你是否方便继续沟通。',signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC title action preservation'})
  const opening=(await store.startRun(user,chat,randomUUID(),titleText)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title:titleText,source:{messageId:opening.source_message_id,quote:titleText}}},'已记录这个事项。')
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
  const actionRun=(await store.startRun(user,chat,randomUUID(),actionRequest)).run
  const actionDelta=await stageCoachEvent(actionRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:actionRun.source_message_id,quote:actionQuote},draft:{content:draft}}},draft)
  event=(await store.finishRun(actionRun,{candidates:[],audit:[],coach:actionDelta},draft,null,signal)).event!
  assert.equal(event.nodes.filter(node=>node.kind!=='unknown'&&node.status==='active').length,0)
  assert.equal(event.actions[0]?.status,'proposed')
  const storedActionSource=(await pool.query("SELECT snapshot->'actionSource' AS source FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND snapshot->>'actionId'=$3",[user,event.id,event.actions[0]!.id])).rows.at(-1)?.source
  assert.deepEqual(storedActionSource,{messageId:actionRun.source_message_id,conversationId:chat,quote:actionQuote,range:{start:0,end:actionQuote.length}})
  const memoryId=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(titleText),JSON.stringify([{type:'message',conversationId:chat,messageId:opening.source_message_id,quote:titleText,range:{start:0,end:titleText.length}}])])
  await applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,title FROM coach_events WHERE user_id=$1 AND id=$2',[user,event.id])).rows[0]
  const action=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND event_id=$2',[user,event.id])).rows[0]
  assert.equal(persisted.status,'active')
  assert.equal(persisted.title,'部分来源已更新的事项')
  assert.equal(action.status,'proposed')
  assert.equal(action.draft.content,draft)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_current WHERE user_id=$1 AND conversation_id=$2 AND event_id=$3',[user,chat,event.id])).rows[0].n,1)
  const readback=await coachEventView(user,chat,event.id)
  assert.equal(readback?.title,'部分来源已更新的事项')
  assert.equal(readback?.actions[0]?.status,'proposed')
  const unrelatedMemoryId=randomUUID()
  const unrelatedStart=actionRequest.indexOf(unrelatedQuote)
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','availableTime',$3,'user_reported','user',$4,now(),now(),'active')",[unrelatedMemoryId,user,JSON.stringify(unrelatedQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:actionRun.source_message_id,quote:unrelatedQuote,range:{start:unrelatedStart,end:unrelatedStart+unrelatedQuote.length}}])])
  await applyMemoryAction(user,unrelatedMemoryId,{requestId:randomUUID(),expectedRevision:1,action:'correct',value:'请给我一份下周预算表'})
  const preservedAfterUnrelatedCorrection=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND event_id=$2',[user,event.id])).rows[0]
  assert.equal(preservedAfterUnrelatedCorrection.status,'proposed','correcting an unrelated clause must preserve the exact action request')
  assert.equal(preservedAfterUnrelatedCorrection.draft.content,draft)
  const actionMemoryId=randomUUID(),actionStart=actionRequest.indexOf(actionQuote)
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[actionMemoryId,user,JSON.stringify(actionQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:actionRun.source_message_id,quote:actionQuote,range:{start:actionStart,end:actionStart+actionQuote.length}}])])
  await applyMemoryAction(user,actionMemoryId,{requestId:randomUUID(),expectedRevision:1,action:'correct',value:'请改成只提醒一次'})
  const revoked=(await pool.query('SELECT title FROM coach_events WHERE user_id=$1 AND id=$2',[user,event.id])).rows[0]
  const revokedAction=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND event_id=$2',[user,event.id])).rows[0]
  assert.equal(revoked.title,'','unrelated text in the same message cannot replace the forgotten action request')
  assert.equal(revokedAction.status,'stale')
  assert.equal(revokedAction.draft,null)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_current WHERE user_id=$1 AND conversation_id=$2 AND event_id=$3',[user,chat,event.id])).rows[0].n,0)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('an ambiguous legacy action fails closed when one possible request source changes',async()=>{
 const user='workflow-legacy-action-'+randomUUID(),chat=randomUUID(),title='旧行动事项',first='请写一份预算表',second='请写一条跟进消息',message=first+'；'+second,draft='请确认本周预算。',signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC ambiguous legacy action'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
  const actionRun=(await store.startRun(user,chat,randomUUID(),message)).run
  const action=await stageCoachEvent(actionRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:actionRun.source_message_id,quote:second},draft:{content:draft}}},draft)
  event=(await store.finishRun(actionRun,{candidates:[],audit:[],coach:action},draft,null,signal)).event!
  await pool.query("UPDATE coach_event_revisions SET snapshot=snapshot-'actionChange'-'actionId'-'actionSource'-'actionSources'-'actionFieldSources' WHERE user_id=$1 AND event_id=$2 AND snapshot->>'actionId'=$3",[user,event.id,event.actions[0]!.id])
  await pool.query('UPDATE coach_actions SET consumed_request_sources=NULL WHERE user_id=$1 AND id=$2',[user,event.actions[0]!.id])
  const legacyView=await coachEventView(user,chat,event.id)
  assert.equal(legacyView?.actions[0]?.status,'stale','two possible legacy requests cannot authorize one draft')
  assert.equal(legacyView?.actions[0]?.draft,null)
  const memoryId=randomUUID(),start=message.indexOf(second)
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(second),JSON.stringify([{type:'message',conversationId:chat,messageId:actionRun.source_message_id,quote:second,range:{start,end:start+second.length}}])])
  await applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'correct',value:'跟进消息请求已更正'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,event.actions[0]!.id])).rows[0]
  assert.equal(persisted.status,'stale','ambiguous pre-upgrade provenance must fail closed when any possible request changes')
  assert.equal(persisted.draft,null)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('withdrawing a legacy node cannot reparse its old clause as action authority',async()=>{
 const user='workflow-legacy-node-exclusion-'+randomUUID(),chat=randomUUID(),title='旧节点排除事项',nodeQuote='我记下过一个旧需求：请写一份预算表',actionQuote='请写一条跟进消息',message=nodeQuote+'；'+actionQuote,draft={content:'老师您好，想跟进一下目前进展。'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC legacy withdrawn node exclusion'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const actionRun=(await store.startRun(user,chat,randomUUID(),message)).run
  event=(await store.finishRun(actionRun,{candidates:[],audit:[],coach:await stageCoachEvent(actionRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:actionRun.source_message_id,quote:nodeQuote}}],action:{operation:'create',source:{messageId:actionRun.source_message_id,quote:actionQuote},draft}},draft.content)},draft.content,null,signal)).event!
  const actionId=event.actions[0]!.id
  await pool.query("UPDATE coach_event_revisions SET snapshot=snapshot-'actionChange'-'actionId'-'actionSource'-'actionSources'-'actionFieldSources' WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,event.revision])
  await pool.query('UPDATE coach_actions SET consumed_request_sources=NULL WHERE user_id=$1 AND id=$2',[user,actionId])
  assert.equal((await coachEventView(user,chat,event.id))?.actions[0]?.status,'proposed')
  const memoryId=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(nodeQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:actionRun.source_message_id,quote:nodeQuote,range:{start:0,end:nodeQuote.length}}])])
  await applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'proposed','withdrawing the sibling node must not stale the independently requested action')
  const marker=(await pool.query("SELECT inquiry_context->'_withdrawnSource' AS source FROM coach_nodes WHERE user_id=$1 AND event_id=$2 AND status='withdrawn'",[user,event.id])).rows[0]?.source
  assert.deepEqual(marker?.range,{start:0,end:nodeQuote.length},'the withdrawn node retains only its redacted source coordinate')
  const after=await coachEventView(user,chat,event.id)
  assert.equal(after?.actions[0]?.status,'proposed','the surviving exact action request remains authoritative after its sibling node is withdrawn')
  assert.deepEqual(after?.actions[0]?.draft,draft)
  assert.deepEqual(persisted.draft,draft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a modified action is invalidated only by its latest exact request source',async()=>{
 const user='workflow-action-rebind-'+randomUUID(),chat=randomUUID(),title='独立事项标题',createQuote='请写一份初稿',modifyQuote='请改成终稿',initialDraft='这是初稿。',finalDraft='这是终稿。',signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC action source rebind'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录这个事项。')
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  const createAction=await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:{content:initialDraft}}},initialDraft)
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:createAction},initialDraft,null,signal)).event!
  const modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run,actionId=event.actions[0]!.id
  const modifyAction=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:{content:finalDraft}}},finalDraft)
  event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:modifyAction},finalDraft,null,signal)).event!
  const titleMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),now(),'active')",[titleMemory,user,JSON.stringify(title),JSON.stringify([{type:'message',conversationId:chat,messageId:opening.source_message_id,quote:title,range:{start:0,end:title.length}}])])
  await applyMemoryAction(user,titleMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const oldMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[oldMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,oldMemory,{requestId:randomUUID(),expectedRevision:1,action:'correct',value:'旧初稿请求已更正'})
  const afterOld=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(afterOld.status,'proposed','a superseded create source is audit history, not current invalidation authority')
  assert.equal(afterOld.draft.content,finalDraft)
  const latestMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','optionsUnderConsideration',$3,'user_reported','user',$4,now(),now(),'active')",[latestMemory,user,JSON.stringify(modifyQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:modifyRun.source_message_id,quote:modifyQuote,range:{start:0,end:modifyQuote.length}}])])
  await applyMemoryAction(user,latestMemory,{requestId:randomUUID(),expectedRevision:1,action:'correct',value:'终稿请求已更正'})
  const afterLatest=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(afterLatest.status,'stale')
  assert.equal(afterLatest.draft,null)
  assert.equal((await pool.query('SELECT title FROM coach_events WHERE user_id=$1 AND id=$2',[user,event.id])).rows[0].title,'')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a modified action retains authority for source content that survives in its draft',async()=>{
 const user='workflow-action-retained-source-'+randomUUID(),chat=randomUUID(),title='跟进邮件事项',createQuote='请写一封包含我电话13800001111的跟进邮件',modifyQuote='请把这封跟进邮件的标题改短',initialDraft='标题：项目跟进\n正文：方便时请回复。电话：13800001111',finalDraft='标题：跟进\n正文：方便时请回复。电话：13800001111',signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC retained action source'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录这个事项。')
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  const createAction=await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:{content:initialDraft}}},initialDraft)
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:createAction},initialDraft,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const modifyAction=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:{content:finalDraft}}},finalDraft)
  await store.finishRun(modifyRun,{candidates:[],audit:[],coach:modifyAction},finalDraft,null,signal)
  const sourceMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[sourceMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,sourceMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'stale','retained phone content must keep its original source as an authority dependency')
  assert.equal(persisted.draft,null)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a request-only identifier cannot fabricate retained draft authority',async()=>{
 const user='workflow-action-request-only-id-'+randomUUID(),chat=randomUUID(),title='编号替换事项',createQuote='请写一份包含编号CASE123456的说明',modifyQuote='请把这份说明完全替换',initialDraft='旧正文',finalDraft='新正文 CASE123456',signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC request-only identifier'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:{content:initialDraft}}},initialDraft)},initialDraft,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:{content:finalDraft}}},finalDraft)},finalDraft,null,signal)
  const sourceMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[sourceMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,sourceMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'proposed','an identifier absent from the old draft does not retain the old request')
  assert.equal(persisted.draft.content,finalDraft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a short unchanged action field retains its creation authority',async()=>{
 const user='workflow-action-short-source-'+randomUUID(),chat=randomUUID(),title='短消息事项',createQuote='请写一句“明天见”',modifyQuote='请把这条消息的判断标准改成对方确认',initialDraft={content:'明天见',observable:'收到回复'},finalDraft={content:'明天见',observable:'对方确认'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC short retained source'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录这个事项。')
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  const createAction=await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:createAction},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const modifyAction=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  await store.finishRun(modifyRun,{candidates:[],audit:[],coach:modifyAction},finalDraft.content,null,signal)
  const sourceMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[sourceMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,sourceMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'stale')
  assert.equal(persisted.draft,null)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a polite edit retains creation authority and cannot invent a recipient',async()=>{
 const user='workflow-action-short-embedded-'+randomUUID(),chat=randomUUID(),title='短消息扩写事项',createQuote='请写一句“明天见”',modifyQuote='请把语气改得更礼貌',initialDraft={content:'明天见'},finalDraft={content:'您好，明天见。'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC short embedded retained source'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录这个事项。')
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  const createAction=await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:createAction},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const stage=(draft:{content:string})=>stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft}},draft.content)
  const introducedRecipient={content:'导师您好，明天见。'}
  await assert.rejects(async()=>store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stage(introducedRecipient)},introducedRecipient.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED')
  const modifyAction=await stage(finalDraft)
  await store.finishRun(modifyRun,{candidates:[],audit:[],coach:modifyAction},finalDraft.content,null,signal)
  const sourceMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[sourceMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,sourceMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'stale','a wrapped short fragment still depends on the source that authorized it')
  assert.equal(persisted.draft,null)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('an insertion-only edit retains the source of the material it edits',async()=>{
 const user='workflow-action-insertion-edit-'+randomUUID(),chat=randomUUID(),title='提醒语气事项',createQuote='请写一条周五提交报告的提醒',modifyQuote='把语气改礼貌',initialDraft={content:'周五提交报告'},finalDraft={content:'请在周五前提交报告'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC insertion edit authority'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录这个事项。')
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  const createAction=await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:createAction},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const modifyAction=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  await store.finishRun(modifyRun,{candidates:[],audit:[],coach:modifyAction},finalDraft.content,null,signal)
  const sourceMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[sourceMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,sourceMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'stale','inserting polite wording cannot detach the surviving material from its creation authority')
  assert.equal(persisted.draft,null)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a meaning-preserving tone rewrite retains creation authority without lexical overlap',async()=>{
 const user='workflow-action-semantic-rewrite-'+randomUUID(),chat=randomUUID(),title='语义改写来源事项',createQuote='请写一条周五提交报告的提醒',modifyQuote='把语气改得更礼貌',initialDraft={content:'周五前交报告'},finalDraft={content:'请于星期五之前递交文档'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC semantic rewrite authority'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录这个事项。')
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  const createAction=await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:createAction},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const modifyAction=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:modifyAction},finalDraft.content,null,signal)).event!
  const injectedRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run,injectedDraft={content:'请于星期五之前递交付费文档课程'}
  const injected=await stageCoachEvent(injectedRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:injectedRun.source_message_id,quote:modifyQuote},draft:injectedDraft}},injectedDraft.content)
  await assert.rejects(()=>store.finishRun(injectedRun,{candidates:[],audit:[],coach:injected},injectedDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','retaining the old text as a subsequence cannot authorize injected material')
  await store.terminateRun(user,injectedRun.request_id,'cancelled','TEST_CLEANUP')
  const maliciousRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run,maliciousDraft={content:'立即购买付费课程'}
  const malicious=await stageCoachEvent(maliciousRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:maliciousRun.source_message_id,quote:modifyQuote},draft:maliciousDraft}},maliciousDraft.content)
  await assert.rejects(()=>store.finishRun(maliciousRun,{candidates:[],audit:[],coach:malicious},maliciousDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','a tone request cannot replace the retained meaning with unrelated content')
  await store.terminateRun(user,maliciousRun.request_id,'cancelled','TEST_CLEANUP')
  const sourceMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[sourceMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,sourceMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'stale','a tone-only rewrite cannot detach paraphrased deadline and deliverable semantics from their creation authority')
  assert.equal(persisted.draft,null)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('non-perfective object-fronted result complements remain modification requests',()=>{
 assert.equal(deliverableIntent('把报告改好','modify'),true)
 assert.equal(deliverableIntent('把报告附件删除掉','modify'),true)
 assert.equal(deliverableIntent('把报告改好了','modify'),false)
 assert.equal(deliverableIntent('把报告附件删除了','modify'),false)
})

test('a shared phrase does not retain authority after the prior material is replaced',async()=>{
 const user='workflow-action-partial-overlap-'+randomUUID(),chat=randomUUID(),title='截止时间材料事项',createQuote='请写一条周五提交完整报告的提醒',modifyQuote='请完全改成预算表提醒',initialDraft={content:'请务必在周五前提交完整报告'},finalDraft={content:'请务必在周五前提交预算表'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC partial overlap replacement'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录这个事项。')
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  const createAction=await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:createAction},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const modifyAction=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  await store.finishRun(modifyRun,{candidates:[],audit:[],coach:modifyAction},finalDraft.content,null,signal)
  const sourceMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[sourceMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,sourceMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'proposed','a shared deadline phrase cannot carry authority for a replaced artifact')
  assert.equal(persisted.draft.content,finalDraft.content)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('an explicit whole-field replacement drops old authority despite complete lexical overlap',async()=>{
 const user='workflow-action-overlap-replacement-'+randomUUID(),chat=randomUUID(),title='重叠整段替换事项',createQuote='请写一句周五提交',modifyQuote='请把整段完全替换成周五提交预算表',initialDraft={content:'周五提交'},finalDraft={content:'周五提交预算表'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC overlapping full replacement'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)},finalDraft.content,null,signal)
  const sourceMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[sourceMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,sourceMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'proposed','an explicit whole-field replacement is authorized by the replacement request, not incidental overlapping text')
  assert.deepEqual(persisted.draft,finalDraft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a vague localized correction cannot replace the whole action body',async()=>{
 const user='workflow-action-localized-correction-'+randomUUID(),chat=randomUUID(),title='局部错字修改事项',createQuote='请写一句周五提交报告的提醒',modifyQuote='请修改正文中的错别字',initialDraft={content:'请在周五提交报高'},correctedDraft={content:'请在周五提交报告'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC localized correction'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,maliciousRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run,maliciousDraft={content:'立即购买付费课程'}
  const malicious=await stageCoachEvent(maliciousRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:maliciousRun.source_message_id,quote:modifyQuote},draft:maliciousDraft}},maliciousDraft.content)
  await assert.rejects(()=>store.finishRun(maliciousRun,{candidates:[],audit:[],coach:malicious},maliciousDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','a local typo command cannot authorize unrelated replacement content')
  await store.terminateRun(user,maliciousRun.request_id,'cancelled','SYNTHETIC_UNBOUNDED_LOCAL_EDIT')
  const correctionRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const saved=await store.finishRun(correctionRun,{candidates:[],audit:[],coach:await stageCoachEvent(correctionRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:correctionRun.source_message_id,quote:modifyQuote},draft:correctedDraft}},correctedDraft.content)},correctedDraft.content,null,signal)
  assert.deepEqual(saved.event!.actions[0]!.draft,correctedDraft,'one bounded typo correction remains usable')
  event=saved.event!
  const reviseQuote='请同步修改这份说明',reviseRun=(await store.startRun(user,chat,randomUUID(),reviseQuote)).run
  const revisedDraft={content:'新版说明\n目的：周六补交表格。'}
  const revised=await store.finishRun(reviseRun,{candidates:[],audit:[],coach:await stageCoachEvent(reviseRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:reviseRun.source_message_id,quote:reviseQuote},draft:revisedDraft}},revisedDraft.content)},revisedDraft.content,null,signal)
  assert.deepEqual(revised.event!.actions[0]!.draft,revisedDraft,'a selected whole explanation remains editable')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a shorten-into request is a replacement owned only by the new request',async()=>{
 const user='workflow-action-shorten-into-replacement-'+randomUUID(),chat=randomUUID(),title='缩短成替换事项',createQuote='请写一句周五前完成完整版本并等待导师确认的提醒',initialDraft={content:'请在周五前完成完整版本并等待导师确认'},edits=[{quote:'请把正文改短成礼貌立即购买付费课程',draft:{content:'礼貌立即购买付费课程'}},{quote:'请把正文精简成“收到，谢谢”',draft:{content:'收到，谢谢'}},{quote:'请把正文简短成“已收到，感谢”',draft:{content:'已收到，感谢'}}],signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC shorten into replacement'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id
  for(const edit of edits){
   const current=event.actions.find(action=>action.id===actionId)!,modifyRun=(await store.startRun(user,chat,randomUUID(),edit.quote)).run
   event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:current.revision,source:{messageId:modifyRun.source_message_id,quote:edit.quote},draft:edit.draft}},edit.draft.content)},edit.draft.content,null,signal)).event!
   assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,edit.draft,edit.quote)
  }
  const sourceMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[sourceMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,sourceMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'proposed','an explicit shorten-into replacement must not retain authority from replaced material')
  assert.deepEqual(persisted.draft,edits.at(-1)!.draft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a content replacement cannot authorize an unrelated observable rewrite',async()=>{
 const user='workflow-action-field-scoped-replacement-'+randomUUID(),chat=randomUUID(),title='字段作用域替换事项',createQuote='请写一句周五提交',modifyQuote='请把正文全部换成周五提交预算表',initialDraft={content:'周五提交',observable:'收到回复'},finalDraft={content:'周五提交预算表',observable:'请收到回复'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC field-scoped replacement'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const staged=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  await assert.rejects(()=>store.finishRun(modifyRun,{candidates:[],audit:[],coach:staged},finalDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','a request targeting content cannot silently replace a different action field')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a field named only to keep it unchanged cannot be rewritten',async()=>{
 const user='workflow-action-preserved-field-'+randomUUID(),chat=randomUUID(),title='字段保留事项',createQuote='请写一句周五提交',modifyQuote='请保持目标不变只把正文全部换成周五提交预算表',initialDraft={content:'周五提交',goal:'按时提交'},finalDraft={content:'周五提交预算表',goal:'争取拿奖'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC preserved action field'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const staged=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  await assert.rejects(()=>store.finishRun(modifyRun,{candidates:[],audit:[],coach:staged},finalDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','a negatively mentioned sibling field must remain unchanged')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a ba-form negative field mention cannot grant rewrite authority',async()=>{
 const user='workflow-action-negative-ba-field-'+randomUUID(),chat=randomUUID(),title='把字句字段保护事项',createQuote='请写一句周五提交',modifyQuote='请不要把目标改，只把正文全部换成周五提交预算表',initialDraft={content:'周五提交',goal:'按时提交'},finalDraft={content:'周五提交预算表',goal:'争取拿奖'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC negative ba action field'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run,actionQuote='只把正文全部换成周五提交预算表'
  const staged=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:actionQuote},draft:finalDraft}},finalDraft.content)
  await assert.rejects(()=>store.finishRun(modifyRun,{candidates:[],audit:[],coach:staged},finalDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','不要把目标改 must protect goal rather than authorize it')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('field words requested as content cannot authorize metadata rewrites',async()=>{
 const user='workflow-action-output-field-words-'+randomUUID(),chat=randomUUID(),title='正文字段词事项',createQuote='请写一段原文',modifyQuote='请在正文中加上“目标”和“判断标准”这几个词',initialDraft={content:'原文',goal:'按时提交',observable:'收到回复'},finalDraft={content:'原文包含目标和判断标准',goal:'争取拿奖',observable:'无需回复'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC output field words'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const staged=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  await assert.rejects(()=>store.finishRun(modifyRun,{candidates:[],audit:[],coach:staged},finalDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','words added to content must not become field selectors')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('quoted field words before a replacement verb remain content',async()=>{
 const user='workflow-action-quoted-field-word-'+randomUUID(),chat=randomUUID(),title='引号字段词事项',createQuote='请写一段目标说明',modifyQuote='请把正文里的“目标”改成“计划”',initialDraft={content:'旧目标说明',goal:'按时提交'},finalDraft={content:'旧计划说明',goal:'争取获奖'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC quoted field word'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const staged=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  await assert.rejects(()=>store.finishRun(modifyRun,{candidates:[],audit:[],coach:staged},finalDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','quoted content words cannot select action metadata fields')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a local content substitution retains authority for surviving material',async()=>{
 const user='workflow-action-local-substitution-'+randomUUID(),chat=randomUUID(),title='局部正文替换事项',createQuote='请写一段周五提交目标报告的提醒',modifyQuote='请把正文里的“目标”改成“计划”',initialDraft={content:'周五提交目标报告，电话13800001111'},finalDraft={content:'周五提交计划报告，电话13800001111'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC local content substitution'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)},finalDraft.content,null,signal)).event!
  const unrelatedRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run,unrelatedDraft={content:'获奖宣传：立即报名'}
  const unrelatedStaged=await stageCoachEvent(unrelatedRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:unrelatedRun.source_message_id,quote:modifyQuote},draft:unrelatedDraft}},unrelatedDraft.content)
  await assert.rejects(()=>store.finishRun(unrelatedRun,{candidates:[],audit:[],coach:unrelatedStaged},unrelatedDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','a local literal substitution cannot replace the whole field')
  const sourceMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[sourceMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,sourceMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'stale','a local substitution cannot detach surviving prose and identifiers from their creation source')
  assert.equal(persisted.draft,null)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('an additive request cannot replace established content',async()=>{
 const user='workflow-action-additive-replacement-'+randomUUID(),chat=randomUUID(),title='添加不替换事项',createQuote='请写一份提交报告清单',modifyQuote='请加上项目预算',initialDraft={content:'周五提交报告',materials:['报告']},finalDraft={content:'获奖宣传：周五请立即提交推广报告',materials:['报告','项目预算']},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC additive replacement'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const staged=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  await assert.rejects(()=>store.finishRun(modifyRun,{candidates:[],audit:[],coach:staged},finalDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','an additive instruction must retain established content')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a direct-field addition cannot inject unrelated text into an existing field',async()=>{
 const user='workflow-action-existing-field-addition-'+randomUUID(),chat=randomUUID(),title='已有字段添加事项',createQuote='请写一份提交报告行动',modifyQuote='请加上目标',initialDraft={content:'周五提交报告',goal:'按时提交'},finalDraft={content:'周五提交报告',goal:'按时提交并争取拿奖'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC existing field addition'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const staged=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  await assert.rejects(()=>store.finishRun(modifyRun,{candidates:[],audit:[],coach:staged},finalDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','naming an existing field does not authorize unspecified added content')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('an explicit addition to an existing field accepts its bounded payload',async()=>{
 const user='workflow-action-explicit-field-addition-'+randomUUID(),chat=randomUUID(),title='明确字段添加事项',createQuote='请写一份提交报告行动',modifyQuote='请加上目标：争取拿奖',initialDraft={content:'周五提交报告',goal:'按时提交'},duplicatedDraft={content:'周五提交报告',goal:'按时提交并争取拿奖争取拿奖'},finalDraft={content:'周五提交报告',goal:'按时提交并争取拿奖'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC explicit field addition'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,duplicatedRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const duplicatedStaged=await stageCoachEvent(duplicatedRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:duplicatedRun.source_message_id,quote:modifyQuote},draft:duplicatedDraft}},duplicatedDraft.content)
  await assert.rejects(()=>store.finishRun(duplicatedRun,{candidates:[],audit:[],coach:duplicatedStaged},duplicatedDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','one requested addition cannot authorize duplicating its payload')
  await store.terminateRun(user,duplicatedRun.request_id,'cancelled','TEST_CLEANUP')
  const modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)},finalDraft.content,null,signal)
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'proposed')
  assert.deepEqual(persisted.draft,finalDraft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('an additive field edit cannot drop characters from its requested payload',async()=>{
 const user='workflow-action-additive-lexeme-'+randomUUID(),chat=randomUUID(),title='添加完整词语事项',createQuote='请写一份提交报告行动',modifyQuote='请加上目标：和平发展',initialDraft={content:'周五提交报告',goal:'按时提交'},invalidDraft={content:'周五提交报告',goal:'按时提交并平发展'},validDraft={content:'周五提交报告',goal:'按时提交并和平发展'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC additive lexeme'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,invalidRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const invalidStaged=await stageCoachEvent(invalidRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:invalidRun.source_message_id,quote:modifyQuote},draft:invalidDraft}},invalidDraft.content)
  await assert.rejects(()=>store.finishRun(invalidRun,{candidates:[],audit:[],coach:invalidStaged},invalidDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','the exact requested payload must survive an additive edit')
  await store.terminateRun(user,invalidRun.request_id,'cancelled','TEST_CLEANUP')
  const validRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(validRun,{candidates:[],audit:[],coach:await stageCoachEvent(validRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:validRun.source_message_id,quote:modifyQuote},draft:validDraft}},validDraft.content)},validDraft.content,null,signal)).event!
  assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,validDraft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a coordinated additive edit must retain every requested payload term',async()=>{
 const user='workflow-action-additive-coordination-'+randomUUID(),chat=randomUUID(),title='添加完整清单事项',createQuote='请写一份提交报告清单',modifyQuote='请加上项目预算和截止时间',initialDraft={content:'周五提交报告',materials:['报告']},incompleteDraft={content:'周五提交报告',materials:['报告','项目预算']},completeDraft={content:'周五提交报告',materials:['报告','项目预算','截止时间']},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC coordinated addition'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,incompleteRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const incompleteStaged=await stageCoachEvent(incompleteRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:incompleteRun.source_message_id,quote:modifyQuote},draft:incompleteDraft}},incompleteDraft.content)
  await assert.rejects(()=>store.finishRun(incompleteRun,{candidates:[],audit:[],coach:incompleteStaged},incompleteDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','every coordinated additive payload must survive somewhere in the resulting draft')
  await store.terminateRun(user,incompleteRun.request_id,'cancelled','TEST_CLEANUP')
  const completeRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(completeRun,{candidates:[],audit:[],coach:await stageCoachEvent(completeRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:completeRun.source_message_id,quote:modifyQuote},draft:completeDraft}},completeDraft.content)},completeDraft.content,null,signal)).event!
  assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,completeDraft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('overlapping additive payload terms must each be consumed independently',async()=>{
 const user='workflow-action-overlapping-addition-'+randomUUID(),chat=randomUUID(),title='添加重叠材料事项',createQuote='请写一份材料清单',modifyQuote='请加上报告和报告附件',initialDraft={content:'整理材料',materials:['成绩单']},incompleteDraft={content:'整理材料',materials:['成绩单','报告附件']},completeDraft={content:'整理材料',materials:['成绩单','报告','报告附件']},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC overlapping addition'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,incompleteRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const incompleteStaged=await stageCoachEvent(incompleteRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:incompleteRun.source_message_id,quote:modifyQuote},draft:incompleteDraft}},incompleteDraft.content)
  await assert.rejects(()=>store.finishRun(incompleteRun,{candidates:[],audit:[],coach:incompleteStaged},incompleteDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','a longer requested term cannot also consume its prefix sibling')
  await store.terminateRun(user,incompleteRun.request_id,'cancelled','TEST_CLEANUP')
  const completeRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(completeRun,{candidates:[],audit:[],coach:await stageCoachEvent(completeRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:completeRun.source_message_id,quote:modifyQuote},draft:completeDraft}},completeDraft.content)},completeDraft.content,null,signal)).event!
  assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,completeDraft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('an additive field edit cannot append unrequested surplus content',async()=>{
 const user='workflow-action-additive-surplus-'+randomUUID(),chat=randomUUID(),title='添加内容边界事项',createQuote='请写一份提交报告行动',modifyQuote='请加上目标：争取拿奖',initialDraft={content:'周五提交报告',goal:'按时提交'},surplusDraft={content:'周五提交报告',goal:'按时提交并争取拿奖，同时改为考研'},validDraft={content:'周五提交报告',goal:'按时提交并争取拿奖'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC additive surplus'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,surplusRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const surplusStaged=await stageCoachEvent(surplusRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:surplusRun.source_message_id,quote:modifyQuote},draft:surplusDraft}},surplusDraft.content)
  await assert.rejects(()=>store.finishRun(surplusRun,{candidates:[],audit:[],coach:surplusStaged},surplusDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','an additive delta may contain only the bounded requested payload and connectors')
  await store.terminateRun(user,surplusRun.request_id,'cancelled','TEST_CLEANUP')
  const validRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(validRun,{candidates:[],audit:[],coach:await stageCoachEvent(validRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:validRun.source_message_id,quote:modifyQuote},draft:validDraft}},validDraft.content)},validDraft.content,null,signal)).event!
  assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,validDraft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('field words inside artifact compounds cannot authorize metadata changes',async()=>{
 const user='workflow-action-field-compound-'+randomUUID(),chat=randomUUID(),title='复合词编辑事项',createQuote='请写一条客户消息',initialDraft={content:'给目标客户的消息：您好，请确认目前的项目进展',goal:'按时提交',observable:'收到回复'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC lexical field compounds'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id
  for(const row of [
   {request:'请把给目标客户的消息改短',field:'goal',malicious:'争取拿奖',content:'目标客户：请确认进展'},
   {request:'请把回复消息改短',field:'observable',malicious:'已经获奖',content:'回复消息：确认'},
   {request:'请把回复导师的话术改短',field:'observable',malicious:'无需回复',content:'导师：确认'},
  ]){
   const current=event.actions.find(action=>action.id===actionId)!,before=current.draft as any,maliciousDraft={...before,[row.field]:row.malicious}
   const maliciousRun=(await store.startRun(user,chat,randomUUID(),row.request)).run
   const staged=await stageCoachEvent(maliciousRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:current.revision,source:{messageId:maliciousRun.source_message_id,quote:row.request},draft:maliciousDraft}},maliciousDraft.content)
   await assert.rejects(()=>store.finishRun(maliciousRun,{candidates:[],audit:[],coach:staged},maliciousDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED',`${row.request} cannot authorize ${row.field}`)
   await store.terminateRun(user,maliciousRun.request_id,'cancelled','TEST_CLEANUP')
   const validDraft={...before,content:row.content},validRun=(await store.startRun(user,chat,randomUUID(),row.request)).run
   event=(await store.finishRun(validRun,{candidates:[],audit:[],coach:await stageCoachEvent(validRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:current.revision,source:{messageId:validRun.source_message_id,quote:row.request},draft:validDraft}},validDraft.content)},validDraft.content,null,signal)).event!
   assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,validDraft)
  }
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a content-only edit cannot silently delete sibling fields',async()=>{
 const user='workflow-action-silent-field-deletion-'+randomUUID(),chat=randomUUID(),title='字段删除边界事项',createQuote='请写一份提交报告行动',modifyQuote='请把正文改短',styleAnchorQuote='请把正文改短并保持礼貌',deleteQuote='请删掉目标',initialDraft={content:'周五提交报告的完整说明',goal:'按时提交',observable:'收到回复',materials:['报告']},omittedDraft={content:'周五提交报告'},unrelatedDraft={...initialDraft,content:'立即购买付费课程'},styleAnchorDraft={...initialDraft,content:'礼貌立即购买付费课程'},validDraft={...initialDraft,content:'周五提交报告'},deletedGoalDraft={content:'周五提交报告',observable:'收到回复',materials:['报告']},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC silent field deletion'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,omittedRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const omittedStaged=await stageCoachEvent(omittedRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:omittedRun.source_message_id,quote:modifyQuote},draft:omittedDraft}},omittedDraft.content)
  await assert.rejects(()=>store.finishRun(omittedRun,{candidates:[],audit:[],coach:omittedStaged},omittedDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','untargeted sibling fields and material entries cannot disappear')
  await store.terminateRun(user,omittedRun.request_id,'cancelled','TEST_CLEANUP')
  const unrelatedRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const unrelatedStaged=await stageCoachEvent(unrelatedRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:unrelatedRun.source_message_id,quote:modifyQuote},draft:unrelatedDraft}},unrelatedDraft.content)
  await assert.rejects(()=>store.finishRun(unrelatedRun,{candidates:[],audit:[],coach:unrelatedStaged},unrelatedDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','a shorten-only request cannot replace the content with unrelated material')
  await store.terminateRun(user,unrelatedRun.request_id,'cancelled','TEST_CLEANUP')
  const styleAnchorRun=(await store.startRun(user,chat,randomUUID(),styleAnchorQuote)).run
  const styleAnchorStaged=await stageCoachEvent(styleAnchorRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:styleAnchorRun.source_message_id,quote:styleAnchorQuote},draft:styleAnchorDraft}},styleAnchorDraft.content)
  await assert.rejects(()=>store.finishRun(styleAnchorRun,{candidates:[],audit:[],coach:styleAnchorStaged},styleAnchorDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','style words are not concrete shorten-object authority')
  await store.terminateRun(user,styleAnchorRun.request_id,'cancelled','TEST_CLEANUP')
  const validRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(validRun,{candidates:[],audit:[],coach:await stageCoachEvent(validRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:validRun.source_message_id,quote:modifyQuote},draft:validDraft}},validDraft.content)},validDraft.content,null,signal)).event!
  const deleteRun=(await store.startRun(user,chat,randomUUID(),deleteQuote)).run,current=event.actions.find(action=>action.id===actionId)!
  event=(await store.finishRun(deleteRun,{candidates:[],audit:[],coach:await stageCoachEvent(deleteRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:current.revision,source:{messageId:deleteRun.source_message_id,quote:deleteQuote},draft:deletedGoalDraft}},deletedGoalDraft.content)},deletedGoalDraft.content,null,signal)).event!
  assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,deletedGoalDraft,'an exact field removal remains supported')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a list deletion cannot remove or replace a different material than the one named',async()=>{
 const user='workflow-action-exact-material-deletion-'+randomUUID(),chat=randomUUID(),title='材料删除身份事项',createQuote='请写一份申请材料清单',deleteQuote='请删掉成绩单',initialDraft={content:'申请材料',materials:['成绩单','作品集']},wrongDraft={content:'申请材料',materials:['成绩单']},replacementDraft={content:'申请材料',materials:['作品集','推荐信']},validDraft={content:'申请材料',materials:['作品集']},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC exact material deletion'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,wrongRun=(await store.startRun(user,chat,randomUUID(),deleteQuote)).run
  const wrongStaged=await stageCoachEvent(wrongRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:wrongRun.source_message_id,quote:deleteQuote},draft:wrongDraft}},wrongDraft.content)
  await assert.rejects(()=>store.finishRun(wrongRun,{candidates:[],audit:[],coach:wrongStaged},wrongDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','the named material must be the exact occurrence that disappears')
  await store.terminateRun(user,wrongRun.request_id,'cancelled','TEST_CLEANUP')
  const replacementRun=(await store.startRun(user,chat,randomUUID(),deleteQuote)).run
  const replacementStaged=await stageCoachEvent(replacementRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:replacementRun.source_message_id,quote:deleteQuote},draft:replacementDraft}},replacementDraft.content)
  await assert.rejects(()=>store.finishRun(replacementRun,{candidates:[],audit:[],coach:replacementStaged},replacementDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','a deletion-only request cannot replace the removed occurrence with invented material')
  await store.terminateRun(user,replacementRun.request_id,'cancelled','TEST_CLEANUP')
  const validRun=(await store.startRun(user,chat,randomUUID(),deleteQuote)).run
  event=(await store.finishRun(validRun,{candidates:[],audit:[],coach:await stageCoachEvent(validRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:validRun.source_message_id,quote:deleteQuote},draft:validDraft}},validDraft.content)},validDraft.content,null,signal)).event!
  assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,validDraft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a longer named material cannot authorize deleting its substring sibling',async()=>{
 const user='workflow-action-overlap-material-deletion-'+randomUUID(),chat=randomUUID(),title='重叠材料删除事项',createQuote='请写一份报告材料清单',deleteQuote='请删掉报告附件',initialDraft={content:'报告材料',materials:['报告','报告附件']},wrongDraft={content:'报告材料',materials:['报告附件']},validDraft={content:'报告材料',materials:['报告']},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC overlapping material deletion'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,wrongRun=(await store.startRun(user,chat,randomUUID(),deleteQuote)).run
  const wrongStaged=await stageCoachEvent(wrongRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:wrongRun.source_message_id,quote:deleteQuote},draft:wrongDraft}},wrongDraft.content)
  await assert.rejects(()=>store.finishRun(wrongRun,{candidates:[],audit:[],coach:wrongStaged},wrongDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','the longest exact named value must win over its substring sibling')
  await store.terminateRun(user,wrongRun.request_id,'cancelled','TEST_CLEANUP')
  const validRun=(await store.startRun(user,chat,randomUUID(),deleteQuote)).run
  event=(await store.finishRun(validRun,{candidates:[],audit:[],coach:await stageCoachEvent(validRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:validRun.source_message_id,quote:deleteQuote},draft:validDraft}},validDraft.content)},validDraft.content,null,signal)).event!
  assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,validDraft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a scalar deletion removes only its exact payload and cannot replace the vacated text',async()=>{
 const user='workflow-action-scalar-deletion-'+randomUUID(),signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  for(const row of [
   {chat:randomUUID(),title:'正文删词事项',createQuote:'请写一段提交提醒',initial:'报告附件，请提交',deleteQuote:'请删掉报告附件',next:'请提交',valid:true},
   {chat:randomUUID(),title:'正文替换边界事项',createQuote:'请写一段附件提醒',initial:'报告附件',deleteQuote:'请删掉报告附件',next:'任意新内容',valid:false},
  ]){
   await store.createConversation(user,{id:row.chat,title:'SYNTHETIC scalar deletion'})
   const opening=(await store.startRun(user,row.chat,randomUUID(),row.title)).run
   let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title:row.title,source:{messageId:opening.source_message_id,quote:row.title}}},'已记录。')},'已记录。',null,signal)).event!
   const createRun=(await store.startRun(user,row.chat,randomUUID(),row.createQuote)).run
   event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:row.createQuote},draft:{content:row.initial}}},row.initial)},row.initial,null,signal)).event!
   const actionId=event.actions[0]!.id,deleteRun=(await store.startRun(user,row.chat,randomUUID(),row.deleteQuote)).run,draft={content:row.next}
   const staged=await stageCoachEvent(deleteRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:deleteRun.source_message_id,quote:row.deleteQuote},draft}},draft.content)
   if(row.valid){
    event=(await store.finishRun(deleteRun,{candidates:[],audit:[],coach:staged},draft.content,null,signal)).event!
    assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,draft,'the exact named substring is removed while the remainder survives')
   }else{
    await assert.rejects(()=>store.finishRun(deleteRun,{candidates:[],audit:[],coach:staged},draft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','deleting the complete old scalar cannot authorize unrelated replacement text')
    await store.terminateRun(user,deleteRun.request_id,'cancelled','TEST_CLEANUP')
   }
  }
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a quoted removal payload authorizes only that exact scalar or list deletion',async()=>{
 const user='workflow-action-quoted-deletion-'+randomUUID(),signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  for(const row of [
   {chat:randomUUID(),title:'引号正文删除事项',createQuote:'请写一段提交提醒',deleteQuote:'请删除正文里的“报告附件”',initial:{content:'报告附件，请提交'},next:{content:'请提交'},valid:true},
   {chat:randomUUID(),title:'引号材料删除事项',createQuote:'请写一份申请材料清单',deleteQuote:'请删除材料里的“成绩单”',initial:{content:'申请材料',materials:['成绩单','作品集']},next:{content:'申请材料',materials:['作品集']},valid:true},
   {chat:randomUUID(),title:'把字引号材料删除事项',createQuote:'请写一份申请材料清单',deleteQuote:'请把材料里的“成绩单”删除一下',initial:{content:'申请材料',materials:['成绩单','作品集']},next:{content:'申请材料',materials:['作品集']},valid:true},
   {chat:randomUUID(),title:'引号材料扩大删除事项',createQuote:'请写一份申请材料清单',deleteQuote:'请删除材料里的“成绩单”',initial:{content:'申请材料',materials:['成绩单','作品集']},next:{content:'申请材料'},valid:false},
  ]){
   await store.createConversation(user,{id:row.chat,title:'SYNTHETIC quoted deletion'})
   const opening=(await store.startRun(user,row.chat,randomUUID(),row.title)).run
   let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title:row.title,source:{messageId:opening.source_message_id,quote:row.title}}},'已记录。')},'已记录。',null,signal)).event!
   const createRun=(await store.startRun(user,row.chat,randomUUID(),row.createQuote)).run
   event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:row.createQuote},draft:row.initial}},row.initial.content)},row.initial.content,null,signal)).event!
   const actionId=event.actions[0]!.id,deleteRun=(await store.startRun(user,row.chat,randomUUID(),row.deleteQuote)).run
   const staged=await stageCoachEvent(deleteRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:deleteRun.source_message_id,quote:row.deleteQuote},draft:row.next}},row.next.content)
   if(row.valid){
    event=(await store.finishRun(deleteRun,{candidates:[],audit:[],coach:staged},row.next.content,null,signal)).event!
    assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,row.next)
   }else{
    await assert.rejects(()=>store.finishRun(deleteRun,{candidates:[],audit:[],coach:staged},row.next.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','a quoted item must not authorize clearing the entire field')
    await store.terminateRun(user,deleteRun.request_id,'cancelled','TEST_CLEANUP')
   }
  }
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a completed first-person removal narration is not a new modification request',async()=>{
 const user='workflow-action-completed-removal-narration-'+randomUUID(),chat=randomUUID(),title='附件处理事项',createQuote='请写一份申请材料清单',initial={content:'申请材料',materials:['报告附件']},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC completed removal narration'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initial}},initial.content)},initial.content,null,signal)).event!
  const actionId=event.actions[0]!.id
  for(const narration of ['我已删除报告附件','请确认我已经删除报告附件','请确认我把报告附件删除了','请确认我删除了报告附件','把报告附件删除了','把报告已经改好了','把申请材料精简了','把申请材料简短了']){
   const narrationRun=(await store.startRun(user,chat,randomUUID(),narration)).run
   try{
    await assert.rejects(()=>stageCoachEvent(narrationRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:narrationRun.source_message_id,quote:narration},draft:{content:'申请材料'}}},'申请材料'),(error:any)=>error?.code==='COACH_ACTION_SOURCE_INVALID',narration)
   }finally{await store.terminateRun(user,narrationRun.request_id,'cancelled','TEST_CLEANUP')}
  }
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a refusal to simplify an existing material action cannot inherit earlier material consent',async()=>{
 const user='workflow-action-declined-simplification-'+randomUUID(),chat=randomUUID(),title='消息精简事项',createQuote='请写一段消息',draft={content:'收到，谢谢'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC declined simplification'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft}},draft.content)},draft.content,null,signal)).event!
  const actionId=event.actions[0]!.id
  for(const refusal of ['不要精简这段消息','不要简短这段消息']){
   const refusalRun=(await store.startRun(user,chat,randomUUID(),refusal)).run
   try{
    await assert.rejects(()=>stageCoachEvent(refusalRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,draft:{content:'收到'}}},'收到'),(error:any)=>error?.code==='COACH_ACTION_DECLINED',refusal)
   }finally{await store.terminateRun(user,refusalRun.request_id,'cancelled','TEST_CLEANUP')}
  }
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a coordinated list removal must consume every requested item exactly once',async()=>{
 const user='workflow-action-coordinated-removal-'+randomUUID(),signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  for(const row of [
   {chat:randomUUID(),title:'完整协调删除事项',next:{content:'申请材料',materials:[]},valid:true},
   {chat:randomUUID(),title:'部分协调删除事项',next:{content:'申请材料',materials:['作品集']},valid:false},
  ]){
   const createQuote='请写一份申请材料清单',deleteQuote='请删除成绩单和作品集',initial={content:'申请材料',materials:['成绩单','作品集']}
   await store.createConversation(user,{id:row.chat,title:'SYNTHETIC coordinated removal'})
   const opening=(await store.startRun(user,row.chat,randomUUID(),row.title)).run
   let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title:row.title,source:{messageId:opening.source_message_id,quote:row.title}}},'已记录。')},'已记录。',null,signal)).event!
   const createRun=(await store.startRun(user,row.chat,randomUUID(),createQuote)).run
   event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initial}},initial.content)},initial.content,null,signal)).event!
   const actionId=event.actions[0]!.id,deleteRun=(await store.startRun(user,row.chat,randomUUID(),deleteQuote)).run
   const staged=await stageCoachEvent(deleteRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:deleteRun.source_message_id,quote:deleteQuote},draft:row.next}},row.next.content)
   if(row.valid){
    event=(await store.finishRun(deleteRun,{candidates:[],audit:[],coach:staged},row.next.content,null,signal)).event!
    assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,row.next)
   }else{
    await assert.rejects(()=>store.finishRun(deleteRun,{candidates:[],audit:[],coach:staged},row.next.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','every named removal must be applied exactly once')
    await store.terminateRun(user,deleteRun.request_id,'cancelled','TEST_CLEANUP')
   }
  }
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('one fieldless removal payload cannot be spent independently in content and materials',async()=>{
 const user='workflow-action-cross-field-removal-'+randomUUID(),chat=randomUUID(),title='跨字段删除事项',createQuote='请写一份成绩单材料说明',deleteQuote='请删除成绩单',initial={content:'成绩单说明',materials:['成绩单','作品集']},next={content:'说明',materials:['作品集']},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC cross-field removal'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initial}},initial.content)},initial.content,null,signal)).event!
  const actionId=event.actions[0]!.id,deleteRun=(await store.startRun(user,chat,randomUUID(),deleteQuote)).run
  const staged=await stageCoachEvent(deleteRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:deleteRun.source_message_id,quote:deleteQuote},draft:next}},next.content)
  await assert.rejects(()=>store.finishRun(deleteRun,{candidates:[],audit:[],coach:staged},next.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','one named payload must not authorize two field removals')
  await store.terminateRun(user,deleteRun.request_id,'cancelled','TEST_CLEANUP')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a deferred whole-draft modification retains its exact preservation control',async()=>{
 const user='workflow-action-deferred-preservation-'+randomUUID(),chat=randomUUID(),title='延期保留目标事项',createQuote='请写一份提交行动',modifyQuote='请修改整个草案；目标保持不变',clarification='内容是新版本',initial={content:'旧版本',goal:'按时提交'},invalid={content:'新版本',goal:'争取拿奖'},valid={content:'新版本',goal:'按时提交'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC deferred preservation'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initial}},initial.content)},initial.content,null,signal)).event!
  const actionId=event.actions[0]!.id,requestRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(requestRun,{candidates:[],audit:[],coach:await stageCoachEvent(requestRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision}},'正文希望改成什么？')},'正文希望改成什么？',null,signal)).event!
  const invalidRun=(await store.startRun(user,chat,randomUUID(),clarification)).run
  const invalidStaged=await stageCoachEvent(invalidRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,draft:invalid}},invalid.content)
  await assert.rejects(()=>store.finishRun(invalidRun,{candidates:[],audit:[],coach:invalidStaged},invalid.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','the original preservation clause remains authoritative across the deferred turn')
  await store.terminateRun(user,invalidRun.request_id,'cancelled','TEST_CLEANUP')
  const validRun=(await store.startRun(user,chat,randomUUID(),clarification)).run
  event=(await store.finishRun(validRun,{candidates:[],audit:[],coach:await stageCoachEvent(validRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,draft:valid}},valid.content)},valid.content,null,signal)).event!
  assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,valid)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('all supported removal verbs use the same exact material path',async()=>{
 const user='workflow-action-removal-synonyms-'+randomUUID(),signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  for(const verb of ['删除','移除','去除','取消']){
   const chat=randomUUID(),title=`${verb}材料事项`,createQuote='请写一份申请材料清单',modifyQuote=`请${verb}成绩单`,initialDraft={content:'申请材料',materials:['成绩单','作品集']},finalDraft={content:'申请材料',materials:['作品集']}
   await store.createConversation(user,{id:chat,title:'SYNTHETIC removal synonyms'})
   const opening=(await store.startRun(user,chat,randomUUID(),title)).run
   let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
   const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
   event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
   const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
   event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)},finalDraft.content,null,signal)).event!
   assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,finalDraft,`${verb} must share deletion request, target and lineage semantics`)
  }
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a field-only addition remains a proposal and never becomes a user fact',async()=>{
 const user='workflow-action-proposed-field-addition-'+randomUUID(),chat=randomUUID(),title='建议目标事项',createQuote='请写一份提交报告行动',modifyQuote='请加上目标',initialDraft={content:'周五提交报告'},finalDraft={content:'周五提交报告',goal:'争取拿奖'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC proposed field addition'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)},finalDraft.content,null,signal)).event!
  const persisted=event.actions.find(action=>action.id===actionId)
  assert.equal(persisted?.status,'proposed','a requested AI-generated goal remains visibly unaccepted')
  assert.deepEqual(persisted?.draft,finalDraft)
  const leaked=await pool.query("SELECT (SELECT count(*) FROM coach_nodes WHERE user_id=$1 AND content=$2)+(SELECT count(*) FROM experiences WHERE user_id=$1 AND content::text LIKE $3)+(SELECT count(*) FROM memory_items WHERE user_id=$1 AND value::text LIKE $3)+(SELECT count(*) FROM growth_items WHERE user_id=$1 AND text=$2) AS n",[user,finalDraft.goal,'%'+finalDraft.goal+'%'])
  assert.equal(Number(leaked.rows[0].n),0,'proposed material is not a fact, memory, experience or star-map record')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a question about retained action material keeps the original field source',async()=>{
 const user='workflow-action-retained-question-source-'+randomUUID(),chat=randomUUID(),title='保留字段问题事项',createQuote='请写一条发给导师的消息',modifyQuote='请把语气改礼貌',question='这条消息发给谁？',initialDraft={content:'导师，确认进展。'},modifiedDraft={content:'导师您好，方便时请确认一下进展。'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC retained action question source'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run,reply=modifiedDraft.content+'\n'+question
  event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:modifiedDraft}},reply)},reply,null,signal)).event!
  const snapshot=(await pool.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 ORDER BY revision DESC LIMIT 1',[user,event.id])).rows[0]?.snapshot
  const sources=snapshot?.questionBindings?.find((binding:any)=>binding.question===question)?.sources??[]
  assert.ok(sources.some((source:any)=>source.messageId===createRun.source_message_id),'the retained communication field remains a required question source')
  const memoryId=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const readback=await coachEventView(user,chat,event.id)
  assert.equal(readback?.actions.find(action=>action.id===actionId)?.status,'stale')
  assert.equal(readback?.asked.includes(question),false,'forgetting the retained field source also withdraws its dependent question')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a response-metric report cannot authorize observable metadata changes',async()=>{
 const user='workflow-action-response-metric-field-'+randomUUID(),chat=randomUUID(),title='回复率报告事项',createQuote='请写一份回复率报告',modifyQuote='请把回复率报告改短',initialDraft={content:'回复率报告\n摘要：回复率为10%',observable:'收到客户回复'},maliciousDraft={content:'回复率报告\n摘要：回复率为10%',observable:'20%'},validDraft={content:'回复率报告：10%',observable:'收到客户回复'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC response metric field'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,maliciousRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const staged=await stageCoachEvent(maliciousRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:maliciousRun.source_message_id,quote:modifyQuote},draft:maliciousDraft}},maliciousDraft.content)
  await assert.rejects(()=>store.finishRun(maliciousRun,{candidates:[],audit:[],coach:staged},maliciousDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','reply-rate vocabulary is report content, not observable-field authority')
  await store.terminateRun(user,maliciousRun.request_id,'cancelled','TEST_CLEANUP')
  const validRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(validRun,{candidates:[],audit:[],coach:await stageCoachEvent(validRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:validRun.source_message_id,quote:modifyQuote},draft:validDraft}},validDraft.content)},validDraft.content,null,signal)).event!
  assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,validDraft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a whole-draft edit honors a trailing preserved field',async()=>{
 const user='workflow-action-whole-draft-exclusion-'+randomUUID(),chat=randomUUID(),title='整份草案保护事项',createQuote='请写一份行动草案',modifyQuote='请修改整个草案，但目标保持不变',initialDraft={content:'旧草案',goal:'按时提交',start:'今晚开始',observable:'收到回复'},finalDraft={content:'新草案',goal:'按时提交',start:'明早开始',observable:'完成确认'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC whole draft exclusion'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const actionQuote='请修改整个草案'
  event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:actionQuote},draft:finalDraft}},finalDraft.content)},finalDraft.content,null,signal)).event!
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'proposed')
  assert.deepEqual(persisted.draft,finalDraft)
  const violatingRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run,violatingDraft={...finalDraft,content:'第三版草案',goal:'争取拿奖'}
  const staged=await stageCoachEvent(violatingRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:violatingRun.source_message_id,quote:actionQuote},draft:violatingDraft}},violatingDraft.content)
  await assert.rejects(()=>store.finishRun(violatingRun,{candidates:[],audit:[],coach:staged},violatingDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','a protected field remains excluded from a whole-draft edit')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a preservation control for another named action does not constrain the selected action',async()=>{
 const user='workflow-action-scoped-preservation-'+randomUUID(),chat=randomUUID(),title='多行动保护范围事项',createA='请写行动A草案',createB='请写行动B草案',modifyQuote='请修改行动A整个草案；行动B目标保持不变',actionQuote='请修改行动A整个草案',draftA={content:'A旧草案',goal:'A旧目标'},draftB={content:'B旧草案',goal:'B旧目标'},finalA={content:'A新草案',goal:'A新目标'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC scoped preservation'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRunA=(await store.startRun(user,chat,randomUUID(),createA)).run
  event=(await store.finishRun(createRunA,{candidates:[],audit:[],coach:await stageCoachEvent(createRunA,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRunA.source_message_id,quote:createA},draft:draftA}},draftA.content)},draftA.content,null,signal)).event!
  const actionA=event.actions.find(action=>(action.draft as any)?.content===draftA.content)!
  const createRunB=(await store.startRun(user,chat,randomUUID(),createB)).run
  event=(await store.finishRun(createRunB,{candidates:[],audit:[],coach:await stageCoachEvent(createRunB,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRunB.source_message_id,quote:createB},draft:draftB}},draftB.content)},draftB.content,null,signal)).event!
  const currentA=event.actions.find(action=>action.id===actionA.id)!,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId:actionA.id,expectedRevision:currentA.revision,source:{messageId:modifyRun.source_message_id,quote:actionQuote},draft:finalA}},finalA.content)},finalA.content,null,signal)).event!
  assert.deepEqual(event.actions.find(action=>action.id===actionA.id)?.draft,finalA)
  assert.deepEqual(event.actions.find(action=>(action.draft as any)?.content===draftB.content)?.draft,draftB)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a prefix-colliding preservation subject does not constrain a longer selected action name',async()=>{
 const user='workflow-action-prefix-preservation-'+randomUUID(),chat=randomUUID(),title='前缀行动保护事项',createQuote='请写行动AB草案',modifyQuote='请修改行动AB整个草案；行动A目标保持不变',actionQuote='请修改行动AB整个草案',initial={content:'AB旧草案',goal:'AB旧目标'},next={content:'AB新草案',goal:'AB新目标'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC prefix preservation'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initial}},initial.content)},initial.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:actionQuote},draft:next}},next.content)},next.content,null,signal)).event!
  assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,next)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a suffix-colliding preservation subject does not constrain a longer selected action name',async()=>{
 const user='workflow-action-suffix-preservation-'+randomUUID(),chat=randomUUID(),title='后缀行动保护事项',createQuote='请写子行动A草案',modifyQuote='请修改子行动A整个草案；行动A目标保持不变',actionQuote='请修改子行动A整个草案',initial={content:'子A旧草案',goal:'子A旧目标'},next={content:'子A新草案',goal:'子A新目标'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC suffix preservation'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initial}},initial.content)},initial.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:actionQuote},draft:next}},next.content)},next.content,null,signal)).event!
  assert.deepEqual(event.actions.find(action=>action.id===actionId)?.draft,next)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('forgetting a staged preservation clause changes commit authority',async()=>{
 const user='workflow-action-forgotten-preservation-'+randomUUID(),chat=randomUUID(),title='保护子句遗忘事项',createQuote='请写一份行动草案',modifyQuote='请修改整个草案；目标保持不变',actionQuote='请修改整个草案',controlQuote='目标保持不变',initialDraft={content:'旧草案',goal:'按时提交'},finalDraft={content:'新草案',goal:'争取拿奖'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC forgotten preservation'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const staged=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:actionQuote},draft:finalDraft}},finalDraft.content)
  const controlStart=modifyQuote.indexOf(controlQuote),memoryId=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(controlQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:modifyRun.source_message_id,quote:controlQuote,range:{start:controlStart,end:controlStart+controlQuote.length}}])])
  await applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  await store.finishRun(modifyRun,{candidates:[],audit:[],coach:staged},finalDraft.content,null,signal)
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'proposed')
  assert.deepEqual(persisted.draft,finalDraft,'commit must drop a preservation control that was forgotten after staging')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('shared text cannot be fabricated across separate draft fields',async()=>{
 const user='workflow-action-cross-field-'+randomUUID(),chat=randomUUID(),title='替换文案事项',createQuote='请写一段旧文案',modifyQuote='请把这段文案完全改成全新内容',initialDraft={content:'前文甲乙丙丁',observable:'戊己庚辛后文'},finalDraft={content:'全新甲乙丙丁戊己庚辛内容'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC cross field action source'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录这个事项。')
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  const createAction=await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:createAction},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const modifyAction=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  await store.finishRun(modifyRun,{candidates:[],audit:[],coach:modifyAction},finalDraft.content,null,signal)
  const sourceMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[sourceMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,sourceMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'proposed','a full replacement does not inherit a source through synthetic field concatenation')
  assert.equal(persisted.draft.content,finalDraft.content)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('action field lineage drops a transitive source after every field it owned is replaced',async()=>{
 const user='workflow-action-field-lineage-'+randomUUID(),chat=randomUUID(),title='行动字段来源事项',createQuote='请写一条周五提交报告的提醒',observableQuote='请把判断标准改成导师确认',contentQuote='请把正文改成预算表',initialDraft={content:'周五提交报告',observable:'收到回复'},observableDraft={content:'周五提交报告',observable:'导师确认'},finalDraft={content:'预算表',observable:'导师确认'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC field lineage replacement'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,observableRun=(await store.startRun(user,chat,randomUUID(),observableQuote)).run
  event=(await store.finishRun(observableRun,{candidates:[],audit:[],coach:await stageCoachEvent(observableRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:observableRun.source_message_id,quote:observableQuote},draft:observableDraft}},observableDraft.content)},observableDraft.content,null,signal)).event!
  const contentRun=(await store.startRun(user,chat,randomUUID(),contentQuote)).run
  await store.finishRun(contentRun,{candidates:[],audit:[],coach:await stageCoachEvent(contentRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:contentRun.source_message_id,quote:contentQuote},draft:finalDraft}},finalDraft.content)},finalDraft.content,null,signal)
  const createMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[createMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,createMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const afterCreate=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(afterCreate.status,'proposed','the create source must disappear after its content and observable fields are both replaced')
  assert.deepEqual(afterCreate.draft,finalDraft)
  const observableMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[observableMemory,user,JSON.stringify(observableQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:observableRun.source_message_id,quote:observableQuote,range:{start:0,end:observableQuote.length}}])])
  await applyMemoryAction(user,observableMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const afterObservable=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(afterObservable.status,'stale','the still-surviving observable field must keep its own source authority')
  assert.equal(afterObservable.draft,null)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('action authority cannot move with identical text into another draft field',async()=>{
 const user='workflow-action-field-relocation-'+randomUUID(),chat=randomUUID(),title='行动字段搬移事项',createQuote='请写一条提交提醒',modifyQuote='请全部换成新内容',initialDraft={content:'周五提交报告',observable:'对方确认'},finalDraft={content:'预算表',observable:'周五提交报告'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC field relocation authority'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)},finalDraft.content,null,signal)
  const createMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[createMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,createMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'proposed','identical text in a different field is authorized by the current rewrite, not the old field source')
  assert.deepEqual(persisted.draft,finalDraft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a present but incomplete action field projection fails closed when the unowned field survives',async()=>{
 const user='workflow-action-partial-field-projection-'+randomUUID(),chat=randomUUID(),title='字段投影兼容事项',createQuote='请写一条提交提醒',modifyQuote='请把正文改成预算表',initialDraft={content:'周五提交报告',observable:'收到回复'},finalDraft={content:'预算表',observable:'收到回复'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC incomplete field projection'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id
  await pool.query("UPDATE coach_event_revisions SET snapshot=jsonb_set(snapshot,'{actionFieldSources}',jsonb_build_array((snapshot->'actionFieldSources')->0)) WHERE user_id=$1 AND event_id=$2 AND snapshot->>'actionId'=$3",[user,event.id,actionId])
  const modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const staged=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  await assert.rejects(()=>store.finishRun(modifyRun,{candidates:[],audit:[],coach:staged},finalDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','a partial modern projection must not borrow aggregate authority for its missing surviving field')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('an incomplete latest field projection is unavailable before another modification',async()=>{
 const user='workflow-action-incomplete-read-'+randomUUID(),chat=randomUUID(),title='字段投影读取事项',createQuote='请写一条提交提醒',modifyQuote='请把正文改成预算表',initialDraft={content:'周五提交报告',observable:'收到回复'},finalDraft={content:'预算表',observable:'收到回复'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC incomplete field read'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)},finalDraft.content,null,signal)).event!
  await pool.query("UPDATE coach_event_revisions SET snapshot=jsonb_set(snapshot,'{actionFieldSources}',jsonb_build_array((snapshot->'actionFieldSources')->0)) WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,event.revision])
  const damaged=await coachEventView(user,chat,event.id)
  assert.equal(damaged?.actions.find(action=>action.id===actionId)?.status,'stale','a modern read must fail closed before it exposes an unowned surviving field')
  assert.equal(damaged?.actions.find(action=>action.id===actionId)?.draft,null)
  const sourceMemory=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[sourceMemory,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,sourceMemory,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'stale','invalidation must not ignore an omitted surviving field authority')
  assert.equal(persisted.draft,null)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a malformed present action field projection is not treated as pre-projection compatibility data',async()=>{
 const user='workflow-action-malformed-field-projection-'+randomUUID(),chat=randomUUID(),title='损坏字段投影事项',createQuote='请写一条提交提醒',modifyQuote='请把正文改成预算表',initialDraft={content:'周五提交报告',observable:'收到回复'},finalDraft={content:'预算表',observable:'收到回复'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC malformed field projection'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id
  await pool.query("UPDATE coach_event_revisions SET snapshot=jsonb_set(snapshot,'{actionFieldSources}','{}'::jsonb) WHERE user_id=$1 AND event_id=$2 AND snapshot->>'actionId'=$3",[user,event.id,actionId])
  const modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const staged=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  await assert.rejects(()=>store.finishRun(modifyRun,{candidates:[],audit:[],coach:staged},finalDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a malformed newest action provenance cannot borrow an older revision owner',async()=>{
 const user='workflow-action-newest-provenance-'+randomUUID(),chat=randomUUID(),title='最新来源修订事项',createQuote='请写一句初始内容',replaceQuote='请全部换成新内容',extendQuote='请加上判断标准',malformedQuestion='这条内容还要发给谁？',initialDraft={content:'初始内容'},replacedDraft={content:'新内容'},finalDraft={content:'新内容',observable:'完成确认'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC newest provenance boundary'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id
  await pool.query("UPDATE coach_event_revisions SET snapshot=snapshot-'actionFieldSources' WHERE user_id=$1 AND event_id=$2 AND snapshot->>'actionId'=$3",[user,event.id,actionId])
  const replaceRun=(await store.startRun(user,chat,randomUUID(),replaceQuote)).run
  event=(await store.finishRun(replaceRun,{candidates:[],audit:[],coach:await stageCoachEvent(replaceRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:replaceRun.source_message_id,quote:replaceQuote},draft:replacedDraft}},replacedDraft.content)},replacedDraft.content,null,signal)).event!
  await pool.query("UPDATE coach_event_revisions SET snapshot=jsonb_set(snapshot-'actionId'-'actionSource'-'actionSources','{actionFieldSources}','{}'::jsonb) WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,event.revision])
  await pool.query("UPDATE coach_event_revisions SET snapshot=jsonb_set(jsonb_set(snapshot,'{askedThisTurn}',jsonb_build_array($4::text)),'{event,asked}',COALESCE(snapshot#>'{event,asked}','[]'::jsonb)||jsonb_build_array($4::text)) WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,event.revision,malformedQuestion])
  const malformedView=await coachEventView(user,chat,event.id)
  assert.equal(malformedView?.actions[0]?.status,'stale','a modern material revision without exact provenance is unavailable immediately')
  assert.equal(malformedView?.actions[0]?.draft,null)
  assert.ok(!malformedView?.asked.includes(malformedQuestion),'a malformed newest material revision cannot bind a question to an older action owner')
  const extendRun=(await store.startRun(user,chat,randomUUID(),extendQuote)).run
  const staged=await stageCoachEvent(extendRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:extendRun.source_message_id,quote:extendQuote},draft:finalDraft}},finalDraft.content)
  await assert.rejects(()=>store.finishRun(extendRun,{candidates:[],audit:[],coach:staged},finalDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','the latest create/modify revision is authoritative even when its redundant top-level source union is damaged')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a wrong non-empty newest action id cannot borrow an older revision owner',async()=>{
 const user='workflow-action-wrong-newest-id-'+randomUUID(),chat=randomUUID(),title='错误行动标识事项',createQuote='请写一句初始内容',replaceQuote='请全部换成新内容',question='这条内容还要发给谁？',initialDraft={content:'初始内容'},replacedDraft={content:'新内容'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC wrong newest action id'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id
  await pool.query("UPDATE coach_event_revisions SET snapshot=snapshot-'actionFieldSources' WHERE user_id=$1 AND event_id=$2 AND snapshot->>'actionId'=$3",[user,event.id,actionId])
  const replaceRun=(await store.startRun(user,chat,randomUUID(),replaceQuote)).run
  event=(await store.finishRun(replaceRun,{candidates:[],audit:[],coach:await stageCoachEvent(replaceRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:replaceRun.source_message_id,quote:replaceQuote},draft:replacedDraft}},replacedDraft.content)},replacedDraft.content,null,signal)).event!
  const wrongId=randomUUID(),replacementSource={messageId:replaceRun.source_message_id,conversationId:chat,quote:replaceQuote,range:{start:0,end:replaceQuote.length}},binding=[{question,sources:[replacementSource]}]
  await pool.query("UPDATE coach_event_revisions SET snapshot=jsonb_set((snapshot-'actionFieldSources')||jsonb_build_object('actionId',$4::text,'askedThisTurn',jsonb_build_array($5::text),'currentQuestionBindings',$6::jsonb),'{event,asked}',COALESCE(snapshot#>'{event,asked}','[]'::jsonb)||jsonb_build_array($5::text)) WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,event.revision,wrongId,question,JSON.stringify(binding)])
  const damaged=await coachEventView(user,chat,event.id)
  assert.equal(damaged?.actions[0]?.status,'stale','an explicit id outside the active action projection is a malformed modern revision')
  assert.equal(damaged?.actions[0]?.draft,null)
  assert.ok(!damaged?.asked.includes(question),'a carried question cannot trust a malformed non-empty action identity')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a newest material revision cannot collide with another active action id',async()=>{
 const user='workflow-action-cross-id-'+randomUUID(),chat=randomUUID(),title='多行动标识隔离事项',tableQuote='请帮我写一份预算表',messageQuote='请帮我写一条跟进消息',modifyQuote='请把预算表改成两列',question='预算表要几列？',initialTable={content:'| 项目 | 金额 |\n|---|---|\n|打印|30元|'},messageDraft={content:'老师您好，想跟进一下目前进度。'},changedTable={content:'| 项目 | 预算金额 |\n|---|---|\n|打印|30元|'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC cross action id'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const tableRun=(await store.startRun(user,chat,randomUUID(),tableQuote)).run
  event=(await store.finishRun(tableRun,{candidates:[],audit:[],coach:await stageCoachEvent(tableRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:tableRun.source_message_id,quote:tableQuote},draft:initialTable}},initialTable.content)},initialTable.content,null,signal)).event!
  const tableAction=event.actions[0]!
  const messageRun=(await store.startRun(user,chat,randomUUID(),messageQuote)).run
  event=(await store.finishRun(messageRun,{candidates:[],audit:[],coach:await stageCoachEvent(messageRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:messageRun.source_message_id,quote:messageQuote},draft:messageDraft}},messageDraft.content)},messageDraft.content,null,signal)).event!
  const messageAction=event.actions.find(action=>action.id!==tableAction.id)!
  const modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId:tableAction.id,expectedRevision:tableAction.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:changedTable}},changedTable.content)},changedTable.content,null,signal)).event!
  const modifySource={messageId:modifyRun.source_message_id,conversationId:chat,quote:modifyQuote,range:{start:0,end:modifyQuote.length}},binding=[{question,sources:[modifySource]}]
  await pool.query("UPDATE coach_event_revisions SET snapshot=jsonb_set((snapshot-'actionFieldSources')||jsonb_build_object('actionId',$4::text,'askedThisTurn',jsonb_build_array($5::text),'currentQuestionBindings',$6::jsonb),'{event,asked}',COALESCE(snapshot#>'{event,asked}','[]'::jsonb)||jsonb_build_array($5::text)) WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,event.revision,messageAction.id,question,JSON.stringify(binding)])
  const damaged=await coachEventView(user,chat,event.id),table=damaged?.actions.find(action=>action.id===tableAction.id),message=damaged?.actions.find(action=>action.id===messageAction.id)
  assert.equal(table?.status,'stale','the actually changed action fails closed when its revision names an active sibling')
  assert.equal(table?.draft,null)
  assert.equal(message?.status,'proposed','the unchanged sibling keeps its own authority')
  assert.deepEqual(message?.draft,messageDraft)
  assert.ok(message?.requestSources?.some(source=>source.messageId===messageRun.source_message_id&&source.quote===messageQuote))
  assert.ok(!message?.requestSources?.some(source=>source.messageId===modifyRun.source_message_id),'the sibling cannot inherit the changed action request')
  assert.ok(!damaged?.asked.includes(question),'a carried question cannot cross-bind through the sibling action id')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a damaged modern multi-action revision is an invalidation barrier, not an older-source fallback',async()=>{
 const user='workflow-action-modern-multi-barrier-'+randomUUID(),chat=randomUUID(),title='多行动损坏来源事项',firstQuote='请写一句初稿',secondQuote='请写一句备用稿',modifyQuote='请把初稿改成终稿',firstDraft={content:'初稿内容'},secondDraft={content:'备用稿内容'},finalDraft={content:'终稿内容'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC modern multi action barrier'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const firstRun=(await store.startRun(user,chat,randomUUID(),firstQuote)).run
  event=(await store.finishRun(firstRun,{candidates:[],audit:[],coach:await stageCoachEvent(firstRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:firstRun.source_message_id,quote:firstQuote},draft:firstDraft}},firstDraft.content)},firstDraft.content,null,signal)).event!
  const firstId=event.actions[0]!.id,secondRun=(await store.startRun(user,chat,randomUUID(),secondQuote)).run
  event=(await store.finishRun(secondRun,{candidates:[],audit:[],coach:await stageCoachEvent(secondRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:secondRun.source_message_id,quote:secondQuote},draft:secondDraft}},secondDraft.content)},secondDraft.content,null,signal)).event!
  const first=event.actions.find(action=>action.id===firstId)!,modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  event=(await store.finishRun(modifyRun,{candidates:[],audit:[],coach:await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId:firstId,expectedRevision:first.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)},finalDraft.content,null,signal)).event!
  await pool.query("UPDATE coach_event_revisions SET snapshot=jsonb_set(snapshot-'actionSource'-'actionSources'-'actionFieldSources','{actionId}','null'::jsonb) WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,event.revision])
  const view=await coachEventView(user,chat,event.id),damaged=view?.actions.find(action=>action.id===firstId)
  assert.equal(damaged?.status,'stale','an unidentifiable modern multi-action modification cannot expose new material under an older owner')
  assert.equal(damaged?.draft,null)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a genuine pre-actionChange revision reconstructs its unique request and invalidates consistently',async()=>{
 const user='workflow-action-genuine-legacy-'+randomUUID(),chat=randomUUID(),title='真实旧格式事项',createQuote='请写一份预算表',draft={content:'预算表\n项目 | 金额\n资料 | 100'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC genuine legacy action'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft}},draft.content)},draft.content,null,signal)).event!
  const actionId=event.actions[0]!.id
  await pool.query("UPDATE coach_event_revisions SET snapshot=snapshot-'actionChange'-'actionId'-'actionSource'-'actionSources'-'actionFieldSources' WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,event.revision])
  await pool.query('UPDATE coach_actions SET consumed_request_sources=NULL WHERE user_id=$1 AND id=$2',[user,actionId])
  const legacyView=await coachEventView(user,chat,event.id)
  assert.equal(legacyView?.actions[0]?.status,'proposed','a unique genuine legacy request remains readable')
  assert.deepEqual(legacyView?.actions[0]?.draft,draft)
  const unrelatedRun=(await store.startRun(user,chat,randomUUID(),'请写一条跟进消息')).run
  event=(await store.finishRun(unrelatedRun,{candidates:[],audit:[],coach:await stageCoachEvent(unrelatedRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'reuse',actionId,expectedRevision:event.actions[0]!.revision}},'继续沿用现有预算表。')},'继续沿用现有预算表。',null,signal)).event!
  await pool.query("UPDATE coach_event_revisions SET snapshot=snapshot-'actionChange'-'actionId' WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,event.revision])
  const memoryId=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','taskConstraints',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(createQuote),JSON.stringify([{type:'message',conversationId:chat,messageId:createRun.source_message_id,quote:createQuote,range:{start:0,end:createQuote.length}}])])
  await applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  const persisted=(await pool.query('SELECT status,draft FROM coach_actions WHERE user_id=$1 AND id=$2',[user,actionId])).rows[0]
  assert.equal(persisted.status,'stale','the same reconstructed legacy request controls invalidation')
  assert.equal(persisted.draft,null)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a genuine legacy action remains authoritative beyond the eight-revision process window',async()=>{
 const user='workflow-action-legacy-long-history-'+randomUUID(),chat=randomUUID(),title='长期旧行动事项',createQuote='请写一份预算表',draft={content:'预算表\n项目 | 金额\n资料 | 100'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC long legacy action'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft}},draft.content)},draft.content,null,signal)).event!
  await pool.query("UPDATE coach_event_revisions SET snapshot=snapshot-'actionChange'-'actionId'-'actionSource'-'actionSources'-'actionFieldSources' WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,event.revision])
  await pool.query('UPDATE coach_actions SET consumed_request_sources=NULL WHERE user_id=$1 AND id=$2',[user,event.actions[0]!.id])
  for(let index=0;index<9;index++){
   const text=`我补充第${index+1}条无关记录`,run=(await store.startRun(user,chat,randomUUID(),text)).run
   const staged=await stageCoachEvent(run,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},'已记录。')
   event=(await store.finishRun(run,{candidates:[],audit:[],coach:staged},'已记录。',null,signal)).event!
  }
  const longView=await coachEventView(user,chat,event.id)
  assert.equal(longView?.actions[0]?.status,'proposed','bounded process history cannot expire durable legacy action authority')
  assert.deepEqual(longView?.actions[0]?.draft,draft)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a modern action keeps its public request source beyond the eight-revision read window',async()=>{
 const user='workflow-action-modern-long-history-'+randomUUID(),chat=randomUUID(),title='长期现代行动事项',createQuote='请写一份预算表',draft={content:'预算表\n项目 | 金额\n资料 | 100'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC long modern action'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft}},draft.content)},draft.content,null,signal)).event!
  for(let index=0;index<9;index++){
   const text=`现代行动补充第${index+1}条无关记录`,run=(await store.startRun(user,chat,randomUUID(),text)).run
   event=(await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},'已记录。')},'已记录。',null,signal)).event!
  }
  const action=(await coachEventView(user,chat,event.id))?.actions[0]
  assert.equal(action?.status,'proposed')
  assert.ok(action?.requestSources?.some(source=>source.messageId===createRun.source_message_id&&source.quote===createQuote),'bounded process history cannot erase a modern action\'s public request provenance')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a persisted fact-backed question remains authoritative beyond the eight-revision read window',async()=>{
 const user='workflow-question-long-history-'+randomUUID(),chat=randomUUID(),title='长期问题来源事项',fact='我的专业是软件工程',question='软件工程会影响下一步吗？',signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC long question authority'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const factRun=(await store.startRun(user,chat,randomUUID(),fact)).run
  event=(await store.finishRun(factRun,{candidates:[],audit:[],coach:await stageCoachEvent(factRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision}},question,[{content:fact,source:{messageId:factRun.source_message_id,quote:fact}}])},question,null,signal)).event!
  assert.ok(event.asked.includes(question))
  for(let index=1;index<=9;index++){
   const update='第'+index+'次仅记录状态',reply='已记录第'+index+'次状态。',run=(await store.startRun(user,chat,randomUUID(),update)).run
   event=(await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision}},reply)},reply,null,signal)).event!
  }
  const readback=await coachEventView(user,chat,event.id)
  assert.ok(readback?.asked.includes(question),'a durable exact question binding cannot expire merely because its originating revision aged out')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a provenance-shaped reuse revision cannot replace the latest material revision',async()=>{
 const user='workflow-action-reuse-provenance-'+randomUUID(),chat=randomUUID(),title='沿用修订来源事项',createQuote='请写一条提交提醒',reuseText='继续沿用这条提醒',modifyQuote='请把正文改成预算表',initialDraft={content:'周五提交报告',observable:'收到回复'},finalDraft={content:'预算表',observable:'收到回复'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC reuse provenance boundary'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,reuseRun=(await store.startRun(user,chat,randomUUID(),reuseText)).run
  event=(await store.finishRun(reuseRun,{candidates:[],audit:[],coach:await stageCoachEvent(reuseRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'reuse',actionId,expectedRevision:event.actions[0]!.revision}},'继续沿用。')},'继续沿用。',null,signal)).event!
  await pool.query("UPDATE coach_event_revisions SET snapshot=jsonb_set(snapshot,'{actionFieldSources}','{}'::jsonb) WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,event.revision])
  const modifyRun=(await store.startRun(user,chat,randomUUID(),modifyQuote)).run
  const staged=await stageCoachEvent(modifyRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:modifyRun.source_message_id,quote:modifyQuote},draft:finalDraft}},finalDraft.content)
  const committed=await store.finishRun(modifyRun,{candidates:[],audit:[],coach:staged},finalDraft.content,null,signal)
  assert.deepEqual(committed.event?.actions[0]?.draft,finalDraft,'reuse metadata cannot shadow the create/modify provenance chain')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('a reuse revision cannot replace action provenance used by a later question',async()=>{
 const user='workflow-action-reuse-question-source-'+randomUUID(),chat=randomUUID(),title='沿用问题来源事项',createQuote='请写一条发给导师的消息',reuseText='继续沿用这条消息',question='这条消息发给谁？',draft={content:'老师您好，想和您确认一下进展。'},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC reuse question provenance'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft}},draft.content)},draft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,reuseRun=(await store.startRun(user,chat,randomUUID(),reuseText)).run
  event=(await store.finishRun(reuseRun,{candidates:[],audit:[],coach:await stageCoachEvent(reuseRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'reuse',actionId,expectedRevision:event.actions[0]!.revision}},'继续沿用。')},'继续沿用。',null,signal)).event!
  const staleSource={messageId:reuseRun.source_message_id,conversationId:chat,quote:reuseText,range:{start:0,end:reuseText.length}}
  await pool.query("UPDATE coach_event_revisions SET snapshot=jsonb_set(jsonb_set(snapshot,'{actionSource}',$4::jsonb),'{actionSources}',jsonb_build_array($4::jsonb)) WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,event.revision,JSON.stringify(staleSource)])
  const questionRun=(await store.startRun(user,chat,randomUUID(),'我还没决定')).run
  event=(await store.finishRun(questionRun,{candidates:[],audit:[],coach:await stageCoachEvent(questionRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision}},question)},question,null,signal)).event!
  const bindings=(await pool.query("SELECT snapshot->'questionBindings' AS bindings FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 ORDER BY revision DESC LIMIT 1",[user,event.id])).rows[0]?.bindings
  const sources=Array.isArray(bindings)?bindings.find((binding:any)=>binding?.question===question)?.sources:[]
  assert.equal(sources?.[0]?.messageId,createRun.source_message_id,'question provenance must come from the latest create/modify revision, not reuse metadata')
  assert.notEqual(sources?.[0]?.messageId,reuseRun.source_message_id)
  await pool.query("UPDATE coach_event_revisions SET snapshot=snapshot-'currentQuestionBindings'-'questionBindings'-'questionSources' WHERE user_id=$1 AND event_id=$2 AND revision=$3",[user,event.id,event.revision])
  assert.ok((await coachEventView(user,chat,event.id))?.asked.includes(question),'the compatibility projection retains the still-authoritative question')
  await transaction(c=>invalidateCoachSourceQuotes(c,user,[{messageId:createRun.source_message_id,quote:createQuote}],true))
  assert.ok(!(await coachEventView(user,chat,event.id))?.asked.includes(question),'forgetting the create source must retire a compatibility-path question despite stale reuse metadata')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('ambiguous similar material items fail closed instead of inheriting by array order',async()=>{
 const user='workflow-action-ambiguous-material-lineage-'+randomUUID(),chat=randomUUID(),title='材料列表来源事项',createQuote='请写一份项目报告清单',addQuote='请加上项目预算',shortenQuote='请把材料缩短成提交项目',initialDraft={content:'项目提交清单',materials:['提交项目报告']},addedDraft={content:'项目提交清单',materials:['提交项目报告','提交项目预算']},finalDraft={content:'项目提交清单',materials:['提交项目']},signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC ambiguous material lineage'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录。')},'已记录。',null,signal)).event!
  const createRun=(await store.startRun(user,chat,randomUUID(),createQuote)).run
  event=(await store.finishRun(createRun,{candidates:[],audit:[],coach:await stageCoachEvent(createRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',source:{messageId:createRun.source_message_id,quote:createQuote},draft:initialDraft}},initialDraft.content)},initialDraft.content,null,signal)).event!
  const actionId=event.actions[0]!.id,addRun=(await store.startRun(user,chat,randomUUID(),addQuote)).run
  event=(await store.finishRun(addRun,{candidates:[],audit:[],coach:await stageCoachEvent(addRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:addRun.source_message_id,quote:addQuote},draft:addedDraft}},addedDraft.content)},addedDraft.content,null,signal)).event!
  const shortenRun=(await store.startRun(user,chat,randomUUID(),shortenQuote)).run
  const staged=await stageCoachEvent(shortenRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'modify',actionId,expectedRevision:event.actions[0]!.revision,source:{messageId:shortenRun.source_message_id,quote:shortenQuote},draft:finalDraft}},finalDraft.content)
  await assert.rejects(()=>store.finishRun(shortenRun,{candidates:[],audit:[],coach:staged},finalDraft.content,null,signal),(error:any)=>error?.code==='COACH_ACTION_SOURCE_REQUIRED','one shortened material cannot silently choose between two matching prior owners')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test('workflow envelope fails closed when a fact source is forgotten after its event snapshot',async()=>{
 const user='workflow-envelope-race-'+randomUUID(),chat=randomUUID(),title='独立事项',fact='我已经联系了导师',signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 let held:PoolClient|undefined,forgetPromise:ReturnType<typeof applyMemoryAction>|undefined,pending:ReturnType<typeof readActionEnvelope>|undefined
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC workflow envelope race'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录这个事项。')
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
  const factRun=(await store.startRun(user,chat,randomUUID(),fact)).run
  const continued=await stageCoachEvent(factRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:factRun.source_message_id,quote:fact}}]},'已记录联系进展。')
  event=(await store.finishRun(factRun,{candidates:[],audit:[],coach:continued},continued.reply,null,signal)).event!
  const memoryId=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(fact),JSON.stringify([{type:'message',conversationId:chat,messageId:factRun.source_message_id,quote:fact,range:{start:0,end:fact.length}}])])
  const base=fixture().request,request:WorkflowRequest={...base,requestId:randomUUID(),traceId:randomUUID(),internalActorKey:user,conversationId:chat,eventId:event.id,currentIntent:'继续复盘',controls:{...base.controls,memoryEnabled:true},authorizedEvidenceRefs:[{type:'event',id:event.id,revision:event.revision}]}
  held=await pool.connect();await held.query('BEGIN');await held.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])
  forgetPromise=applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  let writerWaiting=false
  for(let i=0;i<200;i++){
   writerWaiting=Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event='advisory' AND query ILIKE '%pg_advisory_xact_lock%' ")).rows[0].n)>=1
   if(writerWaiting)break
   await new Promise(resolve=>setTimeout(resolve,5))
  }
  assert.equal(writerWaiting,true,'forget must queue first at the final account boundary')
  pending=readActionEnvelope(request)
  let envelopeWaiting=false
  for(let i=0;i<200;i++){
   envelopeWaiting=Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event='advisory' AND query ILIKE '%pg_advisory_xact_lock%' ")).rows[0].n)>=2
   if(envelopeWaiting)break
   await new Promise(resolve=>setTimeout(resolve,5))
  }
  assert.equal(envelopeWaiting,true,'envelope must finish its initial event snapshot before queuing final validation')
  await held.query('COMMIT');held.release();held=undefined
  await forgetPromise
  await assert.rejects(pending,(error:unknown)=>error instanceof WorkflowError&&error.code==='source_invalid')
 }finally{
  if(held){await held.query('ROLLBACK').catch(()=>{});held.release()}
  await forgetPromise?.catch(()=>{})
  await pending?.catch(()=>{})
  await pool.query('DELETE FROM "user" WHERE id=$1',[user])
 }
})

test('workflow envelope fails closed when its event conversation is deleted after the initial snapshot',async()=>{
 const user='workflow-envelope-delete-race-'+randomUUID(),chat=randomUUID(),title='待删除事项',signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 let gate:PoolClient|undefined,pending:ReturnType<typeof readActionEnvelope>|undefined,deletion:ReturnType<typeof store.deleteConversation>|undefined
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC deleted workflow envelope'})
  const run=(await store.startRun(user,chat,randomUUID(),title)).run
  const coach=await stageCoachEvent(run,{target:{operation:'create',title,source:{messageId:run.source_message_id,quote:title}}},'已记录这个事项。')
  const event=(await store.finishRun(run,{candidates:[],audit:[],coach},coach.reply,null,signal)).event!
  const base=fixture().request,request:WorkflowRequest={...base,requestId:randomUUID(),traceId:randomUUID(),internalActorKey:user,conversationId:chat,eventId:event.id,currentIntent:'继续复盘',controls:{...base.controls,memoryEnabled:true},authorizedEvidenceRefs:[{type:'event',id:event.id,revision:event.revision}]}

  gate=await pool.connect();await gate.query('BEGIN');await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])
  deletion=store.deleteConversation(user,chat)
  let deletionWaiting=false
  for(let i=0;i<200;i++){
   deletionWaiting=Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event='advisory' AND query ILIKE '%pg_advisory_xact_lock%' ")).rows[0].n)>=1
   if(deletionWaiting)break
   await new Promise(resolve=>setTimeout(resolve,5))
  }
  assert.equal(deletionWaiting,true,'deletion must queue its source-authority mutation before final validation')
  pending=readActionEnvelope(request)
  let waiting=false
  for(let i=0;i<200;i++){
   waiting=Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event='advisory' AND query ILIKE '%pg_advisory_xact_lock%' ")).rows[0].n)>=2
   if(waiting)break
   await new Promise(resolve=>setTimeout(resolve,5))
  }
  assert.equal(waiting,true,'envelope must finish its initial event snapshot before final validation')
  await gate.query('COMMIT');gate.release();gate=undefined
  await deletion;deletion=undefined
  await assert.rejects(pending,(error:unknown)=>error instanceof WorkflowError&&error.code==='source_invalid')
 }finally{
  if(gate){await gate.query('ROLLBACK').catch(()=>{});gate.release()}
  await deletion?.catch(()=>{})
  await pending?.catch(()=>{})
  await pool.query('DELETE FROM "user" WHERE id=$1',[user])
 }
})

test('workflow envelope final validation serializes source controls through one account snapshot',async()=>{
 const user='workflow-envelope-serialized-'+randomUUID(),chat=randomUUID(),title='串行事项',fact='我已经联系了导师',signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 let chronologyLock:PoolClient|undefined,forgetPromise:ReturnType<typeof applyMemoryAction>|undefined
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC serialized workflow envelope'})
  const opening=(await store.startRun(user,chat,randomUUID(),title)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:title}}},'已记录这个事项。')
  let event=(await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal)).event!
  const factRun=(await store.startRun(user,chat,randomUUID(),fact)).run
  const continued=await stageCoachEvent(factRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:factRun.source_message_id,quote:fact}}]},'已记录联系进展。')
  event=(await store.finishRun(factRun,{candidates:[],audit:[],coach:continued},continued.reply,null,signal)).event!
  const memoryId=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(fact),JSON.stringify([{type:'message',conversationId:chat,messageId:factRun.source_message_id,quote:fact,range:{start:0,end:fact.length}}])])
  const base=fixture().request,request:WorkflowRequest={...base,requestId:randomUUID(),traceId:randomUUID(),internalActorKey:user,conversationId:chat,eventId:event.id,currentIntent:'继续复盘',controls:{...base.controls,memoryEnabled:true},authorizedEvidenceRefs:[{type:'event',id:event.id,revision:event.revision}]}
  chronologyLock=await pool.connect();await chronologyLock.query('BEGIN');await chronologyLock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':interview-chronology'])
  const envelopePromise=readActionEnvelope(request)
  let envelopeWaiting=false
  for(let i=0;i<200;i++){
   envelopeWaiting=Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event='advisory' AND query ILIKE '%pg_advisory_xact_lock%' ")).rows[0].n)>=1
   if(envelopeWaiting)break
   await new Promise(resolve=>setTimeout(resolve,5))
  }
  assert.equal(envelopeWaiting,true,'envelope final source validation must own the earlier account locks before waiting for chronology')
  forgetPromise=applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  let sourceControlWaiting=false
  for(let i=0;i<200;i++){
   sourceControlWaiting=Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event='advisory' AND query ILIKE '%pg_advisory_xact_lock%' ")).rows[0].n)>=2
   if(sourceControlWaiting)break
   await new Promise(resolve=>setTimeout(resolve,5))
  }
  assert.equal(sourceControlWaiting,true,'source controls must wait for the envelope final snapshot instead of changing authority between its checks')
  await chronologyLock.query('COMMIT');chronologyLock.release();chronologyLock=undefined
  const envelope=await envelopePromise
  assert.equal(envelope.event.id,event.id)
  await forgetPromise
 }finally{
  if(chronologyLock){await chronologyLock.query('ROLLBACK').catch(()=>{});chronologyLock.release()}
  await forgetPromise?.catch(()=>{})
  await pool.query('DELETE FROM "user" WHERE id=$1',[user])
 }
})

test('workflow envelope drops guide usage forgotten before its final authority snapshot',async()=>{
 const read=(file:string)=>readFileSync('.planning/research/evergreen/'+file,'utf8').trim().split('\n').map(x=>JSON.parse(x))
 const cards=read('KB_GUIDES.jsonl') as KnowledgeCard[];await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
 const card=cards.find(c=>c.guide?.canonicalKey==='user-interview')!,user='workflow-guide-snapshot-'+randomUUID(),chat=randomUUID(),title='学长甲的项目课问题',signal=new AbortController().signal
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 let gate:PoolClient|undefined,forgetPromise:ReturnType<typeof applyMemoryAction>|undefined,envelopePromise:ReturnType<typeof readActionEnvelope>|undefined
 try{
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC guide snapshot'})
  const openingText='我想了解学长甲的项目课。',opening=(await store.startRun(user,chat,randomUUID(),openingText)).run
  const created=await stageCoachEvent(opening,{target:{operation:'create',title,source:{messageId:opening.source_message_id,quote:openingText}}},'已记录这个事项。')
  const saved=await store.finishRun(opening,{candidates:[],audit:[],coach:created},created.reply,null,signal),event=saved.event!
  const feedback='我愿意试这个方法，向学长甲询问项目课。',feedbackRun=(await store.startRun(user,chat,randomUUID(),feedback)).run
  const suggestion=suggestedGuideUsage(card,event.id)!,task=card.guide!.branches.find(branch=>branch.id===suggestion.branch)!.task
  const source=guideFeedbackSource(feedback,'accepted',{title,task})!
  assert.ok(source)
  await store.finishRun(feedbackRun,{candidates:[],audit:[],guideUsage:[{...suggestion,status:'accepted',sourceMessageId:feedbackRun.source_message_id,sourceQuote:source.quote,sourceRange:source.range}]},'已记录反馈。',null,signal)
  const memoryId=randomUUID()
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,valid_from,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),now(),'active')",[memoryId,user,JSON.stringify(feedback),JSON.stringify([{type:'message',conversationId:chat,messageId:feedbackRun.source_message_id,quote:feedback,range:{start:0,end:feedback.length}}])])
  const base=fixture().request,request:WorkflowRequest={...base,requestId:randomUUID(),traceId:randomUUID(),internalActorKey:user,conversationId:chat,eventId:event.id,currentIntent:'继续复盘',controls:{...base.controls,memoryEnabled:true},authorizedEvidenceRefs:[{type:'event',id:event.id,revision:event.revision}]}
  gate=await pool.connect();await gate.query('BEGIN');await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])
  forgetPromise=applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
  let writerWaiting=false
  for(let i=0;i<200;i++){
   writerWaiting=Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event='advisory' AND query ILIKE '%pg_advisory_xact_lock%' ")).rows[0].n)>=1
   if(writerWaiting)break
   await new Promise(resolve=>setTimeout(resolve,5))
  }
  assert.equal(writerWaiting,true,'forget must be queued before the envelope final snapshot')
  envelopePromise=readActionEnvelope(request)
  let envelopeWaiting=false
  for(let i=0;i<200;i++){
   envelopeWaiting=Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event='advisory' AND query ILIKE '%pg_advisory_xact_lock%' ")).rows[0].n)>=2
   if(envelopeWaiting)break
   await new Promise(resolve=>setTimeout(resolve,5))
  }
  assert.equal(envelopeWaiting,true,'envelope must finish its event snapshot before queuing final authority validation')
  await gate.query('COMMIT');gate.release();gate=undefined
  await forgetPromise
  const envelope=await envelopePromise
  assert.deepEqual(envelope.actionCase.usage,[],'final authority snapshot cannot return forgotten guide-only evidence')
 }finally{
  if(gate){await gate.query('ROLLBACK').catch(()=>{});gate.release()}
  await forgetPromise?.catch(()=>{})
  await envelopePromise?.catch(()=>{})
  await pool.query('DELETE FROM "user" WHERE id=$1',[user])
 }
})

test('workflow evidence resolves the authorized clause when one message backs multiple facts',async()=>{
 const user='workflow-exact-clause-'+randomUUID(),chat=randomUUID(),message='我完成了报告；我联系了导师',authorizedQuote='我联系了导师'
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:chat,title:'SYNTHETIC exact clause selection'})
  const run=(await store.startRun(user,chat,randomUUID(),message)).run
  const clauses=buildClauseCatalogue(message),completed=clauses.find(clause=>clause.text==='我完成了报告')!,contacted=clauses.find(clause=>clause.text===authorizedQuote)!
  assert.ok(completed);assert.ok(contacted)
  const completedSource=clauseMessageSource(run.source_message_id,completed),contactedSource=clauseMessageSource(run.source_message_id,contacted)
  const coach=await stageCoachEvent(run,{target:{operation:'create',title:'项目进展',source:completedSource},nodes:[{kind:'fact',source:completedSource},{kind:'fact',source:contactedSource},{kind:'fact',source:contactedSource}]},'已记录两个独立事实；重复节点沿用同一精确来源。')
  const saved=await store.finishRun(run,{candidates:[],audit:[],coach},coach.reply,null,new AbortController().signal)
  const base=fixture().request,request:WorkflowRequest={...base,requestId:randomUUID(),traceId:randomUUID(),internalActorKey:user,conversationId:chat,eventId:coach.eventId,currentIntent:'继续复盘联系导师',controls:{...base.controls,memoryEnabled:true},authorizedEvidenceRefs:[{type:'event',id:coach.eventId,revision:saved.event!.revision},{type:'message',id:run.source_message_id,revision:1,quote:authorizedQuote}]}
  const envelope=await readActionEnvelope(request),messageRecords=envelope.records.filter(record=>record.ref.type==='message'&&record.ref.id===run.source_message_id)
  assert.equal(messageRecords.length,1)
  assert.deepEqual(messageRecords[0]!.ref,{type:'message',id:run.source_message_id,revision:1},'workflow record refs keep the established public shape; exact quote authority stays internal')
  assert.equal(messageRecords[0]!.text,authorizedQuote)
  assert.notEqual(messageRecords[0]!.text,'我完成了报告')
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})


test('actual delivery phrasing reaches waiting feedback while adoption stays explicitly unknown',()=>{
 const f=actionFixture('我已经把排版稿交给负责人了，对方没回复，是否采用还不知道，也没有付款。')
 f.actionCase.known.used=true
 const result=reviewAction(f.request,f.actionCase,f.current)
 assert.equal(result.stages.sent,true);assert.equal(result.stages.used,null);assert.equal(result.stages.replied,false)
 assert.equal(result.feedback,'waiting_result');assert.ok(result.reply.includes('原因仍未知'))
 for(const text of ['我打算把排版稿交给负责人','如果我已经把排版稿交给负责人了怎么办？','同学说我已经把排版稿交给负责人了']){
  const f=actionFixture(text),r=reviewAction(f.request,f.actionCase,f.current)
  assert.equal(r.stages.sent,false,text);assert.equal(r.feedback,null,text)
 }
})
