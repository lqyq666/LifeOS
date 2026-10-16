import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool,transaction,HttpError} from '../../server/db.ts'
import {loadSnapshot,stageCoachBackground,getMemoryView,setMemorySettings,applyMemoryAction,assertMemoryEvidence,persistChanges} from '../../server/memory.ts'
import {stageCoachEvent} from '../../server/action-coach-events.ts'
import * as store from '../../server/store.ts'

test('V1.3 stable background is opt-in, exact-current-source, editable, forgettable and atomic; event constraints stay in the event',async()=>{
  const user='coach-background-'+randomUUID(),signal=new AbortController().signal
  try{
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
    const chat=randomUUID();await store.createConversation(user,{id:chat,title:'背景与当前经过'})
    assert.deepEqual((await getMemoryView(user)).settings,{enabled:false,revision:0})
    const raw='我在大二，读计算机专业，每周能投入四小时。'
    const run=(await store.startRun(user,chat,randomUUID(),raw)).run
    const background=[{key:'education.major' as const,value:'计算机专业',source:{messageId:run.source_message_id,quote:'读计算机专业'}},{key:'education.stage' as const,value:'大二',source:{messageId:run.source_message_id,quote:'大二'}}]
    let snapshot=await loadSnapshot(user,chat,raw)
    assert.deepEqual(await stageCoachBackground(user,chat,run.source_message_id,background,snapshot),[])
    const settings=await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
    snapshot=await loadSnapshot(user,chat,raw)
    for(const invalid of [
      [{...background[0],value:'软件工程'}],
      [{...background[0],source:{...background[0].source,messageId:randomUUID()}}],
      [{...background[0],source:{...background[0].source,quote:''}}],
      [{...background[0],key:'availableTime',value:'四小时',source:{messageId:run.source_message_id,quote:'每周能投入四小时'}}],
      [background[0],{...background[0],value:'计算机'}],
    ])await assert.rejects(()=>stageCoachBackground(user,chat,run.source_message_id,invalid as any,snapshot),(e:any)=>e.code==='COACH_BACKGROUND_INVALID')
    const changes=await stageCoachBackground(user,chat,run.source_message_id,background,snapshot)
    const reply='这次先保留你的四小时投入边界。'
    const coach=await stageCoachEvent(run,{target:{operation:'create',title:'准备任务',source:{messageId:run.source_message_id,quote:raw}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:'每周能投入四小时'}}]},reply)
    const saved=await store.finishRun(run,{candidates:[],audit:[],snapshot,memoryChanges:changes,coach},reply,null,signal)
    assert.equal(saved.memorySavedCount,2)
    assert.equal(saved.event!.nodes[0].content,'每周能投入四小时')
    assert.equal((await pool.query('SELECT 1 FROM dialogue_states WHERE user_id=$1',[user])).rowCount,0)
    assert.equal((await store.decisionVersions(user,chat)).length,0)
    const items=(await getMemoryView(user)).items
    assert.ok(items.every(item=>item.scope==='user'&&item.taskType===null))
    assert.ok(!items.some(item=>item.key==='availableTime'))
    const major=items.find(item=>item.key==='education.major')!
    const second=randomUUID();await store.createConversation(user,{id:second,title:'另一件事'})
    const cross=await loadSnapshot(user,second,'准备新的课程项目')
    assert.equal(cross.profile.find(item=>item.key==='education.major')?.value,'计算机专业')
    assert.ok(!cross.profile.some(item=>item.key==='availableTime'))
    const target=pool as any,original=target.query
    target.query=function(sql:string,...args:any[]){if(sql.startsWith('SELECT enabled,revision FROM user_memory_settings'))throw new Error('synthetic read failure');return original.call(this,sql,...args)}
    try{await assert.rejects(()=>loadSnapshot(user,chat,'继续'),(e:any)=>e.code==='MEMORY_LOAD_FAILED')}finally{target.query=original}
    const corrected=await applyMemoryAction(user,major.id,{requestId:randomUUID(),expectedRevision:major.revision,action:'correct',value:'软件工程专业'})
    assert.equal(await assertMemoryEvidence(user,major.id,corrected.revision,true),'软件工程专业')
    await assert.rejects(()=>applyMemoryAction(user,major.id,{requestId:randomUUID(),expectedRevision:major.revision,action:'correct',value:'过期修改'}),(e:any)=>e.code==='MEMORY_REVISION_CONFLICT')
    const forgotten=await applyMemoryAction(user,major.id,{requestId:randomUUID(),expectedRevision:corrected.revision,action:'forget'})
    assert.equal(forgotten.status,'revoked')
    await assert.rejects(()=>assertMemoryEvidence(user,major.id,forgotten.revision,true),(e:any)=>e.code==='MEMORY_EVIDENCE_STALE')
    assert.ok(!(await getMemoryView(user)).items.some(item=>item.id===major.id))
    assert.deepEqual(await transaction(c=>persistChanges(c,user,chat,[changes[0]],new Date())),[])
    const cancelled=(await store.startRun(user,second,randomUUID(),'我在北方大学学习。')).run
    const cancelSnapshot=await loadSnapshot(user,second,'北方大学')
    const cancelChanges=await stageCoachBackground(user,second,cancelled.source_message_id,[{key:'education.school',value:'北方大学',source:{messageId:cancelled.source_message_id,quote:'北方大学'}}],cancelSnapshot)
    const abort=new AbortController();abort.abort()
    await assert.rejects(()=>store.finishRun(cancelled,{candidates:[],audit:[],snapshot:cancelSnapshot,memoryChanges:cancelChanges},'模拟回应',null,abort.signal))
    assert.equal((await pool.query("SELECT 1 FROM memory_items WHERE user_id=$1 AND key='education.school'",[user])).rowCount,0)
    await setMemorySettings(user,{requestId:randomUUID(),enabled:false,expectedRevision:settings.revision})
    assert.deepEqual((await loadSnapshot(user,second,'继续')).profile,[])
  }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end()}
})
