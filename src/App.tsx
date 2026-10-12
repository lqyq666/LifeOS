import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { motion } from 'framer-motion'
import { CognitionController, type Snapshot } from './features/cognition/state.ts'
import { parseReviews, REVIEW_KEY, graph, graphSource, replaceGraph, subscribeGraph, getGraphRevision, type GraphData } from './features/cognition/graph.ts'
import { api, ApiError, dataChanged } from './backend/client'
import { AuthForm, type AuthMode } from './backend/AuthForm'
import { OrbitRail } from './features/cognition/OrbitRail'
import { RecordPanel } from './features/cognition/RecordPanel'
import { ThemePanel } from './features/cognition/ThemePanel'
import { TimeAxis } from './features/cognition/TimeAxis'
import { LandingGuide } from './features/cognition/LandingGuide'
import { StarmapDemo } from './features/cognition/StarmapDemo'
import './features/cognition/onboarding.css'
import { graph as liveGraph } from './features/cognition/graph'
import { ConversationPage } from './features/conversation/ConversationPage'
import './features/cognition/cognition.css'

const LifeFlywheel = lazy(() => import('./components/three/LifeFlywheel'))

function Arrow({ className = '' }: { className?: string }) {
  return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export default function App({ onEnter }: { onEnter?: () => void }) {
  const [reduce, setReduce] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [paused, setPaused] = useState(false)
  const [conversationOpen, setConversationOpen] = useState(() => window.location.hash === '#conversation')
  const [conversationVisited, setConversationVisited] = useState(() => window.location.hash === '#conversation')
  const [themePanelOpen, setThemePanelOpen] = useState(false)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('lifeos-onboarded'))
  const [showStarmapDemo, setShowStarmapDemo] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode | null>(() => window.location.hash.split('?')[0] === '#reset' ? 'reset' : window.location.hash === '#signup' ? 'signup' : window.location.hash === '#login' ? 'welcome' : null)
  const [authNavigation,setAuthNavigation]=useState(0)
  const sessionRefresh = useRef<(() => Promise<void>) | null>(null)
  const authReturn = useRef<{ snapshot: Snapshot; navigation: Snapshot[]; conversation: boolean; url: string; trigger: HTMLElement | null; onDone?: () => Promise<void> } | null>(null)
  const [controller] = useState(() => new CognitionController())
  useSyncExternalStore(subscribeGraph, getGraphRevision)
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const landing = view.mode === 'LANDING'
  const pendingFocus = useRef<string | null>(null)
  const back = () => { pendingFocus.current = controller.back() ?? null }
  const changeAuthMode = (mode: AuthMode) => {
    setAuthMode(mode)
    window.history.replaceState(null, '', mode === 'signup' ? '#signup' : '#login')
  }
  const openAuth = (mode: AuthMode = 'welcome', onDone?: () => Promise<void>) => {
    authReturn.current = {
      snapshot: { view: { ...controller.view, transitioning: false }, overviewPhase: controller.overviewPhase, valuePhases: { ...controller.valuePhases }, runtime: controller.capture?.(), trigger: null },
      navigation: [...controller.navigationStack], conversation: conversationOpen,
      url: window.location.pathname + window.location.search + window.location.hash,
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null, onDone,
    }
    controller.stop(); controller.restoreRuntime = undefined
    controller.update({ mode: 'LANDING', focusValueId: null, activeRecordId: null, interpretationValueId: null, previewNodeId: null, transitioning: false, serial: controller.view.serial + 1 })
    setConversationOpen(false); changeAuthMode(mode)
  }
  const cancelAuth = () => {
    const origin = authReturn.current
    setAuthMode(null); authReturn.current = null
    window.history.replaceState(null, '', origin?.url ?? window.location.pathname + window.location.search)
    if (origin) {
      controller.overviewPhase = origin.snapshot.overviewPhase; controller.valuePhases = { ...origin.snapshot.valuePhases }
      controller.navigationStack = origin.navigation; controller.restoreRuntime = origin.snapshot.runtime
      controller.update({ ...origin.snapshot.view, reviews: controller.view.reviews, storageError: controller.view.storageError, serial: controller.view.serial + 1 })
      controller.reconcilePreview(); setConversationOpen(origin.conversation)
    }
    requestAnimationFrame(() => origin?.trigger?.focus())
  }
  const completeAuth = async () => {
    await (authReturn.current?.onDone ?? sessionRefresh.current)?.()
    dataChanged(); setAuthMode(null); authReturn.current = null
    // 登录后先展示星图演示，再进入聊天
    setShowStarmapDemo(true)
  }
  const openConversation = () => {
    controller.stop()
    window.history.pushState(null, '', '#conversation')
    setConversationVisited(true)
    setConversationOpen(true)
  }
  const closeConversation = () => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setConversationOpen(false)
    requestAnimationFrame(() => {
      const trigger = document.querySelector<HTMLElement>('[data-focus-key="conversation"]')
      if (trigger) trigger.focus()
      else entryButton.current?.focus()
    })
  }
  useEffect(() => {
    let generation = 0
    const changed = async () => {
      const current = ++generation
      try {
        const data = await api<GraphData>('/api/cognition')
        if (current !== generation) return
        setGraphError(null)
        replaceGraph(data)
        controller.update({ reviews: {}, serial: controller.view.serial + 1 })
        if (controller.view.activeRecordId && !graph.getNode(controller.view.activeRecordId)) {
          controller.navigationStack = []; controller.stop(); controller.update({ mode: 'OVERVIEW', activeRecordId: null, interpretationValueId: null, transitioning: false })
        }
        controller.reconcilePreview()
      } catch (error) {
        if (current !== generation) return
        if (!(error instanceof ApiError && error.status === 401)) {
          // 拉取失败保持上一次的真实图（首次加载则显示重试），绝不回退成
          // 假装是用户档案的演示数据。
          setGraphError('星图数据暂时没能加载。' + (error instanceof Error ? '' : ''))
          return
        }
        setGraphError(null)
        if (error instanceof ApiError && error.status === 401) {
          replaceGraph(null)
          let reviews: ReturnType<typeof parseReviews> = {}, storageError: string | null = null
          try { reviews = parseReviews(localStorage.getItem(REVIEW_KEY)) }
          catch { storageError = '本地校准记录无法读取，原保存数据没有被覆盖。' }
          controller.navigationStack = []; controller.stop()
          controller.update({ mode: controller.view.mode === 'LANDING' ? 'LANDING' : 'OVERVIEW', focusValueId: null, activeRecordId: null, interpretationValueId: null, reviews, storageError, serial: controller.view.serial + 1, transitioning: false })
          controller.reconcilePreview()
        }
      }
    }
    void changed()
    window.addEventListener('lifeos-data-changed', changed)
    return () => { generation++; window.removeEventListener('lifeos-data-changed', changed) }
  }, [controller])
  useEffect(() => {
    const changed = () => {
      controller.stop()
      if(window.location.hash.split('?')[0]==='#reset'){setAuthMode('reset');setAuthNavigation(value=>value+1)}
      const open = window.location.hash === '#conversation'
      if (open) setConversationVisited(true)
      setConversationOpen(open)
    }
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [controller])
  // A record on the star map can point back at the conversation it came from;
  // the pending id itself is consumed by ConversationPage after its workspace
  // loads, so drafts and remote state are merged before the switch.
  useEffect(() => {
    const open = () => {
      controller.stop()
      window.history.pushState(null, '', '#conversation')
      setConversationVisited(true)
      setConversationOpen(true)
    }
    window.addEventListener('lifeos-open-conversation', open)
    return () => window.removeEventListener('lifeos-open-conversation', open)
  }, [controller])
  useEffect(() => {
    try { controller.update({ reviews: parseReviews(localStorage.getItem(REVIEW_KEY)) }) }
    catch { controller.update({ storageError: '本地校准记录无法读取，当前显示原始候选解释。未覆盖原有保存数据。' }) }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !(event.target instanceof Element && event.target.closest('dialog'))) {
        event.preventDefault(); pendingFocus.current = controller.back() ?? null
      }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [controller])
  useEffect(() => {
    if (view.transitioning || !pendingFocus.current) return
    const key = pendingFocus.current
    pendingFocus.current = null
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)
      if (target && !target.hidden && !(target instanceof HTMLButtonElement && target.disabled)) target.focus()
      else document.querySelector<HTMLElement>('[data-focus-key="rail"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [view.transitioning, view.serial])
  const entryButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => setReduce(query.matches)
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [])

  if (graphError&&!authMode) {
    return <div className="campus-page is-cognition"><div className="scene-error" role="alert"><h2>星图暂时没能加载</h2><p>{graphError}这里不会用演示数据冒充你的档案。</p><button type="button" onClick={() => { setGraphError(null); window.dispatchEvent(new CustomEvent('lifeos-data-changed')) }}>重试加载</button></div></div>
  }
  return <div className={`campus-page ${landing ? 'is-landing' : 'is-cognition'}`} data-mode={view.mode}>
    {showOnboarding && landing && <LandingGuide onDone={() => { setShowOnboarding(false); localStorage.setItem('lifeos-onboarded', '1') }} />}
    {showStarmapDemo && <StarmapDemo onDone={() => { setShowStarmapDemo(false); openConversation() }} />}
    <header className="site-header" inert={conversationOpen || !!authMode} aria-hidden={conversationOpen || !!authMode}>
      <a className="brand" href="#" onClick={event => { event.preventDefault(); if (!landing) back() }} aria-label="LifeOS Campus 首页">
        <svg className="brand-symbol" viewBox="0 0 42 42" fill="none" aria-hidden="true">
          <ellipse cx="21" cy="21" rx="19" ry="7.8" transform="rotate(-28 21 21)" />
          <ellipse cx="21" cy="21" rx="8" ry="19" transform="rotate(-28 21 21)" />
          <circle cx="21" cy="21" r="3.2" />
        </svg>
        <span className="brand-wordmark">LifeOS</span>
        <span className="brand-campus">Campus</span>
      </a>
      {landing && <nav className="home-auth-actions" aria-label="账户">
        {graphSource === 'database' ? <button type="button" onClick={openConversation}>继续对话</button> : <><button type="button" onClick={() => openAuth()}>登录</button><button className="home-signup" type="button" onClick={() => openAuth('signup')}>创建账户</button></>}
      </nav>}
      {!landing && view.mode !== 'EXPERIENCE_DETAIL' && <button className="qa-entry" type="button" data-focus-key="conversation" onClick={openConversation} disabled={view.transitioning}>聊聊</button>}
      {view.mode === 'VALUE_FOCUS' && view.focusValueId?.startsWith('theme-') && <button className="qa-entry" type="button" onClick={() => setThemePanelOpen(true)} disabled={view.transitioning}>主题详情</button>}
    </header>

    {!landing && <nav className="cognition-nav" aria-label="当前位置" inert={conversationOpen || !!authMode} aria-hidden={conversationOpen || !!authMode}>
      <button className="back-button" onClick={back} aria-label="返回上一级">← <span>返回</span></button>
      <div className="breadcrumbs">
        {view.focusValueId ? <><button disabled={view.mode === 'EXPERIENCE_DETAIL' || view.transitioning} onClick={back}>当前自我</button><span>/</span><span>{graph.getNode(view.focusValueId)?.title}</span></> : <span>当前自我</span>}
        {view.activeRecordId && <><span>/</span><span>{graph.getNode(view.activeRecordId)?.title}</span></>}
      </div>
      <span className="candidate-notice">{graphSource === 'database' ? '个人经历 · 解释可修正' : '示例关联 · 待确认'}</span>
    </nav>}
    {!landing && view.storageError && view.mode !== 'EXPERIENCE_DETAIL' && <p className="storage-banner" role="alert">{view.storageError}</p>}
    <main className="entry-main" inert={conversationOpen || !!authMode} aria-hidden={conversationOpen || !!authMode}>
      <section className="flywheel-section" aria-label="LifeOS Growth Flywheel">
        <Suspense fallback={<div className="scene-loading" role="status"><span />正在唤醒成长核心</div>}>
          <LifeFlywheel paused={paused || conversationOpen || !!authMode} reducedMotion={reduce || !!authMode} controller={controller} />
        </Suspense>
        <button hidden={!landing} className="motion-toggle" onClick={() => setPaused(!paused)}
          disabled={reduce} aria-label={reduce ? '已跟随系统减少动态效果' : paused ? '播放飞轮动画' : '暂停飞轮动画'}
          title={reduce ? '跟随系统减少动态效果' : paused ? '播放动画' : '暂停动画'} aria-pressed={paused || reduce}>
          {paused || reduce ? <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m5 3 7 5-7 5Z" fill="currentColor" /></svg>
            : <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 4v8m6-8v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>}
        </button>
      </section>

      <motion.div className="entry-copy" initial={false} inert={!landing} aria-hidden={!landing}
        animate={{ y: 0, opacity: 1 }} transition={{ duration: reduce ? 0 : 1 }}>
        <h1>让每一次选择，<br /><span>更接近你想成为的人。</span></h1>
        <p className="growth-story">在经历中反思，在选择后行动，<br className="mobile-break" />于循环中成长。</p>
        <motion.button ref={entryButton} data-focus-key="entry" className="enter-button"
          whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.985 }}
          onClick={() => { controller.enter(); onEnter?.() }}>
          <span>进入 LifeOS</span><Arrow />
        </motion.button>
      </motion.div>
    </main>

    {!landing && <OrbitRail controller={controller} />}
    {view.mode === 'EXPERIENCE_DETAIL' && <RecordPanel controller={controller} onBack={back} />}
    {themePanelOpen && view.focusValueId?.startsWith('theme-') && <ThemePanel themeNodeId={view.focusValueId} onClose={() => setThemePanelOpen(false)} />}
    {!landing && view.mode !== 'EXPERIENCE_DETAIL' && <div className="timeaxis-wrap"><TimeAxis events={liveGraph.data.changeEvents ?? []} nextStep={liveGraph.data.starmapNextStep} onJumpChat={openConversation} /></div>}
    {conversationVisited && <ConversationPage open={conversationOpen} onClose={closeConversation} onRequestAuth={onDone => openAuth('login', onDone)} sessionRefresh={sessionRefresh} />}
    {authMode && <AuthForm key={authNavigation} mode={authMode} onModeChange={changeAuthMode} onDone={completeAuth} onCancel={cancelAuth} />}
  </div>
}
