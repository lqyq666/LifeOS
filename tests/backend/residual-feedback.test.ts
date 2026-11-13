import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {residualHarness} from '../fixtures/residual-turn-harness.ts'

test('R06 feedback keeps reported polarity, absence and uncertainty; corrections never restore old badges',async t=>{
 const h=await residualHarness()
 try{
  const cases=[
   ['我交了课程作业，没有收到导师评价。',false,'none'],
   ['我交了课程作业，我还没有被表扬。',false,'none'],
   ['我交了课程作业，我不知道导师有没有评价。',false,'unknown'],
   ['我交了课程作业，助教说这次作业写得很好。',true,'positive'],
   ['我交了课程作业，辅导员反馈活动安排很清楚。',true,'positive'],
   ['我交了课程作业，导师批评了我的论证不充分。',true,'negative'],
  ] as const
  for(const [text,expected,status] of cases)await t.test(text,async()=>{
   const {user,chat}=await h.account();await h.execute(user,chat,text)
   const node=(await store.cognitionGraph(user)).nodes.find((n:any)=>n.type==='experience') as any
   assert.ok(node);assert.equal(node.externalFeedback,expected)
   assert.equal(node.feedbackEvidence.status,status)
   if(!expected)assert.ok(!node.insight.headline.includes('有外部反馈'))
  })
  await t.test('versioned no-feedback correction survives graph refresh and new-context read',async()=>{
   const {user,chat}=await h.account();await h.execute(user,chat,'我完成了海报设计，导师夸了我。')
   const record=(await store.listExperiences(user))[0]!
   await h.execute(user,chat,'我上周交了英语课程总结。')
   const other=(await store.listExperiences(user)).find(row=>row.id!==record.id)!
   await pool.query("INSERT INTO experience_relations(user_id,from_experience,to_experience,relation,score,reason) VALUES($1,$2,$3,'similar',0.8,'synthetic existing relation') ON CONFLICT DO NOTHING",[user,other.id,record.id])
   assert.equal(((await store.cognitionGraph(user)).nodes.find((n:any)=>n.id==='exp-'+record.id) as any).externalFeedback,true)
   await store.experienceAction(user,record.id,{requestId:randomUUID(),expectedRevision:record.revision,action:'correct',content:{summary:record.content.summary,result:'没有收到导师评价。'}})
   for(let refresh=0;refresh<2;refresh++){
    const graph=await store.cognitionGraph(user),node=graph.nodes.find((n:any)=>n.id==='exp-'+record.id) as any
    assert.equal(node.externalFeedback,false);assert.equal(node.feedbackEvidence.status,'none')
    assert.ok(!node.insight.headline.includes('有外部反馈'))
    assert.ok(![node.title,node.summary,node.result,node.experienceSummary?.result].some(value=>String(value??'').includes('导师夸了我')),'old feedback is not a current detail field')
    const related=(graph.nodes.find((n:any)=>n.id==='exp-'+other.id) as any).insight.relatedTitles
    assert.ok(related.includes(node.title));assert.ok(!related.some((title:string)=>title.includes('导师夸了我')))
   }
   const fresh=randomUUID();await store.createConversation(user,{id:fresh,title:'SYNTHETIC corrected feedback'})
   await h.execute(user,fresh,'只依据当前有效记录说明我是否收到评价，不要保存档案。',{},'你本人已更正为没有收到导师评价；不能保留旧的表扬结论。')
   assert.ok(!JSON.stringify(h.requests.at(-1).messages).includes('导师夸了我'))
  })
 }finally{await h.close()}
})
