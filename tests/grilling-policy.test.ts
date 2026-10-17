import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mainCompanionPolicy,extractCompanionPolicies} from '../server/companion-policy.ts'
import {turnSystemPrompt} from '../server/turn-prompt.ts'
import {deriveTurnContract} from '../server/turn-contract.ts'

test('normal LifeOS requests consume the versioned grilling policy instead of a detached file',()=>{
  const contract=deriveTurnContract({text:'我不知道毕业后想做什么，想从最近经历开始理清。',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
  const prompt=turnSystemPrompt('default','qwen3.8-flash',contract,false)
  assert.equal(mainCompanionPolicy.version,'1.3.0-candidate')
  assert.equal(mainCompanionPolicy.grilling.version,'lifeos-grilling/1.0.7')
  assert.ok(prompt.includes(mainCompanionPolicy.grilling.instructions))
  assert.match(prompt,/Ask one[\s\S]*change the current understanding or next action/)
  assert.match(prompt,/direct deliverables stay direct/)
  assert.match(prompt,/Do not invent a motive or force[\s\S]{0,8}alternatives/)
  assert.match(prompt,/what outcome the person wants this path to change/)
  assert.match(prompt,/不得给本人未报告的动机或价值补选项/)
  assert.match(prompt,/本人原话已经提出两个选项/)
  assert.match(prompt,/紧接上一问给出的具体回答必须关闭对应unknown/)
  assert.match(prompt,/要求一个动作时只给一项可执行动作/)
  assert.match(prompt,/Store no hidden chain of thought/)
})

test('grilling policy replacement changes the independently auditable digest',()=>{
  const original=extractCompanionPolicies(mainCompanionPolicy.instructions+'\n## Three kinds of unknown')
  const changedSource=(mainCompanionPolicy.instructions+'\n## Three kinds of unknown').replace('Ask one','Ask exactly one')
  const changed=extractCompanionPolicies(changedSource)
  const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
  assert.equal(digest(original.grillingInstructions),mainCompanionPolicy.grilling.policyDigest)
  assert.notEqual(digest(changed.grillingInstructions),mainCompanionPolicy.grilling.policyDigest)
  assert.throws(()=>extractCompanionPolicies('## When to follow up, deliver, or stop\nmissing section'),/MAIN_COMPANION_POLICY_UNAVAILABLE/)
})
