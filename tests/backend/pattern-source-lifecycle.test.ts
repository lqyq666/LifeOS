import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { getMemoryView, setMemorySettings, applyMemoryAction, loadSnapshot, patternSuppressionKey } from '../../server/memory.ts'
import { localEmbedding } from '../../server/local-embedding.ts'
import { currentExperienceEvidence } from '../../server/growth-privacy.ts'

test('pattern creation follows corrected and withdrawn sources and memory consent across conversations', async () => {
  const users: string[] = []
  async function actor(enabled = true) {
    const user = 'pattern-life-' + randomUUID()
    users.push(user)
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())', [user, user + '@example.invalid'])
    if (enabled) await setMemorySettings(user, { enabled, expectedRevision: 0, requestId: randomUUID() })
    return user
  }
  async function save(user: string, quote: string) {
    const conversation = randomUUID()
    await store.createConversation(user, { id: conversation, title: '独立合成经历' })
    const run = (await store.startRun(user, conversation, randomUUID(), quote)).run
    const staged: store.Staged = { candidates: [], audit: [] }
    await store.stageCandidate(run, staged, { sourceMessageId: run.source_message_id, quote, links: [] })
    await store.finishRun(run, staged, '已记录本人经历。', null, new AbortController().signal)
    const row = (await pool.query('SELECT * FROM experiences WHERE user_id=$1 AND conversation_id=$2', [user, conversation])).rows[0]
    assert.ok(row)
    return row
  }
  const first = '我按时交付了课程报告。', second = '上学期我按时提交了社团海报。'
  async function ontime(user: string) {
    return (await pool.query("SELECT * FROM memory_items WHERE user_id=$1 AND value->>'behaviorKey'='deliver-ontime'", [user])).rows
  }
  try {
    const corrected = await actor()
    const old = await save(corrected, first)
    await store.experienceAction(corrected, old.id, { action: 'correct', expectedRevision: old.revision, requestId: randomUUID(), content: { summary: '我交付了课程报告，但没有按时交付。' } })
    await save(corrected, second)
    assert.equal((await ontime(corrected)).length, 0, 'old positive quote must not undo the manual correction')

    const withdrawn = await actor()
    const source = await save(withdrawn, first)
    // Represents the source tombstone persisted by the existing forget path.
    await pool.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4)', [withdrawn, source.conversation_id, source.source_message_id, first])
    await save(withdrawn, second)
    assert.equal((await ontime(withdrawn)).length, 0, 'withdrawn source cannot seed a fresh observation')

    const disabled = await actor(false)
    await save(disabled, first)
    await save(disabled, second)
    assert.equal((await ontime(disabled)).length, 0, 'memory disabled prevents new cross-conversation observations')

    const control = await actor()
    await save(control, first)
    const last = await save(control, second)
    const pattern = (await ontime(control))[0]
    assert.ok(pattern, 'genuine independent reports still produce a pending observation')
    assert.equal((await getMemoryView(control)).items.find(item => item.id === pattern.id)?.status, 'pending')
    await applyMemoryAction(control, pattern.id, { action: 'accept', expectedRevision: pattern.revision, requestId: randomUUID() })
    assert.equal((await getMemoryView(control)).items.find(item => item.id === pattern.id)?.status, 'accepted')
    const snapshot = await loadSnapshot(control, last.conversation_id, '核对这两次交付经历')
    assert.equal(snapshot.confirmedExperiences.length, 2, 'positive cross-session control keeps both genuine records')

    const rejection = await actor()
    await save(rejection, first)
    const rejectedLast = await save(rejection, second)
    const rejected = (await ontime(rejection))[0]
    await applyMemoryAction(rejection, rejected.id, { action: 'reject', expectedRevision: rejected.revision, requestId: randomUUID() })
    assert.equal((await store.listExperiences(rejection)).length, 2, 'rejecting an interpretation preserves its factual records')
    assert.equal((await loadSnapshot(rejection, rejectedLast.conversation_id, '核对交付经历')).confirmedExperiences.length, 2)
    assert.equal((await getMemoryView(rejection)).items.find(item => item.id === rejected.id)?.status, 'rejected')

    await applyMemoryAction(control, pattern.id, { action: 'forget', expectedRevision: pattern.revision + 1, requestId: randomUUID() })
    await save(control, '去年我按时交付了志愿活动登记表。')
    assert.equal((await ontime(control)).length, 0, 'forgotten observation is not recreated after one more similar experience')
    assert.equal((await store.listExperiences(control)).length, 3, 'forgetting the observation preserves its facts')

    const validCorrection = await actor()
    const before = await save(validCorrection, '我交付了课程报告。')
    await store.experienceAction(validCorrection, before.id, { action: 'correct', expectedRevision: before.revision, requestId: randomUUID(), content: { summary: '我如期交付了课程报告。' } })
    await save(validCorrection, second)
    const current = (await ontime(validCorrection))[0]
    assert.ok(current, 'a genuine corrected testimony can support a new observation')
    assert.ok((await getMemoryView(validCorrection)).items.find(item => item.id === current.id)?.sources.some(source => source.quote?.includes('如期')))
    await applyMemoryAction(validCorrection, current.id, { action: 'accept', expectedRevision: current.revision, requestId: randomUUID() })
    await pool.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4)', [validCorrection, before.conversation_id, before.source_message_id, before.source_quote])
    assert.equal((await getMemoryView(validCorrection)).items.some(item => item.id === current.id), false, 'later source withdrawal hides the already accepted observation')

    const staleSummary = await actor()
    const raw = await save(staleSummary, '我交付了课程报告。')
    await pool.query("UPDATE experiences SET content=jsonb_set(content,'{summary}',to_jsonb($3::text)) WHERE user_id=$1 AND id=$2", [staleSummary, raw.id, '我按时交付了课程报告。'])
    await save(staleSummary, second)
    assert.equal((await ontime(staleSummary)).length, 0, 'unverified historical summary cannot add an on-time claim absent from source')

    const partial = await actor()
    const partialSource = await save(partial, '我交付了课程报告。')
    await pool.query("UPDATE experiences SET content=jsonb_set(content,'{action}',to_jsonb($3::text)) WHERE user_id=$1 AND id=$2", [partial, partialSource.id, '我按时交付了课程报告。'])
    await store.experienceAction(partial, partialSource.id, { action: 'correct', expectedRevision: partialSource.revision, requestId: randomUUID(), content: { summary: '我交付了课程报告，还没有拿到评分。' } })
    await save(partial, second)
    assert.equal((await ontime(partial)).length, 0, 'changing one field cannot authorize a stale extraction in another field')

    const reflection = await actor()
    const reflected = await save(reflection, '我交付了课程报告。')
    await pool.query("UPDATE experiences SET content=jsonb_set(content,'{action}',to_jsonb($3::text)) WHERE user_id=$1 AND id=$2", [reflection, reflected.id, '我提前交付了课程报告。'])
    const edited = await store.experienceAction(reflection, reflected.id, { action: 'correct', expectedRevision: reflected.revision, requestId: randomUUID(), content: { summary: reflected.content.summary, reflection: '我核对了记录，这次确实是按时交付。' } })
    const [projection] = await currentExperienceEvidence(pool, reflection, [edited])
    assert.equal(projection.content.action, '', 'adding a new reflection cannot authorize a stale action field')
    assert.equal(projection.content.reflection, '我核对了记录，这次确实是按时交付。', 'the independently corrected field remains usable')

    const legacy = await actor()
    const contacts = [await save(legacy, '上个月我提前联系了科研导师讨论课题。'), await save(legacy, '昨天我提前联系了实习负责人询问面试时间。')]
    const legacyId = randomUUID()
    const refs = contacts.map(row => ({ type: 'experience', experienceId: row.id, revision: row.revision, conversationId: row.conversation_id, messageId: row.source_message_id, quote: row.source_quote }))
    await pool.query("INSERT INTO memory_items(id,user_id,kind,value,assertion,scope,source_refs,observed_at,status) VALUES($1,$2,'pattern_candidate',$3,'system_pattern_candidate','user',$4,now(),'pending')", [legacyId, legacy, { behaviorKey: 'deliver-ontime', behavior: '按时交付' }, JSON.stringify(refs)])
    assert.equal((await getMemoryView(legacy)).items.some(item => item.id === legacyId), false, 'obsolete auto-observations must be checked by the corrected rule')
    await assert.rejects(applyMemoryAction(legacy, legacyId, { action: 'accept', expectedRevision: 1, requestId: randomUUID() }), (error: any) => error.code === 'PATTERN_SOURCES_CHANGED')

    const legacyForgot = await actor()
    await save(legacyForgot, first)
    await save(legacyForgot, second)
    const obsolete = (await ontime(legacyForgot))[0]
    await applyMemoryAction(legacyForgot, obsolete.id, { action: 'forget', expectedRevision: obsolete.revision, requestId: randomUUID() })
    // Old releases retained only the source-set hash, not the behavior key.
    await pool.query('UPDATE memory_suppressions SET key=$2 WHERE user_id=$1', [legacyForgot, patternSuppressionKey(obsolete.source_refs)])
    await save(legacyForgot, '去年我按时交付了志愿活动登记表。')
    assert.equal((await ontime(legacyForgot)).length, 0, 'legacy forgotten sources do not re-enter a new observation with one added source')
    assert.equal((await store.listExperiences(legacyForgot)).length, 3)
  } finally {
    for (const user of users) {
      await pool.query('DELETE FROM experiences WHERE user_id=$1', [user])
      await pool.query('DELETE FROM "user" WHERE id=$1', [user])
    }
    await localEmbedding.close()
    await pool.end()
  }
})
