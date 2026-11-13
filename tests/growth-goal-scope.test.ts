import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {buildClauseCatalogue} from '../server/clause-catalogue.ts'
import {resolveGrowthDeltas} from '../server/growth-authority.ts'

const prior=()=>({id:randomUUID(),revision:1,kind:'goal',assertion:'user_reported',text:'我想先核对考研资料',status:'active',unavailableReason:null})
test('a message-wide change marker cannot overwrite the old goal with an earlier independent goal',()=>{
 const old=prior(),text='我想每周练习篮球。我改主意了。我现在决定转向就业探索。'
 const result=resolveGrowthDeltas({deltas:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c0'}},{target:{operation:'create'},kind:'direction',assertion:'user_reported',source:{clauseId:'c2'}}],currentMessageId:randomUUID(),currentText:text,catalogue:buildClauseCatalogue(text),authorized:[old],correctionPlan:null,controlClauseTexts:[]})
 assert.equal(result.deltas[0]!.target.operation,'create','independent basketball goal retains its own identity')
 assert.deepEqual(result.deltas[1]!.target,{operation:'replace',itemId:old.id,expectedRevision:1});assert.equal(result.deltas[1]!.kind,'goal');assert.equal(result.deltas[1]!.source.quote,'我现在决定转向就业探索')
})
test('a direct correction cannot be targeted twice by a later goal-shaped create',()=>{
 const old=prior(),text='我现在决定转向就业探索。我还想换个社团目标。'
 const result=resolveGrowthDeltas({deltas:[{target:{operation:'correct',itemId:old.id},kind:'goal',assertion:'user_reported',source:{clauseId:'c0'}},{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c1'}}],currentMessageId:randomUUID(),currentText:text,catalogue:buildClauseCatalogue(text),authorized:[old],correctionPlan:null,controlClauseTexts:[]})
 assert.equal(result.deltas.filter(delta=>delta.target.operation==='replace'||delta.target.operation==='amend').length,1);assert.equal(result.deltas[1]!.target.operation,'create')
})
test('identical words in different clauses keep their own change-source identity',()=>{
 const old=prior(),text='我想先就业。我改主意了。我想先就业。'
 const result=resolveGrowthDeltas({deltas:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c0'}},{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c2'}}],currentMessageId:randomUUID(),currentText:text,catalogue:buildClauseCatalogue(text),authorized:[old],correctionPlan:null,controlClauseTexts:[]})
 assert.equal(result.deltas[0]!.target.operation,'create');assert.equal(result.deltas[1]!.target.operation,'replace')
 assert.equal(result.audit.find(entry=>entry.phase==='growth_goal_superseded')?.inputIndex,1)
})
test('a bare own change marker binds its adjacent new pursuit, while someone elses marker does not',()=>{
 for(const [text,replaced] of [['我改主意了，现在想先就业。',true],['室友说他改主意了。我想每周练习篮球。',false]] as const){
  const old=prior(),catalogue=buildClauseCatalogue(text),anchor=catalogue.at(-1)!
  const result=resolveGrowthDeltas({deltas:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:anchor.clauseId}}],currentMessageId:randomUUID(),currentText:text,catalogue,authorized:[old],correctionPlan:null,controlClauseTexts:[]})
  assert.equal(result.deltas[0]!.target.operation,replaced?'replace':'create',text)
 }
})
