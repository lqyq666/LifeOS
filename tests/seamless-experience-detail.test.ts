import test from 'node:test'
import assert from 'node:assert/strict'
import {buildClauseCatalogue} from '../server/clause-catalogue.ts'
import {selectStructuralCandidate} from '../server/experience-content.ts'
import {linkExperienceToThemes} from '../server/user-themes.ts'
import {localEmbedding} from '../server/local-embedding.ts'

test('quiet extraction keeps the reported method, motivation and outcome without taking instructions or another event',()=>{
 const story='昨天我完成了课程传感器数据整理。我用老师提供的脚本绘图，标出了两处异常。因为这次我想弄清科研工作的具体过程。组员说标注方便检查接线，但数据还没有重新测量。'
 const text=story+'请记住经过，不要推断我已经有稳定科研能力。今天我参加了羽毛球活动。'
 const value=selectStructuralCandidate(text,buildClauseCatalogue(text),'2026-10-26T00:00:00Z')!
 assert.equal(value.quote,story.slice(0,-1))
 assert.ok(value.content.action.includes('老师提供的脚本'),'help and tool use must stay visible')
 assert.ok(value.content.result.includes('组员说标注方便检查接线'))
 assert.ok(value.content.result.includes('数据还没有重新测量'))
 assert.ok(!value.quote.includes('请记住'));assert.ok(!value.quote.includes('羽毛球'))
})

test('same-sentence method and negative result are retained, without merging a separate dated activity',()=>{
 const text='今天我核对了两份课程报告的引用出处，用课程给的检查表标出了两处遗漏。报告还没有交，老师还没有评价。上周我参加了社团活动。'
 const value=selectStructuralCandidate(text,buildClauseCatalogue(text),'2026-10-26T00:00:00Z')!
 assert.ok(value.content.action.includes('课程给的检查表'))
 assert.ok(value.content.result.includes('老师还没有评价'))
 assert.ok(!value.quote.includes('社团'))
})

test('future plans, instructions and global memory refusal never become extra experience detail',()=>{
 for(const tail of ['明天我打算联系导师。','请你帮我说明科研的意义。','如果这次成功，我就去创业。','另外我不想继续科研了。']){
  const first='昨天我核对了课程报告。',text=first+tail
  assert.equal(selectStructuralCandidate(text,buildClauseCatalogue(text),'2026-10-26T00:00:00Z')!.quote,first.slice(0,-1),tail)
 }
 const text='昨天我核对了课程报告。不修改档案、不创建任务或经历。'
 assert.equal(selectStructuralCandidate(text,buildClauseCatalogue(text),'2026-10-26T00:00:00Z'),null)
})

test('a similarity-only theme link stays tentative and explains its actual source',async t=>{
 t.mock.method(localEmbedding,'encode',async(texts:string[])=>texts.map(()=>[1,0]))
 const writes:any[]=[]
 const db={query:async(sql:string,values:any[])=>{if(sql.startsWith('SELECT'))return {rows:[{id:'theme',kind:'pursuit',title:'创造'}]};writes.push(values);return {rowCount:1}}}
 assert.equal(await linkExperienceToThemes(db as any,'synthetic-user','experience','昨天我整理了两份报告。结果还没有评价。',true),1)
 assert.equal(writes[0][3],'partial_evidence')
 assert.match(writes[0][4],/可能相关，尚未确认/)
 assert.ok(writes[0][4].includes('昨天我整理了两份报告'))
 assert.doesNotMatch(writes[0][4],/语义相关度|稳定能力/)
})
