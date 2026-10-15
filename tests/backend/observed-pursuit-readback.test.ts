import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {growthContext,stageGrowthUpdates,growthView,actOnGrowthItem} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {readStarMapContext} from '../../server/user-themes.ts'

test('observed legacy step disappears from cognition and new-session context without deleting its fact',async()=>{
 const user='observed-pursuit-'+randomUUID(),chat=randomUUID(),step='我想先找一件能核实实际条件的小事',priority='当前更重视就业'
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await setMemorySettings(user,{enabled:true,expectedRevision:0,requestId:randomUUID()})
  await store.createConversation(user,{id:chat,title:'Synthetic observed pursuit'})
  const run=(await store.startRun(user,chat,randomUUID(),'我想比较就业、考研和创业三条路，'+priority+'。'+step+'。')).run
  const changes=[{kind:'goal',quote:'我想比较就业'},{kind:'context',quote:priority},{kind:'goal',quote:step}].map(x=>({target:{operation:'create' as const},assertion:'user_reported' as const,kind:x.kind,source:{messageId:run.source_message_id,quote:x.quote}}))
  const growth=await stageGrowthUpdates(run,changes as any,await growthContext(user,chat))
  await store.finishRun(run,{candidates:[],audit:[],growth},'Synthetic zero-model fixture',null,new AbortController().signal)
  const facts=(await growthView(user,chat)).items,stepFact=facts.find(f=>f.text===step)!,priorityFact=facts.find(f=>f.text===priority)!
  assert.ok(stepFact&&priorityFact)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM user_themes WHERE user_id=$1 AND source_refs @> $2::jsonb',[user,JSON.stringify([{growthItemId:stepFact.id}])])).rows[0].n,0,'new projections do not promote the step')
  await pool.query("INSERT INTO user_themes(user_id,id,title,kind,status,origin,summary,source_refs,pinned) VALUES($1,$2,'找一件能核实实际条件的小事','pursuit','active','user_stated','legacy fixture',$3,false)",[user,randomUUID(),JSON.stringify([{growthItemId:stepFact.id,quote:step}])])
  const view=await store.cognitionGraph(user)
  assert.deepEqual(view.nodes.filter(n=>n.type==='value').map(n=>n.title),['就业'])
  assert.equal(view.starmapNextStep,'当前重点：就业（本人表达）')
  const context=await readStarMapContext(pool,user)
  assert.deepEqual(context?.themes.map(t=>t.title),['就业'])
  assert.equal((await growthView(user,chat)).items.find(f=>f.id===stepFact.id)?.text,step,'the original task preference is retained')
  await actOnGrowthItem(user,priorityFact.id,{requestId:randomUUID(),expectedRevision:priorityFact.revision,action:'forget'})
  assert.ok(!(await store.cognitionGraph(user)).starmapNextStep.includes('当前重点：就业'),'forgotten priority cannot remain the current focus')
  await setMemorySettings(user,{enabled:false,expectedRevision:1,requestId:randomUUID()})
  assert.equal(await readStarMapContext(pool,user),null)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end()}
})
