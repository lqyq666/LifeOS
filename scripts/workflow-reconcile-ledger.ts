import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {CoachProviderBudget} from './coach-provider-budget.ts'
const path='.local/v1.3-action-coach/paid/provider-calls.json',before=readFileSync(path),budget=new CoachProviderBudget(),ledger=budget.snapshot()
const outstanding=ledger.calls.filter((call:any)=>call.status!=='finished').map((call:any)=>{
 const requestId=String(call.logicalCallId??'').split(':')[0],reportPath='evidence/v1.3-action-coach/real/'+call.runId+'/report.json',report=existsSync(reportPath)?JSON.parse(readFileSync(reportPath,'utf8')):null,turn=report?.turns?.find((x:any)=>x.requestId===requestId)
 const raw='.local/v1.3-action-coach/'+call.runId+'/raw-'+requestId+'-turn.txt'
 return {callId:call.callId,runId:call.runId,logicalCallId:call.logicalCallId,startedAt:call.startedAt,reservedCostCny:call.reservedCostCny,status:call.status,reportPath,reportStatus:report?.status??null,turnStatus:turn?.status??null,terminalTurnUsagePresent:Boolean(turn?.usage),rawOutputPresent:existsSync(raw),resolution:'UNRESOLVED_USAGE_UNKNOWN_KEEP_RESERVATION_NO_RESEND_NO_ZERO_SETTLEMENT'}
})
if(!readFileSync(path).equals(before))throw new Error('Read-only reconciliation modified the unique ledger')
const report={at:new Date().toISOString(),scope:'READ_ONLY_UNIQUE_PROVIDER_LEDGER',ledgerPath:path,sha256:createHash('sha256').update(before).digest('hex'),calls:ledger.calls.length,finished:ledger.calls.filter((x:any)=>x.status==='finished').length,outstanding,currentGrant:{limitCny:ledger.currentGrant?.limitCny,accountedCny:ledger.currentGrant?.accountedCny,remainingCny:ledger.currentGrant?.remainingCny,paused:ledger.currentGrant?.paused},newPaidCalls:0,ledgerModified:false,providerBillingBalanceVerified:false}
writeFileSync('.planning/research/workflow-integration/evidence/LEDGER_RECONCILIATION.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
