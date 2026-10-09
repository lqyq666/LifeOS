import { useEffect, useState } from 'react'
import './onboarding.css'

// 新用户引导：直接在 landing 页面上叠加渐变动效——
// 文字渐次浮现、按钮光晕扩散、星图背景呼吸，不弹独立窗口。
export function LandingGuide({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    // 三阶段依次推进：0=标题渐入 1=说明渐入 2=按钮光晕（然后消失）
    const timers = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 1600),
      setTimeout(() => { onDone() }, 2800),
    ]
    return () => timers.forEach(clearTimeout)
  }, [onDone])
  if (phase >= 3) return null
  return <div className="landing-guide" aria-hidden="true">
    <div className={`landing-guide-beam is-phase-${phase}`} />
    {phase < 2 && <div className={`landing-guide-text is-phase-${phase}`}>
      {phase === 0 && <span>正常聊天就好，LifeOS 在听</span>}
      {phase === 1 && <span>你的目标和经历，会长成专属星图</span>}
    </div>}
  </div>
}
