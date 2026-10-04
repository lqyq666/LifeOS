import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { pool, transaction, HttpError } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { stageCoachEvent, invalidateCoachSources, coachEventView } from '../../server/action-coach-events.ts'
import { indexCoachEventOnce, searchCoachEvents, rankConfirmedCoachExperiences } from '../../server/coach-retrieval.ts'
import { localEmbedding } from '../../server/local-embedding.ts'
import { setMemorySettings } from '../../server/memory.ts'

test('frozen retrieval uses real offline embeddings and PostgreSQL ownership/version/withdrawal checks',async t=>{
  const user='coach-search-'+randomUUID(),foreign='coach-search-foreign-'+randomUUID(),chat=randomUUID(),second=randomUUID(),foreignChat=randomUUID()
  const fixture=JSON.parse(readFileSync('tests/fixtures/action-coach-retrieval.json','utf8'))
  const ids=new Map<string,string>(),sources=new Map<string,string>()
  const signal=new AbortController().signal
  for(const owner of [user,foreign])await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[owner,owner+'@example.invalid'])
  for(const [owner,id] of [[user,chat],[user,second],[foreign,foreignChat]])await store.createConversation(owner,{id,title:'Synthetic frozen retrieval'})
  async function create(text:string,title:string,owner=user,conversation=chat){
    const run=(await store.startRun(owner,conversation,randomUUID(),text)).run
    const reply='先保留这次过程，未声称已经执行下一步。'
    const coach=await stageCoachEvent(run,{target:{operation:'create',title,source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},reply)
    const response=await store.finishRun(run,{candidates:[],audit:[],coach},reply,null,signal)
    return {event:response.event!,source:run.source_message_id}
  }
  async function drain(){for(let i=0;i<100;i++)if(!await indexCoachEventOnce())return;throw new Error('Index jobs did not drain')}
  async function forget(message:string){await transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings']);await invalidateCoachSources(c,user,[message],true)})}
  const results:any[]=[]
  try{
    await localEmbedding.start()
    for(const item of fixture.corpus){const record=await create(item.text,'事件 '+item.id);ids.set(item.id,record.event.id);sources.set(item.id,record.source)}
    for(let i=0;i<45;i++){
      const run=(await store.startRun(user,chat,randomUUID(),'无关历史干扰 '+i)).run
      await store.finishRun(run,{candidates:[],audit:[]},'这是无关回复。',null,signal)
    }
    await drain()
    await t.test('12 frozen natural paraphrases find the correct event beyond 40 recent messages',async()=>{
      const historyRun=(await store.startRun(user,chat,randomUUID(),'这轮只测试历史窗口。')).run
      const recent=await store.contextForRun(historyRun)
      assert.ok(!recent.some(message=>message.id===sources.get('E01')))
      await store.terminateRun(user,historyRun.request_id,'cancelled','SYNTHETIC_HISTORY_WINDOW')
      for(const query of fixture.queries){
        const found=await searchCoachEvents(user,chat,{query:query.text},signal)
        const hit=found.events.some(event=>event.id===ids.get(query.expectedEventId))
        results.push({queryId:query.id,expectedEventId:ids.get(query.expectedEventId),returned:found.events.map(event=>event.id),hit})
      }
      assert.ok(results.filter(result=>result.hit).length>=11,JSON.stringify(results))
    })
    await t.test('confirmed experience paraphrases retain older records and use the current corrected content',async()=>{
      const older={id:'older-experience',revision:2,content:{summary:'我给同学制作了复习资料',action:'把电子文件发给同学',result:'手机无法打开附件，因此还没有阅读',reflection:'先确认文件可以打开，再询问实际内容需求'}}
      const rows=Array.from({length:45},(_,index)=>({id:'newer-'+index,revision:1,content:{summary:'完成跑步训练',action:'操场慢跑三公里',result:'运动后记录心率'}}))
      const found=await rankConfirmedCoachExperiences([...rows,older],'之前发给同学的文档在移动设备上看不了，后续该怎样确认需求？',1)
      assert.equal(found[0].id,older.id);assert.equal(found[0].revision,2)
      assert.deepEqual(found[0].content,older.content)
      const corrected={...older,revision:3,content:{summary:'我给同学制作了复习资料',action:'重新导出为通用格式并发送',result:'同学已经打开并阅读，认为例题太少',reflection:'确认他需要哪类例题'}}
      const refreshed=await rankConfirmedCoachExperiences([...rows,corrected],'对方已经读完文档，但希望增加练习题，下一步准备什么？',1)
      assert.equal(refreshed[0].revision,3);assert.equal(refreshed[0].content.result,corrected.content.result)
      assert.equal(JSON.stringify(refreshed).includes('无法打开'),false)
    })
    await t.test('exact IDs, action IDs, object and time filters preserve authorization',async()=>{
      assert.equal((await searchCoachEvents(user,chat,{query:'',eventId:ids.get('E01')})).events[0].id,ids.get('E01'))
      const event=(await coachEventView(user,chat,ids.get('E04')))!
      const actionRun=(await store.startRun(user,chat,randomUUID(),'请为海报重新准备可用的文字。')).run
      const material='请把海报字号调大，再打印一张确认可读。'
      const actionCoach=await stageCoachEvent(actionRun,{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},action:{operation:'create',draft:{content:material}}},material)
      const saved=await store.finishRun(actionRun,{candidates:[],audit:[],coach:actionCoach},material,null,signal)
      const actionId=saved.event!.actions[0].id
      assert.equal((await searchCoachEvents(user,chat,{query:'',actionId})).events[0].id,event.id)
      assert.equal((await searchCoachEvents(foreign,foreignChat,{query:'',actionId})).events.length,0)
      assert.equal((await searchCoachEvents(user,chat,{query:'',object:'李同学'})).events[0].id,ids.get('E01'))
      assert.equal((await searchCoachEvents(user,chat,{query:'',after:'2099-01-01T00:00:00Z'})).events.length,0)
      await assert.rejects(searchCoachEvents(user,chat,{query:'',after:'bad-date'}),(error:any)=>error.code==='RETRIEVAL_DATE_INVALID')
      assert.equal((await searchCoachEvents(foreign,foreignChat,{query:'',eventId:ids.get('E01')})).events.length,0)
      await assert.rejects(searchCoachEvents(foreign,chat,{query:'资料'}),(error:any)=>error.code==='NOT_FOUND')
      assert.equal((await searchCoachEvents(user,second,{query:'',eventId:ids.get('E01')})).events.length,0)
      await setMemorySettings(user,{enabled:true,expectedRevision:0,requestId:randomUUID()})
      assert.equal((await searchCoachEvents(user,second,{query:'',eventId:ids.get('E01')})).events[0].id,ids.get('E01'))
      await setMemorySettings(user,{enabled:false,expectedRevision:1,requestId:randomUUID()})
      assert.equal((await searchCoachEvents(user,second,{query:fixture.queries[0].text})).events.length,0)
    })
    await t.test('same-name objects remain candidates without selecting or changing the current event',async()=>{
      const one=await create('李同学说午餐想换一家食堂。','李同学的午餐')
      const two=await create('另一个李同学问下午图书馆几点关门。','李同学的图书馆')
      const found=await searchCoachEvents(user,chat,{query:'',object:'李同学'})
      assert.equal(found.ambiguous,true)
      assert.ok(found.events.some(event=>event.id===one.event.id));assert.ok(found.events.some(event=>event.id===two.event.id))
      assert.equal((await coachEventView(user,chat))?.id,two.event.id)
      await drain()
    })
    await t.test('correction removes the old vector immediately and rebuilt results contain the new raw fact only',async()=>{
      const previous=(await coachEventView(user,chat,ids.get('E01')))!
      const changed='更正，李同学其实已经看过资料，只是还没有回复。'
      const run=(await store.startRun(user,chat,randomUUID(),changed)).run
      const coach=await stageCoachEvent(run,{target:{operation:'continue',eventId:previous.id,expectedRevision:previous.revision},corrections:[{nodeId:previous.nodes[0].id,source:{messageId:run.source_message_id,quote:changed}}]},'使用你刚才的更正继续核对。')
      await store.finishRun(run,{candidates:[],audit:[],coach},coach.reply,null,signal)
      assert.equal((await pool.query('SELECT 1 FROM coach_semantic_index WHERE user_id=$1 AND event_id=$2',[user,previous.id])).rowCount,0)
      const immediate=await coachEventView(user,chat)
      assert.equal(immediate?.nodes[0].content,changed)
      await drain()
      const found=await searchCoachEvents(user,chat,{query:'',eventId:previous.id})
      assert.equal(found.events[0].nodes[0].content,changed)
      assert.ok(!JSON.stringify(found.events).includes(fixture.corpus[0].text))
    })
    await t.test('forgetting during an in-flight encoding cannot restore an index or job',async()=>{
      const record=await create('临时核验记录：我提交过三页材料。','准备遗忘的事件')
      let entered!:()=>void,release!:()=>void
      const enteredPromise=new Promise<void>(resolve=>{entered=resolve}),wait=new Promise<void>(resolve=>{release=resolve})
      const pending=indexCoachEventOnce(async texts=>{const vectors=await localEmbedding.encode(texts);entered();await wait;return vectors})
      await enteredPromise
      try{await forget(record.source)}finally{release()}
      await pending
      assert.equal((await pool.query('SELECT 1 FROM coach_semantic_index WHERE user_id=$1 AND event_id=$2',[user,record.event.id])).rowCount,0)
      assert.equal((await pool.query('SELECT 1 FROM coach_index_jobs WHERE user_id=$1 AND event_id=$2',[user,record.event.id])).rowCount,0)
      assert.equal((await searchCoachEvents(user,chat,{query:'',eventId:record.event.id})).events.length,0)
    })
    await t.test('controlled cancellation preserves the retry budget; unexpected faults stop after three attempts',async()=>{
      await drain()
      const record=await create('关停取消与意外错误的隔离任务。','任务故障验收')
      await assert.rejects(indexCoachEventOnce(async()=>{throw new HttpError(499,'CANCELLED')}),(error:any)=>error.code==='CANCELLED')
      let job=(await pool.query('SELECT status,attempts,locked_at FROM coach_index_jobs WHERE user_id=$1 AND event_id=$2',[user,record.event.id])).rows[0]
      assert.deepEqual(job,{status:'pending',attempts:0,locked_at:null})
      for(let attempt=1;attempt<=3;attempt++){
        await assert.rejects(indexCoachEventOnce(async()=>{throw new Error('SYNTHETIC_ENCODER_FAULT')}),/SYNTHETIC_ENCODER_FAULT/)
        job=(await pool.query('SELECT status,attempts,locked_at FROM coach_index_jobs WHERE user_id=$1 AND event_id=$2',[user,record.event.id])).rows[0]
        assert.deepEqual(job,{status:attempt===3?'failed':'pending',attempts:attempt,locked_at:null})
      }
      assert.equal(await indexCoachEventOnce(async()=>{throw new Error('FAILED_JOB_MUST_NOT_RETRY')}),false)
      await forget(record.source)
    })
    await t.test('withdrawn sources cannot reappear through semantic or exact event lookup',async()=>{
      await forget(sources.get('E02')!)
      assert.equal((await searchCoachEvents(user,chat,{query:'',eventId:ids.get('E02')})).events.length,0)
      assert.ok(!(await searchCoachEvents(user,chat,{query:fixture.queries[1].text})).events.some(event=>event.id===ids.get('E02')))
      assert.equal((await pool.query('SELECT 1 FROM coach_semantic_index WHERE user_id=$1 AND event_id=$2',[user,ids.get('E02')])).rowCount,0)
    })
    mkdirSync('evidence/v1.3-action-coach',{recursive:true})
    writeFileSync('evidence/v1.3-action-coach/retrieval-db.json',JSON.stringify({evidence:'REAL_POSTGRESQL_REAL_OFFLINE_EMBEDDING_SYNTHETIC_FROZEN_EVENTS',hits:results.filter(result=>result.hit).length,total:results.length,results},null,2)+'\n')
  }finally{await localEmbedding.close();for(const owner of [user,foreign])await pool.query('DELETE FROM "user" WHERE id=$1',[owner]);await pool.end()}
})
