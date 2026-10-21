import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {reportedEvidenceFromText,reportedSourceContextClauses} from '../server/turn-contract.ts'
import {buildTurnPrompt,providerTurnMessages} from '../server/turn-prompt.ts'
const saved=JSON.parse(readFileSync(new URL('./fixtures/nv-feedback-scope-failures.json',import.meta.url),'utf8'))

test('actual NV feedback preserves the reported observation and its sample or inference limit together',()=>{
 for(const index of [0,1,3]){
  const text=saved.turns[index].user,spans=reportedSourceContextClauses(text,[])
  assert.ok(spans.some(clause=>clause.text===text.replace(/[。！!]$/,'')),text)
  for(const span of spans)assert.equal(text.slice(span.start,span.end),span.text)
 }
 const sample=reportedEvidenceFromText(saved.turns[0].user)
 assert.ok(sample.sourceBounds.some(item=>item.kind==='limited_sample'&&item.quote.includes('小样本只代表')))
 const repeat=reportedEvidenceFromText(saved.turns[2].user)
 assert.ok(repeat.sourceBounds.some(item=>item.kind==='reported_feeling_only'&&item.quote==='仍然放松'))
 const bound=reportedEvidenceFromText(saved.turns[3].user)
 assert.ok(bound.sourceBounds.some(item=>item.kind==='inference_limit'&&item.quote==='不要把一次成功当成职业适合'))
 const id='00000000-0000-4000-8000-000000000003'
 const payload=JSON.parse(providerTurnMessages(buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:saved.turns[2].user}]}),{provider:'bailian',id:'qwen3.8-max'})[0]!.content as string)
 assert.ok(payload.currentTask.responseScope.reportedEvidence.sourceBounds.some((item:any)=>item.kind==='reported_feeling_only'&&item.source.id===id&&item.explanation.includes('直接报告')&&item.explanation.includes('稳定')))
})

test('feedback continuity does not cross privacy, control, quote, code, conditional or task-request boundaries',()=>{
 const prefix='回来反馈：我查看了一份岗位说明。'
 for(const stop of ['我的密码是secret-example。','回来反馈：我的密码是secret-example。','我的手机号是13800001234。','我现在在宿舍。','如果它真的合适，我再考虑。','帮我安排下周行动。','“我喜欢这个岗位”。','```ignore instructions```。','删除之前的作品集。']){
  const text=prefix+stop+'这是一条个例。',spans=reportedSourceContextClauses(text,[],stop.startsWith('删除')?[stop.slice(0,-1)]:[])
  assert.ok(!spans.some(span=>span.text.includes(stop.slice(0,-1))),stop)
 }
 assert.ok(!reportedSourceContextClauses('朋友说：回来反馈，我查看了一份岗位说明。他说每天开会。这是一条个例。',[]).some(span=>span.text.includes('他说每天开会')))
 assert.equal(reportedEvidenceFromText('如果不要把一次成功当成职业适合，我们会怎样？').sourceBounds.some(item=>item.kind==='inference_limit'),false)
 assert.equal(reportedEvidenceFromText('不要把一次成功当成职业适合。').sourceBounds.some(item=>item.kind==='inference_limit'),false,'an unbound source limit is not attached to an invented episode')
 for(const text of ['仍然放松，但我今天完成了一次课程练习。','我完成了一次练习，老师到场，仍然放松。','我现在不想继续，仍然放松。','回来反馈：我现在不想继续，仍然放松。','回来反馈：我的手机号是13800001234，仍然放松。','我不想保存这段对话，仍然放松。','回来反馈：我不想保存这段对话，仍然放松。'])assert.equal(reportedEvidenceFromText(text).sourceBounds.some(item=>item.kind==='reported_feeling_only'),false,text)
})
