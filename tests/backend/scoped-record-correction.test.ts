import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {stageGrowthUpdates,growthView} from '../../server/growth.ts'
import {setMemorySettings,applyMemoryAction,getMemoryView,loadSnapshot} from '../../server/memory.ts'
import {personalUnderstanding} from '../../server/personal-understanding.ts'
import {redactGrowthHistory,messageQuoteCorrected,currentExperienceEvidence} from '../../server/growth-privacy.ts'
import {buildTurnPrompt} from '../../server/turn-prompt.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test('correcting an experience or one memory field preserves unrelated facts in the same original message',async()=>{
 const user='scoped-correction-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid']);await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0});await store.createConversation(user,{id:chat,title:'合成局部更正'})
  const school='我学习自动化专业',stage='我是大学二年级学生',action='我整理了五条传感器数据',text=[school,stage,action].join('。')+'。'
  const run=(await store.startRun(user,chat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]}
  staged.growth=await stageGrowthUpdates(run,[school,stage,action].map(quote=>({target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:run.source_message_id,quote}})),[])
  await store.stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote:action,links:[],content:{action,result:'',occurredAt:''}});await store.finishRun(run,staged,'本次报告了整理数据。',null,signal)
  const candidate=(await store.listExperiences(user,chat))[0];assert.ok(candidate)
  const corrected=await store.experienceAction(user,candidate.id,{requestId:randomUUID(),expectedRevision:candidate.revision,action:'correct',content:{summary:candidate.content.summary,action:'我实际只整理了三条传感器数据'}})
  const view=await growthView(user),available=view.items.filter(x=>!x.unavailableReason)
  assert.ok(available.some(x=>x.text===school));assert.ok(available.some(x=>x.text===stage));assert.ok(!available.some(x=>x.text===action))
  assert.ok((await store.cognitionGraph(user)).nodes.some((x:any)=>x.serverId===candidate.id&&x.action===corrected.content.action))
  const understanding=await personalUnderstanding(user);const current=understanding.dimensions.flatMap(d=>d.items).find(x=>x.family==='experience'&&x.id===candidate.id)!
  assert.ok(current.text.includes('三条传感器数据'));assert.ok(!current.text.includes('五条传感器数据'),'old summary must not be presented as current personal understanding')
  const snapshot=await loadSnapshot(user,chat,'课程数据'),projection=await currentExperienceEvidence(pool,user,snapshot.confirmedExperiences)
  const prompt=buildTurnPrompt({currentMessageId:'now',messages:[{id:'now',role:'user',content:'核对课程数据的经历。'}],confirmedExperiences:projection})
  assert.ok(prompt.includes('三条传感器数据'));assert.ok(!prompt.includes('五条传感器数据'),'old title, summary and quote must not reach model context')
  assert.equal((await store.listExperiences(user,chat))[0].content.summary,candidate.content.summary,'original stored summary is retained for history')
  await store.experienceAction(user,candidate.id,{requestId:randomUUID(),expectedRevision:corrected.revision,action:'correct',content:{summary:corrected.content.summary,action}})
  const restored=await currentExperienceEvidence(pool,user,(await loadSnapshot(user,chat,'传感器')).confirmedExperiences)
  assert.equal(restored.find(x=>x.id===candidate.id)?.content.action,action,'an explicit later correction may restore an earlier value')
  assert.equal((await pool.query('SELECT 1 FROM coach_source_withdrawals WHERE user_id=$1',[user])).rowCount,0)
  const mem=randomUUID();await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,status) VALUES($1,$2,'fact','education.major',$3,'user_reported','user',$4,now(),'active')",[mem,user,JSON.stringify('自动化'),JSON.stringify([{type:'message',conversationId:chat,messageId:run.source_message_id,quote:school}])])
  await applyMemoryAction(user,mem,{requestId:randomUUID(),expectedRevision:1,action:'correct',value:'电气工程'})
  assert.equal((await getMemoryView(user)).items.find(x=>x.id===mem)?.value,'电气工程');assert.equal(await messageQuoteCorrected(pool,user,run.source_message_id,school),true);assert.equal(await messageQuoteCorrected(pool,user,run.source_message_id,stage),false)
  const later=await growthView(user);assert.ok(later.items.some(x=>x.text===stage&&!x.unavailableReason));assert.ok(!later.items.some(x=>x.text===school&&!x.unavailableReason))
  const history=await redactGrowthHistory(user,[{id:run.source_message_id,role:'user',content:text}]);assert.ok(history[0].content.includes(stage));assert.ok(!history[0].content.includes(school));assert.ok(!history[0].content.includes(action));assert.equal((await pool.query('SELECT content FROM messages WHERE id=$1',[run.source_message_id])).rows[0].content,text,'original chat is retained verbatim')
 }finally{await localEmbedding.close();await pool.end()}
})
