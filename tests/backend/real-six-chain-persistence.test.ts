import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import * as store from '../../server/store.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {stageGrowthUpdates,growthContext} from '../../server/growth.ts'
test.after(async()=>{await localEmbedding.close();await pool.end()})
test('captured portfolio feedback updates readback while preserving original source and separate PDF delivery',async()=>{
 const user='real-persistence-'+randomUUID()
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await setMemorySettings(user,{enabled:true,expectedRevision:0,requestId:randomUUID()})
 const turns=[
  {text:'我把作品集链接发给导师了，对方还没回复',action:'我把作品集链接发给导师了',result:'对方还没回复'},
  {text:'接着作品集的事：导师回复说手机打不开链接，但没有评价内容'},
  {text:'回来反馈：我发了PDF，导师确认已经读到，但还没有说是否采用其中建议，也没有给效果反馈',action:'回来反馈：我发了PDF',result:'也没有给效果反馈'},
 ]
 for(const t of turns){
  const chat=randomUUID();await store.createConversation(user,{id:chat,title:'Synthetic portfolio continuity'})
  const {run}=await store.startRun(user,chat,randomUUID(),t.text)
  const growth=await stageGrowthUpdates(run,[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{messageId:run.source_message_id,quote:t.text}}],await growthContext(user,chat))
  await store.finishRun(run,{audit:[],growth,candidates:t.action?[{sourceMessageId:run.source_message_id,quote:t.text,links:[],content:{action:t.action,result:t.result!,occurredAt:''}}]:[]},'Local source replay',null,new AbortController().signal)
 }
 const nodes=(await store.cognitionGraph(user)).nodes.filter(n=>n.type==='experience') as any[]
 const original=nodes.find(n=>n.summary===turns[0]!.text),pdf=nodes.find(n=>n.summary===turns[2]!.text)
 assert.equal(original.taskOutcomes.response.status,'reported_response')
 assert.match(original.taskOutcomes.response.quote,/手机打不开/)
 assert.equal(original.taskOutcomes.read.status,'unknown','unreadable link does not prove reading')
 assert.equal(pdf.taskOutcomes.read.status,'reported_read')
 assert.equal(pdf.taskOutcomes.response.status,'reported_response')
 assert.equal(pdf.taskOutcomes.adoption.status,'unknown')
 assert.equal(pdf.taskOutcomes.effect.status,'unknown')
})

test('legacy instruction list facts are unavailable to future recall while pause controls survive',async()=>{
 const user='legacy-instruction-'+randomUUID(),chat=randomUUID(),text='我是学生。效率评分是我当前最看重的指标。请从生活体验聊起，不要加付款、采用、效率评分或职业标签、效率评分。先暂停这个方向。'
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await setMemorySettings(user,{enabled:true,expectedRevision:0,requestId:randomUUID()})
 await store.createConversation(user,{id:chat,title:'Synthetic legacy source ownership'})
 const {run}=await store.startRun(user,chat,randomUUID(),text)
 await store.terminateRun(user,run.request_id,'cancelled','LEGACY_FIXTURE')
 for(const quote of ['请从生活体验聊起','不要加付款','效率评分或职业标签','效率评分','先暂停这个方向'])await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,revision) VALUES(gen_random_uuid(),$1,$2,'preference',$3,'user_reported','active',$4,1)",[user,chat,quote,JSON.stringify([{type:'message',id:run.source_message_id,quote}])])
 await pool.query("UPDATE growth_items SET text='效率评分' WHERE user_id=$1 AND text='效率评分或职业标签'",[user])
 const context=await growthContext(user,chat)
 assert.deepEqual(context.map(row=>row.text),['先暂停这个方向'])
 assert.equal(context[0]?.taskBoundary?.kind,'pause')
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1',[user])).rows[0].n,5,'legacy evidence remains recoverable')
})
import {selectStructuralCandidate,requiresExperienceCandidate} from '../../server/experience-content.ts'
import {buildClauseCatalogue} from '../../server/clause-catalogue.ts'
test('captured life experience commits to a readable record with no commercial outcome fields',async()=>{
 const user='lived-experience-'+randomUUID(),chat=randomUUID(),text='我是成年大学生，昨晚和室友打羽毛球后觉得轻松。请从生活体验聊起，不要加付款、采用、效率评分或职业标签。'
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await setMemorySettings(user,{enabled:true,expectedRevision:0,requestId:randomUUID()})
 await store.createConversation(user,{id:chat,title:'Synthetic everyday experience'})
 const {run}=await store.startRun(user,chat,randomUUID(),text),catalogue=buildClauseCatalogue(text)
 assert.equal(requiresExperienceCandidate(catalogue),true)
 const selected=selectStructuralCandidate(text,catalogue,'2026-10-21T13:00:00Z')!
 await store.finishRun(run,{audit:[],candidates:[{sourceMessageId:run.source_message_id,quote:selected.quote,links:[],content:selected.content}]},'Source-only lifecycle',null,new AbortController().signal)
 const node=(await store.cognitionGraph(user)).nodes.find(n=>n.type==='experience') as any
 assert.match(node.summary,/羽毛球后觉得轻松/)
 assert.deepEqual(node.outcomeKeys,[])
 assert.doesNotMatch(node.summary,/付款|效率评分/)
})


