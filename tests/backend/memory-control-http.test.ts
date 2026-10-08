import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { config } from '../../server/config.ts'
import { pool } from '../../server/db.ts'
import { createApp } from '../../server/http.ts'
import type { Engine } from '../../server/agent.ts'
import { createGrowthItem, growthContext } from '../../server/growth.ts'
import { collectCoachStream } from '../../scripts/coach-stream-evidence.ts'

// P6 closeout A2b: the confirmation card path over the REAL HTTP surface —
// authenticated session only, SSE done receipt, GET of persisted pending
// requests (this conversation), confirm through the action endpoint, and
// cross-account invisibility. The scripted engine stages exactly what the
// real engine stages; finishRun still runs for real.

test.after(async () => { await pool.end() })

async function signUp(origin: string, label: string) {
  const email = `p6-http-${label}-${randomUUID().slice(0, 8)}@example.invalid`
  const password = 'synthetic-password-123456'
  const signup = await fetch(origin + '/api/auth/sign-up/email', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name: 'Synthetic ' + label }) })
  if (signup.status !== 201 && signup.status !== 200) throw new Error('signup failed: ' + signup.status)
  const cookie = signup.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const session = await (await fetch(origin + '/api/session', { headers: { Cookie: cookie } })).json() as { id: string }
  return { cookie, userId: session.id }
}

