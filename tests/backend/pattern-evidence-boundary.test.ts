import test from 'node:test'
import assert from 'node:assert/strict'
import {derivePatternProposals,type PatternExperience} from '../../server/experience-patterns.ts'

const experiences=(quote:string):PatternExperience[]=>[1,2].map(i=>({id:'e'+i,revision:1,conversationId:'c'+i,sourceMessageId:'m'+i,quote,action:'',result:'',valueIds:['value-creation']}))
test('cross-experience observations do not turn denied or planned adjustments into performed learning',()=>{
 for(const quote of ['我收到了反馈，但我没有修改报告。','我收到了反馈，打算修改报告。','如果我收到了反馈，我就修改报告。','室友收到了反馈，室友修改了报告。我只负责打印。']){
  assert.equal(derivePatternProposals(experiences(quote)).some(x=>x.behaviorKey==='feedback-iterate'),false,quote)
 }
 assert.equal(derivePatternProposals(experiences('我收到了反馈，后来我修改了报告。')).some(x=>x.behaviorKey==='feedback-iterate'),true)
})
test('source negation governs stale extracted labels and on-time observations',()=>{
 const rows=experiences('我没有按时交付报告。').map(e=>({...e,action:'按时交付报告',result:'按时'}))
 assert.equal(derivePatternProposals(rows).some(x=>x.behaviorKey==='deliver-ontime'),false)
 assert.equal(derivePatternProposals(experiences('我按时交付了报告。')).some(x=>x.behaviorKey==='deliver-ontime'),true)
})

test('whole propositions govern denial and ordinary omitted subjects retain ownership', () => {
  for (const quote of [
    '我按时交付这件事没有做到。',
    '我按时交付这件事并不存在。',
    '我按时交付了报告。后来我核对发现没有按时交付。',
    '我按时交付了报告。后来核对，前面那条记录不属实。',
    '我制作了海报。后来确认，那不是我做的。',
    '我按时交付了报告，后来确认其实晚了两天才交付。',
    '我收到了反馈，后来修改了报告，但那是室友改的。',
    '我按时交付了报告。后来发现，其实没有按时交付。',
    '我收到了反馈并修改了报告。后来发现，修改其实没有发生。',
    '我收到了反馈，但我否认自己修改过报告。',
    '我收到了反馈，修改过报告这件事并没有发生。',
    '我收到了反馈，所谓“修改过”并不属实。',
    '我收到了反馈。室友修改了报告。后来调整了内容。',
  ]) assert.equal(derivePatternProposals(experiences(quote)).length, 0, quote)
  for (const quote of [
    '我收到了反馈。后来修改了报告。',
    '收到反馈后，我修改了报告。',
    '我第一版没有修改。第二版我收到了反馈并修改了报告。',
  ]) assert.ok(derivePatternProposals(experiences(quote)).some(x => x.behaviorKey === 'feedback-iterate'), quote)
})

test('observations require the claimed performed behavior rather than a related keyword', () => {
  for (const [quote, key] of [
    ['我提前联系了导师。', 'deliver-ontime'],
    ['我压线交付了报告。', 'deliver-late'],
    ['我决定不做这件事。', 'initiate'],
    ['我学习设计。', 'create-output'],
    ['我迟了回复导师邮件，但按时交付了报告。', 'deliver-late'],
    ['报告按时交付了，我只负责旁观。', 'deliver-ontime'],
    ['报告收到了反馈并修改了，我只负责打印。', 'feedback-iterate'],
    ['海报制作了，我只负责验收。', 'create-output'],
    ['我按时联系了导师后来交付了报告。', 'deliver-ontime'],
    ['我做了课程选择，之后开始学习设计。', 'create-output'],
  ]) assert.equal(derivePatternProposals(experiences(quote!)).some(x => x.behaviorKey === key), false, quote)
  assert.ok(derivePatternProposals(experiences('这次项目是我主动发起的。')).some(x => x.behaviorKey === 'initiate'))
  assert.ok(derivePatternProposals(experiences('我制作了海报。')).some(x => x.behaviorKey === 'create-output'))
})

test('a pending observation carries bounded evidence including the fresh record', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ ...experiences(`我按时交付了第${i}份报告。`)[0]!, id: 'e' + i }))
  const proposal = derivePatternProposals(rows, 'e39').find(item => item.behaviorKey === 'deliver-ontime')!
  assert.ok(proposal)
  assert.ok(proposal.supporting.length <= 8)
  assert.ok(proposal.supporting.some(item => item.id === 'e39'))
})
