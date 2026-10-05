import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { stageCoachEvent, coachEventView } from '../../server/action-coach-events.ts'
import type { EventDelta } from '../../server/action-coach-contracts.ts'

// Regressions built from the saved real outputs of coach-8817402e (A01) and
// coach-46fba1bf (A05): a coaching question is not a deliverable, a tolerated
// duplicate re-emission must not swallow substantive new user input, and
// cross-event or wrong-version identities stay server-rejected.
async function prepare(text: string) {
  const user = 'material-boundary-' + randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())', [user, user + '@example.invalid'])
  const conversation = randomUUID()
  await store.createConversation(user, { id: conversation, title: 'SYNTHETIC material boundary' })
  const run = (await store.startRun(user, conversation, randomUUID(), text)).run
  return { user, conversation, run, signal: new AbortController().signal }
}
async function createEvent(run: store.Run, quote: string, title = 'SYNTHETIC 事件') {
  const staged = await stageCoachEvent(run, { target: { operation: 'create', title, source: { messageId: run.source_message_id, quote } } }, '已记录。')
  await store.finishRun(run, { candidates: [], audit: [], coach: staged }, '已记录。', null, new AbortController().signal)
  return (await coachEventView(run.user_id, run.conversation_id))!
}

test('a requested one-line question message is a legal create even when it equals the whole reply, while assistant follow-up questions never become material', async () => {
  // A01 turn-3 shape: entire reply (a question to the user) became the created material.
  const q = '三小时整理四十页，投入挺大的。你整理好之后是怎么给小林的？他当时有说什么吗？'
  const opening = await prepare('我做了上次的行动，但对方没有使用。')
  const asked = await prepare('同学说资料打不开没看。只给我一句发给他的消息。')
  const seeded = await prepare('同学说资料乱，我没问具体需要，就花三小时整理四十页，考试前夜发了网盘。他说手机打不开，所以没看。我不知道他现在还要不要，请直接帮我写一段微信消息。')
  try {
    await assert.rejects(
      stageCoachEvent(opening.run, { target: { operation: 'create', title: '整理后未使用', source: { messageId: opening.run.source_message_id, quote: '我做了上次的行动，但对方没有使用。' } }, action: { operation: 'create', draft: { content: q } } }, q),
      (error: any) => error.code === 'COACH_MATERIAL_IS_CONVERSATION', 'A01 turn-3 real shape still rejected')
    // Same question as material, but this time behind a preamble: still conversation, not a deliverable.
    await assert.rejects(
      stageCoachEvent(opening.run, { target: { operation: 'create', title: '整理后未使用', source: { messageId: opening.run.source_message_id, quote: '我做了上次的行动，但对方没有使用。' } }, action: { operation: 'create', draft: { content: '你整理好之后是怎么给小林的？' } } }, '我们先了解一下：你整理好之后是怎么给小林的？'),
      (error: any) => error.code === 'COACH_MATERIAL_IS_CONVERSATION', 'preamble does not turn a follow-up question into material')
    // Paired legal case: the user explicitly asked for one sendable line; the
    // reply IS the question message and create is legitimate.
    const oneLine = '你现在还需要那份资料吗？不需要也没关系。'
    const legal = await stageCoachEvent(asked.run, { target: { operation: 'create', title: '确认资料需要', source: { messageId: asked.run.source_message_id, quote: '只给我一句发给他的消息。' } }, action: { operation: 'create', draft: { content: oneLine } } }, oneLine)
    await store.finishRun(asked.run, { candidates: [], audit: [], coach: legal }, oneLine, null, asked.signal)
    assert.equal((await coachEventView(asked.user, asked.conversation))!.actions[0]!.draft!.content, oneLine)
    // A05 turn-2 shape: a modify whose content equals the whole reply is a legal rewrite.
    const first = '嗨，之前整理的那份资料你后来能打开吗？如果还需要，我可以换个方式发你；不需要也没关系，不用特意回复。'
    const reply1 = '我帮你写一段，语气自然、不施压：\n\n' + first
    const created = await stageCoachEvent(seeded.run, { target: { operation: 'create', title: '确认资料需要', source: { messageId: seeded.run.source_message_id, quote: '请直接帮我写一段微信消息。' } }, action: { operation: 'create', draft: { content: first } } }, reply1)
    await store.finishRun(seeded.run, { candidates: [], audit: [], coach: created }, reply1, null, seeded.signal)
    const rewriteRun = (await store.startRun(seeded.user, seeded.conversation, randomUUID(), '再短一点，别显得在要求他反馈。')).run
    const event = (await coachEventView(rewriteRun.user_id, rewriteRun.conversation_id))!
    const short = '之前那份资料你方便看吗？不需要也没关系。'
    const rewritten = await stageCoachEvent(rewriteRun, { target: { operation: 'continue', eventId: event.id, expectedRevision: event.revision }, action: { operation: 'modify', actionId: event.actions[0]!.id, expectedRevision: event.actions[0]!.revision, draft: { content: short } } }, short)
    await store.finishRun(rewriteRun, { candidates: [], audit: [], coach: rewritten }, short, null, seeded.signal)
    const final = (await coachEventView(seeded.user, seeded.conversation))!
    assert.equal(final.actions[0]!.draft!.content, short)
    assert.equal(final.actions[0]!.revision, event.actions[0]!.revision + 1)
    // A fact-answer turn must not overwrite the deliverable with a question to the user.
    const pollutionRun = (await store.startRun(seeded.user, seeded.conversation, randomUUID(), '考试前夜把网盘链接发给了他。')).run
    await assert.rejects(
      stageCoachEvent(pollutionRun, { target: { operation: 'continue', eventId: final.id, expectedRevision: final.revision }, action: { operation: 'modify', actionId: final.actions[0]!.id, expectedRevision: final.actions[0]!.revision, draft: { content: '考试前夜发给他，这个时间点挺关键的。他当时有回复你吗？' } } }, '考试前夜发给他，这个时间点挺关键的。他当时有回复你吗？'),
      (error: any) => error.code === 'COACH_MATERIAL_IS_CONVERSATION', 'modify cannot overwrite material with a question on a fact-answer turn')
    await store.terminateRun(seeded.user, pollutionRun.request_id, 'cancelled', 'SYNTHETIC_DONE')
    assert.equal((await coachEventView(seeded.user, seeded.conversation))!.actions[0]!.draft!.content, short, 'deliverable untouched after rejected pollution')
  } finally { await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [[opening.user, asked.user, seeded.user]]) }
})

