import type { Conversation } from './flow.ts'

export type AnswerOption = {
  id: string
  label: string
  description: string
  action: 'write' | 'send' | 'explore' | 'demo'
  placeholder?: string
}
export type AnswerQuestion = { title: string; options: AnswerOption[] }

// Writing directions never become personal facts: the user supplies the text.
// Only an explicitly confirmed "send" option is submitted as an answer.
export function getAnswerQuestion(conversation: Conversation): AnswerQuestion | null {
  switch (conversation.stage) {
    case 'opening': return {
      title: '选一个开始方式',
      options: [
        { id: 'problem', label: '有个具体问题，想一起想清楚', description: '聊聊眼前的困惑、选择，或还没理顺的想法。', action: 'write', placeholder: '最近有什么事让你犹豫？' },
        { id: 'explore', label: '暂时没有，先了解我', description: '从过去的经历里，慢慢认识自己的处理方式。', action: 'explore' },
        { id: 'demo', label: '看看对话示例', description: '先看看如何从一个问题，聊到具体的下一步。', action: 'demo' },
      ],
    }
    case 'confirm': return {
      title: '这个理解，贴近真实的你吗？',
      options: [
        { id: 'yes', label: '贴近，继续', description: '这符合我刚才描述的经历和做法。', action: 'send' },
        { id: 'change', label: '我想改一下', description: '有些地方理解偏了，我想重新说一遍。', action: 'send' },
        { id: 'more', label: '想补充一点', description: '大体贴近，但还需要一些条件或细节。', action: 'write', placeholder: '更准确地说，只有在……的时候，我才会……' },
      ],
    }
    default: return null
  }
}
