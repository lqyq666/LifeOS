import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mainCompanionPolicy,extractCompanionPolicies} from '../server/companion-policy.ts'
import {turnSystemPrompt,buildTurnPrompt} from '../server/turn-prompt.ts'
import {deriveTurnContract,bindRequestedSummarySchema} from '../server/turn-contract.ts'

test('runtime prompt avoids a framing-only lead example without invalidating the original native capability probe',()=>{
 const contract=deriveTurnContract({text:'请更新当前理解。',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
 const full=turnSystemPrompt('default','qwen3.8-flash')
 assert.equal(createHash('sha256').update(full).digest('hex'),'a67a5baded5ce6a82d8bbe60180a264e1bfd6a82cd0b25efaba3c84445582e46')
 const prompt=turnSystemPrompt('default','qwen3.8-flash',contract,false)
 assert.ok(prompt.includes(mainCompanionPolicy.instructions))
 // This budget covers the existing runtime prompt, excluding the exact
 // instructions relocated from per-turn metadata into its cacheable prefix.
 const context=JSON.parse(buildTurnPrompt({currentMessageId:'current',messages:[{id:'current',role:'user',content:'请更新当前理解。'}]}))
 const cachedRules=context.currentTask.responseScope.rules.filter((rule:string)=>prompt.includes(rule))
 assert.equal(cachedRules.length,15)
 assert.ok(prompt.length-cachedRules.join('\n').length<14000)
 assert.doesNotMatch(prompt,/"lead":"先核对课程先修要求。"/)
})

test('one-sentence summaries cannot create a separate short lead and a second full sentence',()=>{
 const text='只给一句阶段理解。'
 const contract=bindRequestedSummarySchema(deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false,readOnly:true}),text)
 assert.equal(Object.hasOwn((contract.schema as any).properties,'lead'),false)
 const prompt=turnSystemPrompt('default','qwen3.8-flash',contract,false)
 assert.match(prompt,/不输出lead/)
})

test('normal LifeOS requests consume the versioned grilling policy instead of a detached file',()=>{
  const contract=deriveTurnContract({text:'我不知道毕业后想做什么，想从最近经历开始理清。',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
  const prompt=turnSystemPrompt('default','qwen3.8-flash',contract,false)
  assert.equal(mainCompanionPolicy.version,'1.3.0-candidate')
  assert.equal(mainCompanionPolicy.grilling.version,'lifeos-grilling/1.0.19')
  assert.ok(prompt.includes(mainCompanionPolicy.grilling.instructions))
  assert.match(prompt,/Ask one[\s\S]*change the current understanding or next action/)
  assert.match(prompt,/direct deliverables stay direct/)
  assert.match(prompt,/Do not invent a motive or force[\s\S]{0,8}alternatives/)
  assert.match(prompt,/what outcome the person wants this path to change/)
  assert.match(prompt,/不得给本人未报告的动机或价值补选项/)
  assert.match(prompt,/本人原话已经提出两个选项/)
  assert.match(prompt,/紧接上一问给出的具体回答必须关闭对应unknown/)
  assert.match(prompt,/要求一个动作时只给一项可执行动作/)
  assert.match(prompt,/Reported conditions are not refusals/)
  assert.match(prompt,/Silence is unresolved, not\s+refusal/)
  assert.match(prompt,/A single lead is not a product, a demo or a universal demand/)
  assert.match(prompt,/not a sample-size plan, a recruitment plan or a manual\s+MVP/)
  assert.match(prompt,/this turn is not business validation/)
  assert.match(prompt,/do not propose selling, pricing,\s+a pilot, recruiting participants or a manual MVP/)
  assert.match(prompt,/Interview questions leave "nothing happened", "no trouble"/)
  assert.match(prompt,/Ask first whether the experience happened at\s+all/)
  assert.match(prompt,/do not ask it again/)
  assert.match(prompt,/deliver a startable action with a stop point/)
  assert.match(prompt,/A read receipt is not a content evaluation/)
  assert.match(prompt,/prefer changing one relevant condition/)
  assert.match(prompt,/do\s+not end with a question or a new task/)
  assert.match(prompt,/separate sent, delivered, read, replied/)
  assert.match(prompt,/Do not infer a deadline, pressure, motive or context/)
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