test('declining a draft never authorizes question material, while a separate positive request still does', async () => {
  const question = '他当时有回复你吗？'
  for (const text of ['不要帮我写消息，只想聊聊。', '不用写消息，先听我说。', '先别改写消息，只想聊聊。']) {
    const base = await prepare(text)
    try {
      const event = await createEvent(base.run, text)
      for (const operation of ['create', 'modify'] as const) {
        let current = (await coachEventView(base.user, base.conversation))!
        if (operation === 'modify') {
          const seed = (await store.startRun(base.user, base.conversation, randomUUID(), '帮我写一句消息。')).run
          const staged = await stageCoachEvent(seed, { target: { operation: 'continue', eventId: current.id, expectedRevision: current.revision }, action: { operation: 'create', draft: { content: '你好，我稍后把资料发给你。' } } }, '你好，我稍后把资料发给你。')
          await store.finishRun(seed, { candidates: [], audit: [], coach: staged }, staged.reply, null, base.signal)
          current = (await coachEventView(base.user, base.conversation))!
        }
        const run = (await store.startRun(base.user, base.conversation, randomUUID(), text)).run
        const action: NonNullable<EventDelta['action']> = operation === 'create'
          ? { operation, draft: { content: question } }
          : { operation, actionId: current.actions[0]!.id, expectedRevision: current.actions[0]!.revision, draft: { content: question } }
        await assert.rejects(stageCoachEvent(run, { target: { operation: 'continue', eventId: event.id, expectedRevision: current.revision }, action }, question), (error: any) => error.code === 'COACH_ACTION_DECLINED', operation + ': ' + text)
        await store.terminateRun(base.user, run.request_id, 'cancelled', 'SYNTHETIC_DONE')
        assert.deepEqual((await coachEventView(base.user, base.conversation))!.actions, current.actions, 'rejected question leaves material unchanged')
      }
    } finally { await pool.query('DELETE FROM "user" WHERE id=$1', [base.user]) }
  }
  for (const text of ['不用写长邮件，帮我写一句微信消息。', '特别想写一句给他的消息。', '不用重写，改短一点。']) {
    const initial = text.includes('改短') ? '帮我写一句消息。' : text
    const base = await prepare(initial)
    try {
      const material = '你现在还需要这份资料吗？'
      let run = base.run
      let delta: EventDelta = { target: { operation: 'create', title: '确认需求', source: { messageId: run.source_message_id, quote: initial } }, action: { operation: 'create', draft: { content: material } } }
      if (text.includes('改短')) {
        const first = await stageCoachEvent(run, { ...delta, action: { operation: 'create', draft: { content: '你好，我稍后把资料发给你。' } } }, '你好，我稍后把资料发给你。')
        await store.finishRun(run, { candidates: [], audit: [], coach: first }, first.reply, null, base.signal)
        const event = (await coachEventView(base.user, base.conversation))!
        run = (await store.startRun(base.user, base.conversation, randomUUID(), text)).run
        delta = { target: { operation: 'continue', eventId: event.id, expectedRevision: event.revision }, action: { operation: 'modify', actionId: event.actions[0]!.id, expectedRevision: event.actions[0]!.revision, draft: { content: material } } }
      }
      const staged = await stageCoachEvent(run, delta, material)
      await store.finishRun(run, { candidates: [], audit: [], coach: staged }, staged.reply, null, base.signal)
      assert.equal((await coachEventView(base.user, base.conversation))!.actions[0]!.draft!.content, material)
    } finally { await pool.query('DELETE FROM "user" WHERE id=$1', [base.user]) }
  }
})

