import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync,unlinkSync,renameSync} from 'node:fs'
import {resolve} from 'node:path'
import net from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import {grantEntitlement} from '../../server/entitlements.ts'

test('R-release 46s real nginx cutover preserves incremental SSE, final save, session and one entitlement', {timeout:110000,skip:process.env.LIFEOS_RESIDUAL_ROLLING_ACCEPTANCE!=='true'},async()=>{
 const suffix=randomUUID().slice(0,8),network='lifeos-r6-'+suffix,old='lifeos-r6-old-'+suffix,newer='lifeos-r6-new-'+suffix,proxy='lifeos-r6-nginx-'+suffix
 const out=resolve(process.env.LIFEOS_ROLLING_EVIDENCE_ROOT??'.local/residual-six-fixes-20261026','nginx-'+suffix);mkdirSync(out,{recursive:true})
 const envFile=resolve(out,'synthetic.env'),conf=resolve(out,'nginx.conf'),candidate=process.env.LIFEOS_RESIDUAL_CANDIDATE_IMAGE??''
 assert.match(candidate,/^sha256:[a-f0-9]{64}$/)
 const baseline=process.env.LIFEOS_ROLLING_BASELINE_IMAGE??'sha256:8547b53c9f3285731d312d83cd7cbfefc181c103daff1f98e80cccca3cab3f43'
 assert.match(baseline,/^sha256:[a-f0-9]{64}$/)
 const rollback=process.env.LIFEOS_ROLLING_ROLLBACK_IMAGE
 if(rollback)assert.match(rollback,/^sha256:[a-f0-9]{64}$/)
 const hotSchema=process.env.LIFEOS_ROLLING_HOT_SCHEMA==='true'
 if(hotSchema)assert.ok(rollback,'expanding a live schema requires a compatible cold fallback')
 // Old releases snapshot all bundled tests on startup. Replace only that
 // bundled path with synthetic text; never read or mount the protected file.
 const protectedStub=resolve(out,'synthetic-protected-placeholder.txt');writeFileSync(protectedStub,'synthetic placeholder, no protected source\n')
 const report:any={scope:'LOCAL_REAL_NGINX_BASELINE_AND_CANDIDATE_SYNTHETIC_ENGINE',baselineImage:baseline,candidateImage:candidate,providerCalls:0,primaryDatabaseModified:false,bundledProtectedSourceMaskedWithSyntheticPlaceholder:true}
 const docker=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:25000}).trim()
 const allocator=net.createServer();await new Promise<void>(resolve=>allocator.listen(0,'127.0.0.1',resolve));const port=(allocator.address() as {port:number}).port;await new Promise<void>(resolve=>allocator.close(()=>resolve()))
 const origin='http://127.0.0.1:'+port,db=new URL(config.databaseUrl);assert.match(db.pathname,/^\/lifeos_dialogue_test_/);db.hostname='host.docker.internal'
 writeFileSync(envFile,['NODE_ENV=production','DATABASE_URL='+db.href,'BETTER_AUTH_SECRET=synthetic-residual-rolling-secret-20261026','LIFEOS_ORIGIN='+origin,'LIFEOS_SIGNUP_ENABLED=true','LIFEOS_ENTITLEMENTS_ENABLED=true','LIFEOS_PROVIDER_BUDGET_ENABLED=false','LIFEOS_MODEL_DEFAULT_API_KEY=synthetic-no-provider-dispatch'].join('\n'))
 const route=(name:string)=>{writeFileSync(conf+'.next',`events {}\nhttp { server { listen 80; location / { proxy_pass http://${name}:8787; proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_buffering off; proxy_read_timeout 90s; } } }\n`);renameSync(conf+'.next',conf)}
 const wait=async(check:()=>Promise<boolean>,timeout=20000)=>{const start=Date.now();while(!await check()){if(Date.now()-start>timeout)throw new Error('SYNTHETIC_ROLLING_CONDITION_TIMEOUT');await delay(100)}}
 let cookie='',user='',body='',routeAt=0,firstDraftAt=0,lastDraftAt=0,readError:unknown
 const post=(path:string,value:unknown)=>fetch(origin+path,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-LifeOS-Draft-Deltas':'1'},body:JSON.stringify(value)})
 const readLedger=async()=>(await pool.query('SELECT name,sha256 FROM lifeos_schema_migrations ORDER BY name')).rows
 const migrate=(image:string)=>docker(['run','--rm','--network',network,'--env-file',envFile,'--entrypoint','node',image,'--import','tsx','scripts/migrate-db.ts'])
 const verifyRollbackSchema=()=>{
  if(!rollback)return
  assert.equal(docker(['image','inspect','--format','{{.Id}}',rollback]),rollback)
  const checkSchema="import {pool} from './server/db.ts'; import {verifySchema} from './server/schema.ts'; const c=await pool.connect(); try{await verifySchema(c); console.log('SCHEMA_COMPATIBLE')}finally{c.release();await pool.end()}"
  const check=(image:string)=>docker(['run','--rm','--network',network,'--env-file',envFile,'--entrypoint','node',image,'--import','tsx','--input-type=module','-e',checkSchema])
  assert.throws(()=>check(baseline),/SCHEMA_NEWER_THAN_RELEASE/, 'the original immutable image cannot cold start after the append')
  assert.equal(check(rollback),'SCHEMA_COMPATIBLE','the cold fallback runs the previous app with the exact expanded schema')
  assert.equal(check(candidate),'SCHEMA_COMPATIBLE')
  report.rollbackSchema={image:rollback,priorImageRejectedExpandedLedger:true,candidateAndFallbackVerified:true}
 }
 try{
  assert.equal(docker(['image','inspect','--format','{{.Id}}',baseline]),baseline);assert.equal(docker(['image','inspect','--format','{{.Id}}',candidate]),candidate)
  docker(['network','create',network])
  const before=hotSchema?await (async()=>{
   assert.match(migrate(baseline),/Database schema verified/)
   const ledger=await readLedger();assert.equal(ledger.length,40);assert.match(ledger.at(-1)!.name,/^040-/)
   return ledger
  })():null
  if(!before)verifyRollbackSchema()
  const start=(name:string,image:string,instance:string)=>docker(['run','-d','--name',name,'--network',network,'--env-file',envFile,'-e','SYNTHETIC_INSTANCE='+instance,'--mount','type=bind,source='+resolve('tests/fixtures/rolling-http-instance.mts')+',target=/app/residual-rolling-instance.mts,readonly','--mount','type=bind,source='+protectedStub+',target=/app/tests/backend/action-coach-engine.test.ts,readonly','--memory','256m','--cpus','1','--entrypoint','node',image,'--import','tsx','/app/residual-rolling-instance.mts'])
  start(old,baseline,'baseline');await wait(async()=>docker(['logs',old]).includes('SYNTHETIC_READY'))
  route(old);docker(['run','-d','--name',proxy,'--network',network,'--mount','type=bind,source='+out+',target=/etc/nginx/rolling,readonly','-p','127.0.0.1:'+port+':80','--entrypoint','nginx','nginx:alpine','-c','/etc/nginx/rolling/nginx.conf','-g','daemon off;'])
  await wait(async()=>{try{return (await fetch(origin+'/api/access-policy')).status===200}catch{return false}})
  const signup=await post('/api/auth/sign-up/email',{email:randomUUID()+'@example.invalid',name:'Synthetic residual adult',password:'Synthetic-nginx-123456'});assert.equal(signup.status,200)
  cookie=signup.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  user=(await (await fetch(origin+'/api/session',{headers:{Cookie:cookie}})).json()).id;await grantEntitlement(user,10,new Date(Date.now()+86400000).toISOString())
  const chat=randomUUID(),id=randomUUID(),text='合成46秒持续流验证，保留完整最后一句。'
  await post('/api/conversations',{id:chat,title:'SYNTHETIC current baseline cutover'})
  const started=Date.now(),stream=await post('/api/conversations/'+chat+'/messages',{requestId:id,text});assert.equal(stream.status,200)
  const reader=stream.body!.getReader(),decoder=new TextDecoder()
  const reading=(async()=>{for(;;){const chunk=await reader.read();if(chunk.done)break;const piece=decoder.decode(chunk.value,{stream:true});body+=piece;if(piece.includes('"type":"draft"')){firstDraftAt||=Date.now();lastDraftAt=Date.now()}}})().catch(error=>{readError=error})
  await wait(async()=>firstDraftAt>0)
  if(before){
   const originalPid=docker(['inspect','--format','{{.State.Pid}}',old]),expansionStarted=Date.now()
   assert.match(migrate(candidate),/Database schema verified/)
   const after=await readLedger()
   assert.deepEqual(after.slice(0,before.length),before,'applied migration checksums remain unchanged')
   const appended=after.slice(before.length).map(row=>row.name)
   assert.deepEqual(appended.map(name=>name.slice(0,3)),['041','042','043','044'])
   assert.equal(docker(['inspect','--format','{{.State.Pid}}',old]),originalPid)
   assert.equal((await pool.query('SELECT status FROM runs WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0].status,'running')
   report.liveExpansion={from:before.length,to:after.length,appended,durationMs:Date.now()-expansionStarted,oldProcessUnchanged:true,requestRunningAfterMigration:true}
  }
  start(newer,candidate,'candidate');await wait(async()=>docker(['logs',newer]).includes('SYNTHETIC_READY'))
  assert.equal((await pool.query('SELECT status FROM runs WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0].status,'running')
  route(newer);docker(['exec',proxy,'nginx','-t','-c','/etc/nginx/rolling/nginx.conf']);docker(['exec',proxy,'nginx','-s','reload','-c','/etc/nginx/rolling/nginx.conf']);routeAt=Date.now()
  await wait(async()=>{try{const r=await fetch(origin+'/api/session',{headers:{Cookie:cookie,Connection:'close'}});return r.headers.get('x-lifeos-synthetic-instance')==='candidate'&&(await r.json()).id===user}catch{return false}})
  assert.equal((await fetch(origin+'/api/runs/'+id,{headers:{Cookie:cookie}})).status,200)
  docker(['kill','--signal','SIGTERM',old]);await delay(200);assert.equal(docker(['inspect','--format','{{.State.Running}}',old]),'true','drain keeps the old stream alive')
  await reading
  if(readError)throw readError
  report.durationMs=Date.now()-started;report.requestId=id
  assert.ok(report.durationMs>=45000);assert.ok(firstDraftAt<routeAt&&lastDraftAt>routeAt)
  assert.equal((body.match(/"type":"done"/g)??[]).length,1);assert.doesNotMatch(body,/SERVER_RESTARTED|SERVER_SHUTTING_DOWN|draft_discarded/)
  const saved=(await pool.query("SELECT content FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,id])).rows
  assert.equal(saved.length,1);assert.equal(saved[0].content,'SYNTHETIC 46秒完整正文：'+'每个片段与最后一句均完整保存。'.repeat(60));assert.ok(body.includes(saved[0].content))
  const replay=await post('/api/conversations/'+chat+'/messages',{requestId:id,text});assert.match(await replay.text(),/"replayed":true/)
  assert.equal((docker(['logs',old]).match(/SYNTHETIC_DISPATCH/g)??[]).length,1)
  assert.equal((docker(['logs',newer]).match(/SYNTHETIC_DISPATCH/g)??[]).length,0)
  assert.equal((await pool.query('SELECT used_turns FROM lifeos_entitlements WHERE user_id=$1',[user])).rows[0].used_turns,1)
  await wait(async()=>docker(['inspect','--format','{{.State.Running}}',old])==='false')
  assert.equal(docker(['inspect','--format','{{.State.ExitCode}}',old]),'0')
  if(before)verifyRollbackSchema()
  report.status='PASS';report.checks=['46s incremental SSE spans actual nginx reload','specified baseline and candidate coexist','no false interrupted recovery','old drain completes final save','one assistant save','same session','replay no dispatch','one entitlement','old exit zero']
 }catch(error){report.status='FAILED';report.error=String(error instanceof Error?error.message:error).split(/\r?\n/)[0];throw error}finally{
  for(const name of [old,newer,proxy]){try{writeFileSync(resolve(out,name+'.log'),docker(['logs',name]))}catch{}}
  writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2))
  for(const name of [proxy,newer,old]){try{docker(['rm','-f',name])}catch{}}
  try{docker(['network','rm',network])}catch{}
  unlinkSync(envFile);if(user)await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end()
 }
})
