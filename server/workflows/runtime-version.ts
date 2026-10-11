import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {captureCoachSource} from '../../scripts/coach-source-freeze.ts'
import {businessSkillSnapshot} from './skills.ts'
// Captured once at process load. A later disk edit cannot impersonate a running version.
const frozen=captureCoachSource(),skills=businessSkillSnapshot.map(s=>({...s}))
const contentHash=createHash('sha256').update(readFileSync('.planning/research/evergreen/KB_GUIDES.jsonl')).digest('hex')
const sourceRegistryHash=createHash('sha256').update(readFileSync('.planning/research/evergreen/KB_SOURCE_REGISTRY.jsonl')).digest('hex')
const contentEvidenceHash=createHash('sha256').update(readFileSync('.planning/research/evergreen/KB_EVIDENCE.jsonl')).digest('hex')
let head='unknown',versionSource='unavailable'
try{head=execFileSync('git',['rev-parse','HEAD'],{stdio:['ignore','pipe','ignore']}).toString().trim();versionSource='git'}catch{
 try{const build=JSON.parse(readFileSync('deploy/build-version.json','utf8'));if(/^[a-f0-9]{40}$/.test(build.commit)){head=build.commit;versionSource='image_build_manifest'}}catch{}
}
export const workflowRuntimeVersion=Object.freeze({service:'LifeOS',head,versionSource,skillVersion:'1.2.2-candidate',mainSkillDigest:createHash('sha256').update(readFileSync('skills/lifeos-personal-companion/SKILL.md')).digest('hex'),workflowVersion:'v2-integration',sourceDigest:createHash('sha256').update(JSON.stringify({source:frozen.digest,skills})).digest('hex'),sourceFreezeDigest:frozen.digest,contentHash,sourceRegistryHash,contentEvidenceHash,skills,loadedAt:new Date().toISOString(),contractGeneration:'p4+workflow-v2',growthApi:true})

// Capture the configured remote implementation once, without retaining tokens.
const canonical=JSON.parse(readFileSync('.planning/research/workflow-integration/COZE_CANONICAL_PUBLIC_ASSETS.json','utf8'))
const approvedSubsetHash=createHash('sha256').update(canonical.cards.map((c:Record<string,unknown>)=>createHash('sha256').update(String(c.claim??'')+'\n'+String(c.excerpt??'')+'\n'+(Array.isArray(c.mechanisms)?c.mechanisms:[]).map(String).join(' ')+'\n'+String(c.limitations??'')).digest('hex')).sort().join('')).digest('hex')
function configuredRemoteBinding():Readonly<Record<string,string>>|undefined{
 try{
  const path=process.env.LIFEOS_COZE_GROWTH_CONFIG;if(!path)return undefined
  const cfg=JSON.parse(readFileSync(path,'utf8')),binding=cfg.binding
  if(cfg.projectId!=='7693388932939300905'||!binding||binding.hostSourceDigest!==workflowRuntimeVersion.sourceDigest||binding.contentHash!==contentHash||!/^[a-f0-9]{40}$/.test(binding.cloudCommit)||![binding.cloudSourceDigest,binding.skillsDigest].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)))return undefined
  return Object.freeze({hostSourceDigest:workflowRuntimeVersion.sourceDigest,cloudCommit:binding.cloudCommit,cloudSourceDigest:binding.cloudSourceDigest,canonicalContentHash:contentHash,canonicalSourceRegistryHash:sourceRegistryHash,canonicalEvidenceHash:contentEvidenceHash,approvedSubsetHash,fullCorpusHash:contentHash,candidateRelease:'0.2.0-candidate',skillsDigest:binding.skillsDigest})
 }catch{return undefined}
}
export const workflowRemoteRuntimeBinding=configuredRemoteBinding()
export function remoteReceiptBindingMatches(actual:unknown,expected:Readonly<Record<string,string>>|undefined=workflowRemoteRuntimeBinding):boolean{
 if(!expected||!actual||typeof actual!=='object'||Array.isArray(actual))return false
 const record=actual as Record<string,unknown>,keys=Object.keys(expected)
 return Object.keys(record).length===keys.length&&keys.every(k=>record[k]===expected[k])
}
// Code, source registry, evidence, approved subset and remote bytes all gate adoption.
export const workflowAdoptionVersionDigest=createHash('sha256').update(JSON.stringify({sourceDigest:workflowRuntimeVersion.sourceDigest,canonicalContentHash:contentHash,sourceRegistryHash,contentEvidenceHash,canonicalApprovedAssetHash:createHash('sha256').update(readFileSync('.planning/research/workflow-integration/COZE_CANONICAL_PUBLIC_ASSETS.json')).digest('hex'),fullCorpusHash:contentHash,candidateRelease:'0.2.0-candidate',mainSkillDigest:workflowRuntimeVersion.mainSkillDigest,skills,remoteRuntimeBinding:workflowRemoteRuntimeBinding??null})).digest('hex')
