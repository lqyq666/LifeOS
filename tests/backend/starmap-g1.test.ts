import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool, transaction } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { readStarMapContext, projectUserThemes, linkExperienceToThemes } from '../../server/user-themes.ts'
import { assertStarMapSnapshot } from '../../server/store.ts'
import { reconcileIdentityClaims, projectIdentityClaims, identityClaimAction,deriveIdentityClaims } from '../../server/identity.ts'
import { setMemorySettings } from '../../server/memory.ts'
import { applyGrowthAction,createGrowthItem,actOnGrowthItem } from '../../server/growth.ts'
import {localEmbedding} from '../../server/local-embedding.ts'

test.after(async()=>{await localEmbedding.close();await pool.end()})

test('explicit identity edits keep their own authority; conditional, quoted and third-party words never become identity',async()=>{
 for(const text of ['如果我是那种先做再想的人，会不会更好？','我是那种先做再想的人？','同学说我是那种先做再想的人。','我引用“我是那种先做再想的人”。'])assert.deepEqual(deriveIdentityClaims([{id:randomUUID(),kind:'preference',text,assertion:'user_edit',status:'active'}]),[],text)
 const user=await seedUser('identity-own-edit'),chat=randomUUID();await store.createConversation(user,{id:chat,title:'Synthetic identity authority'})
 const old='我是那种先动手试再想清楚的人',edited='我是那种先查证再行动的人',fact=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'preference',text:old})
 const claim=(await pool.query("SELECT id FROM identity_claims WHERE user_id=$1 AND status='active'",[user])).rows[0]
 assert.ok(claim)
 await transaction(async c=>{await identityClaimAction(c,user,claim.id,{action:'correct',text:edited});await reconcileIdentityClaims(c,user)})
 assert.equal((await pool.query("SELECT text FROM identity_claims WHERE user_id=$1 AND status='active'",[user])).rows[0].text,edited)
 await actOnGrowthItem(user,fact.id,{requestId:randomUUID(),expectedRevision:fact.revision,action:'forget'})
 assert.equal((await pool.query("SELECT text FROM identity_claims WHERE user_id=$1 AND status='active'",[user])).rows[0].text,edited,'later explicit owner edit is independent of the forgotten old source')
 assert.ok(!JSON.stringify((await pool.query('SELECT old_snapshot,new_snapshot,source_refs FROM identity_change_events WHERE user_id=$1',[user])).rows).includes(old),'forgetting old source redacts its event quotes even after direct claim correction')
})

async function seedUser(name: string) {
  const user = name + '-' + randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())', [user, user + '@example.invalid'])
  await setMemorySettings(user, { enabled: true, expectedRevision: 0, requestId: randomUUID() })
  return user
}

