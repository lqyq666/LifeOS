import test from 'node:test'
import assert from 'node:assert/strict'
import {safeEarlySentence} from '../server/reply-draft.ts'

test('real six-chain speculative causes and uncommitted write claims never become visible previews',()=>{
  const samples=[
    {user:'我不确定是运动本身还是室友带来的。请给暂定理解。',lead:'这更像室友的相处方式而非羽毛球本身。'},
    {user:'我先定了三条分类规则，后来同学少问了一次。',lead:'说明提前给结构能减少沟通往返。'},
    {user:'我先定了三条分类规则，后来同学少问了一次。',lead:'这次你定三条分类规则后，同学直接找到两份材料并少问一次，说明提前给结构能减少沟通往返。'},
    {user:'“我喜欢销售”不是我确认的标签。请删除并不要重新推导。',lead:'已撤除“我喜欢销售”这个未经你确认的标签。'},
    {user:'停止推荐公众号那件事，同时保留事实。',lead:'已停止推荐公众号那件事。'},
    {user:'停止推荐公众号那件事，同时保留事实。',lead:'不再推荐公众号那件事。'},
    {user:'停止推荐公众号那件事，同时保留事实。',lead:'这条记录会保留，但不再主动推荐相关事项。'},
    {user:'停止推荐公众号那件事，同时保留事实。',lead:'不会再推荐公众号那件事。'},
  ]
  for(const sample of samples)assert.equal(safeEarlySentence(JSON.stringify({lead:sample.lead}),120,'lead',sample.user),null,sample.lead)
  assert.equal(safeEarlySentence(JSON.stringify({lead:'这仍不能说明原因。'}),120,'lead','原因仍未知。'),'这仍不能说明原因')
  assert.equal(safeEarlySentence(JSON.stringify({reply:'你当时最想改变哪个环节？'})), '你当时最想改变哪个环节')
})
