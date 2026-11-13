import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool,transaction} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createGrowthItem,actOnGrowthItem} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {personalUnderstanding} from '../../server/personal-understanding.ts'
import {projectUserThemes} from '../../server/user-themes.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test.after(async()=>{await localEmbedding.close();await pool.end()})
test('six dimensions reuse sourced records, controls, star map and strict owner/memory boundaries',async()=>{
 const user='modes-'+randomUUID(),other='other-'+randomUUID()
 for(const id of [user,other])await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[id,id+'@example.invalid'])
 try{
  const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC modes'})
  const empty=await personalUnderstanding(user);assert.equal(empty.dimensions.length,6);assert.equal(empty.memoryEnabled,false);assert.ok(empty.dimensions.every(d=>d.items.length===0))
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  const fact=await createGrowthItem(user,{requestId:randomUUID(),conversationId:conversation,kind:'preference',text:'我看重创造与成长。'})
  const goal=await createGrowthItem(user,{requestId:randomUUID(),conversationId:conversation,kind:'goal',text:'我决定探索就业。'})
  const time=await createGrowthItem(user,{requestId:randomUUID(),conversationId:conversation,kind:'constraint',text:'本周可用两小时。',validUntil:new Date(Date.now()+7*86400000).toISOString()})
  await transaction(c=>projectUserThemes(c,user,[{id:goal.id,kind:goal.kind,text:goal.text,assertion:goal.assertion,status:goal.status}]))
  const original=['上周我独立写了一个Python脚本，整理了课程数据。','昨天我做了一个社团视频，交给社团负责人核对。']
  for(const quote of original){
   const request=randomUUID(),run=(await store.startRun(user,conversation,request,quote)).run;await store.terminateRun(user,request,'cancelled','SYNTHETIC_SETUP')
   await pool.query("INSERT INTO experiences(user_id,id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'manual',1)",[user,randomUUID(),conversation,run.source_message_id,quote,request,{title:'真实来源测试',summary:quote,action:quote,result:'',reflection:'',occurredAt:'',tags:[]}])
  }
  let view=await personalUnderstanding(user,conversation)
  assert.ok(view.dimensions.find(d=>d.id==='values')!.items.some(i=>i.id===fact.id));assert.equal(view.dimensions.find(d=>d.id==='experience')!.items.filter(i=>i.family==='experience').length,2)
  assert.ok(view.skills.some(t=>t.tag==='编程'));assert.ok(view.skills.some(t=>t.tag==='视频制作'));assert.ok(view.themes.some(t=>t.title==='就业'))
  assert.ok(view.dimensions.find(d=>d.id==='behavior')!.items.length===0,'two episodes do not invent personality')
  assert.ok(view.dimensions.flatMap(d=>d.items).every(i=>i.sources.length>0))
  const observation=randomUUID();await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies) VALUES($1,$2,$3,'preference','在有清晰反馈时，可能更容易开始。','ai_observation','proposed',$4,$5)",[observation,user,conversation,JSON.stringify([{type:'user_edit',quote:fact.text}]),JSON.stringify([{id:fact.id,revision:fact.revision}])])
  view=await personalUnderstanding(user);assert.ok(view.dimensions.flatMap(d=>d.items).some(i=>i.id===observation&&i.state==='observation'&&!i.confirmed))
  await actOnGrowthItem(user,observation,{requestId:randomUUID(),expectedRevision:1,action:'accept'})
  view=await personalUnderstanding(user);assert.ok(view.dimensions.flatMap(d=>d.items).some(i=>i.id===observation&&i.state==='observation'&&i.confirmed))
  await actOnGrowthItem(user,observation,{requestId:randomUUID(),expectedRevision:2,action:'reject'})
  assert.ok(!(await personalUnderstanding(user)).dimensions.flatMap(d=>d.items).some(i=>i.id===observation))
  const episode=view.dimensions.find(d=>d.id==='experience')!.items.find(i=>i.family==='experience'&&i.text.includes('Python'))!
  await store.experienceAction(user,episode.id,{requestId:randomUUID(),expectedRevision:episode.revision,action:'correct',content:{summary:'我只是整理了纸质资料，没有写代码。'}})
  view=await personalUnderstanding(user);assert.equal(view.dimensions.find(d=>d.id==='experience')!.items.find(i=>i.id===episode.id)!.text,'我只是整理了纸质资料，没有写代码。');assert.ok(!view.skills.some(s=>s.tag==='编程'))
  await assert.rejects(()=>personalUnderstanding(other,conversation),/NOT_FOUND/)
  assert.ok((await personalUnderstanding(other)).dimensions.every(d=>!d.items.length))
  await actOnGrowthItem(user,time.id,{requestId:randomUUID(),expectedRevision:time.revision,action:'correct',text:'本周只剩三十分钟。'})
  view=await personalUnderstanding(user);assert.ok(JSON.stringify(view).includes('三十分钟'));assert.ok(!JSON.stringify(view).includes('本周可用两小时'))
  await actOnGrowthItem(user,fact.id,{requestId:randomUUID(),expectedRevision:fact.revision,action:'forget'})
  assert.ok(!JSON.stringify(await personalUnderstanding(user)).includes('我看重创造与成长'))
  const settings=(await pool.query('SELECT revision FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]
  await setMemorySettings(user,{requestId:randomUUID(),enabled:false,expectedRevision:settings.revision})
  view=await personalUnderstanding(user,conversation);assert.ok(view.dimensions.every(d=>!d.items.length));assert.deepEqual(view.themes,[]);assert.deepEqual(view.skills,[])
  assert.ok(!JSON.stringify(view).includes('Python'));assert.ok(!JSON.stringify(view).includes('三十分钟'))
 }finally{for(const id of [user,other]){await pool.query('DELETE FROM experiences WHERE user_id=$1',[id]);await pool.query('DELETE FROM "user" WHERE id=$1',[id])}}
})
