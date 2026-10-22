import test from 'node:test'
import assert from 'node:assert/strict'
import {parseActionCoachTurn} from '../server/action-coach-contracts.ts'
test('repeated deliberation tails preserve one complete final business frame',()=>{
 const reply='家里只希望稳定，并未要求本校读研；这条更正解除的是“必须本校”这一外部硬约束。'
 const frame=JSON.stringify({lead:'家里只希望稳定。',reply,event:{target:{operation:'create',title:'更正',source:{messageId:'00000000-0000-4000-8000-000000000001',quote:'家里只希望稳定'}},nodes:[{kind:'fact',source:{messageId:'00000000-0000-4000-8000-000000000001',quote:'家里只希望稳定'}}]},growthUpdates:[]})
 const raw=frame+'\n</thinking>\n\n'+frame+'\n</thinking>\n\n'+frame+'\n</thinking>\n'
 const parsed=parseActionCoachTurn(raw)
 assert.equal(parsed.reply,reply)
 assert.equal(parsed.event.target.operation,'create')
})
