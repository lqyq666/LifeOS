import test from 'node:test'
import assert from 'node:assert/strict'
import {buildClauseCatalogue} from '../server/clause-catalogue.ts'
import {resolveGrowthDeltas} from '../server/growth-authority.ts'
import {assistantRequestClause} from '../server/user-command-spans.ts'

test('the observed request for one step is not a personal time constraint or an observation dependency',()=>{
 const text='这周现在只剩半小时，只看一个岗位就好，给我一个能开始的步骤。',catalogue=buildClauseCatalogue(text)
 const id=(quote:string)=>catalogue.find(clause=>clause.text===quote)!.clauseId
 const budget=id('这周现在只剩半小时'),scope=id('只看一个岗位就好'),request=id('给我一个能开始的步骤')
 const delta=(clauseId:string)=>({target:{operation:'create' as const},assertion:'user_reported' as const,kind:'constraint' as const,source:{clauseId},timeEvidence:{kind:'calendar_week' as const,which:'this' as const,clauseId:budget}})
 const result=resolveGrowthDeltas({currentMessageId:'00000000-0000-4000-8000-000000000001',currentText:text,catalogue,authorized:[],correctionPlan:null,controlClauseTexts:[],deltas:[delta(budget),delta(scope),delta(request),{target:{operation:'create'},assertion:'ai_observation',kind:'observation',source:{clauseId:request},text:'用户长期只适合最小步骤',limitation:'未经本人核对',dependencies:[{updateIndex:2}]}]})
 assert.equal(assistantRequestClause('给我一个能开始的步骤'),true)
 assert.deepEqual(result.deltas.map(delta=>delta.source.quote),['这周现在只剩半小时','只看一个岗位就好'])
 assert.equal(result.indexMap.get(0),0)
 assert.equal(result.indexMap.get(1),1)
 assert.equal(result.indexMap.has(2),false)
 assert.equal(result.indexMap.has(3),false,'an observation cannot survive on a discarded instruction')
 assert.ok(result.audit.some(entry=>entry.phase==='growth_clause_not_anchorable'&&entry.inputIndex===2))
 assert.equal(assistantRequestClause('我给同学一个排版样例'),false,'a reported action remains distinct from asking the assistant')
})
