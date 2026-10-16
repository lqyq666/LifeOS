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

test('selected predeclared student cases, six rounds and three sessions each; authenticated HTTP PG and scripted native SDK only',async()=>{
 const old={url:model.baseUrl,key:config.apiKey,origin:config.origin,access:config.entitlementsEnabled,flag:process.env.LIFEOS_ADVANCED_WORKFLOWS}
 const directory=process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/workflow-integration/evidence/local-time-20261010';mkdirSync(directory,{recursive:true})
 const trajectories=JSON.parse(readFileSync('tests/fixtures/workflow-student16.json','utf8')).students.filter((x:any)=>!process.env.LIFEOS_STUDENT_CASE_IDS||process.env.LIFEOS_STUDENT_CASE_IDS.split(',').includes(x.id))
 const read=(file:string)=>readFileSync('.planning/research/evergreen/'+file,'utf8').trim().split('\n').map(x=>JSON.parse(x))
 const cards=read('KB_GUIDES.jsonl'),wire:any[]=[],results:any[]=[],ui:any[]=[]
 let round:any,chain:any,event:any,card:any
 const fake=createServer((req,res)=>{const chunks:Buffer[]=[];req.on('data',x=>chunks.push(Buffer.from(x)));req.on('end',()=>{
  const input=JSON.parse(Buffer.concat(chunks).toString()),ctx=JSON.parse(input.messages[1].content),current=ctx.currentUserMessage
  const clauses=current.clauses??[],text=input.messages.at(-1).content
  wire.push({chain:chain.id,text,context:ctx,selection:'SCRIPTED_FIXTURE_NOT_MODEL_INFERENCE'})
  // The bounded path uses the exact host-supplied choices. This scripted
  // provider proves persistence and continuity, not an unconstrained model reply.
  const output:any={reply:ctx.boundedReply?.choices[0]??round.reply}
  if(!/只想说说/.test(text)){
   output.event={target:event?{operation:'continue',eventId:event.id,expectedRevision:event.revision}:{operation:'create',title:chain.title,source:{messageId:current.id,quote:text}},nodes:[{kind:'fact',source:{messageId:current.id,quote:text}}]}
   if(round.kinds)output.growthUpdates=round.kinds.map((kind:string,i:number)=>({target:{operation:'create'},assertion:'user_reported',kind,source:{clauseId:clauses[i]?.id},...(kind==='constraint'?{timeEvidence:{kind:'calendar_week',which:round.week,clauseId:clauses.find((c:any)=>/这周|本周|下周/.test(c.text))?.id}}:{}),...(kind==='feedback'?{progressState:round.progress}:{})}))
   if(round.experience)output.experienceCandidate={source:{clauseIds:clauses.filter((c:any)=>!c.text.includes('我更正')).map((c:any)=>c.id)}}
   if(round.plan)output.weeklyPlan={target:{operation:'create'},availableMinutes:round.plan.minutes,period:round.plan.period,budgetRef:{updateIndex:round.plan.budgetIndex},basis:[{updateIndex:round.plan.budgetIndex}],items:round.plan.actionMinutes?[{action:'用可访问的材料尝试一段课程练习，到时或遇阻就停。',minutes:round.plan.actionMinutes,directionScopes:[]}]:[]}
   const method=ctx.knowledge.find((k:any)=>k.id===card.id)
   if(!event&&method)output.citations=[{claimId:method.id}]
  }
  wire.at(-1).scriptedOutput=output
  res.writeHead(200,{'Content-Type':'text/event-stream'});const base={id:'SCRIPTED_LOCAL_'+wire.length,object:'chat.completion.chunk',created:1,model:model.id}
  res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:300,completion_tokens:100,total_tokens:400}})+'\n\ndata: [DONE]\n\n')
 })})
 await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-loopback-only';config.entitlementsEnabled=false;process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
 const app=createApp(createTurnEngine({capabilityVerified:()=>true}),30000)
 await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(app.address() as {port:number}).port;config.origin=origin
 assert.equal(new URL(model.baseUrl).hostname,'127.0.0.1')

 let cookie='',user=''
 const request=(path:string,body?:unknown,auth=cookie)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Cookie:auth,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
 const json=async(path:string,body?:unknown)=>{const res=await request(path,body),out=await res.json();assert.ok(res.ok,JSON.stringify({path,status:res.status,out}));return out}
 const persist=()=>writeFileSync(directory+'/STUDENT16_TRAJECTORIES.json',JSON.stringify({status:results.length===trajectories.length*6?'PASS_LOCAL_CONTRACT':'RUNNING_OR_FAILED',evidence:'REAL_AUTH_HTTP_PG_NATIVE_SDK_SCRIPTED_PROVIDER_NOT_REAL_QUALITY',paidCalls:0,cloudCalls:0,physicalPhone:false,results,ui,wire},null,2)+'\n')
 try{
  await localEmbedding.start();await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
  writeFileSync(directory+'/TRAJECTORY_PROCESS_VERSION.json',JSON.stringify(await json('/api/run/version'),null,2))
  let signupWindowStart=Date.now(),studentIndex=0
  for(chain of trajectories){
   if(studentIndex&&studentIndex%3===0){await new Promise(r=>setTimeout(r,Math.max(0,61000-(Date.now()-signupWindowStart))));signupWindowStart=Date.now()}
   studentIndex++
   event=null;card=cards.find((c:any)=>c.guide.canonicalKey===chain.guide)
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
    assert.ok(done,JSON.stringify({chain:chain.id,index,frames,wire:wire.slice(before)}));assert.ok(wire.length-before<=1,'ordinary round cannot hide a repair call')
    const run=await json('/api/runs/'+id);assert.equal(run.status,'completed')
    const savedReply=(await json('/api/conversations')).find((c:any)=>c.id===chat)?.messages.find((m:any)=>m.role==='assistant'&&m.run_request_id===id)?.content
    const expectedReply=wire.length>before?wire.at(-1).scriptedOutput.reply:round.reply
    if(round.plan?.minutes===0){
     assert.equal(wire.length,before,'zero-time scheduling must not dispatch the scripted provider')
     assert.equal(savedReply,'本周没有可用时间，先不安排任务；等可用时间改变后再调整。')
    }else if(round.plan?.minutes>0){
     const period=round.plan.period==='next_week'?'下周':'本周'
     assert.ok(savedReply?.includes(period+'建议安排（可用'+round.plan.minutes+'分钟；尚未采纳或执行）'),JSON.stringify({chain:chain.id,index,savedReply,expectedPeriod:period,expectedMinutes:round.plan.minutes}))
     assert.ok(savedReply?.includes('用可访问的材料尝试一段课程练习，到时或遇阻就停。'))
    }else assert.ok(savedReply?.includes(expectedReply),JSON.stringify({chain:chain.id,index,savedReply,expectedReply}))
    if(done.event)event=done.event
    const view=await json('/api/conversations/'+chat+'/event?id='+event.id)
    assert.equal(view.id,event.id);assert.equal(view.revision,event.revision)
    if(index===0)initialMethod=done.stateChange.guideUsage?.items?.some((x:any)=>x.guideId===card.id)??false
    if(chain.id==='freelance'&&index===0)assert.deepEqual(done.candidateIds,[],'a wish to clarify delivery scope is not a completed personal action')
    const facts=(await json('/api/growth?conversation='+chat)).items
    const used=await json('/api/conversations/'+chat+'/guide-usage?event='+event.id)
    if(round.expectNoGrowth)assert.equal(facts.length,0,'a mixed question cannot become an asserted personal goal')
    const state={technicalSaved:run.status==='completed',currentTaskCorrect:wire.length===before||wire.at(-1).text===round.text,sourceSupported:wire.length===before||/只想说说/.test(round.text)||view.nodes.some((n:any)=>n.source?.messageId===wire.at(-1).context.currentUserMessage.id&&round.text.includes(n.source.quote)),stateCorrect:view.id===event.id&&view.revision===event.revision&&(!round.expectGrowth||facts.some((f:any)=>round.text.includes(f.text)&&f.text.includes(round.expectGrowth))),userIntentRespected:round.text.includes('不想继续')?(!used.items.length||used.items[0]?.status==='declined'):true,nextSessionContinuity:index===0||wire.length===before||JSON.stringify(wire.at(-1).context).includes(event.id)}
    if(chain.id==='contact'&&index===3){assert.equal(view.actionStages.sent,true);assert.equal(view.actionStages.read,true);assert.equal(view.actionStages.replied,false);assert.equal(view.actionStages.used,false)}
    if(chain.id==='contact'&&index===4){assert.equal(view.actionStages.used,null);assert.equal(view.actionStages.replied,false)}
    if(chain.id==='startup'&&index===2){assert.equal(view.actionStages.used,false);assert.ok(view.nodes.some((n:any)=>n.content.includes('没有付费'))) }
    if(round.plan){const plans=(await pool.query('SELECT structured_plan AS payload FROM growth_items WHERE user_id=$1 AND structured_plan IS NOT NULL ORDER BY created_at DESC LIMIT 1',[user])).rows;assert.equal(plans.length,1);assert.equal(plans[0].payload.availableMinutes,round.plan.minutes);if(round.plan.minutes===0)assert.deepEqual(plans[0].payload.items,[])}
    if(chain.id==='course'&&index===1){assert.ok(facts.some((f:any)=>f.kind==='context'&&f.text.includes('每周能拿出六小时')));assert.ok(facts.some((f:any)=>f.kind==='constraint'&&f.text.includes('这周只剩两小时')))}
    if(chain.id==='freelance'&&index===5){assert.ok(JSON.stringify(wire.at(-1).context).includes('就业'));assert.ok(JSON.stringify(wire.at(-1).context).includes('海报'))}

    const toolAudit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0].tool_audit
    results.push({chain:chain.id,round:index+1,session:round.session+1,requestId:id,input:round.text,reply:savedReply,state,event:view,guideUsage:used,growth:facts,runResponse:run.response,skillExecutionAudit:toolAudit.filter((a:any)=>a.phase==='workflow_trace'),scriptedProviderCalls:wire.length-before,methodSupport:initialMethod?'APPROVED_HOST_GUIDE_USAGE':'EDITORIAL_NO_MATCHING_APPROVED_METHOD'})
    latestFacts=facts;persist();assert.ok(Object.values(state).every(Boolean),JSON.stringify({chain:chain.id,index,state,used}));await indexCoachEventOnce()
   }
   if(card.status!=='verified')assert.equal(initialMethod,false,'pending card cannot enter normal student retrieval')
   const cognition=await request('/api/cognition');const cognitionBody=await cognition.json();writeFileSync(directory+'/'+chain.id+'-COGNITION_READ.json',JSON.stringify({status:cognition.status,body:cognitionBody},null,2));assert.equal(cognition.status,200,JSON.stringify(cognitionBody))
   if(chain.id==='freelance')assert.ok(!cognitionBody.nodes.some((n:any)=>n.type==='value'&&/不再把自由职业作为主线/.test(n.title)),'ending a main path must not become a current pursuit')
   assert.deepEqual(errors,[]);persist()
   if(chain.id==='course'){
    const version=await json('/api/run/version'),executed=results.flatMap(r=>r.skillExecutionAudit).filter((a:any)=>a.agentRole==='skill'&&a.status==='succeeded')
    const allCoreIncluded=['contact','freelance','startup','course'].every(id=>trajectories.some((t:any)=>t.id===id))
    for(const name of allCoreIncluded?['lifeos-action-review','lifeos-guide-application','lifeos-growth-diff','lifeos-experience-evidence']:[]){
     const actual=executed.filter((a:any)=>a.skill===name);assert.ok(actual.length,'normal host never executed '+name)
     assert.ok(actual.every((a:any)=>a.skillDigest===version.skills.find((s:any)=>s.name===name).sha256&&a.skillVersion==='0.2.0-candidate'&&a.providerCalls===0))
    }
    writeFileSync(directory+'/SKILL_HOST_EXECUTIONS.json',JSON.stringify({status:allCoreIncluded?'PASS_LOCAL_CORE_FOUR_HOST':'OBSERVED_SELECTED_CASES_ONLY',selectedCases:trajectories.map((t:any)=>t.id),allCoreIncluded,provider:'SCRIPTED_LOOPBACK_ONLY',version,executed,committedRounds:results.map(r=>({requestId:r.requestId,state:r.state}))},null,2))
   }
  }
 }finally{persist();app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));fake.closeAllConnections();await new Promise<void>(r=>fake.close(()=>r()));await localEmbedding.close();model.baseUrl=old.url;config.apiKey=old.key;config.origin=old.origin;config.entitlementsEnabled=old.access;if(old.flag===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=old.flag;await pool.end()}
})
