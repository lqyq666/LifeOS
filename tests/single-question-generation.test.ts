import test from 'node:test'
import assert from 'node:assert/strict'
import {deriveTurnContract,bindMaterialDeliverySchema,requestsSingleQuestionMaterial} from '../server/turn-contract.ts'
import {requestsOneQuestionReply} from '../server/reply-draft.ts'
import {buildTurnPrompt,turnSystemPrompt,SINGLE_QUESTION_GENERATION_RULES,understandingOpeningGenerationRules} from '../server/turn-prompt.ts'
import {productModeOpeningPrompt,productModePrompt} from '../src/features/conversation/product-modes.ts'

test('conversational opening contract cannot override user additions or full understanding requests',()=>{
 assert.match(understandingOpeningGenerationRules(productModeOpeningPrompt('understand'))!,/保留理解、具体依据和必要的未知/)
 for(const text of [productModeOpeningPrompt('understand')+'\n不要追问，直接给我分析。',productModePrompt('understand'),productModeOpeningPrompt('directions'),'只想倾听。'])assert.equal(understandingOpeningGenerationRules(text),null)
})

test('single question material binds the one-body rule before generation, with no output clipping',()=>{
 const text='请为了解AI产品实习起草一个70—100词的英文问题，覆盖工作、合作及条件，不代发。'
 const base=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:true}),c=bindMaterialDeliverySchema(base,text,false,true),s=c.schema as any
 assert.equal(requestsSingleQuestionMaterial(text),true)
 assert.match(s.properties.reply.description,/单个完整问句/)
 assert.match(s.properties.reply.description,/70—100词.*约85词/)
 assert.equal(s.properties.reply.maxLength,12000)
 assert.ok(s.properties.reply.pattern.includes('{69,99}'))
 assert.ok(new RegExp(s.properties.reply.pattern).test(Array(70).fill('detail').join(' ')+'?'))
 assert.ok(!new RegExp(s.properties.reply.pattern).test('Could you explain this? Another question?'))
 assert.equal(s.properties.reply.allOf,undefined)
 assert.ok(!new RegExp(s.properties.reply.pattern).test(Array(70).fill('detail').join(' ')+'. Extra?'))
 assert.equal(s.properties.lead,undefined)
 assert.ok(s.properties.event.properties.action.anyOf.every((x:any)=>x.properties.draft.properties.fromReply.const===true))
 assert.match(SINGLE_QUESTION_GENERATION_RULES,/原文引用/)
 assert.match(SINGLE_QUESTION_GENERATION_RULES,/不是要向对方询问的内容/)
 assert.ok(s.properties.reply.description.includes('one governing interrogative clause'))
 assert.match(SINGLE_QUESTION_GENERATION_RULES,/不是“一个问句加若干陈述句”/)
 assert.match(s.properties.reply.description,/主问的问号后立即结束正文字符串/)
 assert.match(SINGLE_QUESTION_GENERATION_RULES,/不输出.*Notes/)
})

test('multi-question, quoted, negative and third-party requests do not acquire the single-question route',()=>{
 for(const text of ['帮我写三个实习问题。','不要帮我写一个实习问题。','同学说帮我写一个实习问题。','“帮我写一个实习问题”是什么意思？'])assert.equal(requestsSingleQuestionMaterial(text),false,text)
 const text='帮我写三个实习问题。',c=bindMaterialDeliverySchema(deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:true}),text,false,true)
 assert.ok(!(c.schema as any).properties.reply.description.includes('单个完整问句'))
})

test('capability probe stays on its established prompt and does not receive runtime-only question rules',()=>{
 assert.ok(!turnSystemPrompt('default','qwen3.8-flash').includes('本轮单问题生成契约'))
})

 test('only ask me one question is recognized without treating negated or quoted instructions as requests',()=>{
  for(const text of ['请只问我一个完整问题。','仅问我一个问题。','请问我一个问题。'])assert.equal(requestsOneQuestionReply(text),true,text)
  for(const text of ['不要只问我一个问题。','“请只问我一个问题”是什么意思？','同学说请只问我一个问题。'])assert.equal(requestsOneQuestionReply(text),false,text)
 })

 test('quoted, negated or attributed word ranges cannot override generation length',()=>{
  for(const tail of ['引用“70—100词”只是例子。','不要70—100词。','同学说70—100词。','我上次写了70—100词。']){
   const text='帮我写一个英文实习问题。'+tail,c=bindMaterialDeliverySchema(deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:true}),text,false,true)
   assert.ok(!(c.schema as any).properties.reply.description.includes('本轮要求70—100词'),tail)
  }
 })

 test('fresh material context omits only historical AI draft bodies and leaves source facts and storage unchanged',()=>{
  const event:any={id:'history',conversationId:'past',title:'实习问题',revision:1,generation:1,nodes:[{id:'fact',kind:'fact',content:'本人报告的实际行动',source:{messageId:'m',quote:'本人报告的实际行动'}}],actions:[{id:'a',revision:1,status:'proposed',draft:{content:'OLD_AI_DRAFT_BODY'},requestSources:[{messageId:'m',quote:'请写一个问题'}]}],asked:[]}
  const messages:any=[{id:'now',role:'user',content:'帮我写一个英文实习问题。'}],before=structuredClone(event)
  const fresh=JSON.parse(buildTurnPrompt({currentMessageId:'now',messages,events:[event],omitHistoricalMaterialBodies:true}))
  assert.equal(fresh.events[0].actions[0].draft,null)
  assert.equal(fresh.events[0].actions[0].id,'a')
  assert.equal(fresh.events[0].nodes[0].source.quote,'本人报告的实际行动')
  assert.ok(fresh.historicalMaterialRule.includes('旧AI正文未选入'))
  assert.deepEqual(event,before)
  const normal=JSON.parse(buildTurnPrompt({currentMessageId:'now',messages,events:[event]}))
  assert.equal(normal.events[0].actions[0].draft.content,'OLD_AI_DRAFT_BODY')
 })

 test('native quote constraint permits only the literal quoted question plus the outer main question',()=>{
  const text='请为实习起草一个60—90词的英文问题。请在问题中将“What evidence do you need?”作为引用例子保留下来。',s:any=bindMaterialDeliverySchema(deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:true}),text,false,true).schema
  const pattern=new RegExp(s.properties.reply.pattern)
  assert.ok(pattern.test(Array(30).fill('detail').join(' ')+' “What evidence do you need?” '+Array(30).fill('detail').join(' ')+'?'))
  assert.ok(!pattern.test('Could you explain the criteria? What evidence do you need?'))
  assert.ok(!pattern.test('Could you explain what evidence do you need?'))
  assert.ok(!pattern.test(Array(30).fill('detail').join(' ')+' “What evidence do you need?” '+Array(30).fill('疑问about').join(' ')+'?'))
  assert.ok(s.properties.reply.description.includes('不夹杂中文'))
 })
