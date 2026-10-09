import { useEffect, useState } from 'react'

// 登录后首次进入星图的引导：三个渐变标注叠加在星图上，依次出现，
// 指向中心/内轨/外轨，配合径向光束动画，完成后自动进入聊天。
const DEMO_STEPS = [
  { title: '这是现在的你', body: '你聊到过的自我描述和有能力证据的事都在中心', pos: { top: '38%', left: '50%', transform: 'translate(-50%, -100%)' } },
  { title: '当前追求', body: '内轨是你亲口说的目标', pos: { top: '22%', left: '8%' } },
  { title: '真实做过的事', body: '外轨是报告过的经历，绿色=有能力证据', pos: { bottom: '22%', right: '8%' } },
]

export function StarmapDemo({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const timers = DEMO_STEPS.map((_, i) => setTimeout(() => setStep(i), i * 2200))
    const end = setTimeout(() => onDone(), DEMO_STEPS.length * 2200 + 800)
    return () => { timers.forEach(clearTimeout); clearTimeout(end) }
  }, [onDone])
  if (step >= DEMO_STEPS.length) return null
  const current = DEMO_STEPS[step]
  return <div className="starmap-demo" style={{ position: 'fixed', inset: 0, zIndex: 5, pointerEvents: 'none' }}>
    <div className="starmap-demo-label" key={step} style={current.pos as React.CSSProperties}>
      <strong>{current.title}</strong>
      {current.body}
    </div>
  </div>
}