test('question-shaped user evidence stays source-backed and is not mistaken for assistant material', async () => {
  const quote = '他问我现在还需要吗？'
  const base = await prepare(quote)
  try {
    const staged = await stageCoachEvent(base.run, { target: { operation: 'create', title: '需求确认', source: { messageId: base.run.source_message_id, quote } }, nodes: [{ kind: 'fact', source: { messageId: base.run.source_message_id, quote } }] }, '这句原话先保留。')
    await store.finishRun(base.run, { candidates: [], audit: [], coach: staged }, staged.reply, null, base.signal)
    const event = (await coachEventView(base.user, base.conversation))!
    assert.equal(event.nodes[0]!.content, quote)
    assert.equal(event.nodes[0]!.source!.quote, quote)
    assert.equal(event.actions.length, 0)
  } finally { await pool.query('DELETE FROM "user" WHERE id=$1', [base.user]) }
})

test('a stale re-emission never silently swallows unrecorded current input, however short, and even unstructured input stays traceable', async () => {
  const opening = await prepare('我做了上次的行动，但对方没有使用。')
  try {
    const event = await createEvent(opening.run, '我做了上次的行动，但对方没有使用。')
    const outcomeRun = (await store.startRun(opening.user, opening.conversation, randomUUID(), '他后来明确说手机打不开，因此没看。')).run
    const outcome = await stageCoachEvent(outcomeRun, { target: { operation: 'continue', eventId: event.id, expectedRevision: event.revision }, nodes: [{ kind: 'fact', source: { messageId: outcomeRun.source_message_id, quote: '他后来明确说手机打不开，因此没看。' } }] }, '先核对接触方式。')
    await store.finishRun(outcomeRun, { candidates: [], audit: [], coach: outcome }, '先核对接触方式。', null, opening.signal)
    let current = (await coachEventView(opening.user, opening.conversation))!
    // Short constraints must escalate exactly like the long agreement fact:
    // no character threshold decides whether new input matters.
    for (const [index, constraint] of ['只剩两小时', '不用联系了', '改成周五', '他拒绝了', '没约时间'].entries()) {
      const run = (await store.startRun(opening.user, opening.conversation, randomUUID(), constraint)).run
      await assert.rejects(
        stageCoachEvent(run, { target: { operation: 'continue', eventId: current.id, expectedRevision: current.revision }, nodes: [{ kind: 'fact', source: { messageId: run.source_message_id, quote: '他后来明确说手机打不开，因此没看。' } }] }, '收到。'),
        (error: any) => error.code === 'COACH_SOURCE_INVALID', 'short constraint must reach a repair: ' + constraint)
      const recorded = await stageCoachEvent(run, { target: { operation: 'continue', eventId: current.id, expectedRevision: current.revision }, nodes: [{ kind: 'fact', source: { messageId: run.source_message_id, quote: constraint } }] }, '已记录。')
      await store.finishRun(run, { candidates: [], audit: [], coach: recorded }, '已记录。', null, opening.signal)
      current = (await coachEventView(opening.user, opening.conversation))!
      assert.ok(current.nodes.some(node => node.content === constraint), 'constraint recorded as a node: ' + constraint)
    }
    // A01 turn-8 long agreement fact keeps the same behavior.
    const turn8 = (await store.startRun(opening.user, opening.conversation, randomUUID(), '没有明确约好交付时间和格式。')).run
    await assert.rejects(
      stageCoachEvent(turn8, { target: { operation: 'continue', eventId: current.id, expectedRevision: current.revision }, nodes: [{ kind: 'fact', source: { messageId: turn8.source_message_id, quote: '他后来明确说手机打不开，因此没看。' } }] }, '这个环节没有约定。'),
      (error: any) => error.code === 'COACH_SOURCE_INVALID')
    await store.terminateRun(opening.user, turn8.request_id, 'cancelled', 'SYNTHETIC_DONE')
    const repairedRun = (await store.startRun(opening.user, opening.conversation, randomUUID(), '没有明确约好交付时间和格式。')).run
    const repaired = await stageCoachEvent(repairedRun, { target: { operation: 'continue', eventId: current.id, expectedRevision: current.revision }, nodes: [{ kind: 'fact', source: { messageId: repairedRun.source_message_id, quote: '没有明确约好交付时间和格式。' } }] }, '已记录约定情况。')
    await store.finishRun(repairedRun, { candidates: [], audit: [], coach: repaired }, '已记录约定情况。', null, opening.signal)
    current = (await coachEventView(opening.user, opening.conversation))!
    assert.ok(current.nodes.some(node => node.content === '没有明确约好交付时间和格式。'))
    // Mere chatter with a stale re-emission also escalates; the repair may
    // legitimately drop the node entirely, and the turn still saves.
    const ackRun = (await store.startRun(opening.user, opening.conversation, randomUUID(), '好的，我明白了。')).run
    await assert.rejects(
      stageCoachEvent(ackRun, { target: { operation: 'continue', eventId: current.id, expectedRevision: current.revision }, nodes: [{ kind: 'fact', source: { messageId: ackRun.source_message_id, quote: '没有明确约好交付时间和格式。' } }] }, '好的。'),
      (error: any) => error.code === 'COACH_SOURCE_INVALID', 'chatter is not silently swallowed either')
    const ackStaged = await stageCoachEvent(ackRun, { target: { operation: 'continue', eventId: current.id, expectedRevision: current.revision } }, '好的。')
    await store.finishRun(ackRun, { candidates: [], audit: [], coach: ackStaged }, '好的。', null, opening.signal)
    const final = (await coachEventView(opening.user, opening.conversation))!
    assert.equal(final.nodes.filter(node => node.content === '没有明确约好交付时间和格式。').length, 1, 'node not duplicated')
    // Even when nothing is structured, the unrecorded current input remains
    // traceable through processTurns inputSources for the next turn.
    const unstructuredRun = (await store.startRun(opening.user, opening.conversation, randomUUID(), '时间很紧，只剩两小时。')).run
    const unstructured = await stageCoachEvent(unstructuredRun, { target: { operation: 'continue', eventId: final.id, expectedRevision: final.revision } }, '明白。')
    await store.finishRun(unstructuredRun, { candidates: [], audit: [], coach: unstructured }, '明白。', null, opening.signal)
    const traced = (await coachEventView(opening.user, opening.conversation))!
    const lastTurn = traced.processTurns?.at(-1)
    assert.ok(lastTurn?.inputSources?.some(source => source.quote.includes('只剩两小时')), 'unstructured constraint stays traceable in inputSources')
  } finally { await pool.query('DELETE FROM "user" WHERE id=$1', [opening.user]) }
})

