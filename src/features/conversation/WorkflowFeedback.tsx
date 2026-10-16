import {useEffect,useRef,useState} from 'react'
import {api,ApiError,dataChanged,explainError} from '../../backend/client'
import type {GrowthItem,GrowthRef,GrowthView} from '../growth/types'

const progressLabels={unattempted:'还没开始',attempted:'已尝试，尚未做完',stuck:'遇到卡点',completed:'这一步已做完',unknown:'进展暂不确定'} as const
type Progress=keyof typeof progressLabels
type FeedbackInput={requestId:string;conversationId:string;kind:'feedback';text:string;progressState:Progress;dependencies:GrowthRef[]}

// A person selects the adopted plan explicitly. Existing growth writes own
// authorization, version checks, audit sources and idempotency; no text matching.
export function WorkflowFeedback({conversationId,planRef}:{conversationId:string;planRef:GrowthRef}){
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false)
 const [plan,setPlan]=useState<GrowthItem|null>(null),[records,setRecords]=useState<GrowthItem[]>([])
 const [text,setText]=useState(''),[progress,setProgress]=useState<Progress|''>(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0)
 const pending=useRef<FeedbackInput|null>(null),submitting=useRef(false)
 useEffect(()=>{
  if(!open)return
  const changed=()=>setReload(value=>value+1)
  window.addEventListener('lifeos-data-changed',changed)
  return()=>window.removeEventListener('lifeos-data-changed',changed)
 },[open])
 useEffect(()=>{
  if(!open)return
  let current=true;setLoading(true);setPlan(null);setRecords([])
  api<GrowthView>('/api/growth?conversation='+conversationId).then(view=>{
   if(!current)return
   const selected=view.items.find(item=>item.id===planRef.id&&item.revision===planRef.revision&&item.kind==='priority'&&!item.unavailableReason&&item.status==='active')
   setPlan(selected??null)
   setRecords(view.items.filter(item=>item.kind==='feedback'&&item.assertion==='user_edit'&&!item.unavailableReason&&item.status==='active'&&item.dependencies.some(ref=>ref.id===planRef.id&&ref.revision===planRef.revision)))
   if(!selected)setNotice('这一步的记录已改变或不可用，请先在长期记忆里核对。')
  }).catch(error=>{if(current)setNotice(explainError(error))}).finally(()=>{if(current)setLoading(false)})
  return()=>{current=false}
 },[open,conversationId,planRef.id,planRef.revision,reload])
 async function save(){
  if(submitting.current||(!pending.current&&(!plan||!progress||!text.trim())))return
  submitting.current=true;setBusy(true);setNotice('')
  const body=pending.current??{requestId:crypto.randomUUID(),conversationId,kind:'feedback' as const,text:'对小探索「'+plan!.text+'」的反馈（'+progressLabels[progress as Progress]+'）：'+text.trim(),progressState:progress as Progress,dependencies:[{id:planRef.id,revision:planRef.revision}]}
  pending.current=body
  try{
   const saved=await api<GrowthItem>('/api/growth',body)
   setRecords(value=>[saved,...value.filter(item=>item.id!==saved.id)]);setText('');setProgress('');pending.current=null
   setNotice('反馈已保存并关联这一步；完成动作不代表已被采用、已付款或已产生效果。');dataChanged()
  }catch(error){
   // A lost response may have committed. Keep the exact request for a manual
   // retry, preventing a second growth record for this submission.
   if(error instanceof ApiError&&[400,403,404,409,429].includes(error.status)){
    pending.current=null
    if([403,404,409].includes(error.status))setReload(value=>value+1)
   }
   setNotice(explainError(error)+(pending.current?' 保存结果尚未确认，请点击“重试确认保存”；将核对同一次提交。':''))
  }finally{submitting.current=false;setBusy(false)}
 }
 return <details className="qa-workflow-feedback" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>反馈这一步 / 查看进展</summary>
  {open&&<>
   {loading&&<p role="status">正在读取这一步的计划和反馈…</p>}
   {notice&&<p role="status">{notice}</p>}
   {!loading&&!plan&&!pending.current&&<button type="button" onClick={()=>{setNotice('');setReload(value=>value+1)}}>重新读取</button>}
   {records.length>0&&<ol aria-label="这一步的反馈记录">{records.map(record=><li key={record.id}><p>{record.text}</p><p className="qa-workflow-meta">本人填写 · {progressLabels[record.progressState??'unknown']} · {new Date(record.updatedAt).toLocaleString('zh-CN')}</p></li>)}</ol>}
   {(plan||pending.current)&&<form onSubmit={event=>{event.preventDefault();void save()}}>
    {plan&&<p>关联计划（采纳时记录）：{plan.text}</p>}
    <fieldset disabled={busy||loading||Boolean(pending.current)}>
     <legend>这一步实际进展</legend>
     {Object.entries(progressLabels).map(([value,label])=><label key={value}><input type="radio" name={'workflow-progress-'+planRef.id} value={value} checked={progress===value} onChange={()=>setProgress(value as Progress)}/>{label}</label>)}
     <label className="qa-workflow-feedback-text">实际发生了什么？<textarea value={text} onChange={event=>setText(event.target.value)} maxLength={Math.max(0,4000-('对小探索「'+(plan?.text??'')+'」的反馈（'+(progress?progressLabels[progress]:'')+'）：').length)} rows={3} required/></label>
    </fieldset>
    <p className="qa-workflow-meta">只记录你实际报告的进展。对方采用、付款和效果可以分别保留未知。</p>
    <button type="submit" disabled={busy||loading||!pending.current&&(!progress||!text.trim())}>{busy?'正在保存…':pending.current?'重试确认保存':'保存这一步的反馈'}</button>
   </form>}
  </>}
 </details>
}
