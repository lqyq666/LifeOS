import {randomUUID} from 'node:crypto'
import {pool,transaction,HttpError} from './db.ts'
import {officialUrl,fetchOfficialDocument,OfficialFetchError} from './official-fetch.ts'
import {extractOfficialDocument,type OfficialExtraction} from './official-extract.ts'
import {validateKnowledge,type KnowledgeCard} from './campus-knowledge.ts'
import {config} from './config.ts'

export const officialSourceRegistry=[
  {url:'https://yz.chsi.com.cn/kyzx/jybzc/202609/20260924/2293971511.html',publisher:'中国研究生招生信息网',issuer:'教育部'},
  {url:'https://www.zjzs.net/art/2026/1/5/art_49_11840.html',publisher:'浙江省教育考试院',issuer:'浙江省教育考试院'},
] as const
type Snapshot={url:string;publisher:string;issuer:string;checkedAt:string;status:OfficialExtraction['status']|'fetch_failed';synthetic:boolean;errorCode?:string;extraction?:OfficialExtraction}
const isolated=()=>/^lifeos_dialogue_(?:test|live)_/.test(new URL(config.databaseUrl).pathname.slice(1))
// Public fetch does not acquire a DB lock. The second snapshot CAS refuses a
// delayed fetch overwriting newer evidence; raw pages never become verified cards.
export async function syncOfficialSource(entry:typeof officialSourceRegistry[number],fetcher=fetchOfficialDocument){
  officialUrl(entry.url)
  if(!officialSourceRegistry.some(row=>row.url===entry.url&&row.publisher===entry.publisher&&row.issuer===entry.issuer))throw new HttpError(400,'OFFICIAL_REGISTRY_REQUIRED')
  const before=(await pool.query('SELECT id,revision FROM official_sources WHERE url=$1',[entry.url])).rows[0]
  let bytes:Buffer|null=null
  if(fetcher!==fetchOfficialDocument&&!isolated())throw new HttpError(400,'SYNTHETIC_IMPORT_REQUIRES_ISOLATION')
  const snapshot:Snapshot={...entry,checkedAt:new Date().toISOString(),status:'fetch_failed',synthetic:fetcher!==fetchOfficialDocument}
  try{const fetched=await fetcher(entry.url);bytes=fetched.bytes;snapshot.extraction=extractOfficialDocument(bytes,fetched.url,fetched.contentType);snapshot.status=snapshot.extraction.status}
  catch(error){snapshot.errorCode=error instanceof OfficialFetchError?error.code:'OFFICIAL_EXTRACT_FAILED'}
  return transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['official:'+entry.url])
    const current=(await c.query('SELECT * FROM official_sources WHERE url=$1 FOR UPDATE',[entry.url])).rows[0]
    if((current?.revision??0)!==(before?.revision??0))throw new HttpError(409,'OFFICIAL_SOURCE_CHANGED')
    const id=current?.id??randomUUID(),revision=(current?.revision??0)+1,hash=snapshot.extraction?.hash??null
    // A failed/partial check is uncertainty, not proof a policy disappeared.
    // Keep every old snapshot, but conservatively suspend its certified claims.
    const invalidates=snapshot.status!=='fetched'||current?.current_hash!==hash
    let invalidated=0
    if(invalidates){
      const cards=(await c.query("SELECT * FROM campus_knowledge WHERE payload->>'url'=$1 ORDER BY id FOR UPDATE",[entry.url])).rows
      for(const row of cards){
        if(row.status!=='verified')continue
        const payload={...row.payload,revision:row.revision+1,status:'unverified'}
        await c.query('UPDATE campus_knowledge SET revision=$2,status=$3,payload=$4,updated_at=now() WHERE id=$1',[row.id,payload.revision,payload.status,payload])
        await c.query('INSERT INTO campus_knowledge_revisions(id,revision,snapshot) VALUES($1,$2,$3)',[row.id,payload.revision,payload]);invalidated++
      }
    }
    await c.query('INSERT INTO official_sources(id,url,publisher,revision,status,current_hash,checked_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(url) DO UPDATE SET revision=EXCLUDED.revision,status=EXCLUDED.status,current_hash=EXCLUDED.current_hash,checked_at=EXCLUDED.checked_at,payload=EXCLUDED.payload',[id,entry.url,entry.publisher,revision,snapshot.status,hash,snapshot.checkedAt,snapshot])
    await c.query('INSERT INTO official_source_snapshots(source_id,revision,raw_bytes,payload) VALUES($1,$2,$3,$4)',[id,revision,bytes,snapshot])
    return {id,revision,status:snapshot.status,hash,invalidated}
  })
}
// Maintenance only. The reviewed claim must cite the exact current retrieved
// bytes and an exact extracted span. No browser/model endpoint can certify it.
export async function approveOfficialKnowledge(sourceId:string,expectedRevision:number,cards:KnowledgeCard[]){
  if(!cards.length||cards.length>16)throw new HttpError(400,'OFFICIAL_REVIEW_INVALID')
  return transaction(async c=>{
    const row=(await c.query('SELECT * FROM official_sources WHERE id=$1 FOR SHARE',[sourceId])).rows[0]
    const extraction:OfficialExtraction|undefined=row?.payload.extraction
    if(!row||row.revision!==expectedRevision||row.status!=='fetched'||!extraction)throw new HttpError(409,'OFFICIAL_SOURCE_CHANGED')
    for(const card of [...cards].sort((a,b)=>a.id.localeCompare(b.id))){
      validateKnowledge(card,row.payload.synthetic&&isolated())
      const freshnessLimit=Date.parse(row.payload.checkedAt)+24*3600000
      const year=card.scopeRules?.year
      if(extraction.applicableYear&&(card.scopeKeys?.year&&card.scopeKeys.year!==extraction.applicableYear||year&&year.status!=='unknown'&&(year.status!=='specific'||year.value!==extraction.applicableYear)))throw new HttpError(400,'OFFICIAL_REVIEW_INVALID')
      if(card.synthetic!==row.payload.synthetic||card.status!=='verified'||card.kind!=='policy'||card.url!==row.url||card.sourceHash!==row.current_hash||!extraction.text.includes(card.excerpt)||card.scopeEvidence?.some(span=>!extraction.text.includes(span))||!card.validUntil||Date.parse(card.validUntil)>freshnessLimit||Date.parse(card.validUntil)<=Date.now())throw new HttpError(400,'OFFICIAL_REVIEW_INVALID')
      // Reuse the same knowledge lock order/revision mechanism as importKnowledge.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['knowledge:'+card.id])
      const old=(await c.query('SELECT * FROM campus_knowledge WHERE id=$1 FOR UPDATE',[card.id])).rows[0]
      if(old&&card.revision<=old.revision)throw new HttpError(409,'KNOWLEDGE_REVISION_CONFLICT')
      await c.query('INSERT INTO campus_knowledge(id,revision,kind,status,synthetic,valid_until,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,kind=EXCLUDED.kind,status=EXCLUDED.status,synthetic=EXCLUDED.synthetic,valid_until=EXCLUDED.valid_until,payload=EXCLUDED.payload,updated_at=now()',[card.id,card.revision,card.kind,card.status,card.synthetic,card.validUntil,card])
      await c.query('INSERT INTO campus_knowledge_revisions(id,revision,snapshot) VALUES($1,$2,$3)',[card.id,card.revision,card])
    }
    return {approved:cards.length,sourceId,revision:expectedRevision}
  })
}
export async function officialSourcesView(){
  const rows=(await pool.query('SELECT id,revision,status,payload FROM official_sources ORDER BY url')).rows
  const cards=(await pool.query("SELECT id,revision,status,valid_until,payload,official_knowledge_current(payload) AS official_current FROM campus_knowledge WHERE kind='policy' ORDER BY id")).rows
  return {sources:rows.map(row=>{
    const payload:Snapshot=row.payload,extraction=payload.extraction
    return {id:row.id,revision:row.revision,status:row.status,synthetic:payload.synthetic,url:payload.url,publisher:payload.publisher,issuer:payload.issuer,checkedAt:payload.checkedAt,errorCode:payload.errorCode??null,title:extraction?.title??null,publishedOn:extraction?.publishedOn??null,issuedOn:extraction?.issuedOn??null,applicableYear:extraction?.applicableYear??null,attachments:extraction?.attachments??[],deadlines:extraction?.deadlineCandidates??[],unknowns:extraction?.unknowns??['本次未能读取正文，不能由此断言政策未发布'],textPreview:extraction?.text.slice(0,800)??null,claims:cards.filter(card=>card.payload.url===payload.url).map(card=>({id:card.id,revision:card.revision,title:card.payload.title,claim:card.payload.claim,scope:card.payload.scope,limitations:card.payload.limitations,validUntil:card.valid_until,status:card.status==='verified'&&!card.official_current?'unverified':card.status==='verified'&&(!card.valid_until||Date.parse(card.valid_until)<=Date.now())?'expired':card.status}))}
  })}
}

