import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import {createApp} from '../../server/http.ts'
import {importEvergreenCorpus} from '../../server/evergreen-maintenance.ts'
import {stageCoachEvent} from '../../server/action-coach-events.ts'
import {suggestedGuideUsage} from '../../server/guide-usage.ts'
import * as store from '../../server/store.ts'
import type {KnowledgeCard} from '../../server/campus-knowledge.ts'

test('business Skill reads owned guide feedback through HTTP, respects memory gate and source withdrawal (no provider)',async()=>{
 const read=(file:string)=>readFileSync('.planning/research/evergreen/'+file,'utf8').trim().split('\n').map(line=>JSON.parse(line))
 const cards=read('KB_GUIDES.jsonl') as KnowledgeCard[]
 await importEvergreenCorpus(cards,read('KB_SOURCE_REGISTRY.jsonl'),read('KB_EVIDENCE.jsonl'))
 const server=createApp()
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const origin='http://127.0.0.1:'+(server.address() as {port:number}).port
 const users:string[]=[]
 const account=async()=>{
  const response=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({email:'skill-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID(),name:'Synthetic adult'})})
  assert.equal(response.status,200)
  const cookie=response.headers.getSetCookie().map(part=>part.split(';')[0]).join('; ')
  const session=await fetch(origin+'/api/session',{headers:{Cookie:cookie}})
  assert.equal(session.status,200)
  const user=(await session.json()).id;users.push(user)
  return {cookie,user}
 }
 try{
  const a=await account(),b=await account(),chat=randomUUID(),second=randomUUID()
  await store.createConversation(a.user,{id:chat,title:'SYNTHETIC current matter'})
  await store.createConversation(a.user,{id:second,title:'SYNTHETIC another session'})
  const card=cards.find(card=>card.guide!.canonicalKey==='user-interview')!
  const text='我想先确认校园产品的用户需要。',run=(await store.startRun(a.user,chat,randomUUID(),text)).run
  const coach=await stageCoachEvent(run,{target:{operation:'create',title:'校园产品需求',source:{messageId:run.source_message_id,quote:text}},action:{operation:'create',draft:{content:'先确认一个实际问题。'}}},'先确认一个实际问题。')
  const suggestion=suggestedGuideUsage(card,coach.eventId)!
  const result=await store.finishRun(run,{candidates:[],audit:[],coach,guideUsage:[suggestion]},'先确认一个实际问题。',null,new AbortController().signal)
  assert.equal(result.stateChange.guideUsage.items[0].status,'suggested')
  const path=(conversation=chat)=>'/api/conversations/'+conversation+'/guide-usage?event='+coach.eventId
  const get=(path:string,cookie=a.cookie)=>fetch(origin+path,{headers:{Cookie:cookie}})
  assert.equal((await get(path(),'')).status,401)
  assert.equal((await get(path(),b.cookie)).status,404)
  assert.equal((await get('/api/conversations/'+chat+'/guide-usage')).status,400)
  assert.equal((await get(path(randomUUID()))).status,404)
  assert.equal((await (await get(path())).json()).items[0].status,'suggested')
  assert.equal((await get(path(second))).status,403)
  const toggle=async(enabled:boolean,expectedRevision:number)=>{
   const response=await fetch(origin+'/api/memory/settings',{method:'POST',headers:{Cookie:a.cookie,Origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),enabled,expectedRevision})})
   assert.equal(response.status,200)
  }
  await toggle(true,0)
  assert.equal((await (await get(path(second))).json()).items[0].status,'suggested')
  await toggle(false,1)
  assert.equal((await get(path(second))).status,403)
  const feedback='按上次办法，我已经联系了两人，没人回。',next=(await store.startRun(a.user,chat,randomUUID(),feedback)).run
  await store.finishRun(next,{candidates:[],audit:[],guideUsage:[{...suggestion,status:'blocked',sourceMessageId:next.source_message_id,sourceQuote:feedback}]},'先核对原消息和等待情况。',null,new AbortController().signal)
  assert.equal((await (await get(path())).json()).items[0].status,'blocked')
  const full='/api/knowledge/'+card.id+'?revision='+card.revision
  assert.equal((await get(full)).status,200)
  await pool.query("UPDATE kb_sources SET status='retired' WHERE source_id=$1",[card.guide!.sourceGroups[0]])
  assert.deepEqual((await (await get(path())).json()).items,[])
  assert.equal((await get(full)).status,409)
 }finally{
  await new Promise<void>(resolve=>server.close(()=>resolve()))
  for(const user of users)await pool.query('DELETE FROM "user" WHERE id=$1',[user])
  await pool.end()
 }
})
