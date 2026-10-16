import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {syncOfficialSource,officialSourceRegistry,approveOfficialKnowledge,officialSourcesView} from '../../server/official-sources.ts'
import {validateCoachCitations} from '../../server/coach-knowledge.ts'
import type {KnowledgeCard} from '../../server/campus-knowledge.ts'
import {pool} from '../../server/db.ts'

// Explicitly invoked external public-source check; excluded from offline suite.
// No Provider, user data, credential forwarding, production DB or auto-retries.
test('two actual public official pages become local raw snapshots and only the reviewed national timing claim is approved',async()=>{
  const directory=resolve('.local/campus-growth/official-public-db-'+Date.now());mkdirSync(directory,{recursive:true})
  const report:any={evidence:'REAL_PUBLIC_OFFICIAL_HTTP_AND_ISOLATED_POSTGRES_NO_PROVIDER',status:'RUNNING',providerCalls:0,snapshots:[],reviewedCards:[],note:'One maintained timing proposition, not eligibility or full campus acceptance.'}
  const save=()=>writeFileSync(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n')
  save()
  try{
    for(const entry of officialSourceRegistry.slice(0,2)){const result=await syncOfficialSource(entry);report.snapshots.push({...result,url:entry.url});save()}
    const row=(await pool.query('SELECT * FROM official_sources WHERE url=$1',[officialSourceRegistry[0].url])).rows[0]
    const extraction=row.payload.extraction,excerpt=extraction.text.split('\n').find((line:string)=>line.startsWith('第十九条'))
    assert.equal(row.status,'fetched');assert.equal(extraction.applicableYear,'2027');assert.equal(extraction.publishedOn,'2026-09-24');assert.equal(extraction.issuedOn,'2026-09-21')
    assert.ok(excerpt.includes('2026年10月15日至10月24日'));assert.ok(excerpt.includes('每日9:00—22:00'))
    const card:KnowledgeCard={id:randomUUID(),revision:1,kind:'policy',status:'verified',synthetic:false,title:'2027硕士招生国家正式网上报名时段',url:row.url,publisher:row.publisher,publishedYear:'网页2026-09-24；文件2026-09-21；招生年度2027',verifiedAt:new Date().toISOString(),validUntil:new Date(Date.now()+6*3600000).toISOString(),excerpt,claim:'2027年全国硕士研究生招生正式网上报名时间为2026年10月15日至24日，每日9:00—22:00。',scope:'仅国家正式网报时段；2027硕士招生，不证明个人资格',limitations:'省级预报名、报考点安排和招生单位/项目条件须另核；本命题不保证个人可以报考或被录取。',mechanisms:['official-registration-window'],sourceHash:row.current_hash,scopeEvidence:[extraction.title,excerpt],scopeRules:{
      institution:{status:'all',quote:'全国硕士研究生招生工作管理规定'},
      department:{status:'not_applicable',reason:'仅描述国家网报时段，不核验院系资格',quote:'报名时间为2026年10月15日至10月24日'},
      project:{status:'specific',value:'硕士研究生招生',quote:'硕士研究生招生'},
      year:{status:'specific',value:'2027',quote:'2027年'},
      population:{status:'all',quote:'考生应在规定时间'},
    }}
    await approveOfficialKnowledge(row.id,row.revision,[card]);report.reviewedCards.push(card);save()
    const checked=await validateCoachCitations(card.claim,[{sourceId:card.id,revision:1,claim:card.claim,quote:excerpt,scope:card.scope}],[card],'年份=2027 项目=硕士研究生招生')
    assert.ok(checked.text.includes(card.limitations));assert.equal(checked.refs.length,1)
    await assert.rejects(validateCoachCitations(card.claim,[{sourceId:card.id,revision:1,claim:card.claim,quote:excerpt,scope:card.scope}],[card],'年份=2026 项目=硕士研究生招生'),{code:'COACH_CITATION_INVALID'})
    const view=await officialSourcesView();assert.equal(view.sources.length,2)
    const province=view.sources.find(source=>source.url===officialSourceRegistry[1].url)!
    assert.equal(province.claims.length,0)
    if(province.status==='fetched'){assert.equal(province.publishedOn,'2026-01-05');assert.equal(province.issuedOn,'2025-12-19');assert.equal(province.applicableYear,'2026');assert.equal(province.attachments.length,3)}
    else {assert.ok(province.unknowns.length);assert.ok(province.status==='partial'||province.status==='fetch_failed')}
    report.sourcesView=view;report.status=province.status==='fetched'?'PASS':'NATIONAL_TIMING_PASS_PROVINCE_UNVERIFIED';save()
  }catch(error){report.status='FAIL';report.errorCode=(error as any).code??'LOCAL_PUBLIC_SOURCE_ASSERTION_FAILED';save();throw error}
  finally{await pool.end()}
})
