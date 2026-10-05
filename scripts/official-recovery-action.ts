// Offline source snapshots use the existing isolated recovery worker contract.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {config} from '../server/config.ts'
import {pool} from '../server/db.ts'
import {syncOfficialSource,officialSourceRegistry,officialSourcesView} from '../server/official-sources.ts'
import {OfficialFetchError} from '../server/official-fetch.ts'
const target=new URL(config.databaseUrl)
if(target.hostname!=='127.0.0.1'||target.port!=='55432'||!/^\/lifeos_dialogue_test_[a-z0-9_]+$/.test(target.pathname))throw new Error('Official recovery requires an isolated local database')
const fixture=JSON.parse(readFileSync('tests/fixtures/official-source-dom.json','utf8'))[0]
const bytes=Buffer.from(fixture.html),entry=officialSourceRegistry[0]
try{
  if(process.argv.includes('--seed')){
    await syncOfficialSource(entry,async()=>({url:entry.url,bytes,contentType:'text/html'}))
    await syncOfficialSource(entry,async()=>{throw new OfficialFetchError('OFFICIAL_HTTP_FAILED')})
    console.log(JSON.stringify({seeded:true,providerCalls:0,publicFetches:0}))
  }else{
    const rows=(await pool.query('SELECT revision,raw_bytes,payload FROM official_source_snapshots ORDER BY revision')).rows
    assert.equal(rows.length,2);assert.equal(rows[0].payload.extraction.applicableYear,'2027')
    assert.equal(rows[0].payload.extraction.publishedOn,'2026-09-24');assert.equal(rows[0].payload.extraction.issuedOn,'2026-09-21')
    assert.equal(createHash('sha256').update(rows[0].raw_bytes).digest('hex'),rows[0].payload.extraction.hash)
    assert.equal(rows[1].raw_bytes,null);assert.equal(rows[1].payload.status,'fetch_failed')
    assert.equal((await officialSourcesView()).sources[0].status,'fetch_failed')
    const next=await syncOfficialSource(entry,async()=>({url:entry.url,bytes,contentType:'text/html'}))
    assert.equal(next.revision,3);assert.equal(next.status,'fetched')
    assert.equal((await officialSourcesView()).sources[0].claims.length,0,'restoring or fetching never creates reviewed policy claims')
    console.log(JSON.stringify({status:'PASS',rawHashPreserved:true,failedSnapshotPreserved:true,datesDistinct:true,nextRevision:3,noAutomaticClaims:true,providerCalls:0,publicFetches:0}))
  }
}finally{await pool.end()}
