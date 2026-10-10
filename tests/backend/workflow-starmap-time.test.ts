import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool,transaction} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {projectUserThemes,readStarMapContext} from '../../server/user-themes.ts'
test.after(()=>pool.end())
test('star-map decision context uses the same effective time/source state as growth, not expired or future raw active rows',async()=>{
 const user='synthetic-time-'+randomUUID(),chat=randomUUID(),goal=randomUUID()
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await store.createConversation(user,{id:chat,title:'SYNTHETIC star map time'})
 await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1)',[user])
 await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status) VALUES($1,$2,$3,'goal','我决定本阶段就业优先','user_reported','active')",[goal,user,chat])
 await transaction(c=>projectUserThemes(c,user,[{id:goal,kind:'goal',text:'我决定本阶段就业优先',assertion:'user_reported',status:'active'}]))
 for(const [text,from,until] of [
  ['这周只剩两小时',null,new Date(Date.now()+86400000).toISOString()],
  ['旧一周零小时',null,new Date(Date.now()-86400000).toISOString()],
  ['下周有六小时',new Date(Date.now()+86400000).toISOString(),new Date(Date.now()+8*86400000).toISOString()]
 ])await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,valid_from,valid_until) VALUES($1,$2,$3,'constraint',$4,'user_reported','active',$5,$6)",[randomUUID(),user,chat,text,from,until])
 const current=await readStarMapContext(pool,user);assert.ok(current);assert.deepEqual(current.constraints,['这周只剩两小时'])
 await pool.query("UPDATE growth_items SET valid_until=now()-interval '1 second' WHERE id=$1",[goal])
 assert.equal(await readStarMapContext(pool,user),null,'expired goal cannot survive as an active decision theme')
})
