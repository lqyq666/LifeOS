import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {stageGrowthUpdates,growthView} from '../../server/growth.ts'
import {stageCoachEvent,coachEventView} from '../../server/action-coach-events.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

const userText='只谈老师邮件：如果不增加任务，你目前能形成什么暂定理解？同学表格那件事先暂停。'
const requestQuote='只谈老师邮件：如果不增加任务'
const pauseQuote='同学表格那件事先暂停'

test('request text cannot become an event fact and pause cannot become completed feedback',async()=>{
  const user='mail-table-'+randomUUID(),conversation=randomUUID(),signal=new AbortController().signal
  try{
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
    await store.createConversation(user,{id:conversation,title:'SYNTHETIC mail and table boundary'})
    await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
    const run=(await store.startRun(user,conversation,randomUUID(),userText)).run
    await assert.rejects(stageCoachEvent(run,{
      target:{operation:'create',title:'老师邮件未回复的状态梳理',source:{messageId:run.source_message_id,quote:requestQuote}},
      nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:requestQuote}}],
    },'暂定理解：老师邮件已发但未回复；不增加任务。'),{code:'COACH_SOURCE_INVALID'})
    await assert.rejects(stageGrowthUpdates(run,[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{messageId:run.source_message_id,quote:pauseQuote}}] as any,[]),{code:'GROWTH_FEEDBACK_INVALID'})
    const stagedGrowth=await stageGrowthUpdates(run,[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{messageId:run.source_message_id,quote:pauseQuote}}] as any,[])
    assert.ok(stagedGrowth.changes.some((item:any)=>item.kind==='context'&&item.text===pauseQuote),'pause remains a context boundary, not completed feedback')
    const staged:store.Staged={candidates:[],audit:[],growth:stagedGrowth}
    await store.finishRun(run,staged,'暂定理解：老师邮件已发但未回复；不增加任务。',null,signal)
    const event=await coachEventView(user,conversation)
    assert.equal(event?.actions.length??0,0,'no action is added by the pause turn')
    assert.ok((await growthView(user,conversation)).items.some((item:any)=>item.taskBoundary?.kind==='pause'&&item.taskBoundary.quote.includes(pauseQuote)),'the table pause remains a scoped pause')
  }finally{
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
    await localEmbedding.close();await pool.end()
  }
})
