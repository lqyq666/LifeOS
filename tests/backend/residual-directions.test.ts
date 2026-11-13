import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {growthContext} from '../../server/growth.ts'
import {readStarMapContext} from '../../server/user-themes.ts'
import {readDirectionControls} from '../../server/growth-controls.ts'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'

test('R03 current, historical, withdrawn and other-directed goals keep their actual scope',async t=>{
 const h=await residualHarness()
 const goal={growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c0'}}]}
 try{
  for(const text of ['我决定不再考研。','我不准备再考研。','我以前打算考研。'])await t.test(text,async()=>{
   const {user,chat}=await h.account();await h.execute(user,chat,text,goal,'你的当前表述会作为边界或历史保留，不再把考研当作当前追求。')
   assert.equal((await store.cognitionGraph(user)).nodes.filter((n:any)=>n.type==='value'&&n.title==='考研'&&n.themeStatus==='active').length,0)
   assert.ok(!(await readStarMapContext(pool,user))?.themes.some(n=>n.title==='考研'&&n.status==='active'))
   assert.ok(!(await growthContext(user,chat)).some(n=>n.kind==='goal'&&n.status==='active'))
  })
  for(const [text,title,status] of [['我现在还在考虑考研。','考研','pending'],['我决定准备考研。','考研','active'],['我想做就业指导志愿服务。','做就业指导志愿服务','active'],['我想帮助别人准备面试。','帮助别人准备面试','active'],['我不再熬夜。','不再熬夜','active']])await t.test('normal scope: '+text,async()=>{
   const {user,chat}=await h.account();await h.execute(user,chat,text!,goal)
   const map=await readStarMapContext(pool,user)
   assert.ok(map?.themes.some(n=>n.title===title&&n.status===status),JSON.stringify({map,growth:await growthContext(user,chat)}))
  })
  for(const exitText of ['我决定不再考研。','我以前打算考研，现在我决定不再考研。不要推断稳定能力，也不要安排新任务。'])await t.test('exit pauses an existing direction across graph and a new provider context: '+exitText,async()=>{
   const {user,chat}=await h.account();await h.execute(user,chat,'我决定准备考研。',goal)
   await h.execute(user,chat,exitText,{},'考研方向已暂停，不再作为当前追求；原有历史和其他独立事实保留。')
   assert.ok((await readDirectionControls(user)).some(c=>c.scope==='postgraduate_exam'&&c.state==='paused'))
   assert.ok(!(await readStarMapContext(pool,user))?.themes.some(n=>n.title==='考研'&&n.status==='active'))
   const fresh=randomUUID();await store.createConversation(user,{id:fresh,title:'SYNTHETIC direction new chat'})
   await h.execute(user,fresh,'只依据当前有效记录简述方向边界，不要保存档案。',{},'你已暂停考研方向，不能沿用旧备考目标安排新任务。')
   const messages=JSON.stringify(h.requests.at(-1).messages)
   assert.match(messages,/postgraduate_exam/);assert.match(messages,/paused/)
  })
 }finally{await h.close()}
})
