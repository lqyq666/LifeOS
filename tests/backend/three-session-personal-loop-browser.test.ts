import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {config} from '../../server/config.ts'
import {model} from '../../server/model.ts'
import {createApp} from '../../server/http.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {coachEventView} from '../../server/action-coach-events.ts'
import {growthView} from '../../server/growth.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const choice='我在考研和就业之间拿不定主意，这周只能拿出一小时。我先选就业，今天用十分钟看一个岗位。'
const blocked='我看了一个岗位四分钟，只核对了三列标题，没有完成，也没帮我判断方向。今天没时间了。'
const refocus='先把重点改成就业探索。下次有半小时，再帮我只核对一个岗位，资料不全就先问我。'

test('normal Chrome carries one personal task through three natural conversations',async()=>{
 const old={url:model.baseUrl,key:config.apiKey,origin:config.origin,rate:config.messagesPerMinute,access:config.entitlementsEnabled,signup:config.signupEnabled,workflows:process.env.LIFEOS_ADVANCED_WORKFLOWS}
 const outputs:any[]=[],requests:any[]=[],errors:string[]=[]
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',chunk=>chunks.push(Buffer.from(chunk)));req.on('end',()=>{
  const payload=JSON.parse(Buffer.concat(chunks).toString('utf8')),out=outputs.shift()
  requests.push(payload)
  if(!out){res.writeHead(500);res.end('UNEXPECTED_SYNTHETIC_CALL');return}
  const allowed=payload.response_format?.json_schema?.schema?.properties?.reply?.enum
  if(allowed?.length)out.reply=allowed[0]
  const order=Object.keys(payload.response_format?.json_schema?.schema?.properties??{})
  const body=Object.fromEntries([...order.filter(key=>Object.hasOwn(out,key)),...Object.keys(out).filter(key=>!order.includes(key))].map(key=>[key,out[key]]))
  const base={id:'synthetic-browser-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id}
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:JSON.stringify(body)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(done=>fake.listen(0,'127.0.0.1',done))
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-browser-only';config.entitlementsEnabled=false;config.signupEnabled=true;config.messagesPerMinute=1000;process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
 const app=createApp(createTurnEngine({capabilityVerified:()=>true}));await new Promise<void>(done=>app.listen(0,'127.0.0.1',done))
 const origin='http://127.0.0.1:'+(app.address() as {port:number}).port;config.origin=origin
 let browser:any
 try{
  await localEmbedding.start()
  const email='three-session-'+randomUUID()+'@example.invalid',password='Synthetic-'+randomUUID()
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password,name:'SYNTHETIC 成年学生'})})
  assert.equal(signup.status,200)
  const user=(await signup.json() as any).user.id
  browser=await chromium.launch({channel:'chrome',headless:true})
  const context=await browser.newContext({viewport:{width:1280,height:900}})
  await context.route('**/*',(route:any)=>route.request().url().startsWith(origin)?route.continue():route.abort())
  const page=await context.newPage();page.on('pageerror',(error:Error)=>errors.push(error.message))
  await page.goto(origin+'/#conversation')
  await page.getByRole('dialog',{name:'LifeOS 聊一聊'}).getByRole('button',{name:'登录',exact:true}).click()
  await page.getByLabel('邮箱',{exact:true}).fill(email);await page.getByLabel('密码',{exact:true}).fill(password)
  await page.getByRole('form',{name:'邮箱登录'}).getByRole('button',{name:'登录',exact:true}).click()
  await page.getByRole('button',{name:'长期记忆',exact:true}).waitFor();await page.getByRole('button',{name:'长期记忆',exact:true}).click()
  await page.getByLabel('启用长期记忆',{exact:true}).click();await page.getByText('已开启：可跨对话复用你允许保存的背景。',{exact:true}).waitFor()
  await page.getByRole('button',{name:'关闭记忆面板'}).click()

  const known=new Set<string>()
  const send=async(text:string,output:Record<string,unknown>)=>{
   outputs.push(output)
   await page.getByLabel('想聊的事',{exact:true}).fill(text);await page.getByRole('button',{name:'发送消息',exact:true}).click()
   await page.locator('.qa-thinking').waitFor({state:'detached'})
   await page.getByRole('article',{name:'LifeOS 的回应'}).last().waitFor()
   const conversations=await store.listConversations(user),created=conversations.find(item=>!known.has(item.id))
   assert.ok(created,'normal interface must persist the new conversation')
   known.add(created.id)
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND conversation_id=$2 AND role='assistant'",[user,created.id])).rows[0].n,1)
   return created.id
  }

  const first=await send(choice,{
   growthUpdates:[
    {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'constraint',source:{clauseId:'c1'},timeEvidence:{kind:'calendar_week',which:'this',clauseId:'c1'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'direction',source:{clauseId:'c2'}},
   ],
   event:{target:{operation:'create',title:'就业岗位初次探索',source:{clauseId:'c2'}},factRefs:[0,1,2],nodes:[{kind:'unknown',question:'第一次看完岗位后，哪些信息实际帮助判断方向？',affects:'决定后续核对重点',reason:'计划尚未产生实际反馈'}],action:{operation:'create',draft:{content:'用十分钟打开一份岗位说明，只核对一项具体要求；资料不全就停。'}}},
   reply:'先按你当前选择的就业方向，用十分钟看一个岗位；到点就停，这还不是已完成经历。',
  })
  const initial=(await coachEventView(user,first))!;assert.ok(initial);assert.equal(initial.revision,1)

  await page.getByRole('button',{name:'新对话',exact:true}).click()
  const unknown=initial.nodes.find(node=>node.kind==='unknown'&&node.status==='active')!
  const second=await send(blocked,{
   growthUpdates:[
    {target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'attempted',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:'我看了一个岗位四分钟'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c2'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c3'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c4'}},
   ],
   event:{target:{operation:'continue',eventId:initial.id,expectedRevision:initial.revision},factRefs:[0,1,2,3,4],resolveUnknowns:[unknown.id]},
   reply:'你实际看了四分钟，只核对了三列标题；这次没有完成，也没有帮助判断方向。今天没有时间，不再加动作。',
  })
  const afterFeedback=(await coachEventView(user,second,initial.id))!;assert.equal(afterFeedback.revision,2)

  await page.getByRole('button',{name:'新对话',exact:true}).click()
  const third=await send(refocus,{
   growthUpdates:[
    {target:{operation:'create'},assertion:'user_reported',kind:'direction',source:{clauseId:'c0'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'goal',source:{clauseId:'c2'}},
    {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c3'}},
   ],
   event:{target:{operation:'continue',eventId:initial.id,expectedRevision:afterFeedback.revision},factRefs:[0,1,2,3]},
   reply:'重点改成就业探索。下次三十分钟只核对一个岗位；请先给我岗位链接或JD，资料不全我会先问，不会补造。',
  })

  assert.equal(known.size,3);assert.equal(requests.length,3);assert.equal(outputs.length,0)
  const finalEvent=(await coachEventView(user,third,initial.id))!;assert.equal(finalEvent.revision,3)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM coach_events WHERE user_id=$1',[user])).rows[0].n,1)
  assert.equal((await store.listExperiences(user)).length,1)
  const growth=(await growthView(user,third)).items.filter(item=>!item.unavailableReason)
  assert.ok(growth.some(item=>item.text==='我看了一个岗位四分钟'))
  assert.ok(growth.some(item=>item.text==='下次有半小时'))
  const audits=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 ORDER BY started_at',[user])).rows.flatMap(row=>row.tool_audit)
  assert.equal(audits.filter((row:any)=>row.phase==='main_skill_payload'&&row.status==='included_in_provider_payload').length,3)
  const executed=new Set(audits.filter((row:any)=>row.phase==='workflow_trace'&&row.agentRole==='skill'&&row.status==='succeeded'&&row.skillPhase==='output_validated').map((row:any)=>row.skill))
  for(const skill of ['lifeos-action-review','lifeos-experience-evidence','lifeos-growth-diff'])assert.ok(executed.has(skill),JSON.stringify({missing:skill,executed:[...executed],fallbacks:audits.filter((row:any)=>row.phase==='workflow_fallback'||row.status==='failed'||row.error)}))
  assert.equal(executed.has('lifeos-direction-analysis'),false,'ordinary chat does not enter deep direction analysis')
  assert.equal(executed.has('lifeos-guide-application'),false,'a simple job check does not force a guide')
  assert.equal(await page.getByRole('article',{name:'LifeOS 的回应'}).count(),1)
  assert.match(await page.getByRole('article',{name:'LifeOS 的回应'}).innerText(),/就业.*三十分钟|三十分钟.*就业/)
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  assert.deepEqual(errors,[])
 }finally{
  if(browser)await browser.close()
  Object.assign(config,{origin:old.origin,messagesPerMinute:old.rate,entitlementsEnabled:old.access,signupEnabled:old.signup});model.baseUrl=old.url;config.apiKey=old.key
  if(old.workflows===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=old.workflows
  app.closeAllConnections();await new Promise<void>(done=>app.close(()=>done()));fake.closeAllConnections();await new Promise<void>(done=>fake.close(()=>done()));await localEmbedding.close();await pool.end()
 }
})
