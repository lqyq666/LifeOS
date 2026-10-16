import test from 'node:test'
import assert from 'node:assert/strict'
import {assistantRequestClause,scanUserClauses} from '../server/user-command-spans.ts'

test('observed draft commands are instructions rather than autobiographical facts',()=>{
 for(const text of ['不要替我发送','再帮我拟一个暂不催促的后续沟通问题']){
  assert.equal(assistantRequestClause(text),true,text)
  assert.ok(scanUserClauses(text).every(clause=>assistantRequestClause(clause.text)))
 }
 for(const text of ['我通过校内邮箱发了消息','他还没回复','我在课程小组里负责整理资料和排版','我不想换到私人微信催他'])assert.equal(assistantRequestClause(text),false,text)
})
