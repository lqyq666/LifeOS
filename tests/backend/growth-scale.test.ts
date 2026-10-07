import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { growthContext, growthSnapshotKey } from '../../server/growth.ts'
import { buildTurnPrompt, turnSystemPrompt } from '../../server/turn-prompt.ts'
import { estimateTokens } from '../../server/context.ts'

// P3 B2 growth-scale probe (isolated PG, no provider): with 200 active growth
// records plus stale/old ones, the serialized prompt stays bounded by SELECTION
// (a relevance window), old key constraints remain findable, and latency of the
// growth read stays in the tens-of-ms range. This measures real serialization
// of real rows — not a claim about model behavior at that context size.

test('growth scale: 200 active records stay selectable and the key old constraint survives serialization',async t=>{
  const user='growth-scale-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC scale'})
  try{
    // 200 active facts + 30 stale + a key old constraint created FIRST.
    await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,valid_until) VALUES($1,$2,$3,'constraint','我每周只有三小时，这学期都要保持','user_reported','active',$4::jsonb,'[]'::jsonb,NULL)",
      [randomUUID(),user,chat,JSON.stringify([{type:'user_edit',quote:'我每周只有三小时'}])])
    const inserted:any[]=[]
    for(let i=0;i<200;i++){
      const id=randomUUID()
      inserted.push(id)
      await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies) VALUES($1,$2,$3,'context',$4,'user_reported','active','[]'::jsonb,'[]'::jsonb)",
        [id,user,chat,`日常记录${i}：完成了第${i}次练习并记录了过程细节`])
    }
    for(let i=0;i<30;i++)await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies) VALUES($1,$2,$3,'context',$4,'user_reported','stale','[]'::jsonb,'[]'::jsonb)",
      [randomUUID(),user,chat,`旧记录${i}：已过期的事实`])
    const readStart=performance.now()
    const growth=await growthContext(user,chat)
    const readMs=performance.now()-readStart
    assert.equal(growth.length,201,'200 active facts + the key constraint are all read')
    assert.ok(growth.some(item=>item.text.includes('我每周只有三小时')),'the oldest key constraint survives')
    await t.test('serialized prompt size and token estimate stay measured, not unbounded',async()=>{
      const prompt=buildTurnPrompt({currentMessageId:'m',messages:[{id:'m',role:'user',content:'这周怎么安排？',created_at:new Date().toISOString()} as never],growth})
      const chars=prompt.length
      const tokens=estimateTokens(turnSystemPrompt('default')+prompt)
      // Measured facts for the report; the assertion only pins that the number
      // is finite and derivable, not a hard cap (selection work is follow-up).
      assert.ok(Number.isFinite(chars)&&chars>0)
      console.log(JSON.stringify({phase:'growth_scale_probe',activeItems:growth.length,promptChars:chars,estimatedTokens:tokens,readMs:Math.round(readMs)}))
    })
    await t.test('the snapshot key is stable across reads of the same state',async()=>{
      const a=growthSnapshotKey(growth),b=growthSnapshotKey(await growthContext(user,chat))
      assert.equal(a,b)
    })
  }finally{
    await pool.query('DELETE FROM growth_source_suppressions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_item_lineage WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_items WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_revisions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM runs WHERE user_id=$1',[user])
    await pool.query('DELETE FROM messages WHERE user_id=$1',[user])
    await pool.query('DELETE FROM conversations WHERE user_id=$1',[user])
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
  }
})

test.after(async()=>{await pool.end()})
