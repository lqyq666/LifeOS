import {useEffect,useRef,useState} from 'react'
import {api} from '../../backend/client'
type Method={title:string;scope:string;limitations:string;url:string;guide:{principle:string;prerequisites:string[];exclusions:string[];branches:{id:string;task:string;steps:{id:string;text:string}[]}[];lowEnergyAlternative:string;stopConditions:string[];feedbackBranches:Record<string,string>}}
export function FullMethod({url}:{url:string}){
 const [method,setMethod]=useState<Method|null>(null),[state,setState]=useState<'idle'|'loading'|'ready'|'error'>('idle'),live=useRef(true)
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
 const load=()=>{if(state==='loading'||state==='ready')return;setState('loading');api<Method>(url).then(data=>{if(live.current){setMethod(data);setState('ready')}},()=>{if(live.current)setState('error')})}
 return <details className="qa-full-method" onToggle={event=>{if(event.currentTarget.open)load()}}>
  <summary>查看完整方法</summary>
  {state==='loading'&&<p role="status">正在读取方法…</p>}
  {state==='error'&&<p role="status">这份方法暂时无法查看，来源可能已更新。<button type="button" onClick={load}>重试</button></p>}
  {method&&<div className="qa-full-method-body">
   <h3>{method.title}</h3><p>{method.guide.principle}</p>
   <p><strong>适用条件</strong> {method.guide.prerequisites.join('；')}</p>
   <p><strong>适用边界</strong> {method.scope} {method.guide.exclusions.join('；')} {method.limitations}</p>
   {method.guide.branches.map(branch=><details key={branch.id}><summary>{branch.task}</summary><ol>{branch.steps.map(step=><li key={step.id}>{step.text}</li>)}</ol></details>)}
   <p><strong>精力有限时</strong> {method.guide.lowEnergyAlternative}</p>
   <p><strong>遇到卡点</strong> {method.guide.feedbackBranches.blocked}</p>
   <p><strong>还在等结果</strong> {method.guide.feedbackBranches.waiting_result}</p>
   <p><strong>可以停止</strong> {method.guide.stopConditions.join('；')}</p>
   <a href={method.url} target="_blank" rel="noreferrer noopener">查看原始来源</a>
  </div>}
 </details>
}
