import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {mkdirSync,writeFileSync} from 'node:fs'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import {createApp} from '../../server/http.ts'
import {createGrowthItem} from '../../server/growth.ts'
import {setMemorySettings} from '../../server/memory.ts'
import * as store from '../../server/store.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import type {Engine} from '../../server/agent.ts'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

test('desktop and actual 390px Chrome: chat-driven modes, memory privacy, save and one handler per click',async()=>{
 const received:string[]=[],errors:string[]=[],checks:string[]=[]
 const engine:Engine=async input=>{const text=input.context.find(row=>row.id===input.run.source_message_id)!.content;received.push(text);input.emit({type:'draft',text:'### 正在梳理\n',saved:false});return {text:'### 个人依据\n合成界面验证，使用正常流式与提交路径。\n\n### 条件与未知\n未核实的资格和条件保持未知。\n\n### 取舍与下一步\n建议用于取得新证据，不代表已经选定或执行。',usage:null}}
 const old={origin:config.origin,rate:config.messagesPerMinute,access:config.entitlementsEnabled,signup:config.signupEnabled}
 config.entitlementsEnabled=false;config.signupEnabled=true;config.messagesPerMinute=1000
 const app=createApp(engine);await new Promise<void>(ok=>app.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+(app.address() as any).port;config.origin=origin
 const out=process.env.LIFEOS_UI_EVIDENCE||'.local/three-modes-20261024/browser';mkdirSync(out,{recursive:true});let browser:any
 try{
  const email=randomUUID()+'@example.invalid',password='Synthetic-'+randomUUID()
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'SYNTHETIC 成年学生',email,password})});assert.equal(signup.status,200)
  const user=(await signup.json() as any).user.id,chat=randomUUID();await store.createConversation(user,{id:chat,title:'SYNTHETIC 本人记录'});await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  const pref=await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'preference',text:'我重视创造，也希望保留休息。'})
  await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'goal',text:'我决定探索就业。'})
  await createGrowthItem(user,{requestId:randomUUID(),conversationId:chat,kind:'constraint',text:'本周可用两小时。',validUntil:new Date(Date.now()+7*86400000).toISOString()})
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();page.on('pageerror',(e:Error)=>errors.push(e.message))
  await page.goto(origin+'/#conversation');await page.getByRole('dialog',{name:'LifeOS 聊一聊'}).getByRole('button',{name:'登录',exact:true}).click();await page.getByLabel('邮箱',{exact:true}).fill(email);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('form',{name:'邮箱登录'}).getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'长期记忆',exact:true}).waitFor()
  const entry=page.getByRole('region',{name:'LifeOS 三种模式'})
  assert.equal(await entry.locator('button').count(),3)
  assert.equal(await page.locator('.qa-mode-panel,.qa-mode-options,.qa-understanding').count(),0,'mode buttons start chat without removed forms')
  for(const [index,name] of ['认识我','选方向','做选择'].entries()){
   await entry.getByRole('button',{name:new RegExp('^'+name)}).click()
   await page.getByText('个人依据',{exact:true}).nth(index).waitFor()
   assert.equal(received.length,index+1,'one normal handler per mode click')
   assert.ok(received[index].startsWith('【'+name+'】'))
   assert.ok(received[index].includes('不修改档案'))
   assert.equal(await page.locator('.qa-mode-panel,.qa-mode-options,.qa-understanding').count(),0)
  }
  checks.push('all three buttons directly send normal chat requests exactly once; deleted forms stay absent')
  await page.reload();await page.getByText('个人依据',{exact:true}).nth(2).waitFor();assert.equal(received.length,3)
  checks.push('three complete mode replies survive actual refresh')
  await page.screenshot({path:out+'/mode-chat-desktop.png'})
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>innerWidth),390)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:out+'/mode-chat-390.png'})
  checks.push('actual 390px Chrome keeps modes and normal composer inside viewport')
  await page.setViewportSize({width:1280,height:900})
  const list=async()=>await (await page.request.get(origin+'/api/conversations?includeStateChanges=false')).json()
  const active=(await list()).find((item:any)=>item.messages.length===6);assert.ok(active)
  const openSidebar=async()=>{const trigger=page.getByRole('button',{name:'展开侧边栏',exact:true});if(await trigger.count())await trigger.click()}
  await openSidebar()
  await page.getByRole('button',{name:'管理对话：'+active.title,exact:true}).click()
  await page.getByRole('menu',{name:'对话操作'}).getByRole('menuitem',{name:'重命名',exact:true}).click()
  await page.getByRole('dialog',{name:'重命名对话'}).getByLabel('对话名称').fill('SYNTHETIC 重命名后的演示')
  await page.getByRole('dialog',{name:'重命名对话'}).getByRole('button',{name:'保存',exact:true}).click()
  await page.getByRole('button',{name:'管理对话：SYNTHETIC 重命名后的演示',exact:true}).waitFor()
  await page.getByRole('button',{name:'管理对话：SYNTHETIC 重命名后的演示',exact:true}).click()
  await page.getByRole('menuitem',{name:'置顶',exact:true}).click()
  await page.getByRole('button',{name:'创建项目',exact:true}).click()
  await page.getByRole('dialog',{name:'创建项目'}).getByLabel('项目名称').fill('SYNTHETIC 验收项目')
  await page.getByRole('dialog',{name:'创建项目'}).getByRole('button',{name:'创建',exact:true}).click()
  await page.getByRole('button',{name:'管理项目：SYNTHETIC 验收项目',exact:true}).waitFor()
  await page.getByRole('button',{name:'管理对话：SYNTHETIC 重命名后的演示',exact:true}).click()
  await page.getByRole('menuitem',{name:'移至项目',exact:true}).click()
  await page.getByRole('menuitemradio',{name:'SYNTHETIC 验收项目',exact:true}).click()
  await page.reload();await page.getByRole('button',{name:'长期记忆',exact:true}).waitFor()
  const moved=(await list()).find((item:any)=>item.id===active.id)
  assert.equal(moved.title,'SYNTHETIC 重命名后的演示');assert.equal(moved.pinned,true);assert.ok(moved.project_id)
  checks.push('rename, pin and project move use floating menus and persist after refresh')
  const disposable=randomUUID();assert.equal((await page.request.post(origin+'/api/conversations',{headers:{Origin:origin},data:{id:disposable,title:'SYNTHETIC 可删除对话'}})).status(),201)
  await page.reload();await page.getByRole('button',{name:'长期记忆',exact:true}).waitFor();await page.setViewportSize({width:390,height:844});await openSidebar()
  await page.getByRole('button',{name:'管理项目：SYNTHETIC 验收项目',exact:true}).click()
  const box=await page.getByRole('menu',{name:'项目操作'}).boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=390)
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'管理对话：SYNTHETIC 可删除对话',exact:true}).click()
  await page.getByRole('menuitem',{name:'删除',exact:true}).click()
  await page.getByRole('dialog',{name:'删除对话'}).getByRole('button',{name:'确认删除',exact:true}).click()
  await page.getByRole('button',{name:'管理对话：SYNTHETIC 可删除对话',exact:true}).waitFor({state:'hidden'})
  assert.ok(!(await list()).some((item:any)=>item.id===disposable))
  assert.ok((await list()).some((item:any)=>item.id===active.id&&item.messages.length===6))
  const preserved=await (await page.request.get(origin+'/api/growth?conversation='+chat)).json();assert.ok(preserved.items.some((item:any)=>item.id===pref.id))
  const closeSidebar=page.getByRole('button',{name:'收起侧边栏',exact:true});if(await closeSidebar.count())await closeSidebar.last().click()
  checks.push('390px project popup stays in viewport; deleting disposable chat preserves prior messages and memory')
  await page.getByRole('button',{name:'长期记忆',exact:true}).click()
  await page.getByLabel('启用长期记忆',{exact:true}).click()
  await page.getByText('已关闭：不会跨对话复用长期记忆。',{exact:true}).waitFor()
  assert.equal(received.length,3,'memory switch dispatches no generation')
  const off=await (await page.request.get(origin+'/api/understanding')).json()
  assert.equal(off.memoryEnabled,false)
  assert.ok(off.dimensions.every((dimension:any)=>dimension.items.length===0),'same authorized projection hides cross-session facts')
  checks.push('memory OFF hides cross-session understanding with no new handler call')
  await page.getByRole('button',{name:'关闭记忆面板'}).click()
  await page.getByRole('button',{name:'回到认知空间',exact:true}).click()
  await page.getByRole('dialog',{name:'LifeOS 聊一聊'}).waitFor({state:'hidden'})
  await page.screenshot({path:out+'/starmap-390.png'})
  checks.push('same account cognition space remains reachable')
  assert.deepEqual(errors,[]);writeFileSync(out+'/report.json',JSON.stringify({status:'PASS_LOCAL_ACTUAL_CHROME_DESKTOP_AND_390',viewportWidths:[1280,390],providerCalls:0,scriptedHandlerCalls:received.length,checks,errors},null,2))
 }catch(error){if(browser){const p=browser.contexts()[0]?.pages()[0];if(p)await p.screenshot({path:out+'/failure-'+Date.now()+'.png'}).catch(()=>{})}throw error}finally{if(browser)await browser.close();Object.assign(config,{origin:old.origin,messagesPerMinute:old.rate,entitlementsEnabled:old.access,signupEnabled:old.signup});app.closeAllConnections();await new Promise<void>(ok=>app.close(()=>ok()));await localEmbedding.close();await pool.end()}
})
