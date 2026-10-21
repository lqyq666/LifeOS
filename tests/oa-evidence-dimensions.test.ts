import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {openUnreportedChoiceQuestion} from '../server/reply-draft.ts'
import {reportedEvidenceFromText} from '../server/turn-contract.ts'
import {unresolvedTwoFactors} from '../server/review-repairs.ts'
import {buildTurnPrompt,providerTurnMessages} from '../server/turn-prompt.ts'
const saved=JSON.parse(readFileSync(new URL('./fixtures/oa-semantic-failures.json',import.meta.url),'utf8'))
const turn=(chain:string,index:number)=>saved.turns.find((x:any)=>x.chain===chain&&x.index===index)

test('actual OE type question retains its authored clarification instead of a generic fallback',()=>{
 const x=JSON.parse(readFileSync(new URL('./fixtures/oe-open-question-failure.json',import.meta.url),'utf8'))
 const expected=x.raw.reply.split('——')[0]+'？'
 assert.equal(openUnreportedChoiceQuestion(x.raw.reply,x.user),expected)
 assert.ok(expected.includes('自由')&&expected.includes('哪种'))
 assert.doesNotMatch(expected,/课表|经济|判断/)
 for(const reply of ['你希望减少哪类安排——是上课还是兼职？']){
  assert.equal(openUnreportedChoiceQuestion(reply,x.user),reply.split('——')[0]+'？')
 }
 const notOpen='哪怕换个地方——是时间少还是地点受限？'
 assert.notEqual(openUnreportedChoiceQuestion(notOpen,x.user),'哪怕换个地方？','哪怕 is not a question word')
})

test('actual OA unsafe alternatives keep the authored open stem or the reported feeling topic',()=>{
 const freedom=turn('freedom-explore',0),feeling=turn('friend-interest',0)
 const first=openUnreportedChoiceQuestion(freedom.raw.reply,freedom.user)
 assert.equal(first,'你希望这份自由主要改变现在的哪一部分？','retain the actual open stem rather than fabricate a different topic')
 const second=openUnreportedChoiceQuestion(feeling.raw.reply,feeling.user)
 assert.ok(second?.includes('昨晚那种轻松'),'an attributed feeling need not repeat a feeling verb to remain the question topic')
 assert.doesNotMatch(second!,/身体出汗|氛围|影响你的判断|还是/)
})

test('known subjective explanation and the exact unresolved causal alternatives remain distinct',()=>{
 const known=reportedEvidenceFromText(turn('friend-interest',1).user).sourceBounds
 assert.ok(known.some(b=>b.kind==='personal_subjective_report'&&b.explanationKind==='explicit_self_explanation'&&b.quote.includes('不用表现')))
 for(const text of ['我轻松的原因还不知道。','我觉得轻松可能是因为室友。','朋友说我觉得轻松是因为他。'])assert.ok(!reportedEvidenceFromText(text).sourceBounds.some(b=>b.explanationKind==='explicit_self_explanation'),text)
 const text=turn('friend-interest',2).user,evidence=reportedEvidenceFromText(text).sourceBounds
 const factors=unresolvedTwoFactors(text)
 assert.deepEqual(factors,{first:'运动本身',second:'这个室友带来的'},'the existing parser remains the sole factor interpretation')
 assert.ok(evidence.some(b=>b.kind==='unresolved_causal_factors'&&b.alternatives?.first===factors!.first&&b.alternatives?.second===factors!.second&&text.includes(b.quote)))
 for(const text of ['朋友说不确定是运动本身还是这个室友带来的。','如果不确定是运动本身还是这个室友带来的怎么办？','“不确定是运动本身还是这个室友带来的”。'])assert.ok(!reportedEvidenceFromText(text).sourceBounds.some(b=>b.kind==='unresolved_causal_factors'),text)
})

test('actual OA question counts and absolute elapsed time cannot share a measurement unit or invented baseline',()=>{
 const count=reportedEvidenceFromText(turn('no-direction',2).user).sourceBounds
 assert.ok(count.some(b=>b.kind==='reported_count_change'&&b.measure==='questions_count'&&b.quote==='少问了我一次'))
 const duration=reportedEvidenceFromText(turn('no-direction',4).user).sourceBounds
 assert.ok(duration.some(b=>b.kind==='absolute_duration'&&b.measure==='elapsed_time'&&b.comparisonBaseline==='not_implied_by_this_value'))
 assert.ok(!duration.some(b=>b.measure==='questions_count'))
 assert.ok(!count.some(b=>b.measure==='elapsed_time'))
})

test('actual saved cross-session reports carry distinct dimensions into the provider wire payload',()=>{
 for(const chain of ['friend-interest','no-direction']){
  const summary=turn(chain,5),id=summary.requestId
  const prompt=buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:summary.user}],growth:summary.memoryAfter})
  const wire=JSON.parse(providerTurnMessages(prompt,{provider:'bailian',id:'qwen3.8-max'})[0]!.content as string)
  const bounds=wire.currentTask.responseScope.reportedEvidence.sourceBounds
  const sourceGroups=bounds.map((b:any)=>JSON.stringify([b.source.sourceMessageIds??[b.source.id],b.kind,b.quote,b.measure??null,b.explanationKind??null,b.alternatives??null]))
  assert.equal(new Set(sourceGroups).size,sourceGroups.length,'the same source statement is one evidence annotation even when multiple memory records retain it')
  if(chain==='friend-interest'){
   assert.ok(bounds.some((b:any)=>b.explanationKind==='explicit_self_explanation'&&b.source.type==='growth'&&b.quote.includes('不用表现')))
   assert.ok(bounds.some((b:any)=>b.kind==='unresolved_causal_factors'&&b.alternatives.first==='运动本身'&&b.alternatives.second==='这个室友带来的'&&b.source.type==='growth'))
  }else{
   assert.ok(bounds.some((b:any)=>b.measure==='questions_count'&&b.source.type==='growth'))
   assert.ok(bounds.some((b:any)=>b.measure==='elapsed_time'&&b.comparisonBaseline==='not_implied_by_this_value'&&b.source.type==='growth'))
  }
 }
})

test('distinct or unavailable original-message identities do not collapse into one report',()=>{
 const summary=turn('no-direction',5),item=summary.memoryAfter.find((x:any)=>x.text.includes('20秒'))
 assert.ok(item)
 for(const known of [true,false]){
  const copies=[0,1].map(i=>({...item,id:'00000000-0000-4000-8000-00000000000'+i,sources:known?[{...item.sources[0],id:'10000000-0000-4000-8000-00000000000'+i}]:[]}))
  const prompt=JSON.parse(buildTurnPrompt({currentMessageId:summary.requestId,messages:[{id:summary.requestId,role:'user',content:summary.user}],growth:copies}))
  const duration=prompt.currentTask.responseScope.reportedEvidence.sourceBounds.filter((b:any)=>b.measure==='elapsed_time')
  assert.equal(duration.length,2,known?'different message sources stay distinct':'missing origin does not authorize merging records')
 }
 const origin=item.sources.find((s:any)=>s.type==='message'),aliases=[{...item,sources:[origin]},{...item,id:'20000000-0000-4000-8000-000000000001',sources:[origin,origin]}]
 const grouped=JSON.parse(buildTurnPrompt({currentMessageId:summary.requestId,messages:[{id:summary.requestId,role:'user',content:summary.user}],growth:aliases})).currentTask.responseScope.reportedEvidence.sourceBounds
 assert.equal(grouped.filter((b:any)=>b.measure==='elapsed_time').length,1,'repeated identifiers do not change the original-message set')
})
