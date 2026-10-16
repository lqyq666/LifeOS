import {test} from 'node:test'
import assert from 'node:assert/strict'
import {warmProviderConnection,configureProviderTransport} from '../server/provider-connection.ts'
import {MockAgent,getGlobalDispatcher,setGlobalDispatcher} from 'undici'
import {stream,type Model} from '@mariozechner/pi-ai'

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

test('scoped transport leaves other origins intact and preserves SDK streaming and in-flight cancellation',async()=>{
 const original=getGlobalDispatcher(),fallback=new MockAgent(),target=new MockAgent()
 fallback.disableNetConnect();target.disableNetConnect();setGlobalDispatcher(fallback)
 let calls=0
 const pool=target.get('https://dashscope.aliyuncs.com')
 const sse='data: '+JSON.stringify({id:'synthetic',model:'synthetic',choices:[{index:0,delta:{role:'assistant',content:'可执行的合成回答。'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'synthetic',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\ndata: [DONE]\n\n'
 pool.intercept({method:'POST',path:'/compatible-mode/v1/chat/completions'}).reply(200,()=>{calls++;return sse},{headers:{'content-type':'text/event-stream'}})
 fallback.get('https://coze.example.invalid').intercept({method:'GET',path:'/read-only'}).reply(200,'original dispatcher')
 const installed=configureProviderTransport({provider:'bailian',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1'},()=>target)
 try{
  assert.equal(await (await fetch('https://coze.example.invalid/read-only')).text(),'original dispatcher')
  const model:Model<'openai-completions'>={id:'synthetic',name:'synthetic',provider:'bailian',api:'openai-completions',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',reasoning:false,input:['text'],contextWindow:8192,maxTokens:128,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}
  const result=await stream(model,{messages:[{role:'user',content:'合成请求',timestamp:Date.now()}]},{apiKey:'synthetic-key',maxRetries:0}).result()
  assert.equal(result.stopReason,'stop');assert.equal(result.content[0]?.type,'text');assert.equal(calls,1)
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
  pool.intercept({method:'POST',path:'/compatible-mode/v1/chat/completions'}).reply(()=>{calls++;timer=setTimeout(()=>controller.abort(),10);return {statusCode:200,data:sse,responseOptions:{headers:{'content-type':'text/event-stream'}}}}).delay(60)
  const cancelled=await stream(model,{messages:[{role:'user',content:'合成取消请求',timestamp:Date.now()}]},{apiKey:'synthetic-key',maxRetries:0,signal:controller.signal}).result();clearTimeout(timer)
  assert.equal(cancelled.stopReason,'aborted');assert.equal(calls,2,'no hidden SDK retry')
 }finally{await installed.close?.();assert.equal(getGlobalDispatcher(),fallback);setGlobalDispatcher(original);await fallback.close()}
})
