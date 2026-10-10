import test from 'node:test'
import assert from 'node:assert/strict'
import {buildTurnPrompt,providerTurnMessages} from '../../server/turn-prompt.ts'
import {knowledgeIntent} from '../../server/evergreen-guide.ts'
import type {DialogueMessage} from '../../server/dialogue.ts'

const message={id:'00000000-0000-4000-8000-000000000001',role:'user',content:'前天联系了学长，他没回，我下一步怎么办？',created_at:'2026-10-10T00:00:00Z'} as DialogueMessage
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
