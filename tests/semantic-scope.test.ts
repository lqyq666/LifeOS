import test from 'node:test'
import assert from 'node:assert/strict'
import {buildTurnPrompt,providerTurnMessages} from '../server/turn-prompt.ts'
import {reportedEvidenceFromText,unsupportedPreferenceConstraintClaims} from '../server/turn-contract.ts'
const old='我现在只想被听见，不想分析方向'
test('historical listening is not current personal evidence; sources and independent facts remain',()=>{
 const input:any={currentMessageId:'new',messages:[{id:'new',role:'user',content:'请比较科研和实习。'}],profile:[{id:'p',scope:'user',status:'active',value:old,source:{type:'message',messageId:'past',quote:old}}],growthBackground:[{id:'g',revision:1,text:old,kind:'goal',status:'active',assertion:'user_reported',sources:[{type:'message',id:'past',quote:old}]},{id:'real',revision:1,text:'我是电气专业学生',kind:'context',status:'active',assertion:'user_reported',sources:[{type:'message',id:'fact',quote:'我是电气专业学生'}]}]}
 const original=structuredClone(input),ctx=JSON.parse(buildTurnPrompt(input))
 assert.deepEqual(ctx.knownProfile,[])
 assert.ok(!ctx.growthBackground.some((x:any)=>x.id==='g'))
 assert.ok(ctx.growthBackground.some((x:any)=>x.id==='real'))
 assert.ok(ctx.historicalInteractionRequests.some((x:any)=>x.sourceMessageId==='past'&&x.isCurrent===false))
 const wire=providerTurnMessages(JSON.stringify(ctx),{provider:'bailian',id:'qwen3.8-flash'})
 assert.match(JSON.stringify(wire),/历史.*(?:当时|来源)/)
 assert.deepEqual(input,original)
})
test('not a priority cannot become exclusion; same-subject explicit refusal and historical explanations remain valid',()=>{
 const text='我不在意当老板，也不想承担找客户和收款。',e=reportedEvidenceFromText(text).preferences
 for(const reply of ['你排除了当老板、找客户和收款。','你拒绝**当老板**。','你不考虑“当老板”。'])assert.ok(unsupportedPreferenceConstraintClaims(reply,e,undefined,text).length,reply)
 for(const reply of ['你不在意当老板，不等于排除当老板。','你是否排除当老板仍未知。','你不在意当老板；你不想承担找客户和收款。','我不认为你拒绝当老板。','你尚未排除当老板。','这未必表示你排除当老板。'])assert.deepEqual(unsupportedPreferenceConstraintClaims(reply,e,undefined,text),[],reply)
 const stronger='我不在意当老板。更正：我明确不想当老板。'
 assert.deepEqual(unsupportedPreferenceConstraintClaims('你明确不想当老板。',reportedEvidenceFromText(stronger).preferences,undefined,stronger),[])
})

test('scope projection keeps durable controls and explicit user edits; OFF has no cross-session facts',()=>{
 const message:any={id:'now',role:'user',content:'请只分析方向，不改档案。'}
 const control={id:'control',revision:1,text:'先暂停创业',kind:'context',status:'active',assertion:'user_reported',sources:[{type:'message',id:'previous',quote:'先暂停创业'}]}
 const edit={...control,id:'manual',text:old,assertion:'user_edit'}
 const ctx=JSON.parse(buildTurnPrompt({currentMessageId:'now',messages:[message],growthBackground:[control,edit] as any,blockedDirectionScopes:['entrepreneurship']}))
 assert.equal(ctx.growthBackground.length,2);assert.deepEqual(ctx.blockedDirectionScopes,['entrepreneurship'])
 const off=JSON.parse(buildTurnPrompt({currentMessageId:'now',messages:[message]}))
 assert.deepEqual(off.knownProfile,[]);assert.deepEqual(off.growthBackground,[]);assert.deepEqual(off.historicalInteractionRequests,[])
})

test('legacy authorized memory also carries the original preference modality without growth records',()=>{
 const ctx=JSON.parse(buildTurnPrompt({currentMessageId:'n',messages:[{id:'n',role:'user',content:'请回读我保存的偏好。'}] as any,profile:[{id:'memory',scope:'user',status:'active',value:'不在意当老板',source:{type:'message',messageId:'old',quote:'我不在意当老板'}}] as any}))
 assert.ok(ctx.currentTask.responseScope.reportedEvidence.preferences.some((p:any)=>p.modality==='not_priority'&&p.source.id==='memory'))
})

test('declined and unknown memories cannot be reintroduced through historical request metadata',()=>{
 for(const status of ['declined','unknown','stale']){
  const ctx=JSON.parse(buildTurnPrompt({currentMessageId:'n',messages:[{id:'n',role:'user',content:'请分析这次选择。'}] as any,profile:[{id:'hidden',scope:'user',status,value:old,source:{type:'message',messageId:'past',quote:old}}] as any}))
  assert.deepEqual(ctx.knownProfile,[]);assert.deepEqual(ctx.historicalInteractionRequests,[]);assert.ok(!JSON.stringify(ctx).includes(old))
 }
})
