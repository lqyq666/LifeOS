import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {pool} from '../../server/db.ts'
import {growthView} from '../../server/growth.ts'
import {coachEventView} from '../../server/action-coach-events.ts'

let h:Awaited<ReturnType<typeof residualHarness>>
before(async()=>{h=await residualHarness()})
after(async()=>{await h.close()})

test('a named task ending persists across sessions while its independent broad direction remains active',async()=>{
 {
  const {user,chat}=await h.account()
  await h.execute(user,chat,'我决定考研。我想核对已保存的考研资料。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'goal',source:{clauseId:'c0'}},{target:{operation:'create'},assertion:'user_reported',kind:'goal',source:{clauseId:'c1'}}],event:{target:{operation:'create',title:'核对已保存的考研资料（十分钟起步）',source:{clauseId:'c1'}},factRefs:[1]}})
  const before=(await coachEventView(user,chat))!
  await h.execute(user,chat,'我决定结束考研资料这件事。现在我决定优先就业。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}},{target:{operation:'create'},assertion:'user_reported',kind:'goal',source:{clauseId:'c1'}}],event:{target:{operation:'continue',eventId:before.id,expectedRevision:before.revision},factRefs:[0]}},'这次资料核对已经结束。就业是你新提出的优先方向，尚未开始具体行动。')
  const next=randomUUID();await store.createConversation(user,{id:next,title:'SYNTHETIC named ending readback'})
  const ended=(await coachEventView(user,next,before.id))!
  assert.equal(ended.matterProgress?.state,'ended')
  assert.equal(ended.matterProgress?.recommendationStopped,true)
  const themes=(await pool.query('SELECT title,status FROM user_themes WHERE user_id=$1',[user])).rows
  assert.ok(themes.some(theme=>theme.title==='考研'&&theme.status==='active'),'ending a concrete step does not withdraw the separately stated broad goal: '+JSON.stringify({themes,facts:(await growthView(user)).items.map(f=>({kind:f.kind,text:f.text,status:f.status}))}))
  assert.ok(!themes.some(theme=>theme.title.includes('考研资料')&&theme.status==='active'))
  await h.execute(user,next,'接着刚才就业这个方向，先做什么？',{},'按你目前的就业优先方向，先只核对一条岗位要求。')
  assert.ok(h.requests.at(-1).messages.some((message:any)=>message.role==='user'&&message.content.includes('recommendationStopped')))
 }
})

test('today budget expires at Shanghai midnight while the separate birthday report has no invented expiry',async()=>{
 {
  const {user,chat}=await h.account(),day=new Date(Date.now()+8*3600000).toISOString().slice(0,10)
  await h.execute(user,chat,'今天是我生日。今天我只有四分钟。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}},{target:{operation:'create'},assertion:'user_reported',kind:'constraint',source:{clauseId:'c1'},timeEvidence:{kind:'date_inclusive',date:day,clauseId:'c1'}}]})
  const facts=(await growthView(user)).items,budget=facts.find(fact=>fact.text==='今天我只有四分钟')!,birthday=facts.find(fact=>fact.text==='今天是我生日')!
  assert.ok(budget)
  assert.equal(budget.validUntil,new Date(Date.parse(day+'T00:00:00+08:00')+24*3600000).toISOString())
  assert.equal(birthday.validUntil,null)
  assert.equal(birthday.kind,'context')
 }
})
