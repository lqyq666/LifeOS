import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApp } from '../../server/http.ts'
import { config } from '../../server/config.ts'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { validate, messageSchema, candidateSchema } from '../../server/contracts.ts'
import { actionCoachTurnSchema } from '../../server/action-coach-contracts.ts'
import { stageCoachEvent, coachEventView } from '../../server/action-coach-events.ts'
import type { Engine } from '../../server/agent.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('real PostgreSQL and Better Auth enforce ownership, provenance, versions, idempotency and cancellation (model simulated)', async t=>{
  const oldProxy=config.trustedProxy;config.trustedProxy='127.0.0.1'
  const fixtureIP='198.18.'+Math.floor(Math.random()*256)+'.'+Math.floor(Math.random()*256)
  let releaseLate:()=>void=()=>{}, enteredLate:()=>void=()=>{}
  let lateEntered=new Promise<void>(resolve=>{enteredLate=resolve})
  let calls=0
  const engine:Engine=async input=>{
    calls++
    const latest=input.context.at(-1),quote=latest.content
    input.staged.coach=await stageCoachEvent(input.run,{target:{operation:'create',title:'模拟过程',source:{messageId:latest.id,quote}},nodes:[{kind:'fact',source:{messageId:latest.id,quote}}],action:{operation:'create',draft:{content:'模拟模型输出，仅供测试。'}}},'模拟模型输出，仅供测试。')
    input.emit({type:'draft',text:'你想先核对哪一步？',saved:false})
    if(quote.includes('失败'))throw new Error('SIMULATED_PROVIDER_FAILURE')
    if(quote.includes('迟到')){enteredLate();await new Promise<void>(resolve=>{releaseLate=resolve})}
    else await store.stageCandidate(input.run,input.staged,{sourceMessageId:latest.id,quote,links:[{valueId:'value-growth',reason:'模拟模型候选解释，等待用户校准。'}]},input.signal)
    input.emit({type:'delta',text:'模拟模型输出，仅供测试。'})
    // Deliberately ignores cancellation after entering the gate.
    return {text:'模拟模型输出，仅供测试。',usage:null}
  }
  const server=createApp(engine)
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address() as {port:number};const base='http://127.0.0.1:'+address.port
  const accounts:{id:string;cookie:string}[]=[]
  const evidence:{evidence:string;checks:string[]}={evidence:'REAL_POSTGRESQL_REAL_BETTER_AUTH_HTTP_SIMULATED_MODEL',checks:[]}
  async function request(path:string,data?:unknown,cookie='',method?:string){
    const response=await fetch(base+path,{method:method??(data===undefined?'GET':'POST'),headers:{Origin:config.origin,'X-Real-IP':fixtureIP,...(data!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)})
    const raw=await response.text();let value:any;try{value=JSON.parse(raw)}catch{value=raw}
    return {response,status:response.status,value,raw}
  }
  async function check(name:string,fn:()=>Promise<void>|void){await t.test(name,fn);evidence.checks.push(name)}
  async function account(){
    const email='lifeos-safety-'+randomUUID()+'@example.invalid'
    const result=await request('/api/auth/sign-up/email',{email,password:'Synthetic-test-'+randomUUID(),name:'自动验收数据'})
    assert.equal(result.status,200,result.raw)
    const cookie=result.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
    const me=await request('/api/session',undefined,cookie);assert.equal(me.status,200)
    const value={id:me.value.id,cookie};accounts.push(value);return value
  }
  try{
    const a=await account(),b=await account(),conversation=randomUUID()
    await check('anonymous callers and foreign origins cannot write',async()=>{
      assert.equal((await request('/api/conversations')).status,401)
      const r=await fetch(base+'/api/conversations',{method:'POST',headers:{Origin:'https://foreign.invalid','Content-Type':'application/json',Cookie:a.cookie},body:JSON.stringify({id:conversation,title:'边界测试'})});assert.equal(r.status,403)
    })
    await check('effective user identity cannot be supplied in request or tool parameters',()=>{
      assert.throws(()=>validate(messageSchema,{requestId:randomUUID(),text:'测试',userId:b.id}))
      assert.throws(()=>validate(candidateSchema,{sourceMessageId:randomUUID(),quote:'测试',links:[],status:'confirmed'}))
      assert.throws(()=>validate(actionCoachTurnSchema,{reply:'x',permanentValues:['成长']}))
    })
    assert.equal((await request('/api/conversations',{id:conversation,title:'边界测试'},a.cookie)).status,201)
    await check('retired retrieval and memory organizer endpoints are unavailable',async()=>{
      assert.equal((await request('/api/retrieval',{query:'',limit:10},a.cookie)).status,404)
      assert.equal((await request('/api/conversations/'+conversation+'/memory/organize',{requestId:randomUUID()},a.cookie)).status,404)
      assert.equal((await request('/api/conversations/'+conversation+'/campus',{requestId:randomUUID(),inquiryId:null,expectedCurrentId:null},a.cookie)).status,404)
      assert.equal((await request('/api/conversations/'+conversation+'/campus/'+randomUUID()+'/actions',{requestId:randomUUID(),expectedRevision:1,action:'experiment_accept',targetId:randomUUID()},a.cookie)).status,404)
    })
    await check('long user input is preserved in full and oversize input is rejected explicitly',async()=>{
      const long='这是未截断的长篇输入。'.repeat(500)
      validate(messageSchema,{requestId:randomUUID(),text:long})
      assert.throws(()=>validate(messageSchema,{requestId:randomUUID(),text:'字'.repeat(16001)}))
      const chat=randomUUID();await store.createConversation(a.id,{id:chat,title:'长输入来源'})
      const started=await store.startRun(a.id,chat,randomUUID(),long)
      const source=(await pool.query('SELECT content FROM messages WHERE user_id=$1 AND id=$2',[a.id,started.run.source_message_id])).rows[0]
      assert.equal(source.content,long)
      await store.terminateRun(a.id,started.run.request_id,'cancelled','SYNTHETIC_LONG_INPUT')
      const oversized=await request('/api/conversations/'+chat+'/messages',{requestId:randomUUID(),text:'字'.repeat(22000)},a.cookie)
      assert.equal(oversized.status,413);assert.equal(oversized.value.error,'REQUEST_TOO_LARGE')
    })
    const requestId=randomUUID(),text='我完成了一项数据库验收练习。'
    const first=await request('/api/conversations/'+conversation+'/messages',{requestId,text},a.cookie)
    assert.equal(first.status,200);assert.match(first.raw,/"type":"done"/)
    assert.match(first.raw,/"type":"draft","text":"你想先核对哪一步？","saved":false/)
    assert.match(first.raw,/"replace":true,"saved":true/)
    const run=(await pool.query('SELECT * FROM runs WHERE user_id=$1 AND request_id=$2',[a.id,requestId])).rows[0] as store.Run
    const experiences=await store.listExperiences(a.id,conversation),experience=experiences[0]
    await check('successful run commits one event, action and candidate with exact user source',async()=>{
      const event=(await coachEventView(a.id,conversation))!
      assert.equal(event.nodes[0].content,text);assert.equal(event.actions.length,1)
      assert.equal(event.actions[0].draft?.content,'模拟模型输出，仅供测试。')
      assert.equal((await store.decisionVersions(a.id,conversation)).length,0)
      assert.equal(experience.status,'candidate');assert.equal(experience.source_quote,text)
      assert.equal((await store.retrieveExperiences(a.id,{query:'',limit:10})).records.length,0)
      assert.equal((await store.cognitionGraph(a.id)).nodes.filter(n=>n.type==='experience').length,0)
    })
    await check('replaying the same request never calls model again or duplicates business rows',async()=>{
      const before=calls,r=await request('/api/conversations/'+conversation+'/messages',{requestId,text},a.cookie)
      assert.equal(r.status,200);assert.match(r.raw,/"replayed":true/);assert.equal(calls,before)
      assert.equal((await pool.query('SELECT 1 FROM coach_events WHERE user_id=$1 AND conversation_id=$2',[a.id,conversation])).rowCount,1)
      assert.equal((await store.decisionVersions(a.id,conversation)).length,0);assert.equal((await store.listExperiences(a.id)).length,1)
      assert.equal((await request('/api/conversations/'+conversation+'/messages',{requestId,text:'换掉文本'},a.cookie)).status,409)
    })
    await check('another account cannot read, cancel, confirm or modify owner data',async()=>{
      assert.equal((await request('/api/conversations/'+conversation+'/decisions',undefined,b.cookie)).status,404)
      assert.equal((await request('/api/conversations/'+conversation+'/event',undefined,b.cookie)).status,404)
      assert.equal((await request('/api/conversations/'+conversation+'/event/search',{query:''},b.cookie)).status,404)
      assert.equal((await request('/api/conversations/'+conversation+'/event/search',{query:'',userId:b.id},a.cookie)).status,400)
      assert.equal((await request('/api/conversations/'+conversation+'/event/search',{query:'',after:'bad-date'},a.cookie)).status,400)
      const ownEvent=await request('/api/conversations/'+conversation+'/event',undefined,a.cookie)
      assert.equal(ownEvent.status,200);assert.equal(ownEvent.value.nodes[0].content,text)
      assert.equal((await request('/api/runs/'+requestId+'/cancel',{},b.cookie)).status,404)
      assert.equal((await request('/api/experiences/'+experience.id+'/actions',{requestId:randomUUID(),expectedRevision:1,action:'confirm'},b.cookie)).status,404)
      assert.equal((await store.retrieveExperiences(b.id,{query:'',limit:10})).records.length,0)
    })
    await check('failed provider run never commits staged event, action or experience',async()=>{
      const chat=randomUUID();await store.createConversation(a.id,{id:chat,title:'调用失败'})
      const failed=await request('/api/conversations/'+chat+'/messages',{requestId:randomUUID(),text:'我完成了失败回滚测试。'},a.cookie)
      assert.match(failed.raw,/MODEL_REQUEST_FAILED/)
      assert.match(failed.raw,/"type":"draft_discarded"/)
      assert.doesNotMatch(failed.raw,/"type":"delta"/)
      assert.equal((await store.decisionVersions(a.id,chat)).length,0);assert.equal((await store.listExperiences(a.id,chat)).length,0)
      assert.equal(await coachEventView(a.id,chat),null)
    })
    await check('a database lock in one conversation does not block another conversation from starting',async()=>{
      const left=randomUUID(),right=randomUUID();await store.createConversation(a.id,{id:left,title:'锁等待'});await store.createConversation(a.id,{id:right,title:'并发启动'})
      const client=await pool.connect();await client.query('BEGIN');const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE',[left])
      const first=request('/api/conversations/'+left+'/messages',{requestId:randomUUID(),text:'我完成了单并发验收。'},a.cookie)
      try{
        let blocked=false
        for(let i=0;i<50;i++){blocked=(await pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',[pid])).rows[0].blocked;if(blocked)break;await new Promise(r=>setTimeout(r,10))}
        assert.ok(blocked,'request must reach the locked database row')
        const allowed=await request('/api/conversations/'+right+'/messages',{requestId:randomUUID(),text:'我完成了并发启动验收。'},a.cookie)
        assert.equal(allowed.status,200)
        assert.match(allowed.raw,/"type":"done"/)
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM messages WHERE user_id=$1 AND conversation_id=$2',[a.id,right])).rows[0].n,2)
      }finally{await client.query('COMMIT');client.release()}
      assert.match((await first).raw,/"type":"done"/)
    })
    await check('accounts execute concurrently while same-account queued requests can cancel without reaching the model',async()=>{
      const firstChat=randomUUID(),queuedChat=randomUUID(),otherChat=randomUUID(),firstId=randomUUID(),queuedId=randomUUID()
      await store.createConversation(a.id,{id:firstChat,title:'合成并发占用'})
      await store.createConversation(a.id,{id:queuedChat,title:'合成可取消等待'})
      await store.createConversation(b.id,{id:otherChat,title:'合成跨账户并发'})
      const first=request('/api/conversations/'+firstChat+'/messages',{requestId:firstId,text:'我完成了迟到并发验收。'},a.cookie)
      await lateEntered
      const callsBeforeQueued=calls
      const queued=await fetch(base+'/api/conversations/'+queuedChat+'/messages',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json',Cookie:a.cookie,'X-Real-IP':fixtureIP},body:JSON.stringify({requestId:queuedId,text:'我完成了队列取消验收。'})})
      assert.equal(queued.status,200)
      try{
        const other=await request('/api/conversations/'+otherChat+'/messages',{requestId:randomUUID(),text:'我完成了另一账户的并发验收。'},b.cookie)
        assert.match(other.raw,/"type":"done"/)
        assert.equal(calls,callsBeforeQueued+1,'only the other account entered the model; same-account work stayed queued')
        const cancelled=await request('/api/runs/'+queuedId+'/cancel',{},a.cookie)
        assert.equal(cancelled.value.status,'cancelled')
        const raw=await queued.text()
        assert.match(raw,/"type":"queued"/)
        assert.match(raw,/"code":"CANCELLED"/)
        assert.equal((await store.decisionVersions(a.id,queuedChat)).length,0)
        assert.equal(await coachEventView(a.id,queuedChat),null)
        assert.equal((await store.listExperiences(a.id,queuedChat)).length,0)
        assert.equal(calls,callsBeforeQueued+1,'cancelled waiting work consumed no simulated provider call')
      }finally{releaseLate();await first;lateEntered=new Promise(resolve=>{enteredLate=resolve})}
    })
    await check('assistant messages, foreign sources, altered quotes and plans cannot become factual experiences',async()=>{
      const assistant=(await pool.query("SELECT id FROM messages WHERE user_id=$1 AND conversation_id=$2 AND role='assistant'",[a.id,conversation])).rows[0]
      const staged:store.Staged={candidates:[],audit:[]}
      await assert.rejects(()=>store.stageCandidate(run,staged,{sourceMessageId:assistant.id,quote:'模拟模型输出',links:[]}))
      await assert.rejects(()=>store.stageCandidate({...run,user_id:b.id},staged,{sourceMessageId:run.source_message_id,quote:text,links:[]}))
      await assert.rejects(()=>store.stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote:'捏造的结果',links:[]}))
      await assert.rejects(()=>stageCoachEvent(run,{target:{operation:'create',title:'原文核验',source:{messageId:run.source_message_id,quote:'模型的个人解释'}}},'x'),(error:any)=>error.code==='COACH_SOURCE_INVALID')
      const exact=await stageCoachEvent(run,{target:{operation:'create',title:'原文核验',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},'x')
      assert.equal(exact.delta.nodes?.[0].kind,'fact')
      assert.equal(exact.delta.target.operation==='create'&&exact.delta.target.source.quote,text)
      await assert.rejects(()=>stageCoachEvent(run,{target:{operation:'create',title:'材料核验',source:{messageId:run.source_message_id,quote:text}},action:{operation:'create',draft:{content:'未交付的材料'}}},'没有这份材料'),(error:any)=>error.code==='COACH_MATERIAL_NOT_VISIBLE')
      const historyChat=randomUUID();await store.createConversation(a.id,{id:historyChat,title:'经历来源必须是当前消息'})
      const previousText='上个月我完成了第一段课程项目。',previousRun=(await store.startRun(a.id,historyChat,randomUUID(),previousText)).run
      await store.finishRun(previousRun,{candidates:[],audit:[]},'先保留为历史来源。',null,new AbortController().signal)
      const currentRun=(await store.startRun(a.id,historyChat,randomUUID(),'我现在想继续聊聊其他事情。')).run
      await assert.rejects(()=>store.stageCandidate(currentRun,staged,{sourceMessageId:previousRun.source_message_id,quote:previousText,links:[]}), (error:any)=>error.code==='EXPERIENCE_SOURCE_NOT_CURRENT_MESSAGE')
      await store.terminateRun(a.id,currentRun.request_id,'cancelled','TEST_CLEANUP')
      const planChat=randomUUID(),planId=randomUUID();await store.createConversation(a.id,{id:planChat,title:'计划源'})
      const plan=await store.startRun(a.id,planChat,planId,'我计划明天完成一项练习。')
      await assert.rejects(()=>store.stageCandidate(plan.run,staged,{sourceMessageId:plan.run.source_message_id,quote:'我计划明天完成一项练习。',links:[]}))
      await store.terminateRun(a.id,planId,'cancelled','TEST_CLEANUP')
    })
    const confirmation={requestId:randomUUID(),expectedRevision:1,action:'confirm' as const}
    await check('explicit user confirmation makes record retrievable without confirming interpretations',async()=>{
      const r=await request('/api/experiences/'+experience.id+'/actions',confirmation,a.cookie);assert.equal(r.status,200,r.raw);assert.equal(r.value.revision,2)
      const replay=await request('/api/experiences/'+experience.id+'/actions',confirmation,a.cookie);assert.equal(replay.value.revision,2)
      assert.equal((await store.retrieveExperiences(a.id,{query:'数据库',limit:2})).records.length,1)
      const graph=await store.cognitionGraph(a.id);assert.equal(graph.nodes.filter(n=>n.type==='experience').length,1);assert.equal(graph.edges.find(e=>e.type==='RELATES_TO_VALUE')?.status,'proposed')
    })
    await check('optimistic revisions reject stale edits; corrections invalidate interpretation acceptance',async()=>{
      const review=await store.experienceAction(a.id,experience.id,{requestId:randomUUID(),expectedRevision:2,action:'review',link:{valueId:'value-growth',reason:'用户手动认可的练习解释',disposition:'accepted'}})
      assert.equal(review.revision,3)
      await assert.rejects(()=>store.experienceAction(a.id,experience.id,{requestId:randomUUID(),expectedRevision:2,action:'correct',content:{summary:'旧版本修改'}}))
      const corrected=await store.experienceAction(a.id,experience.id,{requestId:randomUUID(),expectedRevision:3,action:'correct',content:{summary:'我完成的是一项权限隔离练习。'}})
      assert.equal(corrected.revision,4)
      const records=await store.listExperiences(a.id);assert.equal(records[0].links[0].disposition,'proposed')
      assert.equal((await store.retrieveExperiences(a.id,{query:'数据库验收',limit:2})).records.length,0)
    })
    await check('deletion removes record and edges from retrieval and graph while retaining recoverable revisions',async()=>{
      await store.experienceAction(a.id,experience.id,{requestId:randomUUID(),expectedRevision:4,action:'delete'})
      assert.equal((await store.retrieveExperiences(a.id,{query:'',limit:10})).records.length,0)
      assert.equal((await store.cognitionGraph(a.id)).nodes.filter(n=>n.type==='experience').length,0)
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM experience_revisions WHERE user_id=$1 AND experience_id=$2',[a.id,experience.id])).rows[0].n,5)
    })
    await check('cancel acknowledged before a late model response prevents any event, action or candidate write',async()=>{
      const chat=randomUUID(),id=randomUUID();await store.createConversation(a.id,{id:chat,title:'取消竞态'})
      const pending=request('/api/conversations/'+chat+'/messages',{requestId:id,text:'我完成了迟到结果边界测试。'},a.cookie)
      await lateEntered
      const duplicate=await request('/api/conversations/'+chat+'/messages',{requestId:id,text:'我完成了迟到结果边界测试。'},a.cookie);assert.equal(duplicate.status,409)
      const cancelled=await request('/api/runs/'+id+'/cancel',{},a.cookie);assert.equal(cancelled.value.status,'cancelled')
      releaseLate();const result=await pending;assert.match(result.raw,/"code":"CANCELLED"/)
      assert.equal((await store.decisionVersions(a.id,chat)).length,0);assert.equal((await store.listExperiences(a.id,chat)).length,0)
      assert.equal(await coachEventView(a.id,chat),null)
      assert.equal((await request('/api/conversations/'+chat+'/messages',{requestId:id,text:'我完成了迟到结果边界测试。'},a.cookie)).status,409)
      lateEntered=new Promise(resolve=>{enteredLate=resolve})
    })
    await check('event revision conflict rolls back assistant, candidate, nodes and action as one transaction',async()=>{
      const chat=randomUUID(),id=randomUUID();await store.createConversation(a.id,{id:chat,title:'版本冲突'})
      const initial=(await store.startRun(a.id,chat,randomUUID(),'我完成了原始过程记录。')).run
      const original=await stageCoachEvent(initial,{target:{operation:'create',title:'版本冲突过程',source:{messageId:initial.source_message_id,quote:'我完成了原始过程记录。'}}},'原始记录。')
      const saved=await store.finishRun(initial,{candidates:[],audit:[],coach:original},original.reply,null,new AbortController().signal)
      const {run}=await store.startRun(a.id,chat,id,'我完成了版本冲突验收。')
      const coach=await stageCoachEvent(run,{target:{operation:'continue',eventId:saved.event!.id,expectedRevision:saved.event!.revision},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:'我完成了版本冲突验收。'}}],action:{operation:'create',draft:{content:'迟到的旧版本'}}},'迟到的旧版本')
      const staged:store.Staged={candidates:[],audit:[],coach}
      await store.stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote:'我完成了版本冲突验收。',links:[]})
      await pool.query('UPDATE coach_events SET revision=revision+1 WHERE user_id=$1 AND id=$2',[a.id,saved.event!.id])
      await assert.rejects(()=>store.finishRun(run,staged,coach.reply,null,new AbortController().signal),(error:any)=>error.code==='COACH_EVENT_REVISION_CONFLICT')
      assert.equal((await pool.query("SELECT 1 FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[a.id,id])).rowCount,0)
      assert.equal((await store.listExperiences(a.id,chat)).length,0)
      const unchanged=(await coachEventView(a.id,chat))!
      assert.equal(unchanged.nodes.length,0);assert.equal(unchanged.actions.length,0)
      await store.terminateRun(a.id,id,'failed','TEST_VERSION_CONFLICT')
    })
    await check('client disconnect cancels the active run before late completion',async()=>{
      const chat=randomUUID(),id=randomUUID();await store.createConversation(a.id,{id:chat,title:'断开连接'})
      const controller=new AbortController()
      const response=await fetch(base+'/api/conversations/'+chat+'/messages',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json',Cookie:a.cookie},body:JSON.stringify({requestId:id,text:'我完成了迟到断开连接验收。'}),signal:controller.signal})
      await lateEntered;controller.abort()
      await assert.rejects(()=>response.text())
      for(let i=0;i<30;i++){const row=(await pool.query('SELECT status FROM runs WHERE user_id=$1 AND request_id=$2',[a.id,id])).rows[0];if(row.status==='cancelled')break;await new Promise(r=>setTimeout(r,20))}
      releaseLate()
      assert.equal((await pool.query('SELECT status FROM runs WHERE user_id=$1 AND request_id=$2',[a.id,id])).rows[0].status,'cancelled')
      assert.equal((await store.decisionVersions(a.id,chat)).length,0)
      assert.equal(await coachEventView(a.id,chat),null)
    })
    const evidenceDir=resolve(process.env.LIFEOS_EVIDENCE??'evidence/backend')
    mkdirSync(evidenceDir,{recursive:true});writeFileSync(resolve(evidenceDir,'safety-report.json'),JSON.stringify(evidence,null,2)+'\n')
  }finally{
    releaseLate()
    await new Promise<void>(resolve=>server.close(()=>resolve()))
    // Only accounts created in this test are removed; there are no bulk table resets.
    for(const account of accounts){
      await pool.query('DELETE FROM user_operations WHERE user_id=$1',[account.id])
      await pool.query('DELETE FROM experiences WHERE user_id=$1',[account.id])
      await pool.query('DELETE FROM decision_versions WHERE user_id=$1',[account.id])
      await pool.query('DELETE FROM runs WHERE user_id=$1',[account.id])
      await pool.query('DELETE FROM "user" WHERE id=$1',[account.id])
    }
    config.trustedProxy=oldProxy;await pool.end()
  }
})
