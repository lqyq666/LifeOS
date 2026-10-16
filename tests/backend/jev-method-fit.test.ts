import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import type {KnowledgeCard} from '../../server/campus-knowledge.ts'
import {knowledgeIntent} from '../../server/evergreen-guide.ts'
import {jevMethodFitContext,selectJevMethodCandidates,type JevTransport} from '../../server/jev-method-fit.ts'

const cards=readFileSync('.planning/research/evergreen/KB_GUIDES.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line) as KnowledgeCard).filter(card=>card.guide?.reviewStatus==='approved').slice(0,3)
const intent=knowledgeIntent('校园项目需求一直变，我该用什么方法确认真正需求？')
const response=(answers:Record<string,unknown>)=>({ok:true,status:200,json:async()=>({model:'jev-1.14.0',answers,usage:{input_tokens:123,output_tokens:6}})}) as Response

test('Jev method fit makes one pre-generation request and keeps only applicable existing candidates in original order',async()=>{
 let calls=0,payload:any
 const transport:JevTransport=async(_url,init)=>{calls++;payload=JSON.parse(String(init.body));return response({candidate_0:{type:'choice',choice:'missing_prerequisite',confidence:.82,probabilities:{applicable:.08,missing_prerequisite:.82,needs_clarification:.05,unsuitable:.05}},candidate_1:{type:'choice',choice:'applicable',confidence:.78,probabilities:{applicable:.78,missing_prerequisite:.07,needs_clarification:.1,unsuitable:.05}},candidate_2:{type:'choice',choice:'unsuitable',confidence:.9,probabilities:{applicable:.02,missing_prerequisite:.03,needs_clarification:.05,unsuitable:.9}}})}
 const result=await selectJevMethodCandidates(cards,'校园项目需求一直变，我该用什么方法确认真正需求？',intent,{enabled:true,apiKey:'x'.repeat(24),transport})
 assert.equal(calls,1);assert.equal(payload.model,'jev-1.14.0');assert.equal(Object.keys(payload.questions).length,3)
 assert.deepEqual(result.cards.map(card=>card.id),[cards[1].id]);assert.equal(result.trace.status,'selected');assert.deepEqual(result.trace.selected.map(row=>row.id),[cards[1].id]);assert.deepEqual(result.trace.usage,{inputTokens:123,outputTokens:6});assert.deepEqual(result.trace.cost,{currency:'USD',amount:.000005166,basis:'published_input_rate',inputUsdPerMillion:.042})
 assert.ok(!JSON.stringify(result.trace).includes('校园项目'))
})

test('Jev method fit allows all candidates to be unsuitable',async()=>{
 const transport:JevTransport=async()=>response(Object.fromEntries(cards.map((_,i)=>['candidate_'+i,{type:'choice',choice:'unsuitable',confidence:.9,probabilities:{applicable:.02,missing_prerequisite:.03,needs_clarification:.05,unsuitable:.9}}])))
 const result=await selectJevMethodCandidates(cards,'校园项目需求一直变，我该用什么方法确认真正需求？',intent,{enabled:true,apiKey:'x'.repeat(24),transport})
 assert.deepEqual(result.cards,[]);assert.equal(result.trace.status,'selected')
})

test('generation context exposes approved conditions but no Jev probabilities',async()=>{
 const transport:JevTransport=async()=>response(Object.fromEntries(cards.map((_,i)=>['candidate_'+i,{type:'choice',choice:'needs_clarification',confidence:.7,probabilities:{applicable:.1,missing_prerequisite:.1,needs_clarification:.7,unsuitable:.1}}])))
 const result=await selectJevMethodCandidates(cards,'校园项目的关键条件还不清楚，我下一步怎么办？',intent,{enabled:true,apiKey:'x'.repeat(24),transport})
 const context=jevMethodFitContext(cards,result.trace) as any
 assert.equal(context.decisions[0].state,'needs_clarification')
 assert.deepEqual(context.decisions[0].prerequisites,cards[0].guide?.prerequisites)
 assert.deepEqual(context.decisions[0].exclusions,cards[0].guide?.exclusions)
 assert.ok(!JSON.stringify(context).includes('probabilities'))
 assert.ok(!JSON.stringify(context).includes('confidence'))
})

test('disabled, continuation, clear candidate and transport failure preserve the original safe path without retries',async()=>{
 let calls=0;const failing:JevTransport=async()=>{calls++;throw new Error('offline')}
 const disabled=await selectJevMethodCandidates(cards,'需要一个方法',intent,{enabled:false,apiKey:'',transport:failing})
 assert.deepEqual(disabled.cards.map(card=>card.id),cards.slice(0,2).map(card=>card.id));assert.equal(calls,0);assert.equal(disabled.trace.reason,'disabled')
 const continued=await selectJevMethodCandidates(cards,'继续上次第三步',{...intent,continuation:true,stage:'adjust'},{enabled:true,apiKey:'x'.repeat(24),transport:failing})
 assert.deepEqual(continued.cards.map(card=>card.id),cards.slice(0,2).map(card=>card.id));assert.equal(calls,0);assert.equal(continued.trace.reason,'continuation')
 const clear=await selectJevMethodCandidates(cards,cards[0].title+'怎么做',intent,{enabled:true,apiKey:'x'.repeat(24),transport:failing})
 assert.deepEqual(clear.cards.map(card=>card.id),[cards[0].id]);assert.equal(calls,0);assert.equal(clear.trace.reason,'clear_candidate')
 const fallback=await selectJevMethodCandidates(cards,'校园项目需求一直变，我该用什么方法确认真正需求？',intent,{enabled:true,apiKey:'x'.repeat(24),transport:failing})
 assert.deepEqual(fallback.cards.map(card=>card.id),cards.slice(0,2).map(card=>card.id));assert.equal(calls,1);assert.equal(fallback.trace.status,'fallback')
})

test('changed prerequisites can check the continued method but never switch to another method',async()=>{
 let calls=0
 const transport:JevTransport=async()=>{calls++;return response({candidate_0:{type:'choice',choice:'missing_prerequisite',confidence:.9,probabilities:{applicable:.02,missing_prerequisite:.9,needs_clarification:.05,unsuitable:.03}},candidate_1:{type:'choice',choice:'applicable',confidence:.85,probabilities:{applicable:.85,missing_prerequisite:.05,needs_clarification:.05,unsuitable:.05}}})}
 const changed={...intent,continuation:true,stage:'adjust' as const}
 const result=await selectJevMethodCandidates(cards.slice(0,2),cards[0].title+'需要已解示例，但我没有示例，怎么继续？',changed,{enabled:true,apiKey:'x'.repeat(24),transport})
 assert.equal(calls,1);assert.deepEqual(result.cards,[]);assert.equal(result.trace.reason,'no_applicable_candidate')
})

test('HTTP failures are auditable and retain the original path without retrying',async()=>{
 let calls=0
 const transport:JevTransport=async()=>{calls++;return {ok:false,status:451,json:async()=>({})}}
 const result=await selectJevMethodCandidates(cards,'校园项目需求一直变，我该用什么方法确认真正需求？',intent,{enabled:true,apiKey:'x'.repeat(24),transport})
 assert.equal(calls,1)
 assert.equal(result.trace.status,'fallback')
 assert.equal(result.trace.reason,'request_http_451')
 assert.deepEqual(result.cards.map(card=>card.id),cards.slice(0,2).map(card=>card.id))
})
