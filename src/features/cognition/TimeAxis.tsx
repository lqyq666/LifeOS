// “过去—现在—下一步”时间轴：读取已提交的身份变更事件（无变化则空轴），
// 暂缓/放弃渲染为中性变化而非失败。可键盘操作，尊重 reduced-motion。
export type ChangeEventView = { subjectType: string; transition: string; reason: string; committedAt: string; userConfirmation: string }

const TRANSITION_LABELS: Record<string, string> = {
  created: '新增', updated: '更新', merged: '补充', corrected: '更正', retired: '结束', paused: '暂缓', resumed: '恢复', confirmed: '已确认', revoked: '已撤销', backfilled: '回填',
}

export function TimeAxis({ events, nextStep, onJumpChat }: { events: ChangeEventView[]; nextStep?: string; onJumpChat?: () => void }) {
  return <nav className="timeaxis" aria-label="过去—现在—下一步">
    <div className="timeaxis-track" aria-hidden="true" />
    <ol className="timeaxis-items">
      {events.length ? events.map((event, index) => <li key={index} className={`timeaxis-item is-${event.transition}`}>
        <span className="timeaxis-dot" aria-hidden="true" />
        <span className="timeaxis-time">{new Date(event.committedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
        <span className="timeaxis-change">{TRANSITION_LABELS[event.transition] ?? event.transition}{SUBJECT_LABELS[event.subjectType] ?? event.subjectType}</span>
        <span className="timeaxis-reason">新增事实：{event.reason}</span>
        {(event as any).before && <span className="timeaxis-before">原来：{(event as any).before}</span>}
        {((event as any).unknowns ?? '') !== '' && <span className="timeaxis-unknowns">仍未知：{(event as any).unknowns}</span>}
      </li>) : <li className="timeaxis-item"><span className="timeaxis-change">还没有记录到的变化</span></li>}
    </ol>
    {/* 下一步只来自当前有效事实；没有就如实说尚未确定，不用固定话术冒充建议。 */}
    <p className="timeaxis-next">{nextStep ? `下一步：${nextStep}` : '下一步：尚未确定——还没有本人设定的进行中追求。'}</p>
    {onJumpChat && <button type="button" className="timeaxis-chat" onClick={onJumpChat}>回到对话</button>}
  </nav>
}
const SUBJECT_LABELS: Record<string, string> = { theme: '主题', experience: '经历', identity_claim: '自我认同', link: '连线' }
