import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {repairUnsupportedPreferenceClaim,openUnreportedChoiceQuestion} from '../server/reply-draft.ts'
import {reportedEvidenceFromText,reportedPursuitClauses} from '../server/turn-contract.ts'
import {scanUserClauses} from '../server/user-command-spans.ts'
const turns=JSON.parse(readFileSync(new URL('./fixtures/og-known-goals-and-fit.json',import.meta.url),'utf8')).turns
const turn=(id:string)=>turns.find((x:any)=>x.id===id)

test('personal-fit evidence and conditional meaning are not reinterpreted by new lexical repairs',()=>{
 const x=turn('C3-T5'),prefs=reportedEvidenceFromText(turn('C3-T2').user).preferences
 const source='我要求岗位完全远程且无需找客户；招聘公告明确写明该岗位完全远程、无需找客户，请只判断这两项'
 const sourced='该岗位满足你完全远程、无需找客户的要求。'
 for(const [reply,user] of [[sourced,source],['如果你确认，它符合你的偏好；否则不继续。',''],['只在你确认后，它符合你的偏好。',''],[x.assistant,x.user]]){
  assert.equal(repairUnsupportedPreferenceClaim(reply,user,prefs)??reply,reply)
 }
 // The old conditional bad output is retained as a failed fixture. Only real
 // generation and independent semantic acceptance can demonstrate its repair.
})

test('compatible goal sources remain facts; reconsideration preserves open questions without binary authorization',()=>{
 const x=turn('C6-T6'),goals=x.memoryAfter.filter((g:any)=>g.kind==='goal'&&g.status==='active'&&['user_reported','user_edit'].includes(g.assertion))
 assert.ok(goals.some((g:any)=>g.text.includes('减少自己反复找东西的时间')))
 assert.ok(goals.some((g:any)=>g.text.includes('更快看出哪些信息关键')))
 const question='你真正想要的是减少自己反复找东西的时间还是更快看出哪些信息关键？',request='只问一个问题，帮我重新想清楚这两个目标。'
 assert.ok(openUnreportedChoiceQuestion(question,request),'reconsidering compatible goals does not authorize an exclusive binary')
 assert.ok(openUnreportedChoiceQuestion(question,'今天看看最近的进展。'))
 const open='你现在想先弄清这两个目标的哪个环节？'
 assert.equal(openUnreportedChoiceQuestion(open,request),null,'preserve an actually open clarification question')
 assert.ok(reportedPursuitClauses('我现在的目标是考研。').some(c=>c.text==='我现在的目标是考研'))
 assert.ok(scanUserClauses('校友说，你真正想要的是自由还是稳定。').at(-1)!.attributedToOther)
 assert.ok(!scanUserClauses('我给校友说了目前安排。')[0]!.attributedToOther)
})
