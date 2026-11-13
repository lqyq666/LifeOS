import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {pool,transaction} from '../../server/db.ts'
import {stageCoachEvent,coachEventView,readCoachEvent,coachSourceControlKey,invalidateCoachSources,assertCoachEvidence,type CoachEvent} from '../../server/action-coach-events.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {searchCoachEvents,readMatterWorkingSet} from '../../server/coach-retrieval.ts'
import {requestsMatterOverview,assistantRequestClause} from '../../server/user-command-spans.ts'
import {stageGrowthUpdates,growthContext,growthView,applyGrowthAction} from '../../server/growth.ts'
const promptContext=(payload:any)=>JSON.parse(payload.messages.find((message:any)=>message.role==='user'&&message.content.startsWith('{')).content)

test('overview intent respects source ownership, negation and later cancellation',()=>{
 for(const text of ['帮我把手头这些事排个优先级。','我手头这些事先处理哪件？','请盘点我没做完的事项。','我有哪些没做完的事情？','我还有哪些待处理事项？']){assert.equal(requestsMatterOverview(text),true,text);assert.equal(assistantRequestClause(text),true,'an overview request is not autobiographical evidence')}
 for(const text of ['朋友说：“帮我把手头这些事排个优先级”。','```帮我把手头这些事排个优先级```','如果我请你盘点手头这些事。','不要盘点我手头这些事。','帮我把手头这些事排个优先级。不用盘点了。','帮他把手头这些事排个优先级。','我手头这些事已经请朋友帮我安排了。','我让朋友帮我把手头这些事排优先级。','请举例说明怎么给这些事排优先级。','优先级队列是什么？','今天只想聊聊，不要安排任务。'])assert.equal(requestsMatterOverview(text),false,text)
 for(const stop of ['不用安排了。','别看了。','不要统筹了。','别处理了。'])assert.equal(requestsMatterOverview('帮我看看手头这些事怎么安排。'+stop),false,stop)
 assert.equal(requestsMatterOverview('帮我盘点手头这些事。不要安排新任务。'),true,'a no-new-task boundary does not cancel an inventory request')
 for(const text of ['把我手头这些事排个优先级。','请把我手头的任务盘点一下。'])assert.equal(requestsMatterOverview(text),true,text)
 for(const text of ['帮我润色手头这封邮件。','帮我排查手头这个Bug。','请解释任务优先级队列。','帮我给这些任务各写一句描述。','帮我把这些任务描述一下。','帮我写这些任务的优先级说明。'])assert.equal(requestsMatterOverview(text),false,text)
})

