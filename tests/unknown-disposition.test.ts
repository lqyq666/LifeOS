import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeUnknownDispositionConflict} from '../server/action-coach-events.ts'

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
