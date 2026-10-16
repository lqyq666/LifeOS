// Reviewed web-tool extracts may supplement failed direct GETs. This command
// cannot mark guides approved. It accepts short primary-body fragments only.
import {readFileSync,writeFileSync} from 'node:fs'
import {sourceSpecs} from './evergreen-seed.ts'
import {kbHash} from '../server/evergreen-guide.ts'
const base='.planning/research/evergreen/'
const read=(file:string)=>readFileSync(base+file,'utf8').trim().split('\n').map(s=>JSON.parse(s))
const write=(file:string,rows:any[])=>writeFileSync(base+file,rows.map(s=>JSON.stringify(s)).join('\n')+'\n')
const fragments=JSON.parse(readFileSync(process.argv[2],'utf8'))
for(const suffix of ['', '_REOPEN']){
 const sourceFile=suffix?'KB_SOURCE_REOPEN.jsonl':'KB_SOURCE_REGISTRY.jsonl',evidenceFile=suffix?'KB_EVIDENCE_REOPEN.jsonl':'KB_EVIDENCE.jsonl'
 const registry=read(sourceFile),evidence=read(evidenceFile)
 for(const f of fragments){
  const spec=sourceSpecs.find(s=>s.id===f.id)
  if(!spec||spec.url!==f.url||!f.quote||f.quote.split(/\s+/).length>25||f.locatorKind!=='web_original_body_line')throw new Error('INVALID_WEB_BODY_FRAGMENT')
  const row=registry.find(s=>s.source_id===f.id),fragmentHash=kbHash(f.quote)
  Object.assign(row,{title:f.title,publisher:spec.publisher,source_group:f.id.startsWith('upwork')?'upwork-practice':f.id,access_status:'body_accessible',save_scope:'short_primary_body_excerpt_only',original_fingerprint:fragmentHash,fingerprint_scope:'reviewed_fragment_not_whole_document',semantic_scope:spec.supports,cannot_infer:spec.excludes,direct_access_error:row.error,acquisition:'web original body extraction; direct GET denied',retrieved_at:f.retrievedAt})
  delete row.error
  const entry={evidence_id:f.id+'-e1',source_id:f.id,source_revision:1,quote:f.quote,context:spec.supports,locator:{kind:f.locatorKind,line:f.line,url:f.url},acquisition:'web__run open original page body, not search snippet',content_hash:fragmentHash,extraction_coverage:[{locator:'indicated body line',disposition:'adopted',reason:spec.supports},{locator:'remaining original',disposition:'not_adopted',reason:'No platform price, payment rules, contract or guarantee claims adopted.'}]}
  const at=evidence.findIndex(e=>e.evidence_id===entry.evidence_id);if(at<0)evidence.push(entry);else evidence[at]=entry
 }
 write(sourceFile,registry);write(evidenceFile,evidence)
}
console.log('Recorded '+fragments.length+' short primary-body excerpts; no guide status changed.')
