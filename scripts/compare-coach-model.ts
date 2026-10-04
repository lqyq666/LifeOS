import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {Client} from 'pg'
import {stream,type AssistantMessage} from '@mariozechner/pi-ai'
import {config} from '../server/config.ts'
import {resolveModel,modelSignatureFor} from '../server/model.ts'
import {buildTurnPrompt,providerTurnMessages,turnSystemPrompt} from '../server/turn-prompt.ts'
import {configureProviderPayload,outputTokenLimit} from '../server/model-payload.ts'
import {parseActionCoachTurn} from '../server/action-coach-contracts.ts'
import {renderCoachReply} from '../server/coach-reply.ts'
import {estimateProviderCallCostCny,maximumProviderCallCostCny} from '../server/cost-workload.ts'
import {assertCoachSourceFreeze} from './coach-source-freeze.ts'
import {CoachProviderBudget} from './coach-provider-budget.ts'

if(!process.argv.includes('--paid'))throw new Error('Explicit --paid required; no model call made')
const option=(name:string)=>{const i=process.argv.indexOf(name),value=process.argv[i+1];if(i<0||!value||value.startsWith('--'))throw new Error(name+' required');return value}
const freezePath=resolve(option('--freeze')),sourceDigest=assertCoachSourceFreeze(freezePath)
const parentPath=resolve(option('--report')),parent=JSON.parse(readFileSync(parentPath,'utf8')),last=process.argv.includes('--request')?parent.turns.find((turn:any)=>turn.requestId===option('--request')):parent.turns.at(-1)
const payloadTier=process.argv.includes('--thinking')?'reasoning':'default'
const temperatureZero=process.argv.includes('--temperature-zero')
if(temperatureZero&&payloadTier==='reasoning')throw new Error('TEMPERATURE_DIAGNOSTIC_REQUIRES_NON_THINKING')
const naturalQwen=process.argv.includes('--natural-qwen')
if(naturalQwen&&(temperatureZero||payloadTier==='reasoning'))throw new Error('NATURAL_QWEN_COMPARISON_REQUIRES_DEFAULT_MODE')
if(!parent.closedAt||last?.status!=='SAVED'||!last.event||last.event.revision<2||!/^lifeos_dialogue_live_[a-f0-9]{32}$/.test(parent.databaseName))throw new Error('TERMINAL_ISOLATED_SAVED_CONTEXT_REQUIRED')
const url=new URL(config.databaseUrl)
if(!['127.0.0.1','localhost','::1'].includes(url.hostname)||decodeURIComponent(url.pathname.slice(1))!=='lifeos')throw new Error('LOCAL_PRIMARY_IDENTITY_REQUIRED')
url.pathname='/'+parent.databaseName
const configuredTier=naturalQwen?'default':'reasoning',route=resolveModel(configuredTier)
if(!route.available||route.model.provider!=='bailian'||route.model.id!==(naturalQwen?'qwen3.8-flash':'deepseek-v4.1-flash'))throw new Error('EXISTING_AUTHORIZED_ROUTE_REQUIRED')
const client=new Client({connectionString:url.href})
let prompt:string
await client.connect()
try{
  await client.query('BEGIN READ ONLY')
  if((await client.query('SELECT current_database() AS database')).rows[0].database!==parent.databaseName)throw new Error('ACTUAL_ISOLATED_DATABASE_REQUIRED')
  const run=(await client.query('SELECT * FROM runs WHERE request_id=$1 AND conversation_id=$2',[last.requestId,last.conversationId])).rows[0]
  if(run?.status!=='completed')throw new Error('ACTUAL_SAVED_RUN_REQUIRED')
  const current=(await client.query('SELECT * FROM messages WHERE user_id=$1 AND id=$2 AND role=\'user\'',[run.user_id,run.source_message_id])).rows[0]
  if(current?.content!==last.input)throw new Error('ACTUAL_INPUT_MISMATCH')
  const messages=(await client.query('SELECT id,role,content,created_at FROM messages WHERE user_id=$1 AND conversation_id=$2 AND created_at<=(SELECT created_at FROM messages WHERE user_id=$1 AND id=$3::uuid) ORDER BY created_at,id',[run.user_id,last.conversationId,run.source_message_id])).rows
  const previous=(await client.query('SELECT snapshot FROM coach_event_revisions WHERE user_id=$1 AND event_id=$2 AND revision=$3',[run.user_id,last.event.id,last.event.revision-1])).rows[0]?.snapshot?.event
  if(!previous||previous.id!==last.event.id||previous.revision!==last.event.revision-1)throw new Error('PRE_TURN_EVENT_SNAPSHOT_REQUIRED')
  prompt=buildTurnPrompt({currentMessageId:run.source_message_id,messages,currentEvent:previous})
  await client.query('ROLLBACK')
}finally{await client.end()}
const runId='coach-model-comparison-'+randomUUID(),directory=resolve('evidence/v1.3-action-coach/diagnostic',runId)
mkdirSync(directory,{recursive:true})
const report:any={runId,evidence:'REAL_PROVIDER_SINGLE_CALL_COMPARISON_ON_READ_ONLY_PRE_TURN_SYNTHETIC_CONTEXT_NOT_TRAJECTORY_ACCEPTANCE',parentPath,sourceDigest,status:'RUNNING',input:last.input,baselineReply:last.done?.reply??last.events.filter((item:any)=>item.value.type==='delta'&&item.value.saved).map((item:any)=>item.value.text).join(''),baselineUsage:last.done?.usage,route:{provider:route.model.provider,model:route.model.id,configuredTier:'reasoning',mode:payloadTier==='reasoning'?'thinking_low':'non_thinking',payloadTier,schemaDelivery:'full_schema_in_system_JSON_object'},contextLimits:'Exact saved pre-turn event and prior dialogue. No retrieval/profile/knowledge reconstruction; diagnostic only.',databaseWrites:0,derivedCommit:false,maximumCalls:1,automaticRetry:false}
const save=()=>writeFileSync(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n')
report.requestedTemperature=temperatureZero?0:'provider_default';report.temperatureEffectVerified=false
if(naturalQwen){report.route={provider:route.model.provider,model:route.model.id,configuredTier,mode:'non_thinking',payloadTier:'default',schemaDelivery:'NO_RESPONSE_FORMAT_NATURAL_ONLY_DIAGNOSTIC'};report.contextLimits+=' Natural-only diagnostic additionally removes event/material output obligations; output-task difference is a confound, not trajectory acceptance.';report.requestedTemperature=0}
save()
const budget=new CoachProviderBudget(),maximum=maximumProviderCallCostCny(route.model.contextWindow,outputTokenLimit(route.model,payloadTier),route.pricing),receipt=budget.reserve({...(typeof maximum==='number'?{reservedCostCny:maximum}:{}),runId,purpose:'diagnostic',tier:configuredTier,provider:route.model.provider,model:route.model.id,signature:modelSignatureFor(configuredTier),sourceDigest})
let answer:AssistantMessage|null=null,error=false,firstRawDeltaMs:number|null=null
const controller=new AbortController(),started=performance.now(),timer=setTimeout(()=>controller.abort(),60000)
try{
  assertCoachSourceFreeze(freezePath)
  const systemPrompt=naturalQwen?turnSystemPrompt('default',route.model.id)+'\n本次为只读自然语言对照，不保存任何事件或材料。输出格式以这条对照要求为准：只输出对用户的自然中文回应，不输出JSON、Schema或字段；承接原事情，只问一个关键未知信息。':turnSystemPrompt('reasoning')
  const events=stream(route.model,{systemPrompt,messages:providerTurnMessages(prompt!,route.model)},{apiKey:route.apiKey,maxTokens:outputTokenLimit(route.model,payloadTier),maxRetries:0,timeoutMs:60000,signal:controller.signal,onPayload:(payload,profile)=>{const configured=configureProviderPayload(payload,profile,payloadTier,undefined,undefined,outputTokenLimit(route.model,payloadTier)) as Record<string,unknown>;if(naturalQwen)delete configured.response_format;return temperatureZero?{...configured,temperature:0}:configured}})
  for await(const event of events)if(event.type==='text_delta')firstRawDeltaMs??=Math.round(performance.now()-started)
  answer=await events.result()
}catch{error=true}finally{
  clearTimeout(timer)
  const usage=answer?.usage,complete=usage&&[usage.input,usage.output,usage.cacheRead,usage.cacheWrite,usage.totalTokens].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0)&&usage.totalTokens>0
  const cost=complete&&route.pricing?estimateProviderCallCostCny(usage.input+usage.cacheWrite,usage.cacheRead,usage.output,route.pricing):'unknown'
  report.call=budget.finish(receipt.callId,{outcome:answer?.stopReason??'error',usage:complete?{uncachedInputTokens:usage.input,cacheWriteInputTokens:usage.cacheWrite,cachedInputTokens:usage.cacheRead,outputTokens:usage.output}:'unknown',estimatedCostCny:cost,providerResponseId:answer?.responseId??null})
  report.firstRawDeltaMs=firstRawDeltaMs;report.completionMs=Math.round(performance.now()-started)
  const text=answer?.content.filter(part=>part.type==='text').map(part=>(part as {text:string}).text).join('')??''
  const privateDirectory=resolve('.local/v1.3-action-coach',runId)
  mkdirSync(privateDirectory,{recursive:true})
  const rawPath=resolve(privateDirectory,'raw.txt')
  writeFileSync(rawPath,text,{mode:0o600})
  report.rawOutput={path:rawPath,chars:text.length,sha256:createHash('sha256').update(text).digest('hex'),kind:'ACTUAL_TEXT_ONLY_NOT_REASONING_NOT_CREDENTIALS'}
  if(naturalQwen){report.reply=text;report.status=!error&&answer?.stopReason==='stop'&&text.trim()?'NATURAL_ONLY_DIAGNOSTIC_NOT_COMMITTED':'PROVIDER_FAILED'}
  else try{report.output=parseActionCoachTurn(text);report.reply=renderCoachReply(report.output);report.status=!error&&answer?.stopReason==='stop'?'OUTPUT_SHAPE_VALID_NOT_COMMITTED':'PROVIDER_FAILED'}catch{report.status='PROVIDER_OR_OUTPUT_FAILED'}
  report.closedAt=new Date().toISOString();save()
}
assertCoachSourceFreeze(freezePath)
console.log(JSON.stringify({runId,status:report.status,path:resolve(directory,'report.json'),calls:1,databaseWrites:0,derivedCommit:false}))

