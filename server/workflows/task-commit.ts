import type {PoolClient} from 'pg'
import {HttpError,requireRow} from '../db.ts'
import type {Run} from '../store.ts'
import {createGrowthItem} from '../growth.ts'
import {parseRequest,parseProposal,type WorkflowReceipt} from './contracts.ts'
import {validateProposal} from './evidence-gate.ts'
import {readWorkflowEvidence} from './task-sources.ts'
import {workflowRuntimeVersion,workflowAdoptionVersionDigest,remoteReceiptBindingMatches,workflowRemoteRuntimeBinding} from './runtime-version.ts'
import {createHash} from 'node:crypto'
import {assertCoachKnowledge} from '../coach-knowledge.ts'
import {lockGrowth} from '../growth.ts'
import {stableJson} from '../evergreen-guide.ts'
export const workflowReceiptDigest=(receipt:unknown)=>createHash('sha256').update(stableJson(receipt)).digest('hex')
export type WorkflowAdoption={taskId:string;kind:'action'|'direction';index:number;receiptDigest:string}
export async function commitWorkflowSelection(c:PoolClient,run:Run,selection:WorkflowAdoption){
 // Reuse the same account locks as memory/growth controls. finishRun already
 // holds them; this seam also remains safe when invoked directly in a txn.
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[run.user_id+':memory-settings'])
 await lockGrowth(c,run.user_id)
 const task=requireRow((await c.query('SELECT * FROM lifeos_workflow_tasks WHERE user_id=$1 AND request_id=$2 FOR UPDATE',[run.user_id,selection.taskId])).rows[0])
 if(task.status!=='finished'||task.cancel_requested||task.host_commit||task.receipt?.status!=='proposed'||task.receipt.receiptIncomplete||task.receipt.workerFinishedAtReturn===false)throw new HttpError(409,'WORKFLOW_NOT_PROPOSED')
 if(selection.receiptDigest!==workflowReceiptDigest(task.receipt))throw new HttpError(409,'WORKFLOW_SELECTION_CHANGED')
 const request=parseRequest(task.request_payload),proposal=parseProposal((task.receipt as WorkflowReceipt).proposal)
 if(request.hostSnapshot?.runtimeDigest!==workflowRuntimeVersion.sourceDigest||request.hostSnapshot?.adoptionVersionDigest!==workflowAdoptionVersionDigest||task.receipt.adoptionVersionDigest!==workflowAdoptionVersionDigest)throw new HttpError(409,'WORKFLOW_VERSION_CHANGED')
 if((workflowRemoteRuntimeBinding||task.receipt.verifiedRuntimeBinding)&&!remoteReceiptBindingMatches(task.receipt.verifiedRuntimeBinding))throw new HttpError(409,'WORKFLOW_CLOUD_VERSION_CHANGED')
 const messageIds=request.authorizedEvidenceRefs.filter(x=>x.type==='message').map(x=>x.id)
 await c.query('SELECT id FROM messages WHERE user_id=$1 AND id=ANY($2::uuid[]) FOR SHARE',[run.user_id,messageIds])
 validateProposal(request,proposal,await readWorkflowEvidence(request,c))
 await assertCoachKnowledge(c,task.receipt.methodRefs??[])
 if(!request.controls.memoryEnabled&&run.conversation_id!==request.conversationId)throw new HttpError(409,'MEMORY_DISABLED')
 const selected=selection.kind==='action'?proposal.nextActions[selection.index]:proposal.alternatives[selection.index]
 if(!selected)throw new HttpError(400,'WORKFLOW_SELECTION_INVALID')
 const text=selection.kind==='action'?'计划：'+proposal.nextActions[selection.index].description+'（已采纳，尚未执行）':'我确认本阶段优先'+proposal.alternatives[selection.index].title
 const item=await createGrowthItem(run.user_id,{requestId:run.request_id,conversationId:run.conversation_id,kind:selection.kind==='action'?'priority':'goal',text,dependencies:request.authorizedEvidenceRefs.filter(x=>x.type==='growth').map(x=>({id:x.id,revision:x.revision}))},c)
 return {taskId:request.requestId,kind:selection.kind,index:selection.index,status:selection.kind==='action'?'plan_saved' as const:'direction_saved' as const,itemId:item.id,revision:item.revision,executed:false as const}
}
