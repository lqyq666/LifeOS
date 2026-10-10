import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Value} from 'typebox/value'
import { turnSystemPrompt } from '../../server/turn-prompt.ts'
import { actionCoachTurnSchema } from '../../server/action-coach-contracts.ts'
import { configureProviderPayload, outputTokenLimit } from '../../server/model-payload.ts'
import {buildClauseCatalogue} from '../../server/clause-catalogue.ts'

test('saved two-hour failure cannot select an unverifiable constraint; explicit windows stay paired to their own facts',()=>{
  const current='00000000-0000-4000-8000-000000000011',anchor='2026-10-10T12:00:00.000Z'
  const make=(text:string)=>{
    const clauses=buildClauseCatalogue(text)
    return (configureProviderPayload({},{provider:'bailian',id:'qwen3.8-flash'},'default',undefined,undefined,8192,current,[],[],0,false,undefined,false,clauses.map(c=>c.clauseId),false,{clauses,requestTimeUtc:anchor}) as any).response_format.json_schema.schema
  }
  const output=(kind:string,clauseId:string,timeEvidence?:unknown)=>({reply:'先核对汇报主题。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind,source:{clauseId},...(timeEvidence?{timeEvidence}:{})}]})
  const saved=make('我还有两小时准备明天的课堂汇报，先做哪一步？')
  assert.equal(Value.Check(saved,output('constraint','c0')),false,'actual failed kind is unrepresentable before generation')
  assert.equal(Value.Check(saved,output('context','c0')),true,'exact user effort amount stays representable without invented expiry')
  assert.equal(Value.Check(saved,output('constraint','c0',{kind:'duration',count:2,unit:'day',clauseId:'c0'})),false)
  for(const text of ['我每周有两小时','我最多能花两小时','我估计还有两小时','我现在没有时间','我这学期很忙']){
    assert.equal(Value.Check(make(text),output('constraint','c0')),false,text)
    assert.equal(Value.Check(make(text),output('context','c0')),true,text)
  }
  const mixed=make('我还有两小时做汇报。这周我能用六小时备考。')
  const week={kind:'calendar_week',which:'this',clauseId:'c1'}
  assert.equal(Value.Check(mixed,output('constraint','c0',week)),false,'another matter cannot lend its week window')
  assert.equal(Value.Check(mixed,output('constraint','c1',week)),true)
  assert.equal(Value.Check(mixed,output('constraint','c1',{...week,which:'next'})),false,'model cannot change stated period')
  assert.equal(Value.Check(mixed,output('constraint','c1')),false,'a verified constraint requires its actual evidence')
  const within=make('这周课程赶，只剩两小时。')
  assert.equal(Value.Check(within,output('constraint','c1',{kind:'calendar_week',which:'this',clauseId:'c0'})),true,'same-sentence calendar inheritance remains valid')
  const duration=make('接下来六周我只能投入两小时。')
  assert.equal(Value.Check(duration,output('constraint','c0',{kind:'duration',count:6,unit:'week',clauseId:'c0'})),true)
  assert.equal(Value.Check(duration,output('constraint','c0',{kind:'duration',count:8,unit:'week',clauseId:'c0'})),false)
  const expired=make('截至2026年9月1日我只能投入两小时。')
  assert.equal(Value.Check(expired,output('constraint','c0',{kind:'date_inclusive',date:'2026-09-01',clauseId:'c0'})),false,'a past date is not a current temporary constraint')
  assert.equal(Value.Check(expired,output('context','c0')),true)
})

test('immediate drafting requires an authoritative artifact while ordinary clarification remains possible',()=>{
  const current='00000000-0000-4000-8000-000000000011',eventId='00000000-0000-4000-8000-000000000021',profile={provider:'bailian',id:'qwen3.8-flash'}
  const make=(required:boolean)=>(configureProviderPayload({},profile,'default',undefined,undefined,8192,current,[{id:eventId,revision:3}],[],0,required) as any).response_format.json_schema.schema
  const ordinary=make(false),immediate=make(true),promise={reply:'好的，我会起草一段消息。'}
  assert.equal(Value.Check(ordinary,promise),true);assert.equal(Value.Check(immediate,promise),false)
  const target={operation:'continue',eventId,expectedRevision:3}
  assert.equal(Value.Check(immediate,{reply:'说明',event:{target}}),false)
  assert.equal(Value.Check(immediate,{reply:'说明',event:{target,action:{operation:'close',actionId:current,expectedRevision:1,reason:'结束'}}}),false)
  const delivery={reply:'下面是可用消息。',event:{target,action:{operation:'create',draft:{content:'你现在还需要哪一部分资料？'}}}}
  assert.equal(Value.Check(immediate,delivery),true)
  assert.equal(Value.Check(immediate,{...delivery,event:{...delivery.event,target:{...target,expectedRevision:4}}}),false)
  assert.equal(Value.Check(immediate,{...delivery,event:{...delivery.event,action:{operation:'create',draft:{content:''}}}}),false)
  assert.equal(Value.Check(ordinary,{reply:'邮件发给谁？'}),true)
})

test('saved invented continue target is excluded before generation while real targets and new events remain valid',()=>{
  const current='00000000-0000-4000-8000-000000000011',profile={provider:'bailian',id:'qwen3.8-flash'},original=JSON.stringify(actionCoachTurnSchema)
  const failure=JSON.parse(readFileSync('tests/fixtures/coach-invented-event.json','utf8'))
  const make=(targets?:{id:string;revision:number}[])=>((configureProviderPayload({},profile,'default',undefined,undefined,8192,current,targets) as any).response_format.json_schema.schema)
  assert.equal(Value.Check(make(),failure),true,'the previous unconstrained schema reproduced the saved failure')
  assert.equal(Value.Check(make([]),failure),false,'no existing event means no continue target')
  assert.equal(Value.Check(make([]),{reply:'只解释知识。'}),true)
  assert.equal(Value.Check(make([]),{reply:'新事情',event:{target:{operation:'create',title:'新事情',source:{messageId:current,quote:'新事情'}}}}),true)
  const first={id:'00000000-0000-4000-8000-000000000022',revision:2},second={id:'00000000-0000-4000-8000-000000000033',revision:3},bound=make([first,first,second])
  const output=(id:string,revision:number)=>({reply:'继续',event:{target:{operation:'continue',eventId:id,expectedRevision:revision}}})
  assert.equal(Value.Check(bound,output(first.id,2)),true);assert.equal(Value.Check(bound,output(second.id,3)),true)
  assert.equal(Value.Check(bound,output(first.id,3)),false,'id/revision pairs cannot be mixed')
  assert.equal(Value.Check(bound,output(current,1)),false,'a message ID is never an existing event ID')
  assert.equal(Value.Check(make([second]),output(first.id,2)),false,'another request cannot inherit authorization')
  assert.equal(JSON.stringify(actionCoachTurnSchema),original)
  assert.throws(()=>make([first,{...first,revision:3}]),/EVENT_TARGET_REVISION_AMBIGUOUS/)
})

test('each request binds every new process source to its own current message without changing quote or record references',()=>{
  const original=JSON.stringify(actionCoachTurnSchema),first='79c2145f-a7c1-485c-acee-827dfc5f8f39',second='00000000-0000-4000-8000-000000000012'
  for(const current of [first,second]){
    const payload=configureProviderPayload({}, {provider:'bailian',id:'qwen3.8-flash'},'default',undefined,undefined,8192,current) as any
    let bound=0
    function check(value:any){
      if(!value||typeof value!=='object')return
      if(value.properties?.messageId){bound++;assert.deepEqual(value.properties.messageId.enum,[current]);assert.equal(value.properties.messageId.enum.includes('79c2145f-a7c2-485c-acee-827dfc5f8f39'),false);assert.ok(value.properties.quote)}
      for(const item of Object.values(value))check(item)
    }
    check(payload.response_format.json_schema.schema);assert.ok(bound>=4,'event/background process sources stay identity-bound')
    // Fix 3: citations are a union — the preferred claimId branch has no enum
    // and never leaks request identities; the legacy branch keeps plain strings.
    assert.equal(payload.response_format.json_schema.schema.properties.citations.items.anyOf[0].properties.claimId.enum,undefined)
  }
  assert.equal(JSON.stringify(actionCoachTurnSchema),original,'global schema never acquires another request identity')
  assert.throws(()=>configureProviderPayload({}, {provider:'bailian',id:'qwen3.8-flash'},'default',undefined,undefined,8192,'not-a-source-id'),/CURRENT_MESSAGE_ID_INVALID/)
})

test('growth correct selects authorized items and clause handles only; dependencies bind exact id/revision pairs before generation',()=>{
  const current='00000000-0000-4000-8000-000000000011',first={id:'00000000-0000-4000-8000-000000000021',revision:2},second={id:'00000000-0000-4000-8000-000000000031',revision:3}
  const make=(refs:{id:string;revision:number}[],clauseIds?:string[])=>((configureProviderPayload({},{provider:'bailian',id:'qwen3.8-flash'},'default',undefined,undefined,8192,current,[],refs,undefined,false,undefined,false,clauseIds) as any).response_format.json_schema.schema)
  const create={target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}
  assert.equal(Value.Check(make([]),{reply:'记录明确情况',growthUpdates:[create]}),true)
  assert.equal(Value.Check(make([]),{reply:'旧协议自写引文不可表示',growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:current,quote:'每周三小时'}}]}),false,'the model cannot author quote text or message ids')
  assert.equal(Value.Check(make([]),{reply:'旧协议改写文本不可表示',growthUpdates:[{...create,text:'每周投入三小时'}]}),false,'user_reported text is derived by the server, so the native schema must not represent a free paraphrase')
  assert.equal(Value.Check(make([]),{reply:'旧协议replace不可表示',growthUpdates:[{...create,target:{operation:'replace',itemId:first.id,expectedRevision:first.revision}}]}),false,'the model never names an operation or a revision')
  const correct={...create,target:{operation:'correct',itemId:first.id}}
  assert.equal(Value.Check(make([]),{reply:'无授权目标',growthUpdates:[correct]}),false)
  assert.equal(Value.Check(make([first,second]),{reply:'更正',growthUpdates:[correct]}),true)
  assert.equal(Value.Check(make([first,second]),{reply:'未知条目',growthUpdates:[{...create,target:{operation:'correct',itemId:current}}]}),false)
  assert.equal(Value.Check(make([first,second],['c0','c1']),{reply:'更正',growthUpdates:[correct]}),true)
  assert.equal(Value.Check(make([first,second],['c0','c1']),{reply:'越界分句',growthUpdates:[{...create,source:{clauseId:'c9'}}]}),false,'clause handles outside the server catalogue are unrepresentable')
  const observation={target:{operation:'create'},kind:'observation',assertion:'ai_observation',text:'先缩小投入',source:create.source,dependencies:[first],limitation:'尚不清楚课程安排'}
  assert.equal(Value.Check(make([]),{reply:'没有本人依据',growthUpdates:[observation]}),false)
  assert.equal(Value.Check(make([first]),{reply:'待核对',growthUpdates:[observation]}),true)
  assert.equal(Value.Check(make([second]),{reply:'旧引用',growthUpdates:[observation]}),false)
  assert.throws(()=>make([first,{...first,revision:3}]),/GROWTH_TARGET_REVISION_AMBIGUOUS/)
})

