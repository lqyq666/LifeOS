import {randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import pg from 'pg'
import {config} from '../server/config.ts'
// Preserve saved real-provider failures. Replay writes ONLY a checked synthetic DB clone.
const report=JSON.parse(readFileSync('evidence/v1.3-action-coach/real/coach-9121a82d-b53c-45e2-b048-ffbef4d6ab8a/report.json','utf8'))
const source=String(report.databaseName),target='lifeos_dialogue_test_workflow_dgate_'+randomUUID().replaceAll('-','')
const base=new URL(config.databaseUrl),safe=(n:string)=>/^lifeos_dialogue_(?:live|test)_[a-z0-9_]+$/.test(n)
if(!['localhost','127.0.0.1','::1'].includes(base.hostname)||base.pathname!=='/lifeos'||!safe(source)||!safe(target)||source===target||!String(report.evidence).includes('SYNTHETIC_USER'))throw new Error('REPLAY_TARGET_DENIED')
const sourceUrl=new URL(base);sourceUrl.pathname='/'+source
const targetUrl=new URL(base);targetUrl.pathname='/'+target
const admin=new pg.Client({connectionString:base.href}),out=(process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/agent-workflows/evidence')+'/'
let created=false
try{
 await admin.connect()
 if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[source])).rowCount)throw new Error('SAVED_SYNTHETIC_DATABASE_MISSING')
 const check=new pg.Client({connectionString:sourceUrl.href});await check.connect()
 try{if((await check.query('SELECT 1 FROM "user" WHERE email NOT LIKE $1 LIMIT 1',['%@example.invalid'])).rowCount)throw new Error('SOURCE_NOT_SYNTHETIC_ONLY')}
 finally{await check.end()}
 if((await admin.query('SELECT 1 FROM pg_stat_activity WHERE datname=$1',[source])).rowCount)throw new Error('SAVED_SOURCE_HAS_ACTIVE_CONNECTIONS_NOT_INTERRUPTED')
 await admin.query(`CREATE DATABASE "${target}" TEMPLATE "${source}"`);created=true
 // Bring only the disposable clone to the current versioned schema before replay.
 const migration=spawnSync(process.execPath,['--import','tsx','--import',pathToFileURL(resolve('scripts/backend-test-preload.ts')).href,resolve('scripts/migrate-db.ts')],{cwd:process.cwd(),env:{...process.env,LIFEOS_ISOLATED_TEST_DATABASE_URL:targetUrl.href},encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,timeout:120000})
 writeFileSync(out+'dgate13-clone-migration.log',migration.stdout+'\n'+migration.stderr)
 if(migration.status!==0)throw new Error('DISPOSABLE_CLONE_MIGRATION_FAILED')
 const result=spawnSync(process.execPath,['--import','tsx','--import',pathToFileURL(resolve('scripts/backend-test-preload.ts')).href,resolve('.local/campus-growth/dgate-replay.ts')],{cwd:process.cwd(),env:{...process.env,LIFEOS_ADVANCED_WORKFLOWS:'false',LIFEOS_ISOLATED_TEST_DATABASE_URL:targetUrl.href},encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,timeout:120000})
 writeFileSync(out+'dgate13-replay.log',result.stdout+'\n'+result.stderr)
 writeFileSync(out+'D_GATE_REPLAY_METADATA.json',JSON.stringify({source,disposableTarget:target,sourceModified:false,primaryDatabaseModified:false,mode:'SAVED_FAILURE_REPLAY_REAL_HOST_SIMULATED_PROVIDER',providerCalls:0,exit:result.status,timedOut:result.error?.message?.includes('ETIMEDOUT')??false},null,2)+'\n')
 console.log(JSON.stringify({exit:result.status,evidence:out+'dgate13-replay.log',sourceModified:false,paidCalls:0}))
}catch(error){writeFileSync(out+'D_GATE_REPLAY_METADATA.json',JSON.stringify({status:'NOT_TESTED',code:error instanceof Error?error.message:'UNAVAILABLE',sourceModified:false,primaryDatabaseModified:false,paidCalls:0},null,2)+'\n');console.log('D-gate replay resource gate blocked; original saved source untouched.')}
finally{
 if(created&&safe(target)&&target!==source){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[target]);await admin.query(`DROP DATABASE "${target}"`)}
 await admin.end()
}
