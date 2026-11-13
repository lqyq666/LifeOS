import test from 'node:test'
import assert from 'node:assert/strict'
import {streamingReplyText,replyDraftFrame} from '../server/reply-stream.ts'
test('partial reply streams progressively without metadata or JSON escaping',()=>{
 const a=streamingReplyText('{"reply":"**第一条**\\n我')
 const b=streamingReplyText('{"reply":"**第一条**\\n我正在探索AI产品。')
 assert.equal(a,'**第一条**\n我');assert.equal(b,'**第一条**\n我正在探索AI产品。')
 assert.equal(streamingReplyText('{"growthUpdates":['),null)
 assert.equal(streamingReplyText('{"reply":"完成","background":[{"secret":"x"}]}'),'完成')
})

test('reply streaming preserves the final tail with either reply or metadata first',()=>{
 const reply='中文🙂：先记录“原文”。\n保留引号 " 和路径 C:\\笔记\\。最后一字。'
 const event={target:{operation:'continue'},metadata:{reply:'hidden metadata must not appear'}}
 for(const frame of [{reply,event},{event,reply},{growthUpdates:[],reply,event},{growthUpdates:[{metadata:event.metadata}],reply,event}]){
  const raw=JSON.stringify(frame).replace('中文','\\u4e2d\\u6587')
  let rendered=''
  for(let i=1;i<=raw.length;i++){
   const visible=streamingReplyText(raw.slice(0,i))
   if(visible===null)continue
   assert.ok(!visible.includes('hidden metadata'))
   const frame=replyDraftFrame(visible,rendered,true)
   rendered=frame.append?rendered+frame.text:frame.text
  }
  assert.equal(rendered,reply)
 }
})
