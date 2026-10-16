import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import type {KnowledgeCard} from '../../server/campus-knowledge.ts'
import {knowledgeIntent} from '../../server/evergreen-guide.ts'
import {selectJevMethodCandidates,type JevTransport} from '../../server/jev-method-fit.ts'

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
