import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {comparisonUniverseAccepts,deriveTurnContract,bindRequestedSummarySchema} from '../server/turn-contract.ts'
const actual=JSON.parse(readFileSync(new URL('./fixtures/ns-negated-comparison-failure.json',import.meta.url),'utf8'))

test('actual NS negated exclusivity is accepted without rewriting its useful comparison',()=>{
 assert.equal(comparisonUniverseAccepts(actual.raw.reply,actual.user),true)
 assert.equal(comparisonUniverseAccepts(actual.raw.reply.replace('不声称','声称'),actual.user),false,'removing the negation restores an unsupported closed-universe claim')
})

test('ordinary summaries stay concise while detailed and one-sentence requests retain their contracts',()=>{
 const schema=(text:string)=>bindRequestedSummarySchema(deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),text).schema.properties as any
 assert.equal(schema('请更新当前理解和仍未知的地方。').reply.maxLength,100)
 assert.equal(schema('请详细说明当前理解和仍未知的地方。').reply.maxLength,16000)
 assert.equal(schema('用一句话说明当前理解和仍未知的地方。').reply.maxLength,240)
})
test('assertion polarity stays separate from missing resources and each later clause',()=>{
 for(const reply of ['不会主张只有这两种探索方式。','没有说只有这两种探索方式。','未曾断言只有这两种探索方式。','不要说只有这两种探索方式。','不必宣称只有这两种探索方式。'])assert.equal(comparisonUniverseAccepts(reply,actual.user),true,reply)
 for(const reply of ['没有客户所以只有这两种探索方式。','不声称只有这两种，但实际上只有这两种探索方式。','不声称只有两种而只有这两种探索方式。','我不声称还有更多选项因为只有这两种探索方式可行。','我不声称还有更多选项由于只有这两种探索方式可行。','我不声称还有更多选项可是只有这两种探索方式可行。','我不声称还有更多选项反倒只有这两种探索方式可行。'])assert.equal(comparisonUniverseAccepts(reply,actual.user),false,reply)
 assert.equal(comparisonUniverseAccepts('只有这两种探索方式。','我这里可选的探索方式只有这两种。'),true,'an explicitly closed source universe is still allowed')
 assert.equal(comparisonUniverseAccepts('只有这两种探索方式。','我没有声称可选的探索方式只有这两种。'),false,'negated source wording does not close the universe')
})
