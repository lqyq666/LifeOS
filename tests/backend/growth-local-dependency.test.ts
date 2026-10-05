import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {stageGrowthUpdates,growthContext,growthView,growthSnapshotKey,actOnGrowthItem} from '../../server/growth.ts'
import {parseActionCoachTurn} from '../../server/action-coach-contracts.ts'
import {configureProviderPayload} from '../../server/model-payload.ts'
import {Value} from 'typebox/value'

test('explicit local evidence resolves to saved facts and corrections in either order without upgrading stale references',async t=>{
  const user='growth-local-'+randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  try{
    for(const observationFirst of [false,true]){
      const chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC local evidence'})
      const run=(await store.startRun(user,chat,randomUUID(),'我想先探索就业。')).run
      const source={messageId:run.source_message_id,quote:'我想先探索就业'}
      const fact={target:{operation:'create' as const},kind:'goal' as const,assertion:'user_reported' as const,source}
      const observation={target:{operation:'create' as const},kind:'priority' as const,assertion:'ai_observation' as const,text:'先核对就业探索的关键缺口',source,dependencies:[{updateIndex:observationFirst?1:0}],limitation:'仅有本人当前目标，具体岗位与经验未知'}
      const changes=observationFirst?[observation,fact]:[fact,observation]
      const parsed=parseActionCoachTurn(JSON.stringify({reply:'先核对就业探索。',growthUpdates:changes}))
      const schema=(configureProviderPayload({},{provider:'bailian',id:'qwen3.8-flash'},'default',undefined,undefined,8192,run.source_message_id,[],[]) as any).response_format.json_schema.schema
      assert.equal(Value.Check(schema,parsed),true,'an empty initial growth snapshot still permits explicit local fact references')
      for(const index of [-1,8,1])await assert.rejects(stageGrowthUpdates(run,[fact,{...observation,dependencies:[{updateIndex:index}]}],[]),{code:'GROWTH_DEPENDENCY_INVALID'})
      const deduplicated=await stageGrowthUpdates(run,[fact,fact,{...observation,dependencies:[{updateIndex:1}]}],[])
      assert.equal(deduplicated.changes.length,2)
      assert.deepEqual(deduplicated.changes[1].assertion==='ai_observation'?deduplicated.changes[1].dependencies:[],[{updateIndex:0}],'deduplication keeps the selected fact identity')
      const staged=await stageGrowthUpdates(run,parsed.growthUpdates!,[])
      const saved=await store.finishRun(run,{candidates:[],audit:[],growth:staged,growthSnapshotKey:growthSnapshotKey([])},'先核对就业探索。',null,new AbortController().signal)
      const factId=saved.growthIds[observationFirst?1:0],observationId=saved.growthIds[observationFirst?0:1]
      let view=await growthView(user,chat)
      assert.deepEqual(view.items.find(row=>row.id===observationId)!.dependencies,[{id:factId,revision:1}])
      assert.equal(view.items.find(row=>row.id===observationId)!.status,'proposed')
      const correction=(await store.startRun(user,chat,randomUUID(),'更正：现在先准备升学。')).run
      const current=await growthContext(user,chat),correctedSource={messageId:correction.source_message_id,quote:'现在先准备升学'}
      const correctedFact={...fact,target:{operation:'replace' as const,itemId:factId,expectedRevision:1},source:correctedSource}
      const correctedObservation={...observation,text:'先核对升学准备条件',source:correctedSource}
      for(const ordered of [[correctedFact,{...correctedObservation,dependencies:[{id:factId,revision:1}]}],[{...correctedObservation,dependencies:[{id:factId,revision:1}]},correctedFact]])await assert.rejects(stageGrowthUpdates(correction,ordered,current),{code:'GROWTH_DEPENDENCY_INVALID'})
      const corrected=await stageGrowthUpdates(correction,observationFirst?[correctedObservation,correctedFact]:[correctedFact,correctedObservation],current)
      const final=await store.finishRun(correction,{candidates:[],audit:[],growth:corrected,usedGrowthRefs:current.map(row=>({id:row.id,revision:row.revision})),growthSnapshotKey:growthSnapshotKey(current)},'按更正后的目标核对。',null,new AbortController().signal)
      const nextId=final.growthIds[observationFirst?0:1]
      view=await growthView(user,chat)
      assert.deepEqual(view.items.find(row=>row.id===nextId)!.dependencies,[{id:factId,revision:2}])
      assert.equal(view.items.find(row=>row.id===nextId)!.status,'proposed')
      assert.equal(view.items.find(row=>row.id===observationId)!.unavailableReason,'dependency_changed')
      assert.equal(view.items.find(row=>row.id===factId)!.sources[0].quote,correctedSource.quote)
      await actOnGrowthItem(user,factId,{requestId:randomUUID(),expectedRevision:2,action:'forget'})
      assert.ok(!(await growthContext(user,chat)).some(row=>row.id===factId||row.id===nextId))
      const same=(await store.startRun(user,chat,randomUUID(),'我想探索绘画就业方向。')).run
      const sameSource={messageId:same.source_message_id,quote:'我想探索绘画就业方向'}
      const sameFact={...fact,kind:'direction' as const,source:sameSource}
      const sameObservation={...observation,kind:'direction' as const,text:sameSource.quote,source:sameSource,dependencies:[{updateIndex:0}]}
      const sameSaved=await store.finishRun(same,{candidates:[],audit:[],growth:await stageGrowthUpdates(same,[sameFact,sameObservation],[])},'保留本人方向与待核对观察。',null,new AbortController().signal)
      assert.notEqual(sameSaved.growthIds[0],sameSaved.growthIds[1],'the same wording must not merge a reported fact with an observation')
      const sameView=await growthView(user,chat)
      assert.equal(sameView.items.find(row=>row.id===sameSaved.growthIds[0])!.assertion,'user_reported')
      assert.equal(sameView.items.find(row=>row.id===sameSaved.growthIds[1])!.status,'proposed')
      assert.deepEqual(sameView.items.find(row=>row.id===sameSaved.growthIds[1])!.dependencies,[{id:sameSaved.growthIds[0],revision:1}])
      const timed=(await store.startRun(user,chat,randomUUID(),'每周只能两小时。')).run
      const deadline=new Date(Date.now()+60000).toISOString()
      const timedFact={...fact,kind:'constraint' as const,source:{messageId:timed.source_message_id,quote:'每周只能两小时'},validUntil:deadline}
      const timedObservation={...observation,source:timedFact.source,dependencies:[{updateIndex:0}]}
      await assert.rejects(stageGrowthUpdates(timed,[{...timedFact,validUntil:'2020-01-01T00:00:00Z'},timedObservation],[]),{code:'GROWTH_DEPENDENCY_INVALID'})
      const timedStage=await stageGrowthUpdates(timed,[timedFact,timedObservation],[])
      const advanced=t.mock.method(Date,'now',()=>Date.parse(deadline)+1)
      try{await assert.rejects(store.finishRun(timed,{candidates:[],audit:[],growth:timedStage},'截止后不可依赖。',null,new AbortController().signal),{code:'GROWTH_SNAPSHOT_INVALIDATED'})}finally{advanced.mock.restore()}
      assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1 AND origin_request_id=$2',[user,timed.request_id])).rows[0].n,0,'expiry at commit rolls back the fact and observation together')
      await store.terminateRun(user,timed.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
    }
  }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end()}
})