test('A2b HTTP layer: SSE receipt → persisted pending request → confirm endpoint → cross-account invisible', async () => {
  const stagedByTurn: { pending?: unknown; control?: unknown }[] = []
  const engine: Engine = async input => {
    const turn = stagedByTurn.shift() ?? {}
    if (turn.pending) input.staged.pendingMemoryControl = turn.pending as never
    if (turn.control) input.staged.memoryControl = turn.control as never
    return { text: '合成回复：需要你在卡片里确认。', usage: null }
  }
  const oldOrigin = config.origin, oldRate = config.messagesPerMinute
  const app = createApp(engine)
  await new Promise<void>(ready => app.listen(0, '127.0.0.1', ready))
  const origin = 'http://127.0.0.1:' + (app.address() as { port: number }).port
  config.origin = origin; config.messagesPerMinute = 100000
  try {
    const main = await signUp(origin, 'main')
    const other = await signUp(origin, 'other')
    const chat = randomUUID()
    await fetch(origin + '/api/conversations', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: main.cookie }, body: JSON.stringify({ id: chat, title: 'SYNTHETIC HTTP' }) })
    const similarA = await createGrowthItem(main.userId, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '海报排版是我负责的' })
    const similarB = await createGrowthItem(main.userId, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '海报打印是我负责的' })

    // Unauthenticated access is rejected.
    assert.equal((await fetch(origin + '/api/growth/control-requests')).status, 401, 'control requests require a session')

    // Ambiguous control through the real SSE path.
    stagedByTurn.push({ pending: { kind: 'forget', clauseText: '忘掉海报那条记录', candidates: [{ itemId: similarA.id, revision: similarA.revision, preview: similarA.text.slice(0, 80) }, { itemId: similarB.id, revision: similarB.revision, preview: similarB.text.slice(0, 80) }] } })
    const requestId = randomUUID()
    const stream = await fetch(origin + '/api/conversations/' + chat + '/messages', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: main.cookie }, body: JSON.stringify({ requestId, text: '忘掉海报那条记录。' }) })
    assert.equal(stream.status, 200)
    const collected = await collectCoachStream(stream, performance.now())
    assert.equal(collected.done.stateChange?.memoryControl?.status, 'needs_confirmation', 'SSE done carries the confirmation receipt')
    assert.equal(collected.done.stateChange.memoryControl.candidates.length, 2)

    // Persisted and readable for this conversation.
    const listed = await (await fetch(origin + '/api/growth/control-requests?conversation=' + chat, { headers: { Cookie: main.cookie } })).json() as { requests: { id: string; requestId: string; status: string; candidates: { itemId: string }[] }[] }
    const pending = listed.requests.find(row => row.status === 'pending')
    assert.ok(pending, 'pending request persisted via the HTTP commit path')
    assert.equal(pending.requestId, requestId, 'receipt requestId matches the run')

    // Another account never sees it.
    const otherListed = await (await fetch(origin + '/api/growth/control-requests', { headers: { Cookie: other.cookie } })).json() as { requests: unknown[] }
    assert.equal(otherListed.requests.length, 0, 'cross-account invisibility')
    const foreign = await fetch(origin + '/api/growth/control-requests/' + pending.id + '/actions', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: other.cookie }, body: JSON.stringify({ requestId: randomUUID(), action: 'cancel' }) })
    assert.equal(foreign.status, 404, 'another account cannot resolve it')

    // Confirm one candidate through the endpoint.
    const confirmed = await fetch(origin + '/api/growth/control-requests/' + pending.id + '/actions', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: main.cookie }, body: JSON.stringify({ requestId: randomUUID(), action: 'confirm', itemId: similarA.id }) })
    assert.equal(confirmed.status, 200)
    const confirmedBody = await confirmed.json() as { result: { status: string; itemId: string } }
    assert.equal(confirmedBody.result.status, 'executed')
    assert.equal(confirmedBody.result.itemId, similarA.id)
    const after = await growthContext(main.userId, chat)
    assert.ok(!after.some(item => item.id === similarA.id), 'confirmed candidate forgotten')
    assert.ok(after.some(item => item.id === similarB.id), 'unselected candidate kept')

    // The decision is durable and cannot be repeated.
    const relist = await (await fetch(origin + '/api/growth/control-requests?conversation=' + chat, { headers: { Cookie: main.cookie } })).json() as { requests: { status: string }[] }
    assert.ok(!relist.requests.some(row => row.status === 'pending'), 'no pending left after confirmation')
    const again = await fetch(origin + '/api/growth/control-requests/' + pending.id + '/actions', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: main.cookie }, body: JSON.stringify({ requestId: randomUUID(), action: 'cancel' }) })
    assert.equal(again.status, 409, 'decided request rejects re-decision')

    // An unambiguous executed control surfaces through SSE done directly.
    const target = await createGrowthItem(main.userId, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '我的旧讲座记录' })
    stagedByTurn.push({ control: { kind: 'forget', itemId: target.id, expectedRevision: target.revision, clauseText: '请忘掉讲座记录' } })
    const stream2 = await fetch(origin + '/api/conversations/' + chat + '/messages', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: main.cookie }, body: JSON.stringify({ requestId: randomUUID(), text: '请忘掉讲座记录。' }) })
    const collected2 = await collectCoachStream(stream2, performance.now())
    assert.equal(collected2.done.stateChange?.memoryControl?.status, 'executed', 'executed control receipt on SSE done')
    assert.equal(collected2.done.stateChange.memoryControl.boundary, 'purged')
    assert.ok(!(await growthContext(main.userId, chat)).some(item => item.id === target.id), 'executed control really committed')

    // cleanup
    for (const table of ['growth_control_requests', 'growth_source_suppressions', 'growth_item_lineage', 'growth_items', 'growth_revisions', 'growth_operations', 'user_memory_settings']) await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1)`, [[main.userId, other.userId]]).catch(() => {})
    await pool.query('DELETE FROM coach_reply_sources WHERE user_id=ANY($1)', [[main.userId, other.userId]]).catch(() => {})
    await pool.query('DELETE FROM runs WHERE user_id=ANY($1)', [[main.userId, other.userId]])
    await pool.query('DELETE FROM messages WHERE user_id=ANY($1)', [[main.userId, other.userId]])
    await pool.query('DELETE FROM conversations WHERE user_id=ANY($1)', [[main.userId, other.userId]])
    await pool.query('DELETE FROM "user" WHERE id=ANY($1)', [[main.userId, other.userId]])
  } finally {
    config.origin = oldOrigin; config.messagesPerMinute = oldRate
    await new Promise<void>(done => app.close(() => done()))
  }
})
