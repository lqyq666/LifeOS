// S8: same-query comparison — deployed Coze retrieval vs existing local
// retrieval, over labelled public queries (positive / synonym / English
// category / wrong year / irrelevant). Local side is the engine's own
// retrieveCoachKnowledge against the configured (read-only) DB.
// Real Coze calls require explicit env config; absent config ⇒ exit 2 with
// CONFIG_MISSING, never a silent mock.
import { searchCodeWorkflowKnowledge, codeWorkflowConfigFrom, codeWorkflowMissingConfig, CodeWorkflowError, type CodeWorkflowConfig } from '../server/coze-code-workflow.ts'
import { retrieveCoachKnowledge } from '../server/coach-knowledge.ts'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

type Label='positive'|'synonym'|'english_category'|'wrong_year'|'irrelevant'
type Case={label:Label;query:string}

const cases:readonly Case[]=[
  {label:'positive',query:'浙江 2026 专升本 报名条件'},
  {label:'positive',query:'浙江 2026 专升本 报名 时间'},
  {label:'positive',query:'上海 2026 考研 报名条件'},
  {label:'positive',query:'广东 2026 考公 公务员 报考 条件'},
  {label:'positive',query:'江苏 2026 专升本 材料 清单'},
  {label:'positive',query:'北京 2026 留学 出境 材料'},
  {label:'synonym',query:'浙江 2026 专接本 报考资格'},          // C09: 专接本=专升本同义
  {label:'synonym',query:'统招专升本 怎么备考 方法'},            // C09: 同义表达+方法类
  {label:'english_category',query:'undergraduate_upgrade 2026 Zhejiang requirements'}, // C10: 后端英文类别渲染
  {label:'english_category',query:'postgraduate_exam requirements 2026'},              // C10
  {label:'wrong_year',query:'浙江 2019 专升本 报名条件'},        // C12: 错年度
  {label:'irrelevant',query:'量子纠缠 烧菜 技巧'},               // C11: 完全无关
]

const config=codeWorkflowConfigFrom(process.env)
const missing=codeWorkflowMissingConfig(config)
if(missing&&missing.length){
  console.log(JSON.stringify({mode:'blocked',missing}))
  process.exit(2)
}

type CozeItem={documentId:string;score:number|null;contentLen:number;contentHead:string}
type Row={label:Label;query:string;coze:{ok:true;ms:number;count:number;items:CozeItem[]}|{ok:false;code:string;ms:number};local:{count:number;cardIds:string[];claims:string[]}}

const rows:Row[]=[]
for(const c of cases){
  const t0=performance.now()
  let coze:Row['coze']
  try{
    const result=await searchCodeWorkflowKnowledge(c.query,undefined,config as CodeWorkflowConfig)
    coze={ok:true,ms:Math.round(performance.now()-t0),count:result.hits.length,items:result.hits.map(hit=>({documentId:hit.documentId,score:hit.score??null,contentLen:hit.content.length,contentHead:hit.content.slice(0,150)}))}
  }catch(error){
    coze={ok:false,code:error instanceof CodeWorkflowError?error.code:'CODE_REQUEST_FAILED',ms:Math.round(performance.now()-t0)}
  }
  // Local baseline: the engine's own retrieval over the configured DB.
  let local:Row['local']={count:0,cardIds:[],claims:[]}
  try{
    const cards=await retrieveCoachKnowledge(c.query)
    local={count:cards.length,cardIds:cards.map(card=>card.id),claims:cards.map(card=>card.claim)}
  }catch(error){
    local={count:-1,cardIds:[],claims:['LOCAL_ERROR:'+String(error).slice(0,120)]}
  }
  rows.push({label:c.label,query:c.query,coze,local})
}

// C21: single wrong-token probe — must FAIL loudly, and the loop below must
// not repeat the same credential after an auth failure.
let c21:{status:'FAIL_FAST'|'UNEXPECTED';code:string;repeatBlocked:boolean}|null=null
{
  const t=performance.now()
  let code=''
  try{
    await searchCodeWorkflowKnowledge('probe',undefined,{...config,token:'invalid-probe-token'} as CodeWorkflowConfig)
    c21={status:'UNEXPECTED',code:'NO_ERROR_RAISED',repeatBlocked:false}
  }catch(error){
    code=error instanceof CodeWorkflowError?error.code:'CODE_REQUEST_FAILED'
    const authFail=['CODE_AUTH_401','CODE_AUTH_403'].includes(code)
    // engine contract: auth errors stop same-credential repeats (verified in
    // unit tests); here we only assert the error class is an auth failure.
    c21={status:authFail?'FAIL_FAST':'UNEXPECTED',code,repeatBlocked:authFail}
  }
  void t
}

const dir=resolve('.local/coze-automation/validation')
mkdirSync(dir,{recursive:true})
const report={
  mode:'real-comparison',
  generatedAt:new Date().toISOString(),
  endpoint:config.endpoint,
  transport:'code_workflow',
  caseSummary:rows.map(r=>({label:r.label,query:r.query,cozeOk:r.coze.ok,cozeCount:r.coze.ok?r.coze.count:0,cozeMs:r.coze.ms,localCount:r.local.count})),
  c21,
  rows,
}
writeFileSync(resolve(dir,'comparison-'+Date.now()+'.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify({mode:'real-comparison',cases:rows.length,c21,endpoint:config.endpoint},null,2))