test('captured external-expectation output commits exact attributed context across sessions without a personal pursuit',async()=>{
 const {readFileSync}=await import('node:fs')
 const {parseActionCoachTurn}=await import('../../server/action-coach-contracts.ts')
 const {buildClauseCatalogue}=await import('../../server/clause-catalogue.ts')
 const {resolveGrowthDeltas}=await import('../../server/growth-authority.ts')
 const user='external-report-'+randomUUID(),chat=randomUUID()
 const text='接着升学和就业的取舍。家里希望我走稳定路线，但这是外部期待；我自己更在意留在目前城市，而且每周最多四小时探索。请更新判断，不要替我选。'
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await setMemorySettings(user,{enabled:true,expectedRevision:0,requestId:randomUUID()})
 await store.createConversation(user,{id:chat,title:'Synthetic external expectation source'})
 const {run}=await store.startRun(user,chat,randomUUID(),text)
 const parsed=parseActionCoachTurn(readFileSync('tests/fixtures/coach-external-expectation-kind.json','utf8'))
 const resolved=resolveGrowthDeltas({deltas:parsed.growthUpdates!,currentMessageId:run.source_message_id,currentText:text,catalogue:buildClauseCatalogue(text),authorized:[],correctionPlan:null,controlClauseTexts:[]})
 const family=resolved.deltas.find(d=>d.source.quote==='家里希望我走稳定路线')
 assert.equal(family?.kind,'context')
 const growth=await stageGrowthUpdates(run,resolved.deltas,[])
 await store.finishRun(run,{audit:resolved.audit,growth,candidates:[]},parsed.reply,null,new AbortController().signal)
 const other=randomUUID();await store.createConversation(user,{id:other,title:'Synthetic cross-session context'})
 const remembered=await growthContext(user,other)
 const saved=remembered.find(x=>x.text==='家里希望我走稳定路线')
 assert.equal(saved?.kind,'context')
 assert.equal(saved?.unavailableReason,null)
 assert.ok(saved?.sources.some(s=>s.type==='message'&&s.id===run.source_message_id&&s.quote==='家里希望我走稳定路线'))
 assert.ok(!remembered.some(x=>['goal','direction','preference'].includes(x.kind)&&/家里|稳定/.test(x.text)))
 const graph=await store.cognitionGraph(user)
 assert.ok(!graph.nodes.some((x:any)=>x.type==='pursuit'&&/家里|稳定/.test(x.title??x.summary??'')))
})
