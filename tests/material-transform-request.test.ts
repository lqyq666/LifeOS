import test from 'node:test'
import assert from 'node:assert/strict'
import {deliverableIntent,requiresImmediateMaterial,requestsMaterialRewrite} from '../server/action-coach-events.ts'
import {deriveTurnContract,bindMaterialDeliverySchema} from '../server/turn-contract.ts'
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
