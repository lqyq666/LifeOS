import {createHash} from 'node:crypto'
import {readFileSync,readdirSync,lstatSync,realpathSync,existsSync} from 'node:fs'
import {resolve,relative,sep} from 'node:path'
import {coachContractSignatureFor,coachInterfaceSignatureFor,modelSignatureFor,resolveModel} from '../server/model.ts'
import {config} from '../server/config.ts'
import {embeddingSignature} from '../server/embedding-signature.ts'

const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex')
export function captureCoachSource(root=process.cwd()){
  const base=realpathSync(root),files:{path:string;sha256:string}[]=[]
  function visit(path:string){
    if(lstatSync(path).isSymbolicLink())throw new Error('SOURCE_FREEZE_SYMLINK_REJECTED')
    const exact=realpathSync(path)
    if(!exact.startsWith(base+sep))throw new Error('SOURCE_FREEZE_PATH_INVALID')
    if(lstatSync(exact).isDirectory()){for(const entry of readdirSync(exact).sort())visit(resolve(exact,entry));return}
    files.push({path:relative(base,exact).replaceAll('\\','/'),sha256:hash(readFileSync(exact))})
  }
  for(const directory of ['server','scripts','src','tests','public','deploy','skills'])if(existsSync(resolve(base,directory)))visit(resolve(base,directory))
  for(const entry of readdirSync(base).sort())if(/^(?:package(?:-lock)?\.json|tsconfig.*\.json|vite\.config\..*|index\.html|AGENTS\.md|PRODUCT\.md|Dockerfile|compose\.yaml|\.dockerignore)$/.test(entry))visit(resolve(base,entry))
  for(const name of ['OBJECTIVE_V1_3_ACTION_COACH.md','GOAL_V1_3_ACTION_COACH.txt'])if(existsSync(resolve(base,'docs/v1.3-action-coach',name)))visit(resolve(base,'docs/v1.3-action-coach',name))
  for(const name of ['source-verification.json','verified-method-cards.json'])if(existsSync(resolve(base,'evidence/v1.3-action-coach/research',name)))visit(resolve(base,'evidence/v1.3-action-coach/research',name))
  if(existsSync(resolve(base,'.planning/research/evergreen/KB_RETRIEVAL_EXPRESSIONS.json')))visit(resolve(base,'.planning/research/evergreen/KB_RETRIEVAL_EXPRESSIONS.json'))
  files.sort((a,b)=>a.path.localeCompare(b.path))
  for(const required of ['package.json','server/turn-engine.ts','server/action-coach-contracts.ts','src/backend/client.ts'])if(!files.some(file=>file.path===required))throw new Error('SOURCE_FREEZE_INCOMPLETE')
  const runtime={node:process.version,platform:process.platform,arch:process.arch,embedding:embeddingSignature,generationConcurrency:config.generationConcurrency,generationQueueLimit:config.generationQueueLimit,access:{entitlementsEnabled:config.entitlementsEnabled,providerBudgetEnabled:config.providerBudgetEnabled,providerBudgetId:config.providerBudgetId,signupEnabled:config.signupEnabled},models:(['default','reasoning'] as const).map(tier=>{const route=resolveModel(tier);return {tier,provider:route.model.provider,model:route.model.id,available:route.available,signature:modelSignatureFor(tier),contractSignature:coachContractSignatureFor(tier),interfaceSignature:coachInterfaceSignatureFor(tier),pricing:route.pricing}})}
  const comparison={qwenThinkingBudget:config.qwenThinkingBudget}
  const exactRuntime={...runtime,comparison}
  return {kind:'FROZEN_SOURCE_AND_RUNTIME_CONFIG' as const,files,runtime:exactRuntime,digest:hash(JSON.stringify({files,runtime:exactRuntime}))}
}
export function assertCoachSourceFreeze(path:string,root=process.cwd()){
  const frozen=JSON.parse(readFileSync(path,'utf8')),current=captureCoachSource(root)
  if(frozen.kind!==current.kind||frozen.digest!==current.digest||hash(JSON.stringify({files:frozen.files,runtime:frozen.runtime}))!==frozen.digest)throw new Error('COACH_SOURCE_OR_CONFIG_CHANGED')
  return current.digest
}
