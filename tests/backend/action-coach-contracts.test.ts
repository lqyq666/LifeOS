import test from 'node:test'
import assert from 'node:assert/strict'
import { Value } from 'typebox/value'
import { actionCoachTurnSchema, parseActionCoachTurn } from '../../server/action-coach-contracts.ts'

const id='00000000-0000-4000-8000-000000000001'
const source={messageId:id,quote:'对方说手机打不开。'}

test('rejection diagnostics identify the failed contract without recording model data',()=>{
  const diagnostics:unknown[]=[]
  const options={onRejection:(diagnostic:unknown)=>diagnostics.push(diagnostic)}
  const secret='PRIVATE_MODEL_TEXT_123'
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:42,[secret]:secret}),options))
  const schemaDiagnostic=diagnostics.pop() as {stage:string;issues:{keyword:string;schemaPath:string}[]}
  assert.equal(schemaDiagnostic.stage,'schema')
  assert.ok(schemaDiagnostic.issues.some(issue=>issue.keyword==='type'&&issue.schemaPath==='#/properties/reply'))
  assert.equal(JSON.stringify(schemaDiagnostic).includes(secret),false)
  assert.ok(schemaDiagnostic.issues.every(issue=>Object.keys(issue).sort().join(',')==='keyword,schemaPath'))
  assert.throws(()=>parseActionCoachTurn('{"reply":"'+secret,options))
  assert.deepEqual(diagnostics.pop(),{stage:'json'})
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:secret,event:{action:{draft:{fromReply:false}}}}),options))
  assert.deepEqual(diagnostics.pop(),{stage:'draft_reference'})
  assert.deepEqual(parseActionCoachTurn(JSON.stringify({reply:secret}),options),{reply:secret})
  assert.equal(diagnostics.length,0)
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:secret,...Object.fromEntries(Array.from({length:30},(_,i)=>['unknown'+i,secret]))}),options))
  assert.ok((diagnostics.pop() as {issues:unknown[]}).issues.length<=8)
})

test('listening and knowledge replies require no plan, background, hypothesis or event',()=>{
  assert.deepEqual(parseActionCoachTurn(JSON.stringify({reply:'可以，今天先不复盘。你想说什么，我在听。'})),{reply:'可以，今天先不复盘。你想说什么，我在听。'})
})

test('full materials survive transport instead of short card-field substitutions',()=>{
  const content='这是需要完整交付的材料。'.repeat(400)
  const output={reply:content,event:{target:{operation:'create',title:'交付后的反馈',source},nodes:[{kind:'fact',source},{kind:'unknown',question:'对方现在是否还需要这份资料？'}],action:{operation:'create',draft:{content}}}}
  const parsed=parseActionCoachTurn(JSON.stringify(output))
  assert.equal(parsed.reply,content)
  assert.equal(parsed.event?.action?.operation,'create')
  assert.ok(Value.Check(actionCoachTurnSchema,output))
})

test('new records cannot carry model-created identities, ownership or execution claims',()=>{
  const output={reply:'这是草稿。',event:{target:{operation:'create',title:'事件',source},action:{operation:'create',draft:{content:'一段可以复制的消息'}}}}
  assert.equal(Value.Check(actionCoachTurnSchema,output),true)
  for(const injected of [{...output,userId:'another-user'}, {...output,event:{...output.event,target:{...output.event.target,eventId:id}}}, {...output,event:{...output.event,action:{...output.event.action,status:'executed'}}}]){
    assert.equal(Value.Check(actionCoachTurnSchema,injected),false)
  }
})

test('modification, reuse and closure name one exact versioned action; missing facts remain unknown',()=>{
  const base={reply:'沿用这个草稿。',event:{target:{operation:'continue',eventId:id,expectedRevision:2},nodes:[{kind:'unknown',question:'收到后有没有打开仍未确认。'}]}}
  assert.equal(Value.Check(actionCoachTurnSchema,{...base,event:{...base.event,action:{operation:'reuse',actionId:id,expectedRevision:3}}}),true)
  assert.equal(Value.Check(actionCoachTurnSchema,{...base,event:{...base.event,action:{operation:'reuse',actionId:id}}}),false)
  assert.equal(Value.Check(actionCoachTurnSchema,{...base,event:{...base.event,nodes:[{kind:'fact',text:'我认为已经收到了。'}]}}),false)
  assert.equal(Value.Check(actionCoachTurnSchema,{...base,event:{...base.event,action:{operation:'modify',actionId:id,expectedRevision:3}}}),false)
})
