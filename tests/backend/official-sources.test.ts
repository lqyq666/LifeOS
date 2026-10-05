import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {extractOfficialDocument} from '../../server/official-extract.ts'
import {fetchOfficialDocument,officialUrl,officialAttachmentUrl,OfficialFetchError,publicIPv4} from '../../server/official-fetch.ts'
import {syncOfficialSource,approveOfficialKnowledge,officialSourceRegistry,officialSourcesView} from '../../server/official-sources.ts'
import {validateCoachCitations} from '../../server/coach-knowledge.ts'
import {stageCoachEvent,coachEventView} from '../../server/action-coach-events.ts'
import type {KnowledgeCard} from '../../server/campus-knowledge.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'

const entry=officialSourceRegistry[0]
const body=Buffer.from(`<html><head><meta charset="utf-8"><meta name="PubDate" content="2026-09-24"></head><body><nav>诱导信息不得进正文</nav><h1>SYNTHETIC 2027年全国报名通知</h1><article><p>全国硕士报名考生，统一报名时段，不涉及院系和特定项目资格。</p><p>报名时间为2026年10月15日至10月24日（预报名时间为2026年10月9日至10月12日）。个人资格另行核验。</p><p>教育部</p><p>2026年9月21日</p><a href="/docs/conditions.docx">SYNTHETIC 条件附件</a><script>globalThis.officialScriptExecuted=true</script><iframe src="http://127.0.0.1/private"></iframe></article></body></html>`)

