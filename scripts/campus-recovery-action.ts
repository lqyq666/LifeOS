import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {config} from '../server/config.ts'
import {pool,transaction} from '../server/db.ts'
import * as store from '../server/store.ts'
import {campusView} from '../server/campus.ts'
import {stageCoachEvent} from '../server/action-coach-events.ts'
import {importKnowledge} from '../server/campus-knowledge.ts'
import {campusReferenceCards} from '../server/campus-reference-data.ts'
if(!/^lifeos_dialogue_test_/.test(new URL(config.databaseUrl).pathname.slice(1)))throw new Error('ISOLATED_RECOVERY_ONLY')
try{
  if(process.argv.includes('--seed')){
    const user=(await pool.query("SELECT id FROM \"user\" WHERE id LIKE 'lifeos-recovery-%' LIMIT 1")).rows[0].id
    const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC Campus recovery'})
    await importKnowledge(campusReferenceCards)
    const text='我想探索创业需求，每周一小时，不花钱，先访谈一位同学。'
    const run=(await store.startRun(user,conversation,randomUUID(),text)).run
    await store.finishRun(run,{candidates:[],audit:[]},'合成旧存档恢复夹具。',{source:'SYNTHETIC',llmCallCount:0},new AbortController().signal)
    const id=randomUUID(),experimentId=randomUUID(),card=campusReferenceCards[3]!
    const source={type:'message',id:run.source_message_id,quote:text}
    const payload={domain:'life_goal',question:'检验一个小需求',questionSource:source,criteria:['不花钱'],readiness:'act',questions:[],studentContext:[],pathways:[],opportunities:[],evidence:[{source:{type:'knowledge',id:card.id,revision:1,quote:card.excerpt},role:'background',match:'历史存档来源',limitation:'历史读取夹具'}],hypotheses:[],experiments:[{id:experimentId,status:'accepted',kind:'explore',question:'是否有实际需求',action:'访谈一位同学',cap:'半小时、零费用',observe:'实际问题',adjustWhen:'没有问题则停止',hypothesisId:null,decisionVersion:null,createdAt:new Date().toISOString()}],changes:[]}
    // Import an already-saved V1.2 fixture. There is no V1.2 runtime writer or generator.
    await transaction(async c=>{
      await c.query('INSERT INTO campus_inquiries(id,user_id,conversation_id,payload) VALUES($1,$2,$3,$4)',[id,user,conversation,payload])
      await c.query('INSERT INTO campus_current(user_id,conversation_id,inquiry_id) VALUES($1,$2,$3)',[user,conversation,id])
      await c.query("INSERT INTO campus_revisions(user_id,inquiry_id,revision,action,snapshot) VALUES($1,$2,1,'synthetic_legacy_import',$3)",[user,id,payload])
      for(const ref of [{type:'message',id:run.source_message_id,revision:0},{type:'knowledge',id:card.id,revision:1}])await c.query('INSERT INTO campus_dependencies(user_id,inquiry_id,source_type,source_id,source_revision) VALUES($1,$2,$3,$4,$5)',[user,id,ref.type,ref.id,ref.revision])
    })
    console.log(JSON.stringify({seeded:true,user,conversation,inquiry:id}))
  }else{
    const row=(await pool.query("SELECT i.* FROM campus_inquiries i JOIN conversations c ON c.id=i.conversation_id AND c.user_id=i.user_id WHERE c.title='SYNTHETIC Campus recovery' LIMIT 1")).rows[0]
    if(!row)throw new Error('RESTORED_CAMPUS_MISSING')
    const legacy=await campusView(row.user_id,row.conversation_id)
    assert.equal(legacy.inquiries[0].payload.experiments[0].action,'访谈一位同学')
    const text='上周我完成了访谈，对方明确说没有实际使用需求。',run=(await store.startRun(row.user_id,row.conversation_id,randomUUID(),text)).run
    const coach=await stageCoachEvent(run,{target:{operation:'create',title:'旧记录接续的实际反馈',source:{messageId:run.source_message_id,quote:text}},nodes:[{kind:'fact',source:{messageId:run.source_message_id,quote:text}}]},'实际反馈另存为当前事件，旧记录保留只读。')
    const staged:store.Staged={candidates:[],audit:[],coach}
    await store.stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote:text,links:[]})
    const saved=await store.finishRun(run,staged,coach.reply,null,new AbortController().signal)
    const candidate=saved.candidateIds[0],input={requestId:randomUUID(),expectedRevision:1,action:'confirm' as const}
    const confirmed=await store.experienceAction(row.user_id,candidate,input)
    assert.deepEqual(await store.experienceAction(row.user_id,candidate,input),JSON.parse(JSON.stringify(confirmed)))
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM experience_revisions WHERE user_id=$1 AND experience_id=$2',[row.user_id,candidate])).rows[0].n,2)
    assert.ok((await store.cognitionGraph(row.user_id)).nodes.some(node=>node.type==='experience'&&node.id==='exp-'+candidate))
    const unchanged=(await pool.query('SELECT payload,revision FROM campus_inquiries WHERE user_id=$1 AND id=$2',[row.user_id,row.id])).rows[0]
    assert.deepEqual(unchanged.payload,row.payload);assert.equal(unchanged.revision,row.revision)
    console.log(JSON.stringify({legacyReadable:true,legacyUnchanged:true,continuedWrite:true,newCoachEvent:true,confirmed:true,idempotent:true,graphContainsExperience:true}))
  }
}finally{await pool.end()}