async function seedEpisode(user: string, text: string) {
  const conversation = randomUUID()
  await store.createConversation(user, { id: conversation, title: 'G1' })
  const started = await store.startRun(user, conversation, randomUUID(), text)
  const content = { title: text.slice(0, 12), summary: text, action: '', result: '', reflection: '', occurredAt: '', source: '用户对话原话', tags: [] }
  const experience = (await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',2) RETURNING id", [randomUUID(), user, conversation, started.run.source_message_id, text, started.run.request_id, content])).rows[0].id
  await store.terminateRun(user, started.run.request_id, 'cancelled', 'G1_SETUP')
  return { conversation, experience, messageId: started.run.source_message_id }
}

test('G1.1 source validity: quote must truly exist in the source message and must not be suppressed', async () => {
  const user = await seedUser('g11')
  const quote = '我给音乐社做了一套招新海报，社长验收通过'
  const { experience, messageId } = await seedEpisode(user, quote + '，下周还要做视频')
  const conversation2 = randomUUID()
  await store.createConversation(user, { id: conversation2, title: 'goal' })
  const goal2 = (await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,revision) VALUES($1,$2,$3,'goal','我决定做好社团设计','user_reported','active',1) RETURNING id", [randomUUID(), user, conversation2])).rows[0].id
  await projectUserThemes(pool as any, user, [{ id: goal2, kind: 'goal', text: '我决定做好社团设计', assertion: 'user_reported', status: 'active' }])
  await transaction(async c => { await linkExperienceToThemes(c, user, experience, `我决定做好社团设计，${quote}`, true) })
  const theme = (await pool.query('SELECT id FROM user_themes WHERE user_id=$1', [user])).rows[0]

  const before = await readStarMapContext(pool as any, user)
  assert.equal(before!.linkedExperiences.length, 1, 'a live, verbatim-backed link enters the context')

  // 原话被编辑掉：引用失效（strpos 校验，而非长度启发式）。
  await pool.query('UPDATE messages SET content=$2 WHERE id=$1', [messageId, '（这条消息被修改过，原话不在了）'])
  const afterEdit = await readStarMapContext(pool as any, user)
  assert.equal(afterEdit!.linkedExperiences.length, 0, 'a link whose quote no longer exists in the source message leaves the context')

  // 恢复原话，再加抑制（遗忘/停止使用）：同样退出。
  await pool.query('UPDATE messages SET content=$2 WHERE id=$1', [messageId, quote + '，下周还要做视频'])
  const suppressionConversation = (await pool.query('SELECT conversation_id FROM messages WHERE id=$1', [messageId])).rows[0].conversation_id
  await pool.query('INSERT INTO growth_source_suppressions(user_id,conversation_id,message_id,quote) VALUES($1,$2,$3,$4)', [user, suppressionConversation, messageId, quote])
  const afterSuppress = await readStarMapContext(pool as any, user)
  assert.equal(afterSuppress!.linkedExperiences.length, 0, 'a suppressed source leaves the context')
})

test('G1.3 snapshot conflict: external link change during generation blocks commit; own update never self-collides', async () => {
  const user = await seedUser('g13')
  const quote = '我完成了创业项目的第一次校园摆摊'
  const { experience } = await seedEpisode(user, quote)
  const conversation = randomUUID()
  await store.createConversation(user, { id: conversation, title: 'g13goal' })
  const goal = (await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,revision) VALUES($1,$2,$3,'goal','我决定做校园创业','user_reported','active',1) RETURNING id", [randomUUID(), user, conversation])).rows[0].id
  await projectUserThemes(pool as any, user, [{ id: goal, kind: 'goal', text: '我决定做校园创业', assertion: 'user_reported', status: 'active' }])
  await transaction(async c => { await linkExperienceToThemes(c, user, experience, `我决定做校园创业，${quote}`, true) })
  const theme = (await pool.query('SELECT id, revision FROM user_themes WHERE user_id=$1', [user])).rows[0]
  const link = (await pool.query('SELECT revision FROM experience_theme_links WHERE user_id=$1', [user])).rows[0]

  // 他端在生成期间确认了连线 → 修订已变 → 快照冲突。
  await store.themeLinkAction(user, experience, theme.id, { requestId: randomUUID(), action: 'confirm' })
  await assert.rejects(
    () => transaction(async c => assertStarMapSnapshot(c, user, { themes: [{ id: theme.id, revision: theme.revision }], links: [{ experienceId: experience, themeId: theme.id, revision: link.revision }] })),
    (error: any) => error.code === 'STARMAP_SNAPSHOT_INVALIDATED',
    'a concurrent link confirmation invalidates the snapshot',
  )

  // 快照与当前一致 → 通过（本轮自己的写入发生在校验之后，不会自撞）。
  const freshLink = (await pool.query('SELECT revision FROM experience_theme_links WHERE user_id=$1', [user])).rows[0]
  await transaction(async c => {
    await assertStarMapSnapshot(c, user, { themes: [{ id: theme.id, revision: theme.revision }], links: [{ experienceId: experience, themeId: theme.id, revision: freshLink.revision }] })
    // 校验后的同事务写入合法。
    await c.query("UPDATE user_themes SET revision=revision+1 WHERE id=$1", [theme.id])
  })
  assert.ok(true, 'consistent snapshot passes and own writes proceed')
})

test('G1.2 identity lifecycle: forgotten source retires the claim and purges quotes from visible history', async () => {
  const user = await seedUser('g12')
  const conversation = randomUUID()
  await store.createConversation(user, { id: conversation, title: 'identity' })
  const selfDescription = '我是那种先动手试再想清楚的人'
  const fact = (await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,revision) VALUES($1,$2,$3,'preference',$4,'user_reported','active',1) RETURNING id", [randomUUID(), user, conversation, selfDescription])).rows[0].id
  const changed = await projectIdentityClaims(pool as any, user, [{ id: fact, kind: 'preference', text: selfDescription, assertion: 'user_reported', status: 'active' }])
  assert.equal(changed.length, 1, 'self-description becomes an identity claim')

  // 用户“这不是我” → 退休。
  await transaction(async c => identityClaimAction(c, user, changed[0], { action: 'deny' }))
  const denied = (await pool.query('SELECT status FROM identity_claims WHERE user_id=$1 AND id=$2', [user, changed[0]])).rows[0]
  assert.equal(denied.status, 'retired')

  // 重建一个，走遗忘路径：来源遗忘 → 声明退休 + 变更事件里旧原话被清除。
  const claim2 = await projectIdentityClaims(pool as any, user, [{ id: fact, kind: 'preference', text: selfDescription, assertion: 'user_reported', status: 'active' }])
  assert.equal(claim2.length, 1)
  const revision = (await pool.query('SELECT revision FROM growth_items WHERE id=$1', [fact])).rows[0].revision
  await applyGrowthAction(pool as any, user, fact, { requestId: randomUUID(), expectedRevision: revision, action: 'forget' })
  await reconcileIdentityClaims(pool as any, user)
  const retired = (await pool.query('SELECT status FROM identity_claims WHERE user_id=$1 AND id=$2', [user, claim2[0]])).rows[0]
  assert.equal(retired.status, 'retired', 'a forgotten source retires its identity claim')
  const events = (await pool.query('SELECT * FROM identity_change_events WHERE user_id=$1', [user])).rows
  const serialized = JSON.stringify(events)
  assert.ok(!serialized.includes('先动手试'), 'forgotten quotes are purged from the visible change history')
  assert.ok(events.some(event => event.subject_type === 'identity_claim'), 'technical receipts without private content remain')
})
