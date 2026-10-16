import test from 'node:test'
import assert from 'node:assert/strict'
import {collectCoachStream,coachSpeedSummary} from '../../scripts/coach-stream-evidence.ts'
const response=(values:any[])=>new Response(values.map(value=>'data: '+JSON.stringify(value)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}})
test('SIMULATED timing ignores loading/raw deltas and withdraws rejected drafts; failed events remain auditable',async()=>{
  let clock=0
  const now=()=>clock+=100
  const complete=await collectCoachStream(response([{type:'loading'},{type:'text_delta',delta:'irrelevant'},{type:'draft',text:'你想先说哪一步？'},{type:'draft_discarded'},{type:'done',text:'实际保存的回复。'}]),0,now)
  assert.equal(complete.meaningfulFirstMs,500);assert.equal(complete.completionMs,500);assert.equal(complete.firstKind,'committed_reply')
  clock=0
  const draft=await collectCoachStream(response([{type:'draft',text:'你想先说哪一步？'},{type:'done',text:'你想先说哪一步？'}]),0,now)
  assert.equal(draft.meaningfulFirstMs,100);assert.equal(draft.completionMs,200)
  clock=0
  const plan=await collectCoachStream(response([{type:'draft',draftKind:'waiting_hint',text:'下周180分钟，正在核对具体分配。'},{type:'draft',draftKind:'safe_sentence',text:'下周建议安排：整理作品（180分钟）。'},{type:'done',text:'下周建议安排：整理作品（180分钟）。'}]),0,now)
  assert.equal(plan.meaningfulFirstMs,200);assert.equal(plan.firstSafeDraftMs,200);assert.equal(plan.completionMs,300)
  await assert.rejects(collectCoachStream(response([{type:'draft',text:'你想说什么？'},{type:'error',code:'SYNTHETIC_FAILURE'}]),0,now),(error:any)=>error.message==='SYNTHETIC_FAILURE'&&error.streamEvidence.events.length===2)
  await assert.rejects(collectCoachStream(response([{type:'loading'}]),0,now),/INCOMPLETE_STREAM/)
})
test('speed threshold requires at least 20 predeclared ordinary followups with no failed-sample exclusion',()=>{
  const turns=Array.from({length:20},()=>({sampleClass:'ordinary_followup',status:'SAVED',providerCallCount:1,meaningfulFirstMs:3000,completionMs:15000}))
  assert.equal(coachSpeedSummary(turns).status,'PASS');assert.equal(coachSpeedSummary(turns.slice(1)).status,'NOT_READY')
  assert.equal(coachSpeedSummary([...turns,{sampleClass:'ordinary_followup',status:'FAILED',providerCallCount:1,meaningfulFirstMs:0,completionMs:0}]).status,'NOT_READY')
  assert.equal(coachSpeedSummary([...turns,{sampleClass:'ordinary_followup',status:'SAVED',providerCallCount:0,meaningfulFirstMs:0,completionMs:0}]).status,'NOT_READY')
  turns[0]!.meaningfulFirstMs=5100;turns[1]!.meaningfulFirstMs=5100
  assert.equal(coachSpeedSummary(turns).status,'NOT_READY')
  assert.equal(coachSpeedSummary([...turns,{sampleClass:'long_material',status:'SAVED',providerCallCount:1,meaningfulFirstMs:1,completionMs:1}]).savedOrdinary,20)
})
