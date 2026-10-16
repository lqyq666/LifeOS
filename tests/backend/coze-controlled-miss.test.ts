import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { createTurnEngine } from '../../server/agent.ts'
import { model } from '../../server/model.ts'
import { config } from '../../server/config.ts'
import { campusReferenceCards } from '../../server/campus-reference-data.ts'
import { importKnowledge } from '../../server/campus-knowledge.ts'
import { localEmbedding } from '../../server/local-embedding.ts'

// P6 closeout C1 (free/isolated layer): local-first discipline and the
// CONTROLLED local-miss diagnostic. A local hit never touches Coze; the
// diagnostic flag forces the local candidates to miss while the verified
// registry stays intact, labeled as controlled integration in the audit. The
// real remote network runs in the separately labeled C1 harness, not here.

test('C1 local hit skips Coze; controlled diagnostic miss is labeled and never silent', async () => {
  await localEmbedding.start()
  const imported = await importKnowledge(campusReferenceCards)
  assert.ok(imported.changed > 0, 'reference cards seeded in the isolated database')
  const outputs: unknown[] = []
  const engine = createTurnEngine({ capabilityVerified: () => true })
  const fake = createServer((req, res) => {
    req.on('data', () => {}); req.on('end', () => {
      const output = outputs.shift()
      if (output === undefined) { res.writeHead(500); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const base = { id: 'p6-c1', object: 'chat.completion.chunk', created: 1, model: model.id }
      res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: null }] }) + '\n\n')
      res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280, prompt_tokens_details: { cached_tokens: 0 } } }) + '\n\ndata: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', r))
  const prevURL = model.baseUrl, prevKey = config.apiKey
  model.baseUrl = 'http://127.0.0.1:' + (fake.address() as { port: number }).port
  config.apiKey = 'synthetic-p6-c1-key-1234567890'
  const user = 'p6-c1-' + randomUUID(), chat = randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())', [user, user + '@example.invalid'])
  await store.createConversation(user, { id: chat, title: 'SYNTHETIC C1' })
  const prepare = async (text: string) => {
    const started = await store.startRun(user, chat, randomUUID(), text)
    const staged: store.Staged = { candidates: [], audit: [] }
    return { run: started.run, staged, input: { run: started.run, staged, context: await store.contextForRun(started.run), decision: null, signal: new AbortController().signal, emit: () => {} } }
  }
  const ask = '期末复习怎么安排更有效，集中突击还是分散复习？'
  try {
    // Local hit: knowledge found, no Coze phase in the audit at all.
    {
      const p = await prepare(ask)
      outputs.push({ reply: '先把团队产出和你负责的部分分开写。' })
      const result = await engine(p.input)
      await store.finishRun(p.run, p.staged, result.text, result.usage, p.input.signal)
      const phases = p.staged.audit.map((a: any) => a?.phase)
      assert.ok(!phases.some(phase => String(phase).startsWith('coze_')), 'local hit never touches the remote transport')
      assert.ok(!phases.includes('local_knowledge_miss'), 'no diagnostic miss without the flag')
    }
    // Controlled miss: the flag suppresses the local candidates, the audit
    // says so explicitly, and the (unconfigured) transport skip is recorded.
    {
      const before = config.diagLocalKnowledgeMiss
      config.diagLocalKnowledgeMiss = true
      try {
        const p = await prepare(ask)
        outputs.push({ reply: '先把团队产出和你负责的部分分开写。' })
        const result = await engine(p.input)
        await store.finishRun(p.run, p.staged, result.text, result.usage, p.input.signal)
        const miss = p.staged.audit.find((a: any) => a?.phase === 'local_knowledge_miss') as any
        assert.ok(miss, 'diagnostic miss recorded')
        assert.equal(miss.reason, 'diagnostic_injection')
        assert.equal(miss.controlledIntegrationOnly, true)
        assert.ok(miss.localCandidatesSuppressed > 0, 'the registry cards were intact — the miss was forced, not emptied')
        const skipped = p.staged.audit.find((a: any) => a?.phase === 'coze_knowledge_skipped') as any
        assert.ok(skipped && skipped.reason === 'disabled_by_default', 'unconfigured transport skip stays explicit')
      } finally { config.diagLocalKnowledgeMiss = before }
    }
  } finally {
    model.baseUrl = prevURL; config.apiKey = prevKey
    await new Promise<void>(d => fake.close(() => d()))
    try { await localEmbedding.close() } catch {}
    await pool.query('DELETE FROM coach_reply_sources WHERE user_id=$1', [user]).catch(() => {})
    await pool.query('DELETE FROM growth_control_requests WHERE user_id=$1', [user]).catch(() => {})
    await pool.query('DELETE FROM growth_source_suppressions WHERE user_id=$1', [user]).catch(() => {})
    await pool.query('DELETE FROM growth_item_lineage WHERE user_id=$1', [user]).catch(() => {})
    await pool.query('DELETE FROM growth_items WHERE user_id=$1', [user]).catch(() => {})
    await pool.query('DELETE FROM growth_revisions WHERE user_id=$1', [user]).catch(() => {})
    await pool.query('DELETE FROM growth_operations WHERE user_id=$1', [user]).catch(() => {})
    await pool.query('DELETE FROM runs WHERE user_id=$1', [user])
    await pool.query('DELETE FROM messages WHERE user_id=$1', [user])
    await pool.query('DELETE FROM conversations WHERE user_id=$1', [user])
    await pool.query('DELETE FROM "user" WHERE id=$1', [user])
  }
})

test.after(async () => { await pool.end() })
