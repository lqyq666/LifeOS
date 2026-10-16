import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advanceConversation } from '../src/features/conversation/flow.ts'
import { chatTitle, newChat, newWorkspace, parseWorkspace, updateChat } from '../src/features/conversation/workspace.ts'

test('Conversation, authored draft, custom title and project survive storage round-trip', () => {
  let workspace = newWorkspace()
  const original = workspace.activeId
  const project = { id: 'project-a', name: '比赛准备', description: '界面验收数据' }
  workspace.projects.push(project)
  const conversation = advanceConversation(workspace.chats[0].conversation, '界面验收：讨论时间分配')
  workspace = updateChat(workspace, original, { conversation, draft: '尚未发送的补充', projectId: project.id, title: '我的标题', renamed: true, pinned: true })
  const second = newChat()
  workspace.chats.push(second)
  workspace.activeId = second.id
  const restored = parseWorkspace(JSON.stringify(workspace))
  assert.deepEqual(restored, workspace)
  assert.equal(restored.chats.find(chat => chat.id === original)?.conversation.messages[0].text, '界面验收：讨论时间分配')
  assert.equal(chatTitle(conversation), '界面验收：讨论时间分配')
})

test('Legacy archived chats and projects become ordinary records without losing content or selection', () => {
  const workspace = newWorkspace()
  workspace.projects.push({ id: 'legacy-project', name: '曾归档的项目', description: '原项目说明' })
  workspace.chats[0] = { ...workspace.chats[0], projectId: 'legacy-project', draft: '受保护的草稿', conversation: advanceConversation(workspace.chats[0].conversation, '保留这一次完整对话') }
  workspace.chats.push(newChat())
  const legacy = { ...workspace, chats: workspace.chats.map((chat, index) => ({ ...chat, archived: index === 0 })), projects: workspace.projects.map(project => ({ ...project, archived: true })) }
  const restored = parseWorkspace(JSON.stringify(legacy))
  assert.deepEqual(restored, workspace)
  assert.equal(restored.activeId, workspace.activeId)
  assert.equal(restored.chats.length, 2)
  assert.deepEqual(parseWorkspace(JSON.stringify(restored)), restored)
  assert.equal(legacy.chats[0].archived, true)
})

test('Invalid saved data is rejected rather than silently normalized or overwritten', () => {
  for (const corrupt of ['null', '{', JSON.stringify({ version: 9 }), JSON.stringify({ ...newWorkspace(), projects: [{ id: 'x', name: ' ', description: '', archived: false }] })]) {
    assert.throws(() => parseWorkspace(corrupt))
  }
  const dangling = newWorkspace()
  dangling.chats[0].projectId = 'missing'
  assert.throws(() => parseWorkspace(JSON.stringify(dangling)))
  const duplicated = newWorkspace()
  duplicated.chats.push({ ...duplicated.chats[0] })
  assert.throws(() => parseWorkspace(JSON.stringify(duplicated)))
})

test('A missing stored active ID selects an existing chat without creating or discarding records', () => {
  const workspace = newWorkspace()
  const restored = parseWorkspace(JSON.stringify({ ...workspace, activeId: 'missing' }))
  assert.equal(restored.activeId, workspace.chats[0].id)
  assert.deepEqual(restored.chats, workspace.chats)
})
