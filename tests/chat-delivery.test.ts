import test from 'node:test'
import assert from 'node:assert/strict'
import {replyDraftFrame} from '../server/reply-stream.ts'
import {committedTurn} from '../src/backend/client.ts'
import {emptyConversation} from '../src/features/conversation/flow.ts'

test('incremental delivery reconstructs every preview including Unicode and replacements',()=>{
 const values=['**成长**：我','**成长**：我会保留🙂与换行\n','重新组织的完整回复。','重新组织的完整回复。\n第二段。']
 let previous='',display=''
 for(const text of values){const frame=replyDraftFrame(text,previous,true);display=frame.append?display+frame.text:frame.text;assert.equal(display,text);previous=text}
 assert.equal(replyDraftFrame('第二次内容。','',true).append,undefined,'discard resets the next frame to a full replacement')
 assert.equal(replyDraftFrame(values[1],values[0],false).text,values[1],'older clients keep cumulative frames')
})

test('wire savings preserve the exact long reply rather than reducing its content',()=>{
 const full='### 可核对的依据\n**条件**：保留完整内容、原话“未知”和🙂。\n'.repeat(140)
 let oldBytes=0,newBytes=0,last='',display=''
 for(let i=1;i<=120;i++){
  const text=full.slice(0,Math.ceil(full.length*i/120)),frame=replyDraftFrame(text,last,true)
  oldBytes+=Buffer.byteLength(JSON.stringify(replyDraftFrame(text,last,false)));newBytes+=Buffer.byteLength(JSON.stringify(frame))
  display=frame.append?display+frame.text:frame.text;last=text
 }
 assert.equal(display,full);assert.ok(newBytes<oldBytes*.1)
})

test('only matching committed IDs and a full saved delta permit immediate completion',()=>{
 const conversationId='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222',sourceId='33333333-3333-4333-8333-333333333333',assistantId='44444444-4444-4444-8444-444444444444'
 const input={conversationId,requestId,sourceId,text:'请分析，不修改档案。',reply:'### 依据\n完整的回复🙂。',savedDelta:true}
 const done={requestId,memoryReferenceCount:2,commitReceipt:{version:1,conversationId,userMessageId:sourceId,assistantMessageId:assistantId,title:'已保存的标题',refreshRequired:false}}
 const original=emptyConversation(),saved=committedTurn(original,input,done)!
 assert.equal(saved.conversation.messages[1].sourceId,assistantId);assert.equal(saved.conversation.messages[1].text,input.reply);assert.equal(saved.conversation.messages[1].memoryReferenceCount,2)
 assert.equal(original.messages.length,0)
 for(const bad of [{...done,commitReceipt:undefined},{...done,requestId:conversationId},{...done,commitReceipt:{...done.commitReceipt,refreshRequired:true}},{...done,commitReceipt:{...done.commitReceipt,conversationId:requestId}}])assert.equal(committedTurn(original,input,bad),null)
 assert.equal(committedTurn(original,{...input,savedDelta:false},done),null)
 assert.equal(committedTurn(saved.conversation,input,done),null,'replay cannot append duplicate messages')
})
