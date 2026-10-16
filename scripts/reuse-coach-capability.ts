import {readFileSync,writeFileSync} from 'node:fs'
import {resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {coachCapabilityReuseProof,type ModelTier} from '../server/model.ts'

const args=process.argv.slice(2),reportArg=args[args.indexOf('--report')+1],tierArg=args[args.indexOf('--tier')+1]
if(!args.includes('--report')||!reportArg||!args.includes('--tier')||!['default','reasoning'].includes(tierArg)||!args.includes('--write-proof'))throw new Error('Use --report <existing report> --tier default|reasoning --write-proof. No provider calls are made.')
const base=resolve('evidence/v1.3-action-coach'),path=resolve(reportArg)
if(!path.startsWith(base+sep))throw new Error('CAPABILITY_REPORT_PATH_INVALID')
const reportBytes=readFileSync(path),report=JSON.parse(reportBytes.toString())
const proof=coachCapabilityReuseProof(report,tierArg as ModelTier)
const freezePath=resolve(report.sourceFreeze?.path??'')
if(!freezePath.startsWith(base+sep))throw new Error('CAPABILITY_FREEZE_PATH_INVALID')
const freeze=JSON.parse(readFileSync(freezePath,'utf8'))
if(freeze.digest!==report.sourceFreeze.digest||createHash('sha256').update(JSON.stringify({files:freeze.files,runtime:freeze.runtime})).digest('hex')!==freeze.digest)throw new Error('CAPABILITY_FREEZE_CORRUPTED')
const ledger=JSON.parse(readFileSync('.local/v1.3-action-coach/paid/provider-calls.json','utf8'))
if(!report.calls.every((call:any)=>ledger.calls.some((receipt:any)=>receipt.callId===call.callId&&receipt.status==='finished'&&receipt.purpose==='capability'&&receipt.signature===report.signature&&receipt.sourceDigest===freeze.digest)))throw new Error('CAPABILITY_RECEIPTS_NOT_VERIFIED')
const proofPath=path+'.interface-proof.json'
writeFileSync(proofPath,JSON.stringify({...proof,at:new Date().toISOString(),originalReportSha256:createHash('sha256').update(reportBytes).digest('hex'),sourceDigest:freeze.digest,providerCalls:0,note:'Local equivalence evidence only. Original API report and receipts are unchanged; new business behavior still requires its own regression and acceptance.'},null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({proofPath,providerCalls:0,originalReportUnchanged:true}))
