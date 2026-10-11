import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createApp} from '../../server/http.ts'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'

test('authenticated HTTP preserves engine-validated first sentences and rejects untagged or unsafe prose',async()=>{
 const oldOrigin=config.origin,oldAccess=config.entitlementsEnabled
 config.entitlementsEnabled=false
 const sentence='先围绕你这次请教的目标，选一个最需要对方确认的问题'
 const app=createApp(async input=>{
  input.emit({type:'draft',text:sentence,saved:false})
  input.emit({type:'draft',text:'已为你发送消息',saved:false,draftKind:'safe_sentence'})
  input.emit({type:'draft',text:sentence,saved:true,draftKind:'safe_sentence'})
  input.emit({type:'draft',text:sentence,saved:false,draftKind:'safe_sentence'})
  return {text:sentence+'。',usage:{source:'deterministic',zeroLlm:true,llmCallCount:0,estimatedCostCny:0}}
 })
 await new Promise<void>(r=>app.listen(0,'127.0.0.1',r))
 const origin='http://127.0.0.1:'+(app.address() as {port:number}).port;config.origin=origin
 let user=''
 try{
  const response=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic HTTP draft',email:'draft-'+randomUUID()+'@example.invalid',password:'Synthetic-'+randomUUID()})})
  assert.equal(response.status,200)
  const cookie=response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '),headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json'}
  user=(await (await fetch(origin+'/api/session',{headers})).json()).id
  const chat=randomUUID(),created=await fetch(origin+'/api/conversations',{method:'POST',headers,body:JSON.stringify({id:chat,title:'Synthetic draft transport'})});assert.equal(created.status,201)
  const sent=await fetch(origin+'/api/conversations/'+chat+'/messages',{method:'POST',headers,body:JSON.stringify({requestId:randomUUID(),text:'准备联系学姐，先怎么做？'})})
  assert.equal(sent.status,200)
  const frames=(await sent.text()).split('\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)))
  assert.deepEqual(frames.filter(x=>x.type==='draft'),[{type:'draft',text:sentence,saved:false}])
  assert.ok(frames.some(x=>x.type==='done'))
  assert.ok(frames.findIndex(x=>x.type==='draft')<frames.findIndex(x=>x.type==='done'))
 }finally{
  app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()))
  if(user)await pool.query('DELETE FROM "user" WHERE id=$1',[user])
  config.origin=oldOrigin;config.entitlementsEnabled=oldAccess;await pool.end()
 }
})
