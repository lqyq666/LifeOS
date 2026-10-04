import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pool } from '../../server/db.ts'
import { config } from '../../server/config.ts'
import * as store from '../../server/store.ts'
import { stageCoachEvent } from '../../server/action-coach-events.ts'

test('actual service warms offline encoder, reclaims index lease, rejects duplicate instance and drains without orphaning encoder',async()=>{
  const allocator=net.createServer();await new Promise<void>(resolveListen=>allocator.listen(0,'127.0.0.1',resolveListen))
  const port=(allocator.address() as {port:number}).port;await new Promise<void>(resolveClose=>allocator.close(()=>resolveClose()))
  assert.ok(![8790,55432].includes(port))
  const user='coach-service-'+randomUUID(),conversation=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:conversation,title:'Synthetic actual service lifecycle'})
  const text='我交付了一个清单，对方还没回应。',run=(await store.startRun(user,conversation,randomUUID(),text)).run
  const coach=await stageCoachEvent(run,{target:{operation:'create',title:'交付清单',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},'保留实际经过。')
  await store.finishRun(run,{candidates:[],audit:[],coach},coach.reply,null,new AbortController().signal)
  await pool.query("UPDATE coach_index_jobs SET status='processing',locked_at=now()-interval '10 minutes',attempts=1 WHERE user_id=$1",[user])
  const abandoned=(await store.startRun(user,conversation,randomUUID(),'模拟启动前遗留的未完成请求。')).run
  function launch(){
    const child=spawn(process.execPath,['--import','tsx','--import',pathToFileURL(resolve('scripts/backend-test-preload.ts')).href,'--import',pathToFileURL(resolve('scripts/coach-service-test-preload.ts')).href,'server/index.ts'],{cwd:process.cwd(),env:{...process.env,LIFEOS_ISOLATED_TEST_DATABASE_URL:config.databaseUrl,LIFEOS_SERVICE_TEST_PORT:String(port)},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true})
    let stdout='',stderr=''
    child.stdout!.on('data',data=>{stdout+=data.toString()});child.stderr!.on('data',data=>{stderr+=data.toString()})
    const exited=new Promise<number|null>(resolveExit=>child.once('exit',code=>resolveExit(code)))
    return {child,exited,output:()=>stdout,error:()=>stderr}
  }
  const service=launch();let encoderPid=0
  const report:any={evidence:'REAL_SERVICE_PROCESS_REAL_POSTGRESQL_REAL_OFFLINE_ENCODER_NO_PROVIDER',primaryDatabaseModified:false,checks:[]}
  try{
    const started=Date.now()
    while(!service.output().split('\n').some(line=>line.includes('"service":"LifeOS"'))){
      if(service.child.exitCode!==null)throw new Error('Service exited before readiness: '+service.error())
      if(Date.now()-started>30000)throw new Error('Service startup observation timed out')
      await new Promise(resolveWait=>setTimeout(resolveWait,50))
    }
    const ready=JSON.parse(service.output().split('\n').find(line=>line.includes('"service":"LifeOS"'))!)
    encoderPid=ready.embeddingPid;assert.ok(encoderPid>0);report.startupMs=Date.now()-started
    const response=await fetch('http://127.0.0.1:'+port+'/api/health');assert.equal(response.status,200)
    const health=await response.json() as any;assert.equal(health.providerCheckedByHealth,false)
    const readiness=await fetch('http://127.0.0.1:'+port+'/api/ready');assert.equal(readiness.status,200)
    assert.deepEqual((await readiness.json() as any).embedding,{ready:true,offline:true})
    assert.equal((await pool.query('SELECT error_code,status FROM runs WHERE user_id=$1 AND request_id=$2',[user,abandoned.request_id])).rows[0].error_code,'SERVER_RESTARTED')
    for(let i=0;i<100;i++){
      if((await pool.query('SELECT 1 FROM coach_semantic_index WHERE user_id=$1 AND event_id=$2',[user,coach.eventId])).rowCount)break
      await new Promise(resolveWait=>setTimeout(resolveWait,50))
    }
    assert.ok((await pool.query('SELECT 1 FROM coach_semantic_index WHERE user_id=$1 AND event_id=$2',[user,coach.eventId])).rowCount)
    const duplicate=launch();assert.equal(await duplicate.exited,1);assert.match(duplicate.error(),/LIFEOS_ALREADY_RUNNING/)
    service.child.send({type:'lifeos_shutdown'})
    assert.equal(await service.exited,0)
    assert.throws(()=>process.kill(encoderPid,0),'offline encoder must terminate with the actual server')
    const connection=await pool.connect()
    try{assert.equal((await connection.query('SELECT pg_try_advisory_lock(6100102) AS acquired')).rows[0].acquired,true);await connection.query('SELECT pg_advisory_unlock(6100102)')}finally{connection.release()}
    const crashed=launch()
    try{
      const crashStart=Date.now()
      while(!crashed.output().split('\n').some(line=>line.includes('"service":"LifeOS"'))){
        if(crashed.child.exitCode!==null||Date.now()-crashStart>30000)throw new Error('Crash-readiness service failed to start')
        await new Promise(resolveWait=>setTimeout(resolveWait,50))
      }
      const crashReady=JSON.parse(crashed.output().split('\n').find(line=>line.includes('"service":"LifeOS"'))!)
      process.kill(crashReady.embeddingPid)
      let unavailable=false
      for(let i=0;i<40;i++){
        const degraded=await fetch('http://127.0.0.1:'+port+'/api/ready')
        if(degraded.status===503){assert.equal((await degraded.json() as any).embedding.ready,false);unavailable=true;break}
        await new Promise(resolveWait=>setTimeout(resolveWait,50))
      }
      assert.equal(unavailable,true,'dead encoder must make the running service unready')
      report.embeddingCrashReadiness='HTTP_503'
    }finally{if(crashed.child.exitCode===null){crashed.child.send({type:'lifeos_shutdown'});assert.equal(await crashed.exited,0)}}
    report.checks=['offline encoder prewarmed before listen','health never probes provider','abandoned run terminated','expired index lease reclaimed','duplicate instance rejected','IPC invokes actual production drain','encoder process exited','instance lock released']
    report.status='PASSED'
  }finally{
    if(service.child.exitCode===null){service.child.send({type:'lifeos_shutdown'});await service.exited}
    mkdirSync('evidence/v1.3-action-coach',{recursive:true});writeFileSync('evidence/v1.3-action-coach/service-lifecycle.json',JSON.stringify(report,null,2)+'\n')
    await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end()
  }
})
