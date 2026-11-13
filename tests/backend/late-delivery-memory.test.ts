import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {growthView} from '../../server/growth.ts'
import {negativePersonalFactClauses} from '../../server/turn-contract.ts'

test('reported work and two missed deadlines remain canonical facts without inventing two completed tasks',async()=>{
 const h=await residualHarness()
 try{
  const {user,chat}=await h.account()
  await h.execute(user,chat,'上周课程表是我整理的，但我没有按时交付；上个月的数据练习也没有按时提交，不能说成两次按时完成。',{growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'unattempted',source:{clauseId:'c2'}}]})
  const growth=(await growthView(user)).items.filter(row=>row.status==='active'&&!row.unavailableReason)
  assert.ok(growth.some(row=>row.text==='但我没有按时交付'))
  assert.ok(growth.some(row=>row.text==='上个月的数据练习也没有按时提交'))
  const experiences=await store.listExperiences(user)
  assert.equal(experiences.length,1)
  assert.equal(experiences[0]!.content.action,'上周课程表是我整理的')
  assert.match(experiences[0]!.content.result,/没有按时交付/)
  const second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC deadline followup'})
  await h.execute(user,second,'接着之前的课程表和数据练习，只回读实际经过。')
  const context=JSON.stringify(h.requests.at(-1).messages)
  assert.match(context,/但我没有按时交付/);assert.match(context,/上个月的数据练习也没有按时提交/)
  for(const text of ['如果我没有按时交付。','室友说我没有按时交付。','“我没有按时交付”。']){
   assert.ok(!negativePersonalFactClauses(text).some(c=>c.text.includes('室友')||c.text==='我没有按时交付'),text)
  }
  assert.ok(!negativePersonalFactClauses('我没有按时交付；上个月室友的数据练习也没有按时提交。').some(c=>c.text.includes('室友')))
  assert.ok(!negativePersonalFactClauses('我没有按时交付；上个月的数据练习也没有按时提交，不过那是室友负责的。').some(c=>c.text==='上个月的数据练习也没有按时提交'))
  assert.ok(!negativePersonalFactClauses('我没有按时交付；上个月的数据练习也没有按时提交。那是室友负责的。').some(c=>c.text==='上个月的数据练习也没有按时提交'))
  for(const actor of ['导师','AI'])assert.ok(!negativePersonalFactClauses('我没有按时交付；上个月的数据练习也没有按时提交，不过那是'+actor+'负责的。').some(c=>c.text==='上个月的数据练习也没有按时提交'))
  for(const text of ['课程表不是我整理的。','课程表可能是我整理的。','课程表好像是我整理的。','课程表似乎是我整理的。','课程表大概是我整理的。','课程表未必是我整理的。','课程表是室友整理的。','如果课程表是我整理的。']){
   const counter=await h.account();await h.execute(counter.user,counter.chat,text)
   assert.equal((await store.listExperiences(counter.user)).length,0,text)
  }
 }finally{await h.close()}
})
