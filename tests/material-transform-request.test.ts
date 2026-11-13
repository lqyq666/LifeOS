import test from 'node:test'
import assert from 'node:assert/strict'
import {deliverableIntent,requiresImmediateMaterial,requestsMaterialRewrite} from '../server/action-coach-events.ts'
import {deriveTurnContract,bindMaterialDeliverySchema} from '../server/turn-contract.ts'

test('read-only explanatory prose does not open a discarded artifact workspace',()=>{
 for(const noun of ['说明','分析','解释','比较']){
  const text=`请写一份完整、可读的${noun}：大学生如何比较几条道路。这只是分析，不修改档案，不创建任务或经历。`
  const material=deliverableIntent(text,'create')
  assert.equal(material,false)
  const contract=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material})
  assert.deepEqual(Object.keys(contract.schema.properties),['lead','reply'])
 }
 for(const text of ['请写一份发给导师的说明，不修改档案。','请写一份情况说明，不修改档案。','请写一份分析报告，不修改档案。','请写一份说明书，不修改档案。'])assert.equal(deliverableIntent(text,'create'),true,text)
 assert.equal(deliverableIntent('请写一份说明：我为什么迟交作业。','create'),true,'unscoped material requests retain their original protocol')
})
test('the observed explicit rewrite requires a committed material instead of prose alone',()=>{
 const text='把刚才的本人贡献描述改成一句更短的第一人称，保留资料整理和排版，不添加其他技能，也不要发送。'
 assert.equal(deliverableIntent(text,'create'),true)
 assert.equal(requiresImmediateMaterial(text),true)
 for(const verb of ['改成','压成','写成'])assert.equal(requestsMaterialRewrite('把刚才的本人贡献描述'+verb+'一句更短的第一人称。'),true,verb)
 assert.equal(requestsMaterialRewrite('把本人贡献写成一句简历描述。'),false,'a new unbound contribution still uses grounded selection')
 const contract=bindMaterialDeliverySchema(deriveTurnContract({text,knowledgeCount:0,currentEventExists:true,planIntent:false,material:true}),text,false,true)
 assert.ok((contract.schema.required as string[]).includes('event'))
 for(const text of ['不要把刚才的本人贡献描述改成一句。','“把刚才的本人贡献描述改成一句”。','如果把刚才的本人贡献描述改成一句会怎样？','朋友说把刚才的本人贡献描述改成一句。'])assert.equal(requiresImmediateMaterial(text),false,text)
 for(const text of ['我想把考研改成一段时间后再考虑。','把本人贡献描述改成一段时间后再考虑。'])assert.equal(requiresImmediateMaterial(text),false,text)
})
