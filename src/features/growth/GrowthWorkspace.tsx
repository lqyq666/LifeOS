import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, dataChanged, explainError } from '../../backend/client'
import { growthLabels, type GrowthItem, type GrowthKind, type GrowthView } from './types'
import './growth.css'

const states = { active: '进行中', proposed: '待核对', paused: '已暂停', completed: '已结束', rejected: '不再采用', forgotten: '已遗忘', stale: '需核对' }
const progressLabels = { unattempted: '尚未行动', attempted: '已尝试', stuck: '卡住了', completed: '动作完成', unknown: '状态未知' }
const sections: { title: string; kinds: GrowthKind[] }[] = [
  { title: '当前的我', kinds: ['context', 'ability', 'preference', 'observation', 'unknown'] },
  { title: '方向与目标', kinds: ['goal', 'direction'] },
  { title: '选择与反馈', kinds: ['constraint', 'priority', 'decision', 'feedback'] },
]

type DirectionControlRow = { scope: string; scopeLabel: string; state: 'paused' | 'enabled'; revision: number; sourceQuote: string; sourceRedacted: boolean; updatedAt: string }

export function GrowthWorkspace({ conversationId, conversationTitle, onClose, onSendControl }: { conversationId: string; conversationTitle: string; onClose: () => void; onSendControl?: (text: string) => void }) {
  const [view, setView] = useState<GrowthView | null>(null)
  const [directionControls, setDirectionControls] = useState<DirectionControlRow[] | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<GrowthKind>('goal')
  const [text, setText] = useState('')
  const [until, setUntil] = useState('')
  const [progressState, setProgressState] = useState<NonNullable<GrowthItem['progressState']>>('unknown')
  const [editing, setEditing] = useState<GrowthItem | null>(null)
  const dialog = useRef<HTMLDialogElement>(null), closeRef = useRef<HTMLButtonElement>(null)
  const pending = useRef(new Map<string, string>())
  function requestId(key: string) { const existing = pending.current.get(key); if (existing) return existing; const id = crypto.randomUUID(); pending.current.set(key, id); return id }
  useEffect(() => {
    dialog.current?.showModal(); closeRef.current?.focus()
    let current = true
    api<GrowthView>('/api/growth').then(next => { if (current) setView(next) }).catch(error => { if (current) setNotice(explainError(error)) })
    api<{ controls: DirectionControlRow[] }>('/api/growth/direction-controls').then(next => { if (current) setDirectionControls(next.controls) }).catch(() => {})
    return () => { current = false; const el = dialog.current; el?.close() }
  }, [conversationId])
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setNotice('')
    try {
      const validUntil = until ? new Date(until).toISOString() : null
      const feedback = kind === 'feedback' ? { progressState } : {}
      const key = JSON.stringify([conversationId, editing?.id, editing?.revision, kind, text.trim(), validUntil, feedback])
      if (kind === 'constraint' && !validUntil) { setNotice('请写明这项约束适用到哪一天。'); return }
      if (editing) await api('/api/growth/' + editing.id + '/actions', { requestId: requestId(key), expectedRevision: editing.revision, action: 'correct', text: text.trim(), validUntil, ...feedback })
      else {
        await api('/api/conversations', { id: conversationId, title: conversationTitle })
        await api('/api/growth', { requestId: requestId(key), conversationId, kind, text: text.trim(), ...(validUntil ? { validUntil } : {}), ...feedback })
      }
      pending.current.delete(key); setText(''); setUntil(''); setEditing(null); await load(); dataChanged(); setNotice('已保存')
    } catch (error) { setNotice(explainError(error)); await load().catch(() => {}) }
    finally { setBusy(false) }
  }
  async function load() { setView(await api<GrowthView>('/api/growth')) }
  async function resumeRecommendation(item: GrowthItem) {
    if (busy) return
    setBusy(true); setNotice('')
    try {
      await api('/api/growth/recommendation-controls/' + item.id + '/actions', { requestId: requestId(JSON.stringify([item.id, 'resume-recommendation'])) })
      await load(); dataChanged(); setNotice('已恢复推荐')
    } catch (error) { setNotice(explainError(error)); await load().catch(() => {}) }
    finally { setBusy(false) }
  }
  async function act(item: GrowthItem, action: 'accept' | 'pause' | 'complete' | 'reject' | 'forget') {
    if (busy) return
    setBusy(true); setNotice('')
    const key = JSON.stringify([item.id, item.revision, action])
    try {
      await api('/api/growth/' + item.id + '/actions', { requestId: requestId(key), expectedRevision: item.revision, action })
      pending.current.delete(key)
      if (editing?.id === item.id) { setEditing(null); setText(''); setUntil('') }
      await load(); dataChanged()
      setNotice(action === 'forget' ? '已遗忘，原话不再用作建议依据' : action === 'accept' ? '已采用这项观察' : '已更新')
    } catch (error) { setNotice(explainError(error)); await load().catch(() => {}) }
    finally { setBusy(false) }
  }
  const currentItems = (view?.items ?? []).filter(item => !['rejected', 'completed', 'paused'].includes(item.status))
  const historicalItems = (view?.items ?? []).filter(item => ['rejected', 'completed', 'paused'].includes(item.status))
  function card(item: GrowthItem) {
    return <article className="growth-card" key={item.id}>
      <div className="growth-card-top"><span className="growth-card-kind">{growthLabels[item.kind]}</span><span className={`growth-card-state is-${item.status}`}>{states[item.status]}</span></div>
      <p>{item.text || '依据已撤回，内容已清除。'}</p>
      {item.limitation && <p className="growth-card-limit">局限：{item.limitation}</p>}
      {item.progressState && item.progressState !== 'unknown' && <span className="growth-card-tag">{progressLabels[item.progressState]}</span>}
      {item.validUntil && <span className="growth-card-tag">至 {new Date(item.validUntil).toLocaleDateString('zh-CN')}</span>}
      {item.unavailableReason && <span className="growth-card-tag is-warn">需核对</span>}
      {!!item.sources.length && <details><summary>依据</summary>{item.sources.map((source, index) => <blockquote key={index}>{source.quote}</blockquote>)}</details>}
      <div className="growth-card-actions">
        <button disabled={busy || !item.text} onClick={() => { setEditing(item); setKind(item.kind); setText(item.text); setProgressState(item.progressState ?? 'unknown'); setUntil(item.validUntil ? new Date(Date.parse(item.validUntil) - new Date(item.validUntil).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '') }}>更正</button>
        {item.status === 'proposed' && !item.unavailableReason && <button disabled={busy} onClick={() => void act(item, 'accept')}>采用</button>}
        {['goal', 'direction', 'priority', 'decision'].includes(item.kind) && item.status === 'active' && <button disabled={busy} onClick={() => void act(item, 'pause')}>暂停</button>}
        {['goal', 'priority', 'decision'].includes(item.kind) && item.status === 'active' && <button disabled={busy} onClick={() => void act(item, 'complete')}>结束</button>}
        {item.recommendationStopped && <button disabled={busy} onClick={() => void resumeRecommendation(item)}>恢复推荐</button>}
        {item.status !== 'rejected' && <button disabled={busy} onClick={() => void act(item, 'reject')}>不再采用</button>}
        <button className="growth-danger" disabled={busy} onClick={() => void act(item, 'forget')}>遗忘</button>
      </div>
    </article>
  }
  const pausedDirections = (directionControls ?? []).filter(row => row.state === 'paused')
  return <dialog ref={dialog} className="growth-page" aria-labelledby="growth-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="growth-body">
      <header className="growth-header">
        <div><span className="growth-brand">LifeOS</span><h1 id="growth-title">我的成长</h1></div>
        <button ref={closeRef} onClick={onClose}>返回聊天</button>
      </header>
      <main className="growth-main">
        {notice && <p className="growth-notice" role="status">{notice}</p>}
        {view && !view.memoryEnabled && <p className="growth-warn">跨会话记忆未开启，AI 仅使用当前会话的情况。</p>}
        {!view ? <p className="growth-loading">正在读取…</p> : <div className="growth-grid">{sections.map(section => <section key={section.title}><h2>{section.title}</h2>{currentItems.filter(item => section.kinds.includes(item.kind)).map(card)}{!currentItems.some(item => section.kinds.includes(item.kind)) && <p className="growth-empty">暂无记录</p>}</section>)}</div>}
        <form onSubmit={event => void save(event)} className="growth-form">
          <h2>{editing ? '更正记录' : '添加记录'}</h2>
          <div className="growth-form-row">
            <label>类型<select value={kind} disabled={busy || !!editing} onChange={event => setKind(event.target.value as GrowthKind)}>{Object.entries(growthLabels).filter(([key]) => key !== 'observation').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>适用到{kind === 'constraint' ? '（必填）' : '（选填）'}<input type="datetime-local" value={until} required={kind === 'constraint'} disabled={busy} onChange={event => setUntil(event.target.value)} /></label>
          </div>
          <label>内容<textarea value={text} disabled={busy} onChange={event => setText(event.target.value)} maxLength={4000} required placeholder="例如：还没确定毕业方向；这周优先期末。" /></label>
          {kind === 'feedback' && <label>行动状态<select value={progressState} disabled={busy} onChange={event => setProgressState(event.target.value as NonNullable<GrowthItem['progressState']>)}>{Object.entries(progressLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          <div className="growth-form-actions"><button type="submit" className="growth-primary" disabled={busy || !text.trim()}>{busy ? '保存中…' : '保存'}</button>{editing && <button type="button" disabled={busy} onClick={() => { setEditing(null); setText(''); setUntil(''); setKind('goal') }}>取消</button>}</div>
        </form>
        {!!pausedDirections.length && <section className="growth-directions"><h2>已暂停的方向</h2>{pausedDirections.map(row => <div key={row.scope} className="growth-card"><p>{row.scopeLabel}{onSendControl && <button disabled={busy} onClick={() => { onSendControl(`恢复${row.scopeLabel}建议`); onClose() }}>恢复建议</button>}</p></div>)}</section>}
        {!!historicalItems.length && <details className="growth-history"><summary>历史记录（{historicalItems.length}）</summary>{historicalItems.map(card)}</details>}
      </main>
    </div>
  </dialog>
}
