import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Value} from 'typebox/value'
import { turnSystemPrompt } from '../../server/turn-prompt.ts'
import { actionCoachTurnSchema } from '../../server/action-coach-contracts.ts'
import { configureProviderPayload, outputTokenLimit } from '../../server/model-payload.ts'

test('saved invented continue target is excluded before generation while real targets and new events remain valid',()=>{
  const current='00000000-0000-4000-8000-000000000011',profile={provider:'bailian',id:'qwen3.8-flash'},original=JSON.stringify(actionCoachTurnSchema)
  const failure=JSON.parse(readFileSync('tests/fixtures/coach-invented-event.json','utf8'))
  const make=(targets?:{id:string;revision:number}[])=>((configureProviderPayload({},profile,'default',undefined,undefined,8192,current,targets) as any).response_format.json_schema.schema)
  assert.equal(Value.Check(make(),failure),true,'the previous unconstrained schema reproduced the saved failure')
  assert.equal(Value.Check(make([]),failure),false,'no existing event means no continue target')
  assert.equal(Value.Check(make([]),{reply:'只解释知识。'}),true)
  assert.equal(Value.Check(make([]),{reply:'新事情',event:{target:{operation:'create',title:'新事情',source:{messageId:current,quote:'新事情'}}}}),true)
  const first={id:'00000000-0000-4000-8000-000000000022',revision:2},second={id:'00000000-0000-4000-8000-000000000033',revision:3},bound=make([first,first,second])
  const output=(id:string,revision:number)=>({reply:'继续',event:{target:{operation:'continue',eventId:id,expectedRevision:revision}}})
  assert.equal(Value.Check(bound,output(first.id,2)),true);assert.equal(Value.Check(bound,output(second.id,3)),true)
  assert.equal(Value.Check(bound,output(first.id,3)),false,'id/revision pairs cannot be mixed')
  assert.equal(Value.Check(bound,output(current,1)),false,'a message ID is never an existing event ID')
  assert.equal(Value.Check(make([second]),output(first.id,2)),false,'another request cannot inherit authorization')
  assert.equal(JSON.stringify(actionCoachTurnSchema),original)
  assert.throws(()=>make([first,{...first,revision:3}]),/EVENT_TARGET_REVISION_AMBIGUOUS/)
})

test('each request binds every new process source to its own current message without changing quote or record references',()=>{
  const original=JSON.stringify(actionCoachTurnSchema),first='79c2145f-a7c1-485c-acee-827dfc5f8f39',second='00000000-0000-4000-8000-000000000012'
  for(const current of [first,second]){
    const payload=configureProviderPayload({}, {provider:'bailian',id:'qwen3.8-flash'},'default',undefined,undefined,8192,current) as any
    let bound=0
    function check(value:any){
      if(!value||typeof value!=='object')return
      if(value.properties?.messageId){bound++;assert.deepEqual(value.properties.messageId.enum,[current]);assert.equal(value.properties.messageId.enum.includes('79c2145f-a7c2-485c-acee-827dfc5f8f39'),false);assert.ok(value.properties.quote)}
      for(const item of Object.values(value))check(item)
    }
    check(payload.response_format.json_schema.schema);assert.ok(bound>=5)
    assert.equal(payload.response_format.json_schema.schema.properties.citations.items.properties.sourceId.enum,undefined)
  }
  assert.equal(JSON.stringify(actionCoachTurnSchema),original,'global schema never acquires another request identity')
  assert.throws(()=>configureProviderPayload({}, {provider:'bailian',id:'qwen3.8-flash'},'default',undefined,undefined,8192,'not-a-source-id'),/CURRENT_MESSAGE_ID_INVALID/)
})

