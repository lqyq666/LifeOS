import test from 'node:test'
import assert from 'node:assert/strict'
import {pool} from '../../server/db.ts'
import {timeBudget} from '../../server/workflows/task-sources.ts'
import {applicableTimeBudget} from '../../server/turn-obligations.ts'
import {reconcileActionStages} from '../../server/workflows/action-review.ts'
import {providerTurnMessages} from '../../server/turn-prompt.ts'
test.after(()=>pool.end())
const waiting={period:'this_week' as const,question:'本人本周可用或剩余时间',anchor:'2026-10-10T07:00:00.000Z'}
const cases:[string,number|null,string?,boolean?][]=[
 ['我每周能拿出六小时，但这周只剩两小时',120],
 ['这周只剩两小时，我每周能拿出六小时',120],
 ['我每周能拿出六小时，但这周只剩两小时，帮我安排下周',360,'next_week'],
 ['这周六小时，更正一下，其实这周只剩两小时',120],
 ['这周六小时，这周两小时',null],
 ['这周零小时',0],['这周没空',0],['这周1分钟',1],['这周2分钟',2],['这周3分钟',3],['这周4分钟',4],
 ['下周我有六小时可用',360,'next_week'],['下周六小时',360,'next_week'],
 ['六小时',null],['六小时',360,'this_week',true],['大概六小时',360,'this_week',true],['最多六小时',360,'this_week',true],
 ['其实只剩两小时',120,'this_week',true],['下周六小时，这周没空',0,'this_week',true],
 ['大概两小时吧，还是刚才这两条路。',120,'this_week',true],
 ['最多一小时呀，继续刚才的问题。',60,'this_week',true],
 ['两小时吧',null],['同学大概两小时吧',null,undefined,true],
 ['如果有两小时吧',null,undefined,true],['两小时吧？',null,undefined,true],
 ['我还算不准',null,undefined,true],['先别分析了，六小时',null,undefined,true],
 ['我已经做了六小时兼职',null,undefined,true],['同学有六小时',null,undefined,true],['如果有六小时',null,undefined,true],
 ['六',null,undefined,true],['这周六到八小时',null],['这周至少六小时',null],['这周不是六小时',null],
 ['这周六小时吗？',null],['“这周六小时”',null],['`这周六小时`',null],
 ['实习要求我每周投入六小时',null],['这周已花六小时，剩两小时',120],
 ['我每周有六小时，下周两小时，帮我安排下周',120,'next_week'],
 ['下周两小时，这周六小时，帮我安排本周',360],['这周0.01小时',null],['我这周零小时可用',0],['岗位要求，接着每周六小时',null],['下周同学有六小时',null],
]
for(const [index,[text,minutes,period,context]] of cases.entries())test('time '+index+': '+text,()=>{
 const budget=timeBudget(text,context?waiting:undefined)
 if(minutes===null)assert.equal(budget,undefined)
 else {assert.equal(budget?.amountMinutes,minutes);assert.equal(budget?.period,period??'this_week')}
})
test('the actual provider wire keeps authoritative clause handles for growth and time evidence',()=>{
 const wire=providerTurnMessages(JSON.stringify({requestTimeUtc:waiting.anchor,currentUserMessage:{id:'test',role:'user',text:'这周只剩两小时',clauses:[{id:'c0',text:'这周只剩两小时'}]},messages:[]}),{provider:'synthetic',id:'synthetic'})
 assert.deepEqual(JSON.parse(wire[0].content as string).currentUserMessage.clauses,[{id:'c0',text:'这周只剩两小时'}])
})
test('estimates, upper bounds and scoped remainder retain provenance rather than exactness',()=>{
 assert.equal(applicableTimeBudget('大概六小时',waiting)?.qualification,'estimate')
 assert.equal(applicableTimeBudget('最多六小时',waiting)?.qualification,'upper_bound')
 assert.equal(applicableTimeBudget('我每周六小时，这周剩两小时')?.scope,'remaining')
})

test('reverse-word-order explicit unknown replaces the previous use denial, while reply and sent remain',()=>{
 const before={sent:true,read:true,replied:false,used:false,effect:null}
 assert.deepEqual(reconcileActionStages(before,'我更正，对方是否采用我不知道。'),{...before,used:null})
 for(const text of ['同学说对方是否采用我不知道','如果对方是否采用我不知道','“对方是否采用我不知道”'])assert.deepEqual(reconcileActionStages(before,text),before)
})
