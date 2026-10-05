import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
// Assemble per-scenario review packets from an operator log and its run report:
// every user input, actual model reply, growth/event state and failures, in
// submission order, for manual hard-failure review. No verdicts are computed.
const logPath=process.argv[2],reportPath=process.argv[3]
if(!logPath||!reportPath)throw new Error('usage: node campus-review-extract.mjs <operator-log.jsonl> <report.json>')
const entries=readFileSync(logPath,'utf8').trim().split('\n').map(l=>JSON.parse(l))
const report=JSON.parse(readFileSync(reportPath,'utf8'))
const packets={}
for(const turn of report.turns??[]){
  const id=turn.trajectory
  packets[id]??=({scenario:id,turns:[],growthFinal:null})
  const delta=(turn.events??[]).find(e=>e?.value?.type==='delta'&&e?.value?.saved===true)
  packets[id].turns.push({
    index:packets[id].turns.length+1,
    sampleClass:turn.sampleClass,
    conversationId:turn.conversationId,
    input:turn.input,
    status:turn.status,
    error:turn.error??null,
    reply:delta?.value?.text??null,
    meaningfulFirstMs:turn.meaningfulFirstMs??null,
    completionMs:turn.completionMs??null,
    providerCalls:turn.providerCallCount??null,
    growthSavedIds:(turn.growth?.items??[]).map(i=>i.id),
    growthActive:(turn.growth?.items??[]).filter(i=>!i.unavailableReason&&['active','proposed'].includes(i.status)).map(i=>({kind:i.kind,text:i.text,assertion:i.assertion,status:i.status,limitation:i.limitation||null,validUntil:i.validUntil})),
    event:turn.event?{id:turn.event.id,revision:turn.event.revision,nodes:(turn.event.nodes??[]).map(n=>({kind:n.kind,status:n.status,text:n.text})),actions:(turn.event.actions??[]).map(a=>({operation:a.operation,status:a.status,draft:a.draft?.content??null}))}:null,
  })
}
// operator decisions (what the synthetic student chose to reveal and why)
for(const entry of entries){
  const id=entry.scenario??entry.trajectory
  if(!id||!packets[id])continue
  if(entry.event==='answer-step')packets[id].turns.push({operatorDecision:{asked:entry.replyAsked,volunteered:entry.volunteated??false,hidden:entry.hidden}})
  if(entry.event==='operator-retry-once')packets[id].turns.push({operatorDecision:{retryAfterFailure:true}})
  if(entry.event==='forget-step')packets[id].turns.push({operatorDecision:{forget:entry.label,found:entry.found,items:entry.items}})
  if(entry.event==='growthAction-result')packets[id].turns.push({operatorDecision:{growthAction:entry.value}})
}
const outDir=resolve(reportPath,'..','review')
mkdirSync(outDir,{recursive:true})
for(const id of Object.keys(packets))writeFileSync(resolve(outDir,id+'.json'),JSON.stringify(packets[id],null,2)+'\n')
writeFileSync(resolve(outDir,'summary.json'),JSON.stringify({
  runId:report.runId,status:report.status,speed:report.speed??null,mixedCost:report.mixedCost??null,
  scenarios:Object.fromEntries(Object.entries(packets).map(([id,p])=>[id,{turns:p.turns.filter(t=>t.input).length,failed:p.turns.filter(t=>t.status==='FAILED').length}])),
},null,2))
console.log(JSON.stringify({packets:Object.keys(packets).length,outDir}))