test('reviewed Qwen alternatives retain strict source identity, no thinking and optional grounded growth updates',()=>{
  const current='00000000-0000-4000-8000-000000000011',other='00000000-0000-4000-8000-000000000012'
  for(const id of ['qwen3.8-flash','qwen3.8-max','qwen3.7-plus']){
    const payload=configureProviderPayload({model:id,max_tokens:4096,stream:true},{provider:'bailian',id},'default',undefined,undefined,8192,current,[]) as any
    assert.equal(payload.enable_thinking,false);assert.equal(payload.response_format.type,'json_schema');assert.equal(payload.response_format.json_schema.strict,true)
    assert.equal(payload.max_completion_tokens,8192);assert.equal(payload.max_tokens,undefined)
    const schema=payload.response_format.json_schema.schema
    const change={target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}
    assert.equal(Value.Check(schema,{reply:'从当前情况开始。',growthUpdates:[change]}),true)
    assert.equal(Value.Check(schema,{reply:'错误来源',growthUpdates:[{...change,source:{...change.source,clauseId:other}}]}),false)
    assert.equal(Value.Check(schema,{reply:'只聊聊。'}),true)
  }
})

test('explicit higher-thinking comparison caps total output, avoids conflicting effort parameters and defaults off',()=>{
  const profile={provider:'bailian',id:'qwen3.8-max'}
  const make=(budget:number,limit=8192)=>configureProviderPayload({reasoning_effort:'xhigh',thinking_budget:32768,max_tokens:4096},profile,'default',undefined,undefined,limit,undefined,undefined,undefined,budget) as any
  const thinking=make(2048)
  assert.equal(thinking.enable_thinking,true);assert.equal(thinking.thinking_budget,2048)
  assert.equal(thinking.max_completion_tokens,8192);assert.equal(thinking.max_tokens,undefined);assert.equal(thinking.reasoning_effort,undefined)
  const ordinary=make(0)
  assert.equal(ordinary.enable_thinking,false);assert.equal(ordinary.thinking_budget,undefined)
  for(const budget of [-1,4097,1.5,NaN])assert.throws(()=>make(budget),/QWEN_THINKING_BUDGET_INVALID/)
  assert.throws(()=>make(2048,2048),/QWEN_THINKING_BUDGET_INVALID/)
})

