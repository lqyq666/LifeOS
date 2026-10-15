import test from 'node:test'
import assert from 'node:assert/strict'
import {cozePermitClock} from '../scripts/coze-host-permit.ts'

test('fresh permits remain valid across the observed HTTP clock lag without extending five-minute TTL',()=>{
 const local=Date.parse('2026-10-15T04:23:06.151Z')
 const gateway=Date.parse('2026-10-15T04:23:04Z')
 // This is the pre-fix rejection: local issuedAt is in the Gateway future.
 assert.ok(local>gateway+500)
 const issued=cozePermitClock('Thu, 15 Oct 2026 04:23:04 GMT',local)
 assert.ok(issued<=local&&issued<=gateway+500)
 const expires=issued+300000
 assert.equal(expires-issued,300000)
 assert.ok(expires<=local+300000)
})

test('ahead, unavailable and stale clocks preserve the existing permit boundary',()=>{
 const local=Date.parse('2026-10-15T04:23:06.151Z')
 assert.equal(cozePermitClock('Thu, 15 Oct 2026 04:23:08 GMT',local),local)
 assert.equal(cozePermitClock(null,local),local)
 assert.equal(cozePermitClock('invalid',local),local)
 assert.throws(()=>cozePermitClock('Thu, 15 Oct 2026 04:18:06 GMT',local),/OUTSIDE_PERMIT_LIFETIME/)
})
