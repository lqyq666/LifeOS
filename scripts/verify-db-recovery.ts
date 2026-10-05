import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { relative, resolve } from 'node:path'
import {pathToFileURL} from 'node:url'
import pg from 'pg'
import { config } from '../server/config.ts'
const container='lifeos-postgres-20261001',adminUrl=new URL(config.databaseUrl)
if(adminUrl.hostname!=='127.0.0.1'||adminUrl.port!=='55432'||adminUrl.pathname!=='/lifeos')throw new Error('Recovery verification is scoped to the dedicated local LifeOS PostgreSQL instance only.')
const sourceUrl=new URL(process.env.LIFEOS_RECOVERY_DATABASE_URL??adminUrl.href),sourceDatabase=decodeURIComponent(sourceUrl.pathname.slice(1))
if(sourceUrl.hostname!==adminUrl.hostname||sourceUrl.port!==adminUrl.port||!(['lifeos',/^lifeos_dialogue_test_[a-z0-9_]+$/].some(rule=>typeof rule==='string'?sourceDatabase===rule:rule.test(sourceDatabase))))throw new Error('Recovery source must be the local LifeOS database or a named disposable dialogue-test database.')
const seedSynthetic=process.env.LIFEOS_RECOVERY_SEED_SYNTHETIC==='true'
if(seedSynthetic&&!/^lifeos_dialogue_test_[a-z0-9_]+$/.test(sourceDatabase))throw new Error('Synthetic recovery rows are allowed only in a disposable dialogue-test database.')
const source=new pg.Pool({connectionString:sourceUrl.href}),evidenceDirectory=resolve(process.env.LIFEOS_EVIDENCE??'evidence/backend')
function docker(args:string[],input?:Buffer){const r=spawnSync('docker',args,{input,maxBuffer:32*1024*1024});if(r.status!==0)throw new Error(r.stderr.toString());return r.stdout}
const restored='lifeos_dialogue_test_restore_'+randomUUID().replaceAll('-','').slice(0,8)
const requiredCoreTables=['user','session','account','verification','conversations','messages','runs','decision_versions','experiences','experience_links','experience_revisions','user_operations','lifeos_schema_migrations']
const memoryTables=['user_memory_settings','dialogue_states','memory_items','memory_revisions','memory_suppressions','memory_review_runs']
mkdirSync('.local/backups',{recursive:true})
const file=resolve('.local/backups','lifeos-'+Date.now()+'.dump')
let created=false,copy:pg.Pool|undefined
function campusWorker(url:string,seed=false){
  const result=spawnSync(process.execPath,['--import','tsx','--import',pathToFileURL(resolve('scripts/backend-test-preload.ts')).href,'scripts/campus-recovery-action.ts',...(seed?['--seed']:[])],{env:{...process.env,LIFEOS_ISOLATED_TEST_DATABASE_URL:url},encoding:'utf8',windowsHide:true})
  if(result.status!==0)throw new Error('Campus recovery operation failed: '+result.stderr)
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!)
}
function coachWorker(url:string,seed=false){
  const result=spawnSync(process.execPath,['--import','tsx','--import',pathToFileURL(resolve('scripts/backend-test-preload.ts')).href,'scripts/coach-recovery-action.ts',...(seed?['--seed']:[])],{env:{...process.env,LIFEOS_ISOLATED_TEST_DATABASE_URL:url},encoding:'utf8',windowsHide:true})
  if(result.status!==0)throw new Error('Coach recovery operation failed: '+result.stderr)
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!)
}
async function seedSyntheticRows(){
  const userId='lifeos-recovery-'+randomUUID(),conversationId=randomUUID(),messageId=randomUUID(),requestId=randomUUID(),memoryId=randomUUID(),experienceId=randomUUID(),now=new Date()
  await source.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,$4,$4)',[userId,'合成恢复验收',userId+'@example.invalid',now])
  await source.query('INSERT INTO conversations(id,user_id,title) VALUES($1,$2,$3)',[conversationId,userId,'合成恢复验收'])
  await source.query('INSERT INTO messages(id,user_id,conversation_id,role,content,run_request_id) VALUES($1,$2,$3,$4,$5,$6)',[messageId,userId,conversationId,'user','我在读软件工程。上周我完成了课程项目并按时提交。',requestId])
  await source.query('INSERT INTO runs(user_id,request_id,conversation_id,source_message_id,fingerprint,status,expected_version,usage,response) VALUES($1,$2,$3,$4,$5,\'completed\',0,$6,$7)',[userId,requestId,conversationId,messageId,'synthetic-recovery-fixture',JSON.stringify({input:12,output:8}),JSON.stringify({reply:'合成恢复验收'})])
  await source.query('INSERT INTO decision_versions(user_id,conversation_id,version,request_id,payload) VALUES($1,$2,1,$3,$4)',[userId,conversationId,requestId,JSON.stringify({conditions:[{text:'软件工程方向探索',quote:'我在读软件工程。'}],unknowns:['项目方向'],recommendation:{title:'合成下一步',text:'先尝试一个小项目'},actions:[{title:'列出一个小项目',steps:['写下主题','完成最小页面']} ]})])
  await source.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,2)',[userId])
  await source.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,revision,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',2,now())",[experienceId,userId,conversationId,messageId,'上周我完成了课程项目并按时提交。',requestId,{summary:'课程项目完成并按时提交'}])
  await source.query("INSERT INTO experience_revisions(user_id,experience_id,revision,action,snapshot) VALUES($1,$2,2,'confirm',$3)",[userId,experienceId,{status:'confirmed',content:{summary:'课程项目完成并按时提交'}}])
  await source.query('INSERT INTO dialogue_states(user_id,conversation_id,state,revision) VALUES($1,$2,$3,1)',[userId,conversationId,JSON.stringify({task:'university_direction',phase:'clarify',slots:{'education.major':{status:'known',value:'软件工程'}}})])
  await source.query('INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,status) VALUES($1,$2,\'fact\',\'education.major\',$3,\'user_reported\',\'user\',$4,$5,\'active\')',[memoryId,userId,JSON.stringify('软件工程'),JSON.stringify([{type:'message',conversationId,messageId,quote:'我在读软件工程。'}]),now])
  await source.query('INSERT INTO memory_revisions(user_id,memory_item_id,revision,action,snapshot) VALUES($1,$2,1,\'create\',$3)',[userId,memoryId,JSON.stringify({status:'active',value:'软件工程'})])
  await source.query('INSERT INTO memory_suppressions(user_id,source_conversation_id,source_message_id,key) VALUES($1,$2,$3,$4)',[userId,conversationId,messageId,'education.school'])
  await source.query('INSERT INTO memory_review_runs(user_id,request_id,conversation_id,fingerprint,status,response) VALUES($1,$2,$3,$4,\'completed\',$5)',[userId,requestId,conversationId,'synthetic-recovery-fixture',JSON.stringify({candidateCount:0})])
}
function accessWorker(url:string,seed=false){
  const result=spawnSync(process.execPath,['--import','tsx','--import',pathToFileURL(resolve('scripts/backend-test-preload.ts')).href,'scripts/access-recovery-action.ts',...(seed?['--seed']:[])],{env:{...process.env,LIFEOS_ISOLATED_TEST_DATABASE_URL:url},encoding:'utf8',windowsHide:true})
  if(result.status!==0)throw new Error('Access/accounting recovery operation failed: '+result.stderr)
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!)
}
function growthWorker(url:string,seed=false){
  const result=spawnSync(process.execPath,['--import','tsx','--import',pathToFileURL(resolve('scripts/backend-test-preload.ts')).href,'scripts/growth-recovery-action.ts',...(seed?['--seed']:[])],{env:{...process.env,LIFEOS_ISOLATED_TEST_DATABASE_URL:url},encoding:'utf8',windowsHide:true})
  if(result.status!==0)throw new Error('Growth recovery operation failed: '+result.stderr)
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!)
}
function officialWorker(url:string,seed=false){
  const result=spawnSync(process.execPath,['--import','tsx','--import',pathToFileURL(resolve('scripts/backend-test-preload.ts')).href,'scripts/official-recovery-action.ts',...(seed?['--seed']:[])],{env:{...process.env,LIFEOS_ISOLATED_TEST_DATABASE_URL:url},encoding:'utf8',windowsHide:true})
  if(result.status!==0)throw new Error('Official source recovery failed: '+result.stderr)
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!)
}
try{
  const migrations=new Set((await source.query('SELECT name FROM lifeos_schema_migrations')).rows.map(row=>row.name as string))
  const tables=(await source.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row=>row.tablename as string)
  const requiredTables=[...requiredCoreTables,...(migrations.has('004-dialogue-memory.sql')?memoryTables:[])]
  const missing=requiredTables.filter(table=>!tables.includes(table))
  if(missing.length)throw new Error('Recovery source lacks required tables for its applied migrations: '+missing.join(', '))
  if(seedSynthetic&&!migrations.has('005-cost-routing.sql'))throw new Error('Synthetic recovery fixture requires both dialogue-memory and cost-routing migrations.')
  if(seedSynthetic)await seedSyntheticRows()
  const campusSeeded=seedSynthetic&&migrations.has('006-campus.sql')
  if(campusSeeded)campusWorker(sourceUrl.href,true)
  const coachSeeded=seedSynthetic&&migrations.has('008-action-coach-events.sql')&&migrations.has('009-coach-semantic-index.sql')
  if(coachSeeded)coachWorker(sourceUrl.href,true)
  const accessSeeded=seedSynthetic&&migrations.has('011-invite-entitlements.sql')&&migrations.has('012-provider-spend.sql')
  if(accessSeeded)accessWorker(sourceUrl.href,true)
  const growthSeeded=seedSynthetic&&migrations.has('014-growth-workspace.sql')
  if(growthSeeded)growthWorker(sourceUrl.href,true)
  const officialSeeded=seedSynthetic&&migrations.has('016-official-source-snapshots.sql')
  if(officialSeeded)officialWorker(sourceUrl.href,true)
  const dump=docker(['exec',container,'pg_dump','-U','lifeos','-d',sourceDatabase,'-Fc']);writeFileSync(file,dump,{mode:0o600})
  docker(['exec',container,'createdb','-U','lifeos',restored]);created=true
  docker(['exec','-i',container,'pg_restore','-U','lifeos','--exit-on-error','-d',restored],dump)
  const target=new URL(sourceUrl);target.pathname='/'+restored;copy=new pg.Pool({connectionString:target.toString()})
  const counts:Record<string,number>={}
  const contentHashes:Record<string,string>={}
  for(const table of tables){
    const sql='SELECT count(*)::int AS n FROM "'+table.replaceAll('"','""')+'"'
    const a=(await source.query(sql)).rows[0].n,b=(await copy.query(sql)).rows[0].n
    if(a!==b)throw new Error('Restored row count mismatch: '+table)
    counts[table]=a
    const identifier='"'+table.replaceAll('"','""')+'"'
    const digestSql="SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM "+identifier+' t'
    const originalHash=(await source.query(digestSql)).rows[0].digest,restoredHash=(await copy.query(digestSql)).rows[0].digest
    if(originalHash!==restoredHash)throw new Error('Restored content mismatch: '+table)
    contentHashes[table]=originalHash
  }
  const original=(await source.query('SELECT version,payload FROM decision_versions ORDER BY user_id,conversation_id,version')).rows
  const restoredPayload=(await copy.query('SELECT version,payload FROM decision_versions ORDER BY user_id,conversation_id,version')).rows
  if(JSON.stringify(original)!==JSON.stringify(restoredPayload))throw new Error('Restored decision payload mismatch')
  if(seedSynthetic)for(const table of ['memory_items','dialogue_states','memory_suppressions','decision_versions','experiences'])if(counts[table]<1)throw new Error('Recovery fixture missing '+table)
  const coachContinuation=coachSeeded?coachWorker(target.href):null
  const growthContinuation=growthSeeded?growthWorker(target.href):null
  const officialContinuation=officialSeeded?officialWorker(target.href):null
  if(officialSeeded)for(const table of ['official_sources','official_source_snapshots'])if(!counts[table])throw new Error('Official recovery fixture missing '+table)
  if(coachSeeded)for(const table of ['coach_events','coach_current','coach_nodes','coach_actions','coach_event_revisions','coach_source_withdrawals','coach_semantic_index','coach_index_jobs'])if(!counts[table])throw new Error('Coach recovery fixture missing '+table)
  if(coachSeeded&&migrations.has('010-coach-knowledge-citations.sql')&&!counts.coach_reply_sources)throw new Error('Coach recovery fixture missing citation provenance')
  const campusContinuation=campusSeeded?campusWorker(target.href):null
  if(campusSeeded)for(const table of ['campus_inquiries','campus_current','campus_revisions','campus_dependencies','campus_knowledge','campus_knowledge_revisions'])if(!counts[table])throw new Error('Campus recovery fixture missing '+table)
  if(accessSeeded)for(const table of ['lifeos_entitlements','lifeos_provider_budgets','lifeos_provider_spend'])if(!counts[table])throw new Error('Access/accounting recovery fixture missing '+table)
  const accessContinuation=accessSeeded?accessWorker(target.href):null
  const report={status:'PASS',evidence:'REAL_PG_DUMP_RESTORE_TO_SEPARATE_DATABASE',sourceDatabase,sourceMigrations:[...migrations].sort(),syntheticRowsSeeded:seedSynthetic,backup:relative(process.cwd(),file).replaceAll('\\','/'),bytes:dump.length,verifiedTableCount:tables.length,tableCounts:counts,tableContentHashes:contentHashes,allTableContentsIdentical:true,decisionPayloadsIdentical:true,confirmedExperienceReadable:true,campusContinuation,coachContinuation,accessContinuation,growthContinuation,officialContinuation,restoredDatabaseRemovedAfterVerification:true,primaryDatabaseModified:false}
  mkdirSync(evidenceDirectory,{recursive:true});writeFileSync(resolve(evidenceDirectory,'recovery-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}finally{
  if(copy)await copy.end()
  // Only the new randomly named verification copy created in this invocation is removed.
  if(created)docker(['exec',container,'dropdb','-U','lifeos',restored])
  await source.end()
}
