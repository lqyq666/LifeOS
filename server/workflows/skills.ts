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
 let source:string
 try{source=readFileSync(resolve(skillRoot,name,'SKILL.md'),'utf8')}catch{return {name,sha256:'unavailable',version:'unavailable'}}
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


// Call only after the host has validated the output. This records deterministic
// capability execution, not a model invocation or a committed user action.
export function recordSkillOutput(skill:ReturnType<typeof loadBusinessSkill>,traceId:string,trace:{append:(row:TraceRow)=>void;digest:(x:unknown)=>string},input:unknown,output:unknown,evidenceIds:string[]){
 validateDeclaredSkillOutput(skill,output)
 trace.append({workflowId:'lifeos-workflows',version:2,traceId,agentRole:'skill',skill:skill.name,skillDigest:skill.digest,skillVersion:skill.version,skillPhase:'output_validated',inputRefDigest:trace.digest(input),outputRefDigest:trace.digest(output),usedEvidenceIds:[...new Set(evidenceIds)],latencyMs:0,providerCalls:0,costCny:0,reservedCostCny:0,status:'succeeded',executionKind:'local_deterministic'})
}

// Deterministic Skills execute the output declaration in their frozen body.
// Host evidence/permission checks remain mandatory and cannot be weakened by it.
export function validateDeclaredSkillOutput(skill:ReturnType<typeof loadBusinessSkill>,output:unknown){
 const declared=(label:string)=>skill.instructions.split(/\r?\n/).find(line=>line.startsWith(label))
 const requireFields=(value:unknown,fields:string[])=>{if(!value||typeof value!=='object'||fields.some(field=>!Object.hasOwn(value,field)))throw new WorkflowError('invalid_contract')}
 if(skill.name==='lifeos-growth-diff'){
  const declaration=declared('GrowthDelta v2:')
  if(!declaration?.includes('本人已确认=false')||!declaration.includes('AI观察或proposed=true')||!declaration.includes('没有写权限'))throw new WorkflowError('source_invalid')
  const fields=declaration.slice('GrowthDelta v2:'.length).split('（')[0].split(',').map(field=>field.trim())
  if(!Array.isArray(output))throw new WorkflowError('invalid_contract')
  for(const delta of output)requireFields(delta,fields)
 }else if(skill.name==='lifeos-action-review'){
  const declaration=declared('ActionReview:')
  if(!declaration)throw new WorkflowError('source_invalid')
  requireFields(output,declaration.slice('ActionReview:'.length).replace(/\([^)]*\)/g,'').split(',').map(field=>field.trim()))
 }else if(skill.name==='lifeos-guide-application'){
  const declaration=declared('WorkflowProposal v2；')
  if(!declaration?.includes('nextActions有依据/分钟/stopCondition'))throw new WorkflowError('source_invalid')
  requireFields(output,['nextActions'])
  for(const action of (output as {nextActions:unknown[]}).nextActions)requireFields(action,['evidenceRefs','estimatedMinutes','stopCondition'])
 }
}

export function growthConfirmationPolicy(skill:ReturnType<typeof loadBusinessSkill>,observation:boolean,proposed:boolean){
 // Validate the actual declared rule before using it. Never accept a new rule
 // that could silently treat AI observations as confirmed personal facts.
 validateDeclaredSkillOutput(skill,[])
 const declaration=skill.instructions.split(/\r?\n/).find(line=>line.startsWith('GrowthDelta v2:'))!
 return /AI观察或proposed=true/.test(declaration)&&(observation||proposed)
}
