import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {growthView,growthContext} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'

test('legacy persisted instruction spans stop being current personal context without rewriting records or hiding independent facts',async()=>{
 const user='historical-instruction-'+randomUUID(),chat=randomUUID()
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await store.createConversation(user,{id:chat,title:'SYNTHETIC legacy instruction boundary'})
  const quotes=['只依据现在有效的已保存记录，说明我上周联系的是谁、对方是否回复','请展开约1500字的连贯分析：先回读各项事实及本人原话，再逐项区分意愿、实际行动、他人回应和仍未知的原因，解释一次实践为何不能证明稳定能力','我昨天做过一次社团海报']
  const run=(await store.startRun(user,chat,randomUUID(),quotes.join('。')+'。')).run
  await store.terminateRun(user,run.request_id,'cancelled','SYNTHETIC_HISTORICAL_FIXTURE')
  // Emulate the exact old persisted shape; no candidate/model mocks stand in
  // for the production availability, source validation or retrieval functions.
  const ids:string[]=quotes.map(()=>randomUUID())
  for(const [index,quote] of quotes.entries())await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5::jsonb)",[ids[index],user,chat,quote,JSON.stringify([{type:'message',id:run.source_message_id,quote}])])
  const view=await growthView(user,chat)
  for(const id of ids.slice(0,2)){
   const row=view.items.find(row=>row.id===id)!
   assert.equal(row.status,'stale');assert.equal(row.unavailableReason,'conversation_instruction')
  }
  assert.equal(view.items.find(row=>row.id===ids[2])?.status,'active')
  const context=await growthContext(user,chat)
  assert.ok(!context.some(row=>ids.slice(0,2).includes(row.id)))
  assert.ok(context.some(row=>row.id===ids[2]&&row.text===quotes[2]))
  const saved=(await pool.query('SELECT id,text,status,revision FROM growth_items WHERE user_id=$1',[user])).rows
  for(const [index,id] of ids.entries())assert.deepEqual(saved.find(row=>row.id===id),{id,text:quotes[index],status:'active',revision:1})
 }finally{await pool.end()}
})
