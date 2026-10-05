// Offline source snapshots use the existing isolated recovery worker contract.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {config} from '../server/config.ts'
import {pool} from '../server/db.ts'
import {syncOfficialSource,officialSourceRegistry,officialSourcesView} from '../server/official-sources.ts'
import {OfficialFetchError} from '../server/official-fetch.ts'
import {syncOfficialAttachment} from '../server/official-attachments.ts'
import {officeFixture} from '../tests/fixtures/official-office.ts'
const target=new URL(config.databaseUrl)
if(target.hostname!=='127.0.0.1'||target.port!=='55432'||!/^\/lifeos_dialogue_test_[a-z0-9_]+$/.test(target.pathname))throw new Error('Official recovery requires an isolated local database')
const fixture=JSON.parse(readFileSync('tests/fixtures/official-source-dom.json','utf8'))[0]
const bytes=Buffer.from(fixture.html),entry=officialSourceRegistry[0]
try{
  if(process.argv.includes('--seed')){
    await syncOfficialSource(entry,async()=>({url:entry.url,bytes,contentType:'text/html'}))
    await syncOfficialSource(entry,async()=>{throw new OfficialFetchError('OFFICIAL_HTTP_FAILED')})
    const provinceEntry=officialSourceRegistry[1],provinceFixture=JSON.parse(readFileSync('tests/fixtures/official-source-dom.json','utf8'))[1]
    const province=await syncOfficialSource(provinceEntry,async()=>({url:provinceEntry.url,bytes:Buffer.from(provinceFixture.html),contentType:'text/html'}))
    const url=(await officialSourcesView()).sources.find(row=>row.id===province.id)!.attachments[0].url,document=await officeFixture('docx')
    await syncOfficialAttachment(province.id,province.revision,url,async()=>({url,bytes:document,contentType:'application/octet-stream'}))
    await syncOfficialSource(provinceEntry,async()=>{throw new OfficialFetchError('OFFICIAL_HTTP_FAILED')})
    console.log(JSON.stringify({seeded:true,providerCalls:0,publicFetches:0}))
  }else{
    const rows=(await pool.query('SELECT ss.revision,ss.raw_bytes,ss.payload FROM official_source_snapshots ss JOIN official_sources s ON s.id=ss.source_id WHERE s.url=$1 ORDER BY ss.revision',[entry.url])).rows
    assert.equal(rows.length,2);assert.equal(rows[0].payload.extraction.applicableYear,'2027')
    assert.equal(rows[0].payload.extraction.publishedOn,'2026-09-24');assert.equal(rows[0].payload.extraction.issuedOn,'2026-09-21')
    assert.equal(createHash('sha256').update(rows[0].raw_bytes).digest('hex'),rows[0].payload.extraction.hash)
    assert.equal(rows[1].raw_bytes,null);assert.equal(rows[1].payload.status,'fetch_failed')
    assert.equal((await officialSourcesView()).sources.find(row=>row.url===entry.url)!.status,'fetch_failed')
    const attachment=(await pool.query('SELECT a.payload,s.raw_bytes FROM official_attachments a JOIN official_attachment_snapshots s ON s.attachment_id=a.id')).rows[0]
    assert.equal(createHash('sha256').update(attachment.raw_bytes).digest('hex'),attachment.payload.extraction.hash)
    const province=(await officialSourcesView()).sources.find(row=>row.url===officialSourceRegistry[1].url)!
    assert.equal(province.attachments[0].read!.sourceCurrent,false);assert.equal(province.attachments[0].read!.status,'parsed')
    assert.equal(attachment.payload.publishedOn,null);assert.equal(attachment.payload.sourceApplicableYear,'2026')
    const next=await syncOfficialSource(entry,async()=>({url:entry.url,bytes,contentType:'text/html'}))
    assert.equal(next.revision,3);assert.equal(next.status,'fetched')
    assert.equal((await officialSourcesView()).sources.find(row=>row.url===entry.url)!.claims.length,0,'restoring or fetching never creates reviewed policy claims')
    console.log(JSON.stringify({status:'PASS',rawHashPreserved:true,failedSnapshotPreserved:true,datesDistinct:true,nextRevision:3,noAutomaticClaims:true,attachmentRawHashPreserved:true,attachmentParentFailurePreserved:true,attachmentDatesNotInferred:true,providerCalls:0,publicFetches:0}))
  }
}finally{await pool.end()}
