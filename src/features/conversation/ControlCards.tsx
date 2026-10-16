import { useCallback, useEffect, useRef, useState } from 'react'
import { api, dataChanged, explainError } from '../../backend/client'

// P6 closeout A2b: durable control confirmations. When a chat control clause
// (遗忘 / 暂停使用 / 停止推荐) matched several similar records, the request
// persisted server-side; this card lets the user pick the exact record or
// cancel — in this conversation and after a refresh or a new session.

type ControlRequest = {
  id: string
  requestId: string
  conversationId: string
  conversationTitle: string | null
  kind: 'forget' | 'pause_use' | 'stop_recommend'
  clauseText: string
  candidates: { itemId: string; preview: string }[]
  status: 'pending' | 'confirmed' | 'cancelled'
  createdAt: string
}

const kindText: Record<ControlRequest['kind'], string> = {
  forget: '遗忘（清除该记录内容，原话不再作依据）',
  pause_use: '暂停使用（记录保留，不再作为建议依据）',
  stop_recommend: '停止推荐（记录保留，不再主动推荐）',
}

// Account-wide: pending confirmations follow the USER, not the conversation —
// a request raised in another chat (or before this one existed) still shows
// here, labeled with its source conversation. Never crosses accounts.
export function ControlCards({ conversationId, refreshKey, onResolved }: { conversationId: string; refreshKey: number; onResolved?: () => void }) {
  const [requests, setRequests] = useState<ControlRequest[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')
  const loadEpoch = useRef(0)
  const load = useCallback(() => {
    const epoch = ++loadEpoch.current
    api<{ requests: ControlRequest[] }>('/api/growth/control-requests')
      .then(value => { if (epoch === loadEpoch.current) { setRequests(value.requests.filter(row => row.status === 'pending')); setLoadError('') } })
      .catch(error => { if (epoch === loadEpoch.current) setLoadError(explainError(error)) })
  }, [])
  useEffect(() => { load(); return () => { loadEpoch.current += 1 } }, [load, refreshKey])
  if (!requests.length && !notice && !loadError) return null
  async function act(request: ControlRequest, action: 'confirm' | 'cancel', itemId?: string) {
    if (busy) return
    setBusy(true); setNotice('')
    try {
      const result = await api<{ result: { status: string; boundary: string } | null }>('/api/growth/control-requests/' + request.id + '/actions', { requestId: request.requestId, action, ...(itemId ? { itemId } : {}) })
      const done = result.result?.status === 'executed'
      setNotice(done
        ? (request.kind === 'forget' ? '已遗忘所选记录。' : request.kind === 'stop_recommend' ? '已停止主动推荐所选事项，原记录保留。' : '已暂停使用所选记录作为建议依据，原记录保留。')
        : action === 'cancel' ? '已取消这次控制请求，记录保持原样。' : '这次确认尚未生效，请核对当前记录后再操作。')
      dataChanged(); load(); onResolved?.()
    } catch (error) { setNotice(explainError(error)) }
    finally { setBusy(false) }
  }
  return <section className="qa-control-cards" aria-label={requests.length ? '待确认的记录控制' : '记录控制结果'}>
    {notice && <p className="qa-control-notice" role="status">{notice}</p>}
    {loadError && <p className="qa-control-error" role="alert">{loadError}<button type="button" disabled={busy} onClick={load}>重新读取</button></p>}
    {requests.map(request => <article key={request.id} className="qa-control-card">
      <p className="qa-control-question">你之前说「{request.clauseText}」，{request.candidates.length > 1 ? '匹配到多条相似记录，请选择要操作的那条：' : '请确认你指的是不是这条记录：'}</p>
      <p className="qa-control-kind">操作：{kindText[request.kind]}{request.conversationId !== conversationId ? ` · 来自会话：${request.conversationTitle ?? '早前的对话'}` : ''}</p>
      <ul>
        {request.candidates.map(candidate => <li key={candidate.itemId}>
          <span>{candidate.preview}</span>
          <button type="button" disabled={busy} onClick={() => void act(request, 'confirm', candidate.itemId)}>就是这条</button>
        </li>)}
      </ul>
      <button type="button" className="qa-control-cancel" disabled={busy} onClick={() => void act(request, 'cancel')}>都不是 / 先不操作</button>
    </article>)}
  </section>
}
