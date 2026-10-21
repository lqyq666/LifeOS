import test from 'node:test'
import assert from 'node:assert/strict'
import {outcomeStatusLabel} from '../src/features/cognition/RecordPanel.tsx'

test('record outcome labels preserve reported response, non-reading and effect without claiming verification',()=>{
 assert.equal(outcomeStatusLabel('reported_response'),'报告时已回复')
 assert.equal(outcomeStatusLabel('reported_not_read'),'报告时未读')
 assert.equal(outcomeStatusLabel('reported_effect'),'已报告效果')
 assert.equal(outcomeStatusLabel('unknown'),'未知')
 assert.equal(outcomeStatusLabel('unexpected_future_status'),'未知')
 assert.equal(outcomeStatusLabel('reported_no_response'),'报告时未回复')
 assert.equal(outcomeStatusLabel('reported_used'),'报告时已使用')
})
