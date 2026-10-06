import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { config } from '../../server/config.ts'
import { pool } from '../../server/db.ts'
import { createApp } from '../../server/http.ts'
import type { Engine } from '../../server/agent.ts'
import { createConversation } from '../../server/store.ts'
import { createGrowthItem } from '../../server/growth.ts'
import { collectCoachStream } from '../../scripts/coach-stream-evidence.ts'
import { createCampusActors, assertFreshActorIsolated, type ActorApi } from '../../scripts/run-action-coach.ts'
import { createOperatorDriver, type Scenario } from '../../scripts/campus-continuous-operator.ts'

test.after(async () => { await pool.end() })

// ISO-01/ISO-02/ISO-03 run against a real BetterAuth signup, real HTTP app and
// the isolated disposable PostgreSQL database. The simulated engine records the
// exact context it receives (what would be serialized into the SDK payload).
test('campus actors are isolated accounts: canary never crosses actors (ISO-01), same-actor sessions continue (ISO-02), sibling trajectories differ (ISO-03)', async () => {
  const sdkPayloads: string[] = []
  const engine: Engine = async input => {
    sdkPayloads.push(JSON.stringify({ context: input.context, decision: input.decision ?? null }))
    return { text: '这是合成回复，用于隔离验证。', usage: null }
  }
  const oldOrigin = config.origin, oldRate = config.messagesPerMinute
  const app = createApp(engine)
  await new Promise<void>(ready => app.listen(0, '127.0.0.1', ready))
  const origin = 'http://127.0.0.1:' + (app.address() as { port: number }).port
  config.origin = origin; config.messagesPerMinute = 1000
  const privateSessions: { actorKey: string; origin: string; email: string; password: string; userId: string }[] = []
  const readyEvidence: { actorKey: string; userId: string }[] = []
  try {
    const actors = createCampusActors({
      origin,
      trajectoryIds: ['C01', 'C02', 'C04A', 'C04B', 'C05A', 'C05B'],
      emailPrefix: 'iso-' + randomUUID().slice(0, 8),
      storePrivateSession: entry => { privateSessions.push(entry) },
      onActorReady: evidence => { readyEvidence.push(evidence) },
    })

    const jia = await actors.ensureActor('C01')
    const yi = await actors.ensureActor('C02')
    assert.notEqual(jia.userId, yi.userId, 'two trajectory actors must never share one account')
    assert.equal((await actors.apiFor(jia)('/api/session')).id, jia.userId)
    assert.equal((await actors.apiFor(yi)('/api/session')).id, yi.userId)
    assert.deepEqual(readyEvidence.map(row => row.actorKey).sort(), ['C01', 'C02'])
    assert.ok(privateSessions.every(entry => !('cookie' in entry)), 'private session records never store cookies')
    assert.ok(privateSessions.every(entry => entry.userId.length > 0))

    const canary = 'CANARY_A_ONLY_' + randomUUID()
    const jiaApi = actors.apiFor(jia)
    const yiApi = actors.apiFor(yi)
    const jiaConversation = await jiaApi('/api/conversations', { id: randomUUID(), title: 'ISO 甲' })
    const canaryStream = await fetch(origin + '/api/conversations/' + jiaConversation.id + '/messages', {
      method: 'POST', headers: jia.headers, body: JSON.stringify({ requestId: randomUUID(), text: '我先说一个只有我知道的标记：' + canary }),
    })
    assert.equal((await collectCoachStream(canaryStream, performance.now())).done.requestId !== undefined, true)
    assert.ok(sdkPayloads.some(payload => payload.includes(canary)), 'positive control: actor A context contains its own canary')

    // ISO-01: actor B never asked about the canary and must not receive it in
    // API state or in the engine context that would reach the provider.
    const yiConversation = await yiApi('/api/conversations', { id: randomUUID(), title: 'ISO 乙' })
    const yiStream = await fetch(origin + '/api/conversations/' + yiConversation.id + '/messages', {
      method: 'POST', headers: yi.headers, body: JSON.stringify({ requestId: randomUUID(), text: '我读统计学，最近在考虑毕业方向。' }),
    })
    await collectCoachStream(yiStream, performance.now())
    const yiGrowth = await yiApi('/api/growth')
    const yiHistory = await yiApi('/api/conversations')
    const yiMemory = await yiApi('/api/memory')
    const yiEvent = await yiApi('/api/conversations/' + yiConversation.id + '/event')
    const yiSurfaces = JSON.stringify({ yiGrowth, yiHistory, yiMemory, yiEvent })
    assert.ok(!yiSurfaces.includes(canary), 'actor B growth/history/memory/events must not contain actor A canary')
    const yiPayload = sdkPayloads[sdkPayloads.length - 1]!
    assert.ok(!yiPayload.includes(canary), 'actor B engine context (SDK payload equivalent) must not contain actor A canary')

    // ISO-02: a new conversation of the same actor, with memory explicitly
    // enabled on that account, still carries the actor's own valid facts.
    await jiaApi('/api/memory/settings', { requestId: randomUUID(), enabled: true, expectedRevision: 0 })
    const jiaSecond = await jiaApi('/api/conversations', { id: randomUUID(), title: 'ISO 甲 第二会话' })
    const carryFact = '甲的独立事实：每周可投入四小时' + randomUUID().slice(0, 6)
    await jiaApi('/api/growth', {
      requestId: randomUUID(), conversationId: jiaConversation.id, kind: 'context', text: carryFact,
    })
    const carried = await jiaApi('/api/growth?conversation=' + jiaSecond.id)
    assert.ok(carried.items.some((item: { text: string }) => item.text === carryFact), 'same actor sees own facts from a new conversation once memory is enabled')
    const yiGrowthAfter = await yiApi('/api/growth')
    assert.ok(!JSON.stringify(yiGrowthAfter).includes(carryFact), 'actor B still has none of actor A facts')

    // ISO-03: the four sibling trajectories are four distinct accounts whose
    // private constraints never mix.
    const siblings = ['C04A', 'C04B', 'C05A', 'C05B']
    const siblingIds: string[] = []
    for (const key of siblings) {
      const actor = await actors.ensureActor(key)
      siblingIds.push(actor.userId)
      const api = actors.apiFor(actor)
      const conversation = await api('/api/conversations', { id: randomUUID(), title: 'ISO ' + key })
      const fact = key === 'C04A' ? '我每周有18小时可用' : key === 'C04B' ? '我每周只有4小时能用，而且我需要有工资来维持基本开支' : '每周3小时，预算200元'
      await api('/api/growth', { requestId: randomUUID(), conversationId: conversation.id, kind: 'constraint', text: fact, validUntil: new Date(Date.now() + 86400000).toISOString() })
    }
    assert.equal(new Set(siblingIds).size, 4, 'C04A/C04B/C05A/C05B must be four distinct users')
    const actorB = await actors.ensureActor('C04B')
    const bView = await actors.apiFor(actorB)('/api/growth')
    const bTexts = bView.items.map((item: { text: string }) => item.text).join('|')
    assert.ok(bTexts.includes('每周只有4小时'), 'C04B keeps its own constraint')
    assert.ok(!bTexts.includes('18小时'), 'C04B must not inherit C04A constraint')

    // Unknown trajectory keys can never become accounts.
    await assert.rejects(() => actors.ensureActor('C99'), /UNKNOWN_ACTOR_KEY/)

    // A polluted account is rejected as a fixture-isolation failure before any
    // provider request could be made for it.
    const polluted = await actors.ensureActor('C05A')
    const pollutedConversation = await createConversation(polluted.userId, { id: randomUUID(), title: 'pollution' })
    await createGrowthItem(polluted.userId, { requestId: randomUUID(), conversationId: pollutedConversation.id, kind: 'context', text: '污染项：不是新账号' })
    await assert.rejects(() => assertFreshActorIsolated(actors.apiFor(polluted)), /FIXTURE_ISOLATION_FAILED/)
  } finally {
    config.origin = oldOrigin; config.messagesPerMinute = oldRate
    await new Promise<void>(done => app.close(() => done()))
  }
})

