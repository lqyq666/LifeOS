import {test} from 'node:test'
import assert from 'node:assert/strict'
import {warmProviderConnection} from '../server/provider-connection.ts'

test('startup connection warming is credential-free, read-only and never a health assertion',async()=>{
 let calls=0
 const result=await warmProviderConnection({provider:'bailian',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1'},async(url,options)=>{
  calls++;assert.equal(String(url),'https://dashscope.aliyuncs.com/compatible-mode/v1/models')
  assert.equal(options?.method,'GET');assert.equal(options?.credentials,'omit');assert.equal(options?.redirect,'error')
  assert.equal(options?.headers,undefined);assert.equal(options?.body,undefined);assert.ok(options?.signal)
  return new Response('unauthorized',{status:401})
 })
 assert.equal(calls,1);assert.equal(result.completed,true);assert.equal(result.status,401)
 assert.equal('healthy' in result,false)
})

test('warming skips unapproved endpoints and cannot stop startup on transport failure',async()=>{
 for(const baseUrl of ['https://example.invalid/compatible-mode/v1','http://dashscope.aliyuncs.com/compatible-mode/v1','https://secret@dashscope.aliyuncs.com/compatible-mode/v1','https://dashscope.aliyuncs.com/compatible-mode/v1?api_key=secret']){
  assert.deepEqual(await warmProviderConnection({provider:'bailian',baseUrl},async()=>{throw Error('MUST_NOT_SEND')}),{attempted:false})
 }
 let calls=0
 const result=await warmProviderConnection({provider:'bailian',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1'},async()=>{calls++;throw Error('private transport details')})
 assert.equal(calls,1);assert.equal(result.completed,false);assert.equal(JSON.stringify(result).includes('private'),false)
})

test('warming bounds the response and cancels oversized bodies without retrying',async()=>{
 let cancelled=false,calls=0
 const result=await warmProviderConnection({provider:'bailian',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1'},async()=>{
  calls++;return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(65537))},cancel(){cancelled=true}}))
 })
 assert.equal(calls,1);assert.equal(cancelled,true);assert.equal(result.completed,false)
})
