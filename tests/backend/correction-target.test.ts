import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { createTurnEngine } from '../../server/agent.ts'
import { model } from '../../server/model.ts'
import { config } from '../../server/config.ts'
import { growthContext, growthView } from '../../server/growth.ts'
import { localEmbedding } from '../../server/local-embedding.ts'

// P6 closeout B1: a correction must land on the RIGHT object. The real T6
// failure: the poster correction replaced the unrelated “还不确定” item. Now
// the scored target is authoritative — a wrong-but-authorized model target is
// redirected; with no matching old object the correction is a grounded create
// and the unrelated record stays untouched.

test('B1 correction target: converted create (T6 replay), redirect, kept', async () => {
  await localEmbedding.start()
  const outputs: unknown[] = []
  const engine = createTurnEngine({ capabilityVerified: () => true })
  const fake = createServer((req, res) => {
     req.on('data', () => {}); req.on('end', () => {
      const output = outputs.shift()
      if (output === undefined) { res.writeHead(500); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const base = { id: 'p6-b1', object: 'chat.completion.chunk', created: 1, model: model.id }
      res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: null }] }) + '\n\n')
      res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280, prompt_tokens_details: { cached_tokens: 0 } } }) + '\n\ndata: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', r))
  const prevURL = model.baseUrl, prevKey = config.apiKey
  model.baseUrl = 'http://127.0.0.1:' + (fake.address() as { port: number }).port
  config.apiKey = 'synthetic-p6-b1-key-1234567890'
  const user = 'p6-b1-' + randomUUID(), chat = randomUUID(), chatLater = randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())', [user, user + '@example.invalid'])
  await store.createConversation(user, { id: chat, title: 'SYNTHETIC B1' })
  await store.createConversation(user, { id: chatLater, title: 'SYNTHETIC B1-later' })
  await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1) ON CONFLICT (user_id) DO UPDATE SET enabled=true', [user])
  const prepare = async (text: string, conv = chat) => {
    await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_TEST_CLEANUP',finished_at=now() WHERE user_id=$1 AND status='running'", [user])
    const started = await store.startRun(user, conv, randomUUID(), text)
    const staged: store.Staged = { candidates: [], audit: [] }
    return { run: started.run, staged, input: { run: started.run, staged, context: await store.contextForRun(started.run), decision: null, signal: new AbortController().signal, emit: () => {} } }
  }
  const turn = async (text: string, makeOutput: (messageId: string) => unknown, conv = chat) => {
    const p = await prepare(text, conv)
    outputs.push(makeOutput(p.run.source_message_id))
    const result = await engine(p.input)
    const response = await store.finishRun(p.run, p.staged, result.text, result.usage, p.input.signal)
    return { response, staged: p.staged, run: p.run }
  }
  try {
    // T2 shape: the uncertainty item exists and is active.
    const t2 = await turn('还不确定。', messageId => ({ reply: '好的，先不确定。', growthUpdates: [{ target: { operation: 'create' }, kind: 'context', assertion: 'user_reported', source: { messageId, quote: '还不确定' } }] }))
    void t2
    const view0 = await growthView(user, chat)
    const uncertainty = view0.items.find(item => item.text === '还不确定')
    assert.ok(uncertainty && uncertainty.status === 'active', 'uncertainty item exists before the correction')

    // T6 replay: poster correction; the model wrongly targets the uncertainty
    // item. No poster fact exists, so the correction must become a grounded
    // create — the uncertainty record is NOT overwritten.
    const t6 = await turn('更正一下：那张海报的设计主要是队友做的，我只负责了排版和打印。', messageId => ({
      reply: '好的，已记录你的海报分工：设计主要是队友做的，你负责排版和打印。',
      growthUpdates: [{ target: { operation: 'replace', itemId: uncertainty.id, expectedRevision: uncertainty.revision }, kind: 'context', assertion: 'user_reported', source: { messageId, quote: '我只负责了排版和打印' } }],
    }))
    const normalization = t6.staged.audit.filter((a: any) => a?.phase === 'correction_target_normalized') as any[]
    assert.equal(normalization.length, 1)
    assert.equal(normalization[0].mode, 'converted_to_create', 'no old object: converted to a grounded create')
    assert.equal(normalization[0].modelTarget, uncertainty.id, 'the model did aim at the uncertainty item')
    assert.equal(normalization[0].scoredTarget, null)
    const afterT6 = await growthView(user, chat)
    const uncertaintyAfter = afterT6.items.find(item => item.id === uncertainty.id)
    assert.ok(uncertaintyAfter && uncertaintyAfter.status === 'active' && uncertaintyAfter.text === '还不确定' && uncertaintyAfter.revision === uncertainty.revision, 'uncertainty item untouched by the poster correction')
    const created = afterT6.items.find(item => item.text === '我只负责了排版和打印')
    assert.ok(created && created.status === 'active' && created.assertion === 'user_reported', 'poster contribution grounded as a NEW fact from the verified quote')
    assert.ok((t6.response.stateChange.growth.createdIds as string[]).includes(created.id), 'receipt reports the create, not a replace')

    // Redirect: the scored target wins over a wrong-but-authorized model target.
    const major = await turn('我是大三，读市场营销。', messageId => ({ reply: '记下了。', growthUpdates: [{ target: { operation: 'create' }, kind: 'context', assertion: 'user_reported', source: { messageId, quote: '我是大三，读市场营销' } }] }))
    void major
    const stray = await turn('我还不确定毕业方向。', messageId => ({ reply: '好的。', growthUpdates: [{ target: { operation: 'create' }, kind: 'context', assertion: 'user_reported', source: { messageId, quote: '我还不确定毕业方向' } }] }))
    void stray
    const before = await growthView(user, chat)
    const majorItem = before.items.find(item => item.text === '我是大三，读市场营销')!
    const strayItem = before.items.find(item => item.text === '我还不确定毕业方向')!
    const corrected = await turn('更正一下：我是大二，刚才说成大三了。', messageId => ({
      reply: '已更正为大二。',
      growthUpdates: [{ target: { operation: 'replace', itemId: strayItem.id, expectedRevision: strayItem.revision }, kind: 'context', assertion: 'user_reported', source: { messageId, quote: '我是大二' } }],
    }))
    const redirect = (corrected.staged.audit.filter((a: any) => a?.phase === 'correction_target_normalized') as any[])[0]
    assert.equal(redirect.mode, 'redirected', 'wrong-but-authorized target redirected to the scored one')
    assert.equal(redirect.modelTarget, strayItem.id)
    assert.equal(redirect.scoredTarget, majorItem.id)
    assert.equal(redirect.finalTarget, majorItem.id)
    const afterRedirect = await growthView(user, chat)
    assert.ok(!afterRedirect.items.some(item => item.id === majorItem.id && item.status === 'active'), 'old major fact no longer active (split stale parent)')
    assert.ok(afterRedirect.items.some(item => item.text === '我是大二' && item.status === 'active'), 'corrected fact active')
    const strayAfter = afterRedirect.items.find(item => item.id === strayItem.id)
    assert.ok(strayAfter && strayAfter.text === '我还不确定毕业方向', 'unrelated record untouched')

    // Kept: a model already aiming at the scored target is not redirected.
    const budget = await turn('我每周有六小时可以做项目。', messageId => ({ reply: '记下了。', growthUpdates: [{ target: { operation: 'create' }, kind: 'context', assertion: 'user_reported', source: { messageId, quote: '我每周有六小时可以做项目' } }] }))
    void budget
    const beforeBudget = await growthView(user, chat)
    const budgetItem = beforeBudget.items.find(item => item.text === '我每周有六小时可以做项目')!
    const kept = await turn('更正一下：我每周有四小时，刚才说成六小时了。', messageId => ({
      reply: '已更正为四小时。',
      growthUpdates: [{ target: { operation: 'replace', itemId: budgetItem.id, expectedRevision: budgetItem.revision }, kind: 'context', assertion: 'user_reported', source: { messageId, quote: '我每周有四小时' } }],
    }))
    const keptAudit = (kept.staged.audit.filter((a: any) => a?.phase === 'correction_target_normalized') as any[])[0]
    assert.equal(keptAudit.mode, 'kept', 'correct model target kept as-is')
    assert.ok((await growthContext(user, chat)).some(item => item.text === '我每周有四小时'), 'budget replaced in place')
    // New conversation reads the corrected facts, not the overwritten ones.
    const later = await growthContext(user, chatLater)
    assert.ok(later.some(item => item.text === '我是大二'), 'new conversation: corrected major readable')
    assert.ok(!later.some(item => item.text === '我是大三，读市场营销' && !item.unavailableReason), 'new conversation: superseded major not active')
  } finally {
    model.baseUrl = prevURL; config.apiKey = prevKey
    await new Promise<void>(d => fake.close(() => d()))
    try { await localEmbedding.close() } catch {}
    for (const table of ['growth_control_requests', 'growth_source_suppressions', 'growth_item_lineage', 'growth_items', 'growth_revisions', 'growth_operations', 'user_memory_settings']) await pool.query(`DELETE FROM ${table} WHERE user_id=$1`, [user]).catch(() => {})
    await pool.query('DELETE FROM coach_reply_sources WHERE user_id=$1', [user]).catch(() => {})
    await pool.query('DELETE FROM runs WHERE user_id=$1', [user])
    await pool.query('DELETE FROM messages WHERE user_id=$1', [user])
    await pool.query('DELETE FROM conversations WHERE user_id=$1', [user])
    await pool.query('DELETE FROM "user" WHERE id=$1', [user])
  }
})

test.after(async () => { await pool.end() })
