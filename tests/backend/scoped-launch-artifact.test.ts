import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {stageGrowthUpdates,growthContext} from '../../server/growth.ts'
import {coachEventView} from '../../server/action-coach-events.ts'

test('R4 actual failures: fully supplied questions and unique sourced contributions persist without model generation',async()=>{
 await localEmbedding.start();const user='artifact-'+randomUUID(),chat=randomUUID()
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0});await store.createConversation(user,{id:chat,title:'SYNTHETIC artifact'})
 const seed=(await store.startRun(user,chat,randomUUID(),'我负责文字和排版。')).run
 const growth=await stageGrowthUpdates(seed,[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{messageId:seed.source_message_id,quote:'我负责文字和排版'}}],[],{})
 await store.finishRun(seed,{candidates:[],audit:[],growth},'本人分工报告。',null,new AbortController().signal)
 const turn=async(text:string)=>{const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC new artifact session'});const run=(await store.startRun(user,conversation,randomUUID(),text)).run,input={run,staged:{candidates:[],audit:[]} as store.Staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}};const r=await createTurnEngine({capabilityVerified:()=>true})(input);await store.finishRun(run,input.staged,r.text,r.usage,input.signal);assert.equal((r.usage as {zeroLlm:boolean})?.zeroLlm,true);assert.equal((r.usage as {llmCallCount:number})?.llmCallCount,0);assert.equal((await coachEventView(user,conversation))!.actions[0]!.draft!.content,r.text.split('\n\n').at(-1));return {r,conversation}}
 const question=await turn('把这个问题压成一句：我想了解课程项目如何呈现实习所需能力。')
 assert.match(question.r.text,/课程项目如何呈现实习所需能力？/);assert.ok(!question.r.text.includes('学长您好'))
 const edited=await turn('把这个问题改成：你上一次查排课信息时，用了什么具体办法？不要代替同学回答。')
 assert.match(edited.r.text,/你上一次查排课信息时，用了什么具体办法？/)
 const own=await turn('把我负责的文字和排版写成一句实习作品描述，不添加插画能力。')
 assert.match(own.r.text,/我负责文字和排版。/);assert.ok(!own.r.text.includes('视觉呈现'))
 assert.ok((await growthContext(user,own.conversation)).some(x=>x.text==='我负责文字和排版'))
})
test.after(async()=>{await localEmbedding.close();await pool.end()})
