import test from 'node:test'
import assert from 'node:assert/strict'
import {createOrchestrator} from '../server/workflows/orchestrator.ts'
import {fixture} from './workflows/fixtures.ts'
import {emptyProposal} from '../server/workflows/contracts.ts'

test('cancellation drains graph preparation before settling its unstarted reservations',async()=>{
 const f=fixture(),controller=new AbortController()
 let entered!:()=>void,release!:()=>void,finished=false,prepared=false
 const began=new Promise<void>(r=>{entered=r}),gate=new Promise<void>(r=>{release=r})
 const runner=createOrchestrator({readEvidence:async()=>f.records,prepareGraph:async()=>{entered();await gate;prepared=true},finishGraph:async()=>{finished=true;assert.equal(prepared,true)}})
 const result=runner.run(f.request,[],async r=>({schemaVersion:2,traceId:r.traceId,status:'proposed',proposal:emptyProposal(r),providerCalls:0,costCny:0,reservedCostCny:0,executionKind:'local_deterministic',skills:[],fallback:'none'}),controller.signal)
 void result.catch(()=>{})
 await began;controller.abort()
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false,'cleanup must wait for preparation to stop, otherwise late reservations escape it')}
 finally{release();await result.catch(()=>{})}
 const receipt=await result;assert.equal(receipt.failure,'cancelled');assert.equal(receipt.providerCalls,0);assert.equal(finished,true)
})
