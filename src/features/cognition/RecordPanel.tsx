import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { graph, graphSource, REVIEW_KEY, type Review } from './graph.ts'
import { api, dataChanged, explainError } from '../../backend/client'
import { parseRecordDrafts, RECORD_KEY, recordFields, type RecordDraft } from './recordDraft.ts'
import type { CognitionController } from './state.ts'

function normalized(input: RecordDraft): RecordDraft {
  return { ...Object.fromEntries(recordFields.map(key => [key, (input[key] ?? '').trim()])), tags: [...new Set((input.tags ?? []).map(tag => tag.trim()).filter(Boolean))] }
}

export function RecordPanel({ controller, onBack }: { controller: CognitionController; onBack: () => void }) {
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const node = graph.getNode(view.activeRecordId!)!
  const dialog = useRef<HTMLDialogElement>(null), back = useRef<HTMLButtonElement>(null), edit = useRef<HTMLButtonElement>(null)
  const initialForm = useRef<RecordDraft>({})
  const live = graphSource === 'database' && !!node.serverId
  const revision = useRef(node.serverRevision ?? 1)
  const [saving, setSaving] = useState(false)
  const [initial] = useState(() => {
    if (live) return { draft: {} as RecordDraft, error: '' }
    try { return { draft: parseRecordDrafts(localStorage.getItem(RECORD_KEY))[node.id] ?? {}, error: '' } }
    catch { return { draft: {} as RecordDraft, error: '无法读取本地记录，原数据未覆盖。' } }
  })
  const [draft, setDraft] = useState<RecordDraft>(initial.draft), [form, setForm] = useState<RecordDraft>({})
  const [editing, setEditing] = useState(false), [error, setError] = useState(initial.error), [notice, setNotice] = useState('')
  const [reason, setReason] = useState(''), [disposition, setDisposition] = useState<Review['disposition'] | 'proposed'>('proposed')
  const originalValues = graph.getValueIdsForExperience(node.id), values = graph.getValueIdsForExperience(node.id, view.reviews)
  // Reading defaults never become a navigation parent.
  const angleId = values.includes(view.interpretationValueId ?? '') ? view.interpretationValueId! : values[0] ?? originalValues[0]
  const edge = angleId ? graph.getRelationExplanation(node.id, angleId) : undefined
  const review = edge ? view.reviews[edge.id] : undefined
  const fields = [
    { key: 'occurredAt', label: '时间' }, { key: 'action', label: '行动' },
    { key: 'result', label: '结果' }, { key: 'reflection', label: '反思' },
  ] as const
  const content = (key: typeof fields[number]['key']) => draft[key] ?? node[key]
  const summary = draft.summary || node.summary || ''
  const cancel = () => { setEditing(false); setNotice(''); requestAnimationFrame(() => edit.current?.focus()) }
  const startEdit = () => {
    const next = { ...draft, summary, ...Object.fromEntries(fields.map(field => [field.key, content(field.key) ?? ''])) }
    initialForm.current = normalized(next); setForm(next)
    setReason(review?.editedReason ?? edge?.reason ?? ''); setDisposition(review?.disposition ?? 'proposed'); setNotice(''); setEditing(true)
  }
  const save = async () => {
    if (saving) return
    const next = normalized(form), reasonChanged = reason.trim() !== (review?.editedReason ?? edge?.reason ?? '')
    const relationChanged = !!edge && (reasonChanged || disposition !== (review?.disposition ?? 'proposed'))
    if (relationChanged && !reason.trim()) { setError('请填写关联解释。'); return }
    if (live && node.serverId) {
      const changed = JSON.stringify(next) !== JSON.stringify(initialForm.current)
      if (!changed && !relationChanged) { cancel(); return }
      setSaving(true)
      try {
        const updated = await api('/api/experiences/' + node.serverId + '/actions', {
          requestId: crypto.randomUUID(), expectedRevision: revision.current, action: changed ? 'correct' : 'review',
          ...(changed ? { content: next } : {}), ...(relationChanged && edge ? { link: { valueId: edge.targetId, reason: reason.trim(), disposition: disposition === 'proposed' ? 'edited' : disposition } } : {}),
        })
        revision.current = updated.revision; setDraft(next); initialForm.current = next; setEditing(false); setError(''); setNotice('已保存到你的账户'); dataChanged()
      } catch (error) { setError(explainError(error)) }
      finally { setSaving(false) }
      return
    }
    let recordSaved = false
    try {
      if (JSON.stringify(next) !== JSON.stringify(initialForm.current)) {
        const records = parseRecordDrafts(localStorage.getItem(RECORD_KEY))
        const checked = parseRecordDrafts(JSON.stringify({ ...records, [node.id]: next }))
        localStorage.setItem(RECORD_KEY, JSON.stringify(checked)); setDraft(next); initialForm.current = next; recordSaved = true
      }
    } catch { setError('保存失败，输入已保留。请检查存储权限或标签长度。'); return }
    if (relationChanged && edge) {
      const selected = disposition === 'proposed' ? 'edited' : disposition
      const ok = controller.review(edge.id, { disposition: selected, reviewedAt: new Date().toISOString(), ...(reasonChanged || selected === 'edited' ? { editedReason: reason.trim() } : {}) }, reviews => localStorage.setItem(REVIEW_KEY, JSON.stringify(reviews)))
      if (!ok) { setError(recordSaved ? '经历已保存，关联未保存；输入已保留。' : '关联未保存，输入已保留。'); return }
    }
    setEditing(false); setError(recordSaved ? '' : initial.error); setNotice(recordSaved || relationChanged ? '已保存' : ''); requestAnimationFrame(() => edit.current?.focus())
  }
  useEffect(() => { dialog.current?.showModal(); back.current?.focus(); const el = dialog.current; return () => el?.close() }, [])
  useLayoutEffect(() => { if (editing) document.getElementById('record-summary')?.focus() }, [editing])
  return <dialog ref={dialog} className="record-panel" aria-labelledby="record-title" onCancel={event => { event.preventDefault(); if (editing) cancel(); else onBack() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,input,select,summary')].filter(el => {
      const collapsed = el.closest('details:not([open])')
      return el.getClientRects().length > 0 && (!collapsed || el === collapsed.querySelector('summary'))
    })
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }}>
    <div className="record-body">
      <header className="record-header">
        <button ref={back} onClick={editing ? cancel : onBack} aria-label={editing ? '取消编辑' : '关闭记录，返回原位'}>{editing ? '取消' : '返回'}</button>
        {editing ? <button key="save" type="submit" form="record-edit-form" disabled={saving}>{saving ? '保存中…' : '保存'}</button> : <button key="edit" ref={edit} type="button" onClick={event => { event.preventDefault(); startEdit() }}>编辑</button>}
      </header>
      <main className="record-content">
        <h2 id="record-title">{node.title}</h2>
        {error && <p className="storage-error" role="alert">{error}</p>}
        {editing ? <form id="record-edit-form" className="record-editor" onSubmit={event => { event.preventDefault(); void save() }}>
          <label htmlFor="record-summary">经历</label><textarea id="record-summary" maxLength={4000} value={form.summary ?? ''} onChange={e => setForm({ ...form, summary: e.target.value })} />
          {live && <button type="button" disabled={saving} onClick={async () => {
            setSaving(true)
            try { await api('/api/experiences/' + node.serverId + '/actions', { requestId: crypto.randomUUID(), expectedRevision: revision.current, action: 'delete' }); dataChanged(); onBack() }
            catch (error) { setError(explainError(error)); setSaving(false) }
          }}>删除经历</button>}
        </form> : <>
          {content('occurredAt') && <p className="record-date">{content('occurredAt')}</p>}
          {node.conversationId && node.conversationTitle && <p className="record-conversation">来自对话：{node.conversationTitle}（<button type="button" onClick={() => {
            onBack()
            sessionStorage.setItem('lifeos:pending-conversation', node.conversationId!)
            if (node.sourceMessageId) sessionStorage.setItem('lifeos:pending-conversation-message', node.sourceMessageId)
            window.dispatchEvent(new CustomEvent('lifeos-open-conversation'))
          }}>打开原对话</button>）</p>}
          {(node as any).insight && <section className="record-insight">
            <p className="record-insight-headline">{(node as any).insight.headline}</p>
            {(node as any).insight.evidence && <p className="record-insight-evidence">{(node as any).insight.evidence}</p>}
            <div className="record-badges">
              {Array.isArray((node as any).skillTags) && (node as any).skillTags.length > 0 && <span className="record-badge is-skill">{(node as any).skillTags.join(' · ')}</span>}
              {(node as any).blocked && <span className="record-badge is-blocked">未完成</span>}
              {(node as any).externalFeedback && <span className="record-badge is-external">含他人反馈</span>}
            </div>
          </section>}
          {originalValues.length > 0 && <section className="interpretation" aria-label="关联解释"><h3>关联的主题</h3>
            {values.length > 1 ? <div className="angle-options" role="group" aria-label="选择关联角度">{values.map(id => <button key={id} aria-pressed={angleId === id} onClick={() => controller.changeAngle(id)}>{graph.getNode(id)?.title}</button>)}</div> : values.length === 1 && <p className="single-value">{graph.getNode(values[0])?.title}</p>}
            {values.length && edge ? <p className="relation-reason">{review?.editedReason ?? edge.reason}</p> : <p className="relation-empty">暂无关联</p>}
          </section>}
          {Array.isArray((node as any).insight?.relatedTitles) && (node as any).insight.relatedTitles.length > 0 && <section className="record-related">
            <h3>相关的经历</h3>
            {(node as any).insight.relatedTitles.map((title: string, i: number) => <p key={i} className="record-related-item">· {title}</p>)}
          </section>}
          {(node as any).insight?.nextStep && <section className="record-next">
            <h3>下一步</h3>
            <p>{(node as any).insight.nextStep}</p>
            {node.conversationId && node.conversationTitle && <button type="button" className="record-continue" onClick={() => {
              onBack()
              sessionStorage.setItem('lifeos:pending-conversation', node.conversationId!)
              sessionStorage.setItem('lifeos:pending-conversation-draft', `关于「${node.title.slice(0, 20)}」这段经历，${(node as any).insight?.nextStep?.slice(0, 30) ?? '帮我看看下一步怎么做'}`)
              if (node.serverId) sessionStorage.setItem('lifeos:focus-context', JSON.stringify({ type: 'experience', id: node.serverId, label: node.title.slice(0, 80) }))
              window.dispatchEvent(new CustomEvent('lifeos-open-conversation'))
            }}>跟 AI 聊聊这件事</button>}
          </section>}
        </>}
        {notice && <p className="record-notice" role="status">{notice}</p>}
      </main>
    </div>
  </dialog>
}
