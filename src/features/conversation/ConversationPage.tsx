import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { CodexSelect } from '../../components/ui/CodexSelect'
import { advanceConversation, beginExploration, createDemoConversation, type Conversation } from './flow.ts'
import { Companion, type CompanionMotion } from './Companion'
import { AnswerChoices } from './AnswerChoices'
import { AutoTextarea } from './AutoTextarea'
import { MemoryPanel } from './MemoryPanel'
import { ControlCards } from './ControlCards'
import { ReplyMarkdown } from './ReplyMarkdown'
import { GrowthWorkspace } from '../growth/GrowthWorkspace'
import { getAnswerQuestion, type AnswerOption } from './choices.ts'
import { WORKSPACE_KEY, chatTitle, newChat, newWorkspace, parseWorkspace, updateChat, type Chat, type Workspace } from './workspace.ts'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { WorkspaceIcon as Icon } from './WorkspaceIcon'
import { useVoiceInput } from './useVoiceInput'
import { api, ApiError, dataChanged, explainError, loadWorkspace, streamChat, type SessionUser } from '../../backend/client'
import './conversation.css'
import './workspace.css'

export function ConversationPage({ open, onClose, onRequestAuth, sessionRefresh }: { open: boolean; onClose: () => void; onRequestAuth: (onDone: () => Promise<void>) => void; sessionRefresh: RefObject<(() => Promise<void>) | null> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [growthOpen, setGrowthOpen] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const replyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const motionTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const [companionMotion, setCompanionMotion] = useState<CompanionMotion>('idle')
  const [loaded] = useState(() => {
    try { const raw = localStorage.getItem(WORKSPACE_KEY); return { workspace: raw ? parseWorkspace(raw) : newWorkspace(), blocked: false } }
    catch { return { workspace: newWorkspace(), blocked: true } }
  })
  const [workspace, setWorkspace] = useState(loaded.workspace)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [access,setAccess]=useState<{required:boolean;enabled?:boolean;remaining?:number;expiresAt?:string|null}|null>(null)
  const [connecting, setConnecting] = useState(true)
  const [cacheBlocked, setCacheBlocked] = useState(loaded.blocked)
  const remote = useRef<{ requestId: string; controller: AbortController; started: boolean } | null>(null)
  const retry = useRef<{ chatId: string; text: string; requestId: string } | null>(null)
  const active = workspace.chats.find(chat => chat.id === workspace.activeId)!
  const conversation = active.conversation
  const draft = active.draft
  const [projectId, setProjectId] = useState<string | null>(null)
  const project = workspace.projects.find(item => item.id === projectId)
  const currentProject = workspace.projects.find(item => item.id === active.projectId)
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 900px)').matches)
  const [sidebarOpen, setSidebarOpen] = useState(() => !matchMedia('(max-width: 900px)').matches)
  const sidebarTrigger = useRef<HTMLButtonElement>(null)
  const [storageNotice, setStorageNotice] = useState(loaded.blocked ? '本地对话未能读取。当前内容仅暂存内存，原保存数据没有被覆盖。' : '')
  const [busy, setBusy] = useState(false)
  useEffect(()=>{
    let current=true
    if(!user){setAccess(null);return}
    api<typeof access>('/api/access').then(value=>{if(current)setAccess(value)}).catch(()=>{if(current)setAccess(null)})
    return()=>{current=false}
  },[user?.id,busy])
  const [previous, setPrevious] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [controlRefresh, setControlRefresh] = useState(0)
  const [choicesOpen, setChoicesOpen] = useState(() => active.conversation.stage === 'confirm')
  const empty = conversation.messages.length === 0
  const question = getAnswerQuestion(conversation)
  const showChoices = choicesOpen && !!question && !busy
  const voice = useVoiceInput({ active: open && !busy && !project && !summaryOpen, draft, onDraft: setDraft, onFinish: () => input.current?.focus() })
  function setDraft(text: string) { setWorkspace(value => updateChat(value, value.activeId, { draft: text })) }
  function setConversation(next: Conversation) {
    setWorkspace(value => {
      const chat = value.chats.find(item => item.id === value.activeId)!
      return updateChat(value, value.activeId, { conversation: next, title: chat.renamed ? chat.title : chatTitle(next), updatedAt: Date.now() })
    })
  }
  useEffect(() => {
    if (busy || connecting || cacheBlocked) return
    try { localStorage.setItem(user ? WORKSPACE_KEY + '.' + user.id : WORKSPACE_KEY, JSON.stringify(workspace)); setStorageNotice('') }
    catch { setStorageNotice('浏览器未能保存本次改动，当前内容仍在页面中。请先保留重要文字，再刷新。') }
  }, [workspace, busy, connecting, cacheBlocked, user])
  useEffect(() => {
    let cancelled = false
    api<SessionUser>('/api/session').then(async nextUser => {
      let cached
      try { const raw = localStorage.getItem(WORKSPACE_KEY + '.' + nextUser.id); cached = raw ? parseWorkspace(raw) : undefined }
      catch { if (!cancelled) { setCacheBlocked(true); setStorageNotice('账户草稿未能读取，原保存数据没有被覆盖。') } }
      const next = applyPendingConversation(await loadWorkspace(nextUser, cached))
      if (!cancelled) { setUser(nextUser); setWorkspace(next); setChoicesOpen(false) }
    }).catch(error => { if (!cancelled && !(error instanceof ApiError && error.status === 401)) setNotice(explainError(error)) }).finally(() => { if (!cancelled) setConnecting(false) })
    return () => { cancelled = true; remote.current?.controller.abort() }
  }, [])
  // Opening a record's source conversation from the star map stashes the id
  // here; it applies only after the workspace (with all server conversations)
  // has loaded, and never creates anything.
  function applyPendingConversation(loaded: Workspace): Workspace {
    const pending = sessionStorage.getItem('lifeos:pending-conversation')
    if (!pending) return loaded
    sessionStorage.removeItem('lifeos:pending-conversation')
    const chat = loaded.chats.find(item => item.id === pending)
    return chat ? { ...loaded, activeId: chat.id } : loaded
  }
  async function loggedIn() {
    const nextUser = await api<SessionUser>('/api/session')
    let cached
    try { const raw = localStorage.getItem(WORKSPACE_KEY + '.' + nextUser.id); cached = raw ? parseWorkspace(raw) : undefined; setCacheBlocked(false) }
    catch { setCacheBlocked(true) }
    const next = applyPendingConversation(await loadWorkspace(nextUser, cached))
    setWorkspace(next); setUser(nextUser); setChoicesOpen(false); setNotice(''); dataChanged()
  }
  useEffect(() => {
    sessionRefresh.current = loggedIn
    return () => { sessionRefresh.current = null }
  }, [sessionRefresh])
  async function logout() {
    if (busy) return
    try {
      await api('/api/auth/sign-out', {})
      setUser(null); setWorkspace(loaded.workspace); setCacheBlocked(loaded.blocked); setSummaryOpen(false); setMemoryOpen(false); setChoicesOpen(false); setNotice('已退出登录'); dataChanged()
    } catch (error) { setNotice(explainError(error)) }
  }
  async function cancelRemote() {
    const current = remote.current
    if (!current) return
    try {
      const result = await api<{ status: string }>('/api/runs/' + current.requestId + '/cancel', {})
      if (result.status === 'completed') { setNotice('这轮已完成，正在同步结果。'); return }
      setNotice('已取消，本轮没有保存新回应、事件、材料或经历。')
    } catch { setNotice('已停止等待，正在同步已保存内容。') }
    retry.current = null; current.controller.abort()
  }
  async function sendRemote(text: string) {
    if (!user || remote.current) return
    if (text.length > 16000) { setNotice('这段内容超过单次 16000 字限制，全文仍保留在输入框中。请分段发送。'); return }
    const chatId = active.id, currentUser = user, current = conversation
    const savedRetry = retry.current
    const requestId = savedRetry?.chatId === chatId && savedRetry.text === text ? savedRetry.requestId : crypto.randomUUID()
    const pending = { requestId, controller: new AbortController(), started: false }
    remote.current = pending; retry.current = { chatId, text, requestId }; setBusy(true); setNotice(''); setChoicesOpen(false); setCompanionMotion('thinking')
    follow.current = true
    const userId = current.messages.length, assistantId = userId + 1
    let assistant = '', sourceId: string | undefined, completed = false, transient = false
    const render = () => setConversation({ ...current, stage: 'followup', demo: false, messages: [...current.messages, { id: userId, role: 'user', text, sourceId }, ...(assistant ? [{ id: assistantId, role: 'assistant' as const, text: assistant, transient }] : [])] })
    render()
    try {
      await api('/api/conversations', { id: chatId, title: active.title })
      pending.controller.signal.throwIfAborted()
      await streamChat(chatId, requestId, text, pending.controller.signal, event => {
        if (remote.current !== pending || pending.controller.signal.aborted) return
        if (event.type === 'started') { pending.started = true; sourceId = event.sourceMessageId; setDraft(''); render() }
        if (event.type === 'queued') setNotice('正在等待处理，你可以取消这次等待。')
        if (event.type === 'processing') setNotice('')
        if (event.type === 'draft') { assistant = event.text; transient = true; setCompanionMotion('answering'); render() }
        if (event.type === 'draft_discarded') { assistant = ''; transient = false; render() }
        if (event.type === 'delta') { assistant = event.replace ? event.text : assistant + event.text; transient = false; setCompanionMotion('answering'); render() }
        if (event.type === 'tool') setCompanionMotion(event.name === 'query_experiences' ? 'searching' : 'thinking')
        if (event.type === 'done') {
          completed = true; retry.current = null; dataChanged()
          // P5.5: the saved-message notice and the growth-archive update are
          // separate truths; show the real receipt from the committed run.
          const receipt=event.stateChange
          if(receipt){
            const growthNote=receipt.growth.status==='applied'?'成长档案已更新':receipt.growth.status==='partial'?'本轮部分更新已保存，个别未核项未保存':receipt.growth.status==='needs_confirmation'?'本轮要求的更新未完成，需要确认':'成长档案本轮无新增'
            const controlNote=receipt.controls?.changedScopes?.length?'；已暂停相关方向建议':''
            const materialNote=receipt.material?`；材料${receipt.material.readiness==='template'?'仍为待补模板':'草稿已生成（发送前请核对）'}`:''
            const memoryControlNote=receipt.memoryControl?.status==='executed'?(receipt.memoryControl.kind==='forget'?'；已遗忘你指定的记录':'；已暂停使用该经历作为依据，记录保留'):receipt.memoryControl?.status==='needs_confirmation'?'；有多个相似记录，请在下方确认要操作的那条':''
            setNotice(growthNote+controlNote+materialNote+memoryControlNote)
            if(receipt.memoryControl?.status==='needs_confirmation')setControlRefresh(value=>value+1)
          }
        }
      })
      animateAnswer(true)
    } catch (error) {
      assistant = ''; transient = false; render()
      if (!pending.controller.signal.aborted) {
        setNotice(explainError(error)); setDraft(text)
        try {
          const run = await api<{ status: string }>('/api/runs/' + requestId)
          if (run.status === 'completed') { completed = true; retry.current = null; setNotice('这轮已保存，正在同步结果。'); dataChanged() }
          else if (run.status === 'failed' || run.status === 'cancelled') retry.current = null
        } catch (statusError) {
          if (statusError instanceof ApiError && statusError.status === 404) retry.current = null
          // Unknown transport outcome keeps the same request ID, so retry cannot repeat a completed mutation.
        }
      }
    } finally {
      if (!completed) { assistant = ''; transient = false; render() }
      const remainingDraft = completed || (pending.started && pending.controller.signal.aborted) ? '' : text
      try {
        const next = await loadWorkspace(currentUser, { ...workspace, activeId: chatId, chats: workspace.chats.map(chat => chat.id === chatId ? { ...chat, draft: remainingDraft } : chat) })
        setWorkspace(next)
      } catch { setDraft(remainingDraft); setNotice('服务端同步暂时失败，请稍后重新打开对话。') }
      if (remote.current === pending) remote.current = null
      setBusy(false); setCompanionMotion('waiting')
    }
  }
  useEffect(() => {
    const media = matchMedia('(max-width: 900px)')
    const changed = () => { setMobile(media.matches); if (media.matches) setSidebarOpen(false) }
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])

  useEffect(() => {
    if (open) {
      if (!dialog.current?.open) { dialog.current?.showModal(); dialog.current?.focus() }
    } else {
      setSummaryOpen(false)
      dialog.current?.close()
    }
  }, [open])
  useEffect(() => () => { clearTimeout(replyTimer.current); motionTimers.current.forEach(clearTimeout) }, [])
  useEffect(() => {
    motionTimers.current.forEach(clearTimeout)
    motionTimers.current = []
    setCompanionMotion('idle')
    follow.current = true
    setSummaryOpen(false)
  }, [active.id])
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [conversation.messages.length, busy, open, showChoices, active.id])
  useEffect(() => {
    if (open && !summaryOpen && !busy && !showChoices && (document.activeElement === document.body || document.activeElement === dialog.current)) input.current?.focus()
  }, [open, summaryOpen, busy, showChoices])
  useEffect(() => {
    const element = scroll.current
    if (!element) return
    const resize = new ResizeObserver(() => { if (follow.current) element.scrollTop = element.scrollHeight })
    resize.observe(element)
    return () => resize.disconnect()
  }, [])

  function commit(next: Conversation) {
    clearTimeout(replyTimer.current)
    motionTimers.current.forEach(clearTimeout)
    motionTimers.current = []
    setCompanionMotion('received')
    motionTimers.current.push(setTimeout(() => setCompanionMotion('thinking'), 360))
    follow.current = true
    setPrevious(null)
    setNotice('')
    setDraft('')
    setConversation({ ...next, messages: next.messages.slice(0, -1) })
    setBusy(true)
    replyTimer.current = setTimeout(() => {
      setConversation(next)
      setBusy(false)
      setChoicesOpen(next.stage === 'confirm')
      animateAnswer(conversation.stage === 'future')
    }, 720)
  }
  function animateAnswer(complete: boolean) {
    setCompanionMotion('answering')
    motionTimers.current.push(setTimeout(() => setCompanionMotion(complete ? 'complete' : 'waiting'), 900))
    if (complete) motionTimers.current.push(setTimeout(() => setCompanionMotion('waiting'), 1620))
  }
  function send(text = draft) {
    if (busy || connecting || remote.current || voice.listening || !text.trim()) return
    if (!conversation.demo) {
      if (!user) { onRequestAuth(loggedIn); setNotice('请先登录，正式对话保存在你的账户中。'); return }
      void sendRemote(text.trim()); input.current?.focus(); return
    }
    commit(advanceConversation(conversation, text))
    input.current?.focus()
  }
  function submit(event: FormEvent) { event.preventDefault(); send() }
  function dismissChoices() {
    setChoicesOpen(false)
    requestAnimationFrame(() => input.current?.focus())
  }
  function answerChoice(option: AnswerOption | null) {
    if (busy) return
    if (option?.action === 'explore') { if (conversation.demo) commit(beginExploration()); else send('暂时没有具体问题，先从一段真实经历聊起。') }
    else if (option?.action === 'demo') showDemo()
    else if (option?.action === 'send') send(option.label)
    else send()
  }
  function fresh() {
    if (busy) return
    voice.cancel()
    clearTimeout(replyTimer.current)
    motionTimers.current.forEach(clearTimeout)
    motionTimers.current = []
    setCompanionMotion('idle')
    setPrevious(active.id)
    const chat = newChat(projectId ?? active.projectId)
    setWorkspace(value => ({ ...value, activeId: chat.id, chats: [chat, ...value.chats] }))
    setProjectId(null)
    if (mobile) setSidebarOpen(false)
    setBusy(false)
    setChoicesOpen(false)
    setNotice('已开始新对话')
    input.current?.focus()
  }
  function undo() {
    if (!previous) return
    voice.cancel()
    setWorkspace(value => ({ ...value, activeId: previous }))
    const restored = workspace.chats.find(chat => chat.id === previous)
    setPrevious(null)
    setNotice('')
    setChoicesOpen(restored?.conversation.stage === 'confirm')
    setCompanionMotion(restored?.conversation.messages.length ? 'waiting' : 'idle')
  }
  function showDemo() {
    voice.cancel()
    motionTimers.current.forEach(clearTimeout)
    motionTimers.current = []
    animateAnswer(true)
    follow.current = true
    const demo = { ...newChat(), title: '比赛与课程之间的选择', conversation: createDemoConversation() }
    setWorkspace(value => ({ ...value, activeId: demo.id, chats: [demo, ...value.chats] }))
    setPrevious(null)
    setDraft('')
    setNotice('')
  }
  function closeSidebar() { setSidebarOpen(false); requestAnimationFrame(() => sidebarTrigger.current?.focus()) }
  function selectChat(id: string) {
    if (busy) return
    voice.cancel()
    setSummaryOpen(false)
    setWorkspace(value => ({ ...value, activeId: id }))
    setProjectId(null); setChoicesOpen(workspace.chats.find(chat => chat.id === id)?.conversation.stage === 'confirm'); setNotice(''); setPrevious(null)
    setCompanionMotion('idle'); follow.current = true
    if (mobile) closeSidebar()
  }
  function createChat(id: string | null = null) {
    if (busy) return
    voice.cancel()
    const chat = newChat(id)
    setWorkspace(value => ({ ...value, activeId: chat.id, chats: [chat, ...value.chats] }))
    setProjectId(null); setChoicesOpen(false); setNotice(''); setPrevious(null); setCompanionMotion('idle')
    if (mobile) closeSidebar()
  }
  function patchChat(id: string, patch: Partial<Chat>) {
    setWorkspace(value => updateChat(value, id, patch))
    if (user && !workspace.chats.find(chat => chat.id === id)?.conversation.demo) {
      void api('/api/conversations', { id, title: workspace.chats.find(chat => chat.id === id)?.title ?? '新对话' })
        .then(() => api('/api/conversations/' + id, patch, 'PATCH')).catch(error => setNotice(explainError(error)))
    }
  }
  function openProject(id: string) { voice.cancel(); setSummaryOpen(false); setProjectId(id); setNotice(''); if (mobile) closeSidebar() }
  const voiceButton = <button type="button" className={'qa-voice qa-icon-button' + (voice.listening ? ' is-listening' : '')} onClick={voice.toggle} disabled={busy} aria-label={voice.listening ? '结束语音输入' : '语音输入'} aria-pressed={voice.listening} title="浏览器语音识别 · 仅填入草稿，可能使用在线识别服务"><Icon name={voice.listening ? 'stop' : 'mic'} size={18} /></button>

  return <dialog ref={dialog} tabIndex={-1} className="qa-page" aria-label="LifeOS 聊一聊" onCancel={event => { event.preventDefault(); if (mobile && sidebarOpen) closeSidebar(); else if (growthOpen) setGrowthOpen(false); else onClose() }}>
    <div className="qa-app-layout">
      <WorkspaceSidebar workspace={workspace} busy={busy || connecting} accountConnected={!!user} open={sidebarOpen} mobile={mobile} projectId={projectId} onClose={closeSidebar} onExit={onClose} onSelect={selectChat} onProject={openProject} onNew={createChat} onChat={patchChat}
        onSaveProject={(id, name, description) => {
          const nextId = id ?? crypto.randomUUID()
          setWorkspace(value => ({ ...value, projects: id ? value.projects.map(item => item.id === id ? { ...item, name, description } : item) : [...value.projects, { id: nextId, name, description }] }))
          if (!id) openProject(nextId)
        }} />
      {mobile && sidebarOpen && <button type="button" className="qa-sidebar-scrim" aria-label="关闭侧边栏" onClick={closeSidebar} tabIndex={-1} />}
    <div className="qa-shell" inert={mobile && sidebarOpen} aria-hidden={mobile && sidebarOpen}>
      <header className="qa-header">
        <div className="qa-header-context"><button ref={sidebarTrigger} type="button" className="qa-icon-button" aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'} aria-expanded={sidebarOpen} aria-controls="qa-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}><Icon name="panel" /></button>
          {project ? <span className="qa-context-title">{project.name}</span> : <><button type="button" className="qa-context-project" disabled={busy} onClick={() => currentProject ? openProject(currentProject.id) : onClose()}>{currentProject?.name ?? 'LifeOS'}</button><span className="qa-context-divider">/</span><span className="qa-context-title">{active.title}</span></>}
        </div>
        <div className="qa-header-actions">
          {user && !project && <button type="button" disabled={busy} aria-expanded={growthOpen} onClick={() => { voice.cancel(); setSummaryOpen(false); setGrowthOpen(value => !value) }}>我的成长</button>}
          {user && !project && <button type="button" disabled={busy} aria-expanded={memoryOpen} aria-controls="qa-memory-panel" onClick={() => setMemoryOpen(value => !value)}>记忆</button>}
          {user ? <button type="button" disabled={busy} onClick={() => void logout()} title={user.email}>退出登录</button> : <button type="button" disabled={connecting} onClick={() => onRequestAuth(loggedIn)}>登录</button>}
          {!empty && !project && <button type="button" onClick={fresh} disabled={busy}>新对话</button>}
          <button type="button" className="qa-space-return" onClick={onClose} aria-label="回到认知空间"><Icon name="orbit" /><span>认知空间</span></button>
        </div>
      </header>
      {growthOpen && user && !project && <GrowthWorkspace conversationId={active.id} conversationTitle={active.title} onClose={() => setGrowthOpen(false)} onExplore={text => { setGrowthOpen(false); setDraft(text); requestAnimationFrame(() => input.current?.focus()) }} onSendControl={text => { setGrowthOpen(false); send(text) }} />}
      {memoryOpen && user && !project && <MemoryPanel conversationId={!empty&&!conversation.demo?active.id:undefined} messageCount={conversation.messages.length} onClose={() => setMemoryOpen(false)} />}
      {storageNotice && <p className="qa-storage-notice" role="alert">{storageNotice}</p>}
      {project ? <main className="qa-project-page">
        <div className="qa-project-title"><Icon name="folder" size={28} /><h1>{project.name}</h1></div>
        <p>{project.description || '把相关的想法和经历放在一起，在同一个项目里继续聊。'}</p>
        <button type="button" className="qa-project-new" disabled={busy} onClick={() => createChat(project.id)}><Icon name="compose" />新建项目对话</button>
        <section aria-label="项目中的对话"><h2>对话<span>{workspace.chats.filter(chat => chat.projectId === project.id).length}</span></h2>
          {[...workspace.chats].filter(chat => chat.projectId === project.id).sort((a, b) => b.updatedAt - a.updatedAt).map(chat => <button type="button" className="qa-project-chat" key={chat.id} onClick={() => selectChat(chat.id)}><span><strong>{chat.title}</strong><span>{chat.draft || chat.conversation.messages.at(-1)?.text || '从第一句话开始'}</span></span><Icon name="chevron" size={16} /></button>)}
          {!workspace.chats.some(chat => chat.projectId === project.id) && <div className="qa-project-empty"><Icon name="compose" size={24} /><p>还没有对话</p><span>从一件想理清的事开始。</span></div>}
        </section>
      </main> : <>
      <div hidden={summaryOpen || (growthOpen && !!user)} className={`qa-workspace ${empty ? 'is-empty' : ''} ${showChoices ? 'has-choices' : ''}`}>
        <div className="qa-scroll" ref={scroll} onScroll={() => {
          const element = scroll.current
          if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100
        }}>
          {empty ? <section className="qa-welcome" aria-labelledby="qa-heading">
            <Companion large motion={draft.trim() ? 'waiting' : 'idle'} animated={open && !summaryOpen} />
            <p className="qa-greeting">我在，慢慢说。</p>
            <h1 id="qa-heading">现在，有想聊的具体问题吗？</h1>
            <p className="qa-welcome-note">从眼前的困惑，到过去的经历，一起找找答案。</p>
          </section> : <div className="qa-thread" role="log" aria-label="对话内容" aria-live="polite" aria-relevant="additions text">
            {conversation.demo && <p className="qa-demo-label">示例对话 · 比赛与课程之间的选择</p>}
            {conversation.messages.map(message => <article key={message.id} className={`qa-message is-${message.role}`} aria-label={message.role === 'user' ? '你的消息' : 'LifeOS 的回应'}>
              {message.role === 'assistant' && <div className="qa-assistant-name"><Companion motion={message.id === conversation.messages.at(-1)?.id && !busy ? companionMotion : 'idle'} animated={open && !summaryOpen && !busy && message.id === conversation.messages.at(-1)?.id} /><span>LifeOS</span></div>}
              <div className="qa-message-body">{message.transient && <small role="status">生成草稿 · 未校验、未保存</small>}{message.role === 'assistant' ? <ReplyMarkdown text={message.text} /> : message.text.split('\n\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
            </article>)}
            {busy && <div className="qa-thinking" role="status"><Companion motion={companionMotion} animated={open && !summaryOpen} /><span>{companionMotion === 'received' ? '收到你的想法' : '整理中'}</span>{remote.current && <button type="button" onClick={() => void cancelRemote()}>取消</button>}</div>}
          </div>}
          {!conversation.demo && user && !summaryOpen && !growthOpen && !busy && <ControlCards conversationId={active.id} refreshKey={controlRefresh} onResolved={() => setControlRefresh(value => value + 1)} />}
        </div>

        <div className="qa-bottom">
          {notice && <p className="qa-notice" role="status">{notice}{previous && <button type="button" onClick={undo}>撤销</button>}</p>}
          {showChoices && question ? <AnswerChoices key={active.id + '-' + conversation.stage + '-' + conversation.messages.length} question={question} draft={draft} inputRef={input} onDraft={setDraft} onAnswer={answerChoice} onDismiss={dismissChoices} voiceButton={voiceButton} voiceListening={voice.listening} /> : <form className="qa-composer" onSubmit={submit} aria-label="输入消息">
            <AutoTextarea inputRef={input} autoFocus={false} aria-label="想聊的事" placeholder={empty ? '有什么事，想一起想清楚？' : '说说你的想法…'} value={draft} readOnly={busy}
              onChange={event => setDraft(event.target.value)} onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); send() }
              }} />
            <div className="qa-composer-bottom">{question && !busy ? <button type="button" className="qa-show-choices" onClick={() => setChoicesOpen(true)}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M6 4h7M6 8h7M6 12h7" stroke="currentColor" strokeWidth="1.2" /><circle cx="2.5" cy="4" r="1" fill="currentColor" /><circle cx="2.5" cy="8" r="1" fill="currentColor" /><circle cx="2.5" cy="12" r="1" fill="currentColor" /></svg>{conversation.stage === 'opening' ? '开始方式' : '确认理解'}</button> : <div className="qa-composer-project"><Icon name="folder" size={15} /><CodexSelect label="当前对话所属项目" value={active.projectId ?? ''} disabled={busy || voice.listening} onChange={value => patchChat(active.id, { projectId: value || null })} options={[{ value: '', label: '未归类' }, ...workspace.projects.map(item => ({ value: item.id, label: item.name }))]} /></div>}<div className="qa-composer-actions">{voiceButton}<button type="submit" className="qa-send" disabled={!draft.trim() || busy || voice.listening} aria-label="发送消息"><Icon name="send" size={20} /></button></div></div>
          </form>}
          {voice.status && <p className="qa-voice-status" role="status">{voice.listening && <span className="qa-voice-dot" />}{voice.status}</p>}
          <p className="qa-preview-note">{conversation.demo ? '示例互动 · 不作为个人业务记录' : user ? access?.required ? access.enabled ? `对话保存在你的账户 · 剩余 ${access.remaining} 次${access.expiresAt ? ' · 有效至 '+new Date(access.expiresAt).toLocaleDateString() : ''}` : '对话资格尚未开通或已到期 · 已保存内容仍可查看' : '对话保存在你的账户' : connecting ? '正在连接服务端…' : '登录后开始真实对话 · 原浏览器演示已保留'}</p>
        </div>
      </div>
      </>}
    </div>
    </div>
  </dialog>
}
