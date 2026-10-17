import test from 'node:test'
import assert from 'node:assert/strict'
import {crisisSupportIntent,grillingInteractionMode} from '../server/grilling-policy.ts'
import {deriveTurnContract} from '../server/turn-contract.ts'
import {buildTurnPrompt} from '../server/turn-prompt.ts'

test('grilling activates only for exploration and preserves direct or listening intent',()=>{
  assert.equal(grillingInteractionMode('我不知道毕业后想做什么，最近很迷茫。'),'explore')
  assert.equal(grillingInteractionMode('只想聊聊，今天不要追问。'),'listen')
  assert.equal(grillingInteractionMode('直接给我一段请教消息，不要分析。',{material:true}),'direct_delivery')
  assert.equal(grillingInteractionMode('解释一下递归。'),'ordinary')
})

test('explicit first-person crisis switches off growth, event and planning lanes',()=>{
  const text='我不想活了，想结束生命。'
  assert.equal(crisisSupportIntent(text),true)
  assert.equal(crisisSupportIntent('如果有人说“我不想活了”，该怎么帮助？'),false)
  const contract=deriveTurnContract({text,knowledgeCount:0,currentEventExists:true,planIntent:true,material:true})
  assert.deepEqual(contract.capabilities,{growth:false,candidate:false,plan:false,citations:false,event:false,material:false})
})

test('normal prompt carries server-derived grilling mode and exact policy fingerprint',()=>{
  const id='00000000-0000-4000-8000-000000000001'
  const prompt=JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:'我在就业和考研之间犹豫。'}]}))
  assert.equal(prompt.grilling.policyVersion,'lifeos-grilling/1.0.0')
  assert.equal(prompt.grilling.interactionMode,'explore')
  assert.match(prompt.grilling.policyDigest,/^[a-f0-9]{64}$/)
})
