import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import type {AgentRole,TraceRow} from './trace.ts'
export const businessSkills=['lifeos-direction-analysis','lifeos-action-review','lifeos-experience-evidence','lifeos-guide-application','lifeos-growth-diff'] as const
export type BusinessSkill=typeof businessSkills[number]
// Read the actual candidate instructions; a directory's existence is not activation evidence.
export function loadBusinessSkill(name:BusinessSkill,traceId:string,trace:{append:(row:TraceRow)=>void;digest:(x:unknown)=>string},root=resolve(import.meta.dirname,'../../skills')){
 const source=readFileSync(resolve(root,name,'SKILL.md'),'utf8'),digest=createHash('sha256').update(source).digest('hex')
 trace.append({workflowId:'lifeos-workflows',version:2,traceId,agentRole:'skill' as AgentRole,inputRefDigest:trace.digest(name),outputRefDigest:trace.digest(digest),usedEvidenceIds:[],latencyMs:0,providerCalls:0,costCny:0,reservedCostCny:0,status:'succeeded',executionKind:'local_deterministic',skill:name,skillDigest:digest})
 return {name,digest,instructions:source}
}
