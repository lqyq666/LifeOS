import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { createTurnEngine } from '../../server/agent.ts'
import { model } from '../../server/model.ts'
import { config } from '../../server/config.ts'
import { createGrowthItem } from '../../server/growth.ts'
import { splitGrowthByCurrentTopic } from '../../server/growth-selection.ts'
import { localEmbedding } from '../../server/local-embedding.ts'

// P6 closeout B2: the current matter must not be answered with an old,
// lexically-adjacent record. Coverage-based grouping puts the record ABOUT the
// current message into growth and the rest into growthBackground, with an
// explicit prompt rule that old records compare but never substitute. Same
// shape verified across research/course and two-club vocabulary so the fix is
// not poster-specific.

const mk = (id: string, text: string) => ({ id, conversationId: 'c', kind: 'context', text, assertion: 'user_reported', status: 'active', sources: [], dependencies: [], unavailableReason: null, validFrom: null, validUntil: null, timeBasis: null, revision: 1, createdAt: '', updatedAt: '', limitation: '', progressState: null, directionScopes: [], structuredPlan: null } as never)

test('B2 pure: coverage grouping separates current matter from adjacent old records', () => {
  const ask = '学校广播站又在招校园主播运营，每周大概4小时，我要不要去试试？'
  const { currentTopic, background } = splitGrowthByCurrentTopic([
    mk('streamer', '我上学期在广播站做过校园主播，每周四小时'),
    mk('newsletter', '我在公众号实习，每周投入十小时做内容策划'),
    mk('poster', '那张海报的设计主要是队友做的'),
  ], ask)
  assert.deepEqual(currentTopic.map(item => item.id), ['streamer'], 'the record ABOUT the current matter is grouped as current')
  assert.deepEqual(background.map(item => item.id).sort(), ['newsletter', 'poster'], 'adjacent-but-different records stay background')
  // Research/course pair.
  const research = splitGrowthByCurrentTopic([mk('lab', '我在导师课题组做文献整理，每两周一次组会'), mk('course', '我的数据库课程设计是三人小组做的')], '课题组下学期要新开组会带本科生，我要不要报名参加？')
  assert.deepEqual(research.currentTopic.map(item => item.id), ['lab'])
  assert.deepEqual(research.background.map(item => item.id), ['course'])
  // Two distinct clubs.
  const clubs = splitGrowthByCurrentTopic([mk('anime', '我在动漫社负责每周例会的场地预约'), mk('debate', '我参加过校辩论队的选拔但没进队')], '动漫社这学期想让我做社长，我有点犹豫要不要接？')
  assert.deepEqual(clubs.currentTopic.map(item => item.id), ['anime'])
  assert.deepEqual(clubs.background.map(item => item.id), ['debate'])
  // A time-budget record stays available as background — never dropped.
  const budget = splitGrowthByCurrentTopic([mk('budget', '我每周有六小时可以做项目')], ask)
  assert.deepEqual(budget.background.map(item => item.id), ['budget'])
})

test('B2 engine: prompt carries the split with the full set still staged', async () => {
  await localEmbedding.start()
  const bodies: string[] = []
  const engine = createTurnEngine({ capabilityVerified: () => true })
  const fake = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'))
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const base = { id: 'p6-b2', object: 'chat.completion.chunk', created: 1, model: model.id }
      const output = { reply: '先看这个主播机会本身：每周4小时的运营，结合你做过的校园主播经历可以直接核对。' }
      res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: null }] }) + '\n\n')
      res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280, prompt_tokens_details: { cached_tokens: 0 } } }) + '\n\ndata: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', r))
  const prevURL = model.baseUrl, prevKey = config.apiKey
  model.baseUrl = 'http://127.0.0.1:' + (fake.address() as { port: number }).port
  config.apiKey = 'synthetic-p6-b2-key-1234567890'
  const user = 'p6-b2-' + randomUUID(), chat = randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())', [user, user + '@example.invalid'])
  await store.createConversation(user, { id: chat, title: 'SYNTHETIC B2' })
  await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1) ON CONFLICT (user_id) DO UPDATE SET enabled=true', [user])
  try {
    const streamer = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '我上学期在广播站做过校园主播，每周四小时' })
    const newsletter = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '我在公众号实习，每周投入十小时做内容策划' })
    await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'context', text: '那张海报的设计主要是队友做的' })
    const started = await store.startRun(user, chat, randomUUID(), '学校广播站又在招校园主播运营，每周大概4小时，我要不要去试试？')
    const staged: store.Staged = { candidates: [], audit: [] }
    const result = await engine({ run: started.run, staged, context: await store.contextForRun(started.run), decision: null, signal: new AbortController().signal, emit: () => {} })
    await store.finishRun(started.run, staged, result.text, result.usage, new AbortController().signal)
    assert.equal(bodies.length, 1)
    const body = JSON.parse(bodies[0]!)
    const userContent = [...body.messages].reverse().map((m: any) => typeof m.content === 'string' ? m.content : '').find((t: string) => t.includes('authorizedContext') || t.includes('currentUserMessage')) ?? ''
    const envelope = JSON.parse(userContent)
    const context = envelope.authorizedContext ?? envelope
    const growthIds = (context.growth as { id: string }[]).map(item => item.id)
    const backgroundIds = (context.growthBackground as { id: string }[]).map(item => item.id)
    assert.ok(growthIds.includes(streamer.id), 'current-matter record in growth')
    assert.ok(!growthIds.includes(newsletter.id), 'old adjacent record not presented as current matter')
    assert.ok(backgroundIds.includes(newsletter.id), 'old adjacent record still available as background')
    assert.equal(backgroundIds.length, 2, 'newsletter and poster both stay in background')
    const system = typeof body.messages?.[0]?.content === 'string' ? body.messages[0].content : String(body.system ?? '')
    const systemText = [system, String(body.system ?? '')].join(' ')
    assert.ok(systemText.includes('growthBackground'), 'system prompt names the grouping contract')
    assert.ok(systemText.includes('不得把旧经历的对象、时长或内容当作当前机会的答案'), 'system prompt states the no-substitution rule')
    const split = staged.audit.filter((a: any) => a?.phase === 'growth_topic_split') as any[]
    assert.equal(split.length, 1)
    assert.equal(split[0].currentTopic, 1)
    assert.equal(split[0].background, 2)
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
