import { useEffect, useState } from 'react'

// 登录后首次进入星图的引导演示：三步文字标注依次出现，
// 指向中心/内轨/外轨，帮助用户理解星图含义。
const DEMO_STEPS = [
  { target: 'center', title: '这是现在的你', body: '你聊到过的自我描述和有能力证据的事，都在中心。', position: { top: '50%', left: '50%', transform: 'translate(-50%, -140%)' } },
  { target: 'ring', title: '当前追求', body: '内轨的每个节点是你正在追求或探索的方向，来自你亲口说的目标。', position: { top: '28%', left: '12%' } },
  { target: 'outer', title: '真实做过的事', body: '外轨是你报告过的经历。绿色=有能力证据，橙色=还没完成。', position: { bottom: '28%', right: '12%' } },
]

export function StarmapDemo({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const timers = DEMO_STEPS.map((_, i) => setTimeout(() => setStep(i), i * 2600))
    const end = setTimeout(() => { setVisible(false); onDone() }, DEMO_STEPS.length * 2600 + 600)
    return () => { timers.forEach(clearTimeout); clearTimeout(end) }
  }, [onDone])
  if (!visible) return null
  const current = DEMO_STEPS[step]
  return <div className="starmap-demo" aria-hidden="true">
    <div className="starmap-demo-label" key={step} style={current.position as React.CSSProperties}>
      <strong>{current.title}</strong>
      {current.body}
    </div>
  </div>
}
