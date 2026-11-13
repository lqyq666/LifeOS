import test from 'node:test'
import assert from 'node:assert/strict'
import {deriveTurnContract} from '../server/turn-contract.ts'
const derive=(text:string,extra:Record<string,unknown>={})=>deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,...extra})
test('explicit discussion permissions remove only writes the host already forbids',()=>{
 const c=derive('请结合我的背景给一些建议。不修改档案，不创建任务或经历。')
 assert.equal(c.capabilities.growth,false);assert.equal(c.capabilities.event,false)
 assert.deepEqual(Object.keys((c.schema as any).properties),['lead','reply'])
 assert.equal((c.schema as any).properties.reply.maxLength,16000)
})
test('ordinary real facts and quoted or conditional permissions retain their lanes',()=>{
 for(const text of ['我昨天完成了一份课程作品，想复盘这段经历。','请解释“不修改档案”这句按钮提示。','如果我说不修改档案，你会怎么处理？']){
  const c=derive(text);assert.equal(c.capabilities.growth,true,text);assert.equal(c.capabilities.event,true,text)
 }
})
test('explicit material, planning and approved citations are not silently closed',()=>{
 assert.equal(derive('不修改档案，只给我一份可以复制的邮件。',{material:true}).capabilities.material,true)
 assert.equal(derive('不修改档案，给我这周的安排。',{planIntent:true}).capabilities.plan,true)
 const c=derive('不修改档案，参考资料给我分析。',{knowledgeCount:1,knowledgeIds:['method-1'],requiredKnowledgeCitation:true})
 assert.equal(c.capabilities.citations,true);assert.ok((c.schema as any).properties.citations)
})
