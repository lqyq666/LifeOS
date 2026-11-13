import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {model} from '../../server/model.ts'
import {createApp} from '../../server/http.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {createGrowthItem} from '../../server/growth.ts'
import {importKnowledge} from '../../server/campus-knowledge.ts'
const fixture=JSON.parse(readFileSync(new URL('../fixtures/reply-completeness-p3.json',import.meta.url),'utf8'))
test.after(async()=>{await localEmbedding.close();await pool.end()})
test('captured reply and long read-only topic stream, commit, and refresh without removed content or profile mutations',async()=>{
 const full='## 三条道路的依据与未知\n\n'+('**独立产品、实习与科研**：个人依据、投入和待核实条件分别保留，建议不表示已经选择。\n\n'.repeat(65))+'### 独立产品\n**未知条件**\n- 是否有真实用户试用？\n- 留存反馈是什么？\n### AI实习\n**未知条件**\n- 当前技能差距是什么？\n### AI交叉科研\n**未知条件**\n- 实验室是否接收本科生？\n### 如何获得选择依据\n3. **交叉科研**：通过邮件联系老师，了解课题组是否接收本科生？这一步只获取新证据。'
 let nextReply=fixture.rawReply;const payloads:any[]=[]
 const fake=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  payloads.push(JSON.parse(body));res.writeHead(200,{'Content-Type':'text/event-stream'})
  const env={id:'synthetic-completeness',object:'chat.completion.chunk',created:1,model:model.id},text=JSON.stringify({reply:nextReply});let offset=0
  const timer=setInterval(()=>{if(offset<text.length){res.write('data: '+JSON.stringify({...env,choices:[{index:0,delta:{content:text.slice(offset,offset+100)},finish_reason:null}]})+'\n\n');offset+=100}else{clearInterval(timer);res.end('data: '+JSON.stringify({...env,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n')}},15)
 })})
 await new Promise<void>(ok=>fake.listen(0,'127.0.0.1',ok))
 const old={base:model.baseUrl,key:config.apiKey,origin:config.origin,access:config.entitlementsEnabled,signup:config.signupEnabled,encode:localEmbedding.encode.bind(localEmbedding)}
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-completeness';config.entitlementsEnabled=false;config.signupEnabled=true;localEmbedding.encode=async(texts:string[])=>texts.map(()=>[1,...Array(511).fill(0)])
 const app=createApp(createTurnEngine({capabilityVerified:()=>true}));await new Promise<void>(ok=>app.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+(app.address() as {port:number}).port;config.origin=origin
 let actor:string|undefined
 try{
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'SYNTHETIC completeness',email:randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID()})});assert.equal(signup.status,200);actor=(await signup.json() as any).user.id
  const headers={Origin:origin,'Content-Type':'application/json',Cookie:signup.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),'X-LifeOS-Draft-Deltas':'1'}
  const source=randomUUID();assert.equal((await fetch(origin+'/api/conversations',{method:'POST',headers,body:JSON.stringify({id:source,title:'SYNTHETIC background source'})})).status,201)
  await setMemorySettings(actor!,{requestId:randomUUID(),enabled:true,expectedRevision:0});for(const fact of fixture.seed)await createGrowthItem(actor!,{...fact,requestId:randomUUID(),conversationId:source})
  const fingerprint=async()=>{const result:Record<string,string>={};for(const table of ['growth_items','experiences','memory_items','user_themes','user_memory_settings','coach_events','coach_nodes','coach_actions'])result[table]=(await pool.query('SELECT md5(coalesce(json_agg(row_to_json(x) ORDER BY row_to_json(x)::text)::text,\'[]\')) AS hash FROM '+table+' x WHERE user_id=$1',[actor])).rows[0].hash;return result}
  await importKnowledge([{id:randomUUID(),revision:1,kind:'method',status:'verified',synthetic:true,title:'SYNTHETIC 行动观察与验证',url:'https://example.invalid/synthetic-observation',publisher:'SYNTHETIC',publishedYear:'2026',verifiedAt:new Date().toISOString(),validUntil:null,excerpt:'合成验收：行动可以记录观察与未知，不能证明职业适配。',claim:'行动可以记录观察与未知',scope:'合成起步动作验收',limitations:'不证明职业适配或有效性',mechanisms:['source-check'],sourceHash:'a'.repeat(64)}],true)
  const before=await fingerprint()
  for(const [prompt,reply] of [[fixture.prompt,fixture.rawReply],[fixture.publicCase.prompt,fixture.publicCase.reply],['请完整写一份大学生比较独立AI产品、AI实习与AI交叉科研三条道路的说明。只分析，不修改档案，不创建任务或经历。',full],['请结合你已经保存的我的真实背景，分析未来一个学期怎样验证三条方向：独立AI产品、AI实习、电气与AI科研。只给分析和建议，不修改档案，不创建任务或经历。',full]]){
   nextReply=reply;const conversation=randomUUID(),requestId=randomUUID();assert.equal((await fetch(origin+'/api/conversations',{method:'POST',headers,body:JSON.stringify({id:conversation,title:'SYNTHETIC content preservation'})})).status,201)
   const response=await fetch(origin+'/api/conversations/'+conversation+'/messages',{method:'POST',headers,body:JSON.stringify({requestId,text:prompt})});assert.equal(response.status,200)
   const frames=(await response.text()).split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));assert.equal(frames.find(e=>e.type==='error'),undefined)
   const saved=frames.find(e=>e.type==='delta'&&e.saved)?.text;assert.equal(typeof saved,'string')
   // The generated body, including punctuation and suggested channels, is not
   // rewritten after generation. Delivery and refresh must preserve it exactly.
   assert.equal(saved,reply.trim());assert.ok(frames.some(e=>e.type==='done'));assert.ok(frames.filter(e=>e.type==='draft').length>=2)
   let visible='';for(const f of frames){if(f.type==='draft')visible=f.append?visible+f.text:f.text;if(f.type==='delta')visible=f.replace?f.text:visible+f.text}assert.equal(visible,saved)
   const all=await (await fetch(origin+'/api/conversations?includeStateChanges=false',{headers})).json() as any[];assert.equal(all.find(c=>c.id===conversation).messages.at(-1).content,saved)
   const rows=await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[actor,requestId]);assert.equal(rows.rows[0].content,saved)
   assert.ok(payloads.at(-1).response_format.json_schema.schema.properties.reply);assert.equal(payloads.at(-1).response_format.json_schema.schema.properties.event,undefined);assert.equal(payloads.at(-1).response_format.json_schema.schema.properties.growthUpdates,undefined);assert.equal(payloads.at(-1).max_completion_tokens,8192)
  }
  assert.deepEqual(await fingerprint(),before);assert.equal(payloads.length,4)
 }finally{
  config.origin=old.origin;config.entitlementsEnabled=old.access;config.signupEnabled=old.signup;model.baseUrl=old.base;config.apiKey=old.key;localEmbedding.encode=old.encode
  app.closeAllConnections();await new Promise<void>(ok=>app.close(()=>ok()));fake.closeAllConnections();await new Promise<void>(ok=>fake.close(()=>ok()));if(actor)await pool.query('DELETE FROM "user" WHERE id=$1',[actor])
 }
})
