// Reuse the repository's disposable-database recovery worker contract.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { config } from '../server/config.ts'
import { pool } from '../server/db.ts'
import * as store from '../server/store.ts'
import { setMemorySettings } from '../server/memory.ts'
import { createGrowthItem, actOnGrowthItem, growthContext, growthView } from '../server/growth.ts'

const target = new URL(config.databaseUrl)
if (target.hostname !== '127.0.0.1' || target.port !== '55432' || !/^\/lifeos_dialogue_test_[a-z0-9_]+$/.test(target.pathname)) throw new Error('Growth recovery worker requires an isolated local test database')
const user = 'synthetic-growth-recovery-adult'
const originalRequest = '11111111-1111-4111-8111-111111111114'
try {
  if (process.argv.includes('--seed')) {
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())', [user,'Synthetic adult 19',user+'@example.invalid'])
    const chat=randomUUID(), second=randomUUID()
    await store.createConversation(user,{id:chat,title:'SYNTHETIC growth recovery source'})
    await store.createConversation(user,{id:second,title:'SYNTHETIC growth recovery second device'})
    await setMemorySettings(user,{requestId:randomUUID(),expectedRevision:0,enabled:true})
    const first=await createGrowthItem(user,{requestId:originalRequest,conversationId:chat,kind:'goal',text:'先探索就业'})
    const goal=await actOnGrowthItem(user,first.id,{requestId:randomUUID(),expectedRevision:1,action:'correct',text:'当前优先实习'})
    await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'priority',text:'整理已有作品',dependencies:[{id:goal.id,revision:goal.revision}]})
    await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'constraint',text:'上周只有两小时',validUntil:'2020-01-01T00:00:00Z'})
    const rejected=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'direction',text:'暂不采用的方向'})
    await actOnGrowthItem(user,rejected.id,{requestId:randomUUID(),expectedRevision:1,action:'reject'})
    console.log(JSON.stringify({seeded:true,providerCalls:0}))
  } else {
    const chats=await store.listConversations(user)
    const second=chats.find(row=>row.title==='SYNTHETIC growth recovery second device')!.id
    const view=await growthView(user,second), goal=view.items.find(row=>row.kind==='goal')!, priority=view.items.find(row=>row.kind==='priority')!
    assert.equal(goal.text,'当前优先实习');assert.equal(goal.revision,2)
    assert.equal(view.memoryEnabled,true)
    const context=await growthContext(user,second)
    assert.ok(context.some(row=>row.id===goal.id));assert.ok(!context.some(row=>row.kind==='constraint'||row.status==='rejected'))
    const replay=await createGrowthItem(user,{requestId:originalRequest,conversationId:goal.conversationId,kind:'goal',text:'先探索就业'})
    assert.equal(replay.id,goal.id);assert.equal(replay.text,'当前优先实习')
    const changed=await actOnGrowthItem(user,goal.id,{requestId:randomUUID(),expectedRevision:2,action:'correct',text:'改为先完成期末'})
    assert.equal((await growthView(user,second)).items.find(row=>row.id===priority.id)?.unavailableReason,'dependency_changed')
    await actOnGrowthItem(user,changed.id,{requestId:randomUUID(),expectedRevision:changed.revision,action:'forget'})
    const after=await growthView(user,second)
    assert.ok(!after.items.some(row=>row.id===goal.id));assert.equal(after.items.find(row=>row.id===priority.id)?.text,'')
    const history=(await pool.query('SELECT snapshot FROM growth_revisions WHERE user_id=$1 AND item_id=ANY($2::uuid[])',[user,[goal.id,priority.id]])).rows
    assert.ok(!JSON.stringify(history).includes('实习'))
    console.log(JSON.stringify({crossSessionReadable:true,correctedFactsPreserved:true,permissionPreserved:true,expiryAndRejectionPreserved:true,idempotentReplay:true,continuedCorrection:true,dependentAdviceInvalidated:true,forgetAfterRestore:true,historyRedacted:true,providerCalls:0}))
  }
} finally { await pool.end() }
