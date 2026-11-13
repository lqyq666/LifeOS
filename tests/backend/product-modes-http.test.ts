import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {model} from '../../server/model.ts'
import {createApp} from '../../server/http.ts'
import {createTurnEngine} from '../../server/turn-engine.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {createGrowthItem,actOnGrowthItem} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {productModePrompt,productModeOpeningPrompt} from '../../src/features/conversation/product-modes.ts'

test.after(async()=>{await localEmbedding.close();await pool.end()})
test('three modes use the normal single-call SSE/save path and memory OFF removes cross-session evidence',async()=>{
 const payloads:any[]=[];const reply='### 当前依据\n这是合成测试回复，依据当前允许使用的记录。\n\n### 条件与未知\n资格没有核实，不确定的条件保持未知。\n\n### 下一步\n可以先做一个小观察，不表示已接受或执行。\n**停止条件**：\n时间用完（严格控制在30分钟内）。'
 const fake=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;const payload=JSON.parse(body);payloads.push(payload);const turnReply=payload.messages.at(-1).content.startsWith('【选方向】')?reply+'\n这显示一定的技术基础。\n若为逃避就业而考，动机未确认，不作推断。':payload.messages.at(-1).content.startsWith('【做选择】')?reply+'\n能力匹配度较高。在本周内无法完成任何实质性的组队磨合或模型构建工作。可以在30分钟内完成。':reply;res.writeHead(200,{'Content-Type':'text/event-stream'});const id='modes-'+randomUUID(),raw=JSON.stringify({reply:turnReply}),env={id,object:'chat.completion.chunk',model:'qwen3.8-flash'};for(let i=0;i<raw.length;i+=15)res.write('data: '+JSON.stringify({...env,choices:[{index:0,delta:{content:raw.slice(i,i+15)},finish_reason:null}]})+'\n\n');res.end('data: '+JSON.stringify({...env,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n')})
 await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok))
 const old={base:model.baseUrl,key:config.apiKey,origin:config.origin,access:config.entitlementsEnabled,signup:config.signupEnabled,rate:config.messagesPerMinute,encode:localEmbedding.encode.bind(localEmbedding)}
 model.baseUrl='http://127.0.0.1:'+(fake.address() as any).port;config.apiKey='synthetic-modes-fixture-key';config.entitlementsEnabled=false;config.signupEnabled=true;config.messagesPerMinute=1000;localEmbedding.encode=async(texts:string[])=>texts.map(()=>[1,...Array(511).fill(0)])
 const app=createApp(createTurnEngine({capabilityVerified:()=>true}));await new Promise<void>(ok=>app.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+(app.address() as any).port;config.origin=origin
 try{
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'SYNTHETIC adult modes',email:randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID()})});assert.equal(signup.status,200)
  const user=(await signup.json() as any).user.id,headers={Origin:origin,'Content-Type':'application/json',Cookie:signup.headers.getSetCookie().map(s=>s.split(';')[0]).join('; '),'X-LifeOS-Draft-Deltas':'1'}
  assert.equal((await fetch(origin+'/api/understanding')).status,401)
  const source=randomUUID();await fetch(origin+'/api/conversations',{method:'POST',headers,body:JSON.stringify({id:source,title:'SYNTHETIC source'})});await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  const goal=await createGrowthItem(user,{requestId:randomUUID(),conversationId:source,kind:'goal',text:'我决定先探索电气科研。'})
  const time=await createGrowthItem(user,{requestId:randomUUID(),conversationId:source,kind:'constraint',text:'本周可用六小时。',validUntil:new Date(Date.now()+7*86400000).toISOString()})
  const rawView=await (await fetch(origin+'/api/understanding',{headers})).json();assert.ok(JSON.stringify(rawView).includes('电气科研'));assert.equal(payloads.length,0)
  assert.equal((await fetch(origin+'/api/understanding?conversation='+randomUUID(),{headers})).status,404)
  for(const [mode,prompt] of [['understand',productModePrompt('understand')],['directions',productModePrompt('directions',['就业','考研'])],['choice',productModePrompt('choice',[],'竞赛','校园数据建模竞赛，需要连续四周每周约六小时；有同学邀请组队，工作包括资料整理与答辩，目前不知道获奖概率。请判断是否值得尝试。')]] as const){
   const id=randomUUID(),requestId=randomUUID();await fetch(origin+'/api/conversations',{method:'POST',headers,body:JSON.stringify({id,title:'SYNTHETIC '+mode})})
   const response=await fetch(origin+'/api/conversations/'+id+'/messages',{method:'POST',headers,body:JSON.stringify({requestId,text:prompt})});assert.equal(response.status,200)
   const frames=(await response.text()).split('\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)));assert.equal(frames.find(f=>f.type==='error'),undefined,JSON.stringify(frames.find(f=>f.type==='error')));assert.ok(frames.some(f=>f.type==='draft'));assert.ok(frames.some(f=>f.type==='done'))
   const messages=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,requestId])).rows;assert.equal(messages.length,1);assert.equal(messages[0].content,mode==='directions'?reply+'\n这只支持当次已报告的行动或结果；相关技术基础及持续胜任仍需核实。\n考研动机尚未确认，需要由你说明，不能从比较选项推断。':mode==='choice'?reply+'\n有相关任务经历，适配仍待验证。本周预算低于所述完整参与要求；能否先做一小步取决于具体分工和步骤。建议最多投入30分钟；是否完成仍需看实际进展，时间到就停。':reply)
   const payload=payloads.at(-1);assert.equal(payload.max_completion_tokens,8192);assert.equal(payload.response_format.json_schema.strict,true);assert.equal(payload.response_format.json_schema.schema.properties.event,undefined);assert.equal(payload.response_format.json_schema.schema.properties.growthUpdates,undefined)
   assert.ok(payload.messages.at(-1).content.includes('个人细节只引用本人原话'))
   assert.ok(payload.messages.at(-1).content.includes('候选观察也不能猜测人格或动机'))
   assert.ok(payload.messages.at(-1).content.includes('完整参与与最小验证分别估计投入'))
   assert.ok(payload.messages.find((message:any)=>message.role==='system').content.includes('个人细节只引用本人原话'))
   assert.ok(payload.messages.find((message:any)=>message.role==='system').content.includes('候选观察也不能猜测人格或动机'))
   assert.ok(payload.messages.find((message:any)=>message.role==='system').content.includes('完整参与与最小验证分别估计投入'))
   if(mode==='choice')assert.ok(payload.messages.find((message:any)=>message.role==='system').content.includes('校园机会分析：'))
   assert.ok(JSON.stringify(payload).includes('电气科研'));assert.ok(JSON.stringify(payload).includes('六小时'))
  }
  assert.equal(payloads.length,3)
  for(const mode of ['understand','directions','choice'] as const){
   const id=randomUUID(),requestId=randomUUID(),before:number=payloads.length
   await fetch(origin+'/api/conversations',{method:'POST',headers,body:JSON.stringify({id,title:'SYNTHETIC conversational '+mode})})
   const response=await fetch(origin+'/api/conversations/'+id+'/messages',{method:'POST',headers,body:JSON.stringify({requestId,text:productModeOpeningPrompt(mode)})})
   assert.equal(response.status,200)
   const frames=(await response.text()).split('\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)))
   assert.equal(frames.find(f=>f.type==='error'),undefined,mode+':'+JSON.stringify(payloads.at(-1).response_format.json_schema.schema.properties.reply)+JSON.stringify(frames.filter(f=>f.type!=='draft')))
   assert.ok(frames.some(f=>f.type==='draft'));assert.ok(frames.some(f=>f.type==='done'))
   assert.equal(payloads.length,before+1,'one normal model call per mode click')
   assert.equal(payloads.at(-1).response_format.json_schema.schema.properties.event,undefined)
   const saved=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,requestId])).rows
   assert.equal(saved.length,1);assert.equal(saved[0].content,frames.find(f=>f.type==='delta'&&f.saved===true).text)
  }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM growth_items WHERE user_id=$1',[user])).rows[0].n,2,'mode requests are not new personal facts or goals')
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM experiences WHERE user_id=$1',[user])).rows[0].n,0,'mode requests are not autobiographical episodes')
  await actOnGrowthItem(user,time.id,{requestId:randomUUID(),expectedRevision:time.revision,action:'correct',text:'本周只剩三十分钟。'})
  await actOnGrowthItem(user,goal.id,{requestId:randomUUID(),expectedRevision:goal.revision,action:'correct',text:'我决定优先就业。'})
  const updated=JSON.stringify(await (await fetch(origin+'/api/understanding',{headers})).json());assert.ok(updated.includes('三十分钟'));assert.ok(updated.includes('优先就业'));assert.ok(!updated.includes('六小时'));assert.ok(!updated.includes('先探索电气科研'))
  const settings=(await pool.query('SELECT revision FROM user_memory_settings WHERE user_id=$1',[user])).rows[0];await setMemorySettings(user,{requestId:randomUUID(),enabled:false,expectedRevision:settings.revision})
  const disabled=JSON.stringify(await (await fetch(origin+'/api/understanding',{headers})).json());assert.ok(!disabled.includes('三十分钟'));assert.ok(!disabled.includes('优先就业'))
  const id=randomUUID();await fetch(origin+'/api/conversations',{method:'POST',headers,body:JSON.stringify({id,title:'OFF fresh'})});const response=await fetch(origin+'/api/conversations/'+id+'/messages',{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),text:productModeOpeningPrompt('directions')})});await response.text();assert.equal(payloads.length,7);assert.ok(!JSON.stringify(payloads.at(-1)).includes('三十分钟'));assert.ok(!JSON.stringify(payloads.at(-1)).includes('优先就业'))
 }finally{Object.assign(config,{apiKey:old.key,origin:old.origin,entitlementsEnabled:old.access,signupEnabled:old.signup,messagesPerMinute:old.rate});model.baseUrl=old.base;localEmbedding.encode=old.encode;app.closeAllConnections();fake.closeAllConnections();await new Promise<void>(ok=>app.close(()=>ok()));await new Promise<void>(ok=>fake.close(()=>ok()))}
})
