import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {coachCapabilityReportMatches,coachCapabilityReuseProof,coachContractSignatureFor,coachInterfaceSignatureFor,modelSignatureFor,resolveModel} from '../../server/model.ts'

test('capability parser rejects old, partial, mismatched and simulated reports (shape test only)',()=>{
  const tier='default',route=resolveModel(tier),signature=modelSignatureFor(tier)
  // In-memory format fixture; never saved or used to authorize a live service.
  const report={status:'PASS',evidence:'REAL_PROVIDER_API',contract:'action-coach-v1.3',tier,signature,contractSignature:coachContractSignatureFor(tier),provider:route.model.provider,model:route.model.id,checks:Object.fromEntries(['streaming','freeOutput','actionOutput','cancel'].map(key=>[key,{passed:true}])),calls:Array.from({length:4},()=>({callId:randomUUID(),status:'finished',purpose:'capability',signature}))}
  assert.equal(coachCapabilityReportMatches(report,tier),true)
  for(const change of [{contract:'decision-v1.2'},{contractSignature:'stale'},{signature:'other-endpoint'},{evidence:'SIMULATED_PROVIDER'},{status:'CHECK_PASS'},{tier:'reasoning'},{checks:{streaming:{passed:true}}},{calls:report.calls.slice(1)},{calls:report.calls.map(()=>report.calls[0])},{calls:report.calls.map(call=>({...call,status:'reserved'}))}])assert.equal(coachCapabilityReportMatches({...report,...change},tier),false)
  const split={...report,interfaceSignature:coachInterfaceSignatureFor(tier),contractSignature:'older-business-behavior'}
  assert.equal(coachCapabilityReportMatches(split,tier),true,'business evidence is separate from unchanged API capability')
  assert.equal(coachCapabilityReportMatches({...split,interfaceSignature:'changed-interface'},tier),false)
  assert.equal(coachCapabilityReportMatches({...split,status:'FAIL'},tier),false)
  const proof=coachCapabilityReuseProof(report,tier)
  assert.equal(coachCapabilityReportMatches(report,tier,proof),true)
  assert.equal(coachCapabilityReportMatches({...report,contractSignature:'changed-business'},tier,proof),false,'proof is bound to immutable historical report')
  assert.throws(()=>coachCapabilityReuseProof({...report,contractSignature:'stale'},tier),/NOT_PROVEN/)
  assert.throws(()=>coachCapabilityReuseProof({...report,status:'FAIL'},tier),/NOT_PROVEN/)
  const original=route.model.baseUrl
  try{route.model.baseUrl=original+'/different-endpoint';assert.notEqual(coachInterfaceSignatureFor(tier),split.interfaceSignature);assert.equal(coachCapabilityReportMatches(split,tier),false)}finally{route.model.baseUrl=original}
})
