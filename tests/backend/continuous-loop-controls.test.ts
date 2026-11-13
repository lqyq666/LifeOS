import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {coachEventView,stageCoachEvent} from '../../server/action-coach-events.ts'
import {growthView,growthContext,stageGrowthUpdates,actOnGrowthItem} from '../../server/growth.ts'
import {searchCoachEvents} from '../../server/coach-retrieval.ts'
import type {EventDelta} from '../../server/action-coach-contracts.ts'

test('three independent two-conversation cohorts keep controls scoped across current surfaces',async t=>{
 const h=await residualHarness()
 try{
  for(const [name,feedback,state] of [['not-executed','我还没有开始核对岗位要求','unattempted'],['partial','我只完成了一部分岗位核对','attempted'],['direction-change','我决定结束这件事','unknown']] as const)await t.test(name,async()=>{
   const {user,chat}=await h.account(),second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC controls '+name})
   const initial='我接受这个核对步骤。我读统计学。',first=(await store.startRun(user,chat,randomUUID(),initial)).run
   const start:EventDelta={target:{operation:'create',title:'核对岗位要求',source:{messageId:first.source_message_id,quote:'我接受这个核对步骤'}},nodes:[{kind:'fact',source:{messageId:first.source_message_id,quote:'我接受这个核对步骤'}},{kind:'fact',source:{messageId:first.source_message_id,quote:'我读统计学'}}]}
   let event=(await store.finishRun(first,{candidates:[],audit:[],coach:await stageCoachEvent(first,start,'只记录本人选择，不当作已执行。')},'只记录本人选择，不当作已执行。',null,new AbortController().signal)).event!
   const independent='我会使用Excel做课程表',text=feedback+'。'+independent+'。请给我一个核对步骤。',run=(await store.startRun(user,second,randomUUID(),text)).run
   const question='关于“'+feedback+'”的原因是什么？',material='当前依据：'+feedback+'。先核对一项岗位要求。',reply=question+'\n\n'+material
   const source=(quote:string)=>({messageId:run.source_message_id,quote}),delta:EventDelta={target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:source(feedback)},{kind:'fact',source:source(independent)},{kind:'unknown',question}],action:{operation:'create',draft:{content:material}}}
   const growth=await stageGrowthUpdates(run,[{target:{operation:'create'},kind:'feedback',assertion:'user_reported',text:feedback,source:source(feedback),progressState:state},{target:{operation:'create'},kind:'context',assertion:'user_reported',text:independent,source:source(independent)}],await growthContext(user,second))
   event=(await store.finishRun(run,{candidates:[],audit:[],growth,coach:await stageCoachEvent(run,delta,reply)},reply,null,new AbortController().signal)).event!
   const before=await growthView(user,second),record=before.items.find(item=>item.kind==='feedback'&&item.text===feedback)!;assert.ok(record)
   await actOnGrowthItem(user,record.id,{requestId:randomUUID(),expectedRevision:record.revision,action:'forget'})
   const current=(await coachEventView(user,second,event.id))!;assert.ok(current.nodes.some(node=>node.content==='我读统计学'));assert.ok(current.nodes.some(node=>node.content===independent));assert.ok(!JSON.stringify(current).includes(feedback),'forgotten feedback cannot remain in event details or matter reports')
   const search=await searchCoachEvents(user,second,{query:'',eventId:event.id});assert.ok(!JSON.stringify(search.events).includes(feedback))
   await h.execute(user,second,'继续核对岗位这件事，只依据当前有效记录，不要保存新资料。',{},'此前被忘记的反馈不再使用，统计学和Excel背景仍保留。')
   const context=JSON.stringify(h.requests.at(-1).messages);assert.ok(!context.includes(feedback));assert.ok(context.includes('统计学')&&context.includes('Excel'))
   assert.ok((await store.listConversations(user)).find(c=>c.id===second)!.messages.some((m:any)=>m.role==='user'&&m.content===text),'raw chat remains as existing policy')
   const personalBefore=await growthView(user,second),eventBefore=await coachEventView(user,second,event.id)
   await h.execute(user,second,'我已经重新开始执行。这段不用记住。',{},'本轮正常回答，但不把这段写入个人记录。')
   assert.deepEqual(await growthView(user,second),personalBefore);assert.deepEqual(await coachEventView(user,second,event.id),eventBefore)
   console.log(JSON.stringify({scope:'LOCAL_SIMULATED_PROVIDER_REAL_CORE_PG',cohort:name,user,conversations:[chat,second],eventId:event.id,controls:'forget-and-no-save',providerRealCalls:0}))
  })
 }finally{await h.close()}
})
