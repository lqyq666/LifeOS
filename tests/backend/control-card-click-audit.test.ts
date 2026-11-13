import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import {createApp} from '../../server/http.ts'
import {createGrowthItem,growthContext} from '../../server/growth.ts'
import * as store from '../../server/store.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

test('pending record-control cards: retry read, cancel and exact-record confirmation through actual browser clicks',async()=>{
 const old={origin:config.origin,access:config.entitlementsEnabled};config.entitlementsEnabled=false
 const app=createApp(async()=>{throw Error('NO_MODEL_CALL_EXPECTED')});await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(app.address() as any).port;config.origin=origin;let browser:any
 try{
  const email=randomUUID()+'@example.invalid',password='Synthetic-'+randomUUID(),signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic control cards',email,password})});assert.equal(signup.status,200);const user=(await signup.json() as any).user.id,chat=randomUUID();await store.createConversation(user,{id:chat,title:'合成控制来源'})
  const a=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'context',text:'海报排版是我负责的'}),b=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'context',text:'海报打印是我负责的'})
  const pending=async(kind:'forget'|'pause_use'|'stop_recommend')=>{const run=(await store.startRun(user,chat,randomUUID(),'处理海报那条记录。')).run;await store.finishRun(run,{candidates:[],audit:[],pendingMemoryControl:{kind,clauseText:'处理海报那条记录',candidates:[a,b].map(x=>({itemId:x.id,revision:x.revision,preview:x.text}))}},'请确认原记录。',null,new AbortController().signal);return run}
  await pending('forget')
  browser=await chromium.launch({headless:true});const c=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),p=await c.newPage();p.setDefaultTimeout(8000)
  await p.goto(origin+'/#conversation');await p.getByRole('dialog',{name:'LifeOS 聊一聊'}).getByRole('button',{name:'登录',exact:true}).click();await p.getByLabel('邮箱',{exact:true}).fill(email);await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('form',{name:'邮箱登录'}).getByRole('button',{name:'登录',exact:true}).click()
  await p.getByRole('button',{name:'都不是 / 先不操作',exact:true}).click();await p.getByText('已取消这次控制请求，记录保持原样。',{exact:true}).waitFor();assert.equal((await growthContext(user,chat)).filter(x=>x.id===a.id||x.id===b.id).length,2)
  for(const [kind,label] of [['pause_use','已暂停使用所选记录作为建议依据，原记录保留。'],['stop_recommend','已停止主动推荐所选事项，原记录保留。'],['forget','已遗忘所选记录。']] as const){
   // Each case uses a fresh source item, so revisions and earlier controls cannot be silently bypassed.
   const item=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'context',text:'本次'+kind+'验收记录来自合成任务'}),run=(await store.startRun(user,chat,randomUUID(),'请核对本次记录。')).run
   await store.finishRun(run,{candidates:[],audit:[],pendingMemoryControl:{kind,clauseText:'请核对本次记录',candidates:[{itemId:item.id,revision:item.revision,preview:item.text}]}},'请确认原记录。',null,new AbortController().signal)
   if(kind==='pause_use')await p.route('**/api/growth/control-requests',(r:any)=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE'}})}))
   await p.reload()
   if(kind==='pause_use'){await p.getByRole('button',{name:'重新读取',exact:true}).waitFor();await p.unroute('**/api/growth/control-requests');await p.getByRole('button',{name:'重新读取',exact:true}).click()}
   await p.getByRole('button',{name:'就是这条',exact:true}).click();await p.getByText(label,{exact:true}).waitFor();await p.reload();await p.getByRole('button',{name:'长期记忆',exact:true}).waitFor();assert.equal(await p.getByRole('button',{name:'就是这条',exact:true}).count(),0)
  }
  assert.equal((await growthContext(user,chat)).filter(x=>x.id===a.id||x.id===b.id).length,2);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 }finally{await browser?.close();app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));Object.assign(config,{origin:old.origin,entitlementsEnabled:old.access});await localEmbedding.close();await pool.end()}
})
