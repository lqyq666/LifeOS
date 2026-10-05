import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {officialSourceRegistry,syncOfficialSource,officialSourcesView} from '../../server/official-sources.ts'
import {syncOfficialAttachment} from '../../server/official-attachments.ts'
import {extractOfficialAttachment} from '../../server/official-attachment-extract.ts'
import {fetchOfficialAttachment} from '../../server/official-fetch.ts'
import {officeFixture} from '../fixtures/official-office.ts'
import {pool} from '../../server/db.ts'
const entry=officialSourceRegistry[1],fixture=JSON.parse(readFileSync('tests/fixtures/official-source-dom.json','utf8'))[1]
const docUrl='https://www.zjzs.net/module/download/downfile.jsp?classid=0&showname=conditions.docx&filename='+'a'.repeat(32)+'.docx'

test('bounded Office worker preserves DOCX text and XLSX coordinates, blanks and identifiers without writing files',async()=>{
  const doc=await extractOfficialAttachment(await officeFixture('docx'),docUrl)
  assert.equal(doc.status,'parsed');assert.ok(doc.text.includes('SYNTHETIC 浙江2026'))
  const sheet=await extractOfficialAttachment(await officeFixture('xlsx'),docUrl.replaceAll('.docx','.xlsx'))
  assert.equal(sheet.status,'parsed');assert.deepEqual(sheet.cells,[{sheet:'专业表',address:'A1',value:'代码'},{sheet:'专业表',address:'B3',value:' 0012 '},{sheet:'专业表',address:'C3',value:'0'}])
})
test('Office safety rejects macros, oversized expansion, entities, sparse grids, external image access and formula caches',async()=>{
  for(const [format,extra,code] of [
    ['docx',{'word/vbaProject.bin':'macro'},'ATTACHMENT_ACTIVE_CONTENT'],
    ['docx',{'word/huge.xml':'x'.repeat(4*1024*1024+1)},'ATTACHMENT_ZIP_LIMIT'],
    ['docx',{'customXml/item1.xml':'<!DOCTYPE a [<!ENTITY x SYSTEM "file:///private">]><a>&x;</a>'},'ATTACHMENT_XML_UNSAFE'],
    ['docx',{'word/_rels/document.xml.rels':'<Relationships><Relationship TargetMode="External" Type="image" Target="file:///private"/></Relationships>'},'ATTACHMENT_EXTERNAL_RESOURCE'],
    ['xlsx',{'xl/worksheets/sheet1.xml':'<worksheet><dimension ref="A1:XFD1048576"/></worksheet>'},'ATTACHMENT_GRID_LIMIT'],
    ['xlsx',{'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1"><f>WEBSERVICE("http://127.0.0.1")</f><v>1</v></c></row></sheetData></worksheet>'},'ATTACHMENT_FORMULA_UNSUPPORTED'],
    ['xlsx',{'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>cached formula result</v></c></row></sheetData></worksheet>'},'ATTACHMENT_FORMULA_UNSUPPORTED'],
  ] as const){
    const result=await extractOfficialAttachment(await officeFixture(format,extra),docUrl.replaceAll('.docx','.'+format))
    assert.equal(result.errorCode,code);assert.ok(result.status==='rejected'||result.status==='unsupported');assert.equal(result.text,'')
  }
  assert.equal((await extractOfficialAttachment(Buffer.from('%PDF-1.7'),docUrl.replaceAll('.docx','.pdf'))).status,'unsupported')
})
test('only signature-confirmed Office attachments tolerate real endpoint HTML MIME mislabeling',async()=>{
  const bytes=await officeFixture('docx')
  const transport={resolve:async()=>[{address:'8.8.8.8',family:4}],get:async()=>({status:200,headers:{'content-type':'text/html'},bytes})}
  assert.equal((await fetchOfficialAttachment(docUrl,transport)).bytes,bytes)
  await assert.rejects(fetchOfficialAttachment(docUrl,{...transport,get:async()=>({status:200,headers:{'content-type':'text/html'},bytes:Buffer.from('<html>not a document</html>')})}),{code:'OFFICIAL_CONTENT_UNSUPPORTED'})
})
test('attachment snapshots bind current linked parent bytes; changes, failure and delayed reads never certify eligibility',async()=>{
  let sourceId:string|undefined
  try{
    const parent=Buffer.from(fixture.html),source=await syncOfficialSource(entry,async()=>({url:entry.url,bytes:parent,contentType:'text/html'}));sourceId=source.id
    const links=(await officialSourcesView()).sources[0].attachments
    const bytes=await officeFixture('docx'),url=links[0].url
    await assert.rejects(syncOfficialAttachment(source.id,source.revision,docUrl,async()=>({url:docUrl,bytes,contentType:'application/octet-stream'})),{code:'OFFICIAL_ATTACHMENT_SOURCE_INVALID'})
    const result=await syncOfficialAttachment(source.id,source.revision,url,async()=>({url,bytes,contentType:'application/octet-stream'}))
    assert.equal(result.status,'parsed');assert.equal((await officialSourcesView()).sources[0].attachments[0].read!.sourceCurrent,true)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM campus_knowledge WHERE payload->>\'url\'=$1',[url])).rows[0].n,0)
    let start!:()=>void,release!:(v:{url:string;bytes:Buffer;contentType:string})=>void
    const started=new Promise<void>(resolve=>{start=resolve}),wait=new Promise<{url:string;bytes:Buffer;contentType:string}>(resolve=>{release=resolve})
    const delayed=syncOfficialAttachment(source.id,source.revision,url,async()=>{start();return wait});await started
    await syncOfficialSource(entry,async()=>({url:entry.url,bytes:Buffer.from(fixture.html.replace('2026','2027')),contentType:'text/html'}))
    release({url,bytes,contentType:'application/octet-stream'});await assert.rejects(delayed,{code:'OFFICIAL_ATTACHMENT_SOURCE_CHANGED'})
    assert.equal((await officialSourcesView()).sources[0].attachments[0].read!.sourceCurrent,false)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM official_attachment_snapshots')).rows[0].n,1)
    const card={url,sourceHash:result.hash}
    assert.equal((await pool.query('SELECT official_knowledge_current($1::jsonb) AS valid',[card])).rows[0].valid,false)
    await syncOfficialSource(entry,async()=>{throw new Error('synthetic failure')})
    const failedView=(await officialSourcesView()).sources[0]
    assert.equal(failedView.status,'fetch_failed');assert.equal(failedView.attachments[0].read!.sourceCurrent,false)
    assert.equal(failedView.attachments[0].read!.hash,result.hash,'failed parent keeps the previously read attachment visible as suspended')
  }finally{
    if(sourceId){await pool.query('DELETE FROM official_attachment_snapshots WHERE attachment_id IN (SELECT id FROM official_attachments WHERE source_id=$1)',[sourceId]);await pool.query('DELETE FROM official_attachments WHERE source_id=$1',[sourceId]);await pool.query('DELETE FROM official_source_snapshots WHERE source_id=$1',[sourceId]);await pool.query('DELETE FROM official_sources WHERE id=$1',[sourceId])}
    await pool.end()
  }
})
