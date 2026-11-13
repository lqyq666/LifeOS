export type Stage = 'opening' | 'experience' | 'outcome' | 'another' | 'pattern' | 'confirm' | 'correction' | 'avoid' | 'future' | 'followup'
export type Message = { id: number; role: 'user' | 'assistant'; text: string; sourceId?: string; transient?: boolean; memoryReferenceCount?:number }
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

export const DEMO_TITLE = '就业、考研与理想生活'

export function createDemoConversation(): Conversation {
  const turns: [string, string][] = [
    ['身边的人都开始准备考研或找实习了。我不知道该先就业、考研，还是试试别的路。',
      '> **先看你想过的生活，再比较道路。**\n> 就业、考研或其他选择，都需要一起看个人依据、现实投入和待核实的信息。\n\n我们一起看三件事：\n- **想要的生活**：你更在意什么，又不愿长期牺牲什么。\n- **现实投入**：时间、费用、能力准备，以及放弃其他机会的代价。\n- **仍然未知**：哪些判断需要亲自体验或找证据。\n\n如果先说生活本身，你最希望保留什么？'],
    ['我希望做有创造感的事，收入能支撑独立生活，也留得出时间运动。我做课程项目时喜欢访谈同学、改页面，但没有实习过，也没体验过科研。',
      '你已经给了两条线索：重视创造和自主，也在意收入与生活节奏。喜欢访谈和改页面，可以作为探索产品工作的起点；还不能据此断定你适合哪种职业。\n\n**先就业或实习**\n- 可能贴近的地方：更早接触真实用户和团队，也能验证你是否喜欢日常工作。\n- 需要投入：梳理项目、补岗位要求、投递和面试。\n- 尚待核实：岗位实际做什么、工作节奏如何、你的项目还缺什么。\n\n**考研**\n- 可能贴近的地方：如果目标工作需要更深的专业训练，读研可能有价值。\n- 需要投入：备考时间、学费与生活费，以及延后工作的机会成本；学制和费用需查具体项目。\n- 尚待核实：你是否喜欢研究训练，目标院校与未来工作的关系有多大。\n\n**先用一个小项目探索其他道路**\n- 可能贴近的地方：给自主创造留一个低成本的验证窗口。\n- 需要投入：明确要帮助谁，做出一个小成果，并收集真实反馈。\n- 尚待核实：你喜欢的是做项目的过程，还是独立承担找用户、交付和收入波动。'],
    ['我更想先试试产品相关工作，但怕现在不考研，以后会后悔。',
      '> **目前更值得优先验证的是产品相关工作。**\n> 考研先保留为选项，等目标岗位和研究兴趣更清楚后，再作判断。\n\n这是阶段判断：你已有一点相关兴趣，却还没接触真实岗位；科研兴趣也仍然未知。现在就把两条路都定死，依据还不够。\n\n可以分别寻找会改变判断的证据：\n- 如果体验后仍喜欢岗位日常，再对照真实要求补能力。\n- 如果感兴趣的工作普遍需要特定研究训练，或你发现自己喜欢研究过程，再认真评估读研。\n- 如果只是害怕错过，可以先核对当年的报考时间与条件，避免把担心当成适合考研的证据。'],
    ['这周我只有两小时。怎么开始，才能真的减少一点不确定？',
      '这两小时可以用来收集一小组证据，先不要求作出终身决定。\n\n1. **30分钟：看岗位。** 找两条真实的初级产品或相关实习招聘，记录日常任务、硬性要求和你还看不懂的地方。\n2. **30分钟：看读研。** 查一个感兴趣项目的培养方案、学制与费用，写下仍需向在读学生核实的问题。\n3. **45分钟：试一项工作。** 选一个熟悉的校园服务，访谈一位同学并画一页改进草图。它只是一次体验，不等于证明职业适配。\n4. **15分钟：做对照。** 记下哪部分让你投入、哪部分消耗你，以及下一条最值得查的信息。\n\n完成标准是留下岗位对照、读研疑问和一次体验记录。两条岗位或一次体验都只是初步样本；如果得到的结论相互矛盾，就继续取样。'],
    ['我先做这轮体验。现在更清楚了：我想验证的是自己喜不喜欢实际工作，不是马上证明考研没用。',
      '对，这次先验证一个具体问题。\n\n**当前保留的判断**\n- 你更重视创造、自主和可持续的生活节奏。\n- 产品相关工作值得先体验，考研的价值还需要结合目标工作与研究兴趣核实。\n- 费用、岗位节奏和真实工作感受仍未查清，暂时不下结论。\n\n下次带回你实际做了什么、喜欢或不喜欢的片段，以及新的证据，我们就能据此调整方向和下一步。计划本身不会被记成你已完成的经历。'],
  ]
  return { branch: 'problem', stage: 'followup', confirmed: true, demo: true,
    notes: {
      problem: turns[0][0], experience: turns[1][0], outcome: '课程项目中喜欢访谈和改页面；实习与科研体验仍未知。', another: '',
      pattern: '重视创造、自主、独立生活与可持续的节奏；职业适配仍待验证。',
      avoid: '不因怕错过而过早定死方向。', future: '用两小时核对岗位、读研信息并做一次小体验，再按证据调整判断。',
    }, messages: turns.flatMap(([user, assistant], index) => [{ id: index * 2, role: 'user' as const, text: user }, { id: index * 2 + 1, role: 'assistant' as const, text: assistant }]) }
}
