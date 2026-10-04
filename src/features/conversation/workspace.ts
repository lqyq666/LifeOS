import { emptyConversation, type Conversation } from './flow.ts'

export const WORKSPACE_KEY = 'lifeos.conversation-workspace.v1'
export type Project = { id: string; name: string; description: string }
export type Chat = {
  id: string; title: string; renamed: boolean; projectId: string | null
  pinned: boolean; updatedAt: number
  conversation: Conversation; draft: string
}
export type Workspace = { version: 1; activeId: string; chats: Chat[]; projects: Project[] }

export function newChat(projectId: string | null = null): Chat {
  return { id: crypto.randomUUID(), title: '新对话', renamed: false, projectId, pinned: false,
    updatedAt: Date.now(), conversation: emptyConversation(), draft: '' }
}
export function newWorkspace(): Workspace {
  const chat = newChat()
  return { version: 1, activeId: chat.id, chats: [chat], projects: [] }
}

const stages = new Set(['opening', 'experience', 'outcome', 'another', 'pattern', 'confirm', 'correction', 'avoid', 'future', 'followup'])
const noteKeys = ['problem', 'experience', 'outcome', 'another', 'pattern', 'avoid', 'future']
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max

function validConversation(value: unknown): value is Conversation {
  if (!object(value) || !stages.has(String(value.stage)) || (value.branch !== null && value.branch !== 'problem' && value.branch !== 'explore')
    || typeof value.confirmed !== 'boolean' || typeof value.demo !== 'boolean' || !object(value.notes)
    || !noteKeys.every(key => string((value.notes as Record<string, unknown>)[key], 4000)) || !Array.isArray(value.messages)) return false
  const ids = new Set<number>()
  return value.messages.every(message => {
    if (!object(message) || !Number.isSafeInteger(message.id) || (message.id as number) < 0 || ids.has(message.id as number)
      || !['user', 'assistant'].includes(String(message.role)) || !string(message.text, 16000)) return false
    ids.add(message.id as number)
    return true
  })
}

// A damaged store is never silently replaced by a fresh workspace.
export function parseWorkspace(raw: string): Workspace {
  const value: unknown = JSON.parse(raw)
  if (!object(value) || value.version !== 1 || !Array.isArray(value.chats) || !Array.isArray(value.projects)
    || !string(value.activeId, 100) || !value.chats.length) throw new Error('Invalid workspace')
  const ids = new Set<string>()
  for (const project of value.projects) {
    if (!object(project) || !string(project.id, 100) || !project.id || ids.has(project.id) || !string(project.name, 80)
      || !project.name.trim() || !string(project.description, 500) || (project.archived !== undefined && typeof project.archived !== 'boolean')) throw new Error('Invalid project')
    ids.add(project.id)
  }
  const chatIds = new Set<string>()
  for (const chat of value.chats) {
    if (!object(chat) || !string(chat.id, 100) || !chat.id || chatIds.has(chat.id) || !string(chat.title, 100)
      || !chat.title.trim() || typeof chat.renamed !== 'boolean' || typeof chat.pinned !== 'boolean' || (chat.archived !== undefined && typeof chat.archived !== 'boolean')
      || typeof chat.updatedAt !== 'number' || !Number.isFinite(chat.updatedAt) || !string(chat.draft, 4000)
      || (chat.projectId !== null && (!string(chat.projectId, 100) || !ids.has(chat.projectId))) || !validConversation(chat.conversation)) throw new Error('Invalid chat')
    chatIds.add(chat.id)
  }
  const workspace = value as unknown as Workspace
  // Older saved archives become ordinary records; retain every message, draft and project link.
  for (const entry of [...workspace.chats, ...workspace.projects]) delete (entry as { archived?: boolean }).archived
  if (!workspace.chats.some(chat => chat.id === workspace.activeId)) workspace.activeId = workspace.chats[0].id
  return workspace
}

export function updateChat(workspace: Workspace, id: string, patch: Partial<Chat>): Workspace {
  return { ...workspace, chats: workspace.chats.map(chat => chat.id === id ? { ...chat, ...patch } : chat) }
}
export function chatTitle(conversation: Conversation): string {
  return conversation.demo ? '比赛与课程之间的选择' : conversation.messages.find(message => message.role === 'user')?.text.replace(/\s+/g, ' ').slice(0, 30) || '新对话'
}
