import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync,readFileSync,unlinkSync} from 'node:fs'
import {resolve} from 'node:path'
import net from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'

test('actual nginx reload keeps legacy 37s SSE, shared session, peer cancellation and exactly one final save', {timeout:90000,skip:process.env.LIFEOS_ROLLING_NGINX_ACCEPTANCE!=='true'},async()=>{
 const suffix=randomUUID().slice(0,8),network='lifeos-rolling-'+suffix,legacy='lifeos-old-'+suffix,candidate='lifeos-new-'+suffix,proxy='lifeos-nginx-'+suffix
 const out=resolve('.local/data-extraction-audit-20261026/nginx-'+suffix);mkdirSync(out,{recursive:true})
 const envFile=resolve(out,'synthetic.env'),conf=resolve(out,'nginx.conf'),report:any={scope:'LOCAL_REAL_NGINX_REAL_LEGACY_IMAGE_SYNTHETIC_ENGINE',providerCalls:0,primaryDatabaseModified:false}
 const docker=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:25000}).trim()
 const allocator=net.createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()))
 const origin='http://127.0.0.1:'+port,db=new URL(config.databaseUrl);assert.match(db.pathname,/^\/lifeos_dialogue_test_/);db.hostname='host.docker.internal'
 writeFileSync(envFile,['NODE_ENV=production','DATABASE_URL='+db.href,'BETTER_AUTH_SECRET=synthetic-rolling-nginx-secret-only-20261026','LIFEOS_ORIGIN='+origin,'LIFEOS_SIGNUP_ENABLED=true','LIFEOS_ENTITLEMENTS_ENABLED=false','LIFEOS_PROVIDER_BUDGET_ENABLED=false','LIFEOS_MODEL_DEFAULT_API_KEY=synthetic-no-provider-dispatch','LIFEOS_LEGACY_CANCEL_PEER=lifeos-app-1'].join('\n'))
 const route=(name:string)=>writeFileSync(conf,`events {}\nhttp { server { listen 80; location / { proxy_pass http://${name}:8787; proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_buffering off; proxy_read_timeout 65s; } } }\n`)
 const wait=async(check:()=>Promise<boolean>)=>{const start=Date.now();while(!await check()){if(Date.now()-start>18000)throw new Error('container readiness timeout');await delay(100)}}
 let cookie='',user='',cancelCookie='',cancelUser=''
 const post=(path:string,body:unknown,cookieValue=cookie)=>fetch(origin+path,{method:'POST',headers:{Origin:origin,Cookie:cookieValue,'Content-Type':'application/json'},body:JSON.stringify(body)})
 try{
  assert.equal(docker(['image','inspect','--format','{{.Id}}','lifeos:v1.3-launch-7b1b87e-source']),'sha256:eb8067727917ecc79d6021348df167304cbcc18bb0dc7e29b871046770870869')
  report.legacyImage='sha256:eb8067727917ecc79d6021348df167304cbcc18bb0dc7e29b871046770870869'
  report.candidateImage=docker(['image','inspect','--format','{{.Id}}','lifeos:rolling-synthetic-20261026'])
  docker(['network','create',network])
  const start=(name:string,image:string,mode:string)=>docker(['run','-d','--name',name,'--network',network,...(mode==='legacy'?['--network-alias','lifeos-app-1']:[]),'--env-file',envFile,'-e','SYNTHETIC_INSTANCE='+mode,'--mount','type=bind,source='+resolve('.local/data-extraction-audit-20261026/nginx-harness.mts')+',target=/app/nginx-harness.mts,readonly','--memory','256m','--cpus','1','--entrypoint','node',image,'--import','tsx','/app/nginx-harness.mts'])
  start(legacy,report.legacyImage,'legacy');await wait(async()=>docker(['logs',legacy]).includes('SYNTHETIC_READY'))
  route(legacy);docker(['run','-d','--name',proxy,'--network',network,'--mount','type=bind,source='+out+',target=/etc/nginx/rolling,readonly','-p','127.0.0.1:'+port+':80','--entrypoint','nginx','nginx:alpine','-c','/etc/nginx/rolling/nginx.conf','-g','daemon off;'])
  await wait(async()=>{try{return (await fetch(origin+'/api/access-policy')).status===200}catch{return false}})
  const signup=await post('/api/auth/sign-up/email',{email:randomUUID()+'@example.invalid',name:'Synthetic nginx adult',password:'Synthetic-nginx-123456'})
  assert.equal(signup.status,200);cookie=signup.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')
  user=(await (await fetch(origin+'/api/session',{headers:{Cookie:cookie}})).json()).id
  const second=await post('/api/auth/sign-up/email',{email:randomUUID()+'@example.invalid',name:'Synthetic cancellation adult',password:'Synthetic-nginx-123456'},'')
  assert.equal(second.status,200);cancelCookie=second.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')
  cancelUser=(await (await fetch(origin+'/api/session',{headers:{Cookie:cancelCookie}})).json()).id
  const chat=randomUUID(),cancelChat=randomUUID(),id=randomUUID(),cancelId=randomUUID()
  await post('/api/conversations',{id:chat,title:'SYNTHETIC nginx long stream'});await post('/api/conversations',{id:cancelChat,title:'SYNTHETIC nginx cancellation'},cancelCookie)
  const startedAt=Date.now(),stream=await post('/api/conversations/'+chat+'/messages',{requestId:id,text:'合成长期回复完整性验证'})
  assert.equal(stream.headers.get('x-lifeos-synthetic-instance'),'legacy');const reading=stream.text()
  const cancelling=await post('/api/conversations/'+cancelChat+'/messages',{requestId:cancelId,text:'合成取消验证'},cancelCookie);const cancelReading=cancelling.text()
  start(candidate,report.candidateImage,'candidate');await wait(async()=>docker(['logs',candidate]).includes('SYNTHETIC_READY'))
  assert.equal((await pool.query('SELECT status FROM runs WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0].status,'running','new startup leaves legacy run active')
  route(candidate);docker(['exec',proxy,'nginx','-t','-c','/etc/nginx/rolling/nginx.conf']);docker(['exec',proxy,'nginx','-s','reload','-c','/etc/nginx/rolling/nginx.conf'])
  await wait(async()=>{const r=await fetch(origin+'/api/session',{headers:{Cookie:cookie}});return r.headers.get('x-lifeos-synthetic-instance')==='candidate'&&(await r.json()).id===user})
  assert.equal((await post('/api/runs/'+cancelId+'/cancel',{},cancelCookie)).status,200)
  assert.doesNotMatch(await cancelReading,/"type":"done"/,'new route relays authenticated cancellation to legacy owner')
  const body=await reading;report.durationMs=Date.now()-startedAt
  assert.ok(report.durationMs>=37000);assert.equal((body.match(/"type":"done"/g)??[]).length,1)
  assert.doesNotMatch(body,/SERVER_RESTARTED|SERVER_SHUTTING_DOWN/);assert.ok(body.includes('完整保留最后一句。'.repeat(50)))
  const row=(await pool.query('SELECT status,error_code FROM runs WHERE user_id=$1 AND request_id=$2',[user,id])).rows[0];assert.equal(row.status,'completed')
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,id])).rows[0].n,1)
  const replay=await post('/api/conversations/'+chat+'/messages',{requestId:id,text:'合成长期回复完整性验证'});assert.match(await replay.text(),/"replayed":true/)
  report.status='PASS';report.checks=['actual nginx reload','legacy stream complete','one assistant save','same cookie valid on candidate','cross-instance legacy cancellation','replay has no second dispatch']
 }finally{
  writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2))
  for(const name of [proxy,candidate,legacy]){try{docker(['rm','-f',name])}catch{}}
  try{docker(['network','rm',network])}catch{}
  unlinkSync(envFile)
  if(user)await pool.query('DELETE FROM "user" WHERE id=$1',[user]);if(cancelUser)await pool.query('DELETE FROM "user" WHERE id=$1',[cancelUser]);await pool.end()
 }
})
