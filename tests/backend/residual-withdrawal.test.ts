import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool,transaction} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {loadSnapshot} from '../../server/memory.ts'
import {actOnGrowthItem} from '../../server/growth.ts'
import {invalidateCoachSources} from '../../server/action-coach-events.ts'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'

test('R04 deletion, scoped forget and source withdrawal remove every current relation surface without erasing independent facts',async t=>{
 const h=await residualHarness()
 try{
  for(const action of ['delete','forget','withdraw'] as const)await t.test(action,async()=>{
   const {user,chat}=await h.account(),goal={growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]}
   const keptRun=await h.execute(user,chat,'我昨天整理了实验材料。',goal)
   const removedRun=await h.execute(user,chat,'我上周交了独立志愿服务总结。',goal)
   const records=await store.listExperiences(user),kept=records.find(e=>e.source_message_id===keptRun.source_message_id)!,removed=records.find(e=>e.source_message_id===removedRun.source_message_id)!
   assert.ok(kept&&removed)
   await pool.query("INSERT INTO experience_relations(user_id,from_experience,to_experience,relation,score,reason) VALUES($1,$2,$3,'similar',0.8,'synthetic pre-existing relation') ON CONFLICT DO NOTHING",[user,kept.id,removed.id])
   const before=await store.cognitionGraph(user)
   assert.ok((before.nodes.find((n:any)=>n.id==='exp-'+kept.id) as any).insight.relatedTitles.includes(removed.content.title),'normal available relation is visible')
   if(action==='delete')await store.experienceAction(user,removed.id,{requestId:randomUUID(),expectedRevision:removed.revision,action:'delete'})
   if(action==='forget'){
    const fact=(await pool.query("SELECT id,revision FROM growth_items WHERE user_id=$1 AND sources @> $2::jsonb",[user,JSON.stringify([{type:'message',id:removedRun.source_message_id}])])).rows[0]
    await actOnGrowthItem(user,fact.id,{requestId:randomUUID(),expectedRevision:fact.revision,action:'forget'})
   }
   if(action==='withdraw')await transaction(c=>invalidateCoachSources(c,user,[removedRun.source_message_id],false))
   for(let refresh=0;refresh<2;refresh++){
    const graph=await store.cognitionGraph(user)
    assert.ok(!graph.nodes.some((n:any)=>n.id==='exp-'+removed.id))
    assert.ok(!graph.edges.some((e:any)=>e.sourceId==='exp-'+removed.id||e.targetId==='exp-'+removed.id))
    assert.ok(!(graph.nodes.find((n:any)=>n.id==='exp-'+kept.id) as any).insight.relatedTitles.includes(removed.content.title))
   }
   assert.ok(!(await store.retrieveExperiences(user,{query:'',limit:10})).records.some(e=>e.id===removed.id))
   const fresh=randomUUID();await store.createConversation(user,{id:fresh,title:'SYNTHETIC withdrawal new chat'})
   const snapshot=await loadSnapshot(user,fresh,'')
   assert.ok(!snapshot.confirmedExperiences.some(e=>e.id===removed.id));assert.ok(snapshot.confirmedExperiences.some(e=>e.id===kept.id))
   await h.execute(user,fresh,'只依据当前有效记录简述已做过的事，不要保存档案。',{},'当前保留的独立记录是整理实验材料；已停止使用的记录不作为当前依据。')
   assert.ok(!JSON.stringify(h.requests.at(-1).messages).includes('我上周交了独立志愿服务总结'))
   assert.equal((await pool.query('SELECT content FROM messages WHERE user_id=$1 AND id=$2',[user,keptRun.source_message_id])).rows[0].content,'我昨天整理了实验材料。')
  })
  await t.test('direct correction remains usable after a later confirm revision',async()=>{
   const {user,chat}=await h.account();await h.execute(user,chat,'我昨天整理了实验材料。')
   const record=(await store.listExperiences(user))[0]!
   const corrected=await store.experienceAction(user,record.id,{requestId:randomUUID(),expectedRevision:record.revision,action:'correct',content:{summary:'我昨天整理了纸质笔记。',action:'我昨天整理了纸质笔记。'}})
   await store.experienceAction(user,record.id,{requestId:randomUUID(),expectedRevision:corrected.revision,action:'confirm'})
   assert.ok((await store.cognitionGraph(user)).nodes.some((n:any)=>n.id==='exp-'+record.id&&n.summary.includes('纸质笔记')))
  })
  await t.test('deleting one episode preserves independent facts from the same original message',async()=>{
   const {user,chat}=await h.account(),text='我昨天整理了实验材料。上周我交了独立志愿服务总结。我想找到成都的数据实习。'
   await h.execute(user,chat,text,{growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}},{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c1'}},{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c2'}}]})
   const records=await store.listExperiences(user),kept=records.find(e=>e.content.summary.includes('实验材料'))!,removed=records.find(e=>e.content.summary.includes('志愿服务总结'))!
   assert.ok(kept&&removed);assert.equal(kept.source_message_id,removed.source_message_id)
   await store.experienceAction(user,removed.id,{requestId:randomUUID(),expectedRevision:removed.revision,action:'delete'})
   const graph=await store.cognitionGraph(user)
   assert.ok(graph.nodes.some((n:any)=>n.id==='exp-'+kept.id),'another episode in the same message stays available')
   assert.ok(!graph.nodes.some((n:any)=>n.id==='exp-'+removed.id))
   const fresh=randomUUID();await store.createConversation(user,{id:fresh,title:'SYNTHETIC same-source independence'})
   const snapshot=await loadSnapshot(user,fresh,'')
   assert.ok(snapshot.confirmedExperiences.some(e=>e.id===kept.id));assert.ok(!snapshot.confirmedExperiences.some(e=>e.id===removed.id))
   await h.execute(user,fresh,'只依据当前有效记录简述已做过的事和当前目标，不要保存档案。',{},'保留的事实是整理实验材料和寻找成都数据实习；被删除的独立记录不作依据。')
   const payload=JSON.stringify(h.requests.at(-1).messages)
   assert.ok(payload.includes('实验材料')&&payload.includes('成都'));assert.ok(!payload.includes('我交了独立志愿服务总结'))
  })
 }finally{await h.close()}
})
