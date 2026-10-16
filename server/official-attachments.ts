import {randomUUID} from 'node:crypto'
import {pool,transaction,HttpError} from './db.ts'
import {config} from './config.ts'
import {officialAttachmentUrl,fetchOfficialAttachment,OfficialFetchError} from './official-fetch.ts'
import {extractOfficialAttachment} from './official-attachment-extract.ts'
import type {AttachmentExtraction} from './official-attachment-parser.ts'
const isolated=()=>/^lifeos_dialogue_(?:test|live)_/.test(new URL(config.databaseUrl).pathname.slice(1))
export async function syncOfficialAttachment(sourceId:string,expectedSourceRevision:number,url:string,fetcher=fetchOfficialAttachment){
  officialAttachmentUrl(url)
  const source=(await pool.query('SELECT * FROM official_sources WHERE id=$1',[sourceId])).rows[0]
  if(!source||source.revision!==expectedSourceRevision||source.status!=='fetched'||Date.parse(source.checked_at)<=Date.now()-24*3600000||!source.payload.extraction?.attachments.some((attachment:any)=>attachment.url===url))throw new HttpError(409,'OFFICIAL_ATTACHMENT_SOURCE_INVALID')
  if(fetcher!==fetchOfficialAttachment&&!isolated())throw new HttpError(400,'SYNTHETIC_IMPORT_REQUIRES_ISOLATION')
  if(source.payload.synthetic!==(fetcher!==fetchOfficialAttachment))throw new HttpError(400,'OFFICIAL_ATTACHMENT_SOURCE_INVALID')
  const before=(await pool.query('SELECT revision FROM official_attachments WHERE source_id=$1 AND url=$2',[sourceId,url])).rows[0]
  const attachment=source.payload.extraction.attachments.find((item:any)=>item.url===url)
  let bytes:Buffer|null=null,extraction:AttachmentExtraction|undefined,errorCode:string|undefined,finalUrl:string|undefined,contentType:string|undefined
  try{const fetched=await fetcher(url);bytes=fetched.bytes;finalUrl=fetched.url;contentType=fetched.contentType;extraction=await extractOfficialAttachment(bytes,url);if(/^text\/html\b/i.test(contentType))extraction.warnings.push('官方服务器MIME标为HTML；Office格式已另经ZIP签名与包结构检查')}
  catch(error){errorCode=error instanceof OfficialFetchError?error.code:'OFFICIAL_ATTACHMENT_FAILED'}
  const status=extraction?.status??'fetch_failed',checkedAt=new Date().toISOString()
  const payload={url,finalUrl:finalUrl??null,contentType:contentType??null,title:attachment.title,sourceId,sourceHash:source.current_hash,sourceRevision:source.revision,synthetic:source.payload.synthetic,checkedAt,status,errorCode:errorCode??extraction?.errorCode??null,extraction:extraction??null,publishedOn:null,sourcePublishedOn:source.payload.extraction.publishedOn,sourceIssuedOn:source.payload.extraction.issuedOn,sourceApplicableYear:source.payload.extraction.applicableYear,unknowns:['附件独立发布日期未知；父通知日期不冒充附件日期','正文或专业表不证明个人资格，仍须核具体条件、年度与省份','提取不等于维护核验，不自动创建可引用政策命题']}
  return transaction(async c=>{
    const currentSource=(await c.query('SELECT * FROM official_sources WHERE id=$1 FOR SHARE',[sourceId])).rows[0]
    if(!currentSource||currentSource.revision!==source.revision||currentSource.current_hash!==source.current_hash||currentSource.status!=='fetched'||Date.parse(currentSource.checked_at)<=Date.now()-24*3600000)throw new HttpError(409,'OFFICIAL_ATTACHMENT_SOURCE_CHANGED')
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['attachment:'+sourceId+':'+url])
    const current=(await c.query('SELECT * FROM official_attachments WHERE source_id=$1 AND url=$2 FOR UPDATE',[sourceId,url])).rows[0]
    if((current?.revision??0)!==(before?.revision??0))throw new HttpError(409,'OFFICIAL_ATTACHMENT_CHANGED')
    const id=current?.id??randomUUID(),revision=(current?.revision??0)+1,hash=extraction?.hash??null
    if(status!=='parsed'||current?.current_hash!==hash){
      const cards=(await c.query("SELECT * FROM campus_knowledge WHERE payload->>'url'=$1 AND status='verified' ORDER BY id FOR UPDATE",[url])).rows
      for(const card of cards){const changed={...card.payload,status:'unverified',revision:card.revision+1};await c.query("UPDATE campus_knowledge SET revision=$2,status='unverified',payload=$3,updated_at=now() WHERE id=$1",[card.id,changed.revision,changed]);await c.query('INSERT INTO campus_knowledge_revisions(id,revision,snapshot) VALUES($1,$2,$3)',[card.id,changed.revision,changed])}
    }
    await c.query('INSERT INTO official_attachments(id,source_id,url,revision,status,current_hash,source_hash,checked_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(source_id,url) DO UPDATE SET revision=EXCLUDED.revision,status=EXCLUDED.status,current_hash=EXCLUDED.current_hash,source_hash=EXCLUDED.source_hash,checked_at=EXCLUDED.checked_at,payload=EXCLUDED.payload',[id,sourceId,url,revision,status,hash,source.current_hash,checkedAt,payload])
    await c.query('INSERT INTO official_attachment_snapshots(attachment_id,revision,raw_bytes,payload) VALUES($1,$2,$3,$4)',[id,revision,bytes,payload])
    return {id,revision,status,hash,errorCode:payload.errorCode}
  })
}
export async function officialAttachmentViews(){
  const rows=(await pool.query('SELECT a.*,s.status AS parent_status,s.current_hash AS parent_hash,s.checked_at AS parent_checked,s.payload AS parent_payload FROM official_attachments a JOIN official_sources s ON s.id=a.source_id ORDER BY a.url')).rows
  return rows.map(row=>({id:row.id,sourceId:row.source_id,url:row.url,title:row.payload.title,revision:row.revision,status:row.status,synthetic:row.payload.synthetic,hash:row.current_hash,checkedAt:row.payload.checkedAt,sourceCurrent:!!row.parent_payload.extraction?.attachments.some((link:any)=>link.url===row.url)&&row.parent_status==='fetched'&&row.source_hash===row.parent_hash&&Date.parse(row.parent_checked)>Date.now()-24*3600000&&Date.parse(row.checked_at)>Date.now()-24*3600000,sourceRevision:row.payload.sourceRevision,format:row.payload.extraction?.format??'unknown',textPreview:row.payload.extraction?.text.slice(0,1600)??null,cellCount:row.payload.extraction?.cells?.length??null,cells:row.payload.extraction?.cells?.slice(0,12)??[],warnings:row.payload.extraction?.warnings??[],unknowns:row.payload.unknowns,publishedOn:row.payload.publishedOn,sourcePublishedOn:row.payload.sourcePublishedOn,sourceApplicableYear:row.payload.sourceApplicableYear,errorCode:row.payload.errorCode}))
}