test('a requested overview supplies multiple authorized matters, preserves stops and never fabricates a choice',async()=>{
 const h=await residualHarness();try{
 const {user,chat}=await h.account(),events:CoachEvent[]=[]
 for(const [title,detail,progress] of [
  ['报名表','报名表需要核对时间','我接受这个步骤。尚未执行'],
  ['课程报告','课程报告还缺一个数据说明','我接受这个步骤。我只完成了一部分'],
  ['实习咨询','实习咨询邮件已发给老师','我接受这个步骤。我在等待对方的反馈'],
  ['竞赛报名','竞赛报名准备先放下','我先暂停这件事'],
 ]){
  const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC overview '+title})
  const text=detail+'。'+progress+'。',run=(await store.startRun(user,conversation,randomUUID(),text)).run
  const event=(await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title,source:{messageId:run.source_message_id,quote:detail}},nodes:text.split('。').filter(Boolean).map(quote=>({kind:'fact' as const,source:{messageId:run.source_message_id,quote}}))},'已说明的实际状态分别保留。')},'已说明的实际状态分别保留。',null,new AbortController().signal)).event!
  events.push(event)
 }
 const nonTitleText='老师实际要求补一个图例',nonTitleRun=(await store.startRun(user,events[1].conversationId,randomUUID(),nonTitleText)).run
 const feedbackGrowth=await stageGrowthUpdates(nonTitleRun,[{target:{operation:'create'},kind:'context',assertion:'user_reported',text:nonTitleText,source:{messageId:nonTitleRun.source_message_id,quote:nonTitleText}}],await growthContext(user,nonTitleRun.conversation_id))
 events[1]=(await store.finishRun(nonTitleRun,{candidates:[],audit:[],growth:feedbackGrowth,coach:await stageCoachEvent(nonTitleRun,{target:{operation:'continue',eventId:events[1].id,expectedRevision:events[1].revision},nodes:[{kind:'fact',source:{messageId:nonTitleRun.source_message_id,quote:nonTitleText}}]},'这条具体反馈保留原来的来源。')},'这条具体反馈保留原来的来源。',null,new AbortController().signal)).event!
 const semanticOnly=await searchCoachEvents(user,chat,{query:'帮我把手头这些事排个优先级。'})
 assert.equal(semanticOnly.events.length,3,'existing semantic-only path supplies at most three of these four distinct matters')
 const other=await h.account(),secret='SECOND_OWNER_PRIVATE_MATTER',otherRun=(await store.startRun(other.user,other.chat,randomUUID(),secret)).run
 await store.finishRun(otherRun,{candidates:[],audit:[],coach:await stageCoachEvent(otherRun,{target:{operation:'create',title:secret,source:{messageId:otherRun.source_message_id,quote:secret}},nodes:[{kind:'fact',source:{messageId:otherRun.source_message_id,quote:secret}}]},'仅供来源所有者使用。')},'仅供来源所有者使用。',null,new AbortController().signal)
 const before=h.requests.length
 const result=await h.execute(user,chat,'帮我把手头这些事排个优先级。',{},'先核对报名表的时间字段。课程报告的部分进度与等待老师回复分别保留；竞赛仍暂停。这是建议，你还没有选择或执行新的安排。')
 assert.equal(h.requests.length,before+1,'one generation, no extra planner/extractor')
 const metadata=promptContext(h.requests.at(-1)),supplied=[metadata.readOnlyEventWorkspace,...metadata.readOnlyRelatedEventWorkspaces??[]].filter(Boolean)
 assert.ok(!JSON.stringify(metadata).includes(secret),'working set cannot read another owner')
 for(const event of events)assert.ok(supplied.some((e:any)=>e.eventRef.id===event.id),'requested overview must cover '+event.title+' beyond top-three semantic retrieval')
 assert.equal(metadata.matterOverview.scope,'CURRENT_AUTHORIZED_BOUNDED_WORKING_SET')
 assert.equal(metadata.matterOverview.entries.find((e:any)=>e.eventId===events[3].id).disposition,'do_not_resume')
 const audit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,result.request_id])).rows[0].tool_audit
 const refs=audit.find((x:any)=>x.phase==='coach_context_bound').eventRefs
 for(const event of events)assert.ok(refs.some((ref:any)=>ref.eventId===event.id),'all supplied evidence joins existing save-time version validation')
 assert.ok(refs.every((ref:any)=>typeof ref.sourceControlKey==='string'),'overview binds exact current source controls as well as event generations')
 assert.equal((await coachEventView(user,events[3].conversationId,events[3].id))!.matterProgress!.state,'paused')
 assert.equal((await coachEventView(user,events[0].conversationId,events[0].id))!.matterProgress!.state,'unattempted')
 const revokedSource=events[0].nodes.find(node=>node.source)!.source!.messageId
 await transaction(c=>invalidateCoachSources(c,user,[revokedSource],true))
 await assert.rejects(transaction(c=>assertCoachEvidence(c,user,chat,refs)),/NOT_FOUND|COACH_SOURCE_REVOKED|COACH_SNAPSHOT_INVALIDATED/,'withdrawing any supplied matter invalidates the original saved-answer evidence set')
 const nonTitleRefs=refs.filter((ref:any)=>ref.eventId===events[1].id)
 await transaction(c=>assertCoachEvidence(c,user,chat,nonTitleRefs))
 const reader=await pool.connect(),writer=await pool.connect();let mutation:Promise<unknown>|undefined
 try{
  await reader.query('BEGIN');await reader.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])
  await readCoachEvent(reader,user,chat,events[1].id);const key=await coachSourceControlKey(reader,user,events[1].id)
  const growth=(await growthView(user,nonTitleRun.conversation_id)).items.find(item=>item.text===nonTitleText)!
  await writer.query('BEGIN');const pid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  mutation=applyGrowthAction(writer,user,growth.id,{requestId:randomUUID(),expectedRevision:growth.revision,action:'correct',text:'老师实际要求补两个图例'})
  let waiting=false;for(let i=0;i<100;i++){if((await reader.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type==='Lock'){waiting=true;break}await reader.query('SELECT pg_sleep(0.01)')}
  assert.ok(waiting,'actual source-control writer waits on the same memory mutex as canonical read/key and answer commit')
  assert.equal(await coachSourceControlKey(reader,user,events[1].id),key)
 }finally{await reader.query('ROLLBACK');try{if(mutation)await mutation}finally{await writer.query('ROLLBACK');reader.release();writer.release()}}
 // Legacy/coexistence controls can change a source boundary without advancing
 // the event generation. A non-title source must still invalidate that answer.
 await pool.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4)',[user,nonTitleRun.conversation_id,nonTitleRun.source_message_id,nonTitleText])
 await assert.rejects(transaction(c=>assertCoachEvidence(c,user,chat,nonTitleRefs)),/COACH_SNAPSHOT_INVALIDATED/)
 assert.equal((await coachEventView(user,chat,events[1].id))!.id,events[1].id,'the unchanged title does not hide a revoked non-title source')
 await h.execute(user,chat,'请盘点我手头这些事。',{},'报名表的旧来源不再使用，其他事项按各自仍可用的状态讨论；暂停事项不恢复。')
 assert.ok(!promptContext(h.requests.at(-1)).matterOverview.entries.some((e:any)=>e.eventId===events[0].id))
 const recentStops:string[]=[]
 for(let i=0;i<11;i++){
  const sourceText=i<9?'我接受这个步骤。尚未执行。近期独立事项'+i:i===9?'我先暂停这件事。新的暂停事项':'我结束这件事。新的结束事项'
  const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC bounded overflow '+i})
  const run=(await store.startRun(user,conversation,randomUUID(),sourceText)).run
  const event=(await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'create',title:'独立事项'+i,source:{messageId:run.source_message_id,quote:sourceText}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:sourceText}}]},'来源属于这个独立事项。')},'来源属于这个独立事项。',null,new AbortController().signal)).event!
  if(i>=9)recentStops.push(event.id)
 }
 const bounded=await readMatterWorkingSet(user,chat,undefined,events.slice(1).map(event=>event.id))
 for(const id of [...recentStops,...events.slice(1).map(event=>event.id)])assert.ok(bounded.events.some(event=>event.id===id),'canonical stops and explicitly related cases both survive a full working set')
 assert.equal(bounded.coverage.moreAvailable,true);assert.ok(bounded.events.length<=14)
 await h.execute(user,chat,'1+1等于多少？',{},'2。')
 assert.equal(promptContext(h.requests.at(-1)).matterOverview,undefined,'ordinary questions do not load an agenda')
 await setMemorySettings(user,{requestId:randomUUID(),enabled:false,expectedRevision:1})
 const isolated=randomUUID();await store.createConversation(user,{id:isolated,title:'SYNTHETIC memory off overview'})
 await h.execute(user,isolated,'帮我把手头这些事排个优先级。',{},'当前会话还没有可核对的事项，先告诉我一件你想处理的事。')
 const off=promptContext(h.requests.at(-1))
 assert.ok(!(off.events??off.readOnlyRelatedEventWorkspaces??[]).length);assert.ok(!JSON.stringify(off).includes('报名表需要核对时间'))
 }finally{await h.close()}
})