test('Qwen receives the natural reply contract without required planning or analysis objects',()=>{
  const payload=configureProviderPayload({model:'qwen3.8-flash',messages:[],stream:true,max_tokens:4096},{provider:'bailian',id:'qwen3.8-flash'},'default',undefined,undefined,8192) as any
  assert.equal(payload.enable_thinking,false)
  assert.equal(payload.temperature,0)
  assert.equal(payload.presence_penalty,0)
  assert.equal(payload.max_tokens,undefined);assert.equal(payload.max_completion_tokens,8192)
  assert.equal(payload.response_format.type,'json_schema');assert.equal(payload.response_format.json_schema.name,'lifeos_action_coach')
  const schema=payload.response_format.json_schema.schema
  assert.equal(payload.response_format.json_schema.strict,true)
  assert.deepEqual(schema.required,['reply']);assert.equal(schema.additionalProperties,false)
  for(const old of ['analysis','decision','escalation','campus'])assert.equal(schema.properties[old],undefined)
  assert.equal(schema.properties.event.properties.action.anyOf[0].properties.draft.properties.content.maxLength,12000)
  assert.equal(schema.properties.reply.maxLength,16000)
  assert.equal(schema.properties.citations.items.properties.sourceId.type,'string')
  assert.equal(JSON.stringify(payload).includes('~optional'),false)
})

test('repair uses the same contract and retains capacity for complete materials',()=>{
  const payload=configureProviderPayload({messages:[]},{provider:'bailian',id:'qwen3.8-flash'},'default',actionCoachTurnSchema,'lifeos_action_coach_repair',8192) as any
  assert.equal(payload.response_format.json_schema.name,'lifeos_action_coach_repair')
  assert.equal(payload.max_completion_tokens,8192)
  assert.deepEqual(payload.response_format.json_schema.schema.required,['reply'])
})

test('DeepSeek JSON mode enables bounded reasoning only for the reasoning tier',()=>{
  const profile={provider:'bailian',id:'deepseek-v4.1-flash'}
  const ordinary=configureProviderPayload({max_tokens:4096},profile,'default',undefined,undefined,8192) as any
  assert.equal(ordinary.enable_thinking,false);assert.equal(ordinary.reasoning_effort,undefined)
  const reasoning=configureProviderPayload({max_tokens:4096},profile,'reasoning',undefined,undefined,16384) as any
  assert.equal(reasoning.enable_thinking,true);assert.equal(reasoning.reasoning_effort,'low')
  assert.deepEqual(reasoning.response_format,{type:'json_object'})
  assert.equal(reasoning.max_tokens,undefined);assert.equal(reasoning.max_completion_tokens,16384)
  assert.equal(outputTokenLimit(profile,'reasoning'),16384)
  assert.equal(outputTokenLimit(profile,'default'),8192)
})

test('non-Bailian provider payloads retain their native transport options',()=>{
  const input={model:'glm-4-flash',messages:[],stream:true,max_tokens:4096}
  assert.strictEqual(configureProviderPayload(input,{provider:'zhipu',id:'glm-4-flash'},'default'),input)
})

test('JSON-object reasoning prompt includes the full current event and citation schema',()=>{
  const prompt=turnSystemPrompt('reasoning')
  const schema=JSON.parse(prompt.split('Schema：').at(-1)!)
  assert.deepEqual(schema,actionCoachTurnSchema)
  assert.deepEqual(schema.required,['reply'])
  assert.ok(schema.properties.event);assert.ok(schema.properties.citations)
  assert.equal(Object.hasOwn(schema.properties,'campus'),false)
})

test('the existing DeepSeek default candidate carries the same full schema without thinking or extra calls',()=>{
  const prompt=turnSystemPrompt('default','deepseek-v4.1-flash')
  assert.deepEqual(JSON.parse(prompt.split('Schema：').at(-1)!),actionCoachTurnSchema)
  assert.equal(turnSystemPrompt('default','qwen3.8-flash').includes('Schema：'),false)
  const payload=configureProviderPayload({max_tokens:4096},{provider:'bailian',id:'deepseek-v4.1-flash'},'default',undefined,undefined,8192) as any
  assert.equal(payload.enable_thinking,false)
  assert.equal(payload.reasoning_effort,undefined)
  assert.deepEqual(payload.response_format,{type:'json_object'})
  assert.equal(payload.max_completion_tokens,8192)
})