test('operator driver: every command carries the scenario actorKey and a failed turn is never auto-resent', async () => {
  const sent: Record<string, unknown>[] = []
  const logs: Record<string, unknown>[] = []
  const scenarios: Scenario[] = [
    { id: 'C09', steps: [
      { kind: 'enableMemory' },
      { kind: 'fixed', text: '第一条输入', sampleClass: 'opening' },
      { kind: 'readGrowth' },
      { kind: 'forget', match: /成绩/, label: 'transcript' },
      { kind: 'fixed', text: '收尾输入', sampleClass: 'ordinary_followup' },
    ] },
    { id: 'C10', steps: [
      { kind: 'fixed', text: 'C10 第一条', sampleClass: 'opening' },
      { kind: 'fixed', text: 'C10 第二条', sampleClass: 'ordinary_followup' },
    ] },
  ]
  const driver = createOperatorDriver({ scenarios, log: entry => logs.push(entry), send: line => sent.push(line) })

  driver.handleChildMessage({ ready: true, runId: 'r' })
  assert.deepEqual(sent.at(-1), { operation: 'readMemory', actorKey: 'C09', logicalStepId: 'C09:0' })
  driver.handleChildMessage({ operation: 'readMemory', value: { settings: { enabled: false, revision: 0 } } })
  assert.equal(sent.at(-1)!.operation, 'memorySettings')
  assert.equal(sent.at(-1)!.actorKey, 'C09')
  driver.handleChildMessage({ operation: 'memorySettings', value: { enabled: true, revision: 1 } })
  assert.deepEqual(sent.at(-1), { trajectory: 'C09', actorKey: 'C09', logicalStepId: 'C09:1', text: '第一条输入', sampleClass: 'opening' })

  // A failed turn consumed a real call. The failure is preserved as-is and the
  // operator advances the script; the same input is never resent automatically.
  driver.handleChildMessage({ trajectory: 'C09', turn: 2, error: 'MODEL_TIMEOUT' })
  assert.notDeepEqual(sent.at(-1)!.text, '第一条输入', 'failed input must not be auto-resent')
  assert.deepEqual(sent.at(-1), { operation: 'readGrowth', actorKey: 'C09', logicalStepId: 'C09:2' })

  driver.handleChildMessage({ operation: 'readGrowth', value: { items: [{ id: 'g1', text: '成绩单平均分81', revision: 3, status: 'active' }, { id: 'g2', text: '兴趣是视觉设计', revision: 1, status: 'active' }] } })
  assert.equal(sent.at(-1)!.operation, 'growthAction')
  assert.equal(sent.at(-1)!.actorKey, 'C09')
  assert.equal(sent.at(-1)!.itemId, 'g1')
  driver.handleChildMessage({ operation: 'growthAction', value: { id: 'g1', status: 'forgotten' } })
  assert.deepEqual(sent.at(-1), { trajectory: 'C09', actorKey: 'C09', logicalStepId: 'C09:4', text: '收尾输入', sampleClass: 'ordinary_followup' })
  driver.handleChildMessage({ trajectory: 'C09', turn: 3 })
  driver.handleChildMessage({ trajectory: 'C10', turn: 4, error: 'STREAM_ERROR' })
  assert.deepEqual(sent.at(-1), { trajectory: 'C10', actorKey: 'C10', logicalStepId: 'C10:1', text: 'C10 第二条', sampleClass: 'ordinary_followup' })
  driver.handleChildMessage({ trajectory: 'C10', turn: 5 })
  assert.equal(sent.at(-1)!.operation, 'exit')
  assert.ok(!sent.some(line => JSON.stringify(line).includes('第一条输入') && sent.filter(other => JSON.stringify(other) === JSON.stringify(line)).length > 1), 'no input was ever sent twice')
  assert.ok(logs.some(entry => entry.event === 'turn-result' && entry.failed === true), 'failures are logged and preserved')
})

