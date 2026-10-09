import { useEffect, useRef, useState } from 'react'
import './onboarding.css'

type Step = {
  title: string
  body: string
  icon: string
}

const STEPS: Step[] = [
  { title: '聊聊就好', body: '正常说话。你聊到做过的事、想要的方向，LifeOS 都在听——不需要填表单。', icon: 'chat' },
  { title: '星图自动生长', body: '聊过的目标和经历，会自动变成你专属的星图：中心是你，内轨是当前追求，外轨是真实做过的事。', icon: 'orbit' },
  { title: '越聊越懂你', body: '你说得越多，星图越丰富。AI 会引用你真实做过的事来给建议，不会编造。', icon: 'sparkle' },
  { title: '随时可纠正', body: '看到的每条记录都能改、能删。你说"这不是我"，AI 就不再这样认为。', icon: 'shield' },
]

// 新用户引导：步进式卡片 + 进度点，4 步了解产品核心循环。
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    dialogRef.current?.showModal()
    nextRef.current?.focus()
    return () => { const el = dialogRef.current; el?.close() }
  }, [])
  useEffect(() => { nextRef.current?.focus() }, [step])
  const isLast = step === STEPS.length - 1
  const advance = () => { if (isLast) onDone(); else setStep(s => s + 1) }
  const current = STEPS[step]
  return <dialog ref={dialogRef} className="onboarding" aria-labelledby="onboarding-title" onCancel={event => { event.preventDefault(); onDone() }}>
    <div className="onboarding-card" key={step}>
      <div className="onboarding-icon" aria-hidden="true">
        {current.icon === 'chat' && <svg viewBox="0 0 24 24" fill="none"><path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" stroke="currentColor" strokeWidth="1.4" /><circle cx="9" cy="12" r="1" fill="currentColor" /><circle cx="13" cy="12" r="1" fill="currentColor" /><circle cx="17" cy="12" r="1" fill="currentColor" /></svg>}
        {current.icon === 'orbit' && <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" fill="currentColor" /><ellipse cx="12" cy="12" rx="10" ry="4.5" stroke="currentColor" strokeWidth="1.2" transform="rotate(-20 12 12)" /><circle cx="20" cy="9" r="1.5" fill="currentColor" /><circle cx="5" cy="14" r="1.5" fill="currentColor" /></svg>}
        {current.icon === 'sparkle' && <svg viewBox="0 0 24 24" fill="none"><path d="M12 2v6m0 8v6M2 12h6m8 0h6M5 5l3 3m8 8 3 3M19 5l-3 3m-8 8-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>}
        {current.icon === 'shield' && <svg viewBox="0 0 24 24" fill="none"><path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4Z" stroke="currentColor" strokeWidth="1.4" /><path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>}
      </div>
      <h2 id="onboarding-title">{current.title}</h2>
      <p>{current.body}</p>
      <div className="onboarding-dots" aria-hidden="true">{STEPS.map((_, i) => <span key={i} className={i === step ? 'is-active' : i < step ? 'is-done' : ''} />)}</div>
      <div className="onboarding-actions">
        <button type="button" className="onboarding-skip" onClick={onDone}>跳过</button>
        <button ref={nextRef} type="button" className="onboarding-next" onClick={advance}>{isLast ? '开始使用' : '下一步'}</button>
      </div>
    </div>
  </dialog>
}
