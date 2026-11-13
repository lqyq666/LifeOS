import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {pool,transaction} from '../../server/db.ts'
import {stageCoachEvent,coachEventView,assertCoachEvidence,invalidateCoachSources} from '../../server/action-coach-events.ts'
import {growthView,growthContext,growthSnapshotKey,stageGrowthUpdates,actOnGrowthItem,applyGrowthAction} from '../../server/growth.ts'
import {searchCoachEvents,indexCoachEventOnce} from '../../server/coach-retrieval.ts'
import {setMemorySettings,getMemoryView,applyMemoryAction,loadSnapshot} from '../../server/memory.ts'
import {embeddingSignature} from '../../server/local-embedding.ts'
import {reportedActionProgress} from '../../server/workflows/action-review.ts'

test('explicit first-person acceptance fragment is a choice, never execution or another person report',()=>{
 const accepted=reportedActionProgress('这只是我选择接受，尚未执行。')
 assert.equal(accepted.choice,'accepted');assert.equal(accepted.state,'unattempted')
 for(const text of ['这只是他选择接受。','如果这只是我选择接受。','他说：“这只是我选择接受”。','这只是我选择接受另一个建议。','这只是我选择接受吗？'])assert.notEqual(reportedActionProgress(text).choice,'accepted',text)
 assert.equal(reportedActionProgress('这不准确：我还没有开始设置你原先建议的数据验证规则。').state,'unattempted')
 for(const text of ['这不准确：他还没有开始设置数据验证规则。','如果这不准确：我还没有开始设置规则。','他说：“这不准确：我还没有开始设置规则”。'])assert.equal(reportedActionProgress(text).state,null,text)
})

