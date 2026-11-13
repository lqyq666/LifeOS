import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {stageCoachEvent,coachEventView} from '../../server/action-coach-events.ts'
import {growthView,growthContext,stageGrowthUpdates,actOnGrowthItem} from '../../server/growth.ts'
import {searchCoachEvents} from '../../server/coach-retrieval.ts'

test('manual growth correction retires only its old quoted fact in details, retrieval and next context',async()=>{
 const h=await residualHarness();try{
 const {user,chat}=await h.account(),text='我学统计学。我会用Excel整理课程表。',run=(await store.startRun(user,chat,randomUUID(),text)).run
 const source=(quote:string)=>({messageId:run.source_message_id,quote})
 const growth=await stageGrowthUpdates(run,[{target:{operation:'create'},kind:'context',assertion:'user_reported',text:'我学统计学',source:source('我学统计学')},{target:{operation:'create'},kind:'ability',assertion:'user_reported',text:'我会用Excel整理课程表',source:source('我会用Excel整理课程表')}],await growthContext(user,chat))
 const saved=await store.finishRun(run,{candidates:[],audit:[],growth,coach:await stageCoachEvent(run,{target:{operation:'create',title:'课程表整理',source:source('我会用Excel整理课程表')},nodes:[{kind:'fact',source:source('我学统计学')},{kind:'fact',source:source('我会用Excel整理课程表')}]},'记录各自独立的背景。')},'记录各自独立的背景。',null,new AbortController().signal)
 const item=(await growthView(user,chat)).items.find(i=>i.text==='我学统计学')!
 await actOnGrowthItem(user,item.id,{requestId:randomUUID(),expectedRevision:item.revision,action:'correct',text:'我学信息管理'})
 const next=randomUUID();await store.createConversation(user,{id:next,title:'SYNTHETIC precise corrected major'})
 for(const view of [await coachEventView(user,next,saved.event!.id),await searchCoachEvents(user,next,{query:'',eventId:saved.event!.id})]){assert.ok(!JSON.stringify(view).includes('统计学'));assert.match(JSON.stringify(view),/Excel/)}
 await h.execute(user,next,'回读目前专业和Excel背景，不保存新资料。',{},'目前是信息管理，Excel课程表经验仍保留。')
 const context=JSON.stringify(h.requests.at(-1).messages);assert.ok(!context.includes('统计学'));assert.match(context,/信息管理/);assert.match(context,/Excel/)
 }finally{await h.close()}
})
