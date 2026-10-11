import test from 'node:test'
import assert from 'node:assert/strict'
import {buildClauseCatalogue} from '../server/clause-catalogue.ts'
import {resolveGrowthDeltas} from '../server/growth-authority.ts'
import {boundedOrdinaryReply} from '../server/bounded-reply.ts'
import {deriveTurnContract,negativePersonalFactClauses,reportsPersonalEvent} from '../server/turn-contract.ts'
import {deliverableIntent,requiresImmediateMaterial} from '../server/action-coach-events.ts'
import {knowledgeIntent} from '../server/evergreen-guide.ts'
import {resolveSelectedMaterialFacts} from '../server/grounded-material.ts'

test('first real ordinary failures: actual reports and emotions cannot become pursuits',()=>{
 for(const text of ['我实际问了一位同学','他说排课时间不好找','也没有付款','但还没用过任何我做的东西','我不想改到私人微信去催','我有点担心折腾很久还是不知道方向']){
  const catalogue=buildClauseCatalogue(text),r=resolveGrowthDeltas({deltas:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:catalogue[0]!.clauseId}}],currentMessageId:'m',currentText:text,catalogue,authorized:[],correctionPlan:null,controlClauseTexts:[]})
  assert.ok(r.deltas.every(x=>x.kind!=='goal'&&x.kind!=='direction'),text)
 }
 const text='我想了解同学选课的麻烦',catalogue=buildClauseCatalogue(text)
 assert.equal(resolveGrowthDeltas({deltas:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:catalogue[0]!.clauseId}}],currentMessageId:'m',currentText:text,catalogue,authorized:[],correctionPlan:null,controlClauseTexts:[]}).deltas[0]?.kind,'goal')
})
test('first real artifact requests open actual delivery and not generic coaching',()=>{
 for(const text of ['把我要问的问题压成一句：我想知道这门课程项目能不能用来说明实习需要的能力。','把上次的问题改成：你最近一次找排课时间时，具体用了什么办法？','现在想把我负责的排版写成一句实习作品描述，别说我画了插画。']){
  assert.equal(deliverableIntent(text,'create'),true,text);assert.equal(requiresImmediateMaterial(text),true,text)
 }
 assert.equal(deliverableIntent('不要把这个问题改成另一句，我只想聊聊。','create'),false)
})
test('first real discovery and not-started reports preserve the actual stage',()=>{
 const text='我是成年大学生，想了解同学在选课时到底遇到什么麻烦，还没访谈，也没有人承诺使用我的工具。怎样开始了解？'
 const contract=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
 const reply=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract,knowledgeCount:0,tier:'default'})!
 assert.ok(reply.choices.every(x=>/具体|最近一次/.test(x)&&/问|交流/.test(x)))
 assert.ok(negativePersonalFactClauses('我愿意先试整理一张作品，但还没开始。').some(x=>x.text==='但还没开始'))
})
test('a one-sentence portfolio artifact retains only the verified contribution',()=>{
 const catalogue=[{catalogueId:'own',field:'project' as const,text:'我负责文字和排版',sourceKind:'user_reported' as const,completeForField:false,sourceRef:{type:'growth' as const,id:'own',revision:1}},{catalogueId:'other',field:'project' as const,text:'主要插画是同伴画的',sourceKind:'user_reported' as const,completeForField:false,sourceRef:{type:'growth' as const,id:'other',revision:1}}]
 const r=resolveSelectedMaterialFacts(['own','other'],catalogue,'u','u','contribution_sentence')
 assert.equal(r.content,'我负责文字和排版。');assert.deepEqual(r.usedCatalogueIds,['own'])
 assert.throws(()=>resolveSelectedMaterialFacts(['other'],catalogue,'u','u','contribution_sentence'),/MATERIAL_REFERENCE_INVALID/)
 assert.throws(()=>resolveSelectedMaterialFacts(['own'],catalogue,'u','different','contribution_sentence'),/MATERIAL_REFERENCE_INVALID/)
})

test('R3 actual failures: unattempted choices cannot open experience and invalid optional observations are dropped',()=>{
 assert.equal(reportsPersonalEvent('我愿意先试整理未做完的作业题，这只是选择，我还没有开始。'),false)
 const text='这周剩余时间改成三十分钟。我想先处理作业。',catalogue=buildClauseCatalogue(text)
 const r=resolveGrowthDeltas({currentMessageId:'m',currentText:text,catalogue,authorized:[],correctionPlan:null,controlClauseTexts:[],deltas:[
   {target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}},
   {target:{operation:'create'},assertion:'ai_observation',kind:'observation',text:'待核对',source:{clauseId:'c1'},dependencies:[{id:'ffffffff-ffff-4fff-8fff-ffffffffffff',revision:1}],limitation:'依据尚未核验'},
 ]})
 assert.equal(r.deltas.length,1);assert.equal(r.deltas[0]!.assertion,'user_reported');assert.ok(r.audit.some(a=>a.phase==='growth_observation_unverified_dependency_dropped'))
 assert.ok(negativePersonalFactClauses('我是成年大学生，想整理海报，目前没有客户，也没有接过单。').some(c=>c.text==='目前没有客户'))
})
