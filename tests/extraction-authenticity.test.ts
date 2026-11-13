import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveThemeCandidates } from '../server/user-themes.ts'
import { buildClauseCatalogue } from '../server/clause-catalogue.ts'
import { selectStructuralCandidate,selectStructuralCandidates } from '../server/experience-content.ts'
import { deriveIdentityClaims } from '../server/identity.ts'
import { reportedPreferenceClauses,reportedEvidenceFromText } from '../server/turn-contract.ts'
import { readbackRequestClause,assistantRequestClause,profileWritesDisallowed,scanUserClauses,assistantInstructionClause } from '../server/user-command-spans.ts'

const fact=(text:string,kind='goal')=>({id:'synthetic-source',kind,text,assertion:'user_reported',status:'active'})
test('past consideration before final choice never becomes the current main path',()=>{
 const rows=deriveThemeCandidates([fact('我考虑过考研，但最后决定先就业。')])
 assert.deepEqual(rows.map(x=>x.title),['就业'])
 assert.ok(rows.every(x=>x.quote.includes('决定先就业')))
})
test('concrete goal retains location, object and outcome instead of broad path name',()=>{
 const rows=deriveThemeCandidates([fact('我想找到成都的数据分析实习。')])
 assert.equal(rows[0]?.title,'找到成都的数据分析实习')
})
test('attempted contact is action evidence, unreturned response stays negative',()=>{
 const text='我尝试联系了学长，但对方没有回复。'
 const candidate=selectStructuralCandidate(text,buildClauseCatalogue(text),'2026-10-26T00:00:00Z')
 assert.ok(candidate);assert.equal(candidate.content.action,'我尝试联系了学长');assert.equal(candidate.content.result,'但对方没有回复')
 assert.ok(text.includes(candidate.quote))
})
test('hypothetical, third-party and conversation-only statements do not create personal goals or identity',()=>{
 for(const text of ['如果我以后去创业……','同学说他准备考研。','我只想聊聊，不要安排目标和行动。']){
  assert.deepEqual(deriveThemeCandidates([fact(text)]),[],text)
  assert.deepEqual(deriveIdentityClaims([fact(text)]),[],text)
  assert.deepEqual(selectStructuralCandidates(text,buildClauseCatalogue(text),'2026-10-26T00:00:00Z'),[],text)
 }
 assert.deepEqual(deriveIdentityClaims([fact('我做过一次海报。','experience')]),[])
})
test('long colloquial background does not hide a completed action or negative ending at the tail',()=>{
 const text='这次的背景比较多。'.repeat(220)+'昨天我交了社团海报，但对方没有回复。'
 const rows=selectStructuralCandidates(text,buildClauseCatalogue(text),'2026-10-26T00:00:00Z')
 assert.equal(rows.length,1);assert.equal(rows[0]?.content.result,'但对方没有回复');assert.ok(rows[0]!.start>1500)
})
test('separate past episodes retain each exact source, including the final sentence',()=>{
 const text='我昨天交了社团海报。上周我还参加过英语角，感觉更敢开口了。'
 const rows=selectStructuralCandidates(text,buildClauseCatalogue(text),'2026-10-26T00:00:00Z')
 assert.equal(rows.length,2);assert.ok(rows[1]!.quote.includes('感觉更敢开口了'))
 for(const row of rows)assert.equal(text.slice(row.start,row.end),row.quote)
})
test('negative preference and conditional willingness both survive the contrast',()=>{
 const text='我不喜欢公开演讲，但愿意在小组内表达。'
 assert.deepEqual(reportedPreferenceClauses(text).map(c=>c.text),['我不喜欢公开演讲','但愿意在小组内表达'])
 assert.equal(reportedEvidenceFromText(text).preferences[1]?.modality,'willing')
})
test('domain keywords do not invent an educational or career path',()=>{
 for(const [text,title] of [['我想学编程。','学编程'],['我想复习专业课。','复习专业课'],['我想提高绩点。','提高绩点']]){
  assert.equal(deriveThemeCandidates([fact(text!)])[0]?.title,title)
 }
})
test('historical consideration is not an open current exploration',()=>{
 assert.deepEqual(deriveThemeCandidates([fact('我考虑过考研')]),[])
 assert.equal(deriveThemeCandidates([fact('我现在还在考虑考研')])[0]?.status,'pending')
})
test('a later third-party completion never becomes another personal episode',()=>{
 const text='我昨天交了社团海报。后来同学说他交了课程作业。'
 const rows=selectStructuralCandidates(text,buildClauseCatalogue(text),'2026-10-26T00:00:00Z')
 assert.equal(rows.length,1);assert.equal(rows[0]?.quote,'我昨天交了社团海报')
})
test('TA response readback preserves reported polarity and uncertainty without inventing other stages',()=>{
 for(const actor of ['助教','课程助教']){
  const no=reportedEvidenceFromText(actor+'还未回复。').participants;
  assert.equal(no.length,1);assert.equal(no[0]?.states.response.status,'reported_no_response');assert.equal(no[0]?.states.read.status,'unknown');
  assert.equal(reportedEvidenceFromText(actor+'已明确回复。').participants[0]?.states.response.status,'reported_response');
  assert.equal(reportedEvidenceFromText(actor+'是否回复我还不知道。').participants[0]?.states.response.status,'unknown');
  for(const text of ['如果'+actor+'回复了……','“'+actor+'已经回复”这句话只是示例。'])assert.deepEqual(reportedEvidenceFromText(text).participants,[]);
 }
})
test('saved-record recall understands source-basis modifiers and past-time subjects without becoming a new contact plan',()=>{
 for(const text of ['说明我上周联系的是谁','只依据现在有效的已保存记录说明我上周联系的是谁','请只根据当前有效记录说明我之前做过什么','请从你已经保存的资料里简短说出：我的学校']){
  assert.equal(readbackRequestClause(text),true,text);assert.equal(assistantRequestClause(text),true,text)
 }
 for(const text of ['请根据你保存的资料说出我应该选哪个工作','请根据记录说明我接下来适合做什么','我上周联系的是课程助教'])assert.equal(readbackRequestClause(text),false,text)
})
test('compound no-save commands and analysis enumerations remain instructions rather than personal facts',()=>{
 for(const text of ['不要创建或修改档案、经历、计划或任务。','不要新增或修改档案、经历、长期记忆。','不要记录我的个人经历。'])assert.equal(profileWritesDisallowed(text),true,text)
 for(const text of ['不要创建任务。','“不要修改档案”只是示例，我昨天交了作业。','同学说不要修改档案。','如果我说不要创建或修改档案呢？'])assert.equal(profileWritesDisallowed(text),false,text)
 const text='请展开约1500字的连贯分析：先回读各项事实及本人原话，再逐项区分意愿、实际行动、他人回应和仍未知的原因，解释一次实践为何不能证明稳定能力。',clauses=scanUserClauses(text)
 for(const c of clauses)assert.equal(assistantInstructionClause(text,c,clauses),true,c.text)
 assert.equal(assistantRequestClause('我再逐项区分了访谈原话和自己的判断'),false)
  for(const text of ['是否已经回复','再结合我明确的实习目标与表达意愿给出有依据的判断'])assert.equal(assistantRequestClause(text),true,text)
  assert.equal(assistantRequestClause('是否已经回复我还不知道'),false)
  const recall='只依据现在有效的已保存记录，说明我上周联系的是谁、对方是否回复',recallClauses=scanUserClauses(recall)
  for(const c of recallClauses)assert.equal(assistantInstructionClause(recall,c,recallClauses),true,c.text)
})
