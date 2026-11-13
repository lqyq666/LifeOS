import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import * as store from '../../server/store.ts'
import {growthView} from '../../server/growth.ts'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import {coachEventView,stageCoachEvent} from '../../server/action-coach-events.ts'
import type {EventDelta} from '../../server/action-coach-contracts.ts'
import {reviewAction,type ActionCase} from '../../server/workflows/action-review.ts'
import {fixture} from '../workflows/fixtures.ts'

test('continuous feedback remains usable in the next conversation',async t=>{
 const h=await residualHarness()
 try{
  await t.test('partly attempted is preserved as attempted instead of normalized to unknown',async()=>{
   const {user,chat}=await h.account()
   await h.execute(user,chat,'我已经开始核对岗位要求了，但还没有完成。',{growthUpdates:[{target:{operation:'create'},kind:'feedback',assertion:'user_reported',source:{clauseId:'c0'},progressState:'attempted'}]},'你已开始核对，尚未完成；这只说明本次进度，不能推断稳定能力。')
   const feedback=(await growthView(user,chat)).items.find(item=>item.kind==='feedback'&&item.text.includes('核对岗位'))
   assert.ok(feedback);assert.equal(feedback.progressState,'attempted')
   const second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC next help'})
   await h.execute(user,second,'接着核对岗位这件事，只说明现在做到哪了，不要保存新档案。',{},'你已经开始核对岗位要求；后面的完成情况尚未报告。')
   assert.match(JSON.stringify(h.requests.at(-1).messages),/attempted/)
  })
  for(const [text,state] of [['我核对岗位要求时卡住了。','stuck'],['我还没有开始核对岗位要求。','unattempted'],['我已经发出了岗位咨询邮件，现在还在等对方回复。','completed']] as const)await t.test('adjacent feedback: '+state,async()=>{
   const {user,chat}=await h.account();await h.execute(user,chat,text,{growthUpdates:[{target:{operation:'create'},kind:'feedback',assertion:'user_reported',source:{clauseId:'c0'},progressState:state}]},'按你报告的本次动作进度承接，结果与能力结论仍分别核对。')
   assert.ok((await growthView(user,chat)).items.some(item=>item.kind==='feedback'&&item.progressState===state))
  })
  await t.test('a proposal and an accepted but unexecuted choice remain distinct after cross-chat read',async()=>{
   const {user,chat}=await h.account(),text='我想核对一个岗位要求，请帮我拟一个核对步骤。'
   const first=(await store.startRun(user,chat,randomUUID(),text)).run
   const delta:EventDelta={target:{operation:'create',title:'核对岗位要求',source:{messageId:first.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:first.source_message_id,quote:'我想核对一个岗位要求'}}],action:{operation:'create',draft:{content:'先打开一份岗位说明，核对一项具体要求，不清楚的保留未知。'}}}
   const result=await store.finishRun(first,{candidates:[],audit:[],coach:await stageCoachEvent(first,delta,'先打开一份岗位说明，核对一项具体要求，不清楚的保留未知。')},'先打开一份岗位说明，核对一项具体要求，不清楚的保留未知。',null,new AbortController().signal)
   const proposed=result.event!;assert.equal((proposed as any).matterProgress.state,'proposed');assert.equal((proposed as any).matterProgress.choice,'unknown')
   const second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC continue the same matter'})
   const input='我接受你刚才建议的这个步骤，但我还没有开始执行。',run=(await store.startRun(user,second,randomUUID(),input)).run
   const continuation:EventDelta={target:{operation:'continue',eventId:proposed.id,expectedRevision:proposed.revision},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:input}}]}
   await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,continuation,'你接受了这一步，但还没有开始；接受不等于已经执行。')},'你接受了这一步，但还没有开始；接受不等于已经执行。',null,new AbortController().signal)
   const next=await coachEventView(user,second,proposed.id);assert.equal(next!.id,proposed.id);assert.equal((next as any).matterProgress.state,'unattempted');assert.equal((next as any).matterProgress.choice,'accepted');assert.equal((next as any).matterProgress.reports.at(-1).sourceMessageId,run.source_message_id)
   assert.equal(next!.actions[0]!.status,'proposed','material status is not fabricated execution')
  })
  await t.test('partial, waiting, adjustment, pause and end keep their own dated evidence',async()=>{
   const {user,chat}=await h.account(),second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC lifecycle continuation'})
   let event:any
   const record=async(text:string,conversation:string)=>{
    const run=(await store.startRun(user,conversation,randomUUID(),text)).run
    const delta:EventDelta={target:event?{operation:'continue',eventId:event.id,expectedRevision:event.revision}:{operation:'create',title:'核对岗位要求',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]}
    const reply='本次进度只依据你刚才的报告，未报告的效果继续保持未知。'
    event=(await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,delta,reply)},reply,null,new AbortController().signal)).event!
    return event
   }
   await record('我接受这个核对步骤。',chat)
   for(const [text,state] of [['我只完成了一部分岗位核对。','partial'],['我已经把岗位问题发给了学长，目前我还在等待结果。','waiting_result'],['我决定调整这个步骤，改用公开的岗位说明。','adjusted'],['我先暂停这件事，不要再催我。','paused'],['我把这个步骤调整成另一个更小的核对步骤。','adjusted'],['我先暂停这件事。','paused'],['我今天做了另外一份课程练习。','paused'],['我决定结束这件事，不再继续。','ended']] as const){
    await record(text,second);const read=await coachEventView(user,chat,event.id);assert.equal(read!.matterProgress!.state,state,text);assert.equal(read!.id,event.id)
   }
   assert.ok(event.matterProgress.reports.some((r:any)=>r.state==='partial'));assert.ok(event.matterProgress.reports.some((r:any)=>r.state==='waiting_result'));assert.equal(event.matterProgress.choice,'declined')
  })
  await t.test('later performed work supersedes acceptance, while scoped correction preserves another fact',async()=>{
   const {user,chat}=await h.account(),second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC correction'})
   const initial='我接受这个核对步骤。我读统计学。',first=(await store.startRun(user,chat,randomUUID(),initial)).run
   const start:EventDelta={target:{operation:'create',title:'核对岗位要求',source:{messageId:first.source_message_id,quote:'我接受这个核对步骤'}},nodes:[{kind:'fact',source:{messageId:first.source_message_id,quote:'我接受这个核对步骤'}},{kind:'fact',source:{messageId:first.source_message_id,quote:'我读统计学'}}]}
   let event=(await store.finishRun(first,{candidates:[],audit:[],coach:await stageCoachEvent(first,start,'接受这一步不代表已经执行。')},'接受这一步不代表已经执行。',null,new AbortController().signal)).event!
   const text='我接受这个核对步骤。我已经发出了岗位咨询邮件。',run=(await store.startRun(user,second,randomUUID(),text)).run
   const delta:EventDelta={target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:'我接受这个核对步骤'}},{kind:'fact',source:{messageId:run.source_message_id,quote:'我已经发出了岗位咨询邮件'}}]}
   event=(await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,delta,'已经发出咨询，回复和采用情况仍未知。')},'已经发出咨询，回复和采用情况仍未知。',null,new AbortController().signal)).event!
   assert.equal(event.matterProgress!.state,'attempted')
   const old=event.nodes.find(node=>node.content==='我已经发出了岗位咨询邮件')!,correction='我还没有开始执行。',change=(await store.startRun(user,second,randomUUID(),correction)).run
   const corrected:EventDelta={target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},corrections:[{nodeId:old.id,source:{messageId:change.source_message_id,quote:'我还没有开始执行'}}]}
   event=(await store.finishRun(change,{candidates:[],audit:[],coach:await stageCoachEvent(change,corrected,'更正的是执行进度，统计学背景不变。')},'更正的是执行进度，统计学背景不变。',null,new AbortController().signal)).event!
   assert.equal(event.matterProgress!.state,'unattempted');assert.ok(event.nodes.some(node=>node.content==='我读统计学'));assert.ok(!event.matterProgress!.reports.some(report=>report.quotes.includes('我已经发出了岗位咨询邮件')))
  })
  await t.test('a paused matter stays stopped after an execution report until explicit renewed consent',async()=>{
   const {user,chat}=await h.account();let event:any
   const record=async(text:string)=>{
    const run=(await store.startRun(user,chat,randomUUID(),text)).run
    const delta:EventDelta={target:event?{operation:'continue',eventId:event.id,expectedRevision:event.revision}:{operation:'create',title:'核对岗位要求',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]}
    event=(await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,delta,'你的选择以当前本人报告为准。')},'你的选择以当前本人报告为准。',null,new AbortController().signal)).event!
   }
   await record('我先暂停这件事。');assert.equal(event.matterProgress.recommendationStopped,true)
   await record('我已经发出了岗位咨询邮件。');assert.equal(event.matterProgress.state,'attempted');assert.equal(event.matterProgress.recommendationStopped,true)
   await record('室友说他愿意继续这件事。');assert.equal(event.matterProgress.recommendationStopped,true)
   await record('我重新决定不再继续。');assert.equal(event.matterProgress.recommendationStopped,true);assert.equal(event.matterProgress.state,'ended');assert.equal(event.matterProgress.choice,'declined')
   await record('我现在愿意继续这件事。');assert.equal(event.matterProgress.recommendationStopped,false)
  })
  await t.test('an explicit not-started report is not answered with the same execution question',()=>{
   const f=fixture(),current=f.request.authorizedEvidenceRefs[1];current.quote='我还没有开始执行。';f.request.mode='action_review';f.request.currentIntent=current.quote
   const action:ActionCase={eventId:f.request.eventId!,revision:1,object:'学长',request:'岗位咨询',known:{sent:null,read:null,replied:null,used:null,effect:null},usage:[],answeredQuestions:[]}
   const result=reviewAction(f.request,action,current);assert.equal(result.needsClarification,false);assert.notEqual(result.reply,'消息已经发出了吗？');assert.match(result.reply,/未开始|没有开始|还没开始/)
  })
  for(const text of ['我拒绝这一步。','我不接受这个建议。'])await t.test('explicit refusal: '+text,async()=>{
   const {user,chat}=await h.account(),second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC refused next session'})
   const run=(await store.startRun(user,chat,randomUUID(),text)).run
   const delta:EventDelta={target:{operation:'create',title:'核对岗位要求',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]}
   await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,delta,'不接受这一步的选择会保留，不继续催促。')},'不接受这一步的选择会保留，不继续催促。',null,new AbortController().signal)
   const event=(await coachEventView(user,second,(await coachEventView(user,chat))!.id))!;assert.equal(event.matterProgress!.choice,'declined');assert.equal(event.matterProgress!.recommendationStopped,true)
  })
  for(const [text,state] of [['我不再试这个步骤因为我试过没效果。','ended'],['我先暂停这件事因为我试过没效果。','paused']] as const)await t.test('terminal choice takes priority over its reason: '+text,async()=>{
   const {user,chat}=await h.account(),run=(await store.startRun(user,chat,randomUUID(),text)).run
   const delta:EventDelta={target:{operation:'create',title:'核对岗位要求',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]}
   const event=(await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,delta,'你的终止选择会保留，不再催促。')},'你的终止选择会保留，不再催促。',null,new AbortController().signal)).event!
   assert.equal(event.matterProgress!.state,state);assert.equal(event.matterProgress!.choice,'declined');assert.equal(event.matterProgress!.recommendationStopped,true)
  })
  await t.test('completed work and an unexpected outcome remain separate across conversations',async()=>{
   const {user,chat}=await h.account(),text='我做完了这一步但结果和预期不符',run=(await store.startRun(user,chat,randomUUID(),text)).run
   const delta:EventDelta={target:{operation:'create',title:'核对岗位要求',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]}
   const event=(await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,delta,'动作做完与结果不符同时保留，原因与稳定能力仍未知。')},'动作做完与结果不符同时保留，原因与稳定能力仍未知。',null,new AbortController().signal)).event!
   const second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC unexpected outcome'})
   const current=(await coachEventView(user,second,event.id))!;assert.equal(current.matterProgress!.state,'completed');assert.ok(current.nodes.some(node=>node.content.includes('结果和预期不符')))
   await h.execute(user,second,'接着上次核对岗位这件事，不要保存新资料。',{},'动作已做完，但结果不符的原因还不能确定；下一次帮助先核对结果差在哪里。')
   assert.ok(JSON.stringify(h.requests.at(-1).messages).includes(text),'next model context retains outcome evidence separately from performed progress')
  })
  for(const text of ['我接受导师的另一个建议。','我决定结束今天的课程练习。','我完成了另一份课程作业。','我接受你刚才说的这个人的建议。','我同意你之前说的这个事实。','我同意这个方案的事实。','我同意这个方案 的事实。','我接受这个建议 其实是导师的。'])await t.test('another matter is not current-matter progress: '+text,async()=>{
   const {user,chat}=await h.account(),first=(await store.startRun(user,chat,randomUUID(),'我先暂停这件事。')).run
   const delta:EventDelta={target:{operation:'create',title:'核对岗位要求',source:{messageId:first.source_message_id,quote:'我先暂停这件事'}},nodes:[{kind:'fact',source:{messageId:first.source_message_id,quote:'我先暂停这件事'}}]}
   let event=(await store.finishRun(first,{candidates:[],audit:[],coach:await stageCoachEvent(first,delta,'这件事暂停。')},'这件事暂停。',null,new AbortController().signal)).event!
   const run=(await store.startRun(user,chat,randomUUID(),text)).run
   event=(await store.finishRun(run,{candidates:[],audit:[],coach:await stageCoachEvent(run,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},'另一件事不改变当前事项。')},'另一件事不改变当前事项。',null,new AbortController().signal)).event!
   assert.equal(event.matterProgress!.state,'paused');assert.equal(event.matterProgress!.choice,'declined');assert.equal(event.matterProgress!.recommendationStopped,true)
  })
  for(const [text,expected] of [['我已经开始核对岗位要求，但还没完成。','attempted'],['我已经做了岗位核对，但尚未完成。','attempted'],['我核对岗位要求时卡住了。','stuck']] as const)await t.test('omitted provider progressState: '+text,async()=>{
   const {user,chat}=await h.account();await h.execute(user,chat,text,{growthUpdates:[{target:{operation:'create'},kind:'feedback',assertion:'user_reported',source:{clauseId:'c0'}}]},'按这次实际进度承接，不把卡住推断成能力不足。')
   assert.ok((await growthView(user,chat)).items.some(item=>item.kind==='feedback'&&item.progressState===expected))
  })
 }finally{await h.close()}
})
