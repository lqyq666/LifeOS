import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID,createHash} from 'node:crypto'
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs'
import {dirname} from 'node:path'
import {resolve} from 'node:path'
import {createRequire} from 'node:module'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {model,resolveModel} from '../../server/model.ts'
import {createApp} from '../../server/http.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {stageCoachEvent} from '../../server/action-coach-events.ts'
import {indexCoachEventOnce} from '../../server/coach-retrieval.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import * as store from '../../server/store.ts'
import {CoachProviderBudget} from '../../scripts/coach-provider-budget.ts'
import {captureCoachSource} from '../../scripts/coach-source-freeze.ts'
import {createRuntimeDecisionAdapter} from '../../server/workflows/provider-adapter.ts'
import {createWorkflowHost} from '../../server/workflows/task-host.ts'
import {readWorkflowEvidence} from '../../server/workflows/task-sources.ts'

test('waiting_user short time supplement continues original comparison in real Chrome without duplicate deep calls',async()=>{
 const previous={url:model.baseUrl,key:config.apiKey,origin:config.origin,access:config.entitlementsEnabled,flag:process.env.LIFEOS_ADVANCED_WORKFLOWS}
 process.env.LIFEOS_ADVANCED_WORKFLOWS='true';config.entitlementsEnabled=false
 const wire:any[]=[],audits:any[]=[],directory=process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/workflow-integration/evidence/continuation';mkdirSync(directory,{recursive:true})
 const progress=(text:string)=>appendFileSync(directory+'/browser-probe-stages.log',text+'\n')
 let eventId='',eventRevision=1,slow=false
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',x=>chunks.push(Buffer.from(x)));req.on('end',()=>{
  const request=JSON.parse(Buffer.concat(chunks).toString()),ctx=JSON.parse(request.messages[1].content);wire.push({context:ctx,role:request.messages[0].content})
  let output:unknown
  if(ctx.path)output={evidenceIds:['e0'],tradeoffIds:['path','parallel'],unknownIds:['fit'],actionIds:[ctx.actions[0].id]}
  else if(ctx.analyses)output={issues:[{severity:'uncertainty',issueId:'fit',evidenceIds:['e0']}],rejectedDirections:[]}
  else if(ctx.alternatives)output={actionIds:['a0']}
  else output={reply:'时间已补充；原来的就业和考研比较仍待你继续。'}
  if(ctx.boundedReply)(output as any).reply=ctx.boundedReply.choices[0]
  if(ctx.path){const result=output as any;result.comparisonBasis={criterionId:"tasks",peerDirectionId:ctx.peers[0].id,evidenceIds:["e0"],probePriority:"unresolved"};result.evidenceRelations??=result.evidenceIds.map((id:string)=>({evidenceId:id,relation:'unknown'}));result.actionBasis??=result.actionIds.map((id:string)=>({actionId:id,evidenceIds:result.evidenceIds,unknownIds:result.unknownIds,stageReasonId:'explore'}))}
  const send=()=>{if(res.destroyed)return;res.writeHead(200,{'Content-Type':'text/event-stream'});const base={id:'synthetic-http-'+wire.length,object:'chat.completion.chunk',created:1,model:model.id};res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:300,completion_tokens:100,total_tokens:400}})+'\n\ndata: [DONE]\n\n')}
  if(slow)setTimeout(send,700);else send()
 })})
 await new Promise<void>(done=>fake.listen(0,'127.0.0.1',done));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-http-runtime-only-key'
 const budget=new CoachProviderBudget({simulation:true,testDirectory:'simulation-workflow-http-'+randomUUID()});budget.snapshot()
 writeFileSync(dirname(budget.path)+'/development-test-grant-20261005.json',JSON.stringify({kind:'SIMULATED_DEVELOPMENT_TEST_GRANT',amountCny:30,startingCall:0,priorReceiptsSha256:createHash('sha256').update('[]').digest('hex')}));budget.activateCurrentGrant()
 const freezePath=dirname(budget.path)+'/source-freeze.json';writeFileSync(freezePath,JSON.stringify(captureCoachSource()))
 const makeHost=()=>createWorkflowHost({synthetic:true,adapter:createRuntimeDecisionAdapter({readEvidence:readWorkflowEvidence,budget,freezePath,syntheticTransport:true,runtime:{...resolveModel('default'),pricing:{inputCnyPerMillion:1,outputCnyPerMillion:2}},audit:async(r,row)=>{audits.push(row);await pool.query('UPDATE lifeos_workflow_nodes SET provider_usage=$4 WHERE user_id=$1 AND request_id=$2 AND call_id=$3',[r.internalActorKey,r.requestId,row.callId,JSON.stringify(row)])}})})
 const host=makeHost(),app=createApp(createTurnEngine({capabilityVerified:tier=>tier==='default'}),15000,host)
 await new Promise<void>(done=>app.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+(app.address() as {port:number}).port;config.origin=origin
 let cookie='',user='',otherCookie='';const checks:string[]=[]
 const account=async()=>{const res=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'workflow-http-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID(),name:'Synthetic student'})});assert.equal(res.status,200);const cookie=res.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');return {cookie,user:(await (await fetch(origin+'/api/session',{headers:{Cookie:cookie}})).json()).id}}
 const request=(path:string,body?:unknown,auth=cookie)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:auth,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
 const json=async(path:string,body?:unknown)=>{const res=await request(path,body),out=await res.json();assert.ok(res.ok,JSON.stringify({path,status:res.status,out}));return out}
 const wait=async(id:string)=>{const until=Date.now()+15000;while(Date.now()<until){const view=await json('/api/workflows/'+id);if(!['queued','running'].includes(view.status))return view;await new Promise(done=>setTimeout(done,25))}assert.fail('durable task did not finish')}
 try{
  progress('starting embedding');await localEmbedding.start();progress('embedding ready');const a=await account();cookie=a.cookie;user=a.user;progress('auth ready')
  const chat=randomUUID();await json('/api/conversations',{id:chat,title:'SYNTHETIC waiting comparison'})
  const text='我是成年大学生，有一个课程项目，想深入比较就业和考研，还不知道本周空余时间。'
  const initial=(await store.startRun(user,chat,randomUUID(),text)).run
  await store.finishRun(initial,{candidates:[],audit:[]},'先补充本周本人可用时间就能继续这次比较。',null,new AbortController().signal)
  const taskId=randomUUID(),body={requestId:taskId,conversationId:chat,currentMessageId:initial.source_message_id,directions:['employment','postgraduate_exam'],consent:true}
  progress('initial message saved');await json('/api/workflows',body);assert.equal((await json('/api/workflows/'+taskId)).status,'waiting_user');assert.equal(wire.length,0);progress('waiting task created')
  const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
  const browser=await chromium.launch({channel:'chrome',headless:true})
  try{
   const context=await browser.newContext({viewport:{width:1440,height:900}})
   await context.addCookies(cookie.split('; ').map(part=>{const at=part.indexOf('=');return {name:part.slice(0,at),value:part.slice(at+1),url:origin}}))
   await context.addInitScript((id:string)=>sessionStorage.setItem('lifeos:pending-conversation',id),chat)
   await context.route('**/*',(route:any)=>route.request().url().startsWith(origin)?route.continue():route.abort())
   const page=await context.newPage(),errors:string[]=[];page.on('pageerror',(e:any)=>errors.push(e.message))
   progress('loading browser chat');await page.goto(origin+'/#conversation',{waitUntil:'networkidle'});await page.locator('dialog.qa-page[open]').waitFor();progress('browser chat ready')
   await page.screenshot({path:resolve(directory,'waiting-before-input.png'),fullPage:true});const task=page.locator('[data-workflow-id="'+taskId+'"]');await task.getByText('先核对一项情况，尚未调用模型',{exact:true}).waitFor();progress('waiting task rendered')
   await page.getByRole('textbox',{name:'想聊的事',exact:true}).fill('这周六小时')
   progress('supplement filled');await page.screenshot({path:resolve(directory,'waiting-filled.png'),fullPage:true})
   const sent=page.waitForResponse((r:any)=>r.url().endsWith('/messages')&&r.request().method()==='POST',{timeout:10000})
   await page.getByRole('button',{name:'发送消息',exact:true}).click();progress('send clicked');await sent;await page.waitForFunction(()=>!document.querySelector<HTMLTextAreaElement>('textarea[aria-label="想聊的事"]')?.readOnly,{},{timeout:25000});progress('supplement submitted')
   await page.getByRole('textbox',{name:'想聊的事',exact:true}).waitFor()
   await page.screenshot({path:resolve(directory,'waiting-short-supplement.png'),fullPage:true})
   const continueButton=task.getByRole('button',{name:'继续这次比较',exact:true}),canContinue=await continueButton.count()>0
   writeFileSync(directory+'/WAITING_BROWSER_REPRO.json',JSON.stringify({status:canContinue?'RESUME_AVAILABLE':'FAIL',evidence:'REAL_CHROME_REAL_AUTH_REAL_HTTP_REAL_ISOLATED_PG_SIMULATED_PROVIDER',input:'这周六小时',before:'waiting_user',after:(await json('/api/workflows/'+taskId)).status,continueButtonPresent:canContinue,deepSDKCalls:wire.filter(x=>x.context.path||x.context.analyses||x.context.alternatives).length,ordinarySDKCalls:wire.filter(x=>x.context.currentUserMessage).length,errors},null,2)+'\n')
   assert.ok(canContinue,'short supplement stranded original waiting_user comparison: no continue action after 这周六小时')
   await continueButton.click();await task.getByRole('button',{name:'只采纳这个小行动',exact:true}).waitFor()
   const view=await wait(taskId);assert.equal(view.status,'proposed');assert.ok(view.question.includes('就业和考研'));assert.equal(view.receipt.providerCalls,4)
   const saved=(await pool.query('SELECT request_payload FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2',[user,taskId])).rows[0].request_payload
   assert.equal(saved.currentIntent,text);assert.equal(saved.budget.amountMinutes,360);assert.equal(saved.authorizedEvidenceRefs[0].id,initial.source_message_id);assert.equal(saved.authorizedEvidenceRefs.length>=2,true)
   const calls=wire.length;await page.reload({waitUntil:'networkidle'});await page.locator('[data-workflow-id="'+taskId+'"]').getByRole('button',{name:'只采纳这个小行动',exact:true}).waitFor();assert.equal(wire.length,calls)
   await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
   await page.screenshot({path:resolve(directory,'waiting-resumed-mobile.png'),fullPage:true});assert.deepEqual(errors,[])
   writeFileSync(directory+'/WAITING_BROWSER_GREEN.json',JSON.stringify({status:'PASS',evidence:'REAL_CHROME_REAL_AUTH_REAL_HTTP_REAL_ISOLATED_PG_SIMULATED_PROVIDER',version:await json('/api/run/version'),task:view,originalQuestionPreserved:true,timeMinutes:360,deepSDKCalls:4,ordinarySDKCalls:wire.filter(x=>x.context.currentUserMessage).length,refreshDuplicateCalls:wire.length-calls,viewportWidths:[1440,390],errors},null,2)+'\n')
  }finally{await browser.close()}
 }finally{progress('closing test resources');host.close();app.closeAllConnections();await new Promise<void>(done=>app.close(()=>done()));fake.closeAllConnections();await new Promise<void>(done=>fake.close(()=>done()));await localEmbedding.close();model.baseUrl=previous.url;config.apiKey=previous.key;config.origin=previous.origin;config.entitlementsEnabled=previous.access;if(previous.flag===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=previous.flag;await pool.end();progress('test resources closed')}
})