test('Qwen receives the natural reply contract without required planning or analysis objects',()=>{
  const payload=configureProviderPayload({model:'qwen3.8-flash',messages:[],stream:true,max_tokens:4096},{provider:'bailian',id:'qwen3.8-flash'},'default',undefined,undefined,8192) as any
  assert.equal(payload.enable_thinking,false)
  assert.equal(payload.temperature,0)
  assert.equal(payload.presence_penalty,0)
  assert.equal(payload.max_tokens,undefined);assert.equal(payload.max_completion_tokens,8192)
  assert.equal(payload.response_format.type,'json_schema');assert.equal(payload.response_format.json_schema.name,'lifeos_action_coach')
  const schema=payload.response_format.json_schema.schema
  assert.equal(payload.response_format.json_schema.strict,true)
  assert.deepEqual(schema.required,['reply']);assert.equal(schema.additionalProperties,false)
  for(const old of ['analysis','decision','escalation','campus'])assert.equal(schema.properties[old],undefined)
  assert.equal(schema.properties.event.properties.action.anyOf[0].properties.draft.anyOf[0].properties.content.maxLength,12000,'the legacy free-text draft keeps its bounds inside the draft union')
  assert.equal(schema.properties.reply.maxLength,16000)
  assert.equal(schema.properties.citations.items.anyOf[0].properties.claimId.type,'string')
  assert.equal(schema.properties.citations.items.anyOf[1].properties.sourceId.type,'string')
  assert.equal(JSON.stringify(payload).includes('~optional'),false)
})

