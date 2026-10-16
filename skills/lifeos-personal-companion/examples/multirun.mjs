// lifeos-personal-companion — runnable multi-turn example (PC16 harness).
//
// Drives the REAL local product through one complete companion loop:
//   缺信息时合理追问 → 用户新信息 → 有依据的帮助 → 更正后使用新状态
// using a synthetic adult student. Prints each actual reply, the growth
// before/after diff and the per-turn state receipts. Nothing is mocked.
//
// Usage:  node skills/lifeos-personal-companion/examples/multirun.mjs \
//           [--origin http://127.0.0.1:8787] [--paid]
// Without --paid the script stops after the free checks (server reachable,
// signup, conversation, growth read) and prints the paid plan.

import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback }
const origin = option('--origin', 'http://127.0.0.1:8787')
const paid = flag('--paid')

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

async function main() {
let expectedHead, mainSkillDigest
try {
  expectedHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().toLowerCase()
  mainSkillDigest = createHash('sha256').update(readFileSync(resolve(repoRoot, 'skills/lifeos-personal-companion/SKILL.md'))).digest('hex')
  if (!/^[a-f0-9]{40}$/.test(expectedHead)) throw new Error('source head unavailable')
} catch {
  console.error('RUNTIME_FINGERPRINT_BLOCKED: developed source identity unavailable')
  return 2
}

let runtime
try {
  const versionResponse = await fetch(origin + '/api/run/version', { redirect: 'error', signal: AbortSignal.timeout(5000) })
  if (!versionResponse.ok) throw new Error('HTTP_' + versionResponse.status)
  runtime = await versionResponse.json()
} catch (error) {
  console.error('RUNTIME_FINGERPRINT_BLOCKED: /api/run/version unavailable (' + (error instanceof Error ? error.message : String(error)) + ')')
  return 2
}
const reportedHead = typeof runtime?.head === 'string' ? runtime.head.toLowerCase() : ''
if (runtime?.service !== 'LifeOS' || !/^[a-f0-9]{7,40}$/.test(reportedHead) || !expectedHead.startsWith(reportedHead) || runtime?.skillVersion !== '1.2.2-candidate' || runtime?.contractGeneration !== 'p4+workflow-v2' || runtime?.mainSkillDigest !== mainSkillDigest) {
  console.error('RUNTIME_FINGERPRINT_BLOCKED: runtime does not match this source and Skill (' + JSON.stringify({
    service: runtime?.service,
    head: runtime?.head,
    skillVersion: runtime?.skillVersion,
    contractGeneration: runtime?.contractGeneration,
    mainSkillDigest: runtime?.mainSkillDigest,
  }) + ')')
  return 2
}

let session
try { session = await fetch(origin + '/api/session') } catch { session = null }
// Any HTTP answer (200 or 401 anonymous) means the product is up; only a
// network-level failure means unreachable.
if (!session) { console.error('SERVER_NOT_REACHABLE ' + origin + ' — start the local product first (honest offline mode applies, see SKILL.md)'); return 2 }

// Real BetterAuth signup for a synthetic ADULT student; local rate limits can 429.
const email = 'skill-pc16-' + randomUUID().slice(0, 8) + '@example.invalid'
let signup
for (let attempt = 0; attempt < 8; attempt++) {
  signup = await fetch(origin + '/api/auth/sign-up/email', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Synthetic-' + randomUUID(), name: 'Synthetic skill example (adult)' }),
  })
  if (signup.ok) break
  if (signup.status !== 429 || attempt === 7) { console.error('SIGNUP_FAILED_' + signup.status); return 2 }
  await new Promise(r => setTimeout(r, 10000))
}
const cookie = signup.headers.getSetCookie().map(v => v.split(';')[0]).join('; ')
const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }
const api = async (path, body) => {
  const res = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!res.ok) throw new Error('HTTP_' + res.status + ':' + (await res.text()).slice(0, 200))
  return res.json()
}
const who = await api('/api/session')
const conversationId = randomUUID()
await api('/api/conversations', { id: conversationId, title: 'Skill PC16 synthetic example' })
const growthSnapshot = async () => {
  const growth = await api('/api/growth?conversation=' + conversationId)
  return growth.items.filter(i => !i.unavailableReason && ['active', 'proposed'].includes(i.status))
    .map(i => ({ kind: i.kind, assertion: i.assertion, status: i.status, text: String(i.text || '').slice(0, 80), revision: i.revision, id: i.id, validUntil: i.validUntil ?? null }))
}
const send = async text => {
  const res = await fetch(origin + '/api/conversations/' + conversationId + '/messages', {
    method: 'POST', headers, body: JSON.stringify({ requestId: randomUUID(), text }),
  })
  if (!res.ok) throw new Error('TURN_HTTP_' + res.status + ':' + (await res.text()).slice(0, 300))
  const reader = res.body.getReader(), decoder = new TextDecoder()
  let pending = '', reply = null, done = null
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break
    pending += decoder.decode(chunk.value, { stream: true })
    let boundary
    while ((boundary = pending.indexOf('\n\n')) >= 0) {
      const lines = pending.slice(0, boundary); pending = pending.slice(boundary + 2)
      const line = lines.split('\n').find(v => v.startsWith('data: ')); if (!line) continue
      const value = JSON.parse(line.slice(6))
      if (value.type === 'delta' && value.saved === true) reply = value.text
      if (value.type === 'error') throw new Error('TURN_STREAM_' + value.code)
      if (value.type === 'done') done = value
    }
  }
  if (!done) throw new Error('INCOMPLETE_STREAM')
  return { reply, done }
}
const show = async (label, before, after) => {
  const beforeIds = new Set(before.map(i => i.id))
  console.log('\n=== ' + label + ' ===')
  console.log('growth new/changed:', after.filter(i => !beforeIds.has(i.id) || i.revision > 1).map(i => i.kind + '/' + i.assertion + ': ' + i.text + (i.validUntil ? ' (until ' + i.validUntil + ')' : '')))
}