test('cross-event identities and wrong revisions remain rejected even though schema enums union context events', async () => {
  const base = await prepare('我做了上次的行动，但对方没有使用。')
  try {
    const eventA = await createEvent(base.run, '我做了上次的行动，但对方没有使用。', '事件A')
    const runB = (await store.startRun(base.user, base.conversation, randomUUID(), '我联系小林问资料需求。')).run
    const stagedB = await stageCoachEvent(runB, { target: { operation: 'create', title: '事件B', source: { messageId: runB.source_message_id, quote: '我联系小林问资料需求。' } }, nodes: [{ kind: 'unknown', question: '当时你为什么决定联系小林？' }] }, '当时你为什么决定联系小林？')
    await store.finishRun(runB, { candidates: [], audit: [], coach: stagedB }, '当时你为什么决定联系小林？', null, base.signal)
    const eventB = (await coachEventView(base.user, base.conversation))!
    const unknownB = eventB.nodes.find(node => node.kind === 'unknown')!
    const runC = (await store.startRun(base.user, base.conversation, randomUUID(), '我又约了另一次交付。')).run
    const eventAFresh = (await coachEventView(base.user, base.conversation, eventA.id))!
    const target: EventDelta['target'] = { operation: 'continue', eventId: eventA.id, expectedRevision: eventAFresh.revision }
    await assert.rejects(stageCoachEvent(runC, { target, resolveUnknowns: [unknownB.id] }, '继续。'), (error: any) => error.code === 'COACH_UNKNOWN_NOT_FOUND', 'unknown of another event rejected')
    await assert.rejects(stageCoachEvent(runC, { target, corrections: [{ nodeId: unknownB.id, source: { messageId: runC.source_message_id, quote: '我又约了另一次交付。' } }] }, '继续。'), (error: any) => error.code === 'COACH_NODE_NOT_FOUND', 'cross-event correction rejected')
    await store.terminateRun(base.user, runC.request_id, 'cancelled', 'SYNTHETIC_DONE')
    const actionRun = (await store.startRun(base.user, base.conversation, randomUUID(), '请帮我写一句确认消息。')).run
    const withAction = await stageCoachEvent(actionRun, { target: { operation: 'continue', eventId: eventA.id, expectedRevision: (await coachEventView(base.user, base.conversation, eventA.id))!.revision }, action: { operation: 'create', draft: { content: '你现在还需要这份资料吗？不需要也没关系。' } } }, '可以使用这段：\n\n你现在还需要这份资料吗？不需要也没关系。')
    await store.finishRun(actionRun, { candidates: [], audit: [], coach: withAction }, '可以使用这段：\n\n你现在还需要这份资料吗？不需要也没关系。', null, base.signal)
    const eventWithAction = (await coachEventView(base.user, base.conversation, eventA.id))!
    const action = eventWithAction.actions[0]!
    const wrongRevision = (await store.startRun(base.user, base.conversation, randomUUID(), '把消息改短一点。')).run
    await assert.rejects(stageCoachEvent(wrongRevision, { target: { operation: 'continue', eventId: eventA.id, expectedRevision: eventWithAction.revision }, action: { operation: 'modify', actionId: action.id, expectedRevision: action.revision + 5, draft: { content: '还需要这份资料吗？' } } }, '还需要这份资料吗？'), (error: any) => error.code === 'COACH_ACTION_REVISION_CONFLICT', 'valid action id with wrong revision rejected')
    await store.terminateRun(base.user, wrongRevision.request_id, 'cancelled', 'SYNTHETIC_DONE')
  } finally { await pool.query('DELETE FROM "user" WHERE id=$1', [base.user]) }
})

