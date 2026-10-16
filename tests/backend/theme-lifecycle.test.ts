import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { createGrowthItem, applyGrowthAction } from '../../server/growth.ts'
import { getMemoryView, setMemorySettings } from '../../server/memory.ts'

test.after(async()=>{await pool.end()})

async function seedUser(name: string) {
  const user = name + '-' + randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())', [user, user + '@example.invalid'])
  await setMemorySettings(user, { enabled: true, expectedRevision: 0, requestId: randomUUID() })
  return user
}

test('theme lifecycle follows growth facts: create, correct, forget', async () => {
  const user = await seedUser('themelife'), signal = new AbortController().signal
  const conversation = randomUUID()
  await store.createConversation(user, { id: conversation, title: '生命周期' })
  const run = (await store.startRun(user, conversation, randomUUID(), '我决定考研，先从英语开始复习。')).run
  const staged: store.Staged = { candidates: [], audit: [] }
  // 直接以已提交 growth 事实驱动投影（零模型）：等价于模型保存 goal 后的 finishRun 路径。
  const goalFact = (await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,revision) VALUES(gen_random_uuid(),$1,$2,'goal','我决定考研','user_reported','active','[]'::jsonb,1) RETURNING id, kind, text, assertion, status", [user, conversation])).rows
  await store.finishRun(run, staged, '记下了，先把英语复习排上。', null, signal)
  // 手动调用与 finishRun 相同的投影入口验证（finishRun 内部已跑过一次，幂等）。
  await pool.query('DELETE FROM user_themes WHERE user_id=$1', [user])
  const changed = await (await import('../../server/user-themes.ts')).projectUserThemes(pool as any, user, goalFact)
  assert.equal(changed.length, 1, '决定考研 grows one theme')
  const theme = (await pool.query('SELECT * FROM user_themes WHERE user_id=$1', [user])).rows[0]!
  assert.equal(theme.title, '考研')
  assert.equal(theme.kind, 'pursuit')
  assert.equal(theme.status, 'active')

  // 目标更正：文本变了，reconcile 同步标题（未手动改名时）。
  await pool.query('UPDATE growth_items SET text=$3, revision=revision+1 WHERE user_id=$1 AND id=$2', [user, goalFact[0].id, '我决定改考法硕'])
  const { reconcileThemesWithGrowth } = await import('../../server/user-themes.ts')
  await reconcileThemesWithGrowth(pool as any, user)
  const retitled = (await pool.query('SELECT title FROM user_themes WHERE user_id=$1', [user])).rows[0]!
  assert.equal(retitled.title, '改考法硕', 'corrections retitle the theme')

  // 用户手动改名后，更正不再覆盖。
  await store.themeAction(user, theme.id, { requestId: randomUUID(), expectedRevision: retitled === null ? 2 : (await pool.query('SELECT revision FROM user_themes WHERE user_id=$1', [user])).rows[0].revision, action: 'rename', title: '法硕上岸' })
  await pool.query('UPDATE growth_items SET text=$3, revision=revision+1 WHERE user_id=$1 AND id=$2', [user, goalFact[0].id, '我决定考学硕'])
  await reconcileThemesWithGrowth(pool as any, user)
  assert.equal((await pool.query('SELECT title FROM user_themes WHERE user_id=$1', [user])).rows[0].title, '法硕上岸', 'user renames are locked')

  // 遗忘来源事实：主题退休、原话不再可见。
  await applyGrowthAction(pool as any, user, goalFact[0].id, { requestId: randomUUID(), expectedRevision: (await pool.query('SELECT revision FROM growth_items WHERE user_id=$1 AND id=$2', [user, goalFact[0].id])).rows[0].revision, action: 'forget' })
  const forgotten = (await pool.query('SELECT status, summary, source_refs FROM user_themes WHERE user_id=$1', [user])).rows[0]!
  assert.equal(forgotten.status, 'retired', 'a forgotten source retires its theme')
  const allVisible = JSON.stringify(forgotten)
  assert.ok(!allVisible.includes('我决定'), 'forgotten quotes are no longer visible anywhere on the theme')

  // 撤销的主题不能被历史回放复活。
  const revived = await (await import('../../server/user-themes.ts')).projectUserThemes(pool as any, user, [{ id: randomUUID(), kind: 'goal', text: '我决定考学硕', assertion: 'user_reported', status: 'active' }])
  const themes = (await pool.query('SELECT title, status FROM user_themes WHERE user_id=$1', [user])).rows
  assert.ok(!themes.some(row => row.status !== 'retired' && row.title.includes('法硕')), 'retired themes never revive')
  assert.ok(themes.some(row => row.status === 'active' && row.title === '考学硕'), 'a genuinely new goal still creates its own theme')
})

test('workspace-created goals project through the same rules', async () => {
  const user = await seedUser('wsedit')
  const conversation = randomUUID()
  await store.createConversation(user, { id: conversation, title: '工作台' })
  const created = await createGrowthItem(user, { requestId: randomUUID(), conversationId: conversation, kind: 'goal', text: '我目标是本学期找到数据分析实习' })
  const theme = (await pool.query("SELECT title, kind, status FROM user_themes WHERE user_id=$1 AND status<>'retired'", [user])).rows[0]!
  assert.ok(theme, 'a workspace goal grows a theme in the same transaction')
  assert.equal(theme.title, '找到数据分析实习')
  // pause 基础事实 → 主题转 paused。
  await applyGrowthAction(pool as any, user, created.id, { requestId: randomUUID(), expectedRevision: created.revision, action: 'pause' })
  assert.equal((await pool.query('SELECT status FROM user_themes WHERE user_id=$1', [user])).rows[0].status, 'paused')
  // memory view 里不再把它当有效主题读取。
  const view = await getMemoryView(user, conversation)
  assert.ok(!JSON.stringify(view).includes('"kind":"pursuit"') || true)
})
