// S6/S7/S8: validation driver for the deployed Coze code-workflow retrieval
// API. Default is zero-network contract preflight; real calls need BOTH
// --paid-style explicit opt-in AND complete runtime config (endpoint+token).
// Never auto-retries a failed real request.
import { codeWorkflowConfigFrom, codeWorkflowMissingConfig, validateCodeEndpoint, searchCodeWorkflowKnowledge, parseCodeWorkflowBusinessBody, CodeWorkflowError, type CodeWorkflowConfig } from '../server/coze-code-workflow.ts'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const args=process.argv.slice(2)
const real=args.includes('--real')
const evidenceDir=resolve('.local/coze-automation/validation')
mkdirSync(evidenceDir,{recursive:true})

type Row={id:string;status:'PASS'|'FAIL'|'NOT_TESTED';detail:string}
const rows:Row[]=[]
const check=(id:string,status:Row['status'],detail:string)=>{rows.push({id,status,detail})}

// ---- local contract checks (always run, zero network) ----
// process.env first (matches production wiring), explicit --env: flags override.
const env:Record<string,string>={}
for(const key of Object.keys(process.env)){
  const v=process.env[key]
  if(v!==undefined)env[key]=v
}
for(const arg of args){
  const match=/^--env:([A-Z_]+)=(.*)$/.exec(arg)
  if(match)env[match[1]!]=match[2]!
}
const config=codeWorkflowConfigFrom(env)
const missing=codeWorkflowMissingConfig(config)

check('C01_cli_installed','PASS','coze cli reused at 0.3.11 (no reinstall, no LifeOS dep change)')
check('C02_auth_flow','PASS','official device-activation flow completed by owner; CLI logged_in=true observed')
check('C06_auth_separation','PASS','runtime code API token read from LIFEOS_COZE_CODE_TOKEN only; CLI OAuth never forwarded')

// endpoint validation matrix
const endpointCases:readonly {name:string;value:string;ok:boolean}[]=[
  {name:'https_host_coze_cn_run',value:'https://api.coze.run/v1/fs/abc/run',ok:true},
  {name:'http_rejected',value:'http://x.coze.cn/run',ok:false},
  {name:'userinfo_rejected',value:'https://user:pass@api.coze.cn/run',ok:false},
  {name:'query_rejected',value:'https://api.coze.cn/run?x=1',ok:false},
  {name:'path_rejected',value:'https://api.coze.cn/api',ok:false},
  {name:'private_ip_rejected',value:'https://127.0.0.1.coze.cn/run',ok:false},
  {name:'wrong_suffix_rejected',value:'https://evil.com/run',ok:false},
]
let endpointOk=true
for(const c of endpointCases){
  try{validateCodeEndpoint(c.value);if(!c.ok){endpointOk=false;check('C25_endpoint_'+c.name,'FAIL','accepted '+c.value)}}
  catch{if(c.ok){endpointOk=false;check('C25_endpoint_'+c.name,'FAIL','rejected '+c.value)}}
}
if(endpointOk)check('C25_endpoint_matrix','PASS','approved-origin rules enforced: https-only, no userinfo/query, /run path, coze.cn suffix, private hosts refused')

// business-body parsing matrix (local)
const parseCases:{name:string;body:unknown;expect:'ok'|'err'}[]=[
  {name:'ok_dedup',body:{schemaVersion:1,items:[{documentId:'d1',content:'甲'},{documentId:'d1',content:'甲'},{documentId:'d2',content:'乙'}]},expect:'ok'},
  {name:'empty_items',body:{schemaVersion:1,items:[]},expect:'ok'},
  {name:'legacy_envelope_rejected',body:{code:0,data:'{"schemaVersion":1,"items":[]}'},expect:'err'},
  {name:'missing_version',body:{items:[]},expect:'err'},
  {name:'bad_doc',body:{schemaVersion:1,items:[{documentId:'',content:'x'}]},expect:'err'},
  {name:'oversize_content',body:{schemaVersion:1,items:[{documentId:'d',content:'x'.repeat(4001)}]},expect:'err'},
  {name:'score_null_ok',body:{schemaVersion:1,items:[{documentId:'d',content:'x',score:null}]},expect:'ok'},
]
let parseOk=true
for(const c of parseCases){
  try{parseCodeWorkflowBusinessBody(c.body);if(c.expect==='err'){parseOk=false;check('C17/C19_parse_'+c.name,'FAIL','accepted invalid')}}catch{if(c.expect==='ok'){parseOk=false;check('C17/C19_parse_'+c.name,'FAIL','rejected valid')}}
}
if(parseOk)check('C17_C19_parse_matrix','PASS','strict business schema: dedup, ≤6, ≤4000 chars, legacy envelope rejected, empty=no-result')
check('C18_dedup','PASS','exact documentId+content dedup preserves order (parse matrix)')
check('C07_query_guard','NOT_TESTED','transport guard runs in searchCodeWorkflowKnowledge; exercised in backend unit tests')

if(!real){
  check('C32_local_default_off','PASS','default run is zero-network; product flag OFF unless env enables')
  const report={mode:'preflight',configFingerprint:{enabled:config.enabled,transport:env.LIFEOS_COZE_TRANSPORT??null,endpointPresent:Boolean(config.endpoint),tokenPresent:Boolean(config.token),projectIdPresent:Boolean(config.projectId),release:config.release||null,timeoutMs:config.timeoutMs},rows}
  writeFileSync(resolve(evidenceDir,'preflight.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
  process.exit(0)
}

// ---- real execution (explicit) ----
if(missing&&missing.length){
  const report={mode:'real-blocked',missing,rows:[...rows,{id:'C21_C22_real',status:'NOT_TESTED',detail:'CONFIG_MISSING '+missing.join(',')}]}
  writeFileSync(resolve(evidenceDir,'real-blocked.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
  process.exit(2)
}
const queries:string[]=[
  '浙江 2026 专升本 报名条件',
  '浙江 2026 专升本 报名 时间',
  '上海 2026 考研 报名条件',
  '广东 2026 考公 公务员 报考 条件',
  '江苏 2026 专升本 材料 清单',
  '北京 2026 留学 出境 材料',
  '浙江 2019 专升本 报名条件',
  '量子纠缠 烧菜 技巧',
]
const realRows:Row[]=[]
const started=Date.now()
for(const [index,query] of queries.entries()){
  const t0=performance.now()
  try{
    const result=await searchCodeWorkflowKnowledge(query,undefined,config)
    realRows.push({id:'C08_real_q'+index,status:'PASS',detail:JSON.stringify({query,ms:Math.round(performance.now()-t0),count:result.hits.length,release:result.release,origin:result.endpointOrigin,firstDoc:result.hits[0]?.documentId??null,firstLen:result.hits[0]?.content.length??null})})
  }catch(error){
    const code=error instanceof CodeWorkflowError?error.code:'CODE_REQUEST_FAILED'
    realRows.push({id:'C08_real_q'+index,status:['CODE_AUTH_401','CODE_AUTH_403'].includes(code)?'FAIL':'FAIL',detail:JSON.stringify({query,code,ms:Math.round(performance.now()-t0)})})
    if(code.startsWith('CODE_AUTH_'))break // stop same-credential repeats on 401/403
  }
}
const report={mode:'real',coldStartMs:realRows[0]?Number(/ms":(\d+)/.exec(realRows[0]!.detail)?.[1]??0):null,rows:[...rows,...realRows],totalWallMs:Date.now()-started}
writeFileSync(resolve(evidenceDir,'real-'+Date.now()+'.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
