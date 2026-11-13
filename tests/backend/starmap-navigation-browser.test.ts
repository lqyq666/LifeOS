import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {config} from '../../server/config.ts'
import {pool,transaction} from '../../server/db.ts'
import {linkExperienceToThemes} from '../../server/user-themes.ts'
import {createApp} from '../../server/http.ts'
import {createGrowthItem} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'
import * as store from '../../server/store.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import type {Engine} from '../../server/agent.ts'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

test('star-map source and theme navigation preserve drafts and bind focus to the intended chat',async()=>{
 const calls:any[]=[]
 const engine:Engine=async input=>{calls.push(input.focusContext);return {text:'合成导航验证回复，不生成个人事实。',usage:null}}
 const old={origin:config.origin,access:config.entitlementsEnabled,rate:config.messagesPerMinute};config.entitlementsEnabled=false;config.messagesPerMinute=1000
 const app=createApp(engine);await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(app.address() as any).port;config.origin=origin;let browser:any
 try{
  const email=randomUUID()+'@example.invalid',password='Synthetic-'+randomUUID();const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic navigation',email,password})});assert.equal(signup.status,200);const user=(await signup.json() as any).user.id
  const source=randomUUID();await store.createConversation(user,{id:source,title:'原始经历对话'});await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  await createGrowthItem(user,{requestId:randomUUID(),conversationId:source,kind:'goal',text:'我想探索科研。'})
  const text='今天我整理了课程实验数据，标出了两处异常。',run=(await store.startRun(user,source,randomUUID(),text)).run;await store.terminateRun(user,run.request_id,'cancelled','SYNTHETIC_NAVIGATION_SETUP')
  await pool.query("INSERT INTO experiences(id,user_id,conversation_id,source_message_id,source_quote,request_id,content,status,confirmed_at,confirm_source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',now(),'auto',1)",[randomUUID(),user,source,run.source_message_id,text,run.request_id,{title:'课程实验数据整理',summary:text,action:text,result:'异常仍待复查',reflection:'只说明本次动作',occurredAt:'今天',source:'用户对话原话',tags:[]}])
  const graph=await store.cognitionGraph(user),theme=graph.nodes.find((n:any)=>n.themeId) as any,experience=graph.nodes.find((n:any)=>n.serverId) as any;assert.ok(theme&&experience)
  await transaction(c=>linkExperienceToThemes(c,user,experience.serverId,'我想探索科研。'+text,true))
  browser=await chromium.launch({headless:true});const c=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),p=await c.newPage();p.setDefaultTimeout(8000)
  await p.goto(origin+'/#conversation');await p.getByRole('dialog',{name:'LifeOS 聊一聊'}).getByRole('button',{name:'登录',exact:true}).click();await p.getByLabel('邮箱',{exact:true}).fill(email);await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('form',{name:'邮箱登录'}).getByRole('button',{name:'登录',exact:true}).click();await p.getByRole('button',{name:'长期记忆',exact:true}).waitFor()
  await p.locator('.qa-sidebar-actions button').filter({hasText:'新对话'}).click();await p.getByRole('textbox',{name:'想聊的事'}).fill('必须保留的旧草稿')
  await p.getByRole('button',{name:'回到认知空间'}).click();await p.locator('.rail-preview:enabled').click();await p.getByRole('button',{name:'主题详情',exact:true}).click()
  let releaseRefresh!:()=>void
  const delayedRefresh=new Promise<void>(resolve=>{releaseRefresh=resolve})
  const holdGraph=async(route:any)=>{const response=await route.fetch();await delayedRefresh;await route.fulfill({response})}
  await p.route('**/api/cognition',holdGraph)
  try{
    await p.getByRole('button',{name:'重命名',exact:true}).click();await p.getByLabel('主题名称').fill('科研：保留真实依据')
    await p.locator('.theme-rename').getByRole('button',{name:'保存',exact:true}).click();await p.locator('.theme-panel').waitFor({state:'hidden'})
    await p.getByRole('button',{name:'主题详情',exact:true}).click()
    assert.equal(await p.locator('#theme-title').innerText(),'科研：保留真实依据','confirmed rename is visible before background graph refresh')
    await p.getByRole('button',{name:'重命名',exact:true}).click();await p.getByLabel('主题名称').fill(theme.title)
    const savedAgain=p.waitForResponse((r:any)=>new URL(r.url()).pathname==='/api/themes/'+theme.themeId+'/actions')
    await p.locator('.theme-rename').getByRole('button',{name:'保存',exact:true}).click();assert.equal((await savedAgain).status(),200,'rapid second edit uses the committed revision')
    await p.locator('.theme-panel').waitFor({state:'hidden'})
  }finally{releaseRefresh();await p.unrouteAll({behavior:'wait'})}
  await p.getByRole('button',{name:'主题详情',exact:true}).click()
  await p.getByRole('button',{name:'确认连线',exact:true}).click();await p.getByRole('button',{name:'主题详情',exact:true}).click()
  assert.ok((await store.cognitionGraph(user)).edges.some((e:any)=>e.type==='RELATES_TO_VALUE'&&e.confirmed))
  for(const label of ['暂缓','恢复']){
   const refreshed=p.waitForResponse((r:any)=>new URL(r.url()).pathname==='/api/cognition'&&r.status()===200)
   await p.getByRole('button',{name:label,exact:true}).click();await refreshed
   await p.getByRole('button',{name:'主题详情',exact:true}).click()
  }
  await p.getByRole('button',{name:'继续聊这个主题',exact:true}).click()
  await p.waitForFunction((title:string)=>(document.querySelector('.qa-composer textarea') as HTMLTextAreaElement)?.value.includes(title),theme.title,{timeout:3000})
  assert.equal(await p.evaluate(()=>sessionStorage.getItem('lifeos:pending-conversation-draft')),null)
  const workspace=await p.evaluate((id:string)=>JSON.parse(localStorage.getItem('lifeos.conversation-workspace.v1.'+id)!),user);assert.ok(workspace.chats.some((x:any)=>x.draft==='必须保留的旧草稿'))
  await p.getByRole('button',{name:'发送消息',exact:true}).click();await p.getByText('合成导航验证回复，不生成个人事实。',{exact:true}).waitFor();assert.equal(calls.length,1);assert.equal(calls[0]?.id,theme.themeId)
  await p.getByRole('button',{name:'回到认知空间'}).click();await p.locator('.rail-preview:enabled').click();await p.getByRole('button',{name:'打开原对话',exact:true}).click()
  await p.locator('.qa-message.is-user').filter({hasText:text}).waitFor();assert.equal(await p.locator('.qa-context-title').innerText(),'原始经历对话');assert.equal(await p.locator('.qa-msg-flash').getAttribute('id'),'qa-msg-'+run.source_message_id)
  await p.reload();await p.locator('.qa-message.is-user').filter({hasText:text}).waitFor();assert.equal(calls.length,1)
  await pool.query("INSERT INTO growth_direction_controls(user_id,scope,state,revision,source_conversation_id,source_message_id,source_quote,origin_request_id) VALUES($1,'research_exploration','paused',1,$2,$3,'先别推科研建议',$4)",[user,source,run.source_message_id,run.request_id])
  await p.reload();await p.getByRole('button',{name:'回到认知空间'}).click();await p.locator('.rail-preview:enabled').click();await p.getByRole('button',{name:'主题详情',exact:true}).click()
  await p.getByText(/你已在对话中暂停这个方向的主动推荐/).waitFor();assert.equal(await p.getByRole('button',{name:'恢复',exact:true}).count(),0)
  await p.getByRole('button',{name:'继续聊这个主题',exact:true}).click();assert.equal((await pool.query("SELECT state FROM growth_direction_controls WHERE user_id=$1 AND scope='research_exploration'",[user])).rows[0].state,'paused')
  await p.getByRole('button',{name:'回到认知空间'}).click();await p.getByRole('button',{name:'主题详情',exact:true}).click();await p.getByRole('button',{name:'撤销连线',exact:true}).click()
  assert.equal((await store.cognitionGraph(user)).edges.some((e:any)=>e.type==='RELATES_TO_VALUE'),false)
  await p.getByRole('button',{name:'回到对话',exact:true}).click()
  await p.evaluate(()=>{sessionStorage.setItem('lifeos:pending-conversation-draft','上一账号待处理草稿');sessionStorage.setItem('lifeos:focus-context','{"id":"old-account-context"}')})
  await p.getByRole('button',{name:'退出登录',exact:true}).click();await p.getByText('已退出登录',{exact:true}).waitFor()
  assert.equal(await p.evaluate(()=>sessionStorage.getItem('lifeos:pending-conversation-draft')),null)
  assert.equal(await p.evaluate(()=>sessionStorage.getItem('lifeos:focus-context')),null)
 }finally{await browser?.close();app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));Object.assign(config,{origin:old.origin,entitlementsEnabled:old.access,messagesPerMinute:old.rate});await localEmbedding.close();await pool.end()}
})
