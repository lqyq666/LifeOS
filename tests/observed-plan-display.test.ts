import test from 'node:test'
import assert from 'node:assert/strict'
import {weeklyPlanExplanation} from '../server/reply-draft.ts'

test('the observed conflicting prose timetable yields to the persisted plan',()=>{
 const explanation='两小时排作业加少量复习，留缓冲。具体科目和作业截止日未知。'
 const reply=explanation+'\n\n- 0–50min：最急课程作业\n- 50–60min：休息/缓冲\n- 60–90min：期末复习\n- 90–120min：次急作业收尾\n\n总计120min，含10min缓冲，未排满。'
 assert.equal(weeklyPlanExplanation(reply),explanation)
 assert.equal(weeklyPlanExplanation('先保课程作业。\n\n- 复习（30分钟）\n\n截止时间仍未知。'),'先保课程作业。\n\n截止时间仍未知。')
 assert.equal(weeklyPlanExplanation('你上次报告每周两小时，当前具体截止日仍未知。'),'你上次报告每周两小时，当前具体截止日仍未知。')
})