test('repair uses the same contract and retains capacity for complete materials',()=>{
  const payload=configureProviderPayload({messages:[]},{provider:'bailian',id:'qwen3.8-flash'},'default',actionCoachTurnSchema,'lifeos_action_coach_repair',8192) as any
  assert.equal(payload.response_format.json_schema.name,'lifeos_action_coach_repair')
  assert.equal(payload.max_completion_tokens,8192)
  assert.deepEqual(payload.response_format.json_schema.schema.required,['reply'])
})

test('DeepSeek JSON mode enables bounded reasoning only for the reasoning tier',()=>{
  const profile={provider:'bailian',id:'deepseek-v4.1-flash'}
  const ordinary=configureProviderPayload({max_tokens:4096},profile,'default',undefined,undefined,8192) as any
  assert.equal(ordinary.enable_thinking,false);assert.equal(ordinary.reasoning_effort,undefined)
  const reasoning=configureProviderPayload({max_tokens:4096},profile,'reasoning',undefined,undefined,16384) as any
  assert.equal(reasoning.enable_thinking,true);assert.equal(reasoning.reasoning_effort,'low')
  assert.deepEqual(reasoning.response_format,{type:'json_object'})
  assert.equal(reasoning.max_tokens,undefined);assert.equal(reasoning.max_completion_tokens,16384)
  assert.equal(outputTokenLimit(profile,'reasoning'),16384)
  assert.equal(outputTokenLimit(profile,'default'),8192)
})

