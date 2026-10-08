import test from 'node:test'
import assert from 'node:assert/strict'
import { reportsPersonalEvent, deriveTurnContract } from '../../server/turn-contract.ts'

test('G2: first-person experience reports open the event lane; questions/third-party/hypothetical/quoted do not',()=>{
  const positives=[
    '我做过一次社团招新项目。',
    '我投过两个实习。',
    '我整理过导师的文献。',
    '我帮过学长做访谈。',
    '我参加过一次商业比赛。',
    '上周我给社团交了海报，他们没用上。',
    '导师说我标注做得仔细。',
  ]
  for(const text of positives){
    assert.equal(reportsPersonalEvent(text),true,JSON.stringify(text))
    const contract=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
    assert.equal(contract.capabilities.event,true,'event lane open: '+text)
    assert.notEqual(contract.mode,'reply_only','never reply_only: '+text)
    assert.equal(contract.capabilities.growth,true,'facts can persist: '+text)
  }
  const negatives=[
    '你做过类似项目吗？',
    '做过这件事的人一般怎么想？',
    '学长说他做过这个。',
    '如果我以后做过这种项目呢？',
    '“我做过项目”这句话是什么意思？',
    '我想找老师聊聊科研入门，但不知道怎么开口。',
  ]
  for(const text of negatives){
    assert.equal(reportsPersonalEvent(text),false,'not a personal report: '+JSON.stringify(text))
  }
  // Third-party or hypothetical presence must not leak the lane via a mixed
  // message whose only report clause belongs to someone else / a hypothesis.
  const contract=deriveTurnContract({text:'学长说他做过这个。',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
  assert.equal(contract.capabilities.event,false,'third-party report does not open the event lane')
  const quoted=deriveTurnContract({text:'“我做过项目”这句话是什么意思？',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
  assert.equal(quoted.capabilities.event,false,'quoted report does not open the event lane')
})
