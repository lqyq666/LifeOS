// Local isolated Compose smoke. Synthetic identity, no Provider generation.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'
const base='http://127.0.0.1:18887',origin='https://lifeos-isolated.example.invalid'
const identity={email:`container-${randomUUID()}@example.invalid`,name:'Synthetic container smoke',password:`Synthetic-${randomUUID()}`}
let cookie=''
async function request(path,data){
  const response=await fetch(base+path,{method:data?'POST':'GET',headers:{Origin:origin,Cookie:cookie,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined})
  assert.ok(response.ok,`HTTP ${response.status}: ${path}`)
  return {value:await response.json(),headers:response.headers}
}
function cli(script,args=[],input){
  const result=spawnSync('docker',['exec','-i','lifeos-v13-isolated-app-1','node','--import','tsx',script,...args],{input,encoding:'utf8'})
  assert.equal(result.status,0,`container CLI failed: ${script}`)
  return JSON.parse(result.stdout.trim())
}
const refused=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(identity)})
assert.equal(refused.status,400)
assert.equal((await refused.json()).code,'EMAIL_PASSWORD_SIGN_UP_DISABLED','public signup remains closed')
const invited=cli('scripts/manage-access.ts',['create'],JSON.stringify({...identity,limit:2,expiresAt:new Date(Date.now()+86400000).toISOString()}))
assert.equal(invited.access.remaining,2)
const login=await request('/api/auth/sign-in/email',{email:identity.email,password:identity.password})
cookie=login.headers.getSetCookie().map(item=>item.split(';')[0]).join('; ')
assert.ok(cookie)
const user=(await request('/api/session')).value.id,chat=randomUUID(),second=randomUUID()
assert.equal(user,invited.userId)
assert.equal(cli('scripts/manage-access.ts',['show',user]).access.remaining,2)
assert.equal(cli('scripts/manage-provider-budget.ts',['show','production']),null,'no implicit production funding')
const budget=cli('scripts/manage-provider-budget.ts',['set','container_smoke','0'])
assert.equal(Number(budget.limit_cny),0)
const guard=spawnSync('docker',['exec','-i','lifeos-v13-isolated-app-1','node','--import','tsx','--input-type=module'],{encoding:'utf8',input:`import assert from 'node:assert/strict';import {config} from './server/config.ts';import {pool} from './server/db.ts';import {reserveProviderSpend} from './server/provider-spend.ts';import {randomUUID} from 'node:crypto';try{assert.equal(config.production,true);assert.equal(config.providerBudgetEnabled,true);const input={user:${JSON.stringify(user)},requestId:randomUUID(),callIndex:0,provider:'bailian',model:'qwen3.8-flash',ceilingCny:0.01};await assert.rejects(reserveProviderSpend(input),e=>e.code==='PROVIDER_BUDGET_NOT_ENABLED');config.providerBudgetId='container_smoke';await assert.rejects(reserveProviderSpend(input),e=>e.code==='PROVIDER_BUDGET_EXHAUSTED');assert.equal(Number((await pool.query('SELECT count(*) FROM lifeos_provider_spend')).rows[0].count),0);console.log('PASS');}finally{await pool.end()}`})
assert.equal(guard.status,0,guard.stderr)
await request('/api/conversations',{id:chat,title:'Synthetic saved material'})
await request('/api/conversations',{id:second,title:'Synthetic cross conversation'})
await request('/api/memory/settings',{requestId:randomUUID(),enabled:true,expectedRevision:0})
const seed=`import {grantEntitlement} from './server/entitlements.ts';import {config} from './server/config.ts';import {pool} from './server/db.ts';import * as store from './server/store.ts';import {stageCoachEvent} from './server/action-coach-events.ts';import {randomUUID} from 'node:crypto';
if(config.origin!==${JSON.stringify(origin)}||new URL(config.databaseUrl).hostname!=='db'||!config.production)throw new Error('ISOLATED_CONTAINER_REQUIRED');
try{await grantEntitlement(${JSON.stringify(user)},2,new Date(Date.now()+86400000).toISOString());const text='我整理了考试资料并通过网盘发给同学，对方说手机打不开。';const material='你现在还需要哪部分考试资料？我可以先发一页给你确认。';const run=(await store.startRun(${JSON.stringify(user)},${JSON.stringify(chat)},randomUUID(),text)).run;const coach=await stageCoachEvent(run,{target:{operation:'create',title:'考试资料网盘交付',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}],action:{operation:'create',draft:{content:material}}},material);const response=await store.finishRun(run,{candidates:[],audit:[],coach},material,null,new AbortController().signal);console.log(JSON.stringify({eventId:response.event.id,actionId:response.event.actions[0].id,material}));}finally{await pool.end()}`
const seeded=spawnSync('docker',['exec','-i','lifeos-v13-isolated-app-1','node','--import','tsx','--input-type=module'],{input:seed,encoding:'utf8'})
assert.equal(seeded.status,0,seeded.stderr)
const expected=JSON.parse(seeded.stdout.trim())
const access=(await request('/api/access')).value
assert.equal(access.required,true);assert.equal(access.used,1);assert.equal(access.remaining,1)
let found
for(let attempt=0;attempt<100;attempt++){
  found=(await request(`/api/conversations/${second}/event/search`,{query:'上次通过网盘交给同学的考试材料'})).value
  if(found.events.some(event=>event.id===expected.eventId))break
  await new Promise(resolve=>setTimeout(resolve,100))
}
assert.ok(found.events.some(event=>event.id===expected.eventId),'real BGE cross-conversation retrieval')
const before=(await request(`/api/conversations/${chat}/event?id=${expected.eventId}`)).value
assert.equal(before.id,expected.eventId)
assert.equal(before.actions.find(action=>action.id===expected.actionId)?.draft.content,expected.material,'material returned by authenticated API equals committed action')
const restart=spawnSync('docker',['compose','--project-name','lifeos-v13-isolated','--env-file','.local/docker-embedding/compose.env','restart','app'],{encoding:'utf8'})
assert.equal(restart.status,0,restart.stderr)
for(let attempt=0;attempt<100;attempt++){
  try{const response=await fetch(base+'/api/ready');if(response.ok)break}catch{}
  await new Promise(resolve=>setTimeout(resolve,200))
}
assert.equal((await request('/api/session')).value.id,user,'session survives app restart')
const after=(await request(`/api/conversations/${chat}/event?id=${expected.eventId}`)).value
assert.deepEqual(after,before,'saved event and material survive app restart')
const latencies=[]
for(let round=0;round<10;round++)await Promise.all([0,1].map(async()=>{
  const start=performance.now()
  const result=(await request(`/api/conversations/${second}/event/search`,{query:'通过网盘发给同学的考试资料'})).value
  assert.ok(result.events.some(event=>event.id===expected.eventId))
  latencies.push(Math.round(performance.now()-start))
}))
latencies.sort((a,b)=>a-b)
const report={evidence:'REAL_DOCKER_HTTP_AUTH_POSTGRESQL_OFFLINE_BGE_SYNTHETIC_SEED_NO_PROVIDER',status:'PASS',checks:['secure-cookie issued and manually replayed over loopback only; TLS not tested','login identity','actual event and action committed without Provider','real semantic cross-conversation retrieval','app restart','session and material persisted','20 retrievals at concurrency 2'],retrievalOnly:{samples:latencies,concurrency:2,p50Ms:latencies[9],p95Ms:latencies[18],notProviderSpeedAcceptance:true},publicTlsVerified:false,providerCalls:0}
report.checks.push('public signup closed; actual container CLI creates invitation and reads access','actual budget CLI runs; unfunded and zero budget prevent reservations')
const image=spawnSync('docker',['inspect','--format','{{.Image}}','lifeos-v13-isolated-app-1'],{encoding:'utf8'})
assert.equal(image.status,0)
report.imageId=image.stdout.trim()
writeFileSync(`evidence/v1.3-action-coach/container-smoke-${Date.now()}.json`,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))
