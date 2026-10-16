import test from 'node:test'
import assert from 'node:assert/strict'
import { loadWorkspace } from '../src/backend/client.ts'
import { newChat, newWorkspace } from '../src/features/conversation/workspace.ts'
import { createDemoConversation } from '../src/features/conversation/flow.ts'

test('Database synchronization preserves unsent account drafts and explicit demos',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('[]',{headers:{'Content-Type':'application/json'}}))
  const workspace=newWorkspace(),draft=newChat(),demo={...newChat(),conversation:createDemoConversation()}
  draft.draft='尚未发送的真实输入'
  workspace.chats=[draft,demo];workspace.activeId=draft.id
  const result=await loadWorkspace({id:'test-user',name:'测试',email:'test@example.invalid'},workspace)
  assert.equal(result.activeId,draft.id)
  assert.equal(result.chats[0].draft,draft.draft)
  assert.equal(result.chats[1].conversation.demo,true)
})

test('Database messages replace cached formal messages without resurrecting absent records',async t=>{
  const chat=newChat(),absent=newChat(),workspace=newWorkspace()
  chat.draft='保留草稿';chat.conversation.messages=[{id:0,role:'user',text:'缓存中的旧消息'}]
  absent.conversation.messages=[{id:0,role:'user',text:'数据库中没有这段正式对话'}]
  workspace.chats=[chat,absent];workspace.activeId=chat.id
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify([{id:chat.id,title:'正式对话',renamed:false,pinned:false,project_id:null,updated_at:new Date().toISOString(),messages:[{id:'source-id',role:'user',content:'数据库中的正式消息'}]}]),{headers:{'Content-Type':'application/json'}}))
  const result=await loadWorkspace({id:'test-user',name:'测试',email:'test@example.invalid'},workspace)
  assert.equal(result.chats.length,1)
  assert.equal(result.chats[0].conversation.messages[0].text,'数据库中的正式消息')
  assert.equal(result.chats[0].draft,'保留草稿')
})
