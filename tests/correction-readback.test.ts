import test from 'node:test'
import assert from 'node:assert/strict'
import {planExplicitCorrection} from '../server/turn-obligations.ts'

test('reading a previous correction never creates a new correction obligation',()=>{
 for(const text of [
  '请核对我最近报告并已更正过的课程引用经历：当前记录到底核对了几份，使用了什么工具？哪些可以确认，哪些还不能推断？只分析，不修改档案、不创建任务或经历，也不用额外追问。',
  '请核对我已更正过的课程经历。',
  '请读回我更正后的记录。',
  '请说明我的更正记录。',
  '更正一下：我是大二。只讨论，不修改档案。',
 ])assert.equal(planExplicitCorrection(text,[]),null,text)
 assert.equal(planExplicitCorrection('请核对我更正后的记录。另外更正一下：我是大二。',[])?.newQuote,'我是大二')
 assert.equal(planExplicitCorrection('更正一下：我是大二。',[])?.newQuote,'我是大二')
})
