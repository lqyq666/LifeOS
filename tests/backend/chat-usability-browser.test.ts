import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { config } from '../../server/config.ts'
import { pool, transaction } from '../../server/db.ts'
import { createApp } from '../../server/http.ts'
import type { Engine } from '../../server/agent.ts'
import { createGrowthItem } from '../../server/growth.ts'
import { grantEntitlement } from '../../server/entitlements.ts'
import * as store from '../../server/store.ts'
import {linkExperienceToThemes} from '../../server/user-themes.ts'

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
  const out = process.env.LIFEOS_UI_EVIDENCE ?? '.local/quick-improvements-20261011/browser-local-first'
  mkdirSync(out, { recursive: true })
  const checks: string[] = [], errors: string[] = []
  let browser: any
  let releaseMemory:(()=>void)|undefined
  let releaseCognition:(()=>void)|undefined
  try {
    const email = 'usability-' + randomUUID() + '@example.invalid', password = 'Synthetic-' + randomUUID()
    const signup = await fetch(origin + '/api/auth/sign-up/email', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name: 'Synthetic adult usability' }) })
    assert.equal(signup.status, 200)
    const cookie = signup.headers.getSetCookie().map(x => x.split(';')[0]).join('; ')
    const user = (await (await fetch(origin + '/api/session', { headers: { Cookie: cookie } })).json() as any).id
    await grantEntitlement(user, 3, new Date(Date.now() + 86400000).toISOString())
    // Arrange a separate, genuinely persisted source conversation. Correcting
    // this record must not invalidate the unrelated reply used by copy tests.
    const recordChat=randomUUID(),recordText='我请教学长课程项目如何整理成实习作品，把资料发给他了，还没回复。'
    await store.createConversation(user,{id:recordChat,title:'合成经历原对话'})
    const recordRun=await store.startRun(user,recordChat,randomUUID(),recordText)
    await store.terminateRun(user,recordRun.run.request_id,'cancelled','CURRENT_UI_SOURCE_FIXTURE')
    const recordId=randomUUID(),recordTitle='合成资料协作经历'
    await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',2)",[recordId,user,recordChat,recordRun.run.source_message_id,recordText,recordRun.run.request_id,{title:recordTitle,summary:'  '+recordText+'  ',action:'把资料发给学长',result:'还没回复',reflection:'是否读过仍未知',source:'用户对话原话',tags:['合成资料']}])
    const chat = randomUUID()
    await fetch(origin + '/api/conversations', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: chat, title: '界面验收' }) })
    target = await createGrowthItem(user, { requestId: randomUUID(), conversationId: chat, kind: 'goal', text: '请教学长课程项目如何整理成实习作品' })
    await transaction(c=>linkExperienceToThemes(c,user,recordId,recordText,true))
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
    await page.locator('#qa-memory-panel').evaluate((element: HTMLElement) =>
      Promise.all(element.getAnimations().map(animation => animation.finished)),
    )
    assert.equal(await page.locator('#qa-memory-panel').evaluate((element: HTMLElement) => getComputedStyle(element).opacity), '1')
    const mobile = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }))
    assert.ok(mobile.document <= mobile.width)
    await page.screenshot({ path: out + '/mobile-memory.png' })
    checks.push('390px mobile memory panel fits viewport')
    await page.getByRole('button',{name:'关闭记忆面板'}).click()
    await page.getByRole('button',{name:'回到认知空间',exact:true}).click()
    await page.getByRole('button',{name:'阅读'+recordTitle,exact:true}).click()
    await page.getByRole('heading',{name:recordTitle,exact:true}).waitFor()
    await page.getByRole('button',{name:'编辑',exact:true}).click()
    await page.getByLabel('结果',{exact:true}).fill('学长已回复，是否采用未知')
    const cognitionGate=new Promise<void>(done=>{releaseCognition=done})
    await page.route('**/api/cognition',async(route:any)=>{await cognitionGate;await route.continue()})
    await page.getByRole('button',{name:'保存',exact:true}).click()
    await page.getByText('已保存到你的账户',{exact:true}).waitFor()
    await page.getByText('更正已保存，相关解释正在刷新；旧解释与建议暂不展示。',{exact:true}).waitFor()
    assert.equal(await page.locator('#record-title').innerText(),recordTitle,'pending refresh must preserve the saved title')
    await page.screenshot({path:out+'/current-record-refresh-pending-390.png'})
    releaseCognition!()
    await page.getByText('更正已保存，相关解释正在刷新；旧解释与建议暂不展示。',{exact:true}).waitFor({state:'hidden'})
    const graphAfter=await (await fetch(origin+'/api/cognition',{headers:{Cookie:cookie}})).json() as any
    const recordAfter=graphAfter.nodes.find((node:any)=>node.serverId===recordId)
    assert.equal(recordAfter.serverRevision,3)
    assert.equal(recordAfter.title,recordTitle,'editing only the result preserves the original title')
    assert.equal(recordAfter.summary,'  '+recordText+'  ','an untouched whitespace-bearing summary stays byte-identical')
    assert.equal(recordAfter.result,'学长已回复，是否采用未知')
    assert.equal(recordAfter.taskOutcomes.response.status,'reported_response')
    assert.equal(recordAfter.taskOutcomes.read.status,'unknown')
    assert.equal(recordAfter.taskOutcomes.adoption.status,'unknown')
    assert.ok(!recordAfter.experienceSummary.unknowns.includes('是否回应'))
    assert.equal(recordAfter.action,'把资料发给学长')
    assert.equal(recordAfter.reflection,'是否读过仍未知')
    assert.equal(recordAfter.source,'用户对话原话')
    assert.deepEqual(recordAfter.tags,['合成资料'])
    await page.screenshot({path:out+'/current-record-corrected-390.png'})
    await page.getByRole('button',{name:'关闭记录，返回原位',exact:true}).click()
    await page.getByRole('button',{name:'聊聊',exact:true}).click()
    assert.equal(await page.getByLabel('想聊的事',{exact:true}).inputValue(),'额度用尽后尚未发送的草稿')
    await page.getByRole('button',{name:'长期记忆',exact:true}).click()
    const memoryGate=new Promise<void>(done=>{releaseMemory=done})
    await page.route('**/api/memory/settings',async(route:any)=>{await memoryGate;await route.continue()})
    await page.getByLabel('启用长期记忆',{exact:true}).click()
    await page.getByText('正在保存记忆更改…',{exact:true}).waitFor({timeout:1000})
    assert.equal(await page.getByLabel('启用长期记忆',{exact:true}).isChecked(),true,'do not announce an uncommitted memory change')
    assert.equal(await page.getByLabel('启用长期记忆',{exact:true}).isDisabled(),true)
    releaseMemory!()
    await page.getByText('已关闭：不会跨对话复用长期记忆。',{exact:true}).waitFor()
    assert.equal(await page.getByLabel('启用长期记忆',{exact:true}).isChecked(),false)
    const memoryAfter=await (await fetch(origin+'/api/memory',{headers:{Cookie:cookie}})).json() as any
    assert.equal(memoryAfter.settings.enabled,false)
    const stillThere=await (await fetch(origin+'/api/cognition',{headers:{Cookie:cookie}})).json() as any
    assert.equal(stillThere.nodes.find((node:any)=>node.serverId===recordId)?.result,'学长已回复，是否采用未知','memory off does not delete the user-visible corrected record')
    // Another device updates the same setting after this panel loaded. Use the
    // real revision-conflict response and real refresh, not a synthetic error.
    const concurrent=await fetch(origin+'/api/memory/settings',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),expectedRevision:memoryAfter.settings.revision,enabled:false})})
    assert.equal(concurrent.status,200)
    const refreshed=page.waitForResponse((response:any)=>new URL(response.url()).pathname==='/api/memory'&&response.request().method()==='GET')
    await page.getByLabel('启用长期记忆',{exact:true}).click()
    await refreshed
    await page.getByLabel('启用长期记忆',{exact:true}).waitFor()
    await page.getByText('记忆已发生变化，请刷新后再操作。',{exact:true}).waitFor({timeout:1000})
    assert.equal(await page.getByLabel('启用长期记忆',{exact:true}).isChecked(),false)
    assert.equal((await (await fetch(origin+'/api/memory',{headers:{Cookie:cookie}})).json() as any).settings.enabled,false)
    await page.screenshot({path:out+'/current-memory-conflict-390.png'})
    assert.equal(dispatches,3,'reading/correcting records and changing memory never dispatch a model')
    checks.push('current UI login-to-star-map-to-corrected-record-to-chat-to-memory-off uses actual isolated PG, retains untouched fields and chat draft, and adds no model calls')
    checks.push('a genuine concurrent-device memory revision conflict refreshes confirmed settings without hiding the failed-save notice')
    assert.deepEqual(errors, [])
    writeFileSync(out + '/report.json', JSON.stringify({ status: 'PASS_LOCAL_BROWSER', evidence: 'REAL_ISOLATED_POSTGRESQL_CHROME_SCRIPTED_ENGINE', productProviderCalls: 0, checks, errors }, null, 2))
  } finally {
    releaseCognition?.()
    releaseMemory?.()
    if (browser) await browser.close()
    config.origin = old.origin; config.messagesPerMinute = old.rate; config.entitlementsEnabled = old.access
    await new Promise<void>(done => app.close(() => done()))
    await pool.end()
  }
})
