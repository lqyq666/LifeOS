import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {createGrowthItem,growthView} from '../../server/growth.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
test.after(async()=>{await localEmbedding.close();await pool.end()})
test('deleting a transcript persists across reads, blocks replay and mutation, preserves saved evidence and isolates owners',async()=>{
 const user='delete-chat-'+randomUUID(),other='other-'+randomUUID(),chat=randomUUID(),keep=randomUUID(),request=randomUUID()
 try {
  for(const id of [user,other])await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[id,id+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC disposable transcript'})
  await store.createConversation(user,{id:keep,title:'Keep this chat'})
  const project=randomUUID()
  await store.createConversation(user,{id:keep,title:'Renamed saved chat',renamed:true,pinned:true,projectId:project})
  await store.createConversation(user,{id:keep,title:'Not a rename',pinned:false})
  const metadata=(await pool.query('SELECT title,pinned,project_id FROM conversations WHERE id=$1',[keep])).rows[0]
  assert.deepEqual(metadata,{title:'Renamed saved chat',pinned:false,project_id:project},'independent metadata updates preserve each other atomically')
  await assert.rejects(store.createConversation(other,{id:keep,title:'Cross-account rewrite',renamed:true,pinned:true,projectId:randomUUID()}),(e:any)=>e.status===404)
  assert.deepEqual((await pool.query('SELECT title,pinned,project_id FROM conversations WHERE id=$1',[keep])).rows[0],metadata)

  const goal=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'goal',text:'SYNTHETIC independently saved goal'})
  const {run}=await store.startRun(user,chat,request,'SYNTHETIC preserved evidence')
  await assert.rejects(store.deleteConversation(other,chat),(e:any)=>e.status===404)
  await assert.rejects(store.deleteConversation(user,chat),(e:any)=>e.code==='CONVERSATION_BUSY')
  await store.terminateRun(user,request,'cancelled','TEST_DONE')
  const sourceText='SYNTHETIC preserved evidence',sourcedId=randomUUID()
  await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,sources,dependencies,created_at,updated_at) VALUES($1,$2,$3,'context',$4,'user_reported','active',$5,'[]',now(),now())",[sourcedId,user,chat,sourceText,JSON.stringify([{type:'message',id:run.source_message_id,quote:sourceText,range:{start:0,end:sourceText.length}}])])
  const before=(await pool.query('SELECT id,content FROM messages WHERE user_id=$1 AND conversation_id=$2',[user,chat])).rows
  assert.deepEqual(await store.deleteConversation(user,chat),{deleted:true})
  const deletedView=await growthView(user,chat),deletedSource=deletedView.items.find(item=>item.id===sourcedId)
  assert.equal(deletedView.items.find(item=>item.id===goal.id)?.text,goal.text,'independent user-edited map evidence survives transcript deletion')
  assert.equal(deletedSource?.text,'','message-derived map text is not exposed after its transcript is deleted')
  assert.deepEqual(deletedSource?.sources,[],'the public map cannot expose a tombstoned transcript source')
  assert.equal(deletedSource?.unavailableReason,'source_revoked')
  assert.deepEqual(await store.deleteConversation(user,chat),{deleted:true})
  assert.deepEqual((await store.listConversations(user)).map(c=>c.id),[keep])
  await assert.rejects(store.requireVisibleConversation(user,chat),(e:any)=>e.status===404)
  await assert.rejects(store.startRun(user,chat,request,'SYNTHETIC preserved evidence'),(e:any)=>e.status===404)
  await assert.rejects(store.patchConversation(user,chat,{title:'Revive'}),(e:any)=>e.status===404)
  await assert.rejects(store.createConversation(user,{id:chat,title:'Revive'}),(e:any)=>e.status===404)
  await assert.rejects(store.createConversation(user,{id:chat,title:'Revive with metadata',renamed:true,pinned:true,projectId:project}),(e:any)=>e.status===404)
  await assert.rejects(store.runStatus(user,request),(e:any)=>e.status===404)
  assert.deepEqual((await pool.query('SELECT id,content FROM messages WHERE user_id=$1 AND conversation_id=$2',[user,chat])).rows,before)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM runs WHERE user_id=$1 AND request_id=$2',[user,request])).rows[0].n,1)
 }finally{await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[[user,other]])}
})
