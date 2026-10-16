import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { createTurnEngine } from '../../server/agent.ts'
import { model } from '../../server/model.ts'
import { config } from '../../server/config.ts'
import { growthContext, growthBoundaryContext, createGrowthItem } from '../../server/growth.ts'
import { detectForgetIntentClauses, scoreForgetTargets } from '../../server/forget-intent.ts'
import { listControlRequests, resolveControlRequest } from '../../server/memory-controls.ts'
import { localEmbedding } from '../../server/local-embedding.ts'

// P6 closeout A1+A3: control intent classification (N01–N08 plus unseen
// variants) and the FULL user path — startRun → engine (staging only) →
// finishRun (the control commits in the run's own transaction) → GET run
// status → conversation refresh → new conversation. Failures, cancellations,
// replays and concurrent conflicts happen on the real execution path, never
// as hand-written boolean arrays.

const mkItem = (id: string, text: string) => ({
  id, conversationId: 'c', kind: 'context', text, assertion: 'user_reported', status: 'active',
  sources: [], dependencies: [], unavailableReason: null, validFrom: null, validUntil: null,
  timeBasis: null, revision: 1, createdAt: '', updatedAt: '', limitation: '', progressState: null,
  directionScopes: [], structuredPlan: null,
} as never)

test('A1 free replay: clause intent classification (N01-N08 + unseen variants)', () => {
  const kinds = (text: string) => detectForgetIntentClauses(text).filter(clause => clause.kind).map(clause => clause.kind)
  // N01-N03: refusal of deletion keeps state — never a pause authorization.
  assert.deepEqual(kinds('不要删除我的海报经历记录。'), [])
  assert.deepEqual(kinds('请不要删除我的海报经历记录。'), [])
  assert.deepEqual(kinds('我的海报经历记录不要删除。'), [])
  assert.deepEqual(kinds('先别删了，就这样保留。'), [])
  // N04: cognitive lapse is not an erase instruction.
  assert.deepEqual(kinds('我忘记了那次海报的具体交付记录。'), [])
  assert.deepEqual(kinds('我记不清那次交付的细节了。'), [])
  assert.deepEqual(kinds('记不清那次交付经过。'), [])
  // But 帮我忘记 with the same verb IS a command.
  assert.deepEqual(kinds('请帮我忘记那次海报经历。'), ['forget'])
  // N05/N06: stop commands are affirmative despite negative wording.
  assert.deepEqual(kinds('别再用我的海报经历作为建议依据，记录保留。'), ['pause_use'])
  assert.deepEqual(kinds('不要再推荐这段海报经历。'), ['stop_recommend'])
  assert.deepEqual(kinds('以后别再提海报这件事了。'), ['stop_recommend'])
  assert.deepEqual(kinds('别拿我的海报经历当参考依据。'), ['pause_use'])
  assert.deepEqual(kinds('这段经历暂时不用作为判断依据。'), ['pause_use'])
  // N07: positive forget kept.
  assert.deepEqual(kinds('请忘掉我的海报经历记录。'), ['forget'])
  assert.deepEqual(kinds('帮我清除海报那条记录。'), ['forget'])
  assert.deepEqual(kinds('把海报那条记录删了吧。'), ['forget'])
  // 不用保留 is an erase request, 先不删 is not.
  assert.deepEqual(kinds('这些记录不用保留了。'), ['forget'])
  // Hypothetical, question, quote and third-party stay inert.
  assert.deepEqual(kinds('如果以后想删除这条海报经历记录，要怎么操作？'), [])
  assert.deepEqual(kinds('怎么才能忘掉这条记录？'), [])
  assert.deepEqual(kinds('学长说“把记录删了”，我没同意。'), [])
  // Mixed lapse + command separates at clause level.
  assert.deepEqual(kinds('我忘记交付经过了，帮我删掉这条吧。'), ['forget'])
  // N08: the control clause names its own object — scoring must not be
  // re-weighted by the unrelated long feedback in the same message.
  const mixed = detectForgetIntentClauses('学长反馈公众号主要是排班推送，不是内容策划，我已经确认公众号日常由轮值排班负责发布和数据登记。顺便忘掉这条海报经历记录。')
  const forgetClause = mixed.find(clause => clause.kind === 'forget')
  assert.ok(forgetClause, 'N08: exactly the control clause yields forget')
  const scored = scoreForgetTargets([mkItem('newsletter', '学长反馈公众号主要是排班推送，不是内容策划，日常由轮值排班负责发布和数据登记'), mkItem('poster', '我的海报经历记录')], forgetClause!.clauseText, '学长反馈公众号主要是排班推送，不是内容策划，我已经确认公众号日常由轮值排班负责发布和数据登记。顺便忘掉这条海报经历记录。')
  assert.equal(scored[0]!.item.id, 'poster', 'N08: control-clause target wins over whole-message noise')
  // A pure pronoun clause resolves to the NEAREST preceding clause only.
  const pronoun = detectForgetIntentClauses('学长反馈公众号主要是排班推送，我已经确认了。忘掉它吧。')
  const pronounClause = pronoun.find(clause => clause.kind === 'forget')
  assert.ok(pronounClause)
  const pronounScored = scoreForgetTargets([mkItem('newsletter', '学长反馈公众号主要是排班推送'), mkItem('poster', '我的海报经历记录')], pronounClause!.clauseText, '学长反馈公众号主要是排班推送，我已经确认了。忘掉它吧。')
  assert.equal(pronounScored[0]!.item.id, 'newsletter', 'pronoun resolves against the nearest antecedent clause')
})

