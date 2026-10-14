import {useEffect,useState} from 'react'
import {api,dataChanged,explainError} from '../../backend/client'
import type {WorkflowReceipt} from '../../../server/workflows/contracts'
import './workflow-panel.css'
type Task={id:string;conversationId:string;question:string;status:string;historicalSelectionStatus?:'plan_saved'|'direction_saved';historicalVersion?:boolean;receipt:WorkflowReceipt|null;executionKind:string;nodes:{id:string;role:string;status:string;providerCalls:number;costCny:number|null}[];commit?:{stateChange?:{workflow?:{status:string;executed:boolean}}}|null}
type Capabilities={enabled:boolean;reason:string;directions:Record<string,string>;executionKind:string|null}
const roles:Record<string,string>={path_analyst:'方向分析',constraint_validator:'来源与预算校验',independent_critic:'候选审阅',evidence_guardian:'事实核对',decision_synthesizer:'综合候选'}
const statuses:Record<string,string>={queued:'等待开始',running:'正在分析',waiting_user:'先核对一项情况，尚未调用模型',proposed:'分析完成，等待你的选择',plan_saved:'小探索计划已保存 · 采纳时尚未执行',direction_saved:'阶段方向已保存',rejected:'你选择了不采用',cancelled:'已取消',failed:'这次分析未完成'}
const hasIndependentReview=(task:Task)=>task.executionKind==='real_provider'&&task.nodes.some(node=>node.role==='independent_critic'&&node.status==='succeeded')
const hasReviewedPriority=(task:Task)=>hasIndependentReview(task)&&task.nodes.some(node=>node.role==='decision_synthesizer'&&node.status==='succeeded')&&task.receipt?.proposal?.actionSelection==='reviewed_priority'&&task.receipt.proposal.nextActions.length===1
const actionSectionTitle=(task:Task)=>hasReviewedPriority(task)?task.status==='plan_saved'?'已保存的小探索 · 采纳时尚未执行':task.status==='direction_saved'?'本阶段可优先核实的一步':'目前优先核实的一步 · 待你选择':task.receipt?.proposal?.nextActions.length?'可以先试的一小步':'暂不新增行动'
const actionSectionHint=(task:Task)=>hasReviewedPriority(task)?task.status==='plan_saved'?'这是独立审阅后的阶段探索；计划已保存，尚未执行。依据、仍未知和停止条件列在下面。':task.status==='direction_saved'?'这是独立审阅后的阶段探索建议；方向已保存，但这一步尚未采纳或执行。依据、仍未知和停止条件列在下面。':'这一步来自同一比较维度下的候选和独立审阅综合；下方列出个人依据、仍未知和停止条件。是否采纳由你决定。':task.receipt?.proposal?.nextActions.length?'下面是备选行动，由你选择一个开始；排列顺序不代表已经替你确定优先级，不要求全部执行。':hasIndependentReview(task)?'本次没有能凭现有依据明确优先的一步。你可以补充一项会改变比较的情况，或暂缓。':'当前没有可选的小行动；未知仍保留，你可以继续聊或暂缓。'
const hints:[string,RegExp][]=[['employment',/就业|实习|找工作|求职/],['research_exploration',/科研探索|科研体验|联系实验室|了解研究内容/],['postgraduate_exam',/考研/],['postgraduate_recommendation',/保研|推免/],['freelance',/自由职业|接单/],['independent_development',/独立开发|小程序/],['entrepreneurship',/创业/],['overseas_study',/留学/],['public_service',/考公|考编/],['undergraduate_upgrade',/专升本/]]
export function WorkflowPanel({conversationId,source,refreshKey,onChanged}:{conversationId:string;source:{id:string;text:string}|null;refreshKey:number;onChanged:()=>void}){
 const [tasks,setTasks]=useState<Task[]>([]),[cap,setCap]=useState<Capabilities|null>(null),[selecting,setSelecting]=useState(false),[selected,setSelected]=useState<string[]>([]),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 const eligible=source?hints.filter(([,pattern])=>pattern.test(source.text)).map(([id])=>id):[]
 useEffect(()=>{let current=true;api<Capabilities>('/api/workflows/capabilities').then(value=>{if(current)setCap(value)}).catch(()=>{if(current)setCap(null)});return()=>{current=false}},[])
 useEffect(()=>{setSelecting(false);setSelected(eligible.slice(0,3))},[source?.id])
 const running=tasks.some(task=>['queued','running'].includes(task.status))
 useEffect(()=>{
  if(!cap?.enabled){setTasks([]);return}
  let current=true,timer:ReturnType<typeof setTimeout>|undefined
  async function load(){try{const rows=await api<Task[]>('/api/workflows?conversationId='+conversationId);if(current){setTasks(rows);if(rows.some(task=>['queued','running'].includes(task.status)))timer=setTimeout(load,400)}}catch(error){if(current)setNotice(explainError(error))}}
  void load();return()=>{current=false;if(timer)clearTimeout(timer)}
 },[conversationId,refreshKey,busy,cap?.enabled])
 async function start(){
  if(!source||busy)return
  setBusy(true);setNotice('')
  try{await api('/api/workflows',{requestId:crypto.randomUUID(),conversationId,currentMessageId:source.id,directions:selected,consent:true});setSelecting(false)}catch(error){setNotice(explainError(error))}finally{setBusy(false)}
 }
 async function resume(task:Task){
  if(!source||busy)return;setBusy(true);setNotice('')
  try{await api('/api/workflows/'+task.id+'/resume',{conversationId,currentMessageId:source.id});setNotice('已承接补充，继续原来的方向比较。')}catch(error){setNotice(explainError(error))}finally{setBusy(false)}
 }
 async function act(task:Task,kind:'action'|'direction'|'reject',index:number){
  if(busy)return;setBusy(true);setNotice('')
  try{
   const result=await api<{status?:string;stateChange?:{workflow?:{status:string;executed:boolean}}}>('/api/workflows/'+task.id+'/actions',{requestId:crypto.randomUUID(),conversationId,kind,index})
   const status=result.stateChange?.workflow?.status
   setNotice(status==='plan_saved'?'已保存这个小探索计划，尚未执行。':status==='direction_saved'?'已保存你明确确认的阶段方向。':'已记录不采用，本次分析没有改变你的目标。')
   dataChanged();onChanged()
  }catch(error){setNotice(explainError(error))}finally{setBusy(false)}
 }
 async function cancel(task:Task){setBusy(true);try{await api('/api/workflows/'+task.id+'/cancel',{});setNotice('已请求取消；已派发节点的用量会保留。')}catch(error){setNotice(explainError(error))}finally{setBusy(false)}}
 if(!cap?.enabled||!tasks.length&&eligible.length<2)return null
 return <section className="qa-workflow" aria-label="深入分析">
  <p className="qa-workflow-meta">实验性深度分析 · 尚未证实比普通聊天更有帮助，你可以继续普通聊天。</p>
  {eligible.length>=2&&!running&&!selecting&&!tasks.some(task=>task.status==='waiting_user'&&task.conversationId===conversationId&&task.question===source?.text)&&<button type="button" className="qa-workflow-entry" disabled={busy} onClick={()=>{setSelecting(true);setSelected(eligible.slice(0,3))}}>深入分析这些方向</button>}
  {selecting&&<div className="qa-workflow-picker">
   <h2>这次想比较哪几条路？</h2>
   <p>选两到三个。分析完成后，由你决定是否采纳一个小行动或确认方向。</p>
   <fieldset><legend>比较方向</legend>{Object.entries(cap?.directions??{}).map(([id,title])=><label key={id}><input type="checkbox" checked={selected.includes(id)} disabled={busy||!selected.includes(id)&&selected.length>=3} onChange={()=>setSelected(value=>value.includes(id)?value.filter(x=>x!==id):[...value,id])}/>{title}</label>)}</fieldset>
   {cap&&!cap.enabled&&<p role="status">{cap.reason}</p>}
   <div className="qa-workflow-buttons"><button type="button" disabled={busy||selected.length<2||!cap?.enabled} onClick={()=>void start()}>开始深入分析</button><button type="button" disabled={busy} onClick={()=>setSelecting(false)}>先继续聊</button></div>
  </div>}
  {notice&&<p className="qa-workflow-notice" role="status">{notice}</p>}
  {tasks.map(task=><article key={task.id} data-workflow-id={task.id} className="qa-workflow-task">
   <header><h2>{task.question}</h2><p role="status">{task.status==='failed'&&task.historicalSelectionStatus?'之前采纳的记录保留 · 当前分析依据不可用':statuses[task.status]??task.status}</p></header>
   {task.historicalVersion&&<p className="qa-workflow-meta">这是此前版本的采纳记录；原始依据与回执保留，后续进展以本人反馈为准。</p>}
   {task.executionKind==='simulated_provider'&&<p className="qa-workflow-meta">开发候选 · 模拟 Provider，尚未验证真实服务质量</p>}
   <details><summary>查看协作进度与依据</summary><ol className="qa-workflow-progress">{task.nodes.map(node=><li key={node.id}><span>{roles[node.role]??node.role}{node.id.startsWith('path:')?' · '+(cap?.directions[node.id.slice(5)]??''):''}</span><span>{({dispatched:'已派发',succeeded:'已完成',failed:'未通过',unknown:'结果或费用待核实'} as Record<string,string>)[node.status]??node.status}</span></li>)}</ol><p className="qa-workflow-meta">{task.receipt?.providerCallsAreUpperBound?`实际调用次数待核对，最多 ${task.receipt.providerCalls} 次`:`${task.executionKind==='simulated_provider'?'模拟派发':'已派发'} ${task.receipt?.providerCalls??task.nodes.reduce((sum,x)=>sum+x.providerCalls,0)} 次${task.executionKind==='simulated_provider'?'模拟生成':'模型调用'}`}{task.receipt?` · ${task.receipt.costCny===null?'费用待核实':(task.executionKind==='simulated_provider'?'模拟记账 ¥':'记录费用 ¥')+task.receipt.costCny.toFixed(5)}`:''}</p>{task.receipt?.reviewIssues?.map((issue,index)=><p key={index}>{issue.severity==='needs_clarification'?'需要核对：':'仍未知：'}{issue.text}</p>)}</details>
   {['queued','running'].includes(task.status)&&<button type="button" disabled={busy} onClick={()=>void cancel(task)}>取消分析</button>}
   {task.receipt?.workerFinishedAtReturn===false&&<p role="status">云端任务是否已结束仍待核对；费用预留继续保留。{task.receipt.cancelAcknowledged===true?'已确认收到取消请求。':task.receipt.cancelAcknowledged===false?'取消请求尚未确认。':''}</p>}
   {task.receipt?.proposal&&!task.receipt.receiptIncomplete&&['proposed','plan_saved','direction_saved'].includes(task.status)&&<details open={task.status==='proposed'}><summary>{task.status==='proposed'?'比较候选与可选行动':'查看采纳时的比较与依据'}</summary>
    {!task.nodes.some(node=>node.role==='independent_critic'&&node.status==='succeeded')&&<p className="qa-workflow-meta">本次记录没有已完成的独立审阅；比较判断仍需要你核对。</p>}
    {task.receipt.proposal.hypotheses.length>0&&<section aria-label="比较判断"><h3>比较判断 · 待你核对</h3>{task.receipt.proposal.hypotheses.map((item,index)=><div key={index}><p>{item.text}</p><p className="qa-workflow-meta">{item.limitation}</p></div>)}</section>}
    <div className="qa-workflow-alternatives">{task.receipt.proposal.alternatives.map((path,index)=><section key={path.directionId}><h3>{path.title}</h3><ul>{path.pros.map((text,i)=><li key={i}>{text}</li>)}</ul>{path.tradeoffs.map((text,i)=><p key={'tradeoff'+i}>取舍：{text}</p>)}{path.unknowns.map((text,i)=><p key={'unknown'+i}>待核对：{text}</p>)}{task.status==='proposed'&&<button type="button" disabled={busy} onClick={()=>void act(task,'direction',index)}>确认本阶段优先{path.title}</button>}</section>)}</div>
    <h3>{actionSectionTitle(task)}</h3><p>{actionSectionHint(task)}</p>{task.receipt.proposal.nextActions.map((action,index)=><div className="qa-workflow-action" key={index}><p>{action.description}</p><p className="qa-workflow-meta">{action.estimatedMinutes===null?'投入时间尚未核实':`建议尝试 ${action.estimatedMinutes} 分钟`} · {action.stopCondition}</p>{task.status==='proposed'&&<button type="button" disabled={busy} onClick={()=>void act(task,'action',index)}>{hasReviewedPriority(task)?'采纳这一步':'只采纳这个小行动'}</button>}</div>)}
    {task.status==='proposed'&&<div className="qa-workflow-buttons"><p>采纳小行动会保存尚未执行的计划；确认方向才会保存阶段选择。</p><button type="button" disabled={busy} onClick={()=>void act(task,'reject',0)}>不采用，继续聊</button></div>}
   </details>}
   {task.status==='failed'&&<p>本次候选不可继续采纳。已保存的聊天仍可继续；你也可以按最新情况重新发起分析。</p>}
   {task.status==='waiting_user'&&<><p>在聊天里补充本人可用时间。可以直接说“六小时”“大概两小时”或“最多一小时”，也可以说明下周、没空或暂不继续。原来的背景和方向会保留。</p>{task.conversationId===conversationId&&<div className="qa-workflow-buttons"><button type="button" disabled={busy||running||!source||source.text===task.question} onClick={()=>void resume(task)}>继续这次比较</button><button type="button" disabled={busy} onClick={()=>void cancel(task)}>取消这次比较</button></div>}</>}
  </article>)}
 </section>
}
