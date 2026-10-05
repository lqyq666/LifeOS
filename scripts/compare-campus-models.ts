import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {stream} from '@mariozechner/pi-ai'
import {resolveModel,modelSignatureFor} from '../server/model.ts'
import {config} from '../server/config.ts'
import {buildTurnPrompt,providerTurnMessages,turnSystemPrompt} from '../server/turn-prompt.ts'
import {configureProviderPayload,outputTokenLimit} from '../server/model-payload.ts'
import {parseActionCoachTurn} from '../server/action-coach-contracts.ts'
import {renderCoachReply} from '../server/coach-reply.ts'
import {openingQuestionDraft} from '../server/reply-draft.ts'
import {maximumProviderCallCostCny,estimateProviderCallCostCny} from '../server/cost-workload.ts'
import {CoachProviderBudget,activeCoachFunding,comparisonAllowance,type ComparisonRestriction} from './coach-provider-budget.ts'
import {assertCoachSourceFreeze} from './coach-source-freeze.ts'
import {campusComparisonArtifacts} from './campus-benchmark-summary.ts'

// Two preregistered synthetic adult cases. Identical inputs across processes;
// no model-generated answers, hidden personal data, persisted success or retries.
export const campusComparisonCases=[
  {id:'limited-time-income',text:'我是20岁的大二学生，目前没有确定职业方向。团队项目拿了奖，但我只做了访谈整理，没有写代码，也不知道自己适不适合技术。本学期每周最多四小时，家里希望我下学期能减轻生活费压力。现在有一个每周十二小时的无薪竞赛队、一份每周六小时且周末要去外地的实习，以及可以在校找学长做一次二十分钟行业访谈。我想保住课程，同时了解哪条方向可能带来稳定收入。请比较这些选择，指出还不知道的关键条件，帮我确定这周能执行且能验证方向的一小步，不要把团队获奖当成我的技术能力。'},
  {id:'research-location-tradeoff',text:'我是21岁的大三学生，正在权衡就业和读研。过去两次独立完成课程数据分析，老师评价分析清楚，但我没有科研经历，不知道是否喜欢长期研究。我每周可投入十小时，不急着增加收入，未来两年希望留在本市陪家人。有本校老师的两周研究体验，每周六小时；外地公司一学期实习，每周十小时且要搬过去；同学邀请我参加全国竞赛，说获奖就能保研，但我没查过本校政策。请比较选择，分清现有能力证据与未知、学校政策与同学说法，并给这周一项可观察反馈的最小行动。不要保证读研或录取，也不要自动把外地实习当成最佳路线。'},
] as const

