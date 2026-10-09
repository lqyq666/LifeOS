import { useState } from 'react'

export type TurnInsight = {
  created: { kind: '经历' | '主题'; label: string }[]
  merged: { kind: '经历'; label: string }[]
  themesChanged: string[]
  none: boolean
}

// “这次我了解到你什么”：只基于已提交的 stateChange 回执——真实落盘之前
// 绝不宣称星图已更新。可展开看新增/补充/更正/没有变化，并一键回到星图。
export function TurnInsightPanel({ insight, onViewMap }: { insight: TurnInsight; onViewMap: () => void }) {
  const [open, setOpen] = useState(false)
  if (insight.none) return null
  const total = insight.created.length + insight.merged.length + insight.themesChanged.length
  return <div className="qa-insight">
    <button type="button" className="qa-insight-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      ✦ 这次我了解到你{total > 0 ? ` ${total} 项变化` : '的新认识'}<span aria-hidden="true">{open ? '收起' : '展开'}</span>
    </button>
    {open && <div className="qa-insight-body">
      {insight.created.map((item, index) => <p key={'c' + index}>新增{item.kind}：{item.label}</p>)}
      {insight.merged.map((item, index) => <p key={'m' + index}>补充既有经历：{item.label}（新的反馈并入了原来那段经历）</p>)}
      {insight.themesChanged.length > 0 && <p>成长主题有更新（新增、更正或状态变化）。</p>}
      {total === 0 && <p>本轮没有实质变化，星图保持原样。</p>}
      <div className="qa-insight-actions">
        <button type="button" onClick={onViewMap}>查看星图</button>
        <span className="qa-insight-note">有不对的地方？打开星图对应记录可直接删除或纠正。</span>
      </div>
    </div>}
  </div>
}
