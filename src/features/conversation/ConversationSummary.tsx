import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Conversation } from './flow'
import { WorkspaceIcon as Icon } from './WorkspaceIcon'
import { api, dataChanged, explainError, type Experience, type ServerDecision } from '../../backend/client'
import './summary.css'

type EventRecord = {
  id: string; conversationId: string; title: string; revision: number; generation: number
  nodes: { id: string; revision: number; kind: 'fact' | 'feeling' | 'user_interpretation' | 'unknown'; status: 'active' | 'resolved' | 'declined'; content: string; source: { messageId: string; quote: string; conversationId: string } | null }[]
  actions: { id: string; revision: number; status: 'proposed' | 'closed' | 'stale'; draft: { content?: string; goal?: string; start?: string; materials?: string[]; observable?: string; effort?: string; stopWhen?: string } | null; closedReason: string | null }[]
  asked: string[]; updatedAt: string
}
type LegacyRecords = { decisions: { version: number; payload: ServerDecision['payload'] | null }[]; inquiries: { id: string; stale: boolean; payload: { question: string; experiments: { action: string }[] } | null }[] }
const kinds = { fact: '你说过的经过', feeling: '你的感受', user_interpretation: '你的解释', unknown: '还没核对' }

export function ConversationSummary({ conversation, conversationId, live = false, onContinue }: { conversation: Conversation; conversationId: string; live?: boolean; onContinue: (prompt?: string) => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const epoch = useRef(0)
  const [event, setEvent] = useState<EventRecord | null>(null)
  const [selected, setSelected] = useState<string | undefined>()
  const [experiences, setExperiences] = useState<Experience[]>([])
  const [loading, setLoading] = useState(live)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [experiencesOpen, setExperiencesOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [correction, setCorrection] = useState('')
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<EventRecord[]>([])
  const [searched, setSearched] = useState(false)
  const [legacy, setLegacy] = useState<LegacyRecords | null>(null)

  async function reload(id?: string) {
    const current = ++epoch.current
    setEvent(null); setExperiences([]); setLoading(true)
    if (!live) { setLoading(false); return }
    try {
      const [record, rows] = await Promise.all([api<EventRecord | null>('/api/conversations/' + conversationId + '/event' + (id ? '?id=' + id : '')), api<Experience[]>('/api/experiences?conversation=' + conversationId)])
      if (current !== epoch.current) return
      setEvent(record); setExperiences(rows); setNotice('')
    } catch (error) { if (current === epoch.current) setNotice(explainError(error)) }
    finally { if (current === epoch.current) setLoading(false) }
  }
  useEffect(() => {
    setSelected(undefined); setMatches([]); setSearched(false); setLegacy(null)
    void reload()
    heading.current?.focus({ preventScroll: true })
    return () => { ++epoch.current }
  }, [conversationId, live])
  useEffect(() => {
    const changed = () => { setMatches([]); setLegacy(null); void reload(selected) }
    window.addEventListener('lifeos-data-changed', changed)
    return () => window.removeEventListener('lifeos-data-changed', changed)
  }, [conversationId, live, selected])

  async function copy(action: EventRecord['actions'][number]) {
    if (!event || saving) return
    setSaving(true); setNotice('')
    const current = epoch.current
    try {
      const fresh = await api<EventRecord>('/api/conversations/' + conversationId + '/event?id=' + event.id)
      if (current !== epoch.current) return
      setEvent(fresh)
      const item = fresh.actions.find(item => item.id === action.id && item.revision === action.revision && item.status === 'proposed')
      if (!item?.draft?.content) { setNotice('这份材料已更新或需要重新核对，请查看当前内容。'); return }
      await navigator.clipboard.writeText(item.draft.content)
      setNotice('已复制完整材料。复制不代表已经发送或执行。')
    } catch (error) {
      if (error instanceof Error && error.name === 'NotAllowedError') setNotice('浏览器没有允许复制，请选中材料文字手动复制。')
      else { setNotice(explainError(error)); setEvent(null) }
    }
    finally { setSaving(false) }
  }
  async function change(experience: Experience, action: 'confirm' | 'correct' | 'delete') {
    if (saving) return
    if (action === 'correct' && correction.length > 4000) { setNotice('修正内容超过4000字，全文仍保留，请精简后保存。'); return }
    setSaving(true); setNotice('')
    try {
      await api('/api/experiences/' + experience.id + '/actions', { requestId: crypto.randomUUID(), expectedRevision: experience.revision, action, ...(action === 'correct' ? { content: { summary: correction.trim() } } : {}) })
      setEditing(null); dataChanged()
    } catch (error) { setNotice(explainError(error)) }
    finally { setSaving(false) }
  }
  async function search(e: FormEvent) {
    e.preventDefault(); if (saving || !query.trim()) return
    setSaving(true); setNotice(''); setMatches([]); setSearched(false)
    const current = epoch.current
    try {
      const found = await api<{ events: EventRecord[]; ambiguous: boolean }>('/api/conversations/' + conversationId + '/event/search', { query: query.trim() })
      if (current !== epoch.current) return
      setMatches(found.events); setSearched(true)
      if (found.ambiguous) setNotice('有几件事可能相关，请先选择你指的那一件。')
    } catch (error) { setNotice(explainError(error)) }
    finally { setSaving(false) }
  }
  async function historical() {
    if (saving) return
    setSaving(true); setNotice('')
    const current = epoch.current
    try {
      const records = await api<LegacyRecords>('/api/conversations/' + conversationId + '/history')
      if (current === epoch.current) setLegacy(records)
    } catch (error) { setNotice(explainError(error)) }
    finally { setSaving(false) }
  }
  const reference = event ? `「${event.title}」${event.nodes.find(node => node.source)?.content ? `（之前说过：${event.nodes.find(node => node.source)!.content}）` : ''}` : ''
  const actions = event?.actions.filter(item => item.status === 'proposed' && item.draft) ?? []
  const unknowns = event?.nodes.filter(node => node.kind === 'unknown' && node.status === 'active') ?? []
  return <main className="qa-review" aria-label="事件与材料">
    <div className="qa-review-scroll"><div className="qa-review-content">
      <header className="qa-review-header"><h1 ref={heading} tabIndex={-1}>这件事与下一步</h1><button type="button" className="qa-icon-button" aria-label="返回对话" onClick={() => onContinue()}><Icon name="close" /></button></header>
      {notice && <p className="qa-event-notice" role="status">{notice}</p>}
      {loading ? <p role="status" className="qa-event-muted">正在读取已保存的记录…</p> : event ? <>
        <h2 className="qa-event-title">{event.title}</h2>
        {!!unknowns.length && <section className="qa-event-unknowns" aria-label="尚未核对"><h3>接着核对</h3>{unknowns.map(node => <p key={node.id}>{node.content}</p>)}</section>}
        {actions.map(action => action.draft?.content && <section key={action.id} className="qa-event-material" aria-label="可用材料"><div className="qa-event-section-head"><h3>准备好的材料</h3><button type="button" disabled={saving} onClick={() => void copy(action)}>复制材料</button></div><p className="qa-event-muted">这是待你使用的草稿，还没有发送或执行。</p><div className="qa-event-text" tabIndex={0} aria-label="完整材料">{action.draft.content}</div>
          {(action.draft.start || action.draft.observable || action.draft.stopWhen || action.draft.effort || action.draft.goal || action.draft.materials?.length) && <details><summary>怎么开始与何时结束</summary><dl>{[['要达到什么', action.draft.goal], ['从这里开始', action.draft.start], ['使用已有材料', action.draft.materials?.join('\n')], ['可观察的产物', action.draft.observable], ['可承受投入', action.draft.effort], ['暂停或结束', action.draft.stopWhen]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>}
        </section>)}
        {event.actions.some(item => item.status === 'stale') && <p className="qa-event-muted">之前的材料依据已改变，需要重新核对后再用。</p>}
        <details className="qa-event-process"><summary>查看事情经过（{event.nodes.length}条）</summary><ol>{event.nodes.map(node => <li key={node.id}><span className="qa-event-muted">{kinds[node.kind]}{node.status === 'resolved' ? ' · 已回答' : node.status === 'declined' ? ' · 暂不追问' : ''}</span><p>{node.content}</p>{node.source && <button type="button" onClick={() => onContinue(`更正「${event.title}」中的原话「${node.content}」：`)}>补充或更正</button>}</li>)}</ol>{event.asked.length > 0 && <details><summary>回复中的问句</summary><ul>{event.asked.map(question => <li key={question}>{question}</li>)}</ul></details>}</details>
        {event.actions.some(item => item.status === 'closed') && <details><summary>已结束的行动</summary>{event.actions.filter(item => item.status === 'closed').map(item => <div key={item.id}><p>{item.closedReason === 'replaced' ? '已由新的材料替代' : item.closedReason || '已结束'}</p>{item.draft?.content && <p className="qa-event-text">{item.draft.content}</p>}</div>)}</details>}
        <button type="button" className="qa-event-continue" onClick={() => onContinue(`继续${reference}。我想补充：`)}>继续这件事<Icon name="arrow" size={16} /></button>
      </> : <p className="qa-event-empty">{conversation.demo ? '这是本地示例。登录后的真实对话会按需要保存过程和材料。' : '这段对话还没有需要单独保存的事件。可以继续倾听或讨论，不必先做一份计划。'}</p>}
      {live && <details className="qa-event-history"><summary>找之前的事</summary><form className="qa-event-search" onSubmit={search}><input aria-label="描述之前的事件" placeholder="例如：之前交付资料的那件事" value={query} onChange={e => setQuery(e.target.value)} /><button type="submit" disabled={saving || !query.trim()}>查找</button></form><p className="qa-event-muted">跨对话查找需要开启长期记忆，结果由你确认。</p>{matches.map(item => <button type="button" className="qa-event-match" key={item.id} onClick={() => { setSelected(item.id); void reload(item.id) }}><strong>{item.title}</strong><span>{item.nodes.find(node => node.source)?.content}</span></button>)}{searched && !matches.length && <p className="qa-event-muted">本次没有找到可读取的候选。可以补充对象或时间，或回到原对话。</p>}</details>}
      {!!experiences.length && <details className="qa-event-experiences" open={experiencesOpen} onToggle={e => setExperiencesOpen(e.currentTarget.open)}><summary>经历候选与确认（{experiences.length}条）</summary><p className="qa-event-muted">确认只代表发生过这件事，关联解释仍需核对。</p>{experiences.map(experience => <article key={experience.id}><h3>{experience.status === 'confirmed' ? '你已确认' : '等待你确认'}</h3>{editing === experience.id ? <form onSubmit={e => { e.preventDefault(); void change(experience, 'correct') }}><textarea aria-label="修正经历" required value={correction} onChange={e => setCorrection(e.target.value)} /><div className="qa-event-controls"><button type="submit" disabled={saving || !correction.trim()}>保存修正</button><button type="button" disabled={saving} onClick={() => setEditing(null)}>取消</button></div></form> : <p>{experience.content.summary}</p>}<details><summary>原始来源</summary><p>{experience.source_quote}</p></details><div className="qa-event-controls">{experience.status === 'candidate' && <button type="button" disabled={saving} onClick={() => void change(experience, 'confirm')}>确认经历</button>}<button type="button" disabled={saving} onClick={() => { setEditing(experience.id); setCorrection(experience.content.summary) }}>修正</button><button type="button" disabled={saving} onClick={() => void change(experience, 'delete')}>删除</button></div></article>)}</details>}
      {live && <details className="qa-event-legacy"><summary>旧版记录（只读）</summary><button type="button" disabled={saving} onClick={() => void historical()}>读取旧版记录</button>{legacy && <>{!legacy.decisions.length && !legacy.inquiries.length && <p className="qa-event-muted">没有旧版记录。</p>}{legacy.decisions.map(item => <details key={item.version}><summary>历史建议 · 版本{item.version}</summary>{item.payload ? <><h3>{item.payload.recommendation.title}</h3><p>{item.payload.recommendation.text}</p>{item.payload.conditions.map((condition, i) => <p key={i}>当时依据：{condition.text}</p>)}</> : <p>原依据已失效或无法核对，历史内容已隐藏。</p>}</details>)}{legacy.inquiries.map(item => <details key={item.id}><summary>{item.stale ? '待重新核对的历史梳理' : '历史校园梳理'}</summary>{item.payload ? <><p>{item.payload.question}</p>{item.payload.experiments.map((experiment, i) => <p key={i}>当时提出的行动：{experiment.action}</p>)}</> : <p>原依据已改变或撤回，历史内容已隐藏。</p>}</details>)}</>}</details>}
    </div></div>
    <footer className="qa-review-footer"><button type="button" onClick={() => onContinue()}>返回对话<Icon name="arrow" size={16} /></button></footer>
  </main>
}
