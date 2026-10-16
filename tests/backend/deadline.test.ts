import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApp } from '../../server/http.ts'
import { config } from '../../server/config.ts'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { stageCoachEvent, coachEventView } from '../../server/action-coach-events.ts'

test('server deadline is a failure, and a late engine cannot commit staged events or materials (simulated model)',async()=>{
  const oldProxy=config.trustedProxy;config.trustedProxy='127.0.0.1'
  const fixtureIP='198.18.'+Math.floor(Math.random()*256)+'.'+Math.floor(Math.random()*256)
  const server=createApp(async input=>{
    const latest=input.context.at(-1)
    input.staged.coach=await stageCoachEvent(input.run,{target:{operation:'create',title:'模拟截止',source:{messageId:latest.id,quote:latest.content}},action:{operation:'create',draft:{content:'模拟迟到结果'}}},'模拟迟到结果')
    await new Promise(r=>setTimeout(r,100))
    return {text:'模拟迟到结果',usage:null}
  },30)
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port
  let user='',cookie=''
  const request=(path:string,data?:unknown)=>fetch(base+path,{method:data?'POST':'GET',headers:{Origin:config.origin,Cookie:cookie,'X-Real-IP':fixtureIP,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined})
  try{
    const signup=await request('/api/auth/sign-up/email',{email:'lifeos-deadline-'+randomUUID()+'@example.invalid',name:'截止边界模拟验收',password:'Synthetic-'+randomUUID()});assert.equal(signup.status,200)
    cookie=signup.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');user=(await (await request('/api/session')).json()).id
    const chat=randomUUID(),id=randomUUID();await store.createConversation(user,{id:chat,title:'截止测试'})
    const result=await request('/api/conversations/'+chat+'/messages',{requestId:id,text:'这是截止边界的模拟输入。'})
    assert.match(await result.text(),/"code":"MODEL_TIMEOUT"/)
    const run=await store.runStatus(user,id);assert.equal(run.status,'failed');assert.equal(run.error_code,'MODEL_TIMEOUT');assert.equal((await store.decisionVersions(user,chat)).length,0)
    assert.equal(await coachEventView(user,chat),null)
  }finally{
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))
    if(user){await pool.query('DELETE FROM decision_versions WHERE user_id=$1',[user]);await pool.query('DELETE FROM runs WHERE user_id=$1',[user]);await pool.query('DELETE FROM "user" WHERE id=$1',[user])}config.trustedProxy=oldProxy;await pool.end()
  }
})
