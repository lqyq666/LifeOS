import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, dataChanged, explainError } from '../../backend/client'
import { growthLabels, type GrowthItem, type GrowthKind, type GrowthView } from './types'
import './growth.css'
import {OfficialSources} from './OfficialSources'

const states = { active: '当前', proposed: '待核对', paused: '已暂停', completed: '已结束', rejected: '不再采用', forgotten: '已遗忘', stale: '需重新核对' }
const assertions = { user_edit: '你提供的情况', user_reported: '你的对话原话', ai_observation: 'AI 观察 · 不是事实结论', unknown: '未知 · 尚无结论' }
const progressLabels = { unattempted:'尚未行动',attempted:'已尝试 · 结果另行核对',stuck:'卡住了',completed:'动作已完成 · 不代表结果已达成',unknown:'实际行动状态未知' }
const sections: GrowthKind[][] = [['context','ability','preference','observation','unknown'], ['goal','direction'], ['constraint','priority','decision','feedback']]
export function GrowthWorkspace({ conversationId, conversationTitle, onClose, onExplore }: { conversationId: string; conversationTitle: string; onClose: () => void; onExplore: (text: string) => void }) {
  const [view, setView] = useState<GrowthView | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<GrowthKind>('goal')
  const [text, setText] = useState('')
  const [until, setUntil] = useState('')
  const [progressState,setProgressState]=useState<NonNullable<GrowthItem['progressState']>>('unknown')
  const [editing, setEditing] = useState<GrowthItem | null>(null)
  // Reuse this repository's chat request rule: an uncertain transport outcome
  // retries the same operation identity, rather than duplicating a saved item.
  const pending = useRef(new Map<string,string>())
  function requestId(key: string) { const existing=pending.current.get(key); if(existing)return existing; const id=crypto.randomUUID();pending.current.set(key,id);return id }
  async function load() { setView(await api<GrowthView>('/api/growth')) }
  useEffect(() => {
    let current = true
    api<GrowthView>('/api/growth').then(next => { if (current) setView(next) }).catch(error => { if (current) setNotice(explainError(error)) })
    return () => { current = false }
  }, [conversationId])
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setNotice('')
    try {
      const validUntil = until ? new Date(until).toISOString() : null
      const feedback=kind==='feedback'?{progressState}:{}
      const key=JSON.stringify([conversationId,editing?.id,editing?.revision,kind,text.trim(),validUntil,feedback])
      if (kind === 'constraint' && !validUntil) { setNotice('请写明这项约束适用到哪一天；之后会提醒重新核对。'); return }
      if (editing) await api('/api/growth/' + editing.id + '/actions', { requestId: requestId(key), expectedRevision: editing.revision, action: 'correct', text: text.trim(), validUntil,...feedback })
      else {
        await api('/api/conversations', { id: conversationId, title: conversationTitle })
        await api('/api/growth', { requestId: requestId(key), conversationId, kind, text: text.trim(), ...(validUntil ? { validUntil } : {}),...feedback })
      }
      pending.current.delete(key);setText(''); setUntil(''); setEditing(null); await load(); dataChanged(); setNotice('已保存。更正只影响这一项，旧依据的相关建议需要重新核对。')
    } catch (error) { setNotice(explainError(error)); await load().catch(() => {}) }
    finally { setBusy(false) }
  }
  async function act(item: GrowthItem, action: 'accept' | 'pause' | 'complete' | 'reject' | 'forget') {
    if (busy) return
    setBusy(true); setNotice('')
    const key=JSON.stringify([item.id,item.revision,action])
    try {
      await api('/api/growth/' + item.id + '/actions', { requestId: requestId(key), expectedRevision: item.revision, action })
      pending.current.delete(key)
      if (editing?.id === item.id) { setEditing(null); setText(''); setUntil('') }
      await load(); dataChanged(); setNotice(action === 'forget' ? '这条成长记录和依赖它的记录已清除内容，其原话不再用作后续建议的依据；同一消息里的其他独立情况仍保留。原聊天仍可查看。' : action==='accept'?'已采用这项观察；仍保留 AI 判断和局限标记，不代表已证明或已执行。':'状态已更新。')
    } catch (error) { setNotice(explainError(error)); await load().catch(() => {}) }
    finally { setBusy(false) }
  }
  const currentItems = (view?.items ?? []).filter(item => !['rejected','completed','paused'].includes(item.status))
  const historicalItems = (view?.items ?? []).filter(item => ['rejected','completed','paused'].includes(item.status))
  function card(item: GrowthItem) {
    return <article className="growth-card" key={item.id}>
      <div className="growth-card-heading"><strong>{growthLabels[item.kind]}</strong><span>{states[item.status]}</span></div>
      <p>{item.text || '这项记录依赖的依据已撤回，内容已清除。'}</p>
      <small>{assertions[item.assertion]} · {new Date(item.updatedAt).toLocaleDateString()} · 第 {item.revision} 版</small>
      {item.limitation && <p className="growth-stale">判断局限：{item.limitation}</p>}
      {item.progressState && <small>{progressLabels[item.progressState]}</small>}
      {item.validUntil && <small>适用至 {new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(item.validUntil))}{item.timeBasis?'':'（期限未核验）'}</small>}
      {item.unavailableReason && <p className="growth-stale">依据或适用时间有变化，继续采用前需要核对。</p>}
      {!!item.sources.length && <details><summary>查看依据</summary>{item.sources.map((source, index) => <blockquote key={index}>{source.quote}<small>{source.type === 'user_edit' ? '你在成长工作区填写' : '你的对话原话'}</small></blockquote>)}</details>}
      {!!item.dependencies.length && <details><summary>相关个人依据（{item.dependencies.length}）</summary>{item.dependencies.map(ref => { const source = view?.items.find(candidate => candidate.id === ref.id); return <p key={ref.id}>{source?.text || '依据已不再使用'}{source && source.revision !== ref.revision ? ' · 已更正，请重新核对' : ''}</p> })}</details>}
      <div className="growth-card-actions">
        <button disabled={busy || !item.text} onClick={() => { setEditing(item); setKind(item.kind); setText(item.text);setProgressState(item.progressState??'unknown'); setUntil(item.validUntil ? new Date(Date.parse(item.validUntil) - new Date(item.validUntil).getTimezoneOffset() * 60000).toISOString().slice(0,16) : '') }}>更正</button>
        {item.status==='proposed'&&!item.unavailableReason&&<button disabled={busy} onClick={()=>void act(item,'accept')}>采用这项观察</button>}
        {['goal','direction','priority','decision'].includes(item.kind) && item.status === 'active' && <button disabled={busy} onClick={() => void act(item,'pause')}>暂停</button>}
        {['goal','priority','decision'].includes(item.kind) && item.status === 'active' && <button disabled={busy} onClick={() => void act(item,'complete')}>结束这项</button>}
        {item.status !== 'rejected' && <button disabled={busy} onClick={() => void act(item,'reject')}>不再采用</button>}
        <button disabled={busy} onClick={() => void act(item,'forget')}>遗忘这条</button>
      </div>
    </article>
  }
  return <main className="growth-workspace" aria-label="我的成长工作区">
    <header><div><p>LifeOS · 我的成长</p><h1>现在的我，接下来的一步</h1></div><button disabled={busy} onClick={onClose}>继续聊天</button></header>
    <p>经历少、方向没定也可以开始。先写一件你明确知道的事，空白保留为空白。</p>
    {view && !view.memoryEnabled && <p className="growth-stale">跨会话记忆未开启。这里可以管理自己的记录，AI 仅使用当前会话的情况；在“记忆”中可调整权限。</p>}
    {notice && <p role="status">{notice}</p>}
    {!view ? <p role="status">正在读取已保存情况…</p> : <div className="growth-grid">{sections.map((kinds,index) => <section key={index}><h2>{['当前的我','方向与目标','最近的选择与反馈'][index]}</h2>{currentItems.filter(item => kinds.includes(item.kind)).map(card)}{!currentItems.some(item => kinds.includes(item.kind)) && <p className="growth-empty">这里还没有你的记录。可以在下方补充，也可以从聊天开始了解。</p>}</section>)}</div>}
    <form onSubmit={event => void save(event)} className="growth-form">
      <h2>{editing ? '更正这一项' : '补充一件当前情况'}</h2>
      <label htmlFor="growth-kind">放在哪里</label><select id="growth-kind" value={kind} disabled={busy || !!editing} onChange={event => setKind(event.target.value as GrowthKind)}>{Object.entries(growthLabels).filter(([key]) => key !== 'observation').map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>
      <label htmlFor="growth-text">你的原话</label><textarea id="growth-text" value={text} disabled={busy} onChange={event => setText(event.target.value)} maxLength={4000} required placeholder="例如：还没确定毕业方向；这周优先期末；想试试真实的项目工作。" />
      {kind==='feedback'&&<><label htmlFor="growth-progress">实际行动状态</label><select id="growth-progress" value={progressState} disabled={busy} onChange={event=>setProgressState(event.target.value as NonNullable<GrowthItem['progressState']>)}>{Object.entries(progressLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></>}
      <label htmlFor="growth-until">{kind === 'constraint' ? '这项约束适用到（必填）' : '适用到（选填）'}</label><input id="growth-until" type="datetime-local" value={until} required={kind === 'constraint'} disabled={busy} onChange={event => setUntil(event.target.value)} />
      <div><button disabled={busy || !text.trim()} type="submit">{busy ? '保存中…' : '保存这项'}</button>{editing && <button type="button" disabled={busy} onClick={() => { setEditing(null); setText(''); setUntil(''); setKind('goal') }}>取消更正</button>}</div>
    </form>
    <section className="growth-explore"><h2>从一件真正困惑的事继续</h2>{['我还没确定毕业方向，经历也不多，帮我从当前情况开始梳理。','我已经有方向，想理清最近先准备什么。','这周时间很少，帮我权衡眼前的机会和必须完成的任务。','上次那一步没有开始，我想弄清哪里卡住了。'].map(prompt => <button key={prompt} disabled={busy} onClick={() => onExplore(prompt)}>{prompt}</button>)}</section>
    {!!historicalItems.length && <details className="growth-history"><summary>已暂停、不再采用和已结束的事（{historicalItems.length}）</summary>{historicalItems.map(card)}</details>}
    <OfficialSources />
    <p className="growth-note">填写和结束记录是你对当前状态的说明。复制材料、保存计划不会被当作已对外执行。</p>
  </main>
}
