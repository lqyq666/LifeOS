import {WorkflowError,type EvidenceRecord,type EvidenceRef,type WorkflowRequest} from './contracts.ts'
import {validateEvidence} from './evidence-gate.ts'
import {createTrace,type TraceRow} from './trace.ts'
import {loadBusinessSkill} from './skills.ts'
export type GrowthSnapshotItem={ref:EvidenceRef;kind:'experience'|'goal'|'constraint'|'observation'|'identity';status:'active'|'proposed'|'withdrawn';text:string;assertion:'user_reported'|'user_edit'|'ai_observation'}
export type GrowthDelta={schemaVersion:2;before:string;evidenceRefs:EvidenceRef[];now:string;unknowns:string[];needsConfirmation:boolean;change:'added'|'corrected'|'withdrawn';itemId:string}
// Host-produced committed IDs are the only trigger. This computes a view; it owns no write tool.
export function growthDiff(request:WorkflowRequest,host:{traceId:string;requestId:string;committed:boolean;changedIds:string[]},before:GrowthSnapshotItem[],after:GrowthSnapshotItem[],records:EvidenceRecord[],sink?:(row:TraceRow)=>void):GrowthDelta[]{
 if(request.mode!=='growth_diff'||!host.committed||host.traceId!==request.traceId||host.requestId!==request.requestId)throw new WorkflowError('stale_snapshot')
 if(!host.changedIds.length)return []
 const trace=createTrace(sink)
 try{
  loadBusinessSkill('lifeos-growth-diff',request.traceId,trace)
  loadBusinessSkill('lifeos-experience-evidence',request.traceId,trace)
 }catch(error){
  // This optional view has no authority to discard valid host facts. Keep its
  // failed zero-call trace and omit the explanation; never use changed instructions.
  if(error instanceof WorkflowError&&['source_invalid','unavailable'].includes(error.code))return []
  throw error
 }
 const changes:GrowthDelta[]=[]
 for(const id of new Set(host.changedIds)){
  const old=before.find(x=>x.ref.id===id),current=after.find(x=>x.ref.id===id)
  if(current&&old&&current.ref.revision===old.ref.revision&&JSON.stringify(current)!==JSON.stringify(old))throw new WorkflowError('stale_snapshot')
  if(!current||current.status==='withdrawn'){
   // A newly committed future-window item can be absent from today's view.
   // Never fabricate a withdrawal for a record that was not in that view.
   if(!current&&!old)continue
   // Do not disclose the old text or old source after forgetting.
   changes.push({schemaVersion:2,before:'此前存在的一条记录',evidenceRefs:[],now:'这条记录已撤回，相关解释不再使用。',unknowns:[],needsConfirmation:true,change:'withdrawn',itemId:id});continue
  }
  if(old&&current.ref.revision===old.ref.revision)continue
  if(old&&current.ref.revision<old.ref.revision)throw new WorkflowError('stale_snapshot')
  validateEvidence(request,[current.ref],records)
  const source=records.find(x=>x.ref.type===current.ref.type&&x.ref.id===current.ref.id)!
  if(current.text!==source.text)throw new WorkflowError('source_invalid')
  const observation=current.assertion==='ai_observation'||current.kind==='observation'
  changes.push({schemaVersion:2,before:old?'此前这条理解已被更新；旧原话不重新展示。':'此前还没有这条任务记录。',evidenceRefs:[current.ref],now:observation?'新增了一条待本人核对的观察，尚未形成身份认同。':`${old?'更正后的':'新增的'}本人报告：${source.text}`,unknowns:current.kind==='experience'?['这次任务范围外的稳定能力与实际适配仍未知。']:['这条信息对其他事情的影响仍待本人核对。'],needsConfirmation:observation||current.status==='proposed',change:old?'corrected':'added',itemId:id})
 }
 return changes
}
