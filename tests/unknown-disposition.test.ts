import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeUnknownDispositionConflict,unknownQuestionTopicMatches} from '../server/action-coach-events.ts'

test('an engagement answer binds its concrete subject, never a generic field or an unrelated preference',()=>{
 const question='你愿意投入申请材料的哪个步骤？'
 assert.equal(unknownQuestionTopicMatches(question,'我喜欢这本小说的内容。',true),false)
 for(const variant of ['你愿意在申请材料的哪个步骤投入时间？','申请材料中，哪一步是你愿意投入的？','哪项申请工作会让你愿意花时间？'])assert.equal(unknownQuestionTopicMatches(variant,'我喜欢这本小说的内容。',true),false)
 assert.equal(unknownQuestionTopicMatches(question,'我愿意投入申请材料的格式检查步骤。',true),true)
 assert.equal(unknownQuestionTopicMatches('具体是哪一类内容或哪个环节让你感到愿意投入时间？','我喜欢这本小说的内容。',true),false)
})

test('a conflicting unknown disposition keeps the state conservative',()=>{
  const base={resolveUnknowns:['a','b'],declineUnknowns:['a']}
  const dropped=normalizeUnknownDispositionConflict(base,'我只问了一个学长。')
  assert.deepEqual(dropped.conflictIds,['a'])
  assert.deepEqual(dropped.delta.resolveUnknowns,['b'])
  assert.deepEqual(dropped.delta.declineUnknowns,[])

  const declined=normalizeUnknownDispositionConflict(base,'这个我不想说。')
  assert.deepEqual(declined.conflictIds,['a'])
  assert.deepEqual(declined.delta.resolveUnknowns,['b'])
  assert.deepEqual(declined.delta.declineUnknowns,['a'])

  const forgotten=normalizeUnknownDispositionConflict(base,'我记不清了。')
  assert.deepEqual(forgotten.delta.resolveUnknowns,['b'])
  assert.deepEqual(forgotten.delta.declineUnknowns,[])

  const none=normalizeUnknownDispositionConflict({resolveUnknowns:['a'],declineUnknowns:['b']},'...')
  assert.deepEqual(none.conflictIds,[])
  assert.deepEqual(none.delta.resolveUnknowns,['a'])
  assert.deepEqual(none.delta.declineUnknowns,['b'])
})

test('a negated or attributed refusal does not turn an unknown into a decline',()=>{
  const conflict={resolveUnknowns:['a'],declineUnknowns:['a']}
  for(const text of ['我不是不想说，只是记不清了。','我没有不想说，只是记不清了。','同学说“不想说”，我记不清。']){
    const result=normalizeUnknownDispositionConflict(conflict,text)
    assert.deepEqual(result.delta.resolveUnknowns,[])
    assert.deepEqual(result.delta.declineUnknowns,[])
  }
})

test('one refusal cannot be applied to several unrelated unknown items',()=>{
  const result=normalizeUnknownDispositionConflict({resolveUnknowns:['a','b'],declineUnknowns:['a','b']},'我不想说家庭情况，另一个细节也记不清了。')
  assert.deepEqual(result.delta.resolveUnknowns,[])
  assert.deepEqual(result.delta.declineUnknowns,[])
})

test('a refusal about another topic cannot resolve the conflicted unknown',()=>{
  const delta={resolveUnknowns:['income'],declineUnknowns:['income']}
  const questions={income:'你实习收入是多少？'}
  const result=normalizeUnknownDispositionConflict(delta,'家庭情况我不想说，实习收入我记不清。',questions)
  assert.deepEqual(result.delta.resolveUnknowns,[])
  assert.deepEqual(result.delta.declineUnknowns,[])
})

test('a generic shared word does not bind a refusal to another unknown item',()=>{
  const result=normalizeUnknownDispositionConflict({resolveUnknowns:['life'],declineUnknowns:['life']},'家庭情况我不想说。',{life:'你最近的生活情况如何？'})
  assert.deepEqual(result.delta.resolveUnknowns,[])
  assert.deepEqual(result.delta.declineUnknowns,[])
})

test('a named refusal cannot use the single-item fallback for a different topic',()=>{
  const result=normalizeUnknownDispositionConflict({resolveUnknowns:['income'],declineUnknowns:['income']},'家庭情况我不想说。',{income:'你实习收入是多少？'})
  assert.deepEqual(result.delta.resolveUnknowns,[])
  assert.deepEqual(result.delta.declineUnknowns,[])
})

test('a generic result word cannot bind the wrong named refusal',()=>{
  const result=normalizeUnknownDispositionConflict({resolveUnknowns:['interview'],declineUnknowns:['interview']},'考试结果我不想说，面试结果我记不清。',{interview:'你面试结果如何？'})
  assert.deepEqual(result.delta.resolveUnknowns,[])
  assert.deepEqual(result.delta.declineUnknowns,[])
})

test('an umbrella topic match cannot bind a refusal to a different field',()=>{
  const result=normalizeUnknownDispositionConflict({resolveUnknowns:['income'],declineUnknowns:['income']},'实习单位我不想说，实习收入我记不清。',{income:'你实习收入是多少？'})
  assert.deepEqual(result.delta.resolveUnknowns,[])
  assert.deepEqual(result.delta.declineUnknowns,[])
})

test('field names remain part of refusal matching',()=>{
  for(const [field,question,wrongRefusal] of [
    ['时间','你实习时间是什么？','实习单位我不想说，实习时间记不清。'],
    ['地点','你实习地点在哪里？','实习岗位我不想说，实习地点记不清。'],
    ['原因','你选择实习的原因是什么？','实习内容我不想说，实习原因记不清。'],
    ['结果','你实习结果如何？','实习原因我不想说，实习结果记不清。'],
    ['内容','你实习内容是什么？','实习时间我不想说，实习内容记不清。'],
  ]){
    const result=normalizeUnknownDispositionConflict({resolveUnknowns:['x'],declineUnknowns:['x']},wrongRefusal,{x:question})
    assert.deepEqual(result.delta.resolveUnknowns,[])
    assert.deepEqual(result.delta.declineUnknowns??[],[],field)
  }
  for(const [field,question,matchingRefusal] of [
    ['原因','你选择实习的原因是什么？','实习原因我不想说。'],
    ['结果','你实习结果如何？','实习结果我不想说。'],
    ['内容','你实习内容是什么？','实习内容我不想说。'],
  ]){
    const result=normalizeUnknownDispositionConflict({resolveUnknowns:['x'],declineUnknowns:['x']},matchingRefusal,{x:question})
    assert.deepEqual(result.delta.declineUnknowns,['x'],field)
  }
})

test('a refusal explicitly about the conflicted item remains a decline',()=>{
  const result=normalizeUnknownDispositionConflict({resolveUnknowns:['income'],declineUnknowns:['income']},'实习收入我不想说。',{income:'你实习收入是多少？'})
  assert.deepEqual(result.delta.resolveUnknowns,[])
  assert.deepEqual(result.delta.declineUnknowns,['income'])
})

test('a refusal for one item does not spread to a different conflicting unknown',()=>{
  const result=normalizeUnknownDispositionConflict({resolveUnknowns:['income'],declineUnknowns:['income','family']},'家庭情况我不想说，实习收入记不清。',{income:'你实习收入是多少？',family:'你家庭情况如何？'})
  assert.deepEqual(result.delta.resolveUnknowns,[])
  assert.deepEqual(result.delta.declineUnknowns,['family'])
})
