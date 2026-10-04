import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {loadSnapshot,setMemorySettings} from '../../server/memory.ts'
import {loadCampus,stageCampus} from '../../server/campus.ts'
import {importKnowledge} from '../../server/campus-knowledge.ts'
import {campusReferenceCards} from '../../server/campus-reference-data.ts'
import type {CampusTurn} from '../../server/campus-contracts.ts'

test('same inquiry retains domain for shortened reference retrieval; new inquiry and invalid cards do not inherit',async()=>{
  const user='reference-context-'+randomUUID(),conversation=randomUUID()
  const cases=campusReferenceCards.filter(card=>card.kind==='case'&&card.comparisonGroup)
  const boundary=cases.find(card=>card.outcome==='boundary'&&card.mechanisms.includes('feedback'))!
  try{
    await importKnowledge(campusReferenceCards)
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',[user,'SYNTHETIC reference',user+'@example.invalid'])
    await store.createConversation(user,{id:conversation,title:'SYNTHETIC reference continuity'})
    await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
    await importKnowledge([{...boundary,id:randomUUID(),kind:'policy',synthetic:true,scopeKeys:{institution:'合成江城大学',department:'甲学院',project:'推免',year:'2027',population:'本科'},claim:'SYNTHETIC：必修课程必须先完成。',excerpt:'SYNTHETIC：必修课程必须先完成。',mechanisms:['constraints'],application:undefined}],true)
    const scopeText='我的机构=合成江城大学，department=甲学院，project=推免，year=2027，population=本科。课程只剩两周，请先安排关键缺口。'
    const scopeRun=(await store.startRun(user,conversation,randomUUID(),scopeText)).run
    await store.terminateRun(user,scopeRun.request_id,'failed','SYNTHETIC_FAILED_SCOPE_TURN')
    const revisionText='维护端已经修订了规则。请说明原依据是否仍然有效，不要沿用旧的竞赛结论。'
    const recovered=await loadCampus(user,conversation,revisionText,await loadSnapshot(user,conversation,revisionText))
    assert.ok(recovered.knowledge.some(card=>card.kind==='policy'),'failed same-chat testimony retains its exact policy scope')
    assert.equal(recovered.explicitScope?.year,undefined,'lookup scope is not fabricated as a new explicit user fact')
    assert.equal(recovered.pendingScope?.source.id,scopeRun.source_message_id)
    await pool.query('INSERT INTO memory_suppressions(user_id,source_conversation_id,source_message_id,key) VALUES($1,$2,$3,$4)',[user,conversation,scopeRun.source_message_id,'currentConcern'])
    const revokedScope=await loadCampus(user,conversation,revisionText,await loadSnapshot(user,conversation,revisionText))
    assert.equal(revokedScope.knowledge.some(card=>card.kind==='policy'),false)
    const failedText='我在考虑创业培训，必须靠兼职生活，请用外部案例比较。'
    const failed=(await store.startRun(user,conversation,randomUUID(),failedText)).run
    await store.terminateRun(user,failed.request_id,'failed','SYNTHETIC_FAILED_FIRST_TURN')
    const continuation='每周最多一小时，不花钱。请说明外部案例的收入边界。'
    const pending=await loadCampus(user,conversation,continuation,await loadSnapshot(user,conversation,continuation))
    assert.equal(pending.current,null)
    assert.equal(pending.knowledge.filter(card=>cases.some(c=>c.id===card.id)).length,2,'a failed first response does not erase the user supplied domain')
    await pool.query('INSERT INTO memory_suppressions(user_id,source_conversation_id,source_message_id,key) VALUES($1,$2,$3,$4)',[user,conversation,failed.source_message_id,'currentConcern'])
    const hiddenPending=await loadCampus(user,conversation,continuation,await loadSnapshot(user,conversation,continuation))
    assert.equal(hiddenPending.knowledge.some(card=>cases.some(c=>c.id===card.id)),false,'forgotten failed-turn testimony never restores the domain')
    await pool.query('DELETE FROM memory_suppressions WHERE user_id=$1 AND source_message_id=$2',[user,failed.source_message_id])
    const text='我想比较创业培训和兼职收入，每周一小时，先形成小访谈。'
    const run=(await store.startRun(user,conversation,randomUUID(),text)).run
    const memory=await loadSnapshot(user,conversation,text),snapshot=await loadCampus(user,conversation,text,memory)
    assert.equal(snapshot.knowledge.filter(card=>cases.some(c=>c.id===card.id)).length,2)
    const source={type:'message' as const,id:run.source_message_id,quote:text}
    const turn:CampusTurn={domain:'university_exit',newInquiry:true,question:'能否用可比外部案例帮我比较',questionSource:{id:source.id,quote:text},criteria:[],readiness:'bounded',questions:[],studentContext:[],pathways:[{pathway:'entrepreneurship',status:'candidate',motivation:'探索',bottleneck:'待核验',requirements:[],nextWindow:'未核实',unverified:[]}],opportunities:[],evidence:[{source,role:'background',match:'本人请求',limitation:'未验证'}],experiment:{kind:'verify',question:'值得进行吗',action:'用十五分钟列出一个访谈问题',cap:'建议上限15分钟，可调整',observe:'记录一个问题',adjustWhen:'超时即暂停'}}
    const support=cases.find(card=>card.outcome==='support'&&card.comparisonGroup===boundary.comparisonGroup)!
    const link=<T extends 'support'|'counterexample'>(card:typeof boundary,role:T)=>({source:{type:'knowledge' as const,id:card.id,revision:card.revision,quote:card.claim},role,match:'同一研究的相应结果',limitation:'用户没有任何缓冲资金，因此此方案一定保证收入'})
    turn.opportunities=[{name:'一次小访谈',goal:'观察需求',choice:'shrink',reason:'参与创业不代表收入改善，按时间约束限制本次探索',investment:'建议15分钟',role:'有限尝试',output:'记录实际回答',feedback:'实际使用反馈',alternative:'暂缓',stopWhen:'超时停止',evidence:[],caseComparison:{support:link(support,'support'),boundary:link(boundary,'counterexample')}}]
    const staged:store.Staged={candidates:[],audit:[],snapshot:memory}
    await stageCampus(run,staged,turn,snapshot)
    assert.deepEqual(staged.campus!.turn.opportunities[0]!.evidence.map(link=>[link.source.id,link.role]),[[support.id,'support'],[boundary.id,'counterexample']])
    assert.doesNotMatch(JSON.stringify(staged.campus!.turn.opportunities[0]!.evidence),/一定保证收入|没有任何缓冲/,'maintained external boundaries replace unsupported personal interpretations')
    assert.equal(staged.campus!.turn.opportunities[0]!.caseComparison,undefined,'explicit model-supplied slots are projected into the shared visible evidence')
    await store.finishRun(run,staged,'合成方案',null,new AbortController().signal)
    const persisted=(await pool.query('SELECT payload FROM campus_inquiries WHERE user_id=$1 AND id=$2',[user,staged.campus!.targetInquiryId])).rows[0].payload
    assert.deepEqual(persisted.opportunities[0].evidence,staged.campus!.turn.opportunities[0]!.evidence,'persisted UI evidence is the same normalized source-validated result')
    const short='先缩小为一次零成本访谈。请说明哪项外部证据改变了建议。'
    const continued=await loadCampus(user,conversation,short,await loadSnapshot(user,conversation,short))
    assert.equal(continued.knowledge.filter(card=>cases.some(c=>c.id===card.id)).length,2,'same active pathway retains the comparable outcome pair')
    const newText='换个问题，不沿用旧目标。'
    const switched=await loadCampus(user,conversation,newText,await loadSnapshot(user,conversation,newText))
    assert.equal(switched.current,null)
    assert.equal(switched.knowledge.some(card=>cases.some(c=>c.id===card.id)),false)
    await pool.query("UPDATE campus_knowledge SET status='revoked' WHERE id=$1",[boundary.id])
    const revoked=await loadCampus(user,conversation,short,await loadSnapshot(user,conversation,short))
    assert.equal(revoked.knowledge.some(card=>card.id===boundary.id),false)
    await pool.query("UPDATE campus_knowledge SET status='verified',valid_until='2020-01-01' WHERE id=$1",[boundary.id])
    const expired=await loadCampus(user,conversation,short,await loadSnapshot(user,conversation,short))
    assert.equal(expired.knowledge.some(card=>card.id===boundary.id),false)
    await pool.query('UPDATE campus_knowledge SET status=$2,valid_until=$3 WHERE id=$1',[boundary.id,boundary.status,boundary.validUntil])
    await pool.query('INSERT INTO memory_suppressions(user_id,source_conversation_id,source_message_id,key) VALUES($1,$2,$3,$4)',[user,conversation,run.source_message_id,'currentConcern'])
    const forgotten=await loadCampus(user,conversation,short,await loadSnapshot(user,conversation,short))
    assert.equal(forgotten.current?.stale,true)
    assert.equal(forgotten.knowledge.some(card=>cases.some(c=>c.id===card.id)),false,'forgotten-source pathway does not restore references')
  }finally{
    await pool.query('UPDATE campus_knowledge SET status=$2,valid_until=$3 WHERE id=$1',[boundary.id,boundary.status,boundary.validUntil])
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
    await pool.end()
  }
})
