import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { graph, graphSource, REVIEW_KEY, type Review } from './graph.ts'
import { api, dataChanged, explainError } from '../../backend/client'
import { parseRecordDrafts, recordEditingDraft, recordCorrectionContent, recordLocalCorrection, RECORD_KEY, type RecordDraft } from './recordDraft.ts'
import type { CognitionController } from './state.ts'
import { summarizeExperience } from '../../../server/experience-insight.ts'

const outcomeLabels:Record<string,string>={reported_read:'报告时已读',reported_not_read:'报告时未读',reported_response:'报告时已回复',reported_no_response:'报告时未回复',reported_not_used:'报告时未使用',reported_used:'报告时已使用',reported_unpaid:'报告时未付款',reported_paid:'报告时已付款',reported_effect:'已报告效果',unknown:'未知'}
export const outcomeStatusLabel=(status?:string)=>outcomeLabels[status??'unknown']??'未知'

export function RecordPanel({ controller, onBack }: { controller: CognitionController; onBack: () => void }) {
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const node = graph.getNode(view.activeRecordId!)!
  const dialog = useRef<HTMLDialogElement>(null), back = useRef<HTMLButtonElement>(null), edit = useRef<HTMLButtonElement>(null)
  const initialForm = useRef<RecordDraft>({})
  const live = graphSource === 'database' && !!node.serverId
  const revision = useRef(node.serverRevision ?? 1)
  const [saving, setSaving] = useState(false)
  const [savedTitle, setSavedTitle] = useState(node.title)
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
  const summary = draft.summary ?? node.summary ?? ''
  const graphPending = live && node.serverRevision !== revision.current
  // Until the revised graph arrives, derive display text from the actual save
  // response, not the old node. Display defaults never enter the edit payload.
  const experienceSummary = node.experienceSummary && Object.keys(draft).length && (!live || graphPending)
    ? summarizeExperience({ ...recordEditingDraft(node, draft), applicableOutcomes: [] }) : node.experienceSummary
  const cancel = () => { setEditing(false); setNotice(''); requestAnimationFrame(() => edit.current?.focus()) }
  const startEdit = () => {
    const next = recordEditingDraft(node, draft)
    initialForm.current = next; setForm(next)
    setReason(review?.editedReason ?? edge?.reason ?? ''); setDisposition(review?.disposition ?? 'proposed'); setNotice(''); setEditing(true)
  }
  const save = async () => {
    if (saving) return
    const next = form, reasonChanged = reason.trim() !== (review?.editedReason ?? edge?.reason ?? '')
    if (!next.summary?.trim()) { setError('请填写经历描述，再保存。'); return }
    const relationChanged = !!edge && (reasonChanged || disposition !== (review?.disposition ?? 'proposed'))
    if (relationChanged && !reason.trim()) { setError('请填写关联解释。'); return }
    if (live && node.serverId) {
      const changed = JSON.stringify(next) !== JSON.stringify(initialForm.current)
      if (!changed && !relationChanged) { cancel(); return }
      setSaving(true)
      try {
        const updated = await api('/api/experiences/' + node.serverId + '/actions', {
          requestId: crypto.randomUUID(), expectedRevision: revision.current, action: changed ? 'correct' : 'review',
          ...(changed ? { content: recordCorrectionContent(initialForm.current, next) } : {}), ...(relationChanged && edge ? { link: { valueId: edge.targetId, reason: reason.trim(), disposition: disposition === 'proposed' ? 'edited' : disposition } } : {}),
        })
        revision.current = updated.revision; setSavedTitle(updated.content?.title ?? node.title); setDraft(updated.content ?? next); initialForm.current = recordEditingDraft(updated.content ?? next, {}); setEditing(false); setError(''); setNotice('已保存到你的账户'); dataChanged()
      } catch (error) { setError(explainError(error)) }
      finally { setSaving(false) }
      return
    }
    let recordSaved = false
    try {
      if (JSON.stringify(next) !== JSON.stringify(initialForm.current)) {
        const records = parseRecordDrafts(localStorage.getItem(RECORD_KEY))
        const checked = parseRecordDrafts(JSON.stringify({ ...records, [node.id]: recordLocalCorrection(records[node.id] ?? {}, initialForm.current, next) }))
        localStorage.setItem(RECORD_KEY, JSON.stringify(checked)); setDraft(checked[node.id]); initialForm.current = recordEditingDraft(node, checked[node.id]); recordSaved = true
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
        <h2 id="record-title">{graphPending ? savedTitle : node.title}</h2>
        {error && <p className="storage-error" role="alert">{error}</p>}
        {editing ? <form id="record-edit-form" className="record-editor" onSubmit={event => { event.preventDefault(); void save() }}>
          <label htmlFor="record-summary">经历</label><textarea id="record-summary" required maxLength={4000} disabled={saving} value={form.summary ?? ''} onChange={e => setForm({ ...form, summary: e.target.value })} />
          {fields.map(field => <div key={field.key}>
            <label htmlFor={'record-' + field.key}>{field.label}</label>
            {field.key === 'occurredAt'
              ? <input id={'record-' + field.key} maxLength={200} disabled={saving} value={form[field.key] ?? ''} onChange={e => setForm({ ...form, [field.key]: e.target.value })} />
              : <textarea id={'record-' + field.key} maxLength={4000} disabled={saving} value={form[field.key] ?? ''} onChange={e => setForm({ ...form, [field.key]: e.target.value })} />}
          </div>)}
          {live && <button type="button" disabled={saving} onClick={async () => {
            setSaving(true)
            try { await api('/api/experiences/' + node.serverId + '/actions', { requestId: crypto.randomUUID(), expectedRevision: revision.current, action: 'delete' }); dataChanged(); onBack() }
            catch (error) { setError(explainError(error)); setSaving(false) }
          }}>删除经历</button>}
        </form> : <>
          {summary && <p className="record-summary">{summary}</p>}
          {graphPending && <p className="record-notice" role="status">更正已保存，相关解释正在刷新；旧解释与建议暂不展示。</p>}
          {content('occurredAt') && <p className="record-date">{content('occurredAt')}</p>}
          {!experienceSummary && fields.filter(field => field.key !== 'occurredAt' && content(field.key)).map(field => <section className="record-story" key={field.key}>
            <h3>{field.label}</h3><p>{content(field.key)}</p>
          </section>)}
          {node.conversationId && node.conversationTitle && <p className="record-conversation">来自对话：{node.conversationTitle}（<button type="button" onClick={() => {
            onBack()
            sessionStorage.setItem('lifeos:pending-conversation', node.conversationId!)
            if (node.sourceMessageId) sessionStorage.setItem('lifeos:pending-conversation-message', node.sourceMessageId)
            window.dispatchEvent(new CustomEvent('lifeos-open-conversation'))
          }}>打开原对话</button>）</p>}
          {!graphPending && (node as any).insight && <section className="record-insight">
            <p className="record-insight-headline">{(node as any).insight.headline}</p>
            {(node as any).insight.evidence && <p className="record-insight-evidence">{(node as any).insight.evidence}</p>}
            <div className="record-badges">
              {Array.isArray((node as any).skillTags) && (node as any).skillTags.length > 0 && <span className="record-badge is-skill">{(node as any).skillTags.join(' · ')}</span>}
              {(node as any).blocked && <span className="record-badge is-blocked">未完成</span>}
              {(node as any).externalFeedback && <span className="record-badge is-external">含他人反馈</span>}
            </div>
          </section>}
          {experienceSummary && <section className="record-experience-summary" aria-label="经历摘要">
            <h3>经历摘要</h3>
            {!graphPending && (node as any).asReported?.reportedAt && <p>报告时间：{new Date((node as any).asReported.reportedAt).toLocaleString('zh-CN')}</p>}
            <dl>
              <div><dt>我做了什么</dt><dd>{experienceSummary.action}</dd></div>
              <div><dt>{(node as any).resultBasis==='record_correction'?'本人更正后的结果':(node as any).resultBasis==='source_report'?'当时报告的结果':'记录中的结果（待核对）'}</dt><dd>{experienceSummary.result}</dd></div>
              <div><dt>本人复盘</dt><dd>{experienceSummary.reflection}</dd></div>
              {experienceSummary.unknowns && <div><dt>仍未知</dt><dd>{experienceSummary.unknowns}</dd></div>}
            </dl>
          </section>}
          {!graphPending && Array.isArray((node as any).outcomeKeys) && (node as any).outcomeKeys.length > 0 && <section className="record-outcomes" aria-label="分别记录的结果">
            <h3>分别记录的结果</h3>
            <p>以下为这段经历各项最近适用的报告。上方摘要保留当时结果；不同材料的状态分别记录，未报告的结果仍未知。</p>
            <dl>{Object.entries({read:'是否读过',response:'是否回应',adoption:'是否采用',payment:'是否付款',effect:'实际效果'}).filter(([key])=>(node as any).outcomeKeys.includes(key)).map(([key,label])=>{
              const outcome=(node as any).taskOutcomes[key]
              return <div key={key}><dt>{label}</dt><dd>{outcomeStatusLabel(outcome?.status)}{outcome?.reportedAt && <span> · {new Date(outcome.reportedAt).toLocaleString('zh-CN')}</span>}{outcome?.quote && <span> · 原话：{outcome.quote}</span>}</dd></div>
            })}</dl>
          </section>}
          {!graphPending && originalValues.length > 0 && <section className="interpretation" aria-label="关联解释"><h3>关联的主题</h3>
            {values.length > 1 ? <div className="angle-options" role="group" aria-label="选择关联角度">{values.map(id => <button key={id} aria-pressed={angleId === id} onClick={() => controller.changeAngle(id)}>{graph.getNode(id)?.title}</button>)}</div> : values.length === 1 && <p className="single-value">{graph.getNode(values[0])?.title}</p>}
            {values.length && edge ? <p className="relation-reason">{review?.editedReason ?? edge.reason}</p> : <p className="relation-empty">暂无关联</p>}
          </section>}
          {!graphPending && Array.isArray((node as any).insight?.relatedTitles) && (node as any).insight.relatedTitles.length > 0 && <section className="record-related">
            <h3>相关的经历</h3>
            {(node as any).insight.relatedTitles.map((title: string, i: number) => <p key={i} className="record-related-item">· {title}</p>)}
          </section>}
          {!graphPending && (node as any).insight?.nextStep && <section className="record-next">
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
