import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import {createApp} from '../../server/http.ts'
import {setMemorySettings,getMemoryView} from '../../server/memory.ts'
import * as store from '../../server/store.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

test('saved memory controls work through browser clicks, sources, correction, forgetting and historical interpretation decisions',async()=>{
 const old={origin:config.origin,access:config.entitlementsEnabled};config.entitlementsEnabled=false
 const app=createApp(async()=>{throw Error('NO_MODEL_CALL_EXPECTED')});await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(app.address() as any).port;config.origin=origin;let browser:any
 try{
  const email=randomUUID()+'@example.invalid',password='Synthetic-'+randomUUID()
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Synthetic memory controls',email,password})});assert.equal(signup.status,200);const user=(await signup.json() as any).user.id
  await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
  const records:any[]=[]
  for(const quote of ['我先完成课程接口，收到同学反馈后调整，最后按时交付。','我先做出演示页面，听完组员意见后修改，最后完成展示。']){
   const chat=randomUUID();await store.createConversation(user,{id:chat,title:'合成历史来源'})
   const run=(await store.startRun(user,chat,randomUUID(),quote)).run,staged:store.Staged={candidates:[],audit:[]}
   await store.stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote,links:[]});await store.finishRun(run,staged,'合成历史回应。',null,new AbortController().signal)
   const candidate=(await store.listExperiences(user,chat))[0],confirmed=await store.experienceAction(user,candidate.id,{requestId:randomUUID(),expectedRevision:candidate.revision,action:'confirm'})
   records.push({type:'experience',experienceId:confirmed.id,revision:confirmed.revision,conversationId:chat,messageId:run.source_message_id,quote})
  }
  // Historical fixture rows are inserted only in the disposable database.
  const ref=records[0]
  await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,status) VALUES($1,$2,'fact','priorAttempts',$3,'user_reported','user',$4,now(),'active')",[randomUUID(),user,JSON.stringify('完成课程接口'),JSON.stringify([{type:'message',conversationId:ref.conversationId,messageId:ref.messageId,quote:ref.quote}])])
  for(const context of ['课程任务','展示任务'])await pool.query("INSERT INTO memory_items(id,user_id,kind,value,assertion,scope,source_refs,observed_at,status) VALUES($1,$2,'pattern_candidate',$3,'system_pattern_candidate','user',$4,now(),'pending')",[randomUUID(),user,JSON.stringify({context,behavior:'根据反馈修改',outcome:'这两次完成交付',limitations:['仅两段经历']}),JSON.stringify(records)])
  browser=await chromium.launch({headless:true});const c=await browser.newContext({viewport:{width:390,height:844}}),p=await c.newPage();p.setDefaultTimeout(8000)
  await p.goto(origin+'/#conversation');await p.getByRole('dialog',{name:'LifeOS 聊一聊'}).getByRole('button',{name:'登录',exact:true}).click();await p.getByLabel('邮箱',{exact:true}).fill(email);await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('form',{name:'邮箱登录'}).getByRole('button',{name:'登录',exact:true}).click();await p.getByRole('button',{name:'长期记忆',exact:true}).click()
  await p.locator('.qa-memory-source summary').first().click();await p.getByText(ref.quote,{exact:true}).first().waitFor()
  await p.getByRole('button',{name:'更正',exact:true}).click();await p.getByRole('button',{name:'取消',exact:true}).click()
  await p.getByRole('button',{name:'更正',exact:true}).click();await p.getByRole('textbox',{name:'更正记忆内容'}).fill('完成过课程接口，独立程度仍待核对');await p.locator('.qa-memory-edit').getByRole('button',{name:'保存',exact:true}).click();await p.getByText('完成过课程接口，独立程度仍待核对',{exact:true}).waitFor()
  await p.reload();await p.getByRole('button',{name:'长期记忆',exact:true}).click();await p.getByText('完成过课程接口，独立程度仍待核对',{exact:true}).waitFor()
  await p.getByRole('button',{name:'忘记',exact:true}).click();await p.getByText('还没有长期保存的背景信息。',{exact:true}).waitFor()
  await p.locator('li').filter({hasText:'课程任务时'}).getByRole('button',{name:'认可这段描述',exact:true}).click();await p.getByText('你已认可',{exact:true}).waitFor()
  await p.locator('li').filter({hasText:'展示任务时'}).getByRole('button',{name:'不符合',exact:true}).click();await p.getByText('你已否定',{exact:true}).waitFor()
  const view=await getMemoryView(user);assert.equal(view.items.filter(x=>x.kind==='fact').length,0);assert.equal(view.items.filter(x=>x.status==='accepted').length,1);assert.equal(view.items.filter(x=>x.status==='rejected').length,1)
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 }finally{await browser?.close();app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));Object.assign(config,{origin:old.origin,entitlementsEnabled:old.access});await localEmbedding.close();await pool.end()}
})
