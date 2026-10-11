import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { config } from '../../server/config.ts'
import { pool } from '../../server/db.ts'
import { createApp } from '../../server/http.ts'
import type { Engine } from '../../server/agent.ts'
import { createGrowthItem } from '../../server/growth.ts'
import { grantEntitlement } from '../../server/entitlements.ts'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

test('chat usability: memory entry, authoritative copy, visible stop receipt and exhausted draft (isolated PG, scripted engine)', async () => {
  let target: Awaited<ReturnType<typeof createGrowthItem>>
  let dispatches = 0
  const reply = '课程项目如何呈现实习需要的能力？\n这是一段完整保留的合成回复。'
  const engine: Engine = async input => {
    dispatches++
    if (input.context.some(row => row.id === input.run.source_message_id && row.content === '这件事先暂停，不要主动推荐。')) {
      input.staged.pendingMemoryControl = { kind: 'stop_recommend', clauseText: '这件事先暂停，不要主动推荐', candidates: [{ itemId: target.id, revision: target.revision, preview: target.text }] }
    }
    return { text: reply, usage: null }
  }
  const old = { origin: config.origin, rate: config.messagesPerMinute, access: config.entitlementsEnabled }
  const app = createApp(engine)
  await new Promise<void>(done => app.listen(0, '127.0.0.1', done))
  const origin = 'http://127.0.0.1:' + (app.address() as { port: number }).port
  config.origin = origin; config.messagesPerMinute = 1000; config.entitlementsEnabled = true
  const out = '.local/quick-improvements-20261011/browser-local-first'
  mkdirSync(out, { recursive: true })
  const checks: string[] = [], errors: string[] = []
  let browser: any
  try {
    const email = 'usability-' + randomUUID() + '@example.invalid', password = 'Synthetic-' + randomUUID()
    const signup = await fetch(origin + '/api/auth/sign-up/email', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name: 'Synthetic adult usability' }) })
    assert.equal(signup.status, 200)
    const cookie = signup.headers.getSetCookie().map(x => x.split(';')[0]).join('; ')
    const user = (await (await fetch(origin + '/api/session', { headers: { Cookie: cookie } })).json() as any).id
    const chat = randomUUID()
    await fetch(origin + '/api/conversations', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: chat, title: '界面验收' }) })
    target = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'goal', text: '请教学长课程项目如何整理成实习作品' })
    await grantEntitlement(user, 3, new Date(Date.now() + 86400000).toISOString())
    const initial = await fetch(origin + '/api/conversations/' + chat + '/messages', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), text: '把问题整理成一句。' }) })
    await initial.text()
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage(); page.on('pageerror', (e: Error) => errors.push(e.message))
    await page.goto(origin + '/#conversation')
    await page.getByRole('dialog', { name: 'LifeOS 聊一聊' }).getByRole('button', { name: '登录', exact: true }).click()
    await page.getByLabel('邮箱', { exact: true }).fill(email); await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('form', { name: '邮箱登录' }).getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('button', { name: '长期记忆', exact: true }).waitFor()
    await page.getByRole('button', { name: '长期记忆', exact: true }).click()
    await page.getByRole('complementary', { name: '长期记忆' }).waitFor()
    assert.equal(await page.getByLabel('启用长期记忆', { exact: true }).isChecked(), false)
    await page.getByLabel('启用长期记忆', { exact: true }).click()
    await page.getByText('已开启：可跨对话复用你允许保存的背景。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '关闭记忆面板' }).click()
    assert.equal(await page.getByRole('button', { name: '长期记忆', exact: true }).evaluate((el: Element) => document.activeElement === el), true)
    checks.push('existing memory switch is reachable and persisted, close restores focus')
    await page.getByRole('button', { name: '复制完整回复', exact: true }).click()
    await page.getByText('已复制完整回复。复制不代表已经发送或执行。', { exact: true }).waitFor()
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), reply)
    const message = (await pool.query("SELECT id FROM messages WHERE user_id=$1 AND role='assistant' ORDER BY created_at DESC LIMIT 1", [user])).rows[0]
    await pool.query('UPDATE messages SET content=$3 WHERE user_id=$1 AND id=$2', [user, message.id, '另一设备更正后的合成回复'])
    await page.getByRole('button', { name: '复制完整回复', exact: true }).click()
    await page.getByText('回复或其依据已变化，请刷新核对后再复制。', { exact: true }).waitFor()
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), reply, 'stale copy leaves clipboard unchanged')
    checks.push('copy uses committed full response; changed server content cannot be copied as current')
    await page.reload(); await page.getByRole('button', { name: '退出登录', exact: true }).waitFor()
    await page.getByLabel('想聊的事', { exact: true }).fill('这件事先暂停，不要主动推荐。')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.getByRole('button', { name: '就是这条', exact: true }).waitFor()
    assert.ok((await page.getByRole('region', { name: '待确认的记录控制' }).innerText()).includes('请确认你指的是不是这条记录'))
    await page.getByRole('button', { name: '就是这条', exact: true }).click()
    await page.getByText('已停止主动推荐所选事项，原记录保留。', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '就是这条', exact: true }).count(), 0)
    assert.equal((await pool.query('SELECT state FROM growth_recommendation_controls WHERE user_id=$1 AND item_id=$2', [user, target.id])).rows[0].state, 'stopped')
    checks.push('one-candidate wording accurate; confirmed stop receipt stays visible; original record retained')
    await page.getByLabel('想聊的事', { exact: true }).fill('最后一轮合成回复。')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.getByText(/本次对话额度已用完或正在使用，请稍后刷新或联系邀请人/).waitFor()
    await page.getByLabel('想聊的事', { exact: true }).fill('额度用尽后尚未发送的草稿')
    assert.equal(await page.getByRole('button', { name: '发送消息', exact: true }).isEnabled(), false)
    await page.getByLabel('想聊的事', { exact: true }).press('Enter')
    assert.equal(dispatches, 3)
    await page.reload(); await page.getByRole('button', { name: '退出登录', exact: true }).waitFor()
    assert.equal(await page.getByLabel('想聊的事', { exact: true }).inputValue(), '额度用尽后尚未发送的草稿')
    checks.push('exhausted account cannot dispatch via button or Enter, draft survives refresh')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '长期记忆', exact: true }).click()
    const mobile = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }))
    assert.ok(mobile.document <= mobile.width)
    await page.screenshot({ path: out + '/mobile-memory.png' })
    checks.push('390px mobile memory panel fits viewport')
    assert.deepEqual(errors, [])
    writeFileSync(out + '/report.json', JSON.stringify({ status: 'PASS_LOCAL_BROWSER', evidence: 'REAL_ISOLATED_POSTGRESQL_CHROME_SCRIPTED_ENGINE', productProviderCalls: 0, checks, errors }, null, 2))
  } finally {
    if (browser) await browser.close()
    config.origin = old.origin; config.messagesPerMinute = old.rate; config.entitlementsEnabled = old.access
    await new Promise<void>(done => app.close(() => done()))
    await pool.end()
  }
})
