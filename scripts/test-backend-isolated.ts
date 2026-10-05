import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from 'pg'
import { config } from '../server/config.ts'

const root=resolve(fileURLToPath(new URL('..',import.meta.url)))
const adminUrl=new URL(config.databaseUrl)
const configuredDatabase=decodeURIComponent(adminUrl.pathname.slice(1))
if(configuredDatabase!=='lifeos')throw new Error('Refusing to create backend-test database: configured primary database is not the expected local LifeOS database.')
if(!['127.0.0.1','localhost','::1'].includes(adminUrl.hostname))throw new Error('Refusing isolated backend tests against a non-local PostgreSQL host.')
const databaseName=`lifeos_dialogue_test_${process.pid}_${randomUUID().replaceAll('-','').slice(0,12)}`
if(!/^lifeos_dialogue_test_[a-z0-9_]+$/.test(databaseName))throw new Error('Generated disposable database name failed its safety check.')
const databaseUrl=new URL(adminUrl)
databaseUrl.pathname='/'+databaseName
const admin=new Client({connectionString:adminUrl.href})
let created=false
let migrations=0

async function applyMigrations(){
  const client=new Client({connectionString:databaseUrl.href})
  await client.connect()
  try{
    await client.query('CREATE TABLE lifeos_schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
    const names=readdirSync(resolve(root,'server/migrations')).filter(name=>name.endsWith('.sql')).sort()
    const legacyUser='append-migration-'+randomUUID()
    let seededLegacy=false
    for(const name of names){
      if(name==='004-dialogue-memory.sql'){
        await client.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',[legacyUser,'Migration fixture',legacyUser+'@example.invalid'])
        seededLegacy=true
      }
      const sql=readFileSync(resolve(root,'server/migrations',name),'utf8')
      const sha=createHash('sha256').update(sql).digest('hex')
      await client.query('BEGIN')
      try{
        const previous=(await client.query('SELECT sha256 FROM lifeos_schema_migrations WHERE name=$1',[name])).rows[0]
        if(previous){if(previous.sha256!==sha)throw new Error('Migration checksum mismatch in disposable backend-test database.')}
        else{await client.query(sql);await client.query('INSERT INTO lifeos_schema_migrations(name,sha256) VALUES($1,$2)',[name,sha]);migrations++}
        await client.query('COMMIT')
      }catch(error){await client.query('ROLLBACK');throw error}
    }
    if(!seededLegacy||(await client.query('SELECT id FROM "user" WHERE id=$1',[legacyUser])).rowCount!==1)throw new Error('Existing database row lost during append migration.')
    const repeated=spawnSync(process.execPath,['--import','tsx','--import',pathToFileURL(resolve(root,'scripts/backend-test-preload.ts')).href,resolve(root,'scripts/migrate-db.ts')],{cwd:root,env:{...process.env,LIFEOS_ISOLATED_TEST_DATABASE_URL:databaseUrl.href},encoding:'utf8',windowsHide:true})
    if(repeated.status!==0||repeated.stdout.includes('Applied '))throw new Error('Repeated migration was not safe: '+repeated.stderr)
    await client.query('DELETE FROM "user" WHERE id=$1',[legacyUser])
    if(process.argv.includes('--verify-recovery')){
      const directory=resolve(process.env.LIFEOS_EVIDENCE??'evidence/backend');mkdirSync(directory,{recursive:true})
      writeFileSync(resolve(directory,'migration-report.json'),JSON.stringify({status:'PASS',evidence:'REAL_ISOLATED_POSTGRESQL',cleanMigration:true,appendMigration:true,repeatedMigration:true,preservedLegacyRow:true,migrations:names.map(name=>({name,sha256:createHash('sha256').update(readFileSync(resolve(root,'server/migrations',name))).digest('hex')})),primaryDatabaseModified:false},null,2)+'\n')
    }
  }finally{await client.end()}
}

async function main(){
  await admin.connect()
  const identity=(await admin.query('SELECT current_database() AS database,current_user AS role,rolcreatedb FROM pg_roles WHERE rolname=current_user')).rows[0]
  if(identity.database!=='lifeos'||!identity.rolcreatedb)throw new Error('The configured local database role cannot safely create a disposable test database.')
  await admin.query(`CREATE DATABASE "${databaseName}"`)
  created=true
  await applyMigrations()
  process.stdout.write(`Isolated PostgreSQL target: ${databaseName} (local port ${adminUrl.port||'5432'}); applied ${migrations} migrations.\n`)
  const browserOnly=process.argv.includes('--browser-only')
  if(process.argv.includes('--engine-workload'))throw new Error('The retired V1.1 workload is not a V1.3 acceptance suite.')
  const liveFiles=['live-01-university.test.ts','live-02-memory.test.ts','live-03-internship.test.ts','live-04-experience.test.ts','live-05-pattern.test.ts','live-reliability.test.ts','official-source-public.test.ts','official-attachment-public.test.ts']
  const targeted=process.argv.find(arg=>arg.startsWith('--file='))?.slice(7)
  if(targeted&&!/^[a-z0-9-]+\.test\.ts$/.test(targeted))throw new Error('Invalid targeted test filename')
  // Existing user edits stay at their exact paths as historical source, not active business gates.
  const preservedRetiredFiles=['campus-grounding-contract.test.ts','campus-reference-context.test.ts','campus-reliability.test.ts','campus-repair.test.ts']
  if(targeted&&preservedRetiredFiles.includes(targeted))throw new Error('This user-edited V1.2 test is preserved as historical source; use the V1.3 regression suites.')
  const browserFiles=['action-coach-browser.test.ts']
  const files=targeted?[targeted]:readdirSync(resolve(root,'tests/backend')).filter(name=>name.endsWith('.test.ts')&&!preservedRetiredFiles.includes(name)&&(browserOnly?browserFiles.includes(name):![...browserFiles,...liveFiles].includes(name))).sort()
  if(!files.length)throw new Error('No backend test files were found.')
  for(const file of files){
    process.stdout.write(`\n=== ${file} ===\n`)
    const result=spawnSync(process.execPath,['--import','tsx','--import',pathToFileURL(resolve(root,'scripts/backend-test-preload.ts')).href,'--test',resolve(root,'tests/backend',file)],{
      cwd:root,
      env:{...process.env,NODE_ENV:'test',LIFEOS_ISOLATED_TEST_DATABASE_URL:databaseUrl.href},
      encoding:'utf8',
      maxBuffer:8*1024*1024,
      windowsHide:true,
    })
    if(result.stdout)process.stdout.write(result.stdout)
    if(result.stderr)process.stderr.write(result.stderr)
    if(result.error)throw result.error
    if(result.status!==0)throw new Error(`Backend test failed: ${file}`)
  }
  if(process.argv.includes('--verify-recovery')){
    process.stdout.write('\n=== isolated database backup/restore verification ===\n')
    const result=spawnSync(process.execPath,['--import','tsx',resolve(root,'scripts/verify-db-recovery.ts')],{
      cwd:root,
      env:{...process.env,NODE_ENV:'test',LIFEOS_RECOVERY_DATABASE_URL:databaseUrl.href,LIFEOS_RECOVERY_SEED_SYNTHETIC:'true',LIFEOS_EVIDENCE:process.env.LIFEOS_EVIDENCE??'evidence/backend'},
      encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true,
    })
    if(result.stdout)process.stdout.write(result.stdout)
    if(result.stderr)process.stderr.write(result.stderr)
    if(result.error)throw result.error
    if(result.status!==0)throw new Error('Isolated database backup/restore verification failed.')
  }
  process.stdout.write('\nSelected backend tests passed against the disposable database.\n')
}

try{await main()}
finally{
  if(created){
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[databaseName]).catch(()=>{})
    if(/^lifeos_dialogue_test_[a-z0-9_]+$/.test(databaseName))await admin.query(`DROP DATABASE "${databaseName}"`).catch(error=>{process.stderr.write('Disposable backend-test database cleanup failed; database name: '+databaseName+'; '+(error instanceof Error?error.message:'unknown error')+'\n')})
  }
  await admin.end().catch(()=>{})
}
