import { useEffect, useRef, useState } from 'react'
import { api, dataChanged, explainError, type MemoryItem, type MemoryView } from '../../backend/client'
import './memory-panel.css'

const labels:Record<string,string>={'education.school':'学校','education.major':'专业','education.stage':'学习阶段',skills:'技能',currentConcern:'当前困扰',taskGoal:'当前目标',availableTime:'可用时间',taskConstraints:'任务限制',priorAttempts:'已尝试的事',optionsUnderConsideration:'考虑中的选项'}
const taskLabels:Record<string,string>={university_direction:'大学方向探索',study_project:'学习或项目',internship:'实习准备',personal_choice:'个人选择'}
const statusLabels:Record<string,string>={active:'使用中',unknown:'你暂时不知道',declined:'你选择不回答',stale:'可能过时',pending:'等待你核对',accepted:'你已认可',rejected:'你已否定',revoked:'已撤销'}

export function MemoryPanel({conversationId,messageCount,onClose}:{conversationId?:string;messageCount:number;onClose:()=>void}){
  const [view,setView]=useState<MemoryView|null>(null)
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [notice,setNotice]=useState('')
  const [editing,setEditing]=useState<string|null>(null)
  const [editValue,setEditValue]=useState('')
  const epoch=useRef(0)

  async function reload(){
    const current=++epoch.current
    setLoading(true);setView(null)
    try{const next=await api<MemoryView>('/api/memory'+(conversationId?'?conversation='+encodeURIComponent(conversationId):''));if(current===epoch.current){setView(next);setNotice('')}}
    catch(error){if(current===epoch.current)setNotice(explainError(error))}
    finally{if(current===epoch.current){setLoading(false);setSaving(false)}}
  }
  useEffect(()=>{
    setEditing(null);void reload()
    const changed=()=>{void reload()}
    window.addEventListener('lifeos-data-changed',changed)
    return ()=>{++epoch.current;window.removeEventListener('lifeos-data-changed',changed)}
  },[conversationId,messageCount])

  async function setEnabled(enabled:boolean){
    if(!view||saving)return
    setSaving(true);setNotice('')
    const current=epoch.current
    try{
      const settings=await api<MemoryView['settings']>('/api/memory/settings',{requestId:crypto.randomUUID(),enabled,expectedRevision:view.settings.revision})
      if(current===epoch.current){setView({...view,settings});dataChanged()}
    }catch(error){if(current===epoch.current){setNotice(explainError(error));await reload()}}
    finally{if(current===epoch.current)setSaving(false)}
  }
  async function act(item:MemoryItem,action:'correct'|'forget'|'accept'|'reject',value?:string){
    if(saving)return
    setSaving(true);setNotice('')
    const current=epoch.current
    try{
      await api('/api/memory/'+item.id+'/actions',{requestId:crypto.randomUUID(),expectedRevision:item.revision,action,...(value===undefined?{}:{value})})
      if(current===epoch.current){setEditing(null);dataChanged()}
    }catch(error){if(current===epoch.current)setNotice(explainError(error))}
    finally{if(current===epoch.current)setSaving(false)}
  }
  const facts=view?.items.filter(item=>item.kind==='fact')??[]
  const patterns=view?.items.filter(item=>item.kind==='pattern_candidate')??[]
  return <aside id="qa-memory-panel" className="qa-memory-panel" aria-label="长期记忆">
    <header className="qa-memory-header"><div><p>LifeOS</p><h2>长期记忆</h2></div><button type="button" autoFocus aria-label="关闭记忆面板" onClick={onClose}>×</button></header>
    <div className="qa-memory-content">
      {notice&&<p className="qa-memory-notice" role="status">{notice}</p>}
      {loading&&!view?<p className="qa-memory-empty">正在读取账户记忆…</p>:view&&<>
        <section className="qa-memory-section" aria-labelledby="qa-memory-switch-title">
          <div className="qa-memory-switch-heading"><div><h3 id="qa-memory-switch-title">长期记忆</h3><p>{view.settings.enabled?'已开启：可跨对话复用你允许保存的背景。':'已关闭：不会跨对话复用长期记忆。'}</p><p>关闭不会删除已保存的对话。你可以核对、更正或忘记下面的记录。</p></div>
            <label className="qa-memory-switch"><span className="qa-visually-hidden">启用长期记忆</span><input type="checkbox" checked={view.settings.enabled} disabled={saving} onChange={event=>void setEnabled(event.target.checked)} /><span aria-hidden="true" /></label>
          </div>
        </section>

        <section className="qa-memory-section" aria-labelledby="qa-memory-items-title">
          <div className="qa-memory-list-heading"><h3 id="qa-memory-items-title">已保存的背景信息</h3><span>{facts.length}</span></div>
          <p>这里管理背景记忆；目标、经历和建议边界可在认知空间与原对话中查看。</p>
          {!facts.length?<p className="qa-memory-empty">还没有长期保存的背景信息。</p>:<ul className="qa-memory-items">{facts.map(item=><li key={item.id}>
            <div className="qa-memory-item-heading"><div><span>{labels[item.key??'']??item.key??'用户信息'}</span><small>{statusLabels[item.status]??item.status}{item.scope==='task'&&item.taskType?' · '+(taskLabels[item.taskType]??item.taskType):''}</small></div><strong>{item.value===null?statusLabels[item.status]??'':String(item.value)}</strong></div>
            {item.validUntil&&<p className="qa-memory-meta">记录于 {new Date(item.observedAt).toLocaleDateString('zh-CN')} · 有效至 {new Date(item.validUntil).toLocaleDateString('zh-CN')}</p>}
            {item.sources.map((source,index)=><details key={index} className="qa-memory-source"><summary>来源：{source.type==='user_edit'?'你手动修改':source.conversationTitle??'对话'} · {source.type==='user_edit'?'手动修改':source.type==='experience'?'已确认经历':'用户原话'}</summary>{source.quote&&<p>{source.quote}</p>}</details>)}
            {editing===item.id?<form className="qa-memory-edit" onSubmit={event=>{event.preventDefault();void act(item,'correct',editValue.trim())}}><input aria-label="更正记忆内容" maxLength={1000} required value={editValue} onChange={event=>setEditValue(event.target.value)} autoFocus /><button type="submit" disabled={saving||!editValue.trim()}>保存</button><button type="button" disabled={saving} onClick={()=>setEditing(null)}>取消</button></form>:<div className="qa-memory-item-actions"><button type="button" disabled={saving} onClick={()=>{setEditing(item.id);setEditValue(item.value===null?'':String(item.value))}}>更正</button><button type="button" disabled={saving} onClick={()=>void act(item,'forget')}>忘记</button></div>}
          </li>)}</ul>}
        </section>

        {!!patterns.length&&<section className="qa-memory-section" aria-labelledby="qa-memory-pattern-title">
          <div className="qa-memory-list-heading"><h3 id="qa-memory-pattern-title">以前保存的解释</h3><span>{patterns.filter(item=>item.status==='pending').length}</span></div>
          <p className="qa-memory-disclosure">这些历史解释仍可核对或否定，不代表人格或长期偏好。</p><ul className="qa-memory-items">{patterns.map(item=><li key={item.id}>
            <p className="qa-memory-pattern">{item.value?.context}时，可能会{item.value?.behavior}，结果是{item.value?.outcome}。</p>
            {!!item.value?.limitations?.length&&<p className="qa-memory-meta">限制与反例：{item.value.limitations.join('；')}</p>}
            {item.sources.map((source,index)=><details key={index} className="qa-memory-source"><summary>依据：{source.conversationTitle??'已确认经历'}</summary>{source.quote&&<p>{source.quote}</p>}</details>)}
            <p className="qa-memory-meta">{statusLabels[item.status]??item.status}{item.sourceValidity==='changed'?' · 支持经历已变化':''}</p>
            {item.status==='pending'&&<div className="qa-memory-item-actions"><button type="button" disabled={saving} onClick={()=>void act(item,'accept')}>认可这段描述</button><button type="button" disabled={saving} onClick={()=>void act(item,'reject')}>不符合</button></div>}
          </li>)}</ul>
        </section>}

      </>}
    </div>
  </aside>
}