// Shared isolated-engine harness: a fake provider returning scripted outputs
// through the REAL engine; every case finishes through the REAL finishRun.
function withEngineScenario(name: string, run: (helpers: {
  user: string
  chat: string
  chat2: string
  prepare: (text: string, conv?: `${string}-${string}-${string}-${string}-${string}`) => Promise<{ run: store.Run; staged: store.Staged; input: Parameters<import('../../server/agent.ts').Engine>[0] }>
  outputs: unknown[]
  engine: import('../../server/agent.ts').Engine
}) => Promise<void>) {
  test(name, async t => {
    await localEmbedding.start()
    const outputs: unknown[] = []
    const engine = createTurnEngine({ capabilityVerified: () => true })
    const fake = createServer((req, res) => {
      req.on('data', () => {}); req.on('end', () => {
        const output = outputs.shift()
        if (output === undefined) { res.writeHead(500); res.end(); return }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const base = { id: 'p6-closeout', object: 'chat.completion.chunk', created: 1, model: model.id }
        res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: null }] }) + '\n\n')
        res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280, prompt_tokens_details: { cached_tokens: 0 } } }) + '\n\ndata: [DONE]\n\n')
        res.end()
      })
    })
    await new Promise<void>(r => fake.listen(0, '127.0.0.1', r))
    const prevURL = model.baseUrl, prevKey = config.apiKey
    model.baseUrl = 'http://127.0.0.1:' + (fake.address() as { port: number }).port
    config.apiKey = 'synthetic-p6-closeout-key-1234567890'
    const user = 'p6-closeout-' + randomUUID(), chat = randomUUID(), chat2 = randomUUID()
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())', [user, user + '@example.invalid'])
    await store.createConversation(user, { id: chat, title: 'SYNTHETIC A' })
    await store.createConversation(user, { id: chat2, title: 'SYNTHETIC A2' })
    await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1) ON CONFLICT (user_id) DO UPDATE SET enabled=true', [user])
    const prepare = async (text: string, conv = chat) => {
      await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_TEST_CLEANUP',finished_at=now() WHERE user_id=$1 AND status='running'", [user])
      const started = await store.startRun(user, conv, randomUUID(), text)
      const staged: store.Staged = { candidates: [], audit: [] }
      return { run: started.run, staged, input: { run: started.run, staged, context: await store.contextForRun(started.run), decision: null, signal: new AbortController().signal, emit: () => {} } }
    }
    try {
      await run({ user, chat, chat2, prepare, outputs, engine })
      void t
    } finally {
      model.baseUrl = prevURL; config.apiKey = prevKey
      await new Promise<void>(d => fake.close(() => d()))
      try { await localEmbedding.close() } catch {}
      for (const table of ['growth_control_requests', 'growth_recommendation_controls', 'growth_source_suppressions', 'growth_item_lineage', 'growth_items', 'growth_revisions', 'growth_operations', 'user_memory_settings']) await pool.query(`DELETE FROM ${table} WHERE user_id=$1`, [user]).catch(() => {})
      await pool.query('DELETE FROM coach_reply_sources WHERE user_id=$1', [user]).catch(() => {})
      // 无感入库会在含完成行动的轮次自动创建经历，清理需先删经历及其衍生。
      await pool.query('DELETE FROM experience_theme_links WHERE user_id=$1', [user]).catch(() => {})
      await pool.query('DELETE FROM user_themes WHERE user_id=$1', [user]).catch(() => {})
      await pool.query('DELETE FROM experience_revisions WHERE user_id=$1', [user]).catch(() => {})
      await pool.query('DELETE FROM experience_links WHERE user_id=$1', [user]).catch(() => {})
      await pool.query('DELETE FROM experiences WHERE user_id=$1', [user]).catch(() => {})
      await pool.query('DELETE FROM runs WHERE user_id=$1', [user])
      await pool.query('DELETE FROM messages WHERE user_id=$1', [user])
      await pool.query('DELETE FROM conversations WHERE user_id=$1', [user])
      await pool.query('DELETE FROM "user" WHERE id=$1', [user])
    }
  })
}

