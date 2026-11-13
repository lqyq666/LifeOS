import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {config} from '../../server/config.ts'
import {pool,HttpError} from '../../server/db.ts'
import {createApp} from '../../server/http.ts'
import type {Engine} from '../../server/agent.ts'
import * as store from '../../server/store.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

test('actual send/stop/error/reopen clicks preserve input, never commit cancelled output or silently retry',async()=>{
 const old={origin:config.origin,access:config.entitlementsEnabled};config.entitlementsEnabled=false
 let calls=0,request='',release=()=>{}
 const engine:Engine=async input=>{calls++;request=input.run.request_id
  if(calls===1){input.emit({type:'draft',text:'你想先核对哪一步？',saved:false});await new Promise<void>(r=>{release=r;input.signal.addEventListener('abort',()=>r(),{once:true})});return {text:'取消后晚到的内容不可保存',usage:null}}
  if(calls===2)throw new HttpError(503,'MODEL_OVERLOADED')
  return {text:'恢复后的完整合成回复。\n\n**保存核对**\n\n- 输入保留。\n- 本轮只执行一次。',usage:null}
 }
 const app=createApp(engine);await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(app.address() as any).port;config.origin=origin;let browser:any
 try{
  const email=randomUUID()+'@example.invalid',password='Synthetic-'+randomUUID(),res=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password,name:'Synthetic recovery'})});assert.equal(res.status,200);const user=(await res.json() as any).user.id
  browser=await chromium.launch({headless:true});const c=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),p=await c.newPage();p.setDefaultTimeout(8000)
  await p.goto(origin+'/#conversation');await p.getByRole('dialog',{name:'LifeOS 聊一聊'}).getByRole('button',{name:'登录',exact:true}).click();await p.getByLabel('邮箱',{exact:true}).fill(email);await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('form',{name:'邮箱登录'}).getByRole('button',{name:'登录',exact:true}).click();await p.getByRole('button',{name:'长期记忆',exact:true}).waitFor()
  await p.getByLabel('想聊的事',{exact:true}).fill('合成取消测试，解释算法即可。');await p.getByRole('button',{name:'发送消息',exact:true}).click();await p.getByText('你想先核对哪一步？',{exact:true}).waitFor();await p.getByLabel('想聊的事',{exact:true}).press('Enter');assert.equal(calls,1)
  const cancelled=request;await p.getByRole('button',{name:'停止生成',exact:true}).click();await p.getByRole('button',{name:'发送消息',exact:true}).waitFor();assert.equal((await store.runStatus(user,cancelled)).status,'cancelled');await p.reload();await p.getByRole('button',{name:'长期记忆',exact:true}).waitFor();assert.equal(await p.locator('.qa-message.is-assistant').count(),0);assert.equal((await pool.query("SELECT 1 FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,cancelled])).rowCount,0);assert.equal(calls,1)
  await p.getByLabel('想聊的事',{exact:true}).fill('合成限流测试，解释算法即可。');await p.getByRole('button',{name:'发送消息',exact:true}).click();await p.getByText(/模型平台当前拥塞/).waitFor();assert.equal(calls,2);await p.reload();await p.getByRole('button',{name:'长期记忆',exact:true}).waitFor();assert.equal(calls,2);assert.equal(await p.locator('.qa-message.is-assistant').count(),0)
  await p.getByLabel('想聊的事',{exact:true}).fill('合成恢复测试，解释算法即可。');await p.getByRole('button',{name:'发送消息',exact:true}).click();await p.getByText('恢复后的完整合成回复。',{exact:true}).waitFor();const text=await p.locator('.qa-message.is-assistant .qa-message-body').innerText();await p.reload();await p.getByRole('button',{name:'长期记忆',exact:true}).waitFor();assert.equal(await p.locator('.qa-message.is-assistant .qa-message-body').innerText(),text);assert.equal(calls,3);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 }finally{release();await browser?.close();app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));Object.assign(config,{origin:old.origin,entitlementsEnabled:old.access});await localEmbedding.close();await pool.end()}
})
