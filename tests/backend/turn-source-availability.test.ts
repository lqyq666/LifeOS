import test from 'node:test'
import assert from 'node:assert/strict'
import {buildTurnPrompt,providerTurnMessages} from '../../server/turn-prompt.ts'
import {knowledgeIntent} from '../../server/evergreen-guide.ts'
import type {DialogueMessage} from '../../server/dialogue.ts'
import type {GrowthItem} from '../../src/features/growth/types.ts'

const message={id:'00000000-0000-4000-8000-000000000001',role:'user',content:'前天联系了学长，他没回，我下一步怎么办？',created_at:'2026-10-10T00:00:00Z'} as DialogueMessage
const fact=(text:string,id='old-hours'):GrowthItem=>({id,conversationId:'other-chat',kind:'context',text,assertion:'user_reported',status:'active',sources:[{type:'message',id:'old-message',quote:text}],dependencies:[],validUntil:null,timeBasis:null,revision:1,createdAt:'2026-10-10T00:00:00Z',updatedAt:'2026-10-10T00:00:00Z',unavailableReason:null})
test('an unrelated unscoped temporary budget is deferred, not presented as current availability',()=>{
 const hours=fact('我还有两小时准备明天的课堂汇报'),practice=fact('我做过三次课堂汇报','practice'),weekly=fact('我每周可以拿出六小时','weekly')
 const context=JSON.parse(buildTurnPrompt({currentMessageId:message.id,messages:[message],growthBackground:[hours,practice,weekly]}))
 assert.deepEqual(context.growthBackground.map((item:GrowthItem)=>item.id),['practice','weekly'])
 assert.deepEqual(context.deferredGrowthRefs,[{id:hours.id,revision:1,reason:'UNSCOPED_TEMPORARY_TIME_FOR_OTHER_MATTER'}])
 assert.ok(!JSON.stringify(context).includes(hours.text),'the model cannot substitute the old amount from a background quote')
 assert.equal(hours.text,'我还有两小时准备明天的课堂汇报','prompt selection does not rewrite storage')
 const continued=JSON.parse(buildTurnPrompt({currentMessageId:message.id,messages:[message],growth:[hours]}))
 assert.equal(continued.growth[0].text,hours.text,'on-topic continuation retains the original fact')
 const event={id:'continued',nodes:[{source:{messageId:'old-message',quote:hours.text}}],actions:[]} as never
 const short=JSON.parse(buildTurnPrompt({currentMessageId:message.id,messages:[{...message,content:'还是不行'}],growthBackground:[hours],currentEvent:event}))
 assert.equal(short.growthBackground[0].text,hours.text,'same authorized event source permits a short continuation')
})
test('temporary-time scoping retains recurring budgets, valid windows and non-context personal evidence',()=>{
 const cases=[fact('我每周有六小时'),{...fact('我今天只有两小时'),validUntil:'2026-10-11T16:00:00Z',timeBasis:{kind:'duration'}},{...fact('我今天用两小时完成汇报'),kind:'feedback' as const},fact('我经常花两小时整理笔记'),fact('我今天很累')]
 const context=JSON.parse(buildTurnPrompt({currentMessageId:message.id,messages:[message],growthBackground:cases}))
 assert.equal(context.growthBackground.length,cases.length)
 assert.deepEqual(context.deferredGrowthRefs,[])
})
test('a requested method without authorized fragments stays unavailable at the provider boundary',()=>{
 const context=JSON.parse(buildTurnPrompt({currentMessageId:message.id,messages:[message],knowledgeIntent:knowledgeIntent(message.content),methodContext:[]}))
 assert.equal(context.methodSourceAvailability.status,'NO_MATCHING_PUBLIC_METHOD')
 assert.equal(context.methodSourceAvailability.suppliedMethodCount,0)
 assert.deepEqual(context.knowledge,[])
 const provider=providerTurnMessages(JSON.stringify(context),{provider:'bailian',id:'qwen3.8-flash'})
 assert.deepEqual(JSON.parse(provider[0].content as string).methodSourceAvailability,context.methodSourceAvailability)
 assert.equal(provider.at(-1)!.content,message.content)
})
test('refusal, clarification and a supplied selected method remain different context states',()=>{
 const make=(text:string,methods:Record<string,unknown>[]=[])=>JSON.parse(buildTurnPrompt({currentMessageId:message.id,messages:[{...message,content:text}],knowledgeIntent:knowledgeIntent(text),methodContext:methods}))
 assert.equal(make('只想倾听，不要方法。').methodSourceAvailability.status,'NOT_REQUESTED')
 assert.equal(make('这怎么办？').methodSourceAvailability.status,'REQUEST_NEEDS_CLARIFICATION')
 const context=make(message.content,[{id:'authorized-version',revision:3,branch:'waiting_result'}])
 assert.equal(context.methodSourceAvailability.status,'MATCHED_PUBLIC_METHODS')
 assert.equal(context.methodSourceAvailability.suppliedMethodCount,1)
 assert.equal(context.methodContext[0].branch,'waiting_result')
 assert.equal(JSON.parse(buildTurnPrompt({currentMessageId:message.id,messages:[message]})).methodSourceAvailability.status,'UNASSESSED')
})