test('operator driver: reject step rejects only proposed ai observations (PC12)', () => {
  const sent: Record<string, unknown>[] = []
  const logs: Record<string, unknown>[] = []
  const scenarios: Scenario[] = [
    { id: 'PC12R', steps: [
      { kind: 'fixed', text: '开场', sampleClass: 'opening' },
      { kind: 'readGrowth' },
      { kind: 'reject', match: /害怕/, label: 'rejected-explanation' },
      { kind: 'fixed', text: '更正解释', sampleClass: 'ordinary_followup' },
    ] },
  ]
  const driver = createOperatorDriver({ scenarios, log: entry => logs.push(entry), send: line => sent.push(line) })
  driver.handleChildMessage({ ready: true, runId: 'r' })
  driver.handleChildMessage({ trajectory: 'PC12R', turn: 1 })
  driver.handleChildMessage({ operation: 'readGrowth', value: { items: [
    { id: 'o1', text: '可能害怕竞争所以没继续投', revision: 2, status: 'proposed', assertion: 'ai_observation' },
    { id: 'f1', text: '投递时害怕没有回音', revision: 1, status: 'active', assertion: 'user_reported' },
    { id: 'o2', text: '另一个观察', revision: 1, status: 'proposed', assertion: 'ai_observation' },
  ] } })
  // Only the matching PROPOSED observation is rejected; a user fact carrying the
  // same keyword and unrelated observations are never touched.
  assert.equal(sent.at(-1)!.operation, 'growthAction')
  assert.equal(sent.at(-1)!.itemId, 'o1')
  assert.equal((sent.at(-1)!.value as { action: string }).action, 'reject')
  driver.handleChildMessage({ operation: 'growthAction', value: { id: 'o1', status: 'rejected' } })
  assert.deepEqual(sent.at(-1), { trajectory: 'PC12R', actorKey: 'PC12R', logicalStepId: 'PC12R:3', text: '更正解释', sampleClass: 'ordinary_followup' })
  // With no proposed observation matching, the step skips without any write.
  const sentAfter = sent.length
  const driver2 = createOperatorDriver({ scenarios, log: () => {}, send: line => sent.push(line) })
  driver2.handleChildMessage({ ready: true, runId: 'r2' })
  driver2.handleChildMessage({ trajectory: 'PC12R', turn: 1 })
  driver2.handleChildMessage({ operation: 'readGrowth', value: { items: [
    { id: 'f1', text: '投递时害怕没有回音', revision: 1, status: 'active', assertion: 'user_reported' },
  ] } })
  assert.deepEqual(sent.at(-1), { trajectory: 'PC12R', actorKey: 'PC12R', logicalStepId: 'PC12R:3', text: '更正解释', sampleClass: 'ordinary_followup' })
  assert.ok(!sent.slice(sentAfter).some(line => line.operation === 'growthAction' && line.itemId === 'f1'), 'user facts are never rejected')
})
