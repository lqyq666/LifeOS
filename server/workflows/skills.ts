import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import type {AgentRole,TraceRow} from './trace.ts'
import {WorkflowError} from './contracts.ts'
export const businessSkills=['lifeos-direction-analysis','lifeos-action-review','lifeos-experience-evidence','lifeos-guide-application','lifeos-growth-diff'] as const
export type BusinessSkill=typeof businessSkills[number]
const skillRoot=resolve(import.meta.dirname,'../../skills')
// Frozen with this process, not whichever instructions happen to appear later.
export const businessSkillSnapshot=businessSkills.map(name=>{
 const source=readFileSync(resolve(skillRoot,name,'SKILL.md'),'utf8')
 return {name,sha256:createHash('sha256').update(source).digest('hex'),version:/version:\s*"([^"]+)"/.exec(source)?.[1]??'unknown'}
})
// Read the actual candidate instructions; a directory's existence is not activation evidence.
export function loadBusinessSkill(name:BusinessSkill,traceId:string,trace:{append:(row:TraceRow)=>void;digest:(x:unknown)=>string},root=skillRoot){
 const expected=businessSkillSnapshot.find(s=>s.name===name)!
 let source:string
 try{source=readFileSync(resolve(root,name,'SKILL.md'),'utf8')}catch{
  trace.append({workflowId:'lifeos-workflows',version:2,traceId,agentRole:'skill',inputRefDigest:trace.digest(name),outputRefDigest:trace.digest('unavailable'),usedEvidenceIds:[],latencyMs:0,providerCalls:0,costCny:0,reservedCostCny:0,status:'failed',executionKind:'local_deterministic',skill:name,error:'unavailable'})
  throw new WorkflowError('unavailable')
 }
 const digest=createHash('sha256').update(source).digest('hex'),valid=digest===expected.sha256&&expected.version!=='unknown'
 trace.append({workflowId:'lifeos-workflows',version:2,traceId,agentRole:'skill' as AgentRole,inputRefDigest:trace.digest(name),outputRefDigest:trace.digest(digest),usedEvidenceIds:[],latencyMs:0,providerCalls:0,costCny:0,reservedCostCny:0,status:valid?'succeeded':'failed',executionKind:'local_deterministic',skill:name,skillPhase:'loaded',skillDigest:digest,skillVersion:expected.version,...(!valid?{error:'source_invalid' as const}:{})})
 if(!valid)throw new WorkflowError('source_invalid')
 return {name,digest,version:expected.version,instructions:source}
}
