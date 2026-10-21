import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool,transaction} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {stageCoachEvent,coachEventView,invalidateCoachSources} from '../../server/action-coach-events.ts'
import {buildTurnPrompt,providerTurnMessages} from '../../server/turn-prompt.ts'

test('action modifications retain non-node request sources but do not revive corrected or withdrawn input',async()=>{
  const user='action-requests-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC action request lineage'})
  let event:any,action:any
  async function finish(text:string,delta:(run:store.Run)=>any){
    const run=(await store.startRun(user,chat,randomUUID(),text)).run
    try{const change=delta(run),reply=change.action?.draft?.content??'这是本轮已核对的经过。';const coach=await stageCoachEvent(run,change,reply);event=(await store.finishRun(run,{candidates:[],audit:[],coach},reply,null,signal)).event;const operatedId=coach.actionId??change.action?.actionId??action?.id;action=event.actions.find((a:{id:string})=>a.id===operatedId)??event.actions.find((a:{status:string})=>a.status==='proposed')??event.actions[0];return run.source_message_id}
    finally{await store.terminateRun(user,run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')}
  }
  const target=()=>({operation:'continue',eventId:event.id,expectedRevision:event.revision})
  const source=(run:store.Run,quote:string)=>({messageId:run.source_message_id,quote})
  try{
    await finish('继续做现有例题的小材料。',run=>({target:{operation:'create',title:'准备例题',source:source(run,'继续做现有例题的小材料。')}}))
    const correctedInput=await finish('我只会Python。',run=>({target:target(),nodes:[{kind:'fact',source:source(run,'我只会Python。')}]}))
    const oldNode=event.nodes[0].id
    const originalRequest=await finish('我只愿意花十分钟，请用现有例题写一个小说明。',()=>({target:target(),action:{operation:'create',draft:{content:'第一版例题说明。'}}}))
    const independentStage=await finish('我确认对方已经使用了这份例题。',run=>({target:target(),nodes:[{kind:'fact',source:source(run,'我确认对方已经使用了这份例题。')}]}))
    const modifiedRequest=await finish('请把具体推导补上。',()=>({target:target(),action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,draft:{content:'第二版具体推导。'}}}))
    const ids=async()=>((await pool.query('SELECT source_message_ids FROM coach_actions WHERE id=$1',[action.id])).rows[0].source_message_ids as string[])
    assert.ok((await ids()).includes(originalRequest),'creation-only user budget request survives a modification without a model node')
    assert.ok((await ids()).includes(modifiedRequest))
    assert.ok(action.requestSources.some((s:{messageId:string;quote:string})=>s.messageId===originalRequest&&s.quote.includes('十分钟')))
    await finish('更正一下，我会Python和R。',run=>({target:target(),corrections:[{nodeId:oldNode,source:source(run,'更正一下，我会Python和R。')}],action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,draft:{content:'第三版，背景已更正。'}}}))
    assert.ok(!(await ids()).includes(correctedInput),'superseded node input is not restored as whole request evidence')
    assert.ok((await ids()).includes(originalRequest))
    assert.ok(!action.requestSources.some((s:{messageId:string})=>s.messageId===correctedInput))
    const recent=(await store.startRun(user,chat,randomUUID(),'先检查近期请求。')).run
    const recentPrompt=JSON.parse(buildTurnPrompt({currentMessageId:recent.source_message_id,messages:await store.contextForRun(recent),currentEvent:event}))
    assert.equal(recentPrompt.currentEvent.actions[0].requestSources,undefined,'recent complete role messages are not duplicated in action metadata')
    await store.terminateRun(user,recent.request_id,'cancelled','SYNTHETIC_RECENT_CHECK')
    for(let i=0;i<45;i++){const run=(await store.startRun(user,chat,randomUUID(),'无关完整消息'+i+'。'+'其他事情。'.repeat(120))).run;await store.finishRun(run,{candidates:[],audit:[]},'无关合成回复。',null,signal)}
    assert.ok((await ids()).includes(originalRequest),'history eviction does not erase action request provenance')
    const continued=(await store.startRun(user,chat,randomUUID(),'继续修改这份材料。')).run
    const prompt=buildTurnPrompt({currentMessageId:continued.source_message_id,messages:await store.contextForRun(continued),currentEvent:await coachEventView(user,chat)})
    const metadata=JSON.parse(providerTurnMessages(prompt,{provider:'bailian',id:'qwen3.8-flash'})[0].content as string)
    assert.ok(!metadata.messages.some((m:{id:string})=>m.id===originalRequest))
    assert.ok(metadata.readOnlyEventWorkspace.actionRecords[0].requestSources.some((s:{messageId:string;quote:string})=>s.messageId===originalRequest&&s.quote==='我只愿意花十分钟，请用现有例题写一个小说明。'))
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM coach_event_revisions r,jsonb_array_elements(r.snapshot#>'{event,actions}') a WHERE r.user_id=$1 AND a ? 'requestSources'",[user])).rows[0].n,0,'derived request text is not recursively stored in snapshots')
    await store.terminateRun(user,continued.request_id,'cancelled','SYNTHETIC_OLD_CHECK')
    await transaction(c=>invalidateCoachSources(c,user,[originalRequest],true))
    event=await coachEventView(user,chat);action=event!.actions[0]
    assert.equal(action.status,'stale');assert.equal(action.draft,null)
    await finish('不再采用之前的约束。现在只用五分钟写一句说明。',()=>({target:target(),action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,draft:{content:'在五分钟范围内使用的一句说明。'}}}))
    assert.ok(!(await ids()).includes(originalRequest),'withdrawn original input must not poison or reappear in a refreshed material')
    assert.ok((await ids()).includes(modifiedRequest),'withdrawing one source preserves another independent material request')
    assert.ok(action.requestSources.some((s:{messageId:string;quote:string})=>s.messageId===modifiedRequest&&s.quote==='请把具体推导补上。'))
    assert.equal(event.actionStages.used,true,'independent reported stage survives withdrawing a separate request')
    assert.equal(event.actionStageEvidence.used.sourceMessageId,independentStage)
    await finish('新问题是介绍要给谁看，这点还没有确定。',()=>({target:target(),nodes:[{kind:'unknown',question:'这份介绍要给谁看？'}]}))
    const beforeRepeat=await coachEventView(user,chat)
    await transaction(c=>invalidateCoachSources(c,user,[originalRequest],true))
    const afterRepeat=await coachEventView(user,chat)
    assert.equal(afterRepeat!.generation,beforeRepeat!.generation,'repeated withdrawal cannot invalidate subsequent independent work')
    assert.deepEqual(afterRepeat!.nodes,beforeRepeat!.nodes,'new independent unknowns survive repeated withdrawal')
    assert.equal(action.status,'proposed')
    const mixed='我只会Python。我这次最多花十分钟。请写一句介绍。'
    // Two synthetic overlapping source ranges exercise union before subtraction.
    const mixedSource=await finish(mixed,run=>({target:target(),nodes:[{kind:'fact',source:source(run,'我只会Python')},{kind:'fact',source:source(run,'Python。')}],action:{operation:'create',draft:{content:'混合请求的第一版介绍。'}}}))
    const mixedNodes=event.nodes.filter((n:{source?:{messageId:string}})=>n.source?.messageId===mixedSource)
    await finish('更正一下，我会Python和R，请修改介绍。',run=>({target:target(),corrections:mixedNodes.map((node:{id:string})=>({nodeId:node.id,source:source(run,'我会Python和R')})),action:{operation:'modify',actionId:action.id,expectedRevision:action.revision,draft:{content:'混合请求的第二版介绍。'}}}))
    assert.ok((await ids()).includes(mixedSource),'unquoted ten-minute request survives correcting a fact from the same message')
    const fragments=action.requestSources.filter((s:{messageId:string})=>s.messageId===mixedSource)
    assert.deepEqual(fragments.map((s:{quote:string})=>s.quote),['我这次最多花十分钟。请写一句介绍。'])
    for(const fragment of fragments)assert.ok(mixed.includes(fragment.quote),'each retained fragment is contiguous original user text')
    for(let i=0;i<45;i++){const run=(await store.startRun(user,chat,randomUUID(),'再次无关消息'+i+'。'+'其他事情。'.repeat(120))).run;await store.finishRun(run,{candidates:[],audit:[]},'无关合成回复。',null,signal)}
    const oldMixed=(await store.startRun(user,chat,randomUUID(),'继续介绍。')).run
    const oldPrompt=JSON.parse(buildTurnPrompt({currentMessageId:oldMixed.source_message_id,messages:await store.contextForRun(oldMixed),currentEvent:await coachEventView(user,chat)}))
    const currentAction=oldPrompt.currentEvent.actions.find((a:{id:string})=>a.id===action.id)
    assert.ok(currentAction.requestSources.some((s:{quote:string})=>s.quote.includes('最多花十分钟')))
    const resurfaced:string[]=[]
    const locate=(value:unknown,path:string)=>{if(typeof value==='string'&&value.includes('我只会Python。'))resurfaced.push(path);else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))locate(child,path+'.'+key)}
    locate(oldPrompt,'prompt')
    assert.deepEqual(resurfaced,[],'superseded quoted fact does not return with the mixed request; paths identify any leak')
    await store.terminateRun(user,oldMixed.request_id,'cancelled','SYNTHETIC_MIXED_CHECK')
    await transaction(c=>invalidateCoachSources(c,user,[mixedSource],true))
    assert.ok(!(await coachEventView(user,chat))!.actions.some(a=>a.requestSources?.some(s=>s.messageId===mixedSource)))
  }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
})

test.after(async()=>{await pool.end()})
