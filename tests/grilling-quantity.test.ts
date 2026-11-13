import test from 'node:test'
import assert from 'node:assert/strict'
import {enforceReportedQuantity} from '../server/reply-draft.ts'
test('a single requested JD keeps the exploration and its referenced stopping count aligned',()=>{
 const request='我愿意只了解一个远程岗位的真实工作节奏，给一个小行动。'
 const raw='选一个远程岗位，读3份该岗位的JD，只记录工作时间。投入上限30分钟，读完3份就停。'
 const result=enforceReportedQuantity(raw,request)!
 assert.match(result,/读一个该岗位的JD/);assert.match(result,/读完这份就停/)
 assert.match(result,/投入上限30分钟/)
 assert.equal(enforceReportedQuantity('先读一份JD，再看完3篇研究摘要就停。',request),null,'unrelated stopping counts are not rewritten')
})
