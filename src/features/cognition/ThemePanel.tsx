import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { graph, subscribeGraph, getGraphRevision } from './graph.ts'
import { api, dataChanged, explainError } from '../../backend/client'

const KIND_LABELS: Record<string, string> = { goal: '目标', pursuit: '阶段追求', valued_point: '重视点', interest: '兴趣探索' }
const RELATION_LABELS: Record<string, string> = { exploring: '正在探索', acting_toward: '为目标行动', partial_evidence: '提供局部证据', constraint: '存在限制', correction: '修正既有认识' }

// 主题详情：解释、依据、关联经历、最近变化，以及置顶/重命名/暂缓/撤销。
// 所有操作走修订校验的 /api/themes 接口，持久化在账号下。
export function ThemePanel({ themeNodeId, onClose }: { themeNodeId: string; onClose: () => void }) {
  useSyncExternalStore(subscribeGraph, getGraphRevision)
  const node = graph.getNode(themeNodeId)
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [renaming, setRenaming] = useState(false), [title, setTitle] = useState(node?.title ?? '')
  const linked = node ? graph.getExperiencesForValue(node.id) : []
  const edges = node ? graph.data.edges.filter(edge => edge.type === 'RELATES_TO_VALUE' && edge.targetId === node.id) : []
  useEffect(() => { dialog.current?.showModal(); close.current?.focus(); const el = dialog.current; return () => el?.close() }, [])
  if (!node) return null
  const revision = node.themeRevision ?? 1
  const actLink = async (experienceServerId: string, themeId: string, action: 'confirm' | 'revoke') => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await api(`/api/theme-links/${experienceServerId}/${themeId}/actions`, { requestId: crypto.randomUUID(), action })
      dataChanged(); onClose()
    } catch (caught) { setError(explainError(caught)) } finally { setBusy(false) }
  }
  const act = async (action: string, nextTitle?: string) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await api(`/api/themes/${node.themeId}/actions`, { requestId: crypto.randomUUID(), expectedRevision: revision, action, ...(nextTitle !== undefined ? { title: nextTitle } : {}) })
      dataChanged(); setRenaming(false); onClose()
    } catch (caught) { setError(explainError(caught)) } finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="record-panel theme-panel" aria-labelledby="theme-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="record-body">
      <header className="record-header">
        <button ref={close} onClick={onClose} aria-label="关闭主题详情，返回原位">返回</button>
        <span className="theme-kinds">{KIND_LABELS[node.themeKind ?? 'pursuit'] ?? '主题'}{node.themeStatus === 'pending' ? ' · 待核对' : ''}{node.themePinned ? ' · 已置顶' : ''}</span>
      </header>
      <main className="record-content">
        <h2 id="theme-title">{node.title}</h2>
        {error && <p className="storage-error" role="alert">{error}</p>}
        {renaming
          ? <form className="theme-rename" onSubmit={event => { event.preventDefault(); if (title.trim()) void act('rename', title.trim()) }}>
            <label htmlFor="theme-title-input">主题名称</label>
            <input id="theme-title-input" value={title} maxLength={60} onChange={event => setTitle(event.target.value)} />
            <div className="record-story-controls"><button type="submit" disabled={busy || !title.trim()}>{busy ? '保存中…' : '保存'}</button><button type="button" disabled={busy} onClick={() => { setRenaming(false); setTitle(node.title) }}>取消</button></div>
          </form>
          : <p className="record-summary">{(node.description ?? '').split('\n').slice(1).join('\n') || '这个主题来自你说过的话；关联经历会随对话继续补充。'}</p>}
        {node.themeUpdatedAt && <p className="record-date">最近更新：{new Date(node.themeUpdatedAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</p>}
        <section className="record-story" aria-label="关联经历">
          <h3>关联经历（{linked.length}）</h3>
          {linked.length ? linked.map(id => {
            const experience = graph.getNode(id)!, edge = edges.find(item => item.sourceId === id)
            return <div key={id} className="theme-experience-block">
              <p className="theme-experience">{experience?.title}{edge && RELATION_LABELS[edge.status] ? <span className="theme-relation"> · {RELATION_LABELS[edge.status]}</span> : null}{(edge as any)?.confirmed ? <span className="theme-confirmed"> · 已确认</span> : <span className="theme-candidate"> · 待核对</span>}</p>
              {edge?.reason ? <span className="theme-evidence">为什么这样连线：{edge.reason}</span> : null}
              {edge && (edge as any).sourceEvidence?.length ? <span className="theme-evidence">来源原话：「{(edge as any).sourceEvidence[0]}」</span> : null}
              {experience?.serverId && node.themeId && <div className="theme-link-actions">
                {!(edge as any)?.confirmed && <button type="button" disabled={busy} onClick={() => void actLink(experience.serverId!, node.themeId!, 'confirm')}>确认连线</button>}
                <button type="button" disabled={busy} onClick={() => void actLink(experience.serverId!, node.themeId!, 'revoke')}>撤销连线</button>
              </div>}
            </div>
          }) : <p className="record-story-empty">还没有关联经历。聊到与这个主题相关的行动后会自动挂上来。</p>}
        </section>
        <div className="theme-actions">
          <button type="button" onClick={() => {
            onClose()
            window.dispatchEvent(new CustomEvent('lifeos-open-conversation'))
            sessionStorage.setItem('lifeos:pending-conversation-draft', `聊聊「${node.title}」这个方向，帮我看看下一步`)
            sessionStorage.setItem('lifeos:focus-context', JSON.stringify({ type: 'theme', id: node.themeId, label: node.title.slice(0, 80) }))
          }}>继续聊这个主题</button>
          {!renaming && <button type="button" disabled={busy} onClick={() => { setRenaming(true); setTitle(node.title) }}>重命名</button>}
          <button type="button" disabled={busy} onClick={() => void act(node.themePinned ? 'unpin' : 'pin')}>{node.themePinned ? '取消置顶' : '置顶'}</button>
          {node.themeStatus !== 'paused' && node.themeStatus !== 'retired' && <button type="button" disabled={busy} onClick={() => void act('pause')}>暂缓</button>}
          {node.themeStatus === 'paused' && <button type="button" disabled={busy} onClick={() => void act('resume')}>恢复</button>}
          {node.themeStatus !== 'retired' && <button type="button" className="theme-danger" disabled={busy} onClick={() => void act('revoke')}>撤销主题</button>}
        </div>
        <p className="theme-note">撤销后这个主题不再出现在星图，也不会从历史原话自动重建；关联经历本身保留。</p>
      </main>
    </div>
  </dialog>
}
