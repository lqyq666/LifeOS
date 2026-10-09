import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool, transaction } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { readStarMapContext, projectUserThemes } from '../../server/user-themes.ts'
import { assertStarMapSnapshot } from '../../server/store.ts'
import { setMemorySettings } from '../../server/memory.ts'

async function seedUser(name: string) {
  const user = name + '-' + randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())', [user, user + '@example.invalid'])
  return user
}

async function giveGoalAndExperience(user: string) {
  const conversation = randomUUID()
  await store.createConversation(user, { id: conversation, title: '信任边界' })
  const started = await store.startRun(user, conversation, randomUUID(), '我决定做自由职业设计接单，上周我交付了一个付费海报项目')
  const message = started.run.source_message_id, runRequestId = started.run.request_id
  await store.terminateRun(user, started.run.request_id, 'cancelled', 'TRUST_BOUNDARY_TEST_SETUP')
  const goal = (await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,revision) VALUES($1,$2,$3,'goal','我决定做自由职业设计接单','user_reported','active',1) RETURNING id", [randomUUID(), user, conversation])).rows[0].id
  const experience = (await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,'上周我交付了一个付费海报项目',$5,$6,'confirmed',now(),'auto',2) RETURNING id", [randomUUID(), user, conversation, message, runRequestId, { title: '交付了付费海报项目', summary: '上周我交付了一个付费海报项目', action: '', result: '', reflection: '', occurredAt: '', source: '用户对话原话', tags: [] }])).rows[0].id
  await projectUserThemes(pool as any, user, [{ id: goal, kind: 'goal', text: '我决定做自由职业设计接单', assertion: 'user_reported', status: 'active' }])
  await transaction(async c => { await (await import('../../server/user-themes.ts')).linkExperienceToThemes(c, user, experience, '我决定做自由职业设计接单，上周我交付了一个付费海报项目', true) })
  return { conversation, goal, experience, message }
}

test('star map context obeys the memory switch, active links, source validity and cross-account isolation', async () => {
  const user = await seedUser('trust'), stranger = await seedUser('stranger')
  const { goal, experience } = await giveGoalAndExperience(user)

  // 1) Memory OFF：不进入模型上下文（跨会话个人事实被关闭）。
  await setMemorySettings(user, { enabled: false, expectedRevision: 0, requestId: randomUUID() })
  assert.equal(await readStarMapContext(pool as any, user), null, 'memory off blocks all star map personal facts')

  // 2) Memory ON：主题、连线、约束可见；candidate 反映真实确认状态（未确认为候选）。
  await setMemorySettings(user, { enabled: true, expectedRevision: 1, requestId: randomUUID() })
  const on = await readStarMapContext(pool as any, user)!
  assert.ok(on.themes.some(t => t.title.includes('自由职业')))
  assert.equal(on.linkedExperiences.length, 1)
  assert.equal(on.linkedExperiences[0]!.candidate, true, 'an unconfirmed link is a candidate, not a confirmed fact')

  // 3) 用户确认连线后不再是候选。
  await store.themeLinkAction(user, experience, on.themes[0]!.id, { requestId: randomUUID(), action: 'confirm' })
  const confirmed = await readStarMapContext(pool as any, user)!
  assert.equal(confirmed.linkedExperiences[0]!.candidate, false)
  assert.ok(confirmed.linkedExperiences[0]!.summary.length > 0)

  // 4) 撤销连线：不再进入决策。
  await store.themeLinkAction(user, experience, on.themes[0]!.id, { requestId: randomUUID(), action: 'revoke' })
  const revoked = await readStarMapContext(pool as any, user)!
  assert.equal(revoked.linkedExperiences.length, 0, 'a revoked link leaves the model context')

  // 5) 跨账号：他人读不到。
  await setMemorySettings(stranger, { enabled: true, expectedRevision: 0, requestId: randomUUID() })
  assert.equal(await readStarMapContext(pool as any, stranger), null, 'cross account isolation')

  // 6) 主题来源事实被遗忘：主题整体退出上下文。
  await (await import('../../server/growth.ts')).applyGrowthAction(pool as any, user, goal, { requestId: randomUUID(), expectedRevision: 1, action: 'forget' })
  const forgotten = await readStarMapContext(pool as any, user)
  assert.equal(forgotten, null, 'a theme whose every source is forgotten disappears from context')

  // 7) 快照失效：主题在他端被修改后，提交被阻止。
  const fresh = await seedUser('snap')
  const freshConversation = randomUUID()
  await store.createConversation(fresh, { id: freshConversation, title: '快照' })
  const g2 = (await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,revision) VALUES($1,$2,$3,'goal','我决定考研','user_reported','active',1) RETURNING id", [randomUUID(), fresh, freshConversation])).rows[0].id
  await projectUserThemes(pool as any, fresh, [{ id: g2, kind: 'goal', text: '我决定考研', assertion: 'user_reported', status: 'active' }])
  const theme = (await pool.query('SELECT id, revision FROM user_themes WHERE user_id=$1', [fresh])).rows[0]!
  await pool.query('UPDATE user_themes SET revision=revision+1 WHERE id=$1', [theme.id]) // 模拟他端并发修改
  await assert.rejects(() => transaction(async c => assertStarMapSnapshot(c, fresh, { themes: [{ id: theme.id, revision: theme.revision }], links: [] })), (error: any) => error.code === 'STARMAP_SNAPSHOT_INVALIDATED')
})
