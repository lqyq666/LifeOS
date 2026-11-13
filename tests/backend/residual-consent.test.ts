import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {loadSnapshot} from '../../server/memory.ts'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'

test('R01 natural no-save consent blocks actual personal writes while retaining chat and positive controls',async t=>{
 const h=await residualHarness()
 const tables=['experiences','growth_items','user_themes','identity_claims','memory_items','identity_change_events']
 try{
  for(const refusal of ['这段不用记住','别记住这段话','不要把这件事记入长期记忆','不要保存下面的经历','只在这次聊天用，不要存进档案'])await t.test(refusal,async()=>{
   const {user,chat}=await h.account(),text='我昨天交了课程作业。我决定先就业。我是那种先做再想的人。'+refusal+'。'
   const before=await Promise.all(tables.map(async table=>(await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE user_id=$1 ORDER BY id`,[user])).rows))
   const run=await h.execute(user,chat,text,{growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}},{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c1'}},{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c2'}}]})
   assert.deepEqual(await Promise.all(tables.map(async table=>(await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE user_id=$1 ORDER BY id`,[user])).rows)),before,'no personal insert or modification in any lane')
   assert.equal((await pool.query('SELECT content FROM messages WHERE user_id=$1 AND id=$2',[user,run.source_message_id])).rows[0].content,text)
   assert.equal((await store.cognitionGraph(user)).nodes.filter((n:any)=>n.type==='experience'||n.type==='value').length,0)
   const fresh=randomUUID();await store.createConversation(user,{id:fresh,title:'SYNTHETIC new chat'})
   assert.equal((await loadSnapshot(user,fresh,'课程作业')).confirmedExperiences.length,0)
  })
  for(const text of ['我昨天交了课程作业。请保存这段经历。','室友说这段不用记住。我昨天交了课程作业。'])await t.test('normal control: '+text,async()=>{
   const {user,chat}=await h.account();await h.execute(user,chat,text)
   assert.ok((await store.listExperiences(user)).some(row=>row.content.summary.includes('课程作业')))
  })
  await t.test('no-save does not reconcile or alter pre-existing personal records',async()=>{
   const {user,chat}=await h.account()
   await h.execute(user,chat,'我是那种先做再想的人。',{growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]})
   const fact=(await pool.query('SELECT id FROM growth_items WHERE user_id=$1 LIMIT 1',[user])).rows[0]
   await pool.query("INSERT INTO identity_claims(user_id,id,text,origin,confirmed_by_user,status,source_refs) VALUES($1,$2,'我是那种喜欢竞争的人','user_stated',true,'active',$3)",[user,randomUUID(),JSON.stringify([{growthItemId:fact.id,quote:'我是那种先做再想的人'}])])
   const before=await Promise.all(tables.map(async table=>(await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE user_id=$1 ORDER BY id`,[user])).rows))
   await h.execute(user,chat,'我昨天完成了练习。这段不用记住。')
   assert.deepEqual(await Promise.all(tables.map(async table=>(await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE user_id=$1 ORDER BY id`,[user])).rows)),before)
  })
 }finally{await h.close()}
})
