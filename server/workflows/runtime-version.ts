import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {captureCoachSource} from '../../scripts/coach-source-freeze.ts'
import {businessSkillSnapshot} from './skills.ts'
// Captured once at process load. A later disk edit cannot impersonate a running version.
const frozen=captureCoachSource(),skills=businessSkillSnapshot.map(s=>({...s}))
let head='unknown';try{head=execFileSync('git',['rev-parse','HEAD'],{stdio:['ignore','pipe','ignore']}).toString().trim()}catch{}
export const workflowRuntimeVersion=Object.freeze({service:'LifeOS',head,skillVersion:'1.2.2-candidate',mainSkillDigest:createHash('sha256').update(readFileSync('skills/lifeos-personal-companion/SKILL.md')).digest('hex'),workflowVersion:'v2-integration',sourceDigest:createHash('sha256').update(JSON.stringify({source:frozen.digest,skills})).digest('hex'),sourceFreezeDigest:frozen.digest,skills,loadedAt:new Date().toISOString(),contractGeneration:'p4+workflow-v2',growthApi:true})
