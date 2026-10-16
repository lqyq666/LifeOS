import test from 'node:test'
import assert from 'node:assert/strict'
import { rankExperienceCandidates } from '../../server/coach-retrieval.ts'

const now=Date.parse('2026-10-16T12:00:00Z')

test('confirmed experience recall balances relevance with recent current-conversation continuity',()=>{
  const rows=[
    {id:'old-close-match',conversation_id:'older-chat',updated_at:'2026-04-16T12:00:00Z'},
    {id:'current-follow-up',conversation_id:'current-chat',updated_at:'2026-10-16T11:00:00Z'},
  ]
  const ranked=rankExperienceCandidates(rows,[0.82,0.76],{currentConversationId:'current-chat',now})
  assert.equal(ranked[0]!.id,'current-follow-up','a close semantic match in the active matter should retain continuity')
})

test('continuity cannot displace a substantially more relevant confirmed experience',()=>{
  const rows=[
    {id:'older-direct-match',conversation_id:'older-chat',updated_at:'2026-07-16T12:00:00Z'},
    {id:'current-unrelated',conversation_id:'current-chat',updated_at:'2026-10-16T11:00:00Z'},
  ]
  const ranked=rankExperienceCandidates(rows,[0.95,0.55],{currentConversationId:'current-chat',now})
  assert.equal(ranked[0]!.id,'older-direct-match','semantic relevance remains the primary retrieval signal')
})

test('ranking is deterministic when legacy rows do not have usable timestamps',()=>{
  const rows=[{id:'b'},{id:'a'}]
  assert.deepEqual(rankExperienceCandidates(rows,[0.7,0.7],{now}).map(row=>row.id),['a','b'])
})
