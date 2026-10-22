import test from 'node:test'
import assert from 'node:assert/strict'
import {HttpError} from '../server/db.ts'
import {stageGrowthPreservingFeedback} from '../server/turn-engine.ts'

type Delta={kind:string;source:{quote:string};id:string}
const valid:Delta={kind:'feedback',source:{quote:'我已经发出邮件'},id:'valid'}
const invalid:Delta={kind:'feedback',source:{quote:'一条无效反馈'},id:'invalid'}
const rejectInvalid=async(changes:Delta[])=>{
  if(changes.some(change=>change.id==='invalid'))throw new HttpError(400,'GROWTH_FEEDBACK_INVALID')
  return {changes}
}

test('one invalid feedback item does not discard a valid feedback item',async()=>{
  const isolated=await stageGrowthPreservingFeedback([valid,invalid],'已记录这次反馈。',false,rejectInvalid)
  assert.deepEqual(isolated.dropped,['一条无效反馈'])
  assert.deepEqual((isolated.value as {changes:Delta[]}).changes,[valid])
})

test('an invalid-only feedback write cannot be claimed as remembered',async()=>{
  await assert.rejects(stageGrowthPreservingFeedback([invalid],'已记录这次反馈。',false,rejectInvalid),{code:'GROWTH_FEEDBACK_REQUIRED'})
  const silent=await stageGrowthPreservingFeedback([invalid],'这次先不记录。',false,rejectInvalid)
  assert.equal(silent.value,undefined)
  assert.deepEqual(silent.dropped,['一条无效反馈'])
})

test('a plan keeps all growth positions and never drops feedback',async()=>{
  await assert.rejects(stageGrowthPreservingFeedback([valid,invalid],'已记录。',true,rejectInvalid),{code:'GROWTH_FEEDBACK_INVALID'})
})
