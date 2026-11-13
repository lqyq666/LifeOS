import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {readIdentityClaims} from '../../server/identity.ts'
import {personalUnderstanding} from '../../server/personal-understanding.ts'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'

test('R02 identity preserves governing negation, aspiration and history across writes and old projections',async t=>{
 const h=await residualHarness()
 try{
  for(const text of ['我不认为我是那种喜欢竞争的人。','我希望我是那种能坚持到底的人。','以前我是那种先做再想的人。','我希望成为一个有耐心的人。'])await t.test(text,async()=>{
   const {user,chat}=await h.account()
   await h.execute(user,chat,text,{growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]})
   assert.deepEqual((await store.cognitionGraph(user)).nodes.find((n:any)=>n.type==='self')?.identityAccepted,[])
   const client=await pool.connect();try{assert.equal((await readIdentityClaims(client,user)).length,0)}finally{client.release()}
  })
  await t.test('normal affirmative self-description remains confirmed',async()=>{
   const {user,chat}=await h.account()
   await h.execute(user,chat,'我是那种先做再想的人。',{growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]})
   assert.deepEqual((await store.cognitionGraph(user)).nodes.find((n:any)=>n.type==='self')?.identityAccepted,['我是那种先做再想的人'])
  })
  await t.test('legacy mistaken projection hidden on first read; raw source and direct correction preserved',async()=>{
   const {user,chat}=await h.account(),text='我不认为我是那种喜欢竞争的人。'
   const run=await h.execute(user,chat,text,{growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]})
   const fact=(await pool.query('SELECT id FROM growth_items WHERE user_id=$1 ORDER BY created_at LIMIT 1',[user])).rows[0]
   const id=randomUUID()
   await pool.query("DELETE FROM identity_claims WHERE user_id=$1",[user])
   await pool.query("INSERT INTO identity_claims(user_id,id,text,origin,confirmed_by_user,status,source_refs) VALUES($1,$2,'我是那种喜欢竞争的人','user_stated',true,'active',$3)",[user,id,JSON.stringify([{growthItemId:fact.id,quote:text.replace(/。$/,'')}])])
   const before=(await pool.query('SELECT to_jsonb(t) AS row FROM identity_claims t WHERE user_id=$1',[user])).rows
   assert.deepEqual((await store.cognitionGraph(user)).nodes.find((n:any)=>n.type==='self')?.identityAccepted,[])
   assert.equal((await personalUnderstanding(user,chat)).dimensions.flatMap(d=>d.items).filter(i=>i.family==='identity').length,0)
   assert.deepEqual((await pool.query('SELECT to_jsonb(t) AS row FROM identity_claims t WHERE user_id=$1',[user])).rows,before,'read compatibility does not rewrite historical rows')
   assert.equal((await pool.query('SELECT content FROM messages WHERE user_id=$1 AND id=$2',[user,run.source_message_id])).rows[0].content,text)
   await store.claimAction(user,id,{requestId:randomUUID(),action:'correct',text:'我更愿意和别人合作，不认可喜欢竞争的描述'})
   assert.deepEqual((await store.cognitionGraph(user)).nodes.find((n:any)=>n.type==='self')?.identityAccepted,['我更愿意和别人合作，不认可喜欢竞争的描述'])
  })
 }finally{await h.close()}
})
