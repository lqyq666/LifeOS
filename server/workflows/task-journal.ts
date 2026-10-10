import {randomUUID,createHash} from 'node:crypto'
import {transaction} from '../db.ts'
import {WorkflowError,type WorkflowRequest,type WorkflowReceipt,type AgentResult} from './contracts.ts'
import type {WorkflowNode} from './orchestrator.ts'

export type TaskClaim={owned:boolean;receipt:WorkflowReceipt|null}
export interface TaskJournal{
 durable:boolean
 claim(request:WorkflowRequest,digest:string):Promise<TaskClaim>
 finish(request:WorkflowRequest,receipt:WorkflowReceipt):Promise<void>
 startNode(request:WorkflowRequest,node:WorkflowNode):Promise<string>
 finishNode(request:WorkflowRequest,node:string,result:AgentResult|null,cost:number|null,calls:number,error?:string):Promise<void>
 cancelled(request:WorkflowRequest):Promise<boolean>
}
// Only for explicitly synthetic/no-wire tests. Production always supplies the PostgreSQL journal.
export function simulationJournal():TaskJournal{
 const tasks=new Map<string,{digest:string;receipt:WorkflowReceipt|null}>(),nodes=new Set<string>()
 const key=(r:WorkflowRequest)=>r.internalActorKey+':'+r.requestId
 return {durable:false,async claim(r,digest){const old=tasks.get(key(r));if(old){if(old.digest!==digest)throw new WorkflowError('request_conflict');return {owned:false,receipt:structuredClone(old.receipt)}}tasks.set(key(r),{digest,receipt:null});return {owned:true,receipt:null}},async finish(r,receipt){tasks.get(key(r))!.receipt=structuredClone(receipt)},async startNode(r,node){const id=key(r)+':'+node.id;if(nodes.has(id))throw new WorkflowError('request_conflict');nodes.add(id);return node.callId??randomUUID()},async finishNode(){},async cancelled(){return false}}
}
export function postgresJournal():TaskJournal{
 return {durable:true,
  claim:(r,digest)=>transaction(async c=>{
   const created=await c.query(`INSERT INTO lifeos_workflow_tasks(user_id,request_id,conversation_id,trace_id,input_digest,source_snapshot,request_payload,status,deadline_at)
    SELECT $1,$2,$3,$4,$5,$6,$8,'running',now()+$7*interval '1 millisecond'
    WHERE EXISTS(SELECT 1 FROM conversations WHERE id=$3 AND user_id=$1)
    ON CONFLICT DO NOTHING RETURNING request_id`,[r.internalActorKey,r.requestId,r.conversationId,r.traceId,digest,JSON.stringify(r.authorizedEvidenceRefs),r.modelBudget.deadlineMs,JSON.stringify(r)])
   const task=(await c.query('SELECT *,deadline_at<now() AS expired FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2 FOR UPDATE',[r.internalActorKey,r.requestId])).rows[0]
   if(!task)throw new WorkflowError('scope_denied')
   if(task.input_digest!==digest)throw new WorkflowError('request_conflict')
   if(task.status==='queued'&&!task.cancel_requested&&!task.expired){
    await c.query("UPDATE lifeos_workflow_tasks SET status='running' WHERE user_id=$1 AND request_id=$2",[r.internalActorKey,r.requestId])
    return {owned:true,receipt:null}
   }
   if((task.status==='running'||task.status==='queued')&&(task.expired||task.cancel_requested&&task.status==='queued')){
    const nodes=(await c.query('SELECT * FROM lifeos_workflow_nodes WHERE user_id=$1 AND request_id=$2',[r.internalActorKey,r.requestId])).rows
    const paid=nodes.filter(n=>n.execution_kind!=='local_deterministic'),unknown=paid.some(n=>n.cost_cny===null)
    const receipt:WorkflowReceipt={schemaVersion:2,traceId:task.trace_id,status:'unavailable',failure:task.cancel_requested?'cancelled':'timeout',providerCalls:paid.length,costCny:unknown?null:paid.reduce((sum,n)=>sum+Number(n.cost_cny),0),reservedCostCny:paid.reduce((sum,n)=>sum+Number(n.max_cost_cny),0),executionKind:paid.some(n=>n.execution_kind==='real_provider')?'real_provider':paid.length?'simulated_provider':'local_deterministic',skills:[],fallback:'existing_single_agent'}
    // Expiry never makes an opaque call eligible for retry.
    await c.query("UPDATE lifeos_workflow_nodes SET status='unknown' WHERE user_id=$1 AND request_id=$2 AND status='dispatched'",[r.internalActorKey,r.requestId])
    await c.query("UPDATE lifeos_workflow_tasks SET status='finished',receipt=$3,finished_at=now() WHERE user_id=$1 AND request_id=$2",[r.internalActorKey,r.requestId,JSON.stringify(receipt)])
    return {owned:false,receipt}
   }
   return {owned:Boolean(created.rowCount),receipt:task.receipt as WorkflowReceipt|null}
  }),
  finish:(r,receipt)=>transaction(async c=>{await c.query("UPDATE lifeos_workflow_tasks SET status='finished',receipt=$3,finished_at=now() WHERE user_id=$1 AND request_id=$2 AND status IN ('queued','running')",[r.internalActorKey,r.requestId,JSON.stringify(receipt)])}),
  startNode:(r,n)=>transaction(async c=>{
   const task=(await c.query('SELECT status,cancel_requested,deadline_at<now() AS expired FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2 FOR UPDATE',[r.internalActorKey,r.requestId])).rows[0]
   if(!task||task.status!=='running'||task.cancel_requested||task.expired)throw new WorkflowError(task?.cancel_requested?'cancelled':'timeout')
   const id=n.callId??randomUUID(),inserted=await c.query(`INSERT INTO lifeos_workflow_nodes(user_id,request_id,node_id,execution_kind,role,max_cost_cny,status,call_id,input_ref_digest,provider_calls)
    VALUES($1,$2,$3,$4,$7,$5,'dispatched',$6,$8,$9) ON CONFLICT DO NOTHING RETURNING call_id`,[r.internalActorKey,r.requestId,n.id,n.executionKind,n.maxCostCny,id,n.role,createHash('sha256').update(JSON.stringify({refs:r.authorizedEvidenceRefs,node:n.id,requestDigest:r.hostSnapshot??null})).digest('hex'),n.executionKind==='local_deterministic'?0:1])
   if(!inserted.rowCount)throw new WorkflowError('request_conflict')
   return id
  }),
  finishNode:(r,node,result,cost,calls,error)=>transaction(async c=>{await c.query(`UPDATE lifeos_workflow_nodes SET status=$4,result=$5,cost_cny=$6,provider_calls=$7,error=$8,finished_at=now(),output_ref_digest=$9
   WHERE user_id=$1 AND request_id=$2 AND node_id=$3 AND status='dispatched'`,[r.internalActorKey,r.requestId,node,error?(cost===null?'unknown':'failed'):'succeeded',result?JSON.stringify(result):null,cost,calls,error??null,createHash('sha256').update(JSON.stringify(result??{error:error??'unknown'})).digest('hex')])}),
  cancelled:r=>transaction(async c=>Boolean((await c.query('SELECT cancel_requested OR deadline_at<=now() AS cancelled FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2',[r.internalActorKey,r.requestId])).rows[0]?.cancelled))
 }
}
