import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {config} from '../server/config.ts'
import {assertCoachSourceFreeze} from './coach-source-freeze.ts'
import {coachBudgetObserver} from './coach-budget-observer.ts'
import {CoachProviderBudget} from './coach-provider-budget.ts'
import type {Staged} from '../server/store.ts'
if(!process.argv.includes('--paid'))throw new Error('Explicit --paid required; no provider request made')
const option=(name:string)=>{const i=process.argv.indexOf(name),value=process.argv[i+1];if(i<0||!value||value.startsWith('--'))throw new Error(name+' required');return value}
const freezePath=resolve(option('--freeze')),parentPath=resolve(option('--report')),sourceDigest=assertCoachSourceFreeze(freezePath)
const parent=JSON.parse(readFileSync(parentPath,'utf8')),failed=parent.turns.at(-1)
if(!parent.closedAt||failed?.status!=='FAILED'||failed.error!=='COACH_MATERIAL_NOT_VISIBLE'||!/^lifeos_dialogue_live_[a-f0-9]{32}$/.test(parent.databaseName))throw new Error('TERMINAL_ISOLATED_MATERIAL_FAILURE_REQUIRED')
const url=new URL(config.databaseUrl)
if(!['127.0.0.1','localhost','::1'].includes(url.hostname)||decodeURIComponent(url.pathname.slice(1))!=='lifeos')throw new Error('LOCAL_PRIMARY_IDENTITY_REQUIRED')
url.pathname='/'+parent.databaseName;config.databaseUrl=url.href
const {pool}=await import('../server/db.ts'),{localEmbedding}=await import('../server/local-embedding.ts')
const store=await import('../server/store.ts'),{createTurnEngine}=await import('../server/turn-engine.ts')
const budget=new CoachProviderBudget(),runId='coach-diagnostic-'+randomUUID(),directory=resolve('evidence/v1.3-action-coach/diagnostic',runId),privateDirectory=resolve('.local/v1.3-action-coach',runId)
mkdirSync(directory,{recursive:true});mkdirSync(privateDirectory,{recursive:true})
const report:any={runId,evidence:'REAL_PROVIDER_DIAGNOSTIC_ON_PRIOR_SYNTHETIC_CONTEXT_NOT_TRAJECTORY_ACCEPTANCE',parentPath,sourceDigest,input:failed.input,rawOutputs:[],status:'RUNNING',derivedCommit:false,maximumProviderCalls:2}
const save=()=>writeFileSync(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n')
let run:Awaited<ReturnType<typeof store.startRun>>['run']|undefined
try{
  if((await pool.query('SELECT current_database() AS database')).rows[0].database!==parent.databaseName)throw new Error('ACTUAL_POOL_TARGET_MISMATCH')
  const original=(await pool.query('SELECT * FROM runs WHERE request_id=$1 AND conversation_id=$2',[failed.requestId,failed.conversationId])).rows[0]
  if(original?.status!=='failed'||original.error_code!=='COACH_MATERIAL_NOT_VISIBLE')throw new Error('ACTUAL_TERMINAL_RUN_REQUIRED')
  await localEmbedding.start()
  run=(await store.startRun(original.user_id,original.conversation_id,randomUUID(),failed.input)).run
  const context=(await store.contextForRun(run)).filter(message=>message.id!==original.source_message_id)
  const observer=coachBudgetObserver({runId,freezePath,budget,purpose:'diagnostic'})
  observer.output=(call,text)=>{
    const path=resolve(privateDirectory,call.purpose+'.txt');writeFileSync(path,text,{flag:'wx',mode:0o600})
    report.rawOutputs.push({logicalCallId:call.callId,purpose:call.purpose,path:'.local/v1.3-action-coach/'+runId+'/'+call.purpose+'.txt',sha256:createHash('sha256').update(text).digest('hex')});save()
  }
  const staged:Staged={candidates:[],audit:[]},events:unknown[]=[]
  try{
    const result=await createTurnEngine({providerCallObserver:observer})({run,staged,context,decision:null,signal:new AbortController().signal,emit:event=>events.push(event)})
    report.status='MODEL_OUTPUT_VALIDATED_NOT_COMMITTED';report.reply=result.text;report.stagedEvent=staged.coach;report.usage=result.usage
  }catch(error){report.status='REPRODUCED_FAILURE';report.error=error instanceof Error?error.message:'UNKNOWN';report.usage=staged.modelUsage}
  report.audit=staged.audit;report.events=events;save()
  // This is diagnostic replay, never a saved/accepted trajectory or a rewrite
  // of the prior run. Leave original reply/event/material/version untouched.
  await store.terminateRun(run.user_id,run.request_id,'cancelled','DIAGNOSTIC_NO_DERIVED_COMMIT')
}finally{
  if(run)await store.terminateRun(run.user_id,run.request_id,'cancelled','DIAGNOSTIC_NO_DERIVED_COMMIT')
  await localEmbedding.close();await pool.end()
  report.calls=budget.snapshot().calls.filter((call:any)=>call.runId===runId);report.closedAt=new Date().toISOString();save()
  console.log(JSON.stringify({runId,status:report.status,reportPath:resolve(directory,'report.json'),calls:report.calls.length,derivedCommit:false}))
}
