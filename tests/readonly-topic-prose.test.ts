import test from 'node:test'
import assert from 'node:assert/strict'
import {deliverableIntent,requiresImmediateMaterial} from '../server/action-coach-events.ts'
import {deriveTurnContract} from '../server/turn-contract.ts'
const explanation='请完整写一份大学生比较独立AI产品、AI产品或应用实习就业、专业与AI交叉科研升学三条道路的说明。正文约2300—2600个中文字符。只分析，不修改档案，不创建任务或经历。'
test('an explicitly read-only topic comparison is one full reply, never a second artifact copy',()=>{
 assert.equal(deliverableIntent(explanation,'create'),false)
 const contract=deriveTurnContract({text:explanation,knowledgeCount:0,currentEventExists:false,planIntent:false,material:deliverableIntent(explanation,'create')})
 assert.equal(contract.capabilities.material,false);assert.equal(contract.capabilities.event,false);assert.equal(contract.capabilities.growth,false)
 assert.equal((contract.schema as any).properties.reply.maxLength,16000)
})
test('named artifacts, addressed material and ordinary requests retain their existing lanes',()=>{
 for(const text of ['请完整写一份延期申请的情况说明，不修改档案。','请写一份项目分析报告，不修改档案。','请写一份比较两条路径的说明，直接发给导师，不修改档案。','请写一份大学生比较三条道路的说明。'])assert.equal(deliverableIntent(text,'create'),true,text)
 assert.equal(requiresImmediateMaterial('不修改档案，请直接起草一封介绍邮件。'),true)
 assert.equal(deliverableIntent('我上周写了比较两条路径的说明。','create'),false)
})
