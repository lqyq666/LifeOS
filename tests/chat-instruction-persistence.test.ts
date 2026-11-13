import test from 'node:test'
import assert from 'node:assert/strict'
import {buildClauseCatalogue} from '../server/clause-catalogue.ts'
import {resolveGrowthDeltas} from '../server/growth-authority.ts'
import {requiresExperienceCandidate,selectStructuralCandidate} from '../server/experience-content.ts'

test('questions without question marks are not personal goals',()=>{
 const text='为什么值得我考虑，依据我说过的哪件事。'
 const catalogue=buildClauseCatalogue(text)
 const result=resolveGrowthDeltas({currentText:text,currentMessageId:'m',catalogue,authorized:[],correctionPlan:null,controlClauseTexts:[],deltas:catalogue.map(c=>({kind:'goal',assertion:'user_reported',source:{clauseId:c.clauseId},target:{operation:'create'}} as any))})
 assert.deepEqual(result.deltas,[])
})
test('negated completion lists never create performed experiences',()=>{
 for(const text of ['只给建议，不代表我已经接受、执行或完成，不创建任务或经历。','不代表我已经接受、执行或完成。','我没有接受、执行或完成。','我没有执行或完成这个尝试。','不要假设我已经完成了访谈。']){
  const catalogue=buildClauseCatalogue(text)
  assert.equal(requiresExperienceCandidate(catalogue),false,text)
  assert.equal(selectStructuralCandidate(text,catalogue,'2026-10-23T12:00:00Z'),null,text)
 }
 const real='我没有完成访谈。我已经写了三条访谈问题。'
 assert.equal(requiresExperienceCandidate(buildClauseCatalogue(real)),true,'independent actual work is retained')
})
test('explicit analysis-only scope blocks both model growth and experience extraction',()=>{
 const text='我想认真想一想，未来该往哪里走。请只分析，不修改档案或创建任务。'
 const catalogue=buildClauseCatalogue(text)
 const result=resolveGrowthDeltas({currentText:text,currentMessageId:'m',catalogue,authorized:[],correctionPlan:null,controlClauseTexts:[],deltas:catalogue.map(c=>({kind:'goal',assertion:'user_reported',source:{clauseId:c.clauseId},target:{operation:'create'}} as any))})
 assert.deepEqual(result.deltas,[])
})

test('real completed work and quoted instructions retain their own meaning',async()=>{
 const {profileWritesDisallowed}=await import('../server/user-command-spans.ts')
 for(const text of ['我没有客户，已经做完了原型。','我只做了一个原型。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(text)),true,text)
 assert.equal(profileWritesDisallowed('我看到提示写着“不要修改档案”，我已做完了原型。'),false)
 assert.equal(profileWritesDisallowed('不要修改档案，我看到“示例”两个字。'),true)
})
