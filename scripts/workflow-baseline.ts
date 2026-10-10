import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,statSync} from 'node:fs'
import {resolve,relative} from 'node:path'

const root=resolve('D:/aaaLife/LifeOS'),out=resolve(root,'.planning/research/agent-workflows')
const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trimEnd()
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex')
mkdirSync(resolve(out,'evidence'),{recursive:true})
if(existsSync(resolve(out,'G0_BASELINE.json')))throw new Error('BASELINE_ALREADY_FROZEN')
const status=git('status','--porcelain=v1','-uall').split('\n').filter(Boolean)
const protectedFiles=status.flatMap(line=>{const file=line.slice(3);const p=resolve(root,file);return existsSync(p)&&statSync(p).isFile()?[{file,status:line.slice(0,2),sha256:hash(p)}]:[]})
const typeLog=readFileSync(resolve(out,'evidence/g0-server-typecheck.log'),'utf8')
const errors=typeLog.split('\n').filter(x=>x.includes('error TS'))
const ledgerPath=resolve(root,'.local/v1.3-action-coach/paid/provider-calls.json')
const ledger=JSON.parse(readFileSync(ledgerPath,'utf8'))
// Persist only aggregate, nonpersonal fields. Never copy the authoritative ledger.
const ledgerShape=Array.isArray(ledger)?'array':Object.keys(ledger)
const rows=Array.isArray(ledger)?ledger:Array.isArray(ledger.calls)?ledger.calls:[]
const statusCounts:Record<string,number>={}
for(const row of rows){const state=String(row.status??row.state??'UNKNOWN');statusCounts[state]=(statusCounts[state]??0)+1}
const skillFiles=['skills/lifeos-personal-companion/SKILL.md','C:/Users/LQY/.codex/skills/lifeos-personal-companion/SKILL.md','C:/Users/LQY/.agents/skills/lifeos-personal-companion/SKILL.md']
const skills=skillFiles.filter(p=>existsSync(resolve(root,p))).map(p=>({file:p,sha256:hash(resolve(root,p))}))
const baseline={checkedAt:new Date().toISOString(),root,head:git('rev-parse','HEAD'),branch:git('branch','--show-current'),status:'READY_FOR_CONTRACT_ONLY',integration:'INTEGRATION_BLOCKED',protectedFiles,serverTypecheck:{errors:errors.length,classes:[...new Set(errors.map(x=>x.replace(/\(\d+,\d+\)/,'(LINE)')))]},ledger:{path:relative(root,ledgerPath),sha256:hash(ledgerPath),shape:ledgerShape,count:rows.length,statusCounts,paidGate:'BLOCKED_UNSETTLED_RECEIPT_AND_BALANCE_UNVERIFIED'},skills,featureDefault:false,otherTask:{id:'01a123aa-875b-7173-b270-43189e53240f',state:'idle',checkpoint:'Coze integration freeze and existing delivery package; no Git commit for dirty files; no shared integration authorized by checkpoint alone'},knowledge:{approved:16,needsReview:16,covered:53,total:112,status:'WIP_NOT_READY',humanRelease:'PENDING'},networkAndWriteSideEffects:{paidCalls:0,cloudWrite:false,productionWrite:false}}
writeFileSync(resolve(out,'G0_BASELINE.json'),JSON.stringify(baseline,null,2)+'\n')
writeFileSync(resolve(out,'AGENT_WORKFLOW_BASELINE.md'),`# G0 基线保护\n\n状态：READY_FOR_CONTRACT_ONLY / INTEGRATION_BLOCKED。\n\nHEAD ${baseline.head}；分支 ${baseline.branch}。已冻结 ${protectedFiles.length} 个已有脏文件的 SHA256，完整列表见 G0_BASELINE.json。只新增独立模块、Skill、测试与证据；不修改、暂存或提交原脏文件。\n\n服务端实际 ${errors.length} 条错误，归一化 ${baseline.serverTypecheck.classes.length} 类；原始日志见 evidence/g0-server-typecheck.log。知识 16 approved / 16 needs_review，53/112 覆盖，独立人工审批待办。\n\n唯一付费账本仅聚合读取，没有复制、重置、补零。未结清终态和真实余额核实前零新收费。账本字段核实结果在 G0_BASELINE.json，历史估算不当余额。\n\nCoze 当前管理读、部署指纹、端口与技能差异见 evidence/coze-baseline.json；缺失时为 NOT_VERIFIED。既有部署不能为候选验收背书。\n\n原完整工单保存在 DEVELOPMENT_SPEC.md。主引擎集成、真实模型、云候选与生产放行分别留 Gate，不以独立模块通过代替学生验收。\n`)
console.log(JSON.stringify({head:baseline.head,protectedFiles:protectedFiles.length,errors:errors.length,classes:baseline.serverTypecheck.classes.length,ledgerShape,statusCounts,count:rows.length}))