withEngineScenario('A3 full path: intent → staging → finishRun commit → GET → refresh → new conversation', async ({ user, chat, chat2, prepare, outputs, engine }) => {
  const poster = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '我的海报经历记录' })
  const newsletter = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '学长反馈公众号主要是排班推送' })

  // Refusal keeps state: no staged control, no receipt, item untouched.
  // (Refusals and lapses are NOT control clauses, so the pure-control shortcut
  // does not fire; the turn still goes through the model path.)
  {
    const p = await prepare('请不要删除我的海报经历记录。')
    outputs.push({ reply: '好的，保留你的海报记录。' })
    const result = await engine(p.input)
    const response = await store.finishRun(p.run, p.staged, result.text, result.usage, p.input.signal)
    assert.equal(response.stateChange.memoryControl, null)
    const items = await growthContext(user, chat)
    assert.ok(items.some(i => i.id === poster.id && i.status === 'active'), 'refusal: poster preserved')
  }

  // Cognitive lapse: not an erase instruction.
  {
    const p = await prepare('我忘记了那次海报的具体交付记录。')
    outputs.push({ reply: '没关系，记不清很正常，我们一起理一下。' })
    const result = await engine(p.input)
    const response = await store.finishRun(p.run, p.staged, result.text, result.usage, p.input.signal)
    assert.equal(response.stateChange.memoryControl, null)
    assert.ok((await growthContext(user, chat)).some(i => i.id === poster.id), 'lapse: nothing forgotten')
  }

  // Pure control command: deterministic zero-model path — no scripted output
  // exists for these turns; a model call would leave outputs unconsumed.
  {
    const p = await prepare('请忘掉我的海报排版打印记录二。')
    const fresh = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '我的海报排版打印记录二' })
    const p2 = await prepare('请忘掉我的海报排版打印记录二。')
    const result = await engine(p2.input)
    assert.equal((result.usage as any).llmCallCount, 0, 'pure control: zero provider calls')
    assert.match(result.text, /已遗忘/)
    const response = await store.finishRun(p2.run, p2.staged, result.text, result.usage, p2.input.signal)
    assert.equal((response.stateChange.memoryControl as any)?.status, 'executed')
    assert.ok(!(await growthContext(user, chat)).some(i => i.id === fresh.id), 'pure forget committed')
    void p
  }

  // pause_use: commits a REAL boundary — data retained, excluded from
  // evidence, readable in the boundary context and via GET.
  {
    const p = await prepare('别再用我的海报经历作为建议依据，记录保留。')
    const result = await engine(p.input)
    const response = await store.finishRun(p.run, p.staged, result.text, result.usage, p.input.signal)
    assert.equal(response.stateChange.memoryControl?.status, 'executed')
    assert.equal(response.stateChange.memoryControl?.kind, 'pause_use')
    assert.equal((response.stateChange.memoryControl as any)?.boundary, 'paused')
    assert.equal((response.stateChange.memoryControl as any)?.itemId, poster.id)
    const active = await growthContext(user, chat)
    const boundaries = await growthBoundaryContext(user, chat)
    assert.ok(!active.some(i => i.id === poster.id), 'pause: excluded from active evidence')
    const paused = boundaries.find(i => i.id === poster.id)
    assert.ok(paused && paused.status === 'paused' && paused.text === '我的海报经历记录', 'pause: text retained, boundary readable')
    // GET after commit is stable and shows the same receipt.
    const status = await store.runStatus(user, p.run.request_id)
    assert.equal(status.status, 'completed')
    assert.equal((status.response as any).stateChange.memoryControl.status, 'executed')
    // New conversation: the paused record is a boundary, not evidence.
    const active2 = await growthContext(user, chat2)
    assert.ok(!active2.some(i => i.id === poster.id), 'new conversation: paused record is not evidence')
    assert.ok((await growthBoundaryContext(user, chat2)).some(i => i.id === poster.id), 'new conversation: boundary readable')
  }

  // stop_recommend: a DIFFERENT durable boundary from pause_use — the fact
  // stays ACTIVE for understanding in this AND new conversations, while a
  // user-scoped recommendation control blocks proactive suggestions.
  {
    const p = await prepare('不要再推荐公众号那件事。')
    const result = await engine(p.input)
    const response = await store.finishRun(p.run, p.staged, result.text, result.usage, p.input.signal)
    const receipt = response.stateChange.memoryControl as any
    assert.equal(receipt?.kind, 'stop_recommend')
    assert.equal(receipt?.boundary, 'recommendation_stopped')
    const kept = (await growthContext(user, chat)).find(i => i.id === newsletter.id)
    assert.ok(kept && kept.status === 'active', 'stop_recommend: fact stays ACTIVE for understanding')
    const controls = await import('../../server/memory-controls.ts')
    const stopped = await controls.readRecommendationControls(user)
    assert.ok(stopped.some(row => row.itemId === newsletter.id && row.state === 'stopped'), 'recommendation boundary persisted')
    const active2 = await growthContext(user, chat2)
    assert.ok(active2.some(i => i.id === newsletter.id && (i as any).recommendationStopped === true), 'new conversation: fact active AND flagged not-recommended')
    assert.ok(!(await growthBoundaryContext(user, chat2)).some(i => i.id === newsletter.id), 'stop_recommend is NOT the paused-evidence boundary')
    await controls.resumeRecommendationControl(user, newsletter.id, { requestId: randomUUID() })
    assert.equal((await controls.readRecommendationControls(user)).length, 0, 'resume clears the boundary')
  }

  // Explicit unique forget: full commit + receipt + refresh + new session.
  {
    const fresh = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '我的海报排版打印记录' })
    const p = await prepare('请忘掉我的海报排版打印记录。')
    const result = await engine(p.input)
    const stagedAudit = p.staged.audit.filter((a: any) => a?.phase === 'memory_control_staged')
    assert.equal(stagedAudit.length, 1, 'control staged during validation, not executed')
    const response = await store.finishRun(p.run, p.staged, result.text, result.usage, p.input.signal)
    assert.equal(response.stateChange.memoryControl?.status, 'executed')
    assert.equal(response.stateChange.memoryControl?.kind, 'forget')
    assert.equal((response.stateChange.memoryControl as any)?.boundary, 'purged')
    assert.ok(!(await growthContext(user, chat)).some(i => i.id === fresh.id), 'forget: record gone from evidence')
    assert.ok(!(await growthContext(user, chat2)).some(i => i.id === fresh.id), 'forget: gone in a new conversation too')
    const refreshed = await store.listConversations(user)
    const conversation = refreshed.find(c => c.id === chat)!
    const receiptMessage = (conversation.messages as any[]).find(m => m.role === 'assistant' && m.run_request_id === p.run.request_id)
    assert.ok(receiptMessage?.stateChange?.memoryControl?.status === 'executed', 'refresh: receipt attached to its own assistant message')
  }

  // Mixed feedback + forget in ONE message: both commit in the same finishRun.
  {
    const poster2 = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '我的海报经历记录二' })
    const p = await prepare('学长反馈公众号排版主要是轮值负责。顺便忘掉海报经历记录二。')
    outputs.push({ reply: '已记录反馈；海报记录已遗忘。', growthUpdates: [{ target: { operation: 'create' }, kind: 'context', assertion: 'user_reported', source: { clauseId: 'c0' } }] })
    const result = await engine(p.input)
    const response = await store.finishRun(p.run, p.staged, result.text, result.usage, p.input.signal)
    assert.equal(response.stateChange.memoryControl?.kind, 'forget')
    assert.equal((response.stateChange.memoryControl as any)?.itemId, poster2.id, 'control-clause target only')
    assert.ok(response.stateChange.growth.createdIds.length === 1, 'independent new feedback saved in the same transaction')
    const items = await growthContext(user, chat)
    assert.ok(!items.some(i => i.id === poster2.id), 'mixed: poster forgotten')
    assert.ok(items.some(i => i.text.includes('轮值负责')), 'mixed: newsletter feedback kept')
  }

  // Ambiguity: durable pending request; confirm executes; other users cannot.
  {
    const similarA = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '海报排版是我负责的' })
    const similarB = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '海报打印是我负责的' })
    const p = await prepare('忘掉海报那条记录。')
    const result = await engine(p.input)
    const response = await store.finishRun(p.run, p.staged, result.text, result.usage, p.input.signal)
    const receipt = response.stateChange.memoryControl as any
    assert.equal(receipt?.status, 'needs_confirmation')
    assert.equal(receipt.candidates.length, 2, 'both similar records offered')
    const listed = await listControlRequests(user, chat)
    assert.equal(listed.filter(row => row.status === 'pending').length, 1, 'pending request persisted and readable')
    // A different user must not resolve it.
    const other = 'p6-other-' + randomUUID()
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())', [other, other + '@example.invalid'])
    const id = listed.find(row => row.status === 'pending')!.id
    await assert.rejects(resolveControlRequest(other, id, { requestId: randomUUID(), action: 'cancel' }), (error: any) => error.status === 404)
    // Confirm one candidate through the real action contract.
    const confirmed = await resolveControlRequest(user, id, { requestId: randomUUID(), action: 'confirm', itemId: similarA.id })
    assert.equal(confirmed.result?.status, 'executed')
    assert.equal(confirmed.result?.itemId, similarA.id)
    assert.ok(!(await growthContext(user, chat)).some(i => i.id === similarA.id), 'confirmed candidate forgotten')
    assert.ok((await growthContext(user, chat)).some(i => i.id === similarB.id), 'unselected similar record kept')
    await assert.rejects(resolveControlRequest(user, id, { requestId: randomUUID(), action: 'cancel' }), (error: any) => error.code === 'CONTROL_REQUEST_ALREADY_DECIDED', 'decided request cannot be re-decided')
    await pool.query('DELETE FROM growth_control_requests WHERE user_id=$1', [other]).catch(() => {})
    await pool.query('DELETE FROM "user" WHERE id=$1', [other])
  }

  // Real action failure: a concurrent revision bump between engine and
  // finishRun fails the WHOLE run — nothing commits, nothing is hidden.
  {
    const target = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '我的比赛准备记录' })
    const p = await prepare('请忘掉我的比赛准备记录。')
    const result = await engine(p.input)
    assert.equal(p.staged.memoryControl?.itemId, target.id, 'control staged against the read revision')
    await pool.query('UPDATE growth_items SET revision=revision+1 WHERE user_id=$1 AND id=$2', [user, target.id])
    await assert.rejects(store.finishRun(p.run, p.staged, result.text, result.usage, p.input.signal), (error: any) => error.status === 409 && ['GROWTH_REVISION_CONFLICT', 'GROWTH_SNAPSHOT_INVALIDATED'].includes(error.code), 'concurrent external change fails the whole run with a 409')
    await store.terminateRun(user, p.run.request_id, 'failed', 'GROWTH_REVISION_CONFLICT')
    const row = (await pool.query('SELECT text,status FROM growth_items WHERE user_id=$1 AND id=$2', [user, target.id])).rows[0]
    assert.equal(row.status, 'active', 'failed run: record untouched')
    assert.equal(row.text, '我的比赛准备记录', 'failed run: no content purge')
    const messages = (await pool.query("SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'", [user, p.run.request_id])).rows[0].n
    assert.equal(messages, 0, 'failed run: no assistant message saved')
  }

  // Post-control failure: turn 1's committed control stays visible when a
  // later turn fails.
  {
    const target = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '我的旧实习记录' })
    const p1 = await prepare('请忘掉我的旧实习记录。')
    const r1 = await engine(p1.input)
    const response1 = await store.finishRun(p1.run, p1.staged, r1.text, r1.usage, p1.input.signal)
    assert.equal(response1.stateChange.memoryControl?.status, 'executed')
    const p2 = await prepare('再帮我看看别的。')
    outputs.length = 0 // provider dies: no scripted output left
    await assert.rejects(engine(p2.input))
    await store.terminateRun(user, p2.run.request_id, 'failed', 'MODEL_REQUEST_FAILED')
    const status1 = await store.runStatus(user, p1.run.request_id)
    assert.equal((status1.response as any).stateChange.memoryControl.status, 'executed', 'earlier control receipt still readable after a later failure')
    assert.ok(!(await growthContext(user, chat)).some(i => i.id === target.id), 'control effect persists after later failure')
  }

  // Cancellation: abort before finishRun commits nothing.
  {
    const target = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '我的志愿时长记录' })
    const controller = new AbortController()
    const started = await store.startRun(user, chat, randomUUID(), '请忘掉我的志愿时长记录。')
    const staged: store.Staged = { candidates: [], audit: [] }
    const input = { run: started.run, staged, context: await store.contextForRun(started.run), decision: null, signal: controller.signal, emit: () => {} }
    const result = await engine(input)
    controller.abort()
    await assert.rejects(store.finishRun(started.run, staged, result.text, result.usage, controller.signal), (error: any) => error.code === 'RUN_NO_LONGER_ACTIVE' || error.name === 'AbortError')
    await store.terminateRun(user, started.run.request_id, 'cancelled', 'USER_CANCELLED')
    assert.ok((await growthContext(user, chat)).some(i => i.id === target.id), 'cancelled run: nothing forgotten')
  }

  // Same-request replay: identical requestId replays the stored response —
  // the control is not executed a second time.
  {
    const target = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '我的社团值班记录' })
    const requestId = randomUUID()
    const first = await store.startRun(user, chat, requestId, '请忘掉我的社团值班记录。')
    const staged: store.Staged = { candidates: [], audit: [] }
    const engineInput = { run: first.run, staged, context: await store.contextForRun(first.run), decision: null, signal: new AbortController().signal, emit: () => {} }
    const result = await engine(engineInput)
    const response = await store.finishRun(first.run, staged, result.text, result.usage, engineInput.signal)
    assert.equal(response.stateChange.memoryControl?.status, 'executed')
    const operationsBefore = (await pool.query('SELECT count(*)::int AS n FROM growth_operations WHERE user_id=$1', [user])).rows[0].n
    const replay = await store.startRun(user, chat, requestId, '请忘掉我的社团值班记录。')
    assert.equal(replay.replay, true, 'same requestId replays instead of re-running')
    const replayed = await store.validRunResponse(user, requestId, (replay.run as any).response)
    assert.equal((replayed as any).stateChange.memoryControl.status, 'executed', 'replayed response carries the same receipt')
    const operationsAfter = (await pool.query('SELECT count(*)::int AS n FROM growth_operations WHERE user_id=$1', [user])).rows[0].n
    assert.equal(operationsAfter, operationsBefore, 'replay performed no second growth operation')
    void target
  }
})
