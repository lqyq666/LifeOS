import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {officialSourceRegistry,syncOfficialSource,officialSourcesView} from '../../server/official-sources.ts'
import {syncOfficialAttachment} from '../../server/official-attachments.ts'
import {pool} from '../../server/db.ts'
test('actual provincial official Office files are bounded, parsed and stored without certifying personal eligibility',async()=>{
  const directory=resolve('.local/campus-growth/official-attachment-public-'+Date.now());mkdirSync(directory,{recursive:true})
  const report:any={status:'RUNNING',evidence:'REAL_PUBLIC_HTTPS_OFFICE_BYTES_AND_ISOLATED_POSTGRES',providerCalls:0,attachments:[],note:'浙江2026限定来源，仅提取；不认证个人/2027/其他省条件。'}
  const save=()=>writeFileSync(resolve(directory,'report.json'),JSON.stringify(report,null,2));save()
  try{
    const entry=officialSourceRegistry[1],source=await syncOfficialSource(entry);report.source=source;save()
    assert.equal(source.status,'fetched')
    const links=(await officialSourcesView()).sources[0].attachments;assert.equal(links.length,3)
    for(const link of links){const result=await syncOfficialAttachment(source.id,source.revision,link.url);report.attachments.push({...result,url:link.url});save();assert.equal(result.status,'parsed')}
    const rows=(await pool.query('SELECT a.url,a.payload,s.raw_bytes FROM official_attachments a JOIN official_attachment_snapshots s ON s.attachment_id=a.id AND s.revision=a.revision ORDER BY a.url')).rows
    assert.equal(rows.length,3);for(const row of rows){assert.ok(row.raw_bytes.length<2*1024*1024);assert.equal(row.raw_bytes.subarray(0,4).toString('hex'),'504b0304');assert.equal(row.payload.synthetic,false);assert.equal(row.payload.publishedOn,null);assert.equal(row.payload.sourceApplicableYear,'2026')}
    const rules=rows.find(row=>row.payload.title.startsWith('浙江省2026'))!
    assert.ok(rules.payload.extraction.text.includes('我省全日制高职高专应届毕业'))
    const sheet=rows.find(row=>row.payload.extraction.format==='xlsx')!
    assert.ok(sheet.payload.extraction.cells.some((cell:any)=>cell.address==='A2'&&cell.value.includes('2026年版')))
    assert.ok(sheet.payload.extraction.cells.some((cell:any)=>cell.address==='B5'&&cell.value==='010101哲学'))
    const form=rows.find(row=>row.payload.title.startsWith('附件2'))!
    assert.ok(form.payload.extraction.text.includes('身份证号'))
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM campus_knowledge')).rows[0].n,0,'no automatic eligibility claims')
    report.view=await officialSourcesView();report.rawHashes=rows.map(row=>({title:row.payload.title,hash:row.payload.extraction.hash,bytes:row.raw_bytes.length,cells:row.payload.extraction.cells?.length??null}));report.status='PASS';save()
  }catch(error){report.status='FAIL';report.errorCode=(error as any).code??'PUBLIC_ATTACHMENT_ASSERTION_FAILED';save();throw error}
  finally{await pool.end()}
})
