import fs from 'node:fs'
import path from 'node:path'
import defectGate from './asserts/defect-gate.mjs'

const root = process.cwd()
const outDir = path.join(root, '.local', 'promptfoo')
fs.mkdirSync(outDir, {recursive: true})

const sources = [
  {set: 'set-1', version: 'candidate_1_0_13', file: '.local/new-heldout-1.0.13-vs-6cff01a.json'},
  {set: 'set-1', version: 'candidate_1_0_14', file: '.local/new-heldout-1.0.14-vs-6cff01a.json'},
  {set: 'set-2', version: 'candidate_1_0_15', file: '.local/new-heldout2-1.0.15-vs-6cff01a.json'},
  {set: 'set-3', version: 'candidate_1_0_16', file: '.local/new-heldout3-1.0.16-vs-6cff01a.json'},
  {set: 'set-4', version: 'candidate_1_0_17', file: '.local/new-heldout4-1.0.17-vs-6cff01a.json'},
]

const classify = (promptId) => {
  if (promptId.startsWith('zero-time')) return 'zero-time'
  if (promptId.startsWith('refusal')) return 'refusal'
  if (promptId.startsWith('correction')) return 'correction'
  if (promptId.startsWith('status')) return 'status'
  if (promptId.startsWith('single-lead')) return 'single-lead'
  if (promptId.startsWith('multi-prototype')) return 'clickable'
  if (promptId.startsWith('no-direction')) return 'one-question'
  if (promptId.startsWith('access') || promptId.includes('-access') || promptId.endsWith('-access')) return 'access'
  if (promptId.includes('two-factor')) return 'two-factor'
  return 'default'
}

const defectAssertion = [{type: 'javascript', value: 'file://./asserts/defect-gate.mjs'}]
const memoryAssertion = [{type: 'llm-rubric', value: 'file://./asserts/memory-rubric.txt', threshold: 1}]

const defectTests = []
const singleTurnReplies = []

for (const source of sources) {
  const data = JSON.parse(fs.readFileSync(path.join(root, source.file), 'utf8'))
  for (const row of data.results) {
    const promptId = row.id
    const userText = row.text
    const category = classify(promptId)
    const versions = {
      [source.version]: row.versions[source.version],
      baseline_6cff01a: row.versions.baseline_6cff01a,
    }
    for (const [version, payload] of Object.entries(versions)) {
      const reply = payload?.reply
      if (typeof reply !== 'string' || !reply.trim()) continue
      const vars = {id: `${source.set}:${version}:${promptId}`, set: source.set, version, promptId, userText, output: reply, category}
      const pass = Boolean(defectGate(reply, {vars}).pass)
      defectTests.push({vars, assert: defectAssertion})
      singleTurnReplies.push({...vars, pass})
    }
  }
}

// Cross-turn memory recall can only be exercised where prior context exists.
// The four single-turn sets have no prior turn, so their failures are classified
// by the deterministic gate, not by a memory rubric. The 36 chain turns below
// are the actual memory-recall probe.
const candidateFailures = singleTurnReplies.filter((row) => row.version.startsWith('candidate_') && !row.pass)
const candidatePassSample = singleTurnReplies.filter((row) => row.version.startsWith('candidate_') && row.pass).slice(0, 10)
const memoryTests = []

const chainData = JSON.parse(fs.readFileSync(path.join(root, '.local', 'grilling-1.0.13-six-chains-results-part1.json'), 'utf8'))
const byConversation = new Map()
for (const row of chainData.results) {
  const list = byConversation.get(row.conversationId) ?? []
  list.push(row)
  byConversation.set(row.conversationId, list)
}
let chainTurns = 0
for (const list of byConversation.values()) {
  list.sort((a, b) => a.index - b.index)
  let prior = ''
  for (const row of list) {
    const reply = row.semantic?.reply
    if (typeof reply !== 'string' || !reply.trim()) continue
    const id = `memory:chain:${row.chain}:${row.session}:${row.index}`
    memoryTests.push({
      vars: {id, block: `前文：\n${prior || '（无）'}\n本轮用户：${row.text}\n助手回复：${reply}`},
      assert: memoryAssertion,
    })
    prior += `用户：${row.text}\n助手：${reply}\n`
    chainTurns += 1
  }
}

const writeYamlAsJson = (file, value) => {
  // JSON is valid YAML; this avoids a YAML dependency in the repo.
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}

writeYamlAsJson(path.join(outDir, 'tests-defect.yaml'), defectTests)
writeYamlAsJson(path.join(outDir, 'tests-memory.yaml'), memoryTests)
fs.writeFileSync(path.join(outDir, 'dataset-summary.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  defectTests: defectTests.length,
  memoryTests: memoryTests.length,
  candidateDefectFailures: candidateFailures.length,
  candidatePassSample: candidatePassSample.length,
  chainTurns,
  defectByVersion: Object.fromEntries([...new Set(defectTests.map(t => t.vars.version))].map(version => [version, defectTests.filter(t => t.vars.version === version).length])),
  defectByCategory: Object.fromEntries([...new Set(defectTests.map(t => t.vars.category))].map(category => [category, defectTests.filter(t => t.vars.category === category).length])),
}, null, 2))
console.log(JSON.stringify({outDir, defectTests: defectTests.length, memoryTests: memoryTests.length, candidateDefectFailures: candidateFailures.length, candidatePassSample: candidatePassSample.length, chainTurns}))
