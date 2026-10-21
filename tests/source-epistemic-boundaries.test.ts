import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {reportedEvidenceFromText,reportedSourceContextClauses,reportedPursuitClauses} from '../server/turn-contract.ts'
import {buildTurnPrompt,providerTurnMessages} from '../server/turn-prompt.ts'
const capture=JSON.parse(readFileSync(new URL('./fixtures/nt-epistemic-failures.json',import.meta.url),'utf8'))

test('actual NT source projection preserves observation versus cause and explicit personal uncertainty',()=>{
 const access=reportedEvidenceFromText(capture.turns[0].user)
 assert.ok(access.sourceBounds.some(bound=>bound.kind==='reported_observation'&&bound.quote.includes('导师回复说手机打不开链接')))
 const text=capture.turns[1].user,uncertain='我还不知道这是否只是一次偶然',evidence=reportedEvidenceFromText(text)
 assert.ok(evidence.sourceBounds.some(bound=>bound.kind==='explicit_uncertainty'&&bound.quote===uncertain))
 const anchors=reportedPursuitClauses(text).map(clause=>clause.text)
 assert.ok(reportedSourceContextClauses(text,anchors).some(clause=>clause.text===uncertain),'source-backed uncertainty has the same fallback persistence path as its known goal')
 const id='00000000-0000-4000-8000-000000000001',serialized=buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:text}]})
 const payload=JSON.parse(providerTurnMessages(serialized,{provider:'bailian',id:'qwen3.8-max'})[0]!.content as string)
 const bounds=payload.currentTask.responseScope.reportedEvidence.sourceBounds
 assert.ok(bounds.some((bound:any)=>bound.kind==='explicit_uncertainty'&&bound.quote===uncertain&&bound.source.id===id&&bound.explanation.includes('未知')))
 assert.ok(bounds.some((bound:any)=>bound.kind==='desired_outcome'&&bound.explanation.includes('稳定偏好')))
 assert.equal(reportedEvidenceFromText('导师确认已经读到邮件').participants[0]!.states.read.status,'reported_read','the annotation must not downgrade a reported state')
})

test('uncertainty preservation does not create a profile from questions, quoted stories, controls or sensitive details',()=>{
 const anchor=['我会主动继续整理']
 for(const text of ['如果我还不知道这是否只是一次偶然，那先等等。','朋友说：“我还不知道这是否只是一次偶然。”','```\n我还不知道这是否只是一次偶然\n```']){
  assert.equal(reportedEvidenceFromText(text).sourceBounds.some(b=>b.kind==='explicit_uncertainty'),false,text)
  assert.deepEqual(reportedSourceContextClauses(text,[]),[],text)
 }
 assert.equal(reportedEvidenceFromText('我不知道递归是什么。').sourceBounds.some(b=>b.kind==='explicit_uncertainty'),false)
 assert.deepEqual(reportedSourceContextClauses('我不知道递归是什么。',[]),[])
 for(const text of ['我想了解课程要求。我还不知道这是否只是一次偶然。','我会主动继续整理，主要想更快看出关键。今天的天气很好。我还不知道这是否只是一次偶然。'])assert.ok(!reportedSourceContextClauses(text,reportedPursuitClauses(text).map(c=>c.text)).some(c=>c.text==='我还不知道这是否只是一次偶然'),text)
 assert.deepEqual(reportedSourceContextClauses('我不知道递归是什么。',anchor),[],'an unrelated anchor does not turn a knowledge question into personal memory')
 assert.deepEqual(reportedSourceContextClauses('我还不知道这是否只是一次偶然。',anchor),[],'an anchor from another message cannot supply the missing referent')
 const control='我还不知道这是否只是一次偶然'
 assert.ok(!reportedSourceContextClauses(control,anchor,[control]).some(c=>c.text===control))
 assert.deepEqual(reportedSourceContextClauses('我还不知道手机号13800001234是否能联系上。',anchor),[])
})


test('actual NU neutral preference retains priority scope in compact summary evidence',()=>{
 const text='我主要在意能自己安排一天中专注工作的时间，不在意当老板，也不想承担找客户和收款。'
 const evidence=reportedEvidenceFromText(text)
 assert.ok(evidence.sourceBounds.some(item=>item.kind==='nonpriority_not_refusal'&&item.quote==='不在意当老板'))
 assert.equal(evidence.preferences.find(item=>item.subject==='当老板')?.isRefusal,false)
 assert.equal(evidence.preferences.find(item=>item.subject==='找客户和收款')?.isRefusal,true)
 const id='00000000-0000-4000-8000-000000000002'
 const payload=JSON.parse(providerTurnMessages(buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:text}]}),{provider:'bailian',id:'qwen3.8-max'})[0]!.content as string)
 assert.ok(payload.currentTask.responseScope.reportedEvidence.sourceBounds.some((item:any)=>item.kind==='nonpriority_not_refusal'&&item.source.id===id&&item.explanation.includes('摘要')))
 assert.ok(!reportedEvidenceFromText('朋友说：“我不在意当老板。”').sourceBounds.some(item=>item.kind==='nonpriority_not_refusal'))
})
