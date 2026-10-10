import {spawnSync,execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve,dirname,sep} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {config} from '../server/config.ts'
const repository=process.cwd(),head=execFileSync('git',['rev-parse','HEAD']).toString().trim(),directory=resolve(tmpdir(),'lifeos-repro-'+randomUUID()),evidence=resolve(process.env.LIFEOS_REPRO_EVIDENCE??resolve(repository,'.local','reproduction-'+head.slice(0,8)+'-'+randomUUID()));if(existsSync(resolve(evidence,'REPRODUCTION.json')))throw new Error('REPRO_EVIDENCE_ALREADY_EXISTS');mkdirSync(evidence,{recursive:true})
const env={...process.env,DATABASE_URL:config.databaseUrl,BETTER_AUTH_SECRET:randomUUID()+randomUUID(),NODE_ENV:'test',LIFEOS_WORKFLOW_EVIDENCE:resolve(directory,'.local/repro-evidence')}
for(const key of Object.keys(env))if(/(?:API_KEY|TOKEN|COZE|REAL_BATCH_AUTHORIZATION|REAL_BATCH_EXECUTE|LIFEOS_STUDENT_CASE_IDS)/.test(key))delete (env as Record<string,string|undefined>)[key]
const rows:any[]=[],modelManifest=JSON.parse(readFileSync('.local/models/bge-small-zh-v1.5/manifest.json','utf8'))
function run(id:string,command:string,args:string[],cwd:string){const r=spawnSync(command,args,{cwd,env,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,shell:command==='npm'});writeFileSync(resolve(evidence,id+'.log'),(r.stdout??'')+(r.stderr??'')+(r.error?'\n'+r.error.message:''));rows.push({id,exit:r.status,status:r.status===0?'PASS':'FAIL',log:id+'.log'});if(r.status!==0)throw new Error('REPRO_STEP_FAILED_'+id)}
try{
 run('checkout','git',['worktree','add','--detach',directory,head],repository)
 if(existsSync(resolve(directory,'.env.server'))||existsSync(resolve(directory,'.local/v1.3-action-coach/paid/provider-calls.json')))throw new Error('PRIVATE_RUNTIME_FILES_IN_CHECKOUT')
 run('install','npm',['ci','--ignore-scripts'],directory)
 // Explicit public dependency, copied only from its verified manifest; never a private DB, ledger or saved dialogue.
 const modelBase=resolve(repository,'.local/models/bge-small-zh-v1.5'),modelTarget=resolve(directory,'.local/models/bge-small-zh-v1.5')
 if(modelManifest.repo!=='BAAI/bge-small-zh-v1.5'||modelManifest.revision!=='7999e1d3359715c523056ef9478215996d62a620')throw new Error('PUBLIC_MODEL_VERSION_MISMATCH')
 for(const [name,entry]of Object.entries(modelManifest.files) as [string,{sha256:string}][]){const from=resolve(modelBase,name),to=resolve(modelTarget,name);if(!from.startsWith(modelBase+sep)||!to.startsWith(modelTarget+sep))throw new Error('PUBLIC_DEPENDENCY_PATH_INVALID');const bytes=readFileSync(from);if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('PUBLIC_MODEL_HASH_MISMATCH');mkdirSync(dirname(to),{recursive:true});writeFileSync(to,bytes)}
 writeFileSync(resolve(modelTarget,'manifest.json'),JSON.stringify(modelManifest,null,2));writeFileSync(resolve(evidence,'PUBLIC_ENCODER_MANIFEST.json'),JSON.stringify(modelManifest,null,2))
 run('root','npm',['test'],directory);run('server-types','npm',['run','typecheck:server'],directory);run('build','npm',['run','build'],directory)
 // Withdrawal/approval suites intentionally mutate source status. Give each
 // suite a fresh disposable DB; never let one suite contaminate another.
 for(const name of ['kb-maintenance-http','evergreen-batch-content','evergreen-knowledge','evergreen-acceptance2','workflow-method-context','workflow-growth-knowledge','workflow-real-entry','coach-source-freeze'])run(name,'npm',['run','test:backend','--','--file='+name+'.test.ts'],directory)
 for(const split of ['development','sealed']){Object.assign(env,{LIFEOS_QUERY_SPLIT:split,LIFEOS_QUERY_RUN:'reproduction-regression'});run('natural-'+split,'npm',['run','test:backend','--','--file=evergreen-natural.test.ts'],directory)}
}finally{
 const report={status:rows.length===15&&rows.every(r=>r.status==='PASS')?'PASS_FRESH_CHECKOUT_RELEVANT_FREE_SCOPE':'FAIL_OR_INCOMPLETE',head,directory,dependencyLockSha256:createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),declaredDependencies:['package-lock npm ci','Node runtime','local PostgreSQL role capable of create/drop isolated DB; credential injected in process only','Python + deploy/requirements-embedding.lock','explicit verified public BAAI model manifest, no private task evidence'],publicEncoderDependency:{path:'.local/models/bge-small-zh-v1.5',revision:'7999e1d3359715c523056ef9478215996d62a620',status:'EXPLICIT_PUBLIC_MANIFEST_VERIFIED_AND_LOCAL_ENCODER_TESTED',instructions:'See DEPLOYMENT_HANDOFF.md; obtain public pinned model and verify manifest before semantic/trajectory replay.'},privateFilesCopied:false,ledgerCopied:false,privateDatabaseCopied:false,paidCalls:0,cloudCalls:0,temporaryHttpServices:'CLOSED_BY_TESTS_NOT_USER_SERVICE',notClaimed:['replayed acceptance queries are new unseen evidence','historical paid replay without original evidence','production deployment'],rows};writeFileSync(resolve(evidence,'REPRODUCTION.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}
