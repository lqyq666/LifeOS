import test from 'node:test'
import assert from 'node:assert/strict'
import {buildClauseCatalogue} from '../server/clause-catalogue.ts'
import {requiresExperienceCandidate,selectStructuralCandidate} from '../server/experience-content.ts'
import {boundedOrdinaryReply} from '../server/bounded-reply.ts'
import {knowledgeIntent} from '../server/evergreen-guide.ts'
import {deriveTurnContract,reportedPreferenceClauses} from '../server/turn-contract.ts'
import {deriveThemeCandidates,themeAnchors,rankPrimaryThemes,mergeThemeCandidates,relationForExperience} from '../server/user-themes.ts'
import {resolveGrowthDeltas} from '../server/growth-authority.ts'

const story='昨天我把一页课程笔记做成了可检索的原型。我用现成模板搭好页面，再按两位同学给的三个关键词加了检索入口。因为这次我想先验证同学能不能找到资料。结果其中一个关键词还搜不到，另外两个能返回笔记段落；同学还没有实际使用过。'
const full='我是一名成年大学二年级学生，学的是电子信息相关专业。这周我可用于课外探索的时间是两小时，休息时间我想保留。我看重创造。'+story
test('naturally reported prototype keeps method, historical purpose and unverified use',()=>{
 const clauses=buildClauseCatalogue(full)
 assert.equal(requiresExperienceCandidate(clauses),true)
 const candidate=selectStructuralCandidate(full,clauses,'2026-10-26T01:58:00Z')!
 assert.equal(candidate.quote,story.slice(0,-1))
 assert.ok(candidate.content.action.includes('三个关键词加了检索入口'))
 assert.ok(candidate.content.result.includes('一个关键词还搜不到'))
 assert.ok(candidate.content.result.includes('同学还没有实际使用过'))
 assert.equal(clauses.find(c=>c.text.startsWith('因为这次'))!.interrogative,false)
})
test('embedded can-or-not in a reported purpose is not a current request for generic startup advice',()=>{
 assert.equal(boundedOrdinaryReply({text:full,intent:knowledgeIntent(full),contract:deriveTurnContract({text:full,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'}),null)
})
test('method continuations keep cooperation dependencies and worked-example support',()=>{
 const stories=[
  '上周我给课程任务整理了一个执行清单。我用纸笔写下两步，再把必须等同学确认的那一步单独标出来。因为这次我想自己决定先后顺序，同时不漏掉协作依赖。结果先做完了其中一步，另一项还在等回复。',
  '前天我核对了学习笔记里的两道例题。我照着老师的解题过程逐行重算，发现一处单位换算错误，改完后又用原题条件验了一遍。因为这次我想弄清自己错在哪里，而不是只记答案。结果这两道例题的重算做完了，老师还没评价，也不能据此说明我已经掌握整个章节。',
 ]
 for(const text of stories){const value=selectStructuralCandidate(text,buildClauseCatalogue(text),'2026-10-26T01:58:00Z')!;assert.equal(value.quote,text.slice(0,-1));assert.ok(value.content.action.includes(text.includes('纸笔')?'必须等同学确认':'原题条件验了一遍'))}
})
test('actual questions, hypothetical, quoted and future prototype work retain their boundaries',()=>{
 for(const text of ['我准备把课程笔记做成可检索原型。','如果我把笔记做成了原型，能说明什么？','同学说他把笔记做成了原型。','“昨天我把笔记做成了原型”只是例子。','我没有把笔记做成可检索原型。'])assert.equal(requiresExperienceCandidate(buildClauseCatalogue(text)),false,text)
 assert.ok(buildClauseCatalogue('因为这次我想先验证同学能不能找到资料？').some(c=>c.interrogative))
 assert.ok(buildClauseCatalogue(full+'这一步怎么调整？').at(-1)!.interrogative)
})
test('a reported episode purpose is context rather than a durable theme or a generic linkage anchor',()=>{
 const fact={id:'purpose',kind:'goal',text:'因为这次我想先验证同学能不能找到资料',assertion:'user_reported',status:'active'}
 assert.deepEqual(deriveThemeCandidates([fact]),[])
 assert.ok(!themeAnchors(fact.text).includes('因为'))
})
test('generic first-person intent cannot link a prototype to rest',()=>{
 assert.equal(relationForExperience({kind:'valued_point',title:'休息时间我想保留'},story,true),null)
})
test('same reported statement does not occupy two theme slots when provider kind changes',()=>{
 const base:any={id:'rest',kind:'valued_point',title:'休息时间我想保留',status:'pending',origin:'user_stated',pinned:false,summary:'',revision:1,source_refs:[{growthItemId:'old',quote:'休息时间我想保留'}]}
 const other={...base,id:'rest2',kind:'pursuit',title:'生活平衡',source_refs:[{growthItemId:'new',quote:'休息时间我想保留'}]}
 assert.equal(rankPrimaryThemes([base,other]).length,1)
 assert.equal(mergeThemeCandidates([base],[{kind:'pursuit',title:'生活平衡',status:'active',sourceGrowthId:'new',quote:'休息时间我想保留'} as any]).insert.length,0)
 assert.equal(mergeThemeCandidates([base],[{kind:'pursuit',title:'生活平衡',status:'active',sourceGrowthId:'new',quote:'休息时间我想保留'} as any]).update.length,0,'repetition is not an independent supporting source or a kind change')
})
test('explicit valued statements use the existing preference fallback, not personality inference',()=>{
 for(const text of ['我看重创造。','我也看重自主。','我重视成长。'])assert.equal(reportedPreferenceClauses(text).length,1,text)
 for(const text of ['你觉得我看重什么？','如果我看重创造会怎样？','同学说他看重自主。','“我看重成长”是例句。','我不看重创造。'])assert.equal(reportedPreferenceClauses(text).length,0,text)
})
test('an explicit preference keeps its meaning when the provider calls it context',()=>{
 const currentText='我也看重自主。',catalogue=buildClauseCatalogue(currentText)
 const out=resolveGrowthDeltas({deltas:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:catalogue[0].clauseId}}],currentMessageId:'synthetic-current',currentText,catalogue,authorized:[],correctionPlan:null,controlClauseTexts:[]})
 assert.equal(out.deltas[0].kind,'preference')
 assert.equal(out.deltas[0].source.quote,'我也看重自主')
})
