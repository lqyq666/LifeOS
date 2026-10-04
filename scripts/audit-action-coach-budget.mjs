import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)))
const directory=path.join(root,'evidence/v1.2.1-reliability/20261003-authorized300-11')
const ledger=JSON.parse(fs.readFileSync(path.join(directory,'PROVIDER_AUTHORIZATION.json'),'utf8'))
const unique=new Set(),calls=[],reports=[]
for(const run of ledger.runs){
  const bytes=fs.readFileSync(path.join(directory,run.report))
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==run.reportSha256)throw Error('Historical report hash mismatch: '+run.id)
  const report=JSON.parse(bytes)
  const entries=report.scenarios.flatMap(s=>s.turns.flatMap(t=>t.usage?.calls??[]))
  if(entries.length!==run.observedCalls)throw Error('Historical call count mismatch: '+run.id)
  for(const call of entries){
    if(!call.callId||unique.has(call.callId))throw Error('Missing or duplicate call ID')
    unique.add(call.callId);calls.push(call)
  }
  reports.push({id:run.id,calls:entries.length,hashVerified:true})
}
if(calls.length!==ledger.observedStarts)throw Error('Ledger total mismatch')
const remaining=ledger.batchMaximumCalls-calls.length-(ledger.unknownInterruptedCallMaximum??0)-(ledger.reservedMaximumActiveRun??0)
if(remaining!==ledger.unreservedRemaining||remaining<0)throw Error('Remaining authorization mismatch')
const unknown=calls.filter(call=>typeof call.estimatedCostCny!=='number').length
const known=Number(calls.reduce((sum,call)=>sum+(typeof call.estimatedCostCny==='number'?call.estimatedCostCny:0),0).toFixed(7))
if(unknown!==ledger.unknownUsageCalls||known!==ledger.knownEstimatedSubtotalCny)throw Error('Usage subtotal mismatch')
console.log(JSON.stringify({status:'VERIFIED_HISTORICAL_LEDGER',observedStarts:calls.length,remaining,unknownUsageCalls:unknown,knownCostLowerBoundCny:known,activeRun:ledger.activeRun,reports,historicalFilesModified:false},null,2))