test('non-Bailian provider payloads retain their native transport options',()=>{
  const input={model:'glm-4-flash',messages:[],stream:true,max_tokens:4096}
  assert.strictEqual(configureProviderPayload(input,{provider:'zhipu',id:'glm-4-flash'},'default'),input)
})

test('JSON-object reasoning prompt includes the full current event and citation schema',()=>{
  const prompt=turnSystemPrompt('reasoning')
  const schema=JSON.parse(prompt.split('Schema：').at(-1)!)
  assert.deepEqual(schema,actionCoachTurnSchema)
  assert.deepEqual(schema.required,['reply'])
  assert.ok(schema.properties.event);assert.ok(schema.properties.citations)
  assert.equal(Object.hasOwn(schema.properties,'campus'),false)
})

test('growth-enabled native generation uses the personal growth lane while legacy parsing and experience confirmation remain available',()=>{
  const current='00000000-0000-4000-8000-000000000011'
  const source={messageId:current,quote:'我大三'}
  const native=(refs?:{id:string;revision:number}[])=>((configureProviderPayload({},{provider:'bailian',id:'qwen3.8-flash'},'default',undefined,undefined,8192,current,[],refs) as any).response_format.json_schema.schema)
  const legacy={reply:'保留当前阶段',background:[{key:'education.stage',value:'大三',source}]}
  assert.equal(Value.Check(native(),legacy),true,'the schema without growth authorization keeps its legacy protocol')
  assert.equal(Value.Check(native([]),legacy),false,'a growth-enabled request cannot divert personal facts into background')
  assert.equal(Value.Check(native([]),{reply:'保留当前阶段',growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]}),true)
  assert.equal(Value.Check(native([]),{reply:'候选经历仍需本人确认',experienceCandidate:{source:{clauseIds:['c0']}}}),true)
})

test('the existing DeepSeek default candidate carries the same full schema without thinking or extra calls',()=>{
  const prompt=turnSystemPrompt('default','deepseek-v4.1-flash')
  assert.deepEqual(JSON.parse(prompt.split('Schema：').at(-1)!),actionCoachTurnSchema)
  assert.equal(turnSystemPrompt('default','qwen3.8-flash').includes('Schema：'),false)
  const payload=configureProviderPayload({max_tokens:4096},{provider:'bailian',id:'deepseek-v4.1-flash'},'default',undefined,undefined,8192) as any
  assert.equal(payload.enable_thinking,false)
  assert.equal(payload.reasoning_effort,undefined)
  assert.deepEqual(payload.response_format,{type:'json_object'})
  assert.equal(payload.max_completion_tokens,8192)
})
