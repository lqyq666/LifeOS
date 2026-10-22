import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool, transaction } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { setMemorySettings } from '../../server/memory.ts'
import { createGrowthItem, actOnGrowthItem, growthView, growthContext, growthSnapshotKey, assertGrowthSnapshot,stageGrowthUpdates } from '../../server/growth.ts'
import type { GrowthItem } from '../../src/features/growth/types.ts'
import { buildTurnPrompt } from '../../server/turn-prompt.ts'
import { invalidateCoachSources } from '../../server/action-coach-events.ts'

test('growth workspace preserves source/version/privacy and prevents outdated decisions (isolated PG, no provider)',async t=>{
  const user='growth-'+randomUUID(), other='growth-other-'+randomUUID(), chat=randomUUID(), second=randomUUID()
  for(const id of [user,other])await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[id,id+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC adult student'})
  await store.createConversation(user,{id:second,title:'SYNTHETIC second device'})
  const create=(text:string,kind:'goal'|'priority'|'direction'|'ability'|'unknown'='goal',dependencies:{id:string;revision:number}[]=[])=>createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind,text,dependencies})
  const act=(item:GrowthItem,action:'correct'|'pause'|'complete'|'reject'|'forget',text?:string)=>actOnGrowthItem(user,item.id,{requestId:randomUUID(),expectedRevision:item.revision,action,...(text?{text}:{})})
  try{
    await t.test('a deictic matter pause suspends the star-map next prompt without inventing a global direction',async()=>{
      const person='pause-view-'+randomUUID(),conversation=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[person,person+'@example.invalid'])
      await store.createConversation(person,{id:conversation,title:'SYNTHETIC paused exploration'})
      const goal=await createGrowthItem(person,{requestId:randomUUID(),conversationId:conversation,kind:'goal',text:'我想整理学习资料'})
      assert.match((await store.cognitionGraph(person)).starmapNextStep,/正在探索/)
      const text='我今天没精力继续验证，先暂停这个方向，不要再安排动作。只给一句阶段理解，等我以后主动回来再继续。',quote='先暂停这个方向'
      const run=(await store.startRun(person,conversation,randomUUID(),text)).run
      const growth=await stageGrowthUpdates(run,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:run.source_message_id,quote}}],[])
      await store.finishRun(run,{candidates:[],audit:[],growth},'先暂停这段探索，已有事实保留。',null,new AbortController().signal)
      const after=await store.cognitionGraph(person)
      assert.match(after.starmapNextStep,/暂停/)
      assert.doesNotMatch(after.starmapNextStep,/正在探索|当前重点|当前最优先/)
      assert.equal((await growthView(person)).items.find(i=>i.id===goal.id)!.status,'active','a scoped pause does not delete the original pursuit source')
      const {readDirectionControls}=await import('../../server/growth-controls.ts')
      assert.equal((await readDirectionControls(person)).length,0,'the unnamed matter is not guessed as a career direction')
    })
    await t.test('an explicit direction pause has the same effective state in the theme data and its displayed label',async()=>{
      const person='named-pause-'+randomUUID(),conversation=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[person,person+'@example.invalid'])
      await store.createConversation(person,{id:conversation,title:'SYNTHETIC named pause'})
      await createGrowthItem(person,{requestId:randomUUID(),conversationId:conversation,kind:'goal',text:'我想要准备考研'})
      const control=await import('../../server/growth-controls.ts'),run=(await store.startRun(person,conversation,randomUUID(),'先暂停考研。')).run
      const derived=control.deriveExplicitDirectionControls('先暂停考研。');assert.equal(derived.status,'explicit')
      if(derived.status!=='explicit')throw Error('EXPECTED_EXPLICIT_CONTROL')
      const key=control.directionControlsSnapshotKey(await control.readDirectionControls(person)),directionControls=await control.stageDirectionControls(run,derived.changes,key)
      await store.finishRun(run,{candidates:[],audit:[],directionControls,directionControlSnapshotKey:key},'考研方向已暂停。',null,new AbortController().signal)
      const theme=(await store.cognitionGraph(person)).nodes.find((n:any)=>n.type==='value'&&n.title==='考研') as any
      assert.ok(theme);assert.equal(theme.themeStatus,'paused');assert.match(theme.description,/已暂停/)
    })
    await t.test('unscoped tentative intent keeps its source as context instead of becoming a current goal',async()=>{
      for(const [quote,kind] of [['我也跟着想报','context'],['我决定考研','goal']] as const){
        const run=(await store.startRun(user,chat,randomUUID(),quote)).run
        const growth=await stageGrowthUpdates(run,[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{messageId:run.source_message_id,quote}}],[])
        await store.finishRun(run,{candidates:[],audit:[],growth},'保留你表达的意向及其确定程度。',null,new AbortController().signal)
        const saved=(await growthView(user,chat)).items.find(i=>i.text===quote)!
        assert.equal(saved.kind,kind)
        assert.equal(saved.sources[0]?.quote,quote)
      }
    })
    await t.test('public third-party speech is context, while an explicit later reply remains response evidence',async()=>{
      for(const [text,quote,expected] of [
        ['回来反馈：我只查看了一位校友公开分享的远程岗位经历。他说地点自由，但每天固定开两次会。这是一条个例。','他说地点自由',undefined],
        ['回来反馈：老师后来回复说这周忙，下周再看。','回来反馈：老师后来回复说这周忙，下周再看','reported_response'],
      ] as const){
        const run=(await store.startRun(user,chat,randomUUID(),text)).run
        const growth=await stageGrowthUpdates(run,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:run.source_message_id,quote}}],[])
        await store.finishRun(run,{candidates:[],audit:[],growth},'保留该来源的原话与适用范围。',null,new AbortController().signal)
        const item=(await growthView(user,chat)).items.find(i=>i.text===quote)!
        assert.ok(item)
        assert.equal(item.feedbackEvidence?.outcomes.response.status,expected)
      }
    })
    let goal!:GrowthItem, constraint!:GrowthItem, direction!:GrowthItem, priority!:GrowthItem
    await t.test('manual facts are explicit user evidence; unknown stays unknown; short constraints retained',async()=>{
      goal=await create('先探索就业')
      constraint=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'constraint',text:'仅两小时',validUntil:'2099-01-01T00:00:00Z'})
      const unknown=await create('是否喜欢研究还不清楚','unknown')
      assert.equal(goal.assertion,'user_edit');assert.equal(goal.sources[0].quote,'先探索就业')
      assert.equal(unknown.assertion,'unknown');assert.equal(constraint.text,'仅两小时')
    })
    await t.test('cross-account access denied and cross-session use follows memory permission',async()=>{
      await assert.rejects(growthView(other,chat),{code:'NOT_FOUND'})
      await assert.rejects(actOnGrowthItem(other,goal.id,{requestId:randomUUID(),expectedRevision:1,action:'correct',text:'别人的目标'}),{code:'NOT_FOUND'})
      assert.equal((await growthContext(user,second)).length,0)
      assert.ok((await growthView(user)).items.some(row=>row.id===goal.id),'own workspace still manageable when cross-session permission off')
      await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
      assert.ok((await growthContext(user,second)).some(row=>row.id===goal.id))
    })
    await t.test('dependencies use exact current revisions; partial correction preserves other facts and invalidates transitive advice',async()=>{
      direction=await create('探索小型产品项目','direction',[{id:goal.id,revision:goal.revision}])
      priority=await create('先找一个小项目','priority',[{id:direction.id,revision:direction.revision}])
      goal=await act(goal,'correct','现在优先准备考研')
      const view=await growthView(user,chat)
      assert.equal(view.items.find(row=>row.id===constraint.id)?.text,'仅两小时')
      assert.equal(view.items.find(row=>row.id===direction.id)?.unavailableReason,'dependency_changed')
      assert.equal(view.items.find(row=>row.id===priority.id)?.unavailableReason,'dependency_changed')
      await assert.rejects(create('无效旧依据','priority',[{id:goal.id,revision:1}]),{code:'GROWTH_DEPENDENCY_INVALID'})
    })
    await t.test('idempotent replay cannot duplicate records or overwrite a newer revision',async()=>{
      const input={requestId:randomUUID(),conversationId:chat,kind:'ability' as const,text:'团队获奖；我只做了访谈记录'}
      const first=await createGrowthItem(user,input), replayed=await createGrowthItem(user,input)
      assert.equal(first.id,replayed.id)
      await assert.rejects(createGrowthItem(user,{...input,text:'我独自做了全部工作'}),{code:'REQUEST_ID_REUSED'})
      const corrected=await act(first,'correct','更正：我只整理了三次访谈')
      await assert.rejects(act(first,'correct','过时覆盖'),{code:'GROWTH_REVISION_CONFLICT'})
      assert.equal((await createGrowthItem(user,input)).text,corrected.text)
    })
    await t.test('time constraints require a bounded period; expired constraints leave the model context',async()=>{
      await assert.rejects(createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'constraint',text:'本周只有两小时'}),{code:'GROWTH_TIME_REQUIRED'})
      await assert.rejects(createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'constraint',text:'两小时',validUntil:'2099-01-01'}),{code:'GROWTH_TIME_INVALID'})
      const expired=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'constraint',text:'上周三小时',validUntil:'2020-01-01T00:00:00Z'})
      assert.equal((await growthView(user,chat)).items.find(row=>row.id===expired.id)?.unavailableReason,'expired')
      assert.ok(!(await growthContext(user,chat)).some(row=>row.id===expired.id))
    })
    await t.test('question-form user sources remain valid; withdrawn source and dependent understanding disappear',async()=>{
      const run=(await store.startRun(user,chat,randomUUID(),'暂不联系，先准备，可以吗？')).run
      await store.finishRun(run,{candidates:[],audit:[]},'可以先保留这个边界。',null,new AbortController().signal)
      const id=randomUUID()
      await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources) VALUES($1,$2,$3,'preference','暂不联系','user_reported','active',$4)",[id,user,chat,JSON.stringify([{type:'message',id:run.source_message_id,quote:'暂不联系，先准备，可以吗？'}])])
      assert.equal((await growthContext(user,chat)).find(row=>row.id===id)?.text,'暂不联系')
      const dependent=await create('先自行准备','priority',[{id,revision:1}])
      await transaction(c=>invalidateCoachSources(c,user,[run.source_message_id],true))
      const view=await growthView(user,chat)
      for(const itemId of [id,dependent.id]){
        const row=view.items.find(item=>item.id===itemId)!
        assert.equal(row.text,'');assert.equal(row.sources.length,0);assert.equal(row.unavailableReason,'source_revoked')
      }
      assert.ok(!(await growthContext(user,chat)).some(row=>row.id===id||row.id===dependent.id))
    })
    await t.test('forget clears historical and transitive derivative content; replay cannot revive it',async()=>{
      const source=await create('只在沿海工作'), derived=await create('沿海项目方向','direction',[{id:source.id,revision:source.revision}])
      const leaf=await create('去联系沿海项目','priority',[{id:derived.id,revision:derived.revision}])
      const request={requestId:randomUUID(),expectedRevision:source.revision,action:'forget' as const}
      await actOnGrowthItem(user,source.id,request);await actOnGrowthItem(user,source.id,request)
      const view=await growthView(user,chat)
      assert.ok(!view.items.some(row=>row.id===source.id))
      for(const id of [derived.id,leaf.id])assert.equal(view.items.find(row=>row.id===id)?.text,'')
      const revisions=(await pool.query('SELECT snapshot FROM growth_revisions WHERE user_id=$1 AND item_id=ANY($2::uuid[])',[user,[source.id,derived.id,leaf.id]])).rows
      assert.ok(!JSON.stringify(revisions).includes('沿海'))
      await assert.rejects(act(source,'correct','恢复旧方向'),{code:'GROWTH_REVISION_CONFLICT'})
    })
    await t.test('pausing and rejecting do not become active model evidence',async()=>{
      const paused=await create('项目暂停'), rejected=await create('不再考虑海外','direction')
      await act(paused,'pause');await act(rejected,'reject')
      const context=await growthContext(user,chat)
      assert.ok(!context.some(row=>row.id===paused.id||row.id===rejected.id))
    })
    await t.test('actual prompt carries corrected personal goals and omits invalidated recommendations',async()=>{
      const growth=await growthContext(user,second), id=randomUUID()
      const prompt=JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:'这周要不要参加竞赛？'}],growth}))
      assert.ok(prompt.growth.some((row:GrowthItem)=>row.text==='现在优先准备考研'))
      assert.ok(!prompt.growth.some((row:GrowthItem)=>row.id===direction.id||row.id===priority.id))
    })
    await t.test('correction during a reply invalidates the transaction, with no assistant saved',async()=>{
      const run=(await store.startRun(user,second,randomUUID(),'帮我选择这周优先什么')).run
      const snapshot=await growthContext(user,second)
      await act(goal,'correct','改为先找实习')
      const staged:store.Staged={candidates:[],audit:[],usedGrowthRefs:snapshot.map(row=>({id:row.id,revision:row.revision})),growthSnapshotKey:growthSnapshotKey(snapshot)}
      await assert.rejects(store.finishRun(run,staged,'应该继续旧目标。',null,new AbortController().signal),{code:'GROWTH_SNAPSHOT_INVALIDATED'})
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,run.request_id])).rows[0].n,0)
      await store.terminateRun(user,run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
    })
    await t.test('new constraints also invalidate an initially empty snapshot',async()=>{
      const empty=randomUUID();await store.createConversation(user,{id:empty,title:'SYNTHETIC empty snapshot'})
      await setMemorySettings(user,{requestId:randomUUID(),enabled:false,expectedRevision:1})
      const snapshot=await growthContext(user,empty);assert.equal(snapshot.length,0)
      await createGrowthItem(user,{requestId:randomUUID(),conversationId:empty,kind:'goal',text:'只讨论休息'})
      await assert.rejects(transaction(c=>assertGrowthSnapshot(c,user,empty,[],growthSnapshotKey(snapshot))),{code:'GROWTH_SNAPSHOT_INVALIDATED'})
    })
  }finally{
    for(const id of [user,other])await pool.query('DELETE FROM "user" WHERE id=$1',[id])
    await pool.end()
  }
})
