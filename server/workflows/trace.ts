import {createHmac,randomBytes} from 'node:crypto'
import type {FailureCode} from './contracts.ts'
export const agentRoles=['case_resolver','evidence_guardian','action_reviewer','path_analyst','constraint_validator','independent_critic','decision_synthesizer','skill'] as const
export type AgentRole=typeof agentRoles[number]
export type TraceRow={workflowId:'lifeos-workflows';version:2;traceId:string;agentRole:AgentRole;inputRefDigest:string;outputRefDigest:string;usedEvidenceIds:string[];latencyMs:number;providerCalls:number;costCny:number|null;reservedCostCny:number;status:'started'|'succeeded'|'failed'|'cancelled'|'timeout';executionKind:'local_deterministic'|'simulated_provider'|'real_provider';error?:FailureCode;skill?:string;skillDigest?:string;skillVersion?:string}
export function createTrace(sink:(row:TraceRow)=>void=()=>{}){
 const key=randomBytes(32)
 const digest=(value:unknown)=>createHmac('sha256',key).update(JSON.stringify(value)).digest('hex')
 const rows:TraceRow[]=[]
 const append=(row:TraceRow)=>{const copy=structuredClone(row);rows.push(copy);if(rows.length>512)rows.splice(0,rows.length-512);try{sink(structuredClone(copy))}catch{/* Observers have no permission to alter execution. */}}
 return {digest,append,rows}
}
