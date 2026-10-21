import test from 'node:test'
import assert from 'node:assert/strict'
import {repairReviewedDefects} from '../server/review-repairs.ts'

test('unknown cause or reading in another clause cannot license an asserted delivery receipt',()=>{
 const user='只谈老师邮件：如果不增加任务，你目前能形成什么暂定理解？'
 for(const reply of ['截至你报告，邮件已送达但无回复，原因未知。','邮件已送达，是否已读仍未知。','邮件已送达；后续效果未知。']){
  const out=repairReviewedDefects(reply,user)?.reply??reply
  assert.doesNotMatch(out,/(?<!是否)已送达/)
  assert.match(out,/已发送/)
  assert.match(out,/是否送达未知/)
  assert.equal(repairReviewedDefects(out,user)?.reply??out,out)
 }
})

test('negated or explicitly uncertain delivery itself remains unchanged',()=>{
 const user='老师邮件还没有回复。'
 for(const reply of ['电脑能打开不证明链接已送达导师；是否已读仍未知。','是否已送达仍未知。','邮件已送达与否仍未知。','没有证据表明邮件已送达。']){
  assert.equal(repairReviewedDefects(reply,user)?.reply??reply,reply)
 }
})

test('a positively reported receipt for the same explicit subject is retained',()=>{
 const user='系统确认邮件已送达，老师尚未回复。'
 const reply='邮件已送达，老师尚未回复，原因未知。'
 assert.equal(repairReviewedDefects(reply,user)?.reply??reply,reply)
 const other='老师乙的邮件已送达，是否已读未知。'
 const otherOut=repairReviewedDefects(other,'老师甲的邮件已送达；老师乙没有送达回执。')?.reply??other
 assert.match(otherOut,/是否送达未知/)
})
