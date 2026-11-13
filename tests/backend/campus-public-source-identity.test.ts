import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {campusView} from '../../server/campus.ts'

test.after(async()=>{await pool.end()})

test('range-distinct message occurrences project to one stable public Campus source',async()=>{
 const user='campus-public-source-'+randomUUID(),conversation=randomUUID(),inquiryId=randomUUID(),quote='我联系了导师',text='我要复盘。'+quote+'；'+quote
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
 try{
  await store.createConversation(user,{id:conversation,title:'SYNTHETIC Campus public source identity'})
  const run=(await store.startRun(user,conversation,randomUUID(),text)).run
  await store.finishRun(run,{candidates:[],audit:[]},'已记录。',null,new AbortController().signal)
  const first=text.indexOf(quote),second=text.lastIndexOf(quote),source=(start:number)=>({type:'message' as const,id:run.source_message_id,quote,range:{start,end:start+quote.length}})
  const payload={domain:'life_goal',question:'我要复盘',questionSource:{type:'message',id:run.source_message_id,quote:'我要复盘',range:{start:0,end:4}},criteria:[],readiness:'act',questions:[],studentContext:[{key:'contact.first',value:quote,status:'reported',source:source(first),scope:'task'},{key:'contact.second',value:quote,status:'reported',source:source(second),scope:'task'}],pathways:[],opportunities:[],evidence:[],hypotheses:[],experiments:[],changes:[]}
  await pool.query('INSERT INTO campus_inquiries(id,user_id,conversation_id,payload) VALUES($1,$2,$3,$4)',[inquiryId,user,conversation,payload])
  const inquiry=(await campusView(user,conversation)).inquiries.find(item=>item.id===inquiryId)!
  const publicMatches=inquiry.sources.filter((entry:any)=>entry.source?.type==='message'&&entry.source.id===run.source_message_id&&entry.source.quote===quote)
  assert.equal(publicMatches.length,1,'persistence-only ranges cannot create duplicate indistinguishable public sources')
  assert.equal('range' in publicMatches[0].source,false)
 }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})
