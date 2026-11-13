import test from 'node:test'
import assert from 'node:assert/strict'
import {explicitTimeEvidenceCandidates,resolveTimeWindow} from '../server/growth-time.ts'
import {reportedActionProgress} from '../server/workflows/action-review.ts'
import {deriveThemeCandidates,type GrowthFact} from '../server/user-themes.ts'
import {buildClauseCatalogue} from '../server/clause-catalogue.ts'
import {resolveGrowthDeltas} from '../server/growth-authority.ts'
import {assistantRequestClause,responseRequestScope} from '../server/user-command-spans.ts'
import {deriveTurnContract} from '../server/turn-contract.ts'
import {turnSystemPrompt} from '../server/turn-prompt.ts'

test('observed next-step requests are excluded while independent facts survive',()=>{
 for(const request of ['请先帮我选一个今天能开始的小步骤','请你先帮我选一个今天能开始的小步骤','请问你能帮我选一个今天能开始的小步骤','可以请你先帮我选一个今天能开始的小步骤','请问：你能帮我选一个今天能开始的小步骤']){
 const text=request+'。我会用Excel。'
 assert.equal(assistantRequestClause(request),true)
 assert.equal(responseRequestScope(request).actionRequested,true,'the same understood request must reach the delivery contract')
 assert.equal(responseRequestScope(request).actionLimit,1,'one requested step must not become a generic multi-step reply')
 const resolved=resolveGrowthDeltas({currentMessageId:'synthetic-message',currentText:text,catalogue:buildClauseCatalogue(text),authorized:[],correctionPlan:null,controlClauseTexts:[],deltas:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'unknown',source:{clauseId:'c0'}},{target:{operation:'create'},assertion:'user_reported',kind:'ability',source:{clauseId:'c1'}}]})
 assert.deepEqual(resolved.deltas.map(delta=>delta.source.quote),['我会用Excel'])
 }
 for(const fact of ['我先帮同学整理了材料','老师请我先帮同学选方向','我希望先核对三列资料','请你先帮我这句话是我昨天对学长说的','请问你能帮我这段话是我上周发给老师的','能帮我做实验的同学已经找到了','可以帮我审稿的老师已经回复了','你帮我联系的老师已经回复了','你帮我联系的老师回复了','帮我做实验的同学已经找到了','你给我的建议很有用','你给我的步骤我已经做完了','请问你给我的步骤我已经做完了','麻烦你帮我联系的老师回复了','麻烦你帮我联系的老师已回复','麻烦你帮我联系的老师回复过','麻烦你帮我联系的老师已回信','帮我的同学已经到了'])assert.equal(assistantRequestClause(fact),false,fact)
 const prompt=turnSystemPrompt('default','qwen3.8-flash',deriveTurnContract({text:'请先帮我选一个今天能开始的小步骤。',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),false)
 assert.ok(prompt.includes('先以growthUpdates记录'),'interpret facts once before generating help based on them')
 assert.ok(!prompt.includes('输出时先给完整reply'),'reply-first experiment omitted native records in real R3')
 assert.ok(!prompt.includes('Schema开放lead时先输出lead'),'optional lead cannot remain simultaneously mandatory')
 const materialPrompt=turnSystemPrompt('default','qwen3.8-flash',deriveTurnContract({text:'请帮我写一封邮件。',knowledgeCount:0,currentEventExists:true,planIntent:false,material:true}),false)
 assert.ok(materialPrompt.includes('除Schema必填lead外'))
 assert.ok(materialPrompt.includes('不省略本轮必需的材料'))
 assert.ok(!materialPrompt.includes('没有事实变化时只给reply'))
})

test('today-only availability closes at the local day boundary, not tomorrow or a recurring week',()=>{
 const anchor='2026-10-29T15:59:00.000Z',source='今天我只有四分钟'
 const evidence=explicitTimeEvidenceCandidates(source,anchor,'Asia/Shanghai').find(candidate=>candidate.quote==='今天')
 assert.ok(evidence)
 assert.equal(resolveTimeWindow(evidence,source,anchor,'Asia/Shanghai').validUntil,'2026-10-29T16:00:00.000Z')
 assert.throws(()=>resolveTimeWindow({kind:'date_inclusive',date:'2026-10-30',quote:'今天'},source,anchor,'Asia/Shanghai'))
 for(const text of ['截止时间不是今天，是明天','今天不是截止日期','他说“今天我只有四分钟”','如果今天我只有四分钟'])assert.ok(!explicitTimeEvidenceCandidates(text,anchor,'Asia/Shanghai').some(candidate=>candidate.quote==='今天'),text)
 for(const text of ['今天我有一项长期约束：每周必须照顾家人。','今天我有每周四小时可用时间。','今天我有一台电脑。']){
  assert.ok(!explicitTimeEvidenceCandidates(text,anchor,'Asia/Shanghai').some(candidate=>candidate.quote==='今天'),text)
  assert.throws(()=>resolveTimeWindow({kind:'date_inclusive',date:'2026-10-29',quote:'今天'},text,anchor,'Asia/Shanghai'))
 }
})

test('an explicit named end belongs only to the matching authorized matter',()=>{
 const title='核对已保存的考研资料（十分钟起步）'
 assert.equal(reportedActionProgress('我决定结束考研资料这件事。',title).state,'ended')
 for(const source of ['我决定结束就业资料这件事。','如果我决定结束考研资料这件事。','室友说“我决定结束考研资料这件事”。'])assert.notEqual(reportedActionProgress(source,title).state,'ended',source)
 assert.notEqual(reportedActionProgress('我决定结束考研这件事。','考研资料核对').state,'ended','a shared direction word cannot identify the specific task')
})

test('a narrow material step and its ending never become an active broad study direction',()=>{
 const fact=(text:string):GrowthFact=>({id:'fact',kind:'goal',text,assertion:'user_reported',status:'active'})
 const candidates=deriveThemeCandidates([fact('我想核对已保存的考研资料')])
 assert.ok(candidates.every(candidate=>candidate.title!=='考研'))
 assert.equal(deriveThemeCandidates([{...fact('我决定考研'),id:'broad'},{...fact('我想核对已保存的考研资料'),id:'task'}]).length,2,'a shared path word is not evidence that the two targets are the same')
 assert.deepEqual(deriveThemeCandidates([fact('我决定结束考研资料这件事')]),[])
 assert.ok(deriveThemeCandidates([fact('我决定考研')]).some(candidate=>candidate.title==='考研'))
})