test('static extraction separates page date, document date, admission year and two registration actions',()=>{
  const result=extractOfficialDocument(body,entry.url)
  assert.equal(result.status,'fetched');assert.equal(result.publishedOn,'2026-09-24');assert.equal(result.issuedOn,'2026-09-21');assert.equal(result.applicableYear,'2027')
  assert.deepEqual(result.deadlineCandidates.map(row=>[row.action,row.startDate,row.endDate,row.status]),[['registration','2026-10-15','2026-10-24','requires_review'],['preregistration','2026-10-09','2026-10-12','requires_review']])
  assert.equal(result.attachments[0].status,'not_read');assert.ok(!result.text.includes('诱导信息'));assert.ok(!result.text.includes('globalThis'));assert.equal((globalThis as any).officialScriptExecuted,undefined)
  const partial=extractOfficialDocument(Buffer.from('<meta charset="utf-8"><h1>仅有网页标题2026年</h1><div>需要执行脚本才能看正文</div>'),entry.url)
  assert.equal(partial.status,'partial');assert.equal(partial.issuedOn,null);assert.equal(partial.publishedOn,null)
})
test('official HTTPS gate rejects credential URLs, private DNS, unsafe redirects and oversized/unsupported content',async()=>{
  for(const url of ['http://yz.chsi.com.cn/x','https://127.0.0.1/x','https://yz.chsi.com.cn.evil.invalid/x','https://user:secret@yz.chsi.com.cn/x','https://yz.chsi.com.cn:8443/x','https://yz.chsi.com.cn/x?token=secret'])assert.throws(()=>officialUrl(url))
  for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.1.1','192.168.1.1','100.64.1.1','224.1.1.1','1..2.3','999.1.1.1'])assert.equal(publicIPv4(address),false)
  let gets=0,pinned=''
  const good={resolve:async()=>[{address:'8.8.8.8',family:4}],get:async(_url:URL,address:string)=>{gets++;pinned=address;return {status:200,headers:{'content-type':'text/html'},bytes:body}}}
  assert.equal((await fetchOfficialDocument(entry.url,good)).bytes,body);assert.equal(pinned,'8.8.8.8')
  const before=gets
  await assert.rejects(fetchOfficialDocument(entry.url,{...good,resolve:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]}),{code:'OFFICIAL_ADDRESS_REJECTED'});assert.equal(gets,before)
  await assert.rejects(fetchOfficialDocument(entry.url,{...good,get:async()=>({status:302,headers:{location:'https://127.0.0.1/private'},bytes:Buffer.alloc(0)})}),{code:'OFFICIAL_URL_NOT_ALLOWED'})
  await assert.rejects(fetchOfficialDocument(entry.url,{...good,get:async()=>({status:302,headers:{location:entry.url},bytes:Buffer.alloc(0)})}),{code:'OFFICIAL_REDIRECT_LIMIT'})
  await assert.rejects(fetchOfficialDocument(entry.url,{...good,get:async()=>({status:200,headers:{'content-type':'text/html'},bytes:Buffer.alloc(2*1024*1024+1)})}),{code:'OFFICIAL_BODY_TOO_LARGE'})
  await assert.rejects(fetchOfficialDocument(entry.url,{...good,get:async()=>({status:200,headers:{'content-type':'application/octet-stream'},bytes:body})}),{code:'OFFICIAL_CONTENT_UNSUPPORTED'})
  const attachment='https://www.zjzs.net/module/download/downfile.jsp?classid=0&showname=条件.docx&filename='+'a'.repeat(32)+'.docx'
  assert.equal(officialAttachmentUrl(attachment).hostname,'www.zjzs.net')
  assert.throws(()=>officialAttachmentUrl(attachment+'&token=secret'))
  assert.throws(()=>officialAttachmentUrl(attachment+'&filename=../../secret'))
})
test('minimized saved real HTML retains two site adapters, real dates and unread query-based attachments without another fetch',()=>{
  const fixtures=JSON.parse(readFileSync('tests/fixtures/official-source-dom.json','utf8'))
  const national=extractOfficialDocument(Buffer.from(fixtures[0].html),fixtures[0].url)
  assert.equal(national.status,'fetched');assert.equal(national.publishedOn,'2026-09-24');assert.equal(national.issuedOn,'2026-09-21');assert.equal(national.applicableYear,'2027');assert.equal(national.deadlineCandidates.length,2)
  const provincial=extractOfficialDocument(Buffer.from(fixtures[1].html),fixtures[1].url)
  assert.equal(provincial.status,'fetched');assert.equal(provincial.publishedOn,'2026-01-05');assert.equal(provincial.issuedOn,'2025-12-19');assert.equal(provincial.applicableYear,'2026');assert.equal(provincial.attachments.length,3);assert.equal(provincial.deadlineCandidates.length,0)
})
test('isolated snapshots require explicit bounded review and source changes atomically invalidate old replies/materials',async t=>{
  const user='official-source-'+randomUUID(),conversation=randomUUID(),cardId=randomUUID(),signal=new AbortController().signal
  const fake=async()=>({url:entry.url,bytes:body,contentType:'text/html; charset=utf-8'})
  let run:store.Run|undefined
  try{
    const first=await syncOfficialSource(entry,fake),extraction=extractOfficialDocument(body,entry.url)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM campus_knowledge WHERE id=$1',[cardId])).rows[0].n,0,'fetch never certifies a policy automatically')
    const excerpt='全国硕士报名考生，统一报名时段，不涉及院系和特定项目资格。'
    const card:KnowledgeCard={id:cardId,revision:1,kind:'policy',status:'verified',synthetic:true,title:'SYNTHETIC 待核对范围',url:entry.url,publisher:entry.publisher,publishedYear:'2026',verifiedAt:new Date().toISOString(),validUntil:new Date(Date.now()+3600000).toISOString(),excerpt,claim:'统一报名时段',scope:'SYNTHETIC 全国2027硕士考生时段；不证明资格',limitations:'个人资格未知',mechanisms:['official-check'],sourceHash:extraction.hash,scopeRules:{institution:{status:'all',quote:'全国硕士报名考生'},department:{status:'not_applicable',reason:'仅判断报名时段',quote:'不涉及院系和特定项目资格'},project:{status:'not_applicable',reason:'仅判断报名时段',quote:'不涉及院系和特定项目资格'},year:{status:'unknown',reason:'本条摘录不含年份，不补证据'},population:{status:'specific',value:'硕士报名考生',quote:'硕士报名考生'}}}
    await t.test('review refuses wrong hashes, expired freshness, future source versions and unread spans',async()=>{
      await assert.rejects(approveOfficialKnowledge(first.id,first.revision,[{...card,sourceHash:'f'.repeat(64)}]),{code:'OFFICIAL_REVIEW_INVALID'})
      await assert.rejects(approveOfficialKnowledge(first.id,first.revision,[{...card,validUntil:new Date(Date.now()+48*3600000).toISOString()}]),{code:'OFFICIAL_REVIEW_INVALID'})
      await assert.rejects(approveOfficialKnowledge(first.id,first.revision+1,[card]),{code:'OFFICIAL_SOURCE_CHANGED'})
      await assert.rejects(approveOfficialKnowledge(first.id,first.revision,[{...card,excerpt:'附件中的未读条件'}]),{code:'POLICY_SCOPE_REQUIRED'})
      await approveOfficialKnowledge(first.id,first.revision,[card])
      await assert.rejects(validateCoachCitations(card.claim,[{sourceId:card.id,revision:1,claim:card.claim,quote:card.claim,scope:card.scope}],[card],'年份=2027 对象=硕士报名考生'),{code:'COACH_CITATION_INVALID'},'honestly stored unknown scope is never a wildcard')
    })
    // Now maintenance supplies an exact broader source excerpt including its year.
    const full=extraction.text
    const approved={...card,revision:2,excerpt:full,scopeRules:{...card.scopeRules!,year:{status:'specific' as const,value:'2027',quote:'SYNTHETIC 2027年全国报名通知'}}}
    await assert.rejects(approveOfficialKnowledge(first.id,first.revision,[{...approved,scopeRules:{...approved.scopeRules,year:{status:'specific',value:'2026',quote:'报名时间为2026年10月15日'}}}]),{code:'OFFICIAL_REVIEW_INVALID'},'deadline calendar year cannot replace the admission year')
    await approveOfficialKnowledge(first.id,first.revision,[approved])
    const scope='年份=2027 对象=硕士报名考生'
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
    await store.createConversation(user,{id:conversation,title:'SYNTHETIC official lifecycle'})
    const text='请起草报名时段核对说明。 '+scope
    run=(await store.startRun(user,conversation,randomUUID(),text)).run
    const checked=await validateCoachCitations(approved.claim,[{sourceId:approved.id,revision:2,claim:approved.claim,quote:approved.claim,scope:approved.scope}],[approved],scope)
    const coach=await stageCoachEvent(run,{target:{operation:'create',title:'SYNTHETIC 报名核对',source:{messageId:run.source_message_id,quote:text}},action:{operation:'create',draft:{content:approved.claim}}},checked.text)
    coach.knowledgeRefs=checked.refs
    await store.finishRun(run,{candidates:[],audit:[],coach,usedKnowledgeRefs:checked.refs},checked.text,null,signal)
    const same=await syncOfficialSource(entry,fake);assert.equal(same.invalidated,0,'same bytes do not revoke or extend the prior review')
    run=(await store.startRun(user,conversation,randomUUID(),'请再核对一次。 '+scope)).run
    const changed=await syncOfficialSource(entry,async()=>({url:entry.url,bytes:Buffer.from(body.toString().replace('统一报名时段','新的报名时段')),contentType:'text/html'}))
    assert.equal(changed.invalidated,1)
    await assert.rejects(store.finishRun(run,{candidates:[],audit:[],usedKnowledgeRefs:checked.refs},checked.text,null,signal),{code:'COACH_KNOWLEDGE_INVALIDATED'})
    assert.equal((await coachEventView(user,conversation))!.actions[0].status,'stale')
    assert.ok(!(await store.contextForRun(run)).some(message=>message.role==='assistant'&&message.content.includes(approved.claim)))
    const failed=await syncOfficialSource(entry,async()=>{throw new OfficialFetchError('OFFICIAL_HTTP_FAILED')})
    assert.equal(failed.status,'fetch_failed')
    const view=await officialSourcesView();assert.equal(view.sources[0].claims[0].status,'unverified');assert.equal(view.sources[0].synthetic,true)
    await pool.query("UPDATE campus_knowledge SET status='verified',payload=jsonb_set(payload,'{status}','\"verified\"') WHERE id=$1",[cardId])
    assert.equal((await officialSourcesView()).sources[0].claims[0].status,'unverified','UI also refuses accidentally resurrected stale provenance')
    const current=(await pool.query('SELECT revision FROM campus_knowledge WHERE id=$1',[cardId])).rows[0].revision
    await assert.rejects(validateCoachCitations(approved.claim,[{sourceId:approved.id,revision:current,claim:approved.claim,quote:approved.claim,scope:approved.scope}],[{...approved,revision:current}],scope),{code:'COACH_KNOWLEDGE_INVALIDATED'},'an accidental old importer cannot resurrect a failed tracked source')
    assert.equal((await pool.query('SELECT coach_knowledge_refs_valid($1::jsonb) AS valid',[JSON.stringify([{sourceId:cardId,revision:current}])])).rows[0].valid,false)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM official_source_snapshots WHERE source_id=$1',[first.id])).rows[0].n,4)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM official_source_snapshots WHERE source_id=$1 AND raw_bytes IS NOT NULL',[first.id])).rows[0].n,3,'failed check retains all previous raw evidence')
  }finally{
    if(run)await store.terminateRun(user,run.request_id,'failed','SYNTHETIC_OFFICIAL_CLEANUP')
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
    await pool.query('DELETE FROM campus_knowledge_revisions WHERE id=$1',[cardId]);await pool.query('DELETE FROM campus_knowledge WHERE id=$1',[cardId])
    await pool.query('DELETE FROM official_source_snapshots WHERE source_id IN (SELECT id FROM official_sources WHERE url=$1)',[entry.url]);await pool.query('DELETE FROM official_sources WHERE url=$1',[entry.url]);await pool.end()
  }
})
