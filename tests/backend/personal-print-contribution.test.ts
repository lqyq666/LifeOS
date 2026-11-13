import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'

test('a second reported print contribution reaches the star-map source without borrowing the roommate design',async()=>{
 const h=await residualHarness()
 try{
  const {user,chat}=await h.account()
  const first='上月我整理了社团报名问卷的姓名列和时间列',second='上周另一份活动表也是室友设计，我只打印了材料'
  await h.execute(user,chat,first+'；室友负责设计表格规则，我没有设计规则。'+second+'。')
  const records=await store.listExperiences(user)
  assert.ok(records.some(row=>row.source_quote===first))
  const printed=records.find(row=>row.source_quote===second)
  assert.ok(printed,'the second independent experience must not silently disappear')
  assert.equal(printed.content.action,'我只打印了材料')
  assert.deepEqual(printed.links,[],'roommate-only design must not create a personal creation category')
  const own=await h.account()
  await h.execute(own.user,own.chat,'上周我完成了报名表的设计。')
  assert.ok((await store.listExperiences(own.user))[0]?.links.some((link:{value_id:string})=>link.value_id==='value-creation'),'actual personal design retains its browsing category')
  const omitted=await h.account()
  await h.execute(omitted.user,omitted.chat,'上周我完成了报名表的设计。',{experienceCandidate:{source:{clauseIds:['c0']}}})
  assert.ok((await store.listExperiences(omitted.user))[0]?.links.some((link:{value_id:string})=>link.value_id==='value-creation'),'optional model action omission must not remove a verified personal category')
  const borrowed=await h.account()
  await h.execute(borrowed.user,borrowed.chat,'我打印了材料，室友整理了设计稿。',{experienceCandidate:{source:{clauseIds:['c0','c1']},action:{clauseId:'c0'},links:[{valueId:'value-creation',reason:'设计稿'}]}})
  assert.ok(!(await store.listExperiences(borrowed.user))[0]?.links.some((link:{value_id:string})=>link.value_id==='value-creation'),'provider category proposals cannot borrow teammate-only design evidence')
  const evaluated=await h.account()
  await h.execute(evaluated.user,evaluated.chat,'我整理了姓名列，同学反馈格式清楚。')
  assert.ok((await store.listExperiences(evaluated.user))[0]?.links.some((link:{value_id:string})=>link.value_id==='value-growth'),'feedback on personal work retains its browsing category')
  const observed=await h.account();await h.execute(observed.user,observed.chat,'我看到截止日期后完成了报名表。')
  assert.equal((await store.listExperiences(observed.user)).length,1,'seeing a date does not delegate the following personal work')
  for(const text of ['我打印了材料，室友整理了设计稿。','室友整理了设计稿，我打印了材料。']){
   const swapped=await h.account();await h.execute(swapped.user,swapped.chat,text)
   const record=(await store.listExperiences(swapped.user))[0]!
   assert.equal(record.content.action,'我打印了材料',text)
   assert.ok(!record.links.some((link:{value_id:string})=>link.value_id==='value-creation'),text)
  }
  const other=randomUUID();await store.createConversation(user,{id:other,title:'SYNTHETIC contribution continuation'})
  await h.execute(user,other,'接着之前两次表格的分工，只回读我做过什么，不追加建议。')
  assert.ok(h.requests.at(-1).messages.some((m:any)=>m.role==='user'&&m.content.includes(second)))
  for(const text of ['室友打印了材料。','上周我让室友打印了材料。','我请同学打印了材料。','我打算打印材料。','如果我打印了材料。','“我打印了材料”。']){
   const actor=await h.account();await h.execute(actor.user,actor.chat,text)
   assert.equal((await store.listExperiences(actor.user)).length,0,text)
  }
 }finally{await h.close()}
})
