import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {createRequire} from 'node:module'
import {pool} from '../../server/db.ts'
import {config} from '../../server/config.ts'
import {model} from '../../server/model.ts'
import {createApp} from '../../server/http.ts'
import {createTurnEngine} from '../../server/agent.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {indexCoachEventOnce} from '../../server/coach-retrieval.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {requestedQuestionEditClauses} from '../../server/turn-contract.ts'

test('four continuous trajectories, three sessions each, normal authenticated HTTP and Chrome; loopback scripted provider only',async()=>{
 const old={url:model.baseUrl,key:config.apiKey,origin:config.origin,access:config.entitlementsEnabled,flag:process.env.LIFEOS_ADVANCED_WORKFLOWS}
 const directory=process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/workflow-integration/evidence/local-time-20261010';mkdirSync(directory,{recursive:true})
 const trajectories=JSON.parse(readFileSync('tests/fixtures/workflow-local-trajectories.json','utf8'))
 const read=(file:string)=>readFileSync('.planning/research/evergreen/'+file,'utf8').trim().split('\n').map(x=>JSON.parse(x))
 const cards=read('KB_GUIDES.jsonl'),wire:any[]=[],results:any[]=[],ui:any[]=[],adaptationProbes:any[]=[]
 let round:any,chain:any,event:any,card:any
 const clauseScore=(kind:string,text:string):number=>{
  if(kind==='direction')return /改变方向|转向|主线/.test(text)?20:0
  if(kind==='goal')return /我想|想(?:向|做|探索)|我决定|优先|重新判断|目标/.test(text)?20:0
  if(kind==='preference')return /愿意|不再|改成|改为|选择|偏好/.test(text)?20:0
  if(kind==='constraint')return /(?:这周|本周|下周).*(?:只剩|只有|有|可用|零小时)|只剩.*可用/.test(text)?30:/材料打不开/.test(text)?20:0
  if(kind==='feedback')return /没有开始|已经尝试|卡住|完成|结果|反馈/.test(text)?20:0
  return 0
 }
 const bindKindsToClauses=(kinds:string[],clauses:any[])=>{const available=clauses.map((clause:any,index:number)=>({clause,index}));return kinds.map(kind=>{available.sort((a,b)=>clauseScore(kind,b.clause.text)-clauseScore(kind,a.clause.text)||a.index-b.index);const chosen=available.shift();assert.ok(chosen,`no current clause available for ${kind}`);return {kind,clause:chosen.clause}})}
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',x=>chunks.push(Buffer.from(x)));req.on('end',()=>{
  const input=JSON.parse(Buffer.concat(chunks).toString()),ctx=JSON.parse(input.messages[1].content),current=ctx.currentUserMessage
  const clauses=current.clauses??[],text=input.messages.at(-1).content.split('\n\n本轮来源边界')[0]
  wire.push({chain:chain.id,text,context:ctx,eventAllowed:Boolean(input.response_format.json_schema.schema.properties.event),selection:'SCRIPTED_FIXTURE_NOT_MODEL_INFERENCE'})
  const choices=input.response_format?.json_schema?.schema?.properties?.reply?.enum
  const output:any={reply:choices?.[0]??round.reply};wire.at(-1).selectedReply=output.reply
  if(input.response_format.json_schema.schema.properties.event&&!/只想说说/.test(text)){
   output.event={target:event?{operation:'continue',eventId:event.id,expectedRevision:event.revision}:{operation:'create',title:chain.title,source:{messageId:current.id,quote:text}},nodes:[{kind:'fact',source:{messageId:current.id,quote:text}}]}
    if(round.kinds)output.growthUpdates=bindKindsToClauses(round.kinds,clauses).map(({kind,clause})=>({target:{operation:'create'},assertion:'user_reported',kind,source:{clauseId:clause.id},...(kind==='constraint'?{timeEvidence:{kind:'calendar_week',which:round.week,clauseId:clauses.find((c:any)=>/这周|本周|下周/.test(c.text))?.id}}:{}),...(kind==='feedback'?{progressState:round.progress}:{})}))
   if(round.experience)output.experienceCandidate={source:{clauseIds:clauses.filter((c:any)=>!c.text.includes('我更正')).map((c:any)=>c.id)}}
   if(round.plan)output.weeklyPlan={target:{operation:'create'},availableMinutes:round.plan.minutes,period:round.plan.period,budgetRef:{updateIndex:round.plan.budgetIndex},basis:[{updateIndex:round.plan.budgetIndex}],items:round.plan.actionMinutes?[{action:'用可访问的材料尝试一段课程练习，到时或遇阻就停。',minutes:round.plan.actionMinutes,directionScopes:[]}]:[]}
   const method=(ctx.methodContext??ctx.knowledge??[]).find((k:any)=>k.id===card.id)
   if(!event&&method)output.citations=[{claimId:method.id}]
  }
  res.writeHead(200,{'Content-Type':'text/event-stream'});const base={id:'SCRIPTED_LOCAL_'+wire.length,object:'chat.completion.chunk',created:1,model:model.id}
  res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:300,completion_tokens:100,total_tokens:400}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-loopback-only';config.entitlementsEnabled=false;process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
 const app=createApp(createTurnEngine({capabilityVerified:()=>true}),30000)
 await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(app.address() as {port:number}).port;config.origin=origin
 assert.equal(new URL(model.baseUrl).hostname,'127.0.0.1')
 const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
 const browser=await chromium.launch({channel:'chrome',headless:true})
 let cookie='',user=''
 const request=(path:string,body?:unknown,auth=cookie)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:auth,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
 const json=async(path:string,body?:unknown)=>{const res=await request(path,body),out=await res.json();assert.ok(res.ok,JSON.stringify({path,status:res.status,out}));return out}
 const persist=()=>writeFileSync(directory+'/FOUR_TRAJECTORIES.json',JSON.stringify({status:results.length===24&&ui.length===24&&ui.every(x=>!x.errors.length)&&adaptationProbes.length===1?'PASS_LOCAL_CONTRACT':'RUNNING_OR_FAILED',evidence:'REAL_AUTH_HTTP_PG_CHROME_NATIVE_SDK_SCRIPTED_PROVIDER',paidCalls:0,cloudCalls:0,physicalPhone:false,results,adaptationProbes,ui,wire},null,2)+'\n')
 try{
  await localEmbedding.start();await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
  writeFileSync(directory+'/TRAJECTORY_PROCESS_VERSION.json',JSON.stringify(await json('/api/run/version'),null,2))
  const signupWindowStart=Date.now()
  for(chain of trajectories){
   if(chain.id==='course')await new Promise(r=>setTimeout(r,Math.max(0,61000-(Date.now()-signupWindowStart))))
   event=null;card=cards.find((c:any)=>c.guide.canonicalKey===chain.guide);assert.equal(card.guide.reviewStatus,'approved')
   const signup=await request('/api/auth/sign-up/email',{email:'trajectory-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID(),name:'Synthetic adult'})
   assert.equal(signup.status,200);cookie=signup.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');user=(await json('/api/session')).id
   await json('/api/memory/settings',{requestId:randomUUID(),enabled:true,expectedRevision:0})
   const chats=[randomUUID(),randomUUID(),randomUUID()];for(const id of chats)await json('/api/conversations',{id,title:'SYNTHETIC '+chain.title})
   const errors:string[]=[]
   let latestFacts:any[]=[],initialMethod=false
   for(const [index,spec] of chain.rounds.entries()){
    round=spec;const chat=chats[round.session],id=randomUUID(),before=wire.length
    const res=await request('/api/conversations/'+chat+'/messages',{requestId:id,text:round.text});assert.equal(res.status,200)
    const frames=(await res.text()).split('\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6))),done=frames.find(x=>x.type==='done')
    assert.ok(done,JSON.stringify({chain:chain.id,index,frames,wire:wire.slice(before)}));assert.equal(wire.length-before,done.usage?.llmCallCount??0,'dispatch count matches the real receipt');assert.ok(wire.length-before<=1,'no hidden repair call')
    const run=await json('/api/runs/'+id);assert.equal(run.status,'completed')
    const sourceMessage=(await pool.query("SELECT id,content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='user'",[user,id])).rows[0]
    const savedReply=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,id])).rows[0]?.content
    assert.ok(savedReply?.trim(),'complete authoritative assistant message committed');if(wire.length>before&&wire.at(-1).context.boundedReply)assert.ok(wire.at(-1).context.boundedReply.choices.some((choice:string)=>savedReply.includes(choice)),'host-owned selected reply is preserved')
    if(done.event)event=done.event
    const view=await json('/api/conversations/'+chat+'/event?id='+event.id)
    assert.equal(view.id,event.id);assert.equal(view.revision,event.revision)
    if(index===0)initialMethod=done.stateChange.guideUsage?.items?.some((x:any)=>x.guideId===card.id)??false
    if(chain.id==='freelance'&&index===0)assert.deepEqual(done.candidateIds,[],'a wish to clarify delivery scope is not a completed personal action')
    const facts=(await json('/api/growth?conversation='+chat)).items
    const used=await json('/api/conversations/'+chat+'/guide-usage?event='+event.id)
    const currentSourceFacts=facts.filter((fact:any)=>fact.sources?.some((source:any)=>source.type==='message'&&source.id===sourceMessage.id&&round.text.includes(source.quote)))
    const currentDirectionControls=(await pool.query("SELECT scope,state,source_message_id,source_conversation_id,source_quote,origin_request_id FROM growth_direction_controls WHERE user_id=$1 AND origin_request_id=$2 AND source_message_id=$3",[user,id,sourceMessage.id])).rows.filter((control:any)=>control.source_conversation_id===chat&&round.text.includes(control.source_quote))
    const methodEditEvidence=currentSourceFacts.some((fact:any)=>fact.kind==='context'&&requestedQuestionEditClauses(fact.text).length>0)
    const remainingSpecializedKinds=new Set(currentDirectionControls.length?['direction','preference']:[]);if(methodEditEvidence)remainingSpecializedKinds.add('goal')
    const remainingFacts=[...currentSourceFacts],expectedKindsCovered=(round.kinds??[]).every((kind:string)=>{const at=remainingFacts.findIndex((fact:any)=>fact.kind===kind);if(at>=0){remainingFacts.splice(at,1);return true}if(remainingSpecializedKinds.has(kind)){remainingSpecializedKinds.delete(kind);return true}return false})
    const experienceCount=(await pool.query('SELECT count(*)::int AS n FROM experiences WHERE user_id=$1 AND source_message_id=$2',[user,sourceMessage.id])).rows[0].n
    const experienceRevisionCount=(await pool.query("SELECT count(*)::int AS n FROM experience_revisions WHERE user_id=$1 AND (snapshot->>'fromMessageId'=$2 OR snapshot#>>'{resultSource,messageId}'=$2 OR snapshot#>>'{source,sourceMessageId}'=$2)",[user,sourceMessage.id])).rows[0].n
    const currentExperienceEvidence=experienceCount>0||experienceRevisionCount>0
    const guideUsageCount=(await pool.query('SELECT count(*)::int AS n FROM kb_guide_usage WHERE user_id=$1 AND source_message_id=$2',[user,sourceMessage.id])).rows[0].n
    const pendingControl=(await pool.query("SELECT request_id,conversation_id,source_message_id,kind,status,clause_text,candidates FROM growth_control_requests WHERE user_id=$1 AND request_id=$2",[user,id])).rows[0]
    const stoppedRecommendation=(await pool.query("SELECT origin_request_id,source_conversation_id,source_message_id,state,source_quote FROM growth_recommendation_controls WHERE user_id=$1 AND origin_request_id=$2 AND source_message_id=$3",[user,id,sourceMessage.id])).rows[0]
    const pendingControlEvidence=Boolean(pendingControl&&pendingControl.request_id===id&&pendingControl.conversation_id===chat&&pendingControl.source_message_id===sourceMessage.id&&pendingControl.kind==='stop_recommend'&&pendingControl.status==='pending'&&round.text.includes(pendingControl.clause_text)&&Array.isArray(pendingControl.candidates)&&pendingControl.candidates.length>0)
    const stoppedRecommendationEvidence=Boolean(stoppedRecommendation&&stoppedRecommendation.origin_request_id===id&&stoppedRecommendation.source_conversation_id===chat&&stoppedRecommendation.source_message_id===sourceMessage.id&&stoppedRecommendation.state==='stopped'&&round.text.includes(stoppedRecommendation.source_quote))
    const currentControlEvidence=pendingControlEvidence||stoppedRecommendationEvidence
    const currentEventEvidence=view.nodes.some((node:any)=>node.source?.messageId===sourceMessage.id&&round.text.includes(node.source.quote))
    const currentStateEvidence=currentSourceFacts.length>0||currentExperienceEvidence||guideUsageCount>0||currentEventEvidence||currentControlEvidence||currentDirectionControls.length>0
    const expectsState=Boolean(round.kinds?.length||round.experience||/我愿意试|不想继续|我更正|零小时/.test(round.text))
    let planCorrect=true
    if(round.plan){const plans=(await pool.query('SELECT structured_plan AS payload FROM growth_items WHERE user_id=$1 AND origin_request_id=$2 AND conversation_id=$3 AND structured_plan IS NOT NULL',[user,id,chat])).rows;planCorrect=plans.length===1&&plans[0].payload.availableMinutes===round.plan.minutes&&(round.plan.minutes!==0||plans[0].payload.items.length===0)}
    const providerContextCorrect=wire.length===before||wire.at(-1).text===round.text
    const providerSourceCorrect=wire.length===before||!wire.at(-1).eventAllowed||/只想说说/.test(round.text)||currentEventEvidence
    const state={technicalSaved:run.status==='completed',currentTaskCorrect:sourceMessage.content===round.text&&providerContextCorrect,sourceSupported:providerSourceCorrect&&(!expectsState||currentStateEvidence),stateCorrect:expectedKindsCovered&&(!round.experience||currentExperienceEvidence)&&planCorrect,userIntentRespected:round.text.includes('不想继续')?currentControlEvidence&&used.items.every((item:any)=>item.status==='declined'):true,nextSessionContinuity:index===0||(wire.length>before?JSON.stringify(wire.at(-1).context).includes(event.id):view.id===event.id&&(!expectsState||currentStateEvidence))}
    if(chain.id==='contact'&&index===3){assert.equal(view.actionStages.sent,null);assert.equal(view.actionStages.read,true);assert.equal(view.actionStages.replied,false);assert.equal(view.actionStages.used,false);assert.ok(view.actionProgressReports.some((r:any)=>r.stages.sent===true));assert.ok(view.actionProgressReports.some((r:any)=>r.stages.read===true));assert.equal(view.actionStageScope.basis,'latest_source_report_only')}
    if(chain.id==='contact'&&index===4){assert.equal(view.actionStages.used,null);assert.equal(view.actionStages.replied,null);assert.equal(view.actionProgressReports.filter((r:any)=>r.evidence.replied).at(-1).stages.replied,false)}
    if(chain.id==='startup'&&index===2){assert.equal(view.actionStages.used,false);assert.ok(view.nodes.some((n:any)=>n.content.includes('没有付费'))) }
    if(round.plan)assert.equal(planCorrect,true,'the current round plan must be persisted with its own budget')
    if(chain.id==='course'&&index===1){assert.ok(facts.some((f:any)=>f.kind==='context'&&f.text.includes('每周能拿出六小时')));assert.ok(facts.some((f:any)=>f.kind==='constraint'&&f.text.includes('这周只剩两小时')))}
    if(chain.id==='freelance'&&index===5){assert.ok(JSON.stringify(wire.at(-1).context).includes('就业'));assert.ok(JSON.stringify(wire.at(-1).context).includes('海报'))}
    const toolAudit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0].tool_audit
    assert.ok(Object.values(state).every(Boolean),JSON.stringify({chain:chain.id,index,state,used,currentSourceFacts,currentDirectionControls,experienceCount,experienceRevisionCount,currentExperienceEvidence,guideUsageCount,pendingControl,stoppedRecommendation,eventStatus:view.status,actionStatuses:view.actions?.map((action:any)=>action.status),candidateIds:done.candidateIds,mergedExperienceIds:done.mergedExperienceIds,stateChange:done.stateChange,candidateAudit:toolAudit.filter((entry:any)=>/candidate|contribution/.test(entry.phase))}))
    results.push({chain:chain.id,round:index+1,session:round.session+1,requestId:id,input:round.text,reply:savedReply,state,event:view,guideUsage:used,growth:facts,runResponse:run.response,skillExecutionAudit:toolAudit.filter((a:any)=>a.phase==='workflow_trace'),scriptedProviderCalls:wire.length-before,methodSupport:initialMethod?'APPROVED_HOST_GUIDE_USAGE':'EDITORIAL_NO_MATCHING_APPROVED_METHOD'})
    latestFacts=facts;persist();await indexCoachEventOnce()
   }
   if(chain.id==='startup'){
    const probeChat=randomUUID(),probeId=randomUUID(),probeText='我想继续上次访谈，接下来应该怎么问？',before=wire.length
    event=null
    await json('/api/conversations',{id:probeChat,title:'SYNTHETIC feedback adaptation readback'})
    const probeResponse=await request('/api/conversations/'+probeChat+'/messages',{requestId:probeId,text:probeText});assert.equal(probeResponse.status,200)
    const frames=(await probeResponse.text()).split('\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6))),done=frames.find(x=>x.type==='done');assert.ok(done)
    const probeRun=await json('/api/runs/'+probeId);assert.equal(probeRun.status,'completed')
    const probeReply=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,probeId])).rows[0]?.content,probeAudit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,probeId])).rows[0]?.tool_audit,probeRoutes=probeAudit?.filter((entry:any)=>entry.phase==='edited_interview_route');assert.ok(probeReply?.includes('上一次遇到什么困难'),JSON.stringify({reason:'the next related session must use the user-selected interview question, not merely retain it',probeReply,route:probeRoutes,wire:wire.slice(before)}));assert.ok(probeRoutes?.every((entry:any)=>!('selectedQuestion'in entry)&&typeof entry.selectedSourceId==='string'),'durable audit keeps source identity, not a second unsuppressible copy of personal text')
    adaptationProbes.push({chain:chain.id,requestId:probeId,input:probeText,reply:probeReply,scriptedProviderCalls:wire.length-before,assertion:'cross-session reply applies the changed interview question'})
   }
   if(initialMethod)assert.equal(card.status,'verified');else{const first=results.find(row=>row.chain===chain.id&&row.round===1);assert.equal(first.runResponse.stateChange.guideUsage.status,'not_requested','ordinary chat does not advertise an unrequested method citation');assert.deepEqual(first.guideUsage.items,[])}
   const cognition=await request('/api/cognition');const cognitionBody=await cognition.json();writeFileSync(directory+'/'+chain.id+'-COGNITION_READ.json',JSON.stringify({status:cognition.status,body:cognitionBody},null,2));assert.equal(cognition.status,200,JSON.stringify(cognitionBody))
   if(chain.id==='freelance')assert.ok(!cognitionBody.nodes.some((n:any)=>n.type==='value'&&/不再把自由职业作为主线/.test(n.title)),'ending a main path must not become a current pursuit')
   for(const session of [0,1,2]){
    const sessionContext=await browser.newContext({viewport:{width:1440,height:900}})
    await sessionContext.addCookies(cookie.split('; ').map(part=>{const at=part.indexOf('=');return {name:part.slice(0,at),value:part.slice(at+1),url:origin}}))
    await sessionContext.addInitScript((id:string)=>sessionStorage.setItem('lifeos:pending-conversation',id),chats[session])
    await sessionContext.route('**/*',(route:any)=>route.request().url().startsWith(origin)?route.continue():route.abort())
    const page=await sessionContext.newPage();page.on('pageerror',(e:any)=>errors.push(e.message))
    await page.goto(origin+'/#conversation',{waitUntil:'networkidle'});try{await page.locator('dialog.qa-page[open]').waitFor({timeout:10000})}catch(e){await page.screenshot({path:resolve(directory,'trajectory-ui-failure.png'),fullPage:true});writeFileSync(directory+'/TRAJECTORY_UI_FAILURE.json',JSON.stringify({chain:chain.id,session,errors,body:await page.locator('body').innerText()},null,2));throw e}
    const lastRound=chain.rounds.map((r:any,index:number)=>({r,index})).filter(({r}:any)=>r.session===session).at(-1)!
    const text=results.find(row=>row.chain===chain.id&&row.round===lastRound.index+1).reply
    await page.getByText(text.split('\n')[0],{exact:false}).first().waitFor()
    for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);const file=chain.id+'-session'+(session+1)+'-'+width+'.png';await page.screenshot({path:resolve(directory,file),fullPage:true});ui.push({chain:chain.id,session:session+1,width,file,errors:[...errors]})}
    await sessionContext.close()
   }
   assert.deepEqual(errors,[]);assert.ok(latestFacts.length);persist()
   if(chain.id==='freelance'&&process.env.LIFEOS_RECORD_DEMO==='true')await (await import('../../scripts/workflow-record-demo.ts')).recordLocalStory({browser,origin,cookie,chats,directory})
   if(chain.id==='course'){
    const version=await json('/api/run/version'),executed=results.flatMap(r=>r.skillExecutionAudit).filter((a:any)=>a.agentRole==='skill'&&a.status==='succeeded')
    const guideRequested=results.some(row=>row.guideUsage.items.length>0)
    for(const name of ['lifeos-action-review',...(guideRequested?['lifeos-guide-application']:[]),'lifeos-growth-diff','lifeos-experience-evidence']){
     const actual=executed.filter((a:any)=>a.skill===name);assert.ok(actual.length,'normal host never executed '+name)
     assert.ok(actual.every((a:any)=>a.skillDigest===version.skills.find((s:any)=>s.name===name).sha256&&a.skillVersion==='0.2.0-candidate'&&a.providerCalls===0))
    }
    writeFileSync(directory+'/SKILL_HOST_EXECUTIONS.json',JSON.stringify({status:'PASS_LOCAL_HOST',guideScope:guideRequested?'REQUESTED':'NOT_REQUESTED_SEPARATE_GUIDE_SUITE_REQUIRED',provider:'SCRIPTED_LOOPBACK_ONLY',version,executed,committedRounds:results.map(r=>({requestId:r.requestId,state:r.state}))},null,2))
   }
  }
 }finally{persist();await browser.close();app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()));await localEmbedding.close();model.baseUrl=old.url;config.apiKey=old.key;config.origin=old.origin;config.entitlementsEnabled=old.access;if(old.flag===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=old.flag;await pool.end()}
})
