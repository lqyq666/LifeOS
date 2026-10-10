// Capture the real authenticated local UI after the scripted acceptance chain.
// Does not create users, change facts, call a model or fabricate UI screenshots.
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
export async function recordLocalStory({browser,origin,cookie,chats,directory}:{browser:any;origin:string;cookie:string;chats:string[];directory:string}){
 const dir=resolve(directory,'demo');mkdirSync(dir,{recursive:true})
 const ctx=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir,size:{width:1280,height:720}}})
 await ctx.addCookies(cookie.split('; ').map(part=>{const at=part.indexOf('=');return {name:part.slice(0,at),value:part.slice(at+1),url:origin}}))
 await ctx.route('**/*',(r:any)=>r.request().url().startsWith(origin)?r.continue():r.abort())
 const page=await ctx.newPage(),video=page.video(),stages:any[]=[],errors:string[]=[],start=Date.now()
 page.on('pageerror',(e:any)=>errors.push(e.message))
 const show=async(id:string,label:string,seconds:number)=>{
  await page.goto(origin,{waitUntil:'networkidle'});await page.evaluate((x:string)=>sessionStorage.setItem('lifeos:pending-conversation',x),id)
  await page.goto(origin+'/#conversation',{waitUntil:'networkidle'});await page.locator('dialog.qa-page[open]').waitFor()
  stages.push({atSeconds:(Date.now()-start)/1000,label,kind:'ACTUAL_AUTHENTICATED_UI_REPLAY_SCRIPTED_PROVIDER',conversationId:id})
  const messages=page.locator('.qa-scroll');await messages.waitFor();await messages.evaluate((el:any)=>{el.scrollTop=0})
  await page.waitForTimeout(seconds*400)
  await messages.evaluate((el:any)=>{el.scrollTop=el.scrollHeight})
  await page.waitForTimeout(seconds*600)
 }
 try{
  await show(chats[0],'方向与方法：少量情况即可开始，选择方法尚未执行',40)
  await show(chats[1],'行动反馈：交付、采用、300元分别保存；课程优先与本周剩余时间',40)
  await show(chats[2],'方向调整：就业优先，旧作品仍作依据，新机会不覆盖本人预算',40)
  await page.getByRole('button',{name:'回到认知空间',exact:true}).click()
  if(await page.locator('.campus-page[data-mode="LANDING"]').count())await page.getByRole('button',{name:'进入 LifeOS',exact:true}).click()
  await page.locator('.campus-page[data-mode="OVERVIEW"]').waitFor()
  await page.getByText('个人经历 · 解释可修正',{exact:true}).waitFor()
  stages.push({atSeconds:(Date.now()-start)/1000,label:'星图：当前主题、实际经历、候选关系与变化分开',kind:'ACTUAL_PERSISTED_COGNITION_UI'})
  await page.waitForTimeout(30000);await page.screenshot({path:dir+'/starmap.png',fullPage:true})
  await show(chats[2],'新会话继续：已更新的就业重点、作品与时间约束进入帮助',30)
  if(errors.length)throw new Error('Demo browser errors: '+errors.join(';'))
 }finally{await ctx.close();await video.saveAs(dir+'/local-campus-story.webm');writeFileSync(dir+'/TIMELINE.json',JSON.stringify({evidence:'LOCAL_SCRIPTED_PROVIDER_REPLAY_NOT_REAL_MODEL_ACCEPTANCE',paidCalls:0,cloudCalls:0,errors,source:'workflow-local-trajectories freelance chain, authenticated persisted UI',stages,recordedSeconds:(Date.now()-start)/1000},null,2))}
}