test('a mid-run source withdrawal between staging and commit blocks the derived write (dedup path stays honest)', async () => {
  const base = await prepare('我做了上次的行动，但对方没有使用。')
  try {
    const event = await createEvent(base.run, '我做了上次的行动，但对方没有使用。')
    const turn = (await store.startRun(base.user, base.conversation, randomUUID(), '他后来明确说手机打不开，因此没看。')).run
    const staged = await stageCoachEvent(turn, { target: { operation: 'continue', eventId: event.id, expectedRevision: event.revision }, nodes: [{ kind: 'fact', source: { messageId: turn.source_message_id, quote: '他后来明确说手机打不开，因此没看。' } }] }, '先核对接触方式。')
    await pool.query('UPDATE coach_events SET revision=revision+1 WHERE user_id=$1 AND id=$2', [base.user, event.id])
    await assert.rejects(store.finishRun(turn, { candidates: [], audit: [], coach: staged }, '先核对接触方式。', null, base.signal), (error: any) => error.code === 'COACH_EVENT_REVISION_CONFLICT' || error.code === 'COACH_SNAPSHOT_INVALIDATED')
    await store.terminateRun(base.user, turn.request_id, 'failed', 'SYNTHETIC_DONE')
  } finally { await pool.query('DELETE FROM "user" WHERE id=$1', [base.user]) }
})
