import test from 'node:test'
import assert from 'node:assert/strict'
import { reportedActionProgress } from '../../server/workflows/action-review.ts'

test('explicit acceptance of the named matter does not become execution or acceptance of another fact', () => {
  for (const [text, title] of [
    ['我已经接受合作文档权限检查和修改，但还没有执行。', '合作文档权限检查和修改'],
    ['我已经接受课程报告的图表说明补充，但还没有执行。', '课程报告'],
    ['我已经接受课程报告的图表说明补充，但还没有执行。', '课程报告的图表说明补充'],
    ['我已经接受社团报名问卷结果核对，但还没有执行。', '社团报名问卷结果核对'],
    ['我已经接受社团报名问卷的结果核对，但还没有执行。', '社团报名问卷'],
    ['我已经接受课程报告的事实核对，但还没有执行。', '课程报告'],
    ['我已经接受课程报告的老师联系，但还没有执行。', '课程报告'],
    ['我已经接受课程报告的意见整理，但还没有执行。', '课程报告'],
    ['我已经接受课程报告图表说明补充但还没有执行。', '课程报告图表说明补充'],
    ['我已经接受课程报告的图表说明补充不过我尚未开始。', '课程报告'],
  ]) {
    const result = reportedActionProgress(text!, title!)
    assert.equal(result.choice, 'accepted', text)
    assert.equal(result.state, 'unattempted', text)
  }
  for (const text of [
    '我已经接受课程报告图表说明补充，但还没有执行。',
    '室友已经接受合作文档权限检查和修改。',
    '如果我接受合作文档权限检查和修改，就会开始。',
    '我接受合作文档权限无法修改这个事实。',
    '我没有接受合作文档权限检查和修改。',
    '我接受合作文档权限被否定的评价。',
  ]) assert.notEqual(reportedActionProgress(text, '合作文档权限').choice, 'accepted', text)
  assert.notEqual(reportedActionProgress('我接受课程报告答辩准备。', '课程报告').choice, 'accepted')
  assert.notEqual(reportedActionProgress('我接受合作文档权限检查和修改。', '合作文档').choice, 'accepted')
  for (const suffix of ['内容值得补充', '事实有待核对', '内容适合补充', '内容可能要补充', '结果需要核对', '意见已经整理', '老师负责联系', '结果无法修改', '老师的意见整理', '没有提交', '评价', '结果', '事实']) {
    assert.notEqual(reportedActionProgress('我接受课程报告的' + suffix + '。', '课程报告').choice, 'accepted', suffix)
  }
  for (const title of ['课程报告内容值得补充', '合作文档权限无法修改', '课程报告事实有待核对']) {
    assert.notEqual(reportedActionProgress('我接受' + title + '，但还没有执行。', title).choice, 'accepted', title)
  }
  for (const text of ['如果我接受课程报告的图表说明补充但还没有执行。', '室友接受课程报告的图表说明补充但还没有执行。', '我没有接受课程报告的图表说明补充但还没有执行。']) {
    assert.notEqual(reportedActionProgress(text, '课程报告').choice, 'accepted', text)
  }
  const declined = reportedActionProgress('我拒绝合作文档权限的检查和修改。', '合作文档权限')
  assert.equal(declined.choice, 'declined')
  assert.equal(declined.state, 'paused')
})
