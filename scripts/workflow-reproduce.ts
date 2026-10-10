import {spawnSync,execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {config} from '../server/config.ts'
const repository=process.cwd(),head=execFileSync('git',['rev-parse','HEAD']).toString().trim(),directory=resolve(tmpdir(),'lifeos-repro-'+randomUUID()),evidence=resolve(repository,'.planning/research/workflow-integration/evidence/long-batch-20261010/reproduction');mkdirSync(evidence,{recursive:true})
const env={...process.env,DATABASE_URL:config.databaseUrl,BETTER_AUTH_SECRET:randomUUID()+randomUUID(),NODE_ENV:'test',LIFEOS_WORKFLOW_EVIDENCE:resolve(directory,'.local/repro-evidence')}
for(const key of Object.keys(env))if(/(?:API_KEY|TOKEN|COZE|REAL_BATCH_AUTHORIZATION|REAL_BATCH_EXECUTE|LIFEOS_STUDENT_CASE_IDS)/.test(key))delete (env as Record<string,string|undefined>)[key]
const rows:any[]=[]
function run(id:string,command:string,args:string[],cwd:string){const r=spawnSync(command,args,{cwd,env,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,shell:command==='npm'});writeFileSync(resolve(evidence,id+'.log'),(r.stdout??'')+(r.stderr??'')+(r.error?'\n'+r.error.message:''));rows.push({id,exit:r.status,status:r.status===0?'PASS':'FAIL',log:id+'.log'});if(r.status!==0)throw new Error('REPRO_STEP_FAILED_'+id)}
try{
 run('checkout','git',['worktree','add','--detach',directory,head],repository)
 if(existsSync(resolve(directory,'.env.server'))||existsSync(resolve(directory,'.local/v1.3-action-coach/paid/provider-calls.json')))throw new Error('PRIVATE_RUNTIME_FILES_IN_CHECKOUT')
 run('install','npm',['ci','--ignore-scripts'],directory)
 run('root','npm',['test'],directory);run('server-types','npm',['run','typecheck:server'],directory);run('build','npm',['run','build'],directory)
 run('backend','npm',['run','test:backend','--','--file=kb-maintenance-http.test.ts','--file=evergreen-batch-content.test.ts','--file=workflow-real-entry.test.ts','--file=workflow-growth-knowledge.test.ts'],directory)
}finally{
 const report={status:rows.length===6&&rows.every(r=>r.status==='PASS')?'PASS_FRESH_CHECKOUT_RELEVANT_FREE_SCOPE':'FAIL_OR_INCOMPLETE',head,directory,dependencyLockSha256:createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),declaredDependencies:['package-lock npm ci','Node runtime','local PostgreSQL role capable of create/drop isolated DB; credential injected in process only'],publicEncoderDependency:{path:'.local/models/bge-small-zh-v1.5',revision:'7999e1d3359715c523056ef9478215996d62a620',status:'NOT_COPIED_NOT_TESTED_IN_FRESH_CHECKOUT',instructions:'See DEPLOYMENT_HANDOFF.md; obtain public pinned model and verify manifest before semantic/trajectory replay.'},privateFilesCopied:false,ledgerCopied:false,privateDatabaseCopied:false,paidCalls:0,cloudCalls:0,temporaryHttpServices:'CLOSED_BY_TESTS_NOT_USER_SERVICE',notClaimed:['fresh semantic encoder evaluation','historical paid replay without original evidence','production deployment'],rows};writeFileSync(resolve(evidence,'REPRODUCTION.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}
