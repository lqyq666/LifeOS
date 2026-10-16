import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { pool } from '../../server/db.ts'
import { importKnowledge, validateKnowledge, type KnowledgeCard } from '../../server/campus-knowledge.ts'
import { validateCoachCitations, retrieveCoachKnowledge, coachPolicyScope, policyApplies } from '../../server/coach-knowledge.ts'
import { buildTurnPrompt, providerTurnMessages } from '../../server/turn-prompt.ts'
import { stageCoachEvent, coachEventView } from '../../server/action-coach-events.ts'
import { localEmbedding } from '../../server/local-embedding.ts'
import * as store from '../../server/store.ts'

test('per-proposition citation provenance, scope and withdrawal use real isolated PostgreSQL (synthetic sources)',async t=>{
  const user='coach-source-'+randomUUID(),chat=randomUUID(),signal=new AbortController().signal
  const card:KnowledgeCard={id:randomUUID(),revision:1,kind:'method',status:'verified',synthetic:true,title:'SYNTHETIC 来源验证',url:'https://example.invalid/synthetic-method',publisher:'SYNTHETIC',publishedYear:'2026',verifiedAt:new Date().toISOString(),validUntil:null,excerpt:'合成验收命题：分段检查可以定位打不开的步骤，不证明内容有用。',claim:'分段检查可以定位打不开的步骤',scope:'合成可用性验收',limitations:'不证明内容有用，也不推断用户原因',mechanisms:['source-check'],sourceHash:'a'.repeat(64)}
  const policy:KnowledgeCard={...card,id:randomUUID(),kind:'policy',title:'SYNTHETIC 制度',claim:'合成条目要求提交两页材料',excerpt:'合成条目要求提交两页材料，仅用于合成目标。',scope:'合成机构/学院/项目/年份/对象',scopeKeys:{institution:'合成学校',department:'合成学院',project:'合成项目',year:'2026',population:'合成本科生'}}
  const citation={sourceId:card.id,revision:1,claim:card.claim,quote:card.claim,scope:card.scope}
  let eventId='',firstRun:store.Run|undefined
  try{
    await importKnowledge([card,policy],true)
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
    await store.createConversation(user,{id:chat,title:'SYNTHETIC external provenance'})
    await t.test('citations remain optional and the server derives URL, scope and limitations',async()=>{
      assert.deepEqual(await validateCoachCitations('先说说打不开的哪一步。',[],[],''),{text:'先说说打不开的哪一步。',refs:[]})
      const checked=await validateCoachCitations(card.claim,[citation],[card],'')
      assert.ok(checked.text.includes(card.url));assert.ok(checked.text.includes(card.scope));assert.ok(checked.text.includes(card.limitations))
      assert.deepEqual(checked.refs,[{sourceId:card.id,revision:1}])
    })
    await t.test('saved real missing-citation reply binds only a unique exact verified proposition without mutating model output',async()=>{
      const output=JSON.parse(readFileSync('tests/fixtures/coach-missing-citation.json','utf8'))
      const original=JSON.stringify(output),definition=JSON.parse(readFileSync('evidence/v1.3-action-coach/research/verified-method-cards.json','utf8'))[0]
      const source={...card,id:randomUUID(),claim:definition.claim,excerpt:definition.excerpt,scope:definition.scope}
      await importKnowledge([source],true)
      try{
        const checked=await validateCoachCitations(output.reply,output.citations??[],[source],'')
        assert.deepEqual(checked.refs,[{sourceId:source.id,revision:1}]);assert.ok(checked.text.includes(source.url));assert.equal(JSON.stringify(output),original)
        const ambiguous={...source,id:randomUUID()}
        await assert.rejects(validateCoachCitations(output.reply,[],[source,ambiguous],''),(e:any)=>e.code==='COACH_CITATION_INVALID')
        await importKnowledge([{...source,revision:2,status:'revoked'}],true)
        await assert.rejects(validateCoachCitations(output.reply,[],[source],''),(e:any)=>e.code==='COACH_KNOWLEDGE_INVALIDATED')
      }finally{await pool.query('DELETE FROM campus_knowledge_revisions WHERE id=$1',[source.id]);await pool.query('DELETE FROM campus_knowledge WHERE id=$1',[source.id])}
    })
    await t.test('a quote substring does not authorize invented effects, scope, IDs, revisions or invisible claims',async()=>{
      // Fix 3: the model only ever SELECTS an id — every server-owned field
      // (claim/quote/scope/revision) is re-derived from the authorized card,
      // so a drifted legacy field can no longer fail the turn; authority and
      // rendering come entirely from the card. Unknown ids still hard-fail.
      for(const drifted of [{...citation,claim:'分段检查保证用户获得收入'},{...citation,quote:'不存在的原文'},{...citation,scope:'所有大学生'},{...citation,revision:2}]){
        const rechecked=await validateCoachCitations(card.claim,[drifted],[card],'')
        assert.deepEqual(rechecked.refs,[{sourceId:card.id,revision:1}],'legacy fields are ignored, the card is authoritative')
        assert.ok(rechecked.text.includes(card.claim)&&!rechecked.text.includes('保证用户获得收入'),'rendered note uses the CARD claim, never the drifted one')
      }
      await assert.rejects(validateCoachCitations(card.claim,[{...citation,sourceId:randomUUID()}],[card],''),(error:any)=>error.code==='COACH_CITATION_INVALID')
      await assert.rejects(validateCoachCitations(card.claim,[{claimId:randomUUID()}],[card],''),(error:any)=>error.code==='COACH_CITATION_INVALID','unknown claimId fails')
      const claimIdChecked=await validateCoachCitations(card.claim,[{claimId:card.id}],[card],'')
      assert.deepEqual(claimIdChecked.refs,[{sourceId:card.id,revision:1}],'claimId selection resolves to the real version')
      assert.ok(claimIdChecked.text.includes(card.url)&&claimIdChecked.text.includes(card.limitations),'server renders url/scope/limitations from the card')
      // P5: a cited self-authored METHOD card needs no verbatim claim (the
      // server renders the real claim/boundaries itself); a POLICY claim
      // still must appear verbatim in the reply.
      const methodAccepted=await validateCoachCitations('没有展示命题',[{claimId:card.id}],[card],'')
      assert.deepEqual(methodAccepted.refs,[{sourceId:card.id,revision:1}],'cited method card accepted without verbatim text; note carries the claim')
      assert.ok(methodAccepted.text.includes(card.claim))
      const policyCitation={sourceId:policy.id,revision:1,claim:policy.claim,quote:policy.claim,scope:policy.scope}
      await validateCoachCitations(policy.claim+'。',[policyCitation],[policy],'机构=合成学校 学院=合成学院 项目=合成项目 年份=2026 对象=合成本科生')
      await assert.rejects(validateCoachCitations('没有展示命题',[policyCitation],[policy],'机构=合成学校 学院=合成学院 项目=合成项目 年份=2026 对象=合成本科生'),(error:any)=>error.code==='COACH_CITATION_INVALID','policy claim must still appear verbatim in the reply')
      assert.deepEqual((await validateCoachCitations('核验过的定义：'+card.claim,[],[card],'')).refs,[{sourceId:card.id,revision:1}])
      await assert.rejects(validateCoachCitations('参考 https://example.invalid/invented',[],[card],''),(error:any)=>error.code==='COACH_CITATION_INVALID')
      assert.equal((await validateCoachCitations('你给的文件 https://example.invalid/user-file',[],[],'请打开 https://example.invalid/user-file')).refs.length,0)
    })
    await t.test('policy requires all five explicit scope keys and conflicting fields abstain',async()=>{
      const c={sourceId:policy.id,revision:1,claim:policy.claim,quote:policy.claim,scope:policy.scope}
      const scope='机构=合成学校 学院=合成学院 项目=合成项目 年份=2026 对象=合成本科生'
      await validateCoachCitations(policy.claim,[c],[policy],scope)
      for(const text of ['我在合成学校读书',scope.replace(' 年份=2026',''),scope+' 年份=2027'])await assert.rejects(validateCoachCitations(policy.claim,[c],[policy],text),(error:any)=>error.code==='COACH_CITATION_INVALID')
      assert.equal(coachPolicyScope(scope+' 年份=2027').year,undefined)
    })
    await t.test('maintenance rejects incomplete, blank or non-text policy scope before importing official cards',()=>{
      for(const scopeKeys of [{},{...policy.scopeKeys,year:undefined},{...policy.scopeKeys,year:2027},{...policy.scopeKeys,population:'   '},{...policy.scopeKeys,region:'SYNTHETIC'},['学校','学院','项目','2027','学生']]){
        assert.throws(()=>validateKnowledge({...policy,scopeKeys} as unknown as KnowledgeCard,true),{code:'POLICY_SCOPE_REQUIRED'})
      }
      assert.doesNotThrow(()=>validateKnowledge(policy,true))
    })
    await t.test('verified national ranges need no invented school and unknown never authorizes applicability',()=>{
      const excerpt='SYNTHETIC：全国各招生单位均适用；本条不涉及院系或具体项目；2027年硕士研究生报名考生。'
      const national:KnowledgeCard={...policy,scopeKeys:undefined,excerpt,scopeRules:{
        institution:{status:'all',quote:'全国各招生单位均适用'},
        department:{status:'not_applicable',reason:'本条是统一报名时段，不判断院系资格',quote:'本条不涉及院系或具体项目'},
        project:{status:'not_applicable',reason:'本条是统一报名时段，不判断项目资格',quote:'本条不涉及院系或具体项目'},
        year:{status:'specific',value:'2027',quote:'2027年'},
        population:{status:'specific',value:'硕士研究生报名考生',quote:'硕士研究生报名考生'},
      }}
      assert.doesNotThrow(()=>validateKnowledge(national,true))
      const query='年份=2027 对象=硕士研究生报名考生'
      assert.equal(policyApplies(national,query),true)
      assert.equal(policyApplies(national,query.replace('2027','2026')),false)
      const unknown:KnowledgeCard={...national,scopeRules:{...national.scopeRules!,institution:{status:'unknown',reason:'尚未核实机构适用范围'}}}
      assert.doesNotThrow(()=>validateKnowledge(unknown,true),'unknown may be stored honestly, not certified as applicable')
      assert.equal(policyApplies(unknown,query),false)
      assert.throws(()=>validateKnowledge({...national,scopeRules:{...national.scopeRules!,institution:{status:'all',quote:'未经核实的全国适用'}}},true),{code:'POLICY_SCOPE_REQUIRED'})
      assert.throws(()=>validateKnowledge({...national,scopeKeys:policy.scopeKeys},true),{code:'POLICY_SCOPE_REQUIRED'},'two contradictory scope representations are refused')
      for(const badRule of [{status:'all'},{status:'unknown',reason:12},{status:'specific',value:2027,quote:'2027年'},{status:'all',quote:'全国各招生单位均适用',value:'某所学校'}]){
        assert.throws(()=>validateKnowledge({...national,scopeRules:{...national.scopeRules!,institution:badRule}} as unknown as KnowledgeCard,true),{code:'POLICY_SCOPE_REQUIRED'})
      }
    })
    await t.test('real local semantic source lookup excludes unscoped policies and revoked/expired entries',async()=>{
      const found=await retrieveCoachKnowledge('文件打不开，如何定位可用性步骤？',signal)
      assert.ok(found.some(row=>row.id===card.id));assert.ok(!found.some(row=>row.id===policy.id))
      await importKnowledge([{...policy,revision:2,status:'revoked'}],true)
      assert.ok(!(await retrieveCoachKnowledge('机构=合成学校 学院=合成学院 项目=合成项目 年份=2026 对象=合成本科生',signal)).some(row=>row.id===policy.id))
    })
    await t.test('saved material and replay become unavailable after a source revision changes',async()=>{
      const raw='我已收到打不开的反馈，请准备一段核验材料。'
      firstRun=(await store.startRun(user,chat,randomUUID(),raw)).run
      const checked=await validateCoachCitations(card.claim,[citation],[card],raw)
      const coach=await stageCoachEvent(firstRun,{target:{operation:'create',title:'核验材料',source:{messageId:firstRun.source_message_id,quote:raw}},action:{operation:'create',draft:{content:card.claim}}},checked.text)
      coach.knowledgeRefs=checked.refs
      const saved=await store.finishRun(firstRun,{candidates:[],audit:[],coach,usedKnowledgeRefs:checked.refs},checked.text,null,signal)
      eventId=saved.event!.id
      assert.equal(saved.event!.actions[0].status,'proposed')
      assert.ok((await store.contextForRun(firstRun)).some(message=>message.content.includes(card.url)))
      await importKnowledge([{...card,revision:2}],true)
      const event=(await coachEventView(user,chat))!
      assert.equal(event.actions[0].status,'stale');assert.equal(event.actions[0].draft,null)
      assert.deepEqual(event.actions[0].unavailableReasons,['knowledge_sources_changed_or_unavailable'])
      assert.equal(event.actions[0].knowledgeRefs,undefined)
      const next={id:randomUUID(),role:'user' as const,content:'请检查刚才行动材料的来源是否仍有效。',created_at:new Date().toISOString()}
      const prompt=buildTurnPrompt({currentMessageId:next.id,messages:[next],currentEvent:event,knowledge:[]})
      const wire=providerTurnMessages(prompt,{provider:'openai',id:'qwen3.8-flash'})
      const metadata=JSON.parse(wire[0].content as string)
      assert.deepEqual(metadata.currentEvent.actions[0].unavailableReasons,['knowledge_sources_changed_or_unavailable'])
      assert.equal(metadata.currentEvent.actions[0].draft,null)
      assert.ok(!(await store.contextForRun(firstRun)).some(message=>message.role==='assistant'&&message.content.includes(card.claim)))
      assert.ok(!(await store.listConversations(user))[0].messages.some((message:any)=>message.role==='assistant'&&message.content.includes(card.claim)))
      const replay=await store.startRun(user,chat,firstRun.request_id,raw)
      assert.equal(replay.replay,true)
      assert.equal((await store.validRunResponse(user,firstRun.request_id,replay.run.response)).event,null)
      assert.equal((await store.runStatus(user,firstRun.request_id)).response.sourcesInvalidated,true)
      const run=(await store.startRun(user,chat,randomUUID(),'沿用之前的材料。')).run
      await assert.rejects(stageCoachEvent(run,{target:{operation:'continue',eventId,expectedRevision:event.revision},action:{operation:'reuse',actionId:event.actions[0].id,expectedRevision:event.actions[0].revision}},'沿用。'),(error:any)=>error.code==='COACH_ACTION_REVIEW_REQUIRED')
      await store.terminateRun(user,run.request_id,'cancelled','SYNTHETIC_SOURCE_CHANGED')
    })
    await t.test('source changes between validation and commit roll back every derived write',async()=>{
      const latest={...card,revision:2},raw='请用已核验的命题说明。'
      const checked=await validateCoachCitations(card.claim,[{...citation,revision:2}],[latest],raw)
      const run=(await store.startRun(user,chat,randomUUID(),raw)).run
      await importKnowledge([{...card,revision:3,status:'revoked'}],true)
      await assert.rejects(store.finishRun(run,{candidates:[],audit:[],usedKnowledgeRefs:checked.refs},checked.text,null,signal),(error:any)=>error.code==='COACH_KNOWLEDGE_INVALIDATED')
      assert.equal((await pool.query("SELECT 1 FROM messages WHERE user_id=$1 AND run_request_id=$2 AND role='assistant'",[user,run.request_id])).rowCount,0)
      assert.equal((await pool.query('SELECT 1 FROM coach_reply_sources WHERE user_id=$1 AND request_id=$2',[user,run.request_id])).rowCount,0)
      await store.terminateRun(user,run.request_id,'failed','SYNTHETIC_SOURCE_REVOKED')
    })
    await t.test('expiry is checked on reads and a fresh replacement can modify the same action ID',async()=>{
      await importKnowledge([{...card,revision:4,validUntil:'2000-01-01T00:00:00Z'}],true)
      await assert.rejects(validateCoachCitations(card.claim,[{...citation,revision:4}],[{...card,revision:4,validUntil:'2000-01-01T00:00:00Z'}],''),(error:any)=>error.code==='COACH_KNOWLEDGE_INVALIDATED')
      assert.ok(!(await retrieveCoachKnowledge('文件打不开',signal)).some(row=>row.id===card.id))
      const event=(await coachEventView(user,chat))!,run=(await store.startRun(user,chat,randomUUID(),'改为只核验我提供的文件能否打开。')).run
      const material='请先打开我发的这一页，告诉我能否显示。'
      const coach=await stageCoachEvent(run,{target:{operation:'continue',eventId,expectedRevision:event.revision},action:{operation:'modify',actionId:event.actions[0].id,expectedRevision:event.actions[0].revision,draft:{content:material}}},material)
      const saved=await store.finishRun(run,{candidates:[],audit:[],coach},material,null,signal)
      assert.equal(saved.event!.actions[0].id,event.actions[0].id)
      assert.equal(saved.event!.actions[0].status,'proposed');assert.equal(saved.event!.actions[0].draft?.content,material)
    })
    await t.test('expiry alone invalidates a saved reply and action without a revision change',async()=>{
      const fresh={...card,revision:5,validUntil:new Date(Date.now()+60000).toISOString()}
      await importKnowledge([fresh],true)
      const checked=await validateCoachCitations(card.claim,[{...citation,revision:5}],[fresh],'核验依据')
      const event=(await coachEventView(user,chat))!,run=(await store.startRun(user,chat,randomUUID(),'请把核验依据加入当前材料。')).run
      const coach=await stageCoachEvent(run,{target:{operation:'continue',eventId,expectedRevision:event.revision},action:{operation:'modify',actionId:event.actions[0].id,expectedRevision:event.actions[0].revision,draft:{content:card.claim}}},checked.text)
      coach.knowledgeRefs=checked.refs
      await store.finishRun(run,{candidates:[],audit:[],coach,usedKnowledgeRefs:checked.refs},checked.text,null,signal)
      // Advance only the isolated fixture's expiry, rather than waiting on a fragile wall-clock boundary.
      await pool.query("UPDATE campus_knowledge SET valid_until=now()-interval '1 second' WHERE id=$1",[card.id])
      assert.equal((await pool.query('SELECT revision FROM campus_knowledge WHERE id=$1',[card.id])).rows[0].revision,5)
      assert.equal((await coachEventView(user,chat))!.actions[0].draft,null)
      assert.deepEqual((await coachEventView(user,chat))!.actions[0].unavailableReasons,['knowledge_sources_changed_or_unavailable'])
      assert.equal((await store.runStatus(user,run.request_id)).response.sourcesInvalidated,true)
      assert.ok(!(await store.contextForRun(run)).some(message=>message.role==='assistant'&&message.content.includes(card.url)))
    })
  }finally{
    await localEmbedding.close()
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
    await pool.query('DELETE FROM campus_knowledge_revisions WHERE id=ANY($1::uuid[])',[[card.id,policy.id]])
    await pool.query('DELETE FROM campus_knowledge WHERE id=ANY($1::uuid[])',[[card.id,policy.id]])
    await pool.end()
  }
})
