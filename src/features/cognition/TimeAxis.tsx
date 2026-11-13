// “过去—现在—下一步”时间轴：读取已提交的身份变更事件（无变化则空轴），
// 暂缓/放弃渲染为中性变化而非失败。可键盘操作，尊重 reduced-motion。
export type ChangeEventView = { subjectType: string; transition: string; reason: string; committedAt: string; userConfirmation: string; before?:string; now?:string; unknowns?:string }

const TRANSITION_LABELS: Record<string, string> = {
  created: '新增', updated: '更新', merged: '补充', corrected: '更正', retired: '结束', paused: '暂缓', resumed: '恢复', confirmed: '已确认', revoked: '已撤销', backfilled: '回填',
}

export function TimeAxis({ events, nextStep, onJumpChat }: { events: ChangeEventView[]; nextStep?: string; onJumpChat?: () => void }) {
  return <nav className="timeaxis" aria-label="过去—现在—下一步">
    <details className="timeaxis-history">
    <summary>成长记录 <span>{events.length} 条变化</span></summary>
    <ol className="timeaxis-items" tabIndex={0} aria-label="成长变化详情">
      {events.length ? events.map((event, index) => <li key={index} className={`timeaxis-item is-${event.transition}`}>
        <span className="timeaxis-dot" aria-hidden="true" />
        <span className="timeaxis-time">{new Date(event.committedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
        <span className="timeaxis-change">{TRANSITION_LABELS[event.transition] ?? event.transition}{SUBJECT_LABELS[event.subjectType] ?? event.subjectType}</span>
        <span className="timeaxis-reason">变化依据：{event.reason}</span>
        {event.before && <span className="timeaxis-before">原来：{event.before}</span>}
        {event.now && <span className="timeaxis-now">现在：{event.now}</span>}
        {event.unknowns && <span className="timeaxis-unknowns">仍未知：{event.unknowns}</span>}
      </li>) : <li className="timeaxis-item"><span className="timeaxis-change">还没有记录到的变化</span></li>}
    </ol>
    </details>
    {/* 下一步只来自当前有效事实；没有就如实说尚未确定，不用固定话术冒充建议。 */}
    <div className="timeaxis-footer"><p className="timeaxis-next">{nextStep ? `下一步：${nextStep}` : '下一步：尚未确定——还没有本人设定的进行中追求。'}</p>
    {onJumpChat && <button type="button" className="timeaxis-chat" onClick={onJumpChat}>回到对话</button>}
    </div>
  </nav>
}
const SUBJECT_LABELS: Record<string, string> = { theme: '主题', experience: '经历', identity_claim: '自我认同', link: '连线' }
