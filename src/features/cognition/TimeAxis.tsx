// “过去—现在—下一步”时间轴：读取已提交的身份变更事件（无变化则空轴），
// 暂缓/放弃渲染为中性变化而非失败。可键盘操作，尊重 reduced-motion。
export type ChangeEventView = { subjectType: string; transition: string; reason: string; committedAt: string; userConfirmation: string }

const TRANSITION_LABELS: Record<string, string> = {
  created: '新增', updated: '更新', merged: '补充', corrected: '更正', retired: '结束', paused: '暂缓', resumed: '恢复', confirmed: '已确认', revoked: '已撤销', backfilled: '回填',
}

export function TimeAxis({ events, onJumpChat }: { events: ChangeEventView[]; onJumpChat?: () => void }) {
  if (!events.length) return <p className="timeaxis-empty">还没有记录到的变化。聊到目标和做过的事之后，这里会显示你的星图如何随对话生长。</p>
  return <nav className="timeaxis" aria-label="过去—现在—下一步">
    <div className="timeaxis-track" aria-hidden="true" />
    <ol className="timeaxis-items">
      {events.map((event, index) => <li key={index} className={`timeaxis-item is-${event.transition}`}>
        <span className="timeaxis-dot" aria-hidden="true" />
        <span className="timeaxis-time">{new Date(event.committedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
        <span className="timeaxis-change">{TRANSITION_LABELS[event.transition] ?? event.transition}{event.subjectType === 'theme' ? '主题' : event.subjectType === 'experience' ? '经历' : event.subjectType === 'identity_claim' ? '自我认同' : '连线'}</span>
        <span className="timeaxis-reason">{event.reason}</span>
      </li>)}
    </ol>
    <p className="timeaxis-next">下一步：星图会随着你的对话继续生长；暂缓或放弃也是合理的变化。</p>
    {onJumpChat && <button type="button" className="timeaxis-chat" onClick={onJumpChat}>回到对话</button>}
  </nav>
}
