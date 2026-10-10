import test from 'node:test'
import assert from 'node:assert/strict'
import {boundedOrdinaryReply,bindBoundedReplySchema,boundedReplyAccepts,boundedDraftAccepts} from '../server/bounded-reply.ts'
import {knowledgeIntent} from '../server/evergreen-guide.ts'
import {deriveTurnContract} from '../server/turn-contract.ts'
const make=(text:string,extra:Partial<Parameters<typeof boundedOrdinaryReply>[0]>={})=>boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default',...extra})
test('source-free ordinary choices separate preparation, actual blockage and unknown response',()=>{
 const start=make('我还有两小时准备明天的课堂汇报，先做哪一步？')!
 const waiting=make('我发给学长的问题还没有回复，今天还要催吗？')!
 const blocked=make('昨天作业没做完，今晚怎么调整？')!
 assert.equal(start.stage,'start');assert.equal(waiting.stage,'waiting_result');assert.equal(blocked.stage,'blocked')
 assert.equal(make('我今天没按原计划做完作业，想调整一个小步骤。')!.stage,'blocked')
 assert.equal(start.basis,'editorial_adaptation');assert.equal(start.sourceStatus,'NO_PUBLIC_METHOD')
 assert.ok(waiting.choices.every(s=>!s.includes('明天再')&&!s.includes('更容易得到回应')))
 assert.ok(blocked.choices.every(s=>!s.includes('自责')&&!s.includes('很正常')))
 assert.ok(start.choices.every(s=>!s.includes('分钟')),'no invented budget allocation')
 assert.ok(blocked.choices.some(s=>s.includes('不重新安排整套')))
})
test('the runtime schema binds reply exactly and rejects free prose even if native validation was bypassed',()=>{
 const text='前天联系了学长，他没回，我下一步怎么办？',bounded=make(text)!
 const original=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),bound=bindBoundedReplySchema(original,bounded)
 assert.deepEqual((bound.schema as any).properties.reply.enum,bounded.choices)
 assert.equal((original.schema as any).properties.reply.enum,undefined,'original contract is not mutated')
 assert.equal(boundedReplyAccepts('语气轻一点反而更容易得到回应。',bounded),false)
 assert.equal(boundedReplyAccepts(bounded.choices[0]!,bounded),true)
 assert.equal(boundedReplyAccepts(bounded.choices[0]!+' 明天再发。',bounded),false)
 assert.equal(boundedDraftAccepts('你还有两小时要准备汇报吗？',bounded),false)
 assert.equal(boundedDraftAccepts('你们原先是怎么约定的？',bounded),true)
})
test('listening, refusal, controls, delivery, planning, comparison and sourced methods retain their original contracts',()=>{
 for(const text of ['我只想聊聊，不要给我建议。','更正，那个不是我做的。','你好','你记得我之前说过什么吗？','请比较就业和创业，哪个更适合？'])assert.equal(make(text),null,text)
 const text='怎么开始？',contract=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:true,material:false})
 assert.equal(make(text,{contract}),null)
 assert.equal(make(text,{contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:true})}),null)
 assert.equal(make(text,{knowledgeCount:1}),null)
 assert.equal(make(text,{tier:'reasoning'}),null)
})
