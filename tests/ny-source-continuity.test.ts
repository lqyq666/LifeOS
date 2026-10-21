import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {groundUnsupportedOperationalResources,safeEarlySentence} from '../server/reply-draft.ts'
import {reportedEvidenceFromText} from '../server/turn-contract.ts'
import {responseRequestScope,scanUserClauses} from '../server/user-command-spans.ts'
const capture=JSON.parse(readFileSync(new URL('./fixtures/ny-semantic-failures.json',import.meta.url),'utf8'))

test('actual NY public rhythm lookup is retained rather than replaced with a job description',()=>{
 const turn=capture.turns.find((t:any)=>t.chain==='freedom-explore'&&t.index===3)
 assert.equal(groundUnsupportedOperationalResources(turn.raw.reply,turn.user),null)
 const prefix=safeEarlySentence(JSON.stringify(turn.raw),120,'lead',turn.user)
 assert.ok(prefix&&turn.raw.reply.includes(prefix),'the substantive actual preview remains part of the final content')
 assert.notEqual(groundUnsupportedOperationalResources('去 LinkedIn 私信几位从业者了解岗位。',turn.user),null,'unrequested outreach protection remains')
})

test('a direct request for a tentative understanding keeps summary scope under a no-task condition',()=>{
 const text=capture.turns.find((t:any)=>t.chain==='refusal-correction'&&t.index===3).user
 assert.equal(responseRequestScope(text).summaryRequested,true)
 assert.equal(responseRequestScope(text).actionRequested,false)
 assert.ok(scanUserClauses(text).some(c=>c.conditional),'format recognition does not change fact/control classification')
 for(const text of ['“你能形成什么暂定理解？”。','老师问你能形成什么暂定理解？','如果我有精力，请给一个行动。'])assert.equal(responseRequestScope(text).summaryRequested,false,text)
})

test('external observations and an explicitly unresolved result keep their original epistemic role',()=>{
 const remote=capture.turns.find((t:any)=>t.chain==='freedom-explore'&&t.index===4).user
 const thirdParty=reportedEvidenceFromText(remote).sourceBounds
 assert.ok(thirdParty.some(b=>b.kind==='attributed_observation'&&b.quote==='他说地点自由'))
 assert.ok(!reportedEvidenceFromText('我在意地点自由。').sourceBounds.some(b=>b.kind==='attributed_observation'))
 const unknown=reportedEvidenceFromText('老师没回复只是结果未知。').sourceBounds
 assert.ok(unknown.some(b=>b.kind==='unresolved_outcome'&&b.quote==='老师没回复只是结果未知'))
 for(const text of ['如果结果未知怎么办？','“结果未知”。','结果并非未知。','结果未知的问题已经解决。'])assert.ok(!reportedEvidenceFromText(text).sourceBounds.some(b=>b.kind==='unresolved_outcome'),text)
})
