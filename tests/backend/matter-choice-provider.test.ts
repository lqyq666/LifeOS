import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { residualHarness } from '../fixtures/residual-turn-harness.ts'
import * as store from '../../server/store.ts'
import { stageCoachEvent } from '../../server/action-coach-events.ts'

test('named task acceptance reaches the next provider context while execution remains unattempted', async () => {
  const h = await residualHarness()
  try {
    const { user, chat } = await h.account()
    for (const item of [
      { title: '合作文档权限', quotes: ['我已经接受合作文档权限的检查和修改，但还没有执行。', '小陈需要今天23:50前获得查看权限。我估计要五分钟，只同意小陈账号查看，不同意公开链接。'] },
      { title: '课程报告', quotes: ['我已经接受课程报告的图表说明补充，但还没有执行。', '课程报告明天18:00截止。本地已有数据和报告文档，离线也能打开。完整整理预计要25分钟连续专注。'] },
    ]) {
      const conversation = randomUUID()
      await store.createConversation(user, { id: conversation, title: item.title })
      const run = (await store.startRun(user, conversation, randomUUID(), item.quotes.join(''))).run
      const coach = await stageCoachEvent(run, { target: { operation: 'create', title: item.title, source: { messageId: run.source_message_id, quote: item.quotes[0]! } }, nodes: item.quotes.map(quote => ({ kind: 'fact', source: { messageId: run.source_message_id, quote } })) }, '本地合成来源。')
      await store.finishRun(run, { candidates: [], audit: [], coach }, '本地合成来源。', null, new AbortController().signal)
    }
    await h.execute(user, chat, '我有60分钟，精力充足，电脑网络可用。请比较手头这些事的优先级，只讨论取舍，不修改资料、记忆或任务。', {}, '先做合作文档权限，课程报告后排。')
    const payload = h.requests.at(-1)
    assert.ok(payload.response_format.json_schema.schema.properties.decisionProposal)
    const context = JSON.parse(payload.messages.find((message: any) => message.role === 'user').content)
    assert.equal(context.readOnlyRelatedEventWorkspaces.length, 2)
    for (const event of context.readOnlyRelatedEventWorkspaces) {
      assert.equal(event.reportedMatterProgress.choice, 'accepted')
      assert.equal(event.reportedMatterProgress.state, 'unattempted')
    }
  } finally { await h.close() }
})
