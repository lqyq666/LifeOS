import test from 'node:test'
import assert from 'node:assert/strict'
import {Value} from 'typebox/value'
import {configureProviderPayload} from '../../server/model-payload.ts'
import {bindDecisionProposalSchema,compileDecisionConditions,projectDecisionCases,projectDecisionProposalWire,validateDecisionProposal,type DecisionProposal} from '../../server/decision-comparison.ts'

const unsupported=new Set(['uniqueItems','contains','minContains','maxContains','additionalItems'])
function unsupportedPaths(value:unknown,path='schema'):string[]{
 if(!value||typeof value!=='object')return []
 return Object.entries(value).flatMap(([key,item])=>[...(unsupported.has(key)?[path+'.'+key]:[]),...unsupportedPaths(item,path+'.'+key)])
}
const profile={provider:'bailian',id:'qwen3.8-flash'}

test('native decision schema uses supported array keywords without mutating local coverage rules',()=>{
 const conditions=compileDecisionConditions('','我只有2分钟。')
 const cases=projectDecisionCases([
  {id:'11111111-1111-4111-8111-111111111111',title:'报告',nodes:[],matterProgress:{state:'unattempted'}},
  {id:'22222222-2222-4222-8222-222222222222',title:'竞赛',nodes:[],matterProgress:{state:'paused'}},
 ] as any,conditions)
 const schema=bindDecisionProposalSchema({type:'object',properties:{reply:{type:'string',minLength:1,maxLength:16000}},required:['reply'],additionalProperties:false},cases,conditions)
 const original=structuredClone(schema)
 const payload=configureProviderPayload({stream:true},profile,'default',schema,'decision',8192) as any
 const compiled=payload.response_format.json_schema.schema
 assert.deepEqual(unsupportedPaths(compiled),[])
 assert.deepEqual(schema,original,'provider compilation must not weaken authoritative schema')
 assert.equal(schema.properties.decisionProposal.properties.items.allOf.length,2)
 assert.equal(payload.max_completion_tokens,8192)
 assert.equal(payload.stream,true)
 assert.equal(compiled.properties.reply.maxLength,16000)
 assert.equal(compiled.properties.reply.pattern,undefined)
 assert.equal(compiled.properties.decisionProposal.properties.items.minItems,2)
 assert.equal(compiled.properties.decisionProposal.properties.items.maxItems,2)
 const reply='先推进报告，最多投入两分钟；竞赛继续暂停。'
 const item={caseIndex:0,kind:'advance',minutesCeiling:1}
 const valid={reply,decisionProposal:{items:[item,{caseIndex:1,kind:'none',minutesCeiling:0}]}}
 const duplicate={reply,decisionProposal:{items:[item,item]}}
 assert.equal(Value.Check(schema,valid),true)
 assert.equal(Value.Check(schema,duplicate),false,'local schema still rejects missing/duplicate matters')
 const project=(value:unknown)=>projectDecisionProposalWire(value,cases,conditions) as DecisionProposal
 assert.doesNotThrow(()=>validateDecisionProposal(project(valid.decisionProposal),cases,conditions,null,reply))
 assert.throws(()=>validateDecisionProposal(project(duplicate.decisionProposal),cases,conditions,null,reply),/DECISION_CASE_COVERAGE_INVALID/)
})

test('unsupported array options stay local while supported nested constraints reach native generation',()=>{
 const schema={type:'object',properties:{values:{type:'array',minItems:1,maxItems:2,uniqueItems:true,contains:{type:'integer',const:1},minContains:1,maxContains:1,additionalItems:false,items:{type:'integer',minimum:0,maximum:2}}},required:['values']}
 const original=structuredClone(schema)
 const compiled=(configureProviderPayload({},profile,'default',schema) as any).response_format.json_schema.schema
 assert.deepEqual(unsupportedPaths(compiled),[])
 assert.deepEqual(compiled.properties.values.items,{type:'integer',minimum:0,maximum:2})
 assert.equal(compiled.properties.values.minItems,1)
 assert.equal(compiled.properties.values.maxItems,2)
 assert.deepEqual(schema,original)
 const payload={custom:true}
 assert.equal(configureProviderPayload(payload,{provider:'other',id:'other'},'default',schema),payload)
})

test('array keyword omission preserves named fields, definitions and literal data',()=>{
 const literal={contains:'original',minContains:1,maxContains:2,additionalItems:false,uniqueItems:true,messageId:'literal-message-id'}
 const schema={type:'object',additionalProperties:false,properties:{
  contains:{type:'array',items:{type:'string'},contains:{const:'required'},minContains:1},
  minContains:{type:'object',properties:{maxContains:{type:'integer'}},required:['maxContains']},
  additionalItems:{type:'string'},literal:{const:literal},options:{enum:[literal]},
  messageId:{type:'string'},
 },required:['contains','minContains','additionalItems','literal','options','messageId'],$defs:{contains:{type:'string'}},dependencies:{contains:{required:['additionalItems']},minContains:['additionalItems']}}
 const original=structuredClone(schema),messageId='33333333-3333-4333-8333-333333333333'
 const compiled=(configureProviderPayload({},profile,'default',schema,'collision',8192,messageId) as any).response_format.json_schema.schema
 assert.deepEqual(Object.keys(compiled.properties),Object.keys(schema.properties))
 assert.deepEqual(compiled.required,schema.required)
 assert.deepEqual(compiled.properties.contains,{type:'array',items:{type:'string'}})
 assert.deepEqual(compiled.properties.minContains,schema.properties.minContains)
 assert.deepEqual(compiled.$defs,schema.$defs)
 assert.deepEqual(compiled.dependencies,schema.dependencies)
 assert.deepEqual(compiled.properties.literal.const,literal)
 assert.deepEqual(compiled.properties.options.enum,[literal])
 assert.deepEqual(compiled.properties.messageId.enum,[messageId])
 assert.deepEqual(schema,original)
})
