import {readFileSync} from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {renderCoachReply} from '../server/coach-reply.ts'
import type {ActionCoachTurn} from '../server/action-coach-contracts.ts'

test('complete long material is rendered from its one authority without duplication or truncation',()=>{
  const content='完整材料\n'+ '保留原文与细节。'.repeat(500)
  const event:ActionCoachTurn['event']={target:{operation:'create',title:'材料',source:{messageId:'00000000-0000-4000-8000-000000000001',quote:'请起草'}},action:{operation:'create',draft:{content}}}
  assert.equal(renderCoachReply({reply:'说明',event}),'说明\n\n'+content)
  assert.equal(renderCoachReply({reply:'说明\n'+content,event}),'说明\n'+content)
  assert.equal(event.action!.operation,'create');assert.equal((event.action as any).draft.content,content)
  assert.equal(renderCoachReply({reply:'具体是哪件事？'}),'具体是哪件事？')
  assert.throws(()=>renderCoachReply({reply:'说明',event:{...event,action:{operation:'create',draft:{content:' '}}}}),/EMPTY_MATERIAL/)
})

test('saved real bold-formatted material is rendered once with all authoritative bytes and its introduction',()=>{
  const turn=JSON.parse(readFileSync('tests/fixtures/coach-markdown-material-duplicate.json','utf8')),before=JSON.stringify(turn)
  const material=turn.event.action.draft.content,rendered=renderCoachReply(turn)
  assert.equal(rendered,'好的，这是为你准备的实施意图草稿：\n\n'+material)
  assert.equal(rendered.split(material).length,2)
  assert.equal(JSON.stringify(turn),before)
})

test('different material and literal code, escapes or arithmetic never become formatting-equivalent',()=>{
  const content='确定的\n材料。',make=(reply:string,material=content):ActionCoachTurn=>({reply,event:{target:{operation:'create',title:'材料',source:{messageId:'00000000-0000-4000-8000-000000000001',quote:'请起草'}},action:{operation:'create',draft:{content:material}}}})
  for(const reply of ['**不同的**\n**材料。**','`**确定的**\n**材料。**`','\\**确定的**\n\\**材料。**'])assert.equal(renderCoachReply(make(reply)),reply+'\n\n'+content)
  assert.equal(renderCoachReply(make('2**3**4','234')),'2**3**4\n\n234')
  assert.equal(renderCoachReply(make('**2*3**','23')),'**2*3**\n\n23')
  assert.equal(renderCoachReply({reply:'仅聊天里的**重点**。'}),'仅聊天里的**重点**。')
})

test('formatting-equivalent material retains a real introduction and a later question',()=>{
  const material='你现在还需要资料吗？\n\n不需要也没关系。',turn:ActionCoachTurn={reply:'可以这样发：\n\n**你现在还需要资料吗？**\n\n**不需要也没关系。**\n\n你想改哪一处？',event:{target:{operation:'create',title:'材料',source:{messageId:'00000000-0000-4000-8000-000000000001',quote:'请起草'}},action:{operation:'create',draft:{content:material}}}}
  assert.equal(renderCoachReply(turn),'可以这样发：\n\n'+material+'\n\n你想改哪一处？')
})
