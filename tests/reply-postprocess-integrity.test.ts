import test from 'node:test'
import assert from 'node:assert/strict'
import {renderCoachReply} from '../server/coach-reply.ts'
import {weeklyPlanExplanation} from '../server/reply-draft.ts'
import {normalizeWeeklyPlanReply,type WeeklyPlanInput} from '../server/weekly-plans.ts'
import {streamingReplyText} from '../server/reply-stream.ts'

test('material deduplication preserves unrelated emphasis and the entire generated reply',()=>{
 const content='可以说明一下实际任务吗？\n\n不方便也可以拒绝。',reply='**先核对，不代表已经联系。**\n\n**可以说明一下实际任务吗？**\n\n**不方便也可以拒绝。**\n\n**边界**：实际效果仍未知。'
 const turn:any={reply,event:{target:{operation:'create',title:'请教材料',source:{messageId:'00000000-0000-4000-8000-000000000001',quote:'请起草'}},action:{operation:'create',draft:{content}}}}
 assert.equal(renderCoachReply(turn),reply)
 assert.equal(turn.event.action.draft.content,content)
})

test('plan explanation retains whole paragraphs containing time, reasons and unknowns',()=>{
 const reply='**为什么这样安排**\n\n- 先用30分钟看课程要求：这是了解任务范围，不代表已完成复习；能否兼顾仍未知。\n\n**尚未采纳**\n合计90分钟只是建议，剩余时间应留给休息。'
 assert.equal(weeklyPlanExplanation(reply),reply)
})

test('plan label normalization never rewrites quoted user text or code in model prose',()=>{
 const reply='你在文档里写过`preview`。\n\n**review** 是原始任务代号，不是已经执行的结果。'
 const plan={items:[{action:'review',minutes:30,directionScopes:[]}]} as unknown as WeeklyPlanInput
 assert.equal(normalizeWeeklyPlanReply(reply,plan),reply)
})

test('stream projection preserves the complete generated field rather than a display-only character cut',()=>{
 const reply='**完整解释**\n\n'+'保留这段理由和未知。'.repeat(1700)+'\n\n**最终问题仍在这里？**'
 assert.equal(streamingReplyText(JSON.stringify({reply})),reply)
})

import {parseActionCoachTurn} from '../server/action-coach-contracts.ts'

test('an explicitly delimited final JSON after analysis is authoritative, never discarded as tag noise',()=>{
 const first=JSON.stringify({reply:'这是尚未完成的草稿。'}),final=JSON.stringify({reply:'**最终完整回答**\n\n保留理由、未知以及最后的问题？'})
 assert.equal(parseActionCoachTurn(first+'</analysis>'+final).reply,JSON.parse(final).reply)
 assert.equal(parseActionCoachTurn(first+'</thinking>'+final).reply,JSON.parse(final).reply)
})

test('analysis markers inside the authoritative reply are literal user-visible text',()=>{
 const reply='这里的`</analysis>`只是代码示例。\n\n实际正文继续完整保留。'
 assert.equal(parseActionCoachTurn(JSON.stringify({reply})).reply,reply)
})

test('incomplete or conflicting delimited final JSON cannot silently fall back to the first draft',()=>{
 const first=JSON.stringify({reply:'草稿不代表最终答案。'})
 assert.throws(()=>parseActionCoachTurn(first+'</analysis>{"reply":"未完成'))
 assert.throws(()=>parseActionCoachTurn(first+'</analysis>'+JSON.stringify({reply:'最终一。'})+'</analysis>'+JSON.stringify({reply:'最终二。'})))
 assert.equal(parseActionCoachTurn(first+'</analysis>').reply,'草稿不代表最终答案。')
})

test('tag wrappers cannot hide a conflicting business frame, while identical frames remain harmless',()=>{
 const first=JSON.stringify({reply:'正式正文。'}),different=JSON.stringify({reply:'另一份不同的正文。'})
 for(const wrap of [(v:string)=>'<br>'+v,(v:string)=>'<result>'+v+'</result>',(v:string)=>'<body>'+v+'</body>']){
  assert.throws(()=>parseActionCoachTurn(first+wrap(different)))
  assert.equal(parseActionCoachTurn(first+wrap(first)).reply,'正式正文。')
 }
 assert.equal(parseActionCoachTurn(first+'<analysis>这是非正式推演。</analysis>'+different).reply,'另一份不同的正文。')
})
