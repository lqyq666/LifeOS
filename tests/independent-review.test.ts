import test from 'node:test'
import assert from 'node:assert/strict'
import {readIndependentExecution,readReviewedPilotContinuation,readOriginalCardReview,availableOriginalCardReviews} from '../server/independent-review.ts'

test('actual externally executed pilot bytes permit continuity testing without claiming continuity or same-version final acceptance',()=>{
 const execution=readIndependentExecution('coze-kb-r3-real-small'),pilot=readReviewedPilotContinuation('coze-kb-r3-real-small')
 assert.equal(execution.binding.reportSha256,'59dca996a5acfd058f657a80339e8d1186f219976b3495bfd5762d6e710b4a7d')
 assert.equal(execution.proof.cloudCommit,'974926e093eaf934b0268acad4cadde10a01652c')
 assert.equal(pilot.priorSamples,5);assert.equal(pilot.nextStage,'four_chains')
 assert.equal(pilot.continuity,'NOT_TESTED_SINGLE_TURN');assert.equal(pilot.releaseEligible,false)
 assert.equal(pilot.originalRequestsReissued,false);assert.equal(pilot.sameVersionFinalPerformance,'NOT_ACCEPTED_BY_PILOT')
 assert.notEqual(pilot.priorVersions.ordinary,pilot.priorVersions.complex)
})
test('a real dialogue review cannot become an original-source card review by changing its purpose',()=>{
 const card={id:'4589ba-invalid-card',revision:3,guide:{contentHash:'0'.repeat(64),claims:[]}}
 assert.throws(()=>readOriginalCardReview('coze-kb-r3-real-small',card,[],[]),/INDEPENDENT_CARD_SCOPE_INVALID/)
 assert.deepEqual(availableOriginalCardReviews(card,[],[]),[])
})
test('a different reviewer name, arbitrary receipt ID or boolean cannot select an unobserved execution',()=>{
 for(const id of ['reviewer-2','true','fake-receipt','coze-kb-r3-content','../PRIVATE'])assert.throws(()=>readReviewedPilotContinuation(id),/INDEPENDENT_EXECUTION_NOT_BOUND/)
})
