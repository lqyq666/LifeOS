import test from 'node:test'
import assert from 'node:assert/strict'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'
import {coachEventView} from '../../server/action-coach-events.ts'
import {assistantRequestClause} from '../../server/user-command-spans.ts'

test('reuse-feedback and one-turn no-extra-task directives never become event facts',async()=>{
 const h=await residualHarness()
 try{
  for(const cue of ['按我最近反馈的条件','这次先别增加其他任务']){
   assert.equal(assistantRequestClause(cue),true,cue)
   const {user,chat}=await h.account()
   await h.execute(user,chat,'我今天能用四分钟。'+cue+'。',run=>({event:{target:{operation:'create',title:'岗位核对',source:{messageId:run.source_message_id,quote:'我今天能用四分钟'}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:'我今天能用四分钟'}},{kind:'fact',source:{messageId:run.source_message_id,quote:cue}}]}}))
   const event=(await coachEventView(user,chat))!
   assert.ok(event.nodes.some(node=>node.content==='我今天能用四分钟'))
   assert.ok(!event.nodes.some(node=>node.content===cue))
  }
  for(const text of ['按我最近反馈的条件，我今天能用四分钟','我按最近反馈的条件整理了表格','这次我没有增加其他任务'])assert.equal(assistantRequestClause(text),false,text)
  const mixed=await h.account(),text='我今天能用四分钟。按我最近反馈的条件。'
  await h.execute(mixed.user,mixed.chat,text,run=>({event:{target:{operation:'create',title:'四分钟核对',source:{messageId:run.source_message_id,quote:'我今天能用四分钟'}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]}}))
  const mixedEvent=(await coachEventView(mixed.user,mixed.chat))!
  assert.ok(mixedEvent.nodes.some(node=>node.content==='我今天能用四分钟'))
  assert.ok(!mixedEvent.nodes.some(node=>node.content.includes('按我最近反馈')))
 }finally{await h.close()}
})
