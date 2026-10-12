import {randomUUID,createHash} from 'node:crypto'
import {transaction} from '../db.ts'
import {WorkflowError,type WorkflowRequest,type WorkflowReceipt,type AgentResult} from './contracts.ts'
import type {WorkflowNode} from './orchestrator.ts'
import {releasePreparedWorkflowSpend} from '../provider-spend.ts'

export type TaskClaim={owned:boolean;receipt:WorkflowReceipt|null}
export interface TaskJournal{
 durable:boolean
 claim(request:WorkflowRequest,digest:string):Promise<TaskClaim>
 finish(request:WorkflowRequest,receipt:WorkflowReceipt):Promise<WorkflowReceipt|void>
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
    await releasePreparedWorkflowSpend(c,r.internalActorKey,r.requestId)
    const nodes=(await c.query('SELECT * FROM lifeos_workflow_nodes WHERE user_id=$1 AND request_id=$2',[r.internalActorKey,r.requestId])).rows
    const spend=(await c.query('SELECT * FROM lifeos_provider_spend WHERE user_id=$1 AND workflow_request_id=$2',[r.internalActorKey,r.requestId])).rows
    const paid=nodes.filter(n=>n.execution_kind!=='local_deterministic')
    const accounting=paid.map(n=>{
     const s=spend.find(s=>s.id===n.call_id),notSent=s?.status==='not_sent'
     const unresolved=s&&['reserved','unknown'].includes(s.status)
     return {calls:notSent?0:Math.max(Number(n.provider_calls),unresolved&&s.workflow_dispatch_state==='started'?1:0),cost:notSent?0:s?s.settled_cny:n.cost_cny,reserved:notSent?0:Number(s?.reserved_cny??n.max_cost_cny),incomplete:!notSent&&(Boolean(unresolved)||['dispatched','unknown'].includes(n.status))}
    })
    for(const s of spend)if(s.status!=='not_sent'&&!paid.some(n=>n.call_id===s.id))accounting.push({calls:1,cost:s.settled_cny,reserved:Number(s.reserved_cny),incomplete:['reserved','unknown'].includes(s.status)})
    const activeSpend=spend.filter(s=>s.status!=='not_sent')
    // Old releases used a different in-memory call ID than the PG spend ID.
    // These two representations are bounds on the same graph, not extra calls.
    const legacyUnbound=activeSpend.some(s=>s.workflow_dispatch_state===null&&!paid.some(n=>n.call_id===s.id))&&paid.some(n=>!spend.some(s=>s.id===n.call_id))
    const unknown=accounting.some(x=>x.cost===null),incomplete=legacyUnbound||accounting.some(x=>x.incomplete)
    const providerCalls=legacyUnbound?Math.max(activeSpend.length,paid.reduce((sum,n)=>sum+Number(n.provider_calls),0)):accounting.reduce((sum,x)=>sum+x.calls,0)
    const reservedCostCny=legacyUnbound?Math.max(activeSpend.reduce((sum,s)=>sum+Number(s.reserved_cny),0),paid.reduce((sum,n)=>sum+Number(n.max_cost_cny),0)):accounting.reduce((sum,x)=>sum+x.reserved,0)
    const costCny=legacyUnbound?(activeSpend.length>=paid.length&&activeSpend.every(s=>s.settled_cny!==null)?activeSpend.reduce((sum,s)=>sum+Number(s.settled_cny),0):null):unknown?null:accounting.reduce((sum,x)=>sum+Number(x.cost),0)
    const receipt:WorkflowReceipt={schemaVersion:2,traceId:task.trace_id,status:'unavailable',failure:task.cancel_requested?'cancelled':'timeout',providerCalls,...(incomplete?{providerCallsAreUpperBound:true,receiptIncomplete:true,workerFinishedAtReturn:false}:{}),costCny,reservedCostCny,executionKind:paid.some(n=>n.execution_kind==='real_provider')||activeSpend.length?'real_provider':paid.length?'simulated_provider':'local_deterministic',skills:[],fallback:'existing_single_agent'}
    // Expiry never makes an opaque call eligible for retry.
    await c.query("UPDATE lifeos_workflow_nodes SET status='unknown' WHERE user_id=$1 AND request_id=$2 AND status='dispatched'",[r.internalActorKey,r.requestId])
    await c.query("UPDATE lifeos_workflow_tasks SET status='finished',receipt=$3,finished_at=now() WHERE user_id=$1 AND request_id=$2",[r.internalActorKey,r.requestId,JSON.stringify(receipt)])
    return {owned:false,receipt}
   }
   return {owned:Boolean(created.rowCount),receipt:task.receipt as WorkflowReceipt|null}
  }),
  finish:(r,receipt)=>transaction(async c=>{
   const task=(await c.query('SELECT status,receipt FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2 FOR UPDATE',[r.internalActorKey,r.requestId])).rows[0]
   if(!task)throw new WorkflowError('scope_denied')
   if(task.status==='finished')return task.receipt as WorkflowReceipt
   const spend=(await c.query("SELECT status,reserved_cny,workflow_dispatch_state FROM lifeos_provider_spend WHERE user_id=$1 AND workflow_request_id=$2 AND status<>'not_sent'",[r.internalActorKey,r.requestId])).rows
   if(spend.some(s=>['reserved','unknown'].includes(s.status)))receipt={...receipt,costCny:null,reservedCostCny:Math.max(receipt.reservedCostCny??0,spend.reduce((sum,s)=>sum+Number(s.reserved_cny),0)),providerCalls:Math.max(receipt.providerCalls,spend.filter(s=>s.workflow_dispatch_state!=='prepared'||s.status!=='reserved').length),receiptIncomplete:true,providerCallsAreUpperBound:true,workerFinishedAtReturn:false}
   await c.query("UPDATE lifeos_workflow_tasks SET status='finished',receipt=$3,finished_at=now() WHERE user_id=$1 AND request_id=$2 AND status IN ('queued','running')",[r.internalActorKey,r.requestId,JSON.stringify(receipt)])
   return receipt
  }),
  startNode:(r,n)=>transaction(async c=>{
   const task=(await c.query('SELECT status,cancel_requested,deadline_at<now() AS expired FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2 FOR UPDATE',[r.internalActorKey,r.requestId])).rows[0]
   if(!task||task.status!=='running'||task.cancel_requested||task.expired)throw new WorkflowError(task?.cancel_requested?'cancelled':'timeout')
   if(n.executionKind!=='local_deterministic'&&n.callId){
    const spend=(await c.query('SELECT status,workflow_dispatch_state FROM lifeos_provider_spend WHERE id=$1 AND user_id=$2 AND workflow_request_id=$3 FOR UPDATE',[n.callId,r.internalActorKey,r.requestId])).rows[0]
    if(spend?.workflow_dispatch_state){
     if(spend.status!=='reserved'||spend.workflow_dispatch_state!=='prepared')throw new WorkflowError('request_conflict')
     await c.query("UPDATE lifeos_provider_spend SET workflow_dispatch_state='started' WHERE id=$1",[n.callId])
    }
   }
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
