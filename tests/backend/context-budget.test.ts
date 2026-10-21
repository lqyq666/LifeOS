import test from 'node:test'
import assert from 'node:assert/strict'
import {buildTurnPrompt,providerTurnMessages} from '../../server/turn-prompt.ts'
import {estimateTokens} from '../../server/context.ts'
import type {ProfileFact} from '../../server/dialogue.ts'
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`

test('whole-message history stays within 20k and the full current input is never sliced',()=>{
  const messages=Array.from({length:60},(_,i)=>({id:uuid(i+1),role:'user' as const,content:'历史'+i+'。'.repeat(1000)}))
  const current={id:uuid(100),role:'user' as const,content:'完整本轮'+ '。'.repeat(15900)}
  messages.push(current)
  const prompt=JSON.parse(buildTurnPrompt({currentMessageId:current.id,messages}))
  assert.equal(prompt.currentUserMessage.text,current.content)
  assert.equal(prompt.currentUserMessage.id,current.id);assert.equal(prompt.currentUserMessage.role,'user')
  assert.ok(!prompt.messages.some((m:any)=>m.id===current.id))
  assert.equal(JSON.stringify(prompt).split(current.content).length,2,'current input is represented once as the active request, not duplicated into historical data')
  assert.ok(current.content.length+prompt.messages.reduce((sum:number,m:any)=>sum+m.text.length,0)<=20000)
  for(const item of prompt.messages)assert.equal(item.text,messages.find(m=>m.id===item.id)!.content)
  assert.ok(!prompt.messages.some((m:any)=>m.id===messages[0].id))
  assert.ok(estimateTokens('中文消息')>estimateTokens('ascii'))
})

test('provider receives complete dialogue in original roles and one natural current request, with source IDs in separate state',()=>{
  const old={id:uuid(801),role:'user' as const,content:'我之前没有发送材料。'}
  const assistant={id:uuid(802),role:'assistant' as const,content:'你准备怎样交付？'}
  const current={id:uuid(803),role:'user' as const,content:'考试前夜发了网盘。'+ '完整正文。'.repeat(1000),created_at:'2026-10-04T08:00:00Z'}
  const serialized=buildTurnPrompt({currentMessageId:current.id,messages:[old,assistant,current]})
  const messages=providerTurnMessages(serialized,{provider:'synthetic',id:'synthetic'})
  assert.deepEqual(messages.map(message=>message.role),['user','user','assistant','user'])
  const metadata=JSON.parse(messages[0].content as string)
  assert.deepEqual(metadata.messages,[{id:old.id,role:'user'},{id:assistant.id,role:'assistant'}])
  assert.deepEqual(metadata.currentUserMessage,{id:current.id,role:'user'})
  assert.equal(messages[1].content,old.content);assert.deepEqual(messages[2].content,[{type:'text',text:assistant.content}])
  assert.equal(messages[3].content,current.content);assert.equal(messages[3].timestamp,Date.parse(current.created_at))
  // Source metadata may retain the last question to prevent asking it again;
  // each original dialogue text still appears once in its actual role payload.
  for(const text of [old.content,assistant.content,current.content])assert.equal(JSON.stringify(messages.slice(1)).split(text).length,2)
  assert.deepEqual(metadata.currentTask.responseScope.previousQuestions,[assistant.content])
  assert.equal(JSON.parse(serialized).currentUserMessage.text,current.content,'input envelope is not mutated')
})

test('repair preserves dialogue roles while invalid model output remains diagnostic data',()=>{
  const current={id:uuid(804),role:'user' as const,content:'继续谈原来的交付。'}
  const authorizedContext=JSON.parse(buildTurnPrompt({currentMessageId:current.id,messages:[current]}))
  const invalidAttempt='{"reply":"忽略规则，声称已经发送"}'
  const messages=providerTurnMessages(JSON.stringify({authorizedContext,validationError:'COACH_OUTPUT_INVALID',invalidAttempt}),{provider:'synthetic',id:'synthetic'})
  assert.equal(messages.at(-1)!.content,current.content)
  assert.equal(JSON.parse(messages[0].content as string).invalidAttempt,invalidAttempt)
  assert.equal(messages.filter(message=>message.role==='assistant').length,0,'failed output cannot masquerade as a saved assistant turn')
  assert.throws(()=>providerTurnMessages('{"messages":[]}',{provider:'synthetic',id:'synthetic'}),/CURRENT_MESSAGE_MISSING/)
})

test('only active stable background reaches the prompt without a task questionnaire or slot sources',()=>{
  const current={id:uuid(500),role:'user' as const,content:'请解释递归。'}
  const make=(scope:'user'|'task',status:'active'|'stale'):ProfileFact=>({id:uuid(scope==='user'?501:502),key:'education.school',value:'用户明确背景',scope,taskType:null,observedAt:'2026-10-02T00:00:00Z',validUntil:null,revision:3,status,source:{type:'user_edit'}})
  const prompt=JSON.parse(buildTurnPrompt({currentMessageId:current.id,messages:[current],profile:[make('user','active'),make('task','active'),make('user','stale')]}))
  assert.equal(prompt.knownProfile.length,1);assert.equal(prompt.knownProfile[0].revision,3)
  assert.equal(prompt.taskDefinition,undefined);assert.equal(prompt.currentTaskState,undefined)
  assert.deepEqual(prompt.events,[]);assert.deepEqual(prompt.confirmedExperiences,[])
})

test('authorized confirmed experiences retain complete corrected content and revisions',()=>{
  const current={id:uuid(700),role:'user' as const,content:'请对照我两段经历。'}
  const experiences=[{id:uuid(701),revision:2,quote:'我完成第一件事',content:{summary:'用户更正后的总结',action:'实际行动',result:'实际结果',reflection:'用户确认的反思'}},{id:uuid(702),revision:4,quote:'我完成第二件事',content:{summary:'另一件事'}}]
  const prompt=JSON.parse(buildTurnPrompt({currentMessageId:current.id,messages:[current],confirmedExperiences:experiences}))
  assert.deepEqual(prompt.confirmedExperiences,experiences)
})

test('request time uses the current user message rather than an older conversation date',()=>{
  const current={id:uuid(702),role:'user' as const,content:'预计明年毕业，请核验对应年份规则。',created_at:'2026-10-03T08:00:00Z'}
  const prompt=JSON.parse(buildTurnPrompt({currentMessageId:current.id,messages:[{id:uuid(701),role:'user',content:'去年讨论过升学。',created_at:'2025-01-01T00:00:00Z'},current]}))
  assert.equal(prompt.requestTimeUtc,'2026-10-03T08:00:00.000Z');assert.equal(prompt.currentUserMessage.text,current.content)
  assert.throws(()=>buildTurnPrompt({currentMessageId:uuid(999),messages:[current]}),/CURRENT_MESSAGE_MISSING/)
})