console.log(JSON.stringify({ origin, userId: who.id, conversationId, paid, note: 'synthetic adult student; real product state only' }))
if (!paid) {
  console.log('Free checks OK. Paid plan (4 turns, ~4-8 provider calls incl. possible repairs):\n' +
    ' 1 "我大三，最近在就业和考研之间犹豫。给社团做了一套招新材料，最后没用上，我开始怀疑自己是不是不行。"\n' +
    ' 2 (answer the follow-up the product actually asks with the hidden process fact)\n' +
    ' 3 "这周我只有两小时，给我一个现在就能开始的具体行动。"\n' +
    ' 4 correction turn "更正一下：材料其实按时交了，是对方临时改了方案才没用的。" then read growth to confirm the corrected fact drives the state.')
  return 0
}

let before = await growthSnapshot()
const steps = [
  '我大三，最近在就业和考研之间犹豫。给社团做了一套招新材料，最后没用上，我开始怀疑自己是不是不行。',
  '补充一下：那套材料是迎新周前两天交的，外联部长说方向临时改了才没采用，内容本身他没说有问题。',
  '这周我只有两小时，给我一个现在就能开始的具体行动。',
  '更正一下：我是大二，刚才说成大三了。',
]
for (const [index, text] of steps.entries()) {
  const turn = await send(text)
  const after = await growthSnapshot()
  console.log('\n--- turn ' + (index + 1) + ' ---\nuser: ' + text + '\nreply: ' + String(turn.reply).slice(0, 400))
  await show('turn ' + (index + 1) + ' state', before, after)
  console.log('receipt: ' + JSON.stringify(turn.done.stateChange ?? null))
  before = after
}
console.log('\nPC16 harness finished. Inspect /api/growth for the final personal understanding.')
return 0
}

main().then(code => { if (code) process.exitCode = code }).catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