const args=process.argv.slice(2),at=args.indexOf('--freeze'),freeze=at>=0?args[at+1]:undefined
if((!args.includes('--paid')&&!args.includes('--preflight'))||!freeze||freeze.startsWith('--')||args.includes('--paid')&&args.includes('--preflight'))throw new Error('Choose --paid or --preflight and require --freeze; no provider call made')
const sourceDigest=assertCoachSourceFreeze(freeze),runtime=resolveModel('default'),budget=new CoachProviderBudget()
const limit=outputTokenLimit(runtime.model,'default'),maximum=maximumProviderCallCostCny(runtime.model.contextWindow,limit,runtime.pricing)
const funding=activeCoachFunding(budget.snapshot())
const restriction:ComparisonRestriction=JSON.parse(readFileSync(resolve('.local/campus-growth/comparison-restriction-20261005.json'),'utf8'))
const snapshot=budget.snapshot(),allowance=snapshot.continuation?{remainingCalls:null,remainingCny:snapshot.continuation.remainingCny,accountedCny:snapshot.continuation.accountedCny}:comparisonAllowance(snapshot,restriction)
if(args.includes('--preflight')){
  console.log(JSON.stringify({evidence:'LOCAL_PREFLIGHT_ZERO_PROVIDER_CALLS',model:runtime.model.id,thinkingBudget:config.qwenThinkingBudget,sourceDigest,credentialAvailable:runtime.available,maximumPerCallCny:maximum,maximumCohortCny:typeof maximum==='number'?maximum*campusComparisonCases.length:null,remainingCny:funding?.remainingCny??null,comparisonAllowance:allowance,caseIds:campusComparisonCases.map(fixture=>fixture.id),maxRetries:0,persistence:'NONE'}))
  process.exit(0)
}
if(!runtime.available)throw new Error('MISSING_OR_PLACEHOLDER_CREDENTIAL')
if(!funding||funding.paused||typeof maximum!=='number'||funding.remainingCny<maximum*campusComparisonCases.length||allowance.remainingCalls!==null&&allowance.remainingCalls<campusComparisonCases.length||allowance.remainingCny<maximum*campusComparisonCases.length)throw new Error('AUTHORIZED_PROVIDER_CALL_BUDGET_EXHAUSTED')
const directory=resolve(process.env.LIFEOS_EVIDENCE??'.local/campus-growth/comparisons'),runId='campus-comparison-'+Date.now()+'-'+randomUUID().slice(0,8)
mkdirSync(directory,{recursive:true})
const report={runId,evidence:'REAL_PROVIDER_SYNTHETIC_DIAGNOSTIC_NOT_SAVED_TRAJECTORY',model:runtime.model.id,thinkingBudget:config.qwenThinkingBudget,sourceDigest,maxRetries:0,quality:'PENDING_MANUAL_REVIEW',cases:[] as Record<string,unknown>[],fundingAfter:funding}
const reportPath=resolve(directory,runId+'.json'),save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n')
save()
for(const fixture of campusComparisonCases){
  assertCoachSourceFreeze(freeze)
  const messageId='00000000-0000-4000-8000-000000000011',started=performance.now(),controller=new AbortController()
  const receipt=budget.reserve({runId,purpose:'diagnostic',tier:'default',provider:runtime.model.provider,model:runtime.model.id,signature:modelSignatureFor('default'),sourceDigest,reservedCostCny:maximum},restriction)
  const entry:Record<string,unknown>={id:fixture.id,input:fixture.text,callId:receipt.callId,status:'RESERVED',inputHash:createHash('sha256').update(fixture.text).digest('hex')}
  report.cases.push(entry);save()
  let raw='',firstRawDeltaMs:number|null=null,firstCandidateContentMs:number|null=null,answer:Awaited<ReturnType<ReturnType<typeof stream>['result']>>|undefined,failed=false
  const timer=setTimeout(()=>controller.abort(),60000)
  try{
    const events=stream(runtime.model,{systemPrompt:turnSystemPrompt('default',runtime.model.id),messages:providerTurnMessages(buildTurnPrompt({currentMessageId:messageId,messages:[{id:messageId,role:'user',content:fixture.text,created_at:'2026-10-05T12:00:00Z'}],currentEvent:null}),runtime.model)},{apiKey:runtime.apiKey,maxTokens:limit,maxRetries:0,timeoutMs:60000,signal:controller.signal,onPayload:(payload,profile)=>configureProviderPayload(payload,profile,'default',undefined,undefined,limit,messageId,[],[],config.qwenThinkingBudget)})
    for await(const event of events)if(event.type==='text_delta'){
      raw+=event.delta;firstRawDeltaMs??=Math.round(performance.now()-started)
      if(firstCandidateContentMs===null&&openingQuestionDraft(raw))firstCandidateContentMs=Math.round(performance.now()-started)
    }
    answer=await events.result();failed=answer.stopReason!=='stop'
  }catch{failed=true}finally{clearTimeout(timer)}
  // Only answer text is written; reasoning deltas/content and error messages
  // never enter logs. Normalized output usage includes billed reasoning tokens.
  const text=answer?.content.filter(part=>part.type==='text').map(part=>part.text).join('')??raw
  const usage=answer?.usage,complete=Boolean(usage&&[usage.input,usage.output,usage.cacheRead,usage.cacheWrite,usage.totalTokens].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0)&&usage.totalTokens>0)
  const cost=complete&&runtime.pricing?estimateProviderCallCostCny(usage!.input+usage!.cacheWrite,usage!.cacheRead,usage!.output,runtime.pricing):'unknown'
  const recorded=complete?{uncachedInputTokens:usage!.input,cacheWriteInputTokens:usage!.cacheWrite,cachedInputTokens:usage!.cacheRead,outputTokens:usage!.output}:'unknown'
  const finished=budget.finish(receipt.callId,{outcome:answer?.stopReason??'error',usage:recorded,estimatedCostCny:typeof cost==='number'?cost:'unknown',providerResponseId:answer?.responseId??null})
  let parsed:ReturnType<typeof parseActionCoachTurn>|null=null
  try{parsed=parseActionCoachTurn(text)}catch{}
  Object.assign(entry,{status:failed?'FAILED':parsed?'PARSED_NOT_COMMITTED':'INVALID_OUTPUT',elapsedMs:Math.round(performance.now()-started),firstRawDeltaMs,firstCandidateContentMs,candidateTimingNote:'Provisional reply prefix; must be manually reviewed for meaningfulness, never ordinary speed acceptance.',usage:recorded,estimatedCostCny:cost,conservativelyAccountedCny:typeof cost==='number'?cost:finished.reservedCostCny,output:parsed,answerText:text,renderedReply:parsed?renderCoachReply(parsed):null,quality:'PENDING_MANUAL_REVIEW',transactionValidation:'NOT_RUN',repairCalls:0})
  entry.artifactPresence=campusComparisonArtifacts(parsed)
  report.fundingAfter=activeCoachFunding(budget.snapshot())!;save()
  console.log(JSON.stringify({id:fixture.id,model:runtime.model.id,thinkingBudget:config.qwenThinkingBudget,status:entry.status,elapsedMs:entry.elapsedMs,estimatedCostCny:cost}))
  assertCoachSourceFreeze(freeze)
  if(failed)throw new Error('COMPARISON_STOPPED_AFTER_FAILED_REQUEST_NO_RETRY')
}
console.log(JSON.stringify({reportPath,remainingCny:report.fundingAfter.remainingCny}))
