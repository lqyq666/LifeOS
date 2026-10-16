import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyWithLexicon } from '../server/category-lexicon.ts'
import { derivePatternProposals, type PatternExperience } from '../server/experience-patterns.ts'

test('the lexicon classifies by strong direct evidence or two weak clues',()=>{
  const poster=classifyWithLexicon('上周五我把社团招新的推文和海报整套都交了，比约好的时间晚了两天，部长说整体效果还不错')
  assert.deepEqual(poster.map(match=>match.valueId),['value-creation','value-growth'])
  assert.ok(poster[0]!.strong,'a delivered poster set is strong creative evidence')
  const initiative=classifyWithLexicon('我主动联系了导师，自己决定换选题方向')
  assert.equal(initiative.find(match=>match.valueId==='value-autonomy')!.word,'主动')
  assert.deepEqual(classifyWithLexicon('今天天气不错'),[],'small talk qualifies nowhere')
  const singleWeak=classifyWithLexicon('这个效果一般')
  assert.equal(singleWeak.find(match=>match.valueId==='value-growth'),undefined,'one weak clue alone never qualifies')
})

const experience=(id:string,over:Partial<PatternExperience>):PatternExperience=>({ id, revision:1, conversationId:'c-'+id, sourceMessageId:'m-'+id, quote:'q-'+id, action:'', result:'', valueIds:[], ...over })

test('patterns need two supporting experiences including the fresh one',()=>{
  const late=experience('e1',{ result:'比约定晚了两天，部长说效果还不错', action:'我把推文和海报整套都交了', valueIds:['value-creation'] })
  const late2=experience('e2',{ result:'迟了一天交上去', action:'我完成了课程展示的课件', valueIds:['value-creation'] })
  const alone=derivePatternProposals([late],'e1')
  assert.equal(alone.length,0,'one experience never becomes a pattern')
  const pair=derivePatternProposals([late,late2],'e2')
  const latePattern=pair.find(proposal=>proposal.behaviorKey==='deliver-late')!
  assert.ok(latePattern,'two late deliveries propose the deadline pattern')
  assert.equal(latePattern.supporting.length,2)
  assert.ok(latePattern.outcome.includes('晚了'),'the outcome anchors verbatim words')
  assert.ok(latePattern.limitations.some(line=>line.includes('不是人格结论')))
  const stale=derivePatternProposals([late,late2],'nope')
  assert.equal(stale.length,0,'old data alone never churns proposals')
})
