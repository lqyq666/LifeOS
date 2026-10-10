import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {captureCoachSource} from '../../scripts/coach-source-freeze.ts'
import {businessSkillSnapshot} from './skills.ts'
// Captured once at process load. A later disk edit cannot impersonate a running version.
const frozen=captureCoachSource(),skills=businessSkillSnapshot.map(s=>({...s}))
let head='unknown',versionSource='unavailable'
try{head=execFileSync('git',['rev-parse','HEAD'],{stdio:['ignore','pipe','ignore']}).toString().trim();versionSource='git'}catch{
 try{const build=JSON.parse(readFileSync('deploy/build-version.json','utf8'));if(/^[a-f0-9]{40}$/.test(build.commit)){head=build.commit;versionSource='image_build_manifest'}}catch{}
}
export const workflowRuntimeVersion=Object.freeze({service:'LifeOS',head,versionSource,skillVersion:'1.2.2-candidate',mainSkillDigest:createHash('sha256').update(readFileSync('skills/lifeos-personal-companion/SKILL.md')).digest('hex'),workflowVersion:'v2-integration',sourceDigest:createHash('sha256').update(JSON.stringify({source:frozen.digest,skills})).digest('hex'),sourceFreezeDigest:frozen.digest,skills,loadedAt:new Date().toISOString(),contractGeneration:'p4+workflow-v2',growthApi:true})
