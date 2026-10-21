import {taskOutcomeReadback} from '../server/turn-contract.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {deriveThemeCandidates,themeHasPursuitSource} from '../server/user-themes.ts'
import {buildClauseCatalogue} from '../server/clause-catalogue.ts'
import {resolveGrowthDeltas} from '../server/growth-authority.ts'
const fact=(text:string,kind='preference')=>({id:text,text,kind,status:'active',assertion:'user_reported'})
test('real six-chain conversation instructions and negative preferences are not pursuits',()=>{
 for(const text of ['不要加付款','请从生活体验聊起','先问一个值得问的问题','我并不享受考试本身','不在意当老板']){
  assert.deepEqual(deriveThemeCandidates([fact(text)]),[],text)
  assert.equal(themeHasPursuitSource({pinned:false,source_refs:[{growthItemId:text,quote:text}]}),false,text)
 }
 assert.equal(deriveThemeCandidates([fact('我主要在意能自己安排一天中专注工作的时间')])[0]?.title,'主要在意能自己安排一天中专注')
 assert.equal(deriveThemeCandidates([fact('我想找一份实习','goal')])[0]?.title,'就业')
 assert.equal(deriveThemeCandidates([fact('我喜欢打羽毛球')]).length,1)
})
test('instruction list fragments cannot become facts while neighboring experience survives',()=>{
 const currentText='昨晚和室友打羽毛球后觉得轻松。请从生活体验聊起，不要加付款、采用、效率评分或职业标签。先问一个值得问的问题。'
 const catalogue=buildClauseCatalogue(currentText)
 const deltas=catalogue.map(c=>({target:{operation:'create' as const},assertion:'user_reported' as const,kind:'preference' as const,source:{clauseId:c.clauseId}}))
 const r=resolveGrowthDeltas({deltas,currentText,currentMessageId:'m',catalogue,authorized:[],correctionPlan:null,controlClauseTexts:[]})
 assert.deepEqual(r.deltas.map(d=>d.source.quote),['昨晚和室友打羽毛球后觉得轻松'])
})
import {observationEffectHypothesis} from '../server/reply-draft.ts'
import {applicableExperienceOutcomes} from '../server/experience-insight.ts'
test('observed effect hypothesis retains its grammatical subject',()=>{
 assert.equal(observationEffectHypothesis('这次结果支持了规则对减少他人询问有潜在作用'),'规则对减少他人询问有潜在作用')
})
test('explicit acknowledged reading makes read and response applicable to the PDF experience',()=>{
 assert.deepEqual(applicableExperienceOutcomes({sourceQuote:'回来反馈：我发了PDF，导师确认已经读到，但还没有说是否采用其中建议，也没有给效果反馈',outcomes:taskOutcomeReadback('导师确认已经读到',undefined,false,true)}),['read','response','adoption','effect'])
})
import {findEpisode} from '../server/experience-episodes.ts'
test('explicit named-matter continuation binds a unique existing episode without fuzzy merging',()=>{
 const episode={id:'portfolio',source_quote:'我把作品集链接发给导师了，对方还没回复',content:{}}
 const report='接着作品集的事：导师回复说手机打不开链接，但没有评价内容'
 assert.equal(findEpisode([episode],report,'','')?.id,'portfolio')
 assert.equal(findEpisode([episode,{...episode,id:'other'}],report,'',''),null)
 assert.equal(findEpisode([episode],'如果接着作品集的事：导师回复了','',''),null)
})
import {taskPauseNeedsClarification} from '../server/user-command-spans.ts'
test('an unresolved deictic pause prevents implicit reopening under a renamed next-step request',()=>{
 assert.equal(taskPauseNeedsClarification('这个方向','帮我安排整理资料的下一步'),true)
 assert.equal(taskPauseNeedsClarification('老师邮件','接着老师邮件安排下一步'),true)
 assert.equal(taskPauseNeedsClarification('老师邮件','想讨论羽毛球'),false)
})
import {currentThemeProjection} from '../server/user-themes.ts'
test('legacy projection respects explicit pinning and rejects mixed theme identities',()=>{
 const a=fact('我喜欢打羽毛球'),b=fact('我喜欢写作')
 const theme={id:'t',title:'用户标题',kind:'valued_point' as const,status:'pending',origin:'user_stated',summary:'',pinned:false,revision:1,source_refs:[{growthItemId:a.id,quote:a.text},{growthItemId:b.id,quote:b.text}]}
 assert.equal(currentThemeProjection(theme,[a,b]),null)
 assert.equal(currentThemeProjection({...theme,pinned:true},[a,b])?.title,'用户标题')
 assert.equal(currentThemeProjection({...theme,pinned:true},[]),null,'pin does not restore unavailable facts')
 const episode={id:'e',source_quote:'我把实习作品集发给导师了，对方还没回复',content:{}}
 for(const report of ['接着导师的事：导师回复了','接着实习的事：导师回复了'])assert.equal(findEpisode([episode],report,'',''),null)
})
import {selectStructuralCandidate} from '../server/experience-content.ts'
test('a reported past shared activity and its feeling survive as an experience without business metrics',()=>{
 const text='我是成年大学生，昨晚和室友打羽毛球后觉得轻松。请从生活体验聊起，不要加付款、采用、效率评分或职业标签。'
 const selected=selectStructuralCandidate(text,buildClauseCatalogue(text),'2026-10-21T13:00:00Z')
 assert.ok(selected?.quote.includes('昨晚和室友打羽毛球后觉得轻松'))
 assert.ok(!selected?.quote.includes('不要加付款'))
 for(const text of ['我是学生，明天和室友打球后应该会轻松','我是学生，昨晚同学和室友打球后觉得轻松','如果昨晚和室友打球后觉得轻松'])assert.equal(selectStructuralCandidate(text,buildClauseCatalogue(text),'2026-10-21T13:00:00Z'),null)
})
test('invalid named identities cannot fall through and conflicting statuses ignore source order',()=>{
 const e={id:'e',source_quote:'我把实习作品集发给导师了，对方还没回复',content:{}}
 assert.equal(findEpisode([e],'接着导师的事：我把实习作品集发给导师了，对方还没回复','',''),null)
 const a=fact('我现在主要探索创业','goal'),b=fact('我探索创业','goal')
 const t={id:'t',title:'创业',kind:'exploration' as const,status:'active',origin:'user_stated',summary:'',pinned:false,revision:1,source_refs:[a,b].map(f=>({growthItemId:f.id,quote:f.text}))}
 assert.equal(currentThemeProjection(t,[a,b]),null)
 assert.equal(currentThemeProjection({...t,source_refs:[...t.source_refs].reverse()},[b,a]),null)
})
test('a negative reason does not erase a separately asserted positive pursuit',()=>{
 for(const quote of ['我不喜欢现在的工作，所以决定考研','我不喜欢现在的工作所以决定考研','我决定考研因为不喜欢现在的工作'])assert.equal(deriveThemeCandidates([fact(quote,'goal')])[0]?.title,'考研')
 const good=fact('我喜欢打羽毛球'),bad=fact('不要加付款')
 const theme={id:'t',title:'运动',kind:'valued_point' as const,status:'pending',origin:'user_stated',summary:'',pinned:false,revision:1,source_refs:[good,bad].map(f=>({growthItemId:f.id,quote:f.text}))}
 assert.equal(currentThemeProjection(theme,[good,bad]),null)
})
