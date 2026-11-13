import test from 'node:test'
import assert from 'node:assert/strict'
import {planExplicitExperienceSupplement} from '../server/experience-episodes.ts'

const facts='我本人已提供个人画像，要求继续对话测试并保留账号数据；本轮测试和工程操作由Codex代执行。演示视频还没有录制完成，真实学生使用效果和收入仍未知。'
const text='补充这次LifeOS演示准备的准确进展：'+facts+'请把这些进展更新到已有的LifeOS经历中，保留BodyMate和其他旧经历，不要创建任务，也不要把代执行记成我的个人技术成果。'
const episodes=[{id:'lifeos',source_quote:'LifeOS',content:{title:'LifeOS：从大学迷茫到AI成长伙伴',result:'已部署到公网。'}},{id:'bodymate',source_quote:'BodyMate',content:{title:'BodyMate产品实践',result:'结果未知'}}]
test('explicit existing-experience supplement carries all verbatim facts and agent attribution without a new action claim',()=>{
 const plan=planExplicitExperienceSupplement(text,episodes)
 assert.equal(plan?.experienceId,'lifeos')
 assert.equal(plan?.quote,facts)
 assert.equal(plan?.result,'已部署到公网。\n'+facts)
})

test('a named LifeOS record is distinct from a profile title merely mentioning LifeOS',()=>{
 const profile={id:'profile',source_quote:'个人画像',content:{title:'我已经把自己的完整个人画像提供给你，用来补齐LifeOS演示账号'}}
 assert.equal(planExplicitExperienceSupplement(text,[...episodes,profile])?.experienceId,'lifeos')
 assert.equal(planExplicitExperienceSupplement(text,[episodes[0]!,{...episodes[0]!,id:'second'}]),null)
})
test('supplement never chooses an ambiguous target or quoted, conditional, read-only or third-party facts',()=>{
 for(const input of ['如果'+text,'“'+text+'”','请读回已有的LifeOS经历，不要修改档案。','朋友说：'+facts+'请把这些进展更新到已有的LifeOS经历中。','如果我提供个人画像。请把这些进展更新到已有的LifeOS经历中。'])assert.equal(planExplicitExperienceSupplement(input,episodes),null,input)
 assert.equal(planExplicitExperienceSupplement(text,[...episodes,{...episodes[0]!,id:'another'}]),null)
 assert.equal(planExplicitExperienceSupplement(text,[episodes[1]!]),null)
  assert.equal(planExplicitExperienceSupplement(text+'先不要保存或修改档案。',episodes),null)
 assert.equal(planExplicitExperienceSupplement('我已提供画像。不要把这些进展更新到已有的LifeOS经历中。',episodes),null)
})
