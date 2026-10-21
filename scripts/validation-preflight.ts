import {existsSync,readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'

// N0.2 zero-network validation preflight. Never sends HTTP, never starts a
// provider, never touches the ledger beyond its existing read-only parse, and
// never prints credential values/prefixes/hashes/lengths — only presence.

type ValidationPreflight={
  baseline:{head:string;dirty:boolean}
  local:'READY'|'BLOCKED'
  bailian:'READY_FOR_AUTHORIZED_PROBE'|'BLOCKED_CREDENTIALS'|'BLOCKED_BUDGET'
  coze:'OFF'|'BLOCKED_CONFIG'|'BLOCKED_TRANSFER_APPROVAL'|'READY_FOR_AUTHORIZED_PROBE'
  missing:string[]
  node:string
  checks:{isolatedRunner:boolean;chromeDriver:boolean;postgresConfig:boolean;sourceFreezeEntry:boolean;ledger:{parsed:boolean;pending:number;fundingRemainingCny:number|null;fundingSource:string|null}}
  freezeOutput?:string
}

const offline=process.argv.includes('--offline')
if(!offline)throw new Error('--offline is required; this preflight never performs network or paid operations.')
const requireBailian=process.argv.includes('--require-bailian')
const freezeOutputFlag=process.argv.indexOf('--freeze-output')
const freezeOutput=freezeOutputFlag>=0?process.argv[freezeOutputFlag+1]:undefined
if(freezeOutputFlag>=0&&(!freezeOutput||freezeOutput.startsWith('--')))throw new Error('--freeze-output requires a path')

const missing:string[]=[]
const root=resolve(fileURLToPath(new URL('..',import.meta.url)))

// Baseline (read-only git).
const git=(...args:string[])=>spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true})
const head=(git('rev-parse','HEAD').stdout??'').trim()
const dirty=(git('status','--porcelain').stdout??'').trim().length>0

// Local dependency presence.
const isolatedRunner=existsSync(resolve(root,'scripts/test-backend-isolated.ts'))
const chromeDriver=Boolean(process.env.PLAYWRIGHT_MODULE&&existsSync(process.env.PLAYWRIGHT_MODULE))||(async()=>{
  // Only checks the known local driver locations; never reads browser profiles.
  try{
    const required=createRequire(import.meta.url)
    required.resolve('playwright')
    return true
  }catch{return existsSync('C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')}
})()
let postgresConfig=false
let serverConfig:Awaited<typeof import('../server/config.ts')>['config']|null=null
try{serverConfig=(await import('../server/config.ts')).config;postgresConfig=Boolean(serverConfig.databaseUrl)}catch{serverConfig=null;postgresConfig=false}
const sourceFreezeEntry=existsSync(resolve(root,'scripts/coach-source-freeze.ts'))&&existsSync(resolve(root,'evidence/v1.3-action-coach/freeze'))

// Work-order companion files (names only).
for(const name of ['GLM_NEXT_EXECUTION_ORDER.md','AUDIT_EVIDENCE.md'])if(!existsSync(resolve(root,'.planning/research/campus-growth',name))&&!existsSync(resolve('C:/Users/LQY/Downloads',name)))missing.push(name)

// Credential PRESENCE only (no values). Approved process-env injection works
// naturally; absence is a config gap, not a platform permission denial.
const credentialPresent=(name:string)=>Boolean(process.env[name]&&String(process.env[name]).trim())
const bailianKey=credentialPresent('DASHSCOPE_API_KEY')||Boolean(serverConfig?.modelTiers.default.provider==='bailian'&&serverConfig.modelTiers.default.apiKey.trim())
const cozePat=credentialPresent('LIFEOS_COZE_PAT')
const cozeWorkflow=credentialPresent('LIFEOS_COZE_WORKFLOW_ID')
const cozeEnabled=process.env.LIFEOS_COZE_KNOWLEDGE==='true'
const cozeTransferApproved=process.env.LIFEOS_COZE_TRANSFER_APPROVED==='true'

// Read-only ledger state via the existing budget parse (no reset, no writes).
let ledger:{parsed:boolean;pending:number;fundingRemainingCny:number|null;fundingSource:string|null}={parsed:false,pending:-1,fundingRemainingCny:null,fundingSource:null}
try{
  const {CoachProviderBudget,activeCoachFunding}=await import('./coach-provider-budget.ts')
  const budget=new CoachProviderBudget()
  const snapshot=budget.snapshot()
  const funding=activeCoachFunding(snapshot)
  ledger={parsed:true,pending:snapshot.calls.filter((call:unknown&{status?:string})=>call&&typeof call==='object'&&(call as {status?:string}).status!=='finished').length,fundingRemainingCny:funding&&!funding.paused&&!funding.runtimeDelegation&&typeof funding.remainingCny==='number'?funding.remainingCny:null,fundingSource:funding?.runtimeDelegation?'runtime_delegated':funding?(snapshot.continuation?'continuation':snapshot.currentGrant?'currentGrant':'additional'):'none'}
}catch{ledger={parsed:false,pending:-1,fundingRemainingCny:null,fundingSource:null}}

const local=(isolatedRunner&&(chromeDriver as boolean)&&postgresConfig&&sourceFreezeEntry&&missing.length===0)?'READY':'BLOCKED'
if(!isolatedRunner)missing.push('scripts/test-backend-isolated.ts')
if(!(chromeDriver as boolean))missing.push('playwright-driver')
if(!postgresConfig)missing.push('server-config-database')
if(!sourceFreezeEntry)missing.push('source-freeze-entry')

const bailian=(!bailianKey)?'BLOCKED_CREDENTIALS':ledger.pending!==0?'BLOCKED_BUDGET':ledger.fundingRemainingCny===null||ledger.fundingRemainingCny<=0?'BLOCKED_BUDGET':'READY_FOR_AUTHORIZED_PROBE'
const coze=(!cozeEnabled)?'OFF':!cozePat||!cozeWorkflow?'BLOCKED_CONFIG':!cozeTransferApproved?'BLOCKED_TRANSFER_APPROVAL':'READY_FOR_AUTHORIZED_PROBE'

const preflight:ValidationPreflight={baseline:{head,dirty},local,bailian,coze,missing,node:process.version,checks:{isolatedRunner,chromeDriver:Boolean(chromeDriver),postgresConfig,sourceFreezeEntry,ledger},...(freezeOutput?{freezeOutput}:{}),...(requireBailian?{requireBailian:true}:{})}

// Optional local freeze capture (no network, no paid calls, no secrets).
if(freezeOutput){
  const {captureCoachSource}=await import('./coach-source-freeze.ts')
  const freeze=captureCoachSource(root)
  const {writeFileSync,mkdirSync}=await import('node:fs')
  mkdirSync(resolve(freezeOutput,'..'),{recursive:true})
  writeFileSync(resolve(freezeOutput),JSON.stringify(freeze,null,2)+'\n')
  preflight.freezeOutput=freezeOutput
}

console.log(JSON.stringify(preflight,null,2))
if(requireBailian&&bailian!=='READY_FOR_AUTHORIZED_PROBE')process.exitCode=2
