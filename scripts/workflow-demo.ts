import {mkdirSync,writeFileSync,appendFileSync,readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {fixture,simulatedDecision} from '../tests/workflows/fixtures.ts'
import {createDirectionWorkflow} from '../server/workflows/direction-decision.ts'
import {reviewAction,type ActionCase} from '../server/workflows/action-review.ts'
import {createActionWorkflow} from '../server/workflows/action-workflow.ts'
import {parseRequest} from '../server/workflows/contracts.ts'
const root='.planning/research/agent-workflows',out=root+'/evidence'
mkdirSync(out,{recursive:true})
const previousFlag=process.env.LIFEOS_ADVANCED_WORKFLOWS
process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
try{
 const f=fixture(),sink=(row:unknown)=>appendFileSync(out+'/DEMO_SIMULATED_TRACES.jsonl',JSON.stringify(row)+'\n')
 const started=performance.now(),direction=await createDirectionWorkflow(async()=>f.records,simulatedDecision(),sink).run(f.request)
 const steps:unknown[]=[{scene:'深入比较三个方向',evidence:'SIMULATED_PROVIDER_ACTUAL_LOCAL_DAG',receipt:direction}]
 const c:ActionCase={eventId:f.request.eventId!,revision:1,object:'学长甲',request:'项目课是否能补实习作品证据',known:{sent:false,read:false,replied:false,used:false,effect:null},usage:[],answeredQuestions:[]}
 for(const text of ['我愿意试这个方法。','我已经发了消息，三天还没有回复。','我不想继续了。']){
  const r=parseRequest({...f.request,mode:'action_review',requestId:randomUUID(),traceId:randomUUID(),currentIntent:text,consent:{continueReview:true,deepAnalysis:false},budget:null,directions:[],modelBudget:{maxProviderCalls:0,maxCostCny:0,deadlineMs:1000},authorizedEvidenceRefs:[f.request.authorizedEvidenceRefs[0],{...f.request.authorizedEvidenceRefs[1],quote:text}]})
  const records=f.records.map(x=>x.ref.type==='message'?{...x,text}:x),current=r.authorizedEvidenceRefs[1]
  const reviewed=await createActionWorkflow(async()=>records,sink).run(r,[c],current)
  if(!reviewed.review)throw new Error('DEMO_WORKFLOW_UNAVAILABLE')
  steps.push({scene:text,evidence:'LOCAL_DETERMINISTIC_SYNTHETIC_CONTEXT_NO_PERSISTENCE',receipt:reviewed.receipt,feedback:reviewed.review.feedback,reply:reviewed.review.reply,stages:reviewed.review.stages})
  c.known=reviewed.review.stages
  if(reviewed.review.feedback)c.usage.push({status:reviewed.review.feedback,source:current})
 }
 const pgEvidence=readFileSync(out+'/G2_MAIN_ENTRY.jsonl','utf8').trim().split('\n').map(x=>JSON.parse(x)).at(-1)
 const report={schemaVersion:2,title:'LifeOS 唯一伙伴：方向候选与行动反馈',status:'LOCAL_CANDIDATE_NOT_ACCEPTED',privateData:false,actualPaidCalls:0,actualPaidCostCny:0,elapsedMs:performance.now()-started,steps,verifiedSeparately:pgEvidence,cozeCurrentCandidate:'NOT_WRITTEN_BUDGET_GATE',realProviderComparison:'NOT_TESTED'}
 writeFileSync(out+'/DEMO_RUN.json',JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify({status:report.status,steps:steps.length,actualPaidCalls:0,evidence:out+'/DEMO_RUN.json',note:'Deep adapters are simulated; actual native SDK and DB feedback evidence is separate.'}))
}finally{if(previousFlag===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=previousFlag}