test('forgetting a title background preserves the same independently grounded matter, never old source data',async()=>{
 const h=await residualHarness();try{
 const {user,chat}=await h.account(),age='我是21岁的大学三年级学生',matter='我想改进社团报名表',excel='我会用Excel整理表格',text=age+'。'+matter+'。'+excel+'。',first=(await store.startRun(user,chat,randomUUID(),text)).run,source=(quote:string)=>({messageId:first.source_message_id,quote})
 const growth=await stageGrowthUpdates(first,[{target:{operation:'create'},kind:'context',assertion:'user_reported',text:age,source:source(age)},{target:{operation:'create'},kind:'ability',assertion:'user_reported',text:excel,source:source(excel)}],await growthContext(user,chat))
 let event=(await store.finishRun(first,{candidates:[],audit:[],growth,coach:await stageCoachEvent(first,{target:{operation:'create',title:'21岁学生的报名表验证',source:source(age)},nodes:[{kind:'fact',source:source(matter)},{kind:'fact',source:source(excel)}]},'先验证一次报名表，实际执行尚未知。')},'先验证一次报名表，实际执行尚未知。',null,new AbortController().signal)).event!
 const accepted=(await store.startRun(user,chat,randomUUID(),'我接受你刚才建议的这个步骤。这只是我选择接受，尚未执行。')).run
 event=(await store.finishRun(accepted,{candidates:[],audit:[],coach:await stageCoachEvent(accepted,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},nodes:[{kind:'fact',source:{messageId:accepted.source_message_id,quote:'这只是我选择接受'}},{kind:'fact',source:{messageId:accepted.source_message_id,quote:'尚未执行'}}]},'接受与执行分别保留。')},'接受与执行分别保留。',null,new AbortController().signal)).event!
 const oldRef={eventId:event.id,revision:event.revision,generation:event.generation},ageItem=(await growthView(user,chat)).items.find(i=>i.text===age)!
 await actOnGrowthItem(user,ageItem.id,{requestId:randomUUID(),expectedRevision:ageItem.revision,action:'forget'})
 const second=randomUUID();await store.createConversation(user,{id:second,title:'SYNTHETIC independent matter after scoped forgetting'})
 const current=(await coachEventView(user,second,event.id))!
 assert.equal(current.id,event.id);assert.equal(current.matterProgress!.choice,'accepted');assert.equal(current.matterProgress!.state,'unattempted');assert.ok(!JSON.stringify(current).includes('21岁'));assert.ok(!JSON.stringify(current).includes('三年级'));assert.match(JSON.stringify(current),/Excel/);assert.match(JSON.stringify(current),/报名表/)
 await assert.rejects(transaction(c=>assertCoachEvidence(c,user,second,[oldRef])),/COACH_SNAPSHOT_INVALIDATED/)
 const found=await searchCoachEvents(user,second,{query:'',eventId:event.id});assert.equal(found.events[0]?.id,event.id)
 assert.deepEqual((await searchCoachEvents(user,second,{query:'',object:'21岁'})).events,[],'withdrawn title must not remain an object-search match')
 await h.execute(user,second,'接着上次报名表，先处理哪个环节？',{},'接着已接受但尚未执行的报名表步骤，先核对一个时间字段。')
 assert.ok(!JSON.stringify(h.requests.at(-1).messages).includes('21岁'));assert.match(JSON.stringify(h.requests.at(-1).messages),/报名表/)
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM coach_events WHERE user_id=$1",[user])).rows[0].n,1,'continuity does not require a duplicate case')
 // Exact legacy/coexistence path: an old instance writes the same scoped
 // tombstone but does not advance the coach generation. Existing full-growth
 // CAS must still stop a pre-control generated reply from being saved.
 const legacy=await h.account(),legacyText=age+'。'+matter+'。',legacyRun=(await store.startRun(legacy.user,legacy.chat,randomUUID(),legacyText)).run,ls=(quote:string)=>({messageId:legacyRun.source_message_id,quote})
 const legacyGrowth=await stageGrowthUpdates(legacyRun,[{target:{operation:'create'},kind:'context',assertion:'user_reported',text:age,source:ls(age)}],await growthContext(legacy.user,legacy.chat))
 const legacyEvent=(await store.finishRun(legacyRun,{candidates:[],audit:[],growth:legacyGrowth,coach:await stageCoachEvent(legacyRun,{target:{operation:'create',title:'21岁学生的报名表事项',source:ls(age)},nodes:[{kind:'fact',source:ls(age)},{kind:'fact',source:ls(matter)}]},'报名表仍待尝试。')},'报名表仍待尝试。',null,new AbortController().signal)).event!
 const before=await growthContext(legacy.user,legacy.chat),pending=(await store.startRun(legacy.user,legacy.chat,randomUUID(),'继续这件事。')).run
 await pool.query('INSERT INTO coach_semantic_index(user_id,event_id,revision,generation,signature,part,embedding) VALUES($1,$2,$3,$4,$5,0,$6)',[legacy.user,legacyEvent.id,legacyEvent.revision,legacyEvent.generation,embeddingSignature,Array(512).fill(0)])
 await transaction(async c=>{
  await c.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4)',[legacy.user,legacy.chat,legacyRun.source_message_id,age])
  await c.query("UPDATE growth_items SET text='',sources='[]',status='forgotten',revision=revision+1 WHERE user_id=$1",[legacy.user])
 })
 const recovered=(await coachEventView(legacy.user,legacy.chat,legacyEvent.id))!
 assert.equal(recovered.id,legacyEvent.id);assert.ok(!JSON.stringify(recovered).includes('21岁'));assert.match(JSON.stringify(recovered),/报名表/)
 await assert.rejects(store.finishRun(pending,{candidates:[],audit:[],growthSnapshotKey:growthSnapshotKey(before),usedEventRefs:[{eventId:legacyEvent.id,revision:legacyEvent.revision,generation:legacyEvent.generation}]},'旧的21岁背景不能再保存。',null,new AbortController().signal),/GROWTH_SNAPSHOT_INVALIDATED/)
 assert.equal((await searchCoachEvents(legacy.user,legacy.chat,{query:'报名表'})).indexPending,1,'old-signature cached vectors are isolated')
 const encoded:string[]=[]
 // Other selected suites share this disposable database. Await this legacy
 // event's rebuild rather than assuming its job is among the next four.
 const queued=Number((await pool.query("SELECT count(*) AS n FROM coach_index_jobs WHERE status IN ('pending','processing')")).rows[0].n)
 for(let i=0;i<=queued;i++){
  if((await pool.query('SELECT 1 FROM coach_semantic_index WHERE user_id=$1 AND event_id=$2 AND signature<>$3',[legacy.user,legacyEvent.id,embeddingSignature])).rowCount)break
  try{if(!await indexCoachEventOnce(async texts=>{encoded.push(...texts);return texts.map(()=>Array(512).fill(0))}))break}
  catch(error){if(!(error instanceof Error)||!['NOT_FOUND','COACH_SOURCE_REVOKED'].includes(error.message))throw error}
 }
 assert.ok((await pool.query('SELECT 1 FROM coach_semantic_index WHERE user_id=$1 AND event_id=$2',[legacy.user,legacyEvent.id])).rowCount,'legacy title recovery is indexed as current evidence')
 assert.ok(!encoded.some(text=>text.includes('21岁')),'reindexing uses current evidence, never the revoked title')
 assert.equal((await searchCoachEvents(legacy.user,legacy.chat,{query:'报名表'})).indexPending,0,'successfully rebuilt source-bound vectors are reused')
 // No independent evidence, fully withdrawn message, foreign user and Memory
 // OFF remain closed. Neutral title recovery must never weaken those gates.
 const empty=await h.account(),er=(await store.startRun(empty.user,empty.chat,randomUUID(),age)).run
 const emptyGrowth=await stageGrowthUpdates(er,[{target:{operation:'create'},kind:'context',assertion:'user_reported',text:age,source:{messageId:er.source_message_id,quote:age}}],await growthContext(empty.user,empty.chat))
 const lone=(await store.finishRun(er,{candidates:[],audit:[],growth:emptyGrowth,coach:await stageCoachEvent(er,{target:{operation:'create',title:age,source:{messageId:er.source_message_id,quote:age}},nodes:[{kind:'fact',source:{messageId:er.source_message_id,quote:age}}]},'只有这条本人原话。')},'只有这条本人原话。',null,new AbortController().signal)).event!
 const loneItem=(await growthView(empty.user,empty.chat)).items[0]!
 await actOnGrowthItem(empty.user,loneItem.id,{requestId:randomUUID(),expectedRevision:loneItem.revision,action:'forget'})
 await assert.rejects(coachEventView(empty.user,empty.chat,lone.id),/COACH_SOURCE_REVOKED/)
 await assert.rejects(coachEventView(empty.user,empty.chat,current.id),/NOT_FOUND/)
 const held=await pool.connect(),control=await pool.connect();let operation:Promise<unknown>|undefined
 try{
  await held.query('BEGIN');await held.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings']);await held.query('SELECT id FROM coach_events WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,current.id])
  await control.query('BEGIN');const pid=(await control.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  const activeExcel=(await growthView(user,chat)).items.find(i=>i.text===excel)!
  operation=applyGrowthAction(control,user,activeExcel.id,{requestId:randomUUID(),expectedRevision:activeExcel.revision,action:'correct',text:'我会用Excel整理课程表'})
  let waiting=false;for(let i=0;i<100;i++){
   if((await held.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type==='Lock'){waiting=true;break}
   await held.query('SELECT pg_sleep(0.01)')
  }
  assert.ok(waiting,'control reached its first lock before the concurrency assertion')
  assert.equal((await held.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS ok',['growth:'+user])).rows[0].ok,true,'a blocked control must not hold growth while waiting for the memory/event commit')
 }finally{await held.query('ROLLBACK');if(operation)await operation;await control.query('ROLLBACK');held.release();control.release()}
 const profile=await h.account(),major='我学统计学',pt=major+'。'+matter+'。'+excel+'。',pr=(await store.startRun(profile.user,profile.chat,randomUUID(),pt)).run,ps=(quote:string)=>({messageId:pr.source_message_id,quote})
 const pe=(await store.finishRun(pr,{candidates:[],audit:[],snapshot:await loadSnapshot(profile.user,profile.chat,''),memoryChanges:[{kind:'fact',key:'education.major',value:'统计学',status:'active',assertion:'user_reported',scope:'user',taskType:null,taskInquiryId:null,taskConversationId:null,expectedMemoryId:null,expectedRevision:0,evidence:{messageId:pr.source_message_id,conversationId:profile.chat,quote:major}}],coach:await stageCoachEvent(pr,{target:{operation:'create',title:'统计学学生的报名表',source:ps(major)},nodes:[{kind:'fact',source:ps(major)},{kind:'fact',source:ps(matter)},{kind:'fact',source:ps(excel)}]},'独立背景和报名事项分别记录。')},'独立背景和报名事项分别记录。',null,new AbortController().signal)).event!
 const fact=(await getMemoryView(profile.user,profile.chat)).items.find(i=>i.key==='education.major')!
 const separate=randomUUID(),draftId=randomUUID(),requestSource={messageId:pr.source_message_id,conversationId:profile.chat,quote:excel}
 await pool.query('INSERT INTO coach_events(id,user_id,conversation_id,title,title_source) VALUES($1,$2,$3,$4,$5)',[separate,profile.user,profile.chat,'统计学学生的独立课程表事项',requestSource])
 await pool.query("INSERT INTO coach_nodes(id,user_id,event_id,kind,content,source) VALUES($1,$2,$3,'fact',$4,$5)",[randomUUID(),profile.user,separate,excel,requestSource])
 await pool.query('INSERT INTO coach_actions(id,user_id,event_id,draft,source_message_ids) VALUES($1,$2,$3,$4,$5)',[draftId,profile.user,separate,{content:'沿用已有课程表。'},[pr.source_message_id]])
 const separateBefore=(await coachEventView(profile.user,profile.chat,separate))!
 await applyMemoryAction(profile.user,fact.id,{requestId:randomUUID(),expectedRevision:fact.revision,action:'correct',value:'信息管理'})
 const corrected=(await coachEventView(profile.user,profile.chat,pe.id))!
 assert.equal(corrected.id,pe.id);assert.ok(!JSON.stringify(corrected).includes('统计学'));assert.match(JSON.stringify(corrected),/Excel/);assert.match(JSON.stringify(corrected),/报名表/)
 const separateAfter=(await coachEventView(profile.user,profile.chat,separate))!
 assert.equal(separateAfter.revision,separateBefore.revision);assert.equal(separateAfter.generation,separateBefore.generation);assert.deepEqual(separateAfter.nodes,separateBefore.nodes)
 assert.ok(!JSON.stringify(separateAfter).includes('统计学'),'generated labels cannot retain corrected personal text even if their root quote was independent')
 assert.deepEqual((await pool.query('SELECT draft FROM coach_actions WHERE user_id=$1 AND id=$2',[profile.user,draftId])).rows[0].draft,{content:'沿用已有课程表。'},'scoped correction does not physically erase a separate draft')
 const birth=await h.account(),br=(await store.startRun(birth.user,birth.chat,randomUUID(),age)).run
 const bg=await stageGrowthUpdates(br,[{target:{operation:'create'},kind:'context',assertion:'user_reported',text:age,source:{messageId:br.source_message_id,quote:age}}],await growthContext(birth.user,birth.chat))
 let born=(await store.finishRun(br,{candidates:[],audit:[],growth:bg,coach:await stageCoachEvent(br,{target:{operation:'create',title:'待补具体事情',source:{messageId:br.source_message_id,quote:age}},nodes:[{kind:'fact',source:{messageId:br.source_message_id,quote:age}}]},'具体事情尚未知。')},'具体事情尚未知。',null,new AbortController().signal)).event!
 const laterChat=randomUUID();await store.createConversation(birth.user,{id:laterChat,title:'SYNTHETIC independent later source across conversations'})
 const later=(await store.startRun(birth.user,laterChat,randomUUID(),matter)).run
 born=(await store.finishRun(later,{candidates:[],audit:[],coach:await stageCoachEvent(later,{target:{operation:'continue',eventId:born.id,expectedRevision:born.revision},nodes:[{kind:'fact',source:{messageId:later.source_message_id,quote:matter}}]},'报名表事项仍待实际尝试。')},'报名表事项仍待实际尝试。',null,new AbortController().signal)).event!
 const birthAge=(await growthView(birth.user,birth.chat)).items[0]!
 await actOnGrowthItem(birth.user,birthAge.id,{requestId:randomUUID(),expectedRevision:birthAge.revision,action:'forget'})
 assert.equal((await coachEventView(birth.user,birth.chat,born.id))!.id,born.id)
 assert.equal((await coachEventView(birth.user,laterChat,born.id))!.id,born.id,'valid independent evidence may come from a later conversation')
 assert.equal((await pool.query('SELECT title_source FROM coach_events WHERE user_id=$1 AND id=$2',[birth.user,born.id])).rows[0].title_source.messageId,br.source_message_id,'birth citation remains immutable while the visible title recovers')
 await transaction(c=>invalidateCoachSources(c,birth.user,[br.source_message_id],true))
 await assert.rejects(coachEventView(birth.user,birth.chat,born.id),/NOT_FOUND|COACH_SOURCE_REVOKED/,'full birth-source withdrawal remains closed after title recovery')
 await setMemorySettings(user,{requestId:randomUUID(),enabled:false,expectedRevision:1})
 await assert.rejects(coachEventView(user,second,current.id),/MEMORY_DISABLED/)
 await pool.query("INSERT INTO coach_source_withdrawals(user_id,message_id,conversation_id,reason) VALUES($1,$2,$3,'forgotten')",[legacy.user,legacyRun.source_message_id,legacy.chat])
 await assert.rejects(coachEventView(legacy.user,legacy.chat,legacyEvent.id),/COACH_SOURCE_REVOKED/)
 }finally{await h.close()}
})
