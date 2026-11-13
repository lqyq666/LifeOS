import test from 'node:test'
import assert from 'node:assert/strict'
import * as store from '../../server/store.ts'
import {personalUnderstanding} from '../../server/personal-understanding.ts'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'

test('R05 skill evidence follows performed personal contribution rather than task vocabulary',async t=>{
 const h=await residualHarness()
 try{
  const cases=[
   {text:'我交了海报，但设计是室友做的，我只负责打印，没有收到导师评价。',absent:['设计','组织协调'],present:[]},
   {text:'我完成了海报，但室友设计了布局，我只负责打印。',absent:['设计','组织协调'],present:[]},
   {text:'我参加了活动，没有做设计、编程或者科研。',absent:['设计','编程','科研','组织协调'],present:[]},
   {text:'我完成了Java入门作业，还不会数据分析。',absent:['数据分析','写作'],present:['编程']},
   {text:'我完成了社团海报的设计。',absent:['组织协调'],present:['设计']},
   {text:'我完成了Python爬虫开发。',absent:['写作','数据分析'],present:['编程']},
  ]
  for(const item of cases)await t.test(item.text,async()=>{
   const {user,chat}=await h.account();await h.execute(user,chat,item.text)
   const graph=await store.cognitionGraph(user),nodes=graph.nodes.filter((n:any)=>n.type==='experience') as any[]
   assert.ok(nodes.length,'actual saved experience is exercised')
   const tags=new Set(nodes.flatMap(n=>n.skillTags??[]))
   const understanding=await personalUnderstanding(user,chat),profileTags=new Set(understanding.skills.map(s=>s.tag))
   for(const tag of item.absent){assert.ok(!tags.has(tag),tag+' is not personal evidence');assert.ok(!profileTags.has(tag))}
   for(const tag of item.present){assert.ok(tags.has(tag),tag+' has performed personal evidence');assert.ok(profileTags.has(tag))}
  })
 }finally{await h.close()}
})
