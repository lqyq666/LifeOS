import test from 'node:test'
import assert from 'node:assert/strict'
import {buildTurnPrompt} from '../../server/turn-prompt.ts'

function prompt(text:string,fragments?:string[]){
 const messages=[...(text?[{id:'old',role:'user',content:text}]:[]),{id:'new',role:'user',content:'接着上次报名表反馈，我下一次先处理什么，为什么？'}] as any
 const event={id:'matter',revision:2,title:'报名表',nodes:(fragments??['我接受这个步骤','这次先别增加其他任务']).map((quote,i)=>({id:String(i),kind:'fact',status:'active',content:quote,source:{messageId:'old',quote}})),actions:[],processTurns:[]} as any
 const original=JSON.stringify({messages,event})
 const result=JSON.parse(buildTurnPrompt({currentMessageId:'new',messages,currentEvent:event}))
 assert.equal(JSON.stringify({messages,event}),original)
 assert.equal(result.currentEvent.nodes.length,event.nodes.length,'no source fact or boundary is deleted')
 return result
}

test('a past reply instruction is annotated with its full source without removing acceptance or active records',()=>{
 const text='我接受这个步骤，但尚未执行。这次先别增加其他任务。'
 const result=prompt(text)
 const annotation=result.historicalInteractionRequests.find((x:any)=>x.originalText==='这次先别增加其他任务')
 assert.equal(annotation.isCurrent,false)
 assert.equal(annotation.sourceMessageId,'old')
 assert.ok(!Object.hasOwn(annotation,'sourceContext'),'annotation does not duplicate historical bodies')
 assert.match(annotation.scope,/完整原文支持单轮范围/)
})

test('duration, quotation, attribution and fragmented context stay visible without a deterministic expiry claim',()=>{
 for(const text of ['直到我明确要求恢复，这次先别增加其他任务。','这项限制持续到我明确要求恢复为止。这次先别增加其他任务。','这次先别增加其他任务。直到我明确要求恢复。','这次先别增加其他任务，永远都不要再加。','室友说：“这次先别增加其他任务。”','室友说这次先别增加其他任务']){
  const context=prompt(text,['这次先别增加其他任务'])
  assert.ok(JSON.stringify(context).includes(text.replaceAll('“','\\u201c'))||context.messages.some((m:any)=>m.text===text),text)
  assert.match(context.historicalInteractionRequests[0].scope,/持续条件.*继续有效/)
 }
 const fragmented=prompt('',['这次先别增加其他任务','直到我明确要求恢复'])
 assert.ok(JSON.stringify(fragmented).includes('直到我明确要求恢复'))
})

test('current instructions and explicit named pauses are not annotated as old one-turn requests',()=>{
 for(const content of ['这次先别增加其他任务。','我暂停考研资料这件事。','以后都不要增加其他任务。']){
  const current={id:'now',role:'user',content} as any
  assert.equal(JSON.parse(buildTurnPrompt({currentMessageId:'now',messages:[current]})).historicalInteractionRequests.length,0)
 }
 const context=prompt('我暂停考研资料这件事。',['我暂停考研资料这件事'])
 assert.equal(context.historicalInteractionRequests.length,0)
})

test('missing full history is explicit and cannot authorize expiry from an isolated clause',()=>{
 const old={id:'old',role:'user',content:'直到我明确要求恢复。这次先别增加其他任务。'}
 const current={id:'new',role:'user',content:'我下一步该怎么做？'}
 const event={id:'matter',revision:2,title:'报名表',nodes:[{id:'boundary',kind:'fact',status:'active',content:'这次先别增加其他任务',source:{messageId:'old',quote:'这次先别增加其他任务'}}],actions:[],processTurns:[]}
 const included=JSON.parse(buildTurnPrompt({omitHistoricalMaterialBodies:true,currentMessageId:'new',messages:[old,current] as any,currentEvent:event as any}))
 assert.equal(included.historicalInteractionRequests[0].sourceMessageIncluded,true)
 assert.ok(included.messages.some((m:any)=>m.text===old.content))
 const omitted=JSON.parse(buildTurnPrompt({omitHistoricalMaterialBodies:true,currentMessageId:'new',messages:[old,{id:'large',role:'user',content:'无关内容'.repeat(5100)},current] as any,currentEvent:event as any}))
 assert.equal(omitted.historicalInteractionRequests[0].sourceMessageIncluded,false)
 assert.ok(!omitted.messages.some((m:any)=>m.id==='old'))
 assert.match(omitted.historicalInteractionRequests[0].scope,/完整来源不可用.*不推断.*结束/)
})
