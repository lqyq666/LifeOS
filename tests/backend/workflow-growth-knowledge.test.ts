import test from 'node:test'
import assert from 'node:assert/strict'
import {appendFileSync,readFileSync} from 'node:fs'
import {fixture} from '../workflows/fixtures.ts'
import {growthDiff,type GrowthSnapshotItem} from '../../server/workflows/growth-diff.ts'
import {applyGuide} from '../../server/workflows/guide-application.ts'
import {checkMaintenance,publicContentHash,type MaintenanceCandidate,type MaintenanceReviewReceipt} from '../../server/workflows/knowledge-maintenance.ts'
import type {EvidenceRecord} from '../../server/workflows/contracts.ts'
import {generateInsight} from '../../server/experience-insight.ts'
const sink=(row:unknown)=>appendFileSync((process.env.LIFEOS_WORKFLOW_EVIDENCE??'.planning/research/agent-workflows/evidence')+'/WORKFLOW_EXECUTION_TRACES.jsonl',JSON.stringify(row)+'\n')
test('G4 candidate diff is postcommit only, zero model; one paid design remains task evidence',()=>{
 const f=fixture();f.request.mode='growth_diff';const ref={type:'experience' as const,id:'synthetic-delivery',revision:1},text='我交付一张海报并收到50元。'
 f.request.authorizedEvidenceRefs.push(ref);f.records.push({ref,owner:f.request.internalActorKey,conversationId:f.request.conversationId,role:'user',status:'active',text})
 const after:GrowthSnapshotItem[]=[{ref,kind:'experience',status:'active',text,assertion:'user_reported'}]
 const host={traceId:f.request.traceId,requestId:f.request.requestId,committed:true,changedIds:[ref.id]}
 const delta=growthDiff(f.request,host,[],after,f.records,sink);assert.equal(delta.length,1);assert.ok(delta[0].now.includes(text));assert.ok(delta[0].unknowns[0].includes('稳定能力'));assert.equal(delta[0].needsConfirmation,false,'already reported fact is established; stable ability remains unknown separately')
 assert.throws(()=>growthDiff(f.request,{...host,committed:false},[],after,f.records),/stale_snapshot/)
 assert.deepEqual(growthDiff(f.request,{...host,changedIds:[]},[],after,f.records),[])
})
test('G4 correction and withdrawal never reprint old forgotten quote or infer identity',()=>{
 const f=fixture();f.request.mode='growth_diff';const ref={type:'growth' as const,id:'synthetic-context',revision:2},text='这周只有两小时。'
 f.request.authorizedEvidenceRefs.push(ref);f.records.push({ref,owner:f.request.internalActorKey,conversationId:f.request.conversationId,role:'user',status:'active',text})
 const old:GrowthSnapshotItem={ref:{...ref,revision:1},kind:'constraint',status:'active',text:'OLD_PRIVATE_QUOTE',assertion:'user_reported'},next:GrowthSnapshotItem={...old,ref,text}
 const host={traceId:f.request.traceId,requestId:f.request.requestId,committed:true,changedIds:[ref.id]}
 const result=growthDiff(f.request,host,[old],[next],f.records);assert.equal(result[0].change,'corrected');assert.ok(!JSON.stringify(result).includes('OLD_PRIVATE_QUOTE'))
 assert.ok(!JSON.stringify(growthDiff(f.request,host,[old],[],f.records)).includes('OLD_PRIVATE_QUOTE'))
 assert.throws(()=>growthDiff(f.request,host,[old],[{...next,ref:old.ref}],f.records),/stale_snapshot/)
})
test('G5 only current approved host guide may apply, candidate status stays suggested',()=>{
 const f=fixture(),ref={type:'knowledge' as const,id:'synthetic-guide',revision:1};f.request.authorizedEvidenceRefs.push(ref);f.records.push({ref,owner:null,conversationId:null,role:'public',status:'active',text:'公开方法',approved:true})
 const guide={guideId:ref.id,revision:1,sourceHash:'a'.repeat(64),reviewStatus:'approved' as const,current:true,branch:'b',stepId:'s',description:'先用5分钟列出一个实际问题。',minutes:5,stopCondition:'5分钟结束',support:'lifeos_adaptation' as const}
 const result=applyGuide(f.request,guide,f.records,sink);assert.equal(result.guideUsageCandidate.status,'suggested');assert.deepEqual(result.proposal.suggestedStateChanges,[])
 assert.throws(()=>applyGuide(f.request,{...guide,reviewStatus:'needs_review'},f.records),/source_invalid/)
 assert.throws(()=>applyGuide(f.request,{...guide,current:false},f.records),/source_invalid/)
 f.request.controls.refuseAdvice=true;assert.throws(()=>applyGuide(f.request,guide,f.records),/scope_denied/)
})
function maintenance():MaintenanceCandidate{return {guideId:'public-only',revision:1,contentHash:'a'.repeat(64),readings:[{url:'https://example.invalid/original',canonicalOrigin:'https://example.invalid/original',revision:1,sourceHash:'b'.repeat(64),readerId:'reader',quote:'先确认对方当前需求。',actuallyRead:true,withdrawn:false}],claims:[{id:'claim',text:'需求核对',sourceHash:'b'.repeat(64),quote:'先确认对方当前需求',support:'source_supported'}],coverage:[{candidateId:'x',status:'covered',destination:'public-only'}],producerId:'producer',skeptic:{reviewerId:'independent',issues:[],reviewedContentHash:'a'.repeat(64)},release:{humanReviewerId:null,reviewedContentHash:null,approved:false}}}
test('G5 local maintenance gate prevents model self-approval, false original support and silent coverage gaps',()=>{
 const m=maintenance();assert.equal(checkMaintenance(m,['x']).publishEligible,false)
 m.release={humanReviewerId:'human-fixture',reviewedContentHash:m.contentHash,approved:true};assert.equal(checkMaintenance(m,['x']).publishEligible,false,'model-provided humanReviewerId is not authenticated approval');assert.equal(checkMaintenance(m,['x'],()=>true).publishEligible,false,'actuallyRead boolean alone is not original reading proof');assert.equal(checkMaintenance(m,['x'],()=>true,()=>true).publishEligible,false,'a different role name does not prove independent review')
 m.skeptic.reviewerId=m.producerId;assert.equal(checkMaintenance(m,['x']).publishEligible,false)
 m.skeptic.reviewerId='independent';m.claims[0].quote='并保证成功';assert.ok(checkMaintenance(m,['x']).issues.includes('claim_without_read_source'))
 assert.ok(checkMaintenance(m,['x','missing']).issues.includes('coverage_incomplete_or_changed'))
})
test('G5 independent review needs a host receipt, even with captured sources and release approval',()=>{
 const m=maintenance();m.release={humanReviewerId:'human-fixture',reviewedContentHash:m.contentHash,approved:true}
 const gate=checkMaintenance(m,['x'],()=>true,()=>true)
 assert.equal(gate.publishEligible,false)
 assert.ok(gate.issues.includes('authenticated_skeptic_receipt_required'))
 assert.ok(gate.issues.includes('authenticated_release_receipt_required'))
})
test('G5 host journal binds independent review and human release to exact revision, sources and outcome',()=>{
 const m=maintenance();m.skeptic.receiptId='review-run';m.release={humanReviewerId:'human-fixture',reviewedContentHash:m.contentHash,approved:true,receiptId:'release-run'}
 const review:MaintenanceReviewReceipt={id:'review-run',kind:'independent_review',reviewerId:m.skeptic.reviewerId,producerId:m.producerId,guideId:m.guideId,revision:m.revision,contentHash:m.contentHash,sourceHashes:[m.readings[0].sourceHash],status:'completed',decision:'approve'}
 const release:MaintenanceReviewReceipt={...review,id:'release-run',kind:'human_release',reviewerId:'human-fixture'}
 const journal=new Map([[review.id,review],[release.id,release]]),check=()=>checkMaintenance(m,['x'],()=>true,()=>true,id=>journal.get(id)??null)
 assert.equal(check().publishEligible,true,'local host-journal fixture only, no real approval obtained')
 for(const changed of [{status:'cancelled' as const},{status:'failed' as const},{decision:'needs_review' as const},{decision:'reject' as const},{revision:2},{contentHash:'c'.repeat(64)},{sourceHashes:['c'.repeat(64)]},{producerId:'another-producer'},{reviewerId:'producer'},{kind:'human_release' as const},{id:'another-run'}]){
  journal.set(review.id,{...review,...changed});assert.equal(check().publishEligible,false,JSON.stringify(changed))
 }
 journal.set(review.id,review);journal.delete(release.id);assert.equal(check().publishEligible,false,'missing real release receipt')
 journal.set(release.id,{...release,revision:2});assert.equal(check().publishEligible,false,'release for another revision')
 journal.set(release.id,release);m.skeptic.receiptId=m.release.receiptId;assert.equal(check().publishEligible,false,'one receipt cannot stand for two independent roles')
})
test('G4 existing insight UI generator no longer asserts external recognition, stable ability or identity upgrades',()=>{
 const base={title:'海报',summary:'一次任务',action:'我交付了一张海报',result:'收到50元',occurredAt:'2026-10-10',skillTags:['设计'],blocked:false,externalFeedback:true,connectedThemes:[],relatedExperiences:[],identityLevel:0,identityName:'出发者',nextIdentity:'探索者',identityNextHint:'再做一件升级'}
 const insight=generateInsight(base);assert.ok(!insight.headline.includes('认可'));assert.ok(!insight.headline.includes('证明你有'));assert.ok(!JSON.stringify(insight).includes('变成'));assert.ok(!insight.nextStep.includes('升级'));assert.ok(insight.evidence.includes('实际效果分别核对'))
 const noFeedback=generateInsight({...base,externalFeedback:false});assert.ok(noFeedback.headline.includes('本次任务'))
})
test('G5 reposts are one canonical source, withdrawn reading cannot support a claim, no actual release',()=>{
 const m=maintenance();m.readings.push({...m.readings[0],url:'https://example.invalid/repost'});assert.equal(checkMaintenance(m,['x']).independentSourceCount,1)
 m.readings.forEach(x=>x.withdrawn=true);assert.ok(checkMaintenance(m,['x']).issues.includes('claim_without_read_source'))
 assert.equal(publicContentHash('source'),publicContentHash('source'))
 const coverage=JSON.parse(readFileSync('.planning/research/evergreen/KB_COVERAGE.json','utf8'));assert.ok(coverage); // Reads the existing corpus, never writes or creates a competing KB.
})
