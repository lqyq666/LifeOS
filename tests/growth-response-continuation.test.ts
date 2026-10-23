import test from 'node:test'
import assert from 'node:assert/strict'
import {reportedResponseContinuationTargets} from '../server/turn-contract.ts'
const next='回来反馈：老师后来回复说这周忙，下周再看；同学表格仍不适合他。'
const records=[
 {id:'bare',revision:1,text:'老师没回复只是结果未知，不等于拒绝我',sourceMessageIds:['first']},
 {id:'mail',revision:1,text:'更正并区分两件事：老师那封邮件是未回复；同学试过表格说不适合他',sourceMessageIds:['second']},
]
test('event-free continuations retain exact clause scope and reject unbound or competing matters',()=>{
 const targets=reportedResponseContinuationTargets(next,records)
 assert.equal(targets.length,2)
 assert.ok(targets.every(target=>target.quote==='回来反馈：老师后来回复说这周忙'))
 assert.equal(targets.find(t=>t.itemId==='bare')?.beforeQuote,'老师没回复只是结果未知')
 assert.equal(targets.find(t=>t.itemId==='mail')?.beforeQuote,'更正并区分两件事：老师那封邮件是未回复')
 for(const rows of [
  [records[0]!],
  [...records,{...records[1]!,id:'other',sourceMessageIds:['other-source']}],
  [...records,{id:'other-ref',revision:1,text:'老师这封邮件是未回复',sourceMessageIds:['second']}],
  [...records,{id:'other-form',revision:1,text:'老师那封消息是未回复',sourceMessageIds:['second']}],
  [...records,{id:'named',revision:1,text:'老师没回复课程作业邮件',sourceMessageIds:['another']}],
  records.map(row=>({...row,sourceMessageIds:[]})),
  records.map(row=>({...row,blocked:true})),
 ])assert.deepEqual(reportedResponseContinuationTargets(next,rows),[])
 for(const text of ['老师后来回复说另一份PDF已读。','如果老师后来回复说这周忙怎么办？','老师后来回复说这周忙；老师没有回复。'])assert.deepEqual(reportedResponseContinuationTargets(text,records),[],text)
})
