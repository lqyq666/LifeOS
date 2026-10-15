import test from 'node:test'
import assert from 'node:assert/strict'
import {parseActionCoachTurn} from '../server/action-coach-contracts.ts'
import {renderCoachReply} from '../server/coach-reply.ts'

const selection={reply:'',event:{target:{operation:'create',title:'本人贡献',source:{messageId:'00000000-0000-4000-8000-000000000001',quote:'帮我写作品描述'}},action:{operation:'create',draft:{kind:'resume_portfolio',selectedFactIds:['mf-current']}}}}
test('only an explicitly enabled catalogue selection can omit its explanation',()=>{
 assert.throws(()=>parseActionCoachTurn(JSON.stringify(selection)))
 assert.equal(parseActionCoachTurn(JSON.stringify(selection),{allowEmptyMaterialExplanation:true}).reply,'')
 for(const output of [{reply:''},{...selection,event:{...selection.event,action:{operation:'create',draft:{content:'自由正文'}}}},{...selection,event:{...selection.event,action:{operation:'reuse',actionId:'00000000-0000-4000-8000-000000000002',expectedRevision:1}}}]){
  assert.throws(()=>parseActionCoachTurn(JSON.stringify(output),{allowEmptyMaterialExplanation:true}))
 }
 assert.throws(()=>renderCoachReply(parseActionCoachTurn(JSON.stringify(selection),{allowEmptyMaterialExplanation:true})),'selection must be resolved by the host before rendering')
 const rendered=structuredClone(selection) as any;rendered.event.action.draft={content:'我负责整理资料和排版。'}
 assert.equal(renderCoachReply(rendered),'我负责整理资料和排版。')
 rendered.event.action.draft.content='';assert.throws(()=>renderCoachReply(rendered))
})
