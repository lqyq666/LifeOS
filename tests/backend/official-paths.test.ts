import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {extractOfficialDocument} from '../../server/official-extract.ts'
import {officialUrl} from '../../server/official-fetch.ts'
import {officialPaths} from '../../server/official-paths.ts'
const fixture=JSON.parse(readFileSync('tests/fixtures/official-recommendation-dom.json','utf8'))
test('saved actual recommendation DOM separates three actions without borrowing the overall system end',()=>{
  const result=extractOfficialDocument(Buffer.from(fixture.html),fixture.url)
  assert.equal(result.status,'fetched');assert.equal(result.applicableYear,'2027');assert.equal(result.publishedOn,null);assert.equal(result.issuedOn,null)
  assert.deepEqual(result.milestones?.map(({action,startDate,startTime,endDate,status})=>({action,startDate,startTime,endDate,status})),[
    {action:'volunteer_application',startDate:'2026-09-21',startTime:null,endDate:'2026-10-18',status:'requires_review'},
    {action:'interview_confirmation',startDate:'2026-09-22',startTime:'08:00',endDate:null,status:'requires_review'},
    {action:'admission_confirmation',startDate:'2026-09-24',startTime:'14:00',endDate:null,status:'requires_review'},
  ])
  assert.ok(result.milestones?.every(row=>result.text.includes(row.sourceQuote)))
  assert.match(result.unknowns.join(' '),/确认截止未知/)
})
test('ambiguous admission years, calendar years, dates and times never become certified actions',()=>{
  const extract=(html:string)=>extractOfficialDocument(Buffer.from(html),fixture.url)
  assert.deepEqual(extract(fixture.html.replaceAll('2027年推免生于','推免生于')).milestones,[])
  assert.deepEqual(extract(fixture.html.replace('2027年推免生于','2028年推免生于2027年推免生于')).milestones,[])
  assert.equal(extract(fixture.html.replace('（二）2026年','（二）2025年')).milestones?.length,1)
  assert.equal(extract(fixture.html.replaceAll('9月22日8:00','2月30日8:00')).milestones?.some(row=>row.action==='interview_confirmation'),false)
  assert.equal(extract(fixture.html.replaceAll('9月24日14:00','9月24日24:00')).milestones?.some(row=>row.action==='admission_confirmation'),false)
})
test('official path links stay HTTPS and reference destinations never certify jobs or recognition',()=>{
  assert.equal(officialPaths.length,3)
  for(const path of officialPaths){assert.equal(officialUrl(path.url).protocol,'https:');assert.ok(path.purpose);assert.equal(path.limitations.length,2)}
  const shell=extractOfficialDocument(Buffer.from('<title>国家大学生就业服务平台</title><body><h4>切换就业网站</h4><script>loadJobs()</script></body>'),officialPaths[1].url)
  assert.equal(shell.status,'partial');assert.equal(shell.applicableYear,null);assert.equal(shell.deadlineCandidates.length,0)
  assert.match(officialPaths[2].limitations.join(' '),/不保证项目录取或个人认证/)
})
