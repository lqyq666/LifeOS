import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import {stageGrowthUpdates,growthView,applyGrowthAction} from '../../server/growth.ts'
import {pool,transaction} from '../../server/db.ts'
import {loadSnapshot} from '../../server/memory.ts'
import {persistMemoryControl,listControlRequests,resolveControlRequest,controlOperationRequestId,type StagedMemoryControl} from '../../server/memory-controls.ts'
import {readStarMapContext} from '../../server/user-themes.ts'
import {stageCoachEvent,coachEventView} from '../../server/action-coach-events.ts'

test('episode forgetting is source-scoped, atomic and consistent in later retrieval',async t=>{
 const h=await residualHarness()
 try{
 await t.test('source fragments and explicit interpretation leave DB views, graph, retrieval and model context while unrelated facts stay',async()=>{
  const {user,chat}=await h.account()
  const episode='上周我整理过社团问卷的三列数据，没有做分析，也没有收到反馈'
  async function save(text:string,quotes:string[],episodeQuote?:string){
   const run=(await store.startRun(user,chat,randomUUID(),text)).run
   const staged:store.Staged={candidates:[],audit:[]}
   staged.growth=await stageGrowthUpdates(run,quotes.map(quote=>({target:{operation:'create' as const},assertion:'user_reported' as const,kind:'context' as const,source:{messageId:run.source_message_id,quote}})),[])
   if(episodeQuote){
    await store.stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote:episodeQuote,links:[]})
    staged.coach=await stageCoachEvent(run,{target:{operation:'create',title:'会用Excel',source:{messageId:run.source_message_id,quote:'会用Excel'}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:'会用Excel'}},{kind:'fact',source:{messageId:run.source_message_id,quote:episodeQuote}}]},'已保存合成来源。')
   }
   await store.finishRun(run,staged,'已保存合成来源。',null,new AbortController().signal)
   return run
  }
  await save('我是20岁的信息管理大二学生。会用Excel。'+episode+'。',['我是20岁的信息管理大二学生','会用Excel','上周我整理过社团问卷的三列数据','没有做分析','也没有收到反馈'],episode)
  await save('我现在决定转向就业探索。社团问卷经历并不证明我适合数据运营。',['我现在决定转向就业探索','社团问卷经历并不证明我适合数据运营'])
  const experience=(await store.listExperiences(user))[0]!
  await store.experienceAction(user,experience.id,{requestId:randomUUID(),expectedRevision:experience.revision,action:'confirm'})
  assert.equal((await store.retrieveExperiences(user,{query:'',limit:10})).records.length,1)
  const before=(await growthView(user)).items,primary=before.find(x=>x.text==='上周我整理过社团问卷的三列数据')!
  const interpretation=before.find(x=>x.text==='社团问卷经历并不证明我适合数据运营')!
  await pool.query('UPDATE growth_items SET dependencies=$3::jsonb WHERE user_id=$1 AND id=$2',[user,interpretation.id,JSON.stringify([{id:primary.id,revision:primary.revision}])])
  const independent=before.filter(x=>['我是20岁的信息管理大二学生','会用Excel','我现在决定转向就业探索'].includes(x.text)).map(x=>({id:x.id,revision:x.revision,text:x.text}))
  const control=(await store.startRun(user,chat,randomUUID(),'请忘记我整理社团问卷三列数据那段经历。保留专业、Excel和就业探索。')).run
  const staged:store.Staged={candidates:[],audit:[],memoryControl:{kind:'forget',itemId:primary.id,expectedRevision:primary.revision,clauseText:'请忘记我整理社团问卷三列数据那段经历'}}
  const result=await store.finishRun(control,staged,'已清除这段经历的相关依据，其他事实保留。',null,new AbortController().signal)
  const after=(await growthView(user)).items
  assert.ok(!after.some(x=>x.status==='active'&&/社团问卷|没有做分析|没有收到反馈/.test(x.text)))
  for(const item of independent)assert.deepEqual(after.filter(x=>x.id===item.id).map(x=>({id:x.id,revision:x.revision,text:x.text})),[item])
  assert.equal((await store.listExperiences(user)).length,0)
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM experiences WHERE user_id=$1 AND status<>'deleted'",[user])).rows[0].n,0)
  assert.equal((await store.retrieveExperiences(user,{query:'',limit:10})).records.length,0)
  assert.ok(!JSON.stringify(await store.cognitionGraph(user)).includes('社团问卷'))
  assert.ok(!JSON.stringify(await readStarMapContext(pool,user)).includes('社团问卷'))
  const freshChat=randomUUID();await store.createConversation(user,{id:freshChat,title:'遗忘后新会话'})
  const snapshot=await loadSnapshot(user,freshChat,'就业探索的个人依据')
  assert.ok(!JSON.stringify(snapshot).includes('社团问卷'))
  assert.ok(!JSON.stringify(snapshot).includes('没有做分析'))
  assert.ok((await pool.query('SELECT 1 FROM growth_source_suppressions WHERE user_id=$1 AND quote=$2',[user,interpretation.text])).rowCount,'dependent source was suppressed before cascade redaction')
  await h.execute(user,freshChat,'我今天怎么继续探索就业？',{},'先选一个你愿意了解的岗位，记录一条还不清楚的要求。')
  const modelContext=JSON.stringify(h.requests.at(-1).messages.filter((message:any)=>message.role==='user'))
  assert.ok(!modelContext.includes('社团问卷'))
  assert.ok(!modelContext.includes('没有做分析'))
  assert.ok(modelContext.includes('会用Excel'))
  assert.ok((await coachEventView(user,chat))?.nodes.some(node=>node.content==='会用Excel'&&node.status==='active'),'scoped experience deletion retains independent coach evidence from the same message')
  assert.ok(result)
 })

 async function setup(extraPrefix='',clauseText='请忘记我整理社团问卷三列数据那段经历'){
  const {user,chat}=await h.account(),episode='上周我整理过社团问卷的三列数据，没有做分析，也没有收到反馈'
  const text=extraPrefix+'我是信息管理大二学生。会用Excel。'+episode+'。'
  const run=(await store.startRun(user,chat,randomUUID(),text)).run
  const staged:store.Staged={candidates:[],audit:[],growth:await stageGrowthUpdates(run,['我是信息管理大二学生','会用Excel','上周我整理过社团问卷的三列数据','没有做分析','也没有收到反馈'].map(quote=>({target:{operation:'create' as const},assertion:'user_reported' as const,kind:'context' as const,source:{messageId:run.source_message_id,quote}})),[])}
  await store.stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote:episode,links:[]})
  await store.finishRun(run,staged,'合成来源。',null,new AbortController().signal)
  const primary=(await growthView(user)).items.find(x=>x.text==='上周我整理过社团问卷的三列数据')!
  const control=(await store.startRun(user,chat,randomUUID(),clauseText+'。')).run
  const operation:StagedMemoryControl={kind:'forget',itemId:primary.id,expectedRevision:primary.revision,clauseText}
  return {user,chat,run,control,operation,episode,text}
 }
 async function durable(user:string){
  const records:Record<string,unknown>={}
  for(const table of ['growth_items','growth_revisions','growth_source_suppressions','experiences','experience_revisions','growth_operations','user_operations'])records[table]=(await pool.query('SELECT to_jsonb(t) AS row FROM '+table+' t WHERE user_id=$1 ORDER BY to_jsonb(t)::text',[user])).rows
  return records
 }
 await t.test('a failure after all mutations rolls back every record and operation; replay applies once',async()=>{
  const x=await setup(),before=await durable(x.user)
  await assert.rejects(transaction(async c=>{await persistMemoryControl(c,x.control,x.operation);throw new Error('injected-final-save-failure')}),/injected-final-save-failure/)
  assert.deepEqual(await durable(x.user),before)
  const first=await transaction(c=>persistMemoryControl(c,x.control,x.operation)),after=await durable(x.user)
  const second=await transaction(c=>persistMemoryControl(c,x.control,x.operation))
  assert.equal(first.replayed,false);assert.equal(second.replayed,true)
  assert.deepEqual(await durable(x.user),after)
  await assert.rejects(transaction(c=>persistMemoryControl(c,x.control,{...x.operation,clauseText:'忘记这条记录'})),/IDEMPOTENCY_KEY_REUSED/)
 })
 await t.test('stale revision, forged source and a different account cannot mutate the episode',async()=>{
  const x=await setup(),before=await durable(x.user),other=await h.account()
  await assert.rejects(transaction(c=>persistMemoryControl(c,x.control,{...x.operation,expectedRevision:999})),/GROWTH_REVISION_CONFLICT/)
  await assert.rejects(transaction(c=>persistMemoryControl(c,x.control,{...x.operation,clauseText:'请忘记另一段经历'})),/CONTROL_SOURCE_INVALID/)
  await assert.rejects(transaction(c=>persistMemoryControl(c,{...x.control,user_id:other.user},x.operation)),/CONTROL_SOURCE_INVALID/)
  assert.deepEqual(await durable(x.user),before)
 })
 await t.test('missing canonical scope, quoted fact scope and legacy partial replays fail without claiming full erasure',async()=>{
  const x=await setup()
  await pool.query("UPDATE experiences SET status='deleted' WHERE user_id=$1",[x.user])
  const before=await durable(x.user)
  await assert.rejects(transaction(c=>persistMemoryControl(c,x.control,x.operation)),/CONTROL_EPISODE_SCOPE_UNVERIFIED/)
  assert.deepEqual(await durable(x.user),before)
  const y=await setup()
  await assert.rejects(transaction(c=>persistMemoryControl(c,y.control,{...y.operation,clauseText:'请忘记“没有做分析”这段经历'})),/CONTROL_SOURCE_INVALID/)
  await transaction(c=>applyGrowthAction(c,y.user,y.operation.itemId,{requestId:controlOperationRequestId(y.control.request_id,y.operation.itemId,'forget'),expectedRevision:y.operation.expectedRevision,action:'forget'}))
  const legacy=await durable(y.user)
  await assert.rejects(transaction(c=>persistMemoryControl(c,y.control,y.operation)),/CONTROL_SCOPE_NOT_RECORDED/)
  assert.deepEqual(await durable(y.user),legacy,'replay never silently upgrades or certifies an old partial control')
 })
 await t.test('independent source on the primary and duplicate source text cannot be erased through episode matching',async()=>{
  const x=await setup(),other=await h.account()
  const extra=(await store.startRun(other.user,other.chat,randomUUID(),'我也整理过社团问卷数据。')).run
  await pool.query("UPDATE growth_items SET sources=sources||$3::jsonb WHERE user_id=$1 AND id=$2",[x.user,x.operation.itemId,JSON.stringify([{type:'message',id:extra.source_message_id,quote:'我也整理过社团问卷数据'}])])
  const before=await durable(x.user)
  await assert.rejects(transaction(c=>persistMemoryControl(c,x.control,x.operation)),/CONTROL_EPISODE_(?:SOURCE_AMBIGUOUS|SCOPE_UNVERIFIED)/)
  assert.deepEqual(await durable(x.user),before)
  const y=await setup('我另一次练习也没有做分析。'),duplicate=await durable(y.user)
  await assert.rejects(transaction(c=>persistMemoryControl(c,y.control,y.operation)),/CONTROL_EPISODE_SOURCE_AMBIGUOUS/)
  assert.deepEqual(await durable(y.user),duplicate)
 })
 await t.test('paused and completed source-owned facts are cleared as part of the episode',async()=>{
  const x=await setup()
  await pool.query("UPDATE growth_items SET status=CASE WHEN text='没有做分析' THEN 'paused' ELSE 'completed' END WHERE user_id=$1 AND text IN ('没有做分析','也没有收到反馈')",[x.user])
  await transaction(c=>persistMemoryControl(c,x.control,x.operation))
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1 AND text IN ('没有做分析','也没有收到反馈')",[x.user])).rows[0].n,0)
 })
 await t.test('a result-fragment target and independent dependency cannot authorize whole-episode erasure',async()=>{
  const x=await setup(),items=(await growthView(x.user)).items,negative=items.find(i=>i.text==='没有做分析')!
  const before=await durable(x.user)
  await assert.rejects(transaction(c=>persistMemoryControl(c,x.control,{...x.operation,itemId:negative.id,expectedRevision:negative.revision})),/CONTROL_EPISODE_SCOPE_UNVERIFIED/)
  assert.deepEqual(await durable(x.user),before)
  await pool.query("UPDATE growth_items SET dependencies=$2::jsonb WHERE user_id=$1 AND text='会用Excel'",[x.user,JSON.stringify([{id:negative.id,revision:negative.revision}])])
  const mixed=await durable(x.user)
  await assert.rejects(transaction(c=>persistMemoryControl(c,x.control,x.operation)),/CONTROL_EPISODE_DEPENDENCY_AMBIGUOUS/)
  assert.deepEqual(await durable(x.user),mixed)
 })
 await t.test('historical independent provenance and pre-action facts cannot authorize a destructive episode scope',async()=>{
  const x=await setup()
  await pool.query("UPDATE growth_revisions SET snapshot=jsonb_set(snapshot,'{sources}',$3::jsonb) WHERE user_id=$1 AND item_id=$2 AND revision=1",[x.user,x.operation.itemId,JSON.stringify([{type:'user_edit',quote:'独立事实'}])])
  const before=await durable(x.user)
  await assert.rejects(transaction(c=>persistMemoryControl(c,x.control,x.operation)),/CONTROL_EPISODE_HISTORY_AMBIGUOUS/)
  assert.deepEqual(await durable(x.user),before)
  const y=await setup(),old=(await store.listExperiences(y.user))[0]!,text='我会Excel，'+y.episode+'。'
  await pool.query('UPDATE messages SET content=$3 WHERE user_id=$1 AND id=$2',[y.user,y.run.source_message_id,text])
  await pool.query('UPDATE experiences SET source_quote=$3 WHERE user_id=$1 AND id=$2',[y.user,old.id,text.slice(0,-1)])
  const independent=await durable(y.user)
  await assert.rejects(transaction(c=>persistMemoryControl(c,y.control,y.operation)),/CONTROL_EPISODE_SCOPE_UNVERIFIED/)
  assert.deepEqual(await durable(y.user),independent)
 })
 await t.test('a single fact control keeps sibling facts; a whole-message legacy episode cannot authorize expansion',async()=>{
  const x=await setup('','忘记这条记录')
  await transaction(c=>persistMemoryControl(c,x.control,x.operation))
  assert.ok((await growthView(x.user)).items.some(i=>i.text==='没有做分析'))
  const y=await setup()
  await pool.query('UPDATE experiences SET source_quote=$2 WHERE user_id=$1',[y.user,y.text])
  const before=await durable(y.user)
  await assert.rejects(transaction(c=>persistMemoryControl(c,y.control,y.operation)),/CONTROL_EPISODE_SCOPE_UNVERIFIED/)
  assert.deepEqual(await durable(y.user),before)
 })
 await t.test('overlapping episode sources abstain atomically; pending confirmation uses the same complete scope',async()=>{
  const x=await setup(),original=(await store.listExperiences(x.user))[0]!
  await pool.query('INSERT INTO experiences SELECT (jsonb_populate_record(NULL::experiences,to_jsonb(e)||jsonb_build_object(\'id\',$2::uuid,\'source_quote\',$3::text))).* FROM experiences e WHERE user_id=$1 AND id=$4',[x.user,randomUUID(),'上周我整理过社团问卷的三列数据',original.id])
  const before=await durable(x.user)
  await assert.rejects(transaction(c=>persistMemoryControl(c,x.control,x.operation)),/CONTROL_EPISODE_AMBIGUOUS/)
  assert.deepEqual(await durable(x.user),before)
  const y=await setup()
  await store.finishRun(y.control,{candidates:[],audit:[],pendingMemoryControl:{kind:'forget',clauseText:y.operation.clauseText,candidates:[{itemId:y.operation.itemId,revision:y.operation.expectedRevision,preview:'合成经历'}]}},'请选择要遗忘的记录。',null,new AbortController().signal)
  const pending=(await listControlRequests(y.user))[0]!,request={requestId:randomUUID(),action:'confirm' as const,itemId:y.operation.itemId}
  await resolveControlRequest(y.user,pending.id,request)
  assert.equal((await store.listExperiences(y.user)).length,0)
  assert.ok(!(await growthView(y.user)).items.some(i=>i.text==='没有做分析'))
  const after=await durable(y.user)
  await resolveControlRequest(y.user,pending.id,request)
  assert.deepEqual(await durable(y.user),after)
 })
 await t.test('a later label shared by two episodes rejects the entire forget transaction',async()=>{
  const x=await setup()
  const quote='昨天我整理过另一次社团问卷的两列数据，没有收到反馈'
  const chat=randomUUID();await store.createConversation(x.user,{id:chat,title:'另一段经历'})
  const run=(await store.startRun(x.user,chat,randomUUID(),quote+'。社团问卷经历并不证明我适合数据运营。')).run
  const interpretation='社团问卷经历并不证明我适合数据运营'
  const staged:store.Staged={candidates:[],audit:[],growth:await stageGrowthUpdates(run,[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{messageId:run.source_message_id,quote:interpretation}}],[])}
  await store.stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote,links:[]})
  await store.finishRun(run,staged,'两件独立的合成经历。',null,new AbortController().signal)
  assert.equal((await store.listExperiences(x.user)).length,2)
  const before=await durable(x.user)
  await assert.rejects(transaction(c=>persistMemoryControl(c,x.control,x.operation)),/CONTROL_EPISODE_AMBIGUOUS/)
  assert.deepEqual(await durable(x.user),before,'an unresolved later reference cannot produce a partial forget receipt')
 })
 await t.test('an action quote containing an independent retained fact cannot authorize whole-clause deletion',async()=>{
  const episode='我已经会用Excel也整理过社团问卷三列数据'
  for(const [primaryQuote,separateSkill] of [['整理过社团问卷三列数据',true],[episode,true],[episode,false]] as const){
  const {user,chat}=await h.account()
  const run=(await store.startRun(user,chat,randomUUID(),episode+'。')).run
  const quotes=[...(separateSkill?['我已经会用Excel']:[]),primaryQuote]
  const staged:store.Staged={candidates:[],audit:[],growth:await stageGrowthUpdates(run,quotes.map(quote=>({target:{operation:'create' as const},assertion:'user_reported' as const,kind:'context' as const,source:{messageId:run.source_message_id,quote}})),[])}
  await store.stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote:episode,links:[]})
  await store.finishRun(run,staged,'合成的并列来源。',null,new AbortController().signal)
  const primary=(await growthView(user)).items.find(item=>item.text===primaryQuote)!
  assert.ok(primary)
  const clauseText='请忘记整理社团问卷三列数据那段经历'
  const control=(await store.startRun(user,chat,randomUUID(),clauseText+'。保留Excel能力。')).run
  const before=await durable(user)
  await assert.rejects(transaction(c=>persistMemoryControl(c,control,{kind:'forget',itemId:primary.id,expectedRevision:primary.revision,clauseText})),/CONTROL_EPISODE_(?:SOURCE_AMBIGUOUS|SCOPE_UNVERIFIED)/)
  assert.deepEqual(await durable(user),before)
  }
 })
 await t.test('an independent result-side fact inside a legacy episode span is not erased',async()=>{
  const {user,chat}=await h.account(),episode='上周我整理了问卷，没有做分析，也获得了奖学金'
  const run=(await store.startRun(user,chat,randomUUID(),episode+'。')).run
  const quotes=['上周我整理了问卷','没有做分析','也获得了奖学金']
  const staged:store.Staged={candidates:[],audit:[],growth:await stageGrowthUpdates(run,quotes.map(quote=>({target:{operation:'create' as const},assertion:'user_reported' as const,kind:'context' as const,source:{messageId:run.source_message_id,quote}})),[])}
  await store.stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote:episode,links:[]})
  await store.finishRun(run,staged,'合成的并列来源。',null,new AbortController().signal)
  const primary=(await growthView(user)).items.find(item=>item.text===quotes[0])!
  assert.ok(primary)
  const clauseText='请忘记上周整理问卷那段经历'
  const control=(await store.startRun(user,chat,randomUUID(),clauseText+'。保留奖学金事实。')).run
  const before=await durable(user)
  await assert.rejects(transaction(c=>persistMemoryControl(c,control,{kind:'forget',itemId:primary.id,expectedRevision:primary.revision,clauseText})),/CONTROL_EPISODE_(?:SOURCE_AMBIGUOUS|SCOPE_UNVERIFIED)/)
  assert.deepEqual(await durable(user),before)
 })
 await t.test('similar labels and independently sourced or edited facts are not swept into the episode',async()=>{
  const x=await setup(),other=await setup(),otherBefore=await durable(other.user)
  const quotes=['社团问卷经历之外我还会Python','社团问卷经历并不证明我适合数据运营，但我会Python','另一社团问卷经历并不证明我适合数据运营','社团问卷经历并不证明我适合数据运营和咨询','没有收到反馈经历并不说明我适合数据运营']
  const chat=randomUUID();await store.createConversation(x.user,{id:chat,title:'独立事实对照'})
  const run=(await store.startRun(x.user,chat,randomUUID(),quotes.join('。')+'。')).run
  const growth=await stageGrowthUpdates(run,quotes.map(quote=>({target:{operation:'create' as const},assertion:'user_reported' as const,kind:'context' as const,source:{messageId:run.source_message_id,quote}})),[])
  await store.finishRun(run,{candidates:[],audit:[],growth},'合成独立事实。',null,new AbortController().signal)
  const ids=(await growthView(x.user)).items.filter(i=>quotes.includes(i.text)).map(i=>i.id)
  const before=(await pool.query('SELECT id,revision,text,sources FROM growth_items WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',[x.user,ids])).rows
  assert.equal(before.length,quotes.length)
  await transaction(c=>persistMemoryControl(c,x.control,x.operation))
  assert.deepEqual((await pool.query('SELECT id,revision,text,sources FROM growth_items WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',[x.user,ids])).rows,before)
  assert.deepEqual(await durable(other.user),otherBefore)
 })
 }finally{await h.close()}
})
