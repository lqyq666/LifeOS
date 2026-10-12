import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from '../workflows/fixtures.ts'
import {createRuntimeDecisionAdapter} from '../../server/workflows/provider-adapter.ts'
import {resolveModel} from '../../server/model.ts'
import {pool} from '../../server/db.ts'

test.after(()=>pool.end())
test('synthetic selection observation rejects real-account graphs before reads, holds or dispatch',async()=>{
 const f=fixture();f.request.synthetic=false
 let reads=0,holds=0,observed=0
 const adapter=createRuntimeDecisionAdapter({freezePath:'.local/not-read-synthetic-observer-freeze.json',runtime:{...resolveModel('default'),available:true},readEvidence:async()=>{reads++;return f.records},budget:{async reserveGraph(){holds++;return []},async finish(){return {}},snapshot(){return {calls:[]}}} as any,observeSyntheticSelection:async()=>{observed++}})
 await assert.rejects(adapter.prepareGraph!(f.request,[]),error=>(error as any).code==='scope_denied')
 assert.deepEqual({reads,holds,observed},{reads:0,holds:0,observed:0})
})
