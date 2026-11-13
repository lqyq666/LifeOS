import test from 'node:test'
import assert from 'node:assert/strict'
import {providerTurnMessages} from '../server/turn-prompt.ts'

test('native context keeps authorized facts and user boundaries without a second lexical interpretation',()=>{
 const quote='我只整理了问卷的三列数据，没有进行分析',context={currentUserMessage:{id:'current',role:'user',text:'继续上次的事情。',clauses:[{id:'c0',text:'继续上次的事情'}]},requestTimeUtc:'2026-10-29T12:00:00.000Z',messages:[],growth:[{id:'fact',revision:4,assertion:'user_reported',status:'active',text:quote}],growthBoundaries:[{id:'paused',text:'这周先暂停考研资料核对'}],currentTask:{responseScope:{actionLimit:1,judgmentUpdate:true,reportedEvidence:{participants:[],preferences:[],externalExpectations:[],sourceBounds:[{kind:'reported_fact',quote,source:{type:'growth',id:'fact',revision:4}}]}}}}
 const profile={provider:'bailian',id:'qwen3.8-flash'},source=JSON.stringify(context)
 const legacy=providerTurnMessages(source,profile),native=providerTurnMessages(source,profile,undefined,true)
 const metadata=JSON.parse(String(native[0]!.content))
 assert.equal(metadata.growth[0].text,quote)
 assert.equal(metadata.growth[0].revision,4)
 assert.deepEqual(metadata.growthBoundaries,context.growthBoundaries)
 assert.equal(metadata.currentTask.responseScope.actionLimit,1)
 assert.equal(metadata.currentTask.responseScope.judgmentUpdate,true)
 assert.ok(!Object.hasOwn(metadata.currentTask.responseScope,'reportedEvidence'))
 assert.equal(native.at(-1)!.content,context.currentUserMessage.text)
 assert.ok(JSON.stringify(native).length<JSON.stringify(legacy).length)
})
