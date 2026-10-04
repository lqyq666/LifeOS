import {mkdirSync,writeFileSync,existsSync,copyFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {stream,type AssistantMessage} from '@mariozechner/pi-ai'
import {resolveModel,modelSignatureFor,coachContractSignatureFor,coachInterfaceSignatureFor,type ModelTier} from '../server/model.ts'
import {buildTurnPrompt,providerTurnMessages,turnSystemPrompt} from '../server/turn-prompt.ts'
import {parseActionCoachTurn} from '../server/action-coach-contracts.ts'
import {renderCoachReply} from '../server/coach-reply.ts'
import {configureProviderPayload,outputTokenLimit} from '../server/model-payload.ts'
import {estimateProviderCallCostCny,maximumProviderCallCostCny} from '../server/cost-workload.ts'
import {redactProbeText,redactProbeValue,probeErrorCategory} from './probe-diagnostics.ts'
import {CoachProviderBudget,readCoachAuthorization} from './coach-provider-budget.ts'
import {assertCoachSourceFreeze} from './coach-source-freeze.ts'

const args=process.argv.slice(2),arg=(name:string)=>args[args.indexOf(name)+1]
const requested=process.env.LIFEOS_MODEL_PROBE_TIER??(args.includes('--tier')?arg('--tier'):'default')
if(!['default','reasoning'].includes(requested))throw new Error('Use --tier default or reasoning')
if(!args.includes('--paid'))throw new Error('This is a paid probe. Review the frozen source/configuration and remaining budget, then explicitly invoke --paid. No provider call was made.')
const freezePath=args.includes('--freeze')?arg('--freeze'):undefined
if(!freezePath||freezePath.startsWith('--'))throw new Error('A reviewed source/configuration freeze is required: --freeze <path>. No provider call was made.')
const sourceDigest=assertCoachSourceFreeze(freezePath)
const tier=requested as ModelTier,check=args.includes('--check')?arg('--check'):undefined
if(args.includes('--check')&&(!check||!['R1','R2','R3','R4'].includes(check)))throw new Error('Use --check R1, R2, R3, or R4')
const selected=check?[check]:['R1','R2','R3','R4'],runtime=resolveModel(tier)
if(!runtime.available)throw new Error('MISSING_OR_PLACEHOLDER_CREDENTIAL')
const authorization=readCoachAuthorization(),budget=new CoachProviderBudget(),funds=budget.snapshot(),maximum=maximumProviderCallCostCny(runtime.model.contextWindow,outputTokenLimit(runtime.model,tier),runtime.pricing)
if(funds.additional?funds.additional.paused||typeof maximum!=='number'||funds.additional.remainingCny<maximum*selected.length:funds.remaining<selected.length)throw new Error('AUTHORIZED_PROVIDER_CALL_BUDGET_EXHAUSTED')
const directory=resolve(process.env.LIFEOS_EVIDENCE??'evidence/v1.3-action-coach/provider'),runId='coach-probe-'+tier+'-'+Date.now()+'-'+randomUUID().slice(0,8)
mkdirSync(directory,{recursive:true})
const path=resolve(directory,runId+'.json'),signature=modelSignatureFor(tier)
const redact=(value:unknown)=>redactProbeText(value,[resolveModel('default').apiKey,resolveModel('reasoning').apiKey])
const serialize=(value:unknown)=>JSON.stringify(redactProbeValue(value,[resolveModel('default').apiKey,resolveModel('reasoning').apiKey]),null,2)+'\n'
const report:any={at:new Date().toISOString(),runId,status:'RUNNING',evidence:'REAL_PROVIDER_API',contract:'action-coach-v1.3',sourceFreeze:{path:resolve(freezePath),digest:sourceDigest},contractSignature:coachContractSignatureFor(tier),interfaceSignature:coachInterfaceSignatureFor(tier),signature,tier,provider:runtime.model.provider,model:runtime.model.id,maxRetries:0,authorization,checks:{},calls:[],note:'Capability/transport evidence only; not A01–A08 quality or the 20-sample speed acceptance.'}
const save=()=>writeFileSync(path,serialize(report))
save()
const messageId='00000000-0000-4000-8000-000000000011'
const inputs={R1:'我有件事想倾诉。先问一个简短问题，暂时只聊天，不建立事件或行动记录。',R2:'请简短解释递归是什么，只回答知识，不需要个人记录或计划。',R3:'我给同学发了资料，他明确说手机打不开，所以没有看。现在我只想问他还需要哪一部分，请直接起草一段可以发送的消息，先不重新制作资料。',R4:'请写一份较长的课程项目准备清单，逐项解释可观察的产物，不调用外部工具。'}
// A declared synthetic API-contract fixture, not a persisted real trajectory.
// R3 must preserve the existing event identity while creating its first material.
const existingEvent={id:'00000000-0000-4000-8000-000000000021',conversationId:'00000000-0000-4000-8000-000000000022',title:'给同学的资料在手机上打不开',revision:3,generation:1,nodes:[],actions:[],asked:[],createdAt:'2026-10-04T00:00:00Z',updatedAt:'2026-10-04T00:00:00Z'}
async function call(id:keyof typeof inputs){
  const started=performance.now(),controller=new AbortController()
  assertCoachSourceFreeze(freezePath!)
  const receipt=budget.reserve({...(typeof maximum==='number'?{reservedCostCny:maximum}:{}),runId,purpose:'capability',tier,provider:runtime.model.provider,model:runtime.model.id,signature,sourceDigest})
  report.calls.push(receipt);save() // Reservation precedes any network request.
  let answer:AssistantMessage|null=null,thrown:unknown,firstMs:number|null=null,deltas=0,cancelled=false
  const timer=setTimeout(()=>controller.abort(),60000)
  try{
    const source=stream(runtime.model,{systemPrompt:turnSystemPrompt(tier==='reasoning'?'reasoning':'default',runtime.model.id),messages:providerTurnMessages(buildTurnPrompt({currentMessageId:messageId,messages:[{id:messageId,role:'user',content:inputs[id]}],currentEvent:id==='R3'?existingEvent:null}),runtime.model)},{apiKey:runtime.apiKey,maxTokens:outputTokenLimit(runtime.model,tier),maxRetries:0,timeoutMs:60000,signal:controller.signal,onPayload:(payload,profile)=>configureProviderPayload(payload,profile,tier,undefined,undefined,outputTokenLimit(runtime.model,tier),messageId,id==='R3'?[existingEvent]:[])})
    for await(const event of source)if(event.type==='text_delta'){
      deltas++;firstMs??=Math.round(performance.now()-started)
      if(id==='R4'&&!cancelled){cancelled=true;controller.abort()}
    }
    answer=await source.result()
  }catch(error){thrown=error}finally{clearTimeout(timer)}
  const text=answer?.content.filter(part=>part.type==='text').map(part=>(part as {text:string}).text).join('')??''
  // Preserve invalid synthetic outputs as well as valid ones. Only text parts
  // are captured; provider reasoning and credentials are never stored here.
  const privateDirectory=resolve('.local/v1.3-action-coach',runId)
  mkdirSync(privateDirectory,{recursive:true})
  writeFileSync(resolve(privateDirectory,id+'.txt'),text,{flag:'wx',mode:0o600})
  report.rawOutputs??=[]
  report.rawOutputs.push({check:id,path:'.local/v1.3-action-coach/'+runId+'/'+id+'.txt',chars:text.length,sha256:createHash('sha256').update(text).digest('hex'),evidence:'ACTUAL_SYNTHETIC_PROBE_TEXT_NOT_REASONING'})
  const stop=answer?.stopReason??'error',usage=answer?.usage as any
  const complete=usage&&[usage.input,usage.output,usage.cacheRead,usage.cacheWrite].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0)&&typeof usage.totalTokens==='number'&&Number.isFinite(usage.totalTokens)&&usage.totalTokens>0
  const recordedUsage=complete?{uncachedInputTokens:usage.input,cacheWriteInputTokens:usage.cacheWrite,cachedInputTokens:usage.cacheRead,outputTokens:usage.output}:null
  const cost=complete&&runtime.pricing?estimateProviderCallCostCny(usage.input+usage.cacheWrite,usage.cacheRead,usage.output,runtime.pricing):'unknown'
  const finished=budget.finish(receipt.callId,{outcome:stop,usage:recordedUsage??'unknown',estimatedCostCny:typeof cost==='number'?cost:'unknown',providerResponseId:answer?.responseId??null})
  report.calls[report.calls.length-1]=finished;save()
  assertCoachSourceFreeze(freezePath!)
  let result:ReturnType<typeof parseActionCoachTurn>|undefined
  try{result=parseActionCoachTurn(text)}catch{}
  const diagnostics={stopReason:stop,elapsedMs:Math.round(performance.now()-started),firstRawDeltaMs:firstMs,deltas,usage:recordedUsage??'unknown',estimatedCostCny:cost,callId:receipt.callId,cancelledAfterDelta:cancelled,errorCategory:thrown||stop==='error'?probeErrorCategory(redact(answer?.errorMessage??thrown)):null}
  if(id==='R1')report.checks.streaming={passed:stop==='stop'&&deltas>1&&Boolean(result&&/[\u4e00-\u9fff]/.test(result.reply)),...diagnostics,reply:result?.reply??null,note:'Raw delta timing is transport evidence, not meaningful first content.'}
  if(id==='R2')report.checks.freeOutput={passed:stop==='stop'&&Boolean(result&&!result.event&&!result.background?.length&&!result.experienceCandidate&&!result.citations?.length),...diagnostics,reply:result?.reply??null,output:result??null}
  if(id==='R3'){
    const target=result?.event?.target,action=result?.event?.action
    const validSource=target?.operation==='continue'&&target.eventId===existingEvent.id&&target.expectedRevision===existingEvent.revision
    const nodesValid=(result?.event?.nodes??[]).every(node=>node.kind==='unknown'||node.source.messageId===messageId&&inputs.R3.includes(node.source.quote))
    const material=action&&'draft'in action?action.draft.content:null
    const candidate=result?.experienceCandidate?.source,candidateValid=!candidate||candidate.messageId===messageId&&inputs.R3.includes(candidate.quote)
    const rendered=result?renderCoachReply(result):null
    report.checks.actionOutput={passed:stop==='stop'&&Boolean(result&&validSource&&nodesValid&&candidateValid&&action?.operation==='create'&&material&&rendered?.includes(material)&&!result.citations?.length),...diagnostics,fixture:{evidence:'SYNTHETIC_API_CONTRACT_STATE_NOT_PERSISTED_TRAJECTORY',eventId:existingEvent.id,revision:existingEvent.revision},output:result??null,renderedReply:rendered,note:'Existing event identity/revision, exact new source and one authoritative material. Optional candidate remains unconfirmed. Final quality still needs trajectory review.'}
  }
  if(id==='R4')report.checks.cancel={passed:cancelled&&stop==='aborted',...diagnostics,note:'Provider final billing is unknown unless nonempty usage is actually reported.'}
  save();console.log(JSON.stringify({check:id,tier,passed:Object.values(report.checks).at(-1)&& (Object.values(report.checks).at(-1) as any).passed,elapsedMs:diagnostics.elapsedMs}))
}
try{for(const id of selected)await call(id as keyof typeof inputs)}catch(error){report.errorCategory=probeErrorCategory(redact(error));report.status='FAIL';save();throw error}
report.status=Object.values(report.checks).every((value:any)=>value.passed===true)?check?'CHECK_PASS':'PASS':'FAIL'
report.authorizationAfter=budget.snapshot().remaining;save()
if(report.status==='PASS'){
  const capability=resolve(directory,`coach-capabilities-${tier}.json`)
  if(existsSync(capability))copyFileSync(capability,resolve(directory,`coach-capabilities-${tier}-previous-${Date.now()}.json`))
  writeFileSync(capability,serialize(report))
}
console.log(JSON.stringify({status:report.status,tier,reportPath:path,newCalls:report.calls.length,remaining:report.authorizationAfter}))
if(!['PASS','CHECK_PASS'].includes(report.status))process.exitCode=1
