export type Stage = 'opening' | 'experience' | 'outcome' | 'another' | 'pattern' | 'confirm' | 'correction' | 'avoid' | 'future' | 'followup'
export type Message = { id: number; role: 'user' | 'assistant'; text: string; sourceId?: string; transient?: boolean }
export type Notes = { problem: string; experience: string; outcome: string; another: string; pattern: string; avoid: string; future: string }
export type Conversation = { branch: 'problem' | 'explore' | null; stage: Stage; messages: Message[]; notes: Notes; confirmed: boolean; demo: boolean }

export const emptyConversation = (): Conversation => ({
  branch: null, stage: 'opening', messages: [], confirmed: false, demo: false,
  notes: { problem: '', experience: '', outcome: '', another: '', pattern: '', avoid: '', future: '' },
})

function append(conversation: Conversation, text: string, reply: string, stage: Stage, notes: Partial<Notes> = {}, confirmed = conversation.confirmed): Conversation {
  const id = conversation.messages.length
  return { ...conversation, stage, notes: { ...conversation.notes, ...notes }, confirmed,
    messages: [...conversation.messages, { id, role: 'user', text }, { id: id + 1, role: 'assistant', text: reply }] }
}

export function beginExploration(): Conversation {
  return append({ ...emptyConversation(), branch: 'explore' }, '暂时没有具体问题，先了解一下我吧。',
    '那就从一段经历开始。\n\n最近有什么事，让你印象比较深？顺利的、开心的，或一直放不下的都可以。', 'experience')
}

export function advanceConversation(current: Conversation, input: string): Conversation {
  const text = input.trim().slice(0, 4000)
  if (!text) return current
  if (current.stage === 'opening') {
    if (/^(?:暂时|目前|现在)?(?:还没有|没有|没)(?:什么)?(?:具体的?)?(?:问题)?[。！!\s]*$/.test(text)) {
      return append({ ...current, branch: 'explore' }, text, '那就先了解你。\n\n最近有什么事，让你印象比较深？顺利的、开心的，或一直放不下的都可以。', 'experience')
    }
    return append({ ...current, branch: 'problem' }, text,
      '我们先从你的经历里找一点线索。\n\n以前遇到相近的情况时，你是怎么处理的？想起一次就可以。', 'experience', { problem: text })
  }
  switch (current.stage) {
    case 'experience':
      return append(current, text, '后来，事情变成了怎样？\n\n也可以说说，那种处理方式让你有什么感受。', 'outcome', { experience: text })
    case 'outcome':
      return append(current, text, '还有一次，你也遇到过类似的情况吗？\n\n相似的做法，或者一次不一样的选择，都值得放在一起看看。', 'another', { outcome: text })
    case 'another':
      return append(current, text, '把这两段经历放在一起，你觉得自己常用的处理方式是什么？\n\n先用你自己的话描述，不必给自己下定义。', 'pattern', { another: text })
    case 'pattern':
      return append(current, text, `我先把这句话留下来：\n\n“${text}”\n\n它贴近你的实际情况吗？也可以再改一改。`, 'confirm', { pattern: text }, false)
    case 'confirm':
      if (text === '贴近，继续') return append(current, text, '在这些经历里，哪种结果是你不想再经历的？', 'avoid', {}, true)
      if (text === '我想改一下') return append(current, text, '哪里理解偏了？按你的理解重新说一遍就好。', 'correction', {}, false)
      return append(current, text, `按你刚才补充的，我把它改成：\n\n“${text}”\n\n这样更贴近你了吗？`, 'confirm', { pattern: text }, false)
    case 'correction':
      return append(current, text, `我们以你的理解为准：\n\n“${text}”\n\n这样贴近你了吗？`, 'confirm', { pattern: text }, false)
    case 'avoid':
      return append(current, text, '如果再遇到类似情况，你希望自己怎样处理？\n\n可以保留已经有效的做法，再改变其中一小步。', 'future', { avoid: text === '暂时没有' ? '' : text })
    case 'future': {
      const notes = { ...current.notes, future: text }
      return append(current, text, makeSuggestion(notes), 'followup', { future: text })
    }
    case 'followup':
      return append(current, text, '可以继续把这一步说具体：你最担心在哪里卡住？\n\n当前是交互预览，尚未接入 AI。你的补充会保留在这段对话里。', 'followup')
  }
}

export function makeSuggestion(notes: Notes): string {
  return `先从你希望改变的这一点开始：\n\n“${notes.future}”\n\n下一次遇到类似情况时，先给自己一点确认的时间，选一个当下能做到的小行动。做完后，再回看它是否带来了你希望的变化。\n\n你觉得，迈出这一步最难的地方是什么？`
}

export function createDemoConversation(): Conversation {
  const turns: [string, string][] = [
    ['这次比赛我很想参加，但又怕影响课程。不知道该不该答应。', '先不急着做决定。以前遇到类似的机会时，你是怎样处理的？'],
    ['上次参加比赛，我一开始就接了不少任务。最后作品完成了，但课程作业几乎都是赶出来的。', '你既得到了做出作品的满足，也承担了时间被挤占的代价。还有一次类似的经历吗？'],
    ['上学期组织活动也是这样。我怕错过机会，很快就答应了，后来又不好意思缩小自己负责的范围。', '从这两段经历看，一个可能的模式是：你想把握机会，常常先答应，再想办法挤时间；之后要重新谈分工就变得更难。这个理解贴近你吗？'],
    ['挺贴近的。我不想再什么都接下来，最后靠熬夜补。', '这次如果能做得不同，你希望自己怎样安排？'],
    ['我希望能参加，但先确认自己能投入多少时间，只负责一个明确的部分。', '你可以先了解投入，再决定是否参加。\n\n过去让你吃力的，是答应以后才发现任务超出了自己能承担的范围。这次可以把确认时间和分工，放在答应之前。\n\n先和队友聊清楚：每周需要投入多少时间？你负责哪一部分？会不会撞上课程的重要节点？再按你实际能拿出的时间，决定要不要接下。\n\n这也给你留了余地：如果投入超出承受范围，可以缩小角色，或者放过这一次机会。'],
  ]
  return { branch: 'problem', stage: 'followup', confirmed: true, demo: true,
    notes: {
      problem: turns[0][0], experience: turns[1][0], outcome: '作品完成了，但课程作业被挤压。', another: turns[2][0],
      pattern: '面对想把握的机会，容易先答应，再挤时间；之后较难重新谈分工。',
      avoid: '不再什么都接下来，最后靠熬夜补。', future: '先确认能投入的时间，只负责一个明确的部分。',
    }, messages: turns.flatMap(([user, assistant], index) => [{ id: index * 2, role: 'user' as const, text: user }, { id: index * 2 + 1, role: 'assistant' as const, text: assistant }]) }
}
