import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCozeDirectionAdapter} from '../server/workflows/coze-direction-adapter.ts'
import type {CozeDirectionConfig} from '../server/workflows/coze-direction-adapter.ts'
import {workflowRuntimeVersion} from '../server/workflows/runtime-version.ts'
import {mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {captureCoachSource} from '../scripts/coach-source-freeze.ts'
import {fixture} from './workflows/fixtures.ts'
import type {CoachProviderBudget} from '../scripts/coach-provider-budget.ts'
import type {CozeCreditBudget} from '../scripts/coze-credit-budget.ts'
import {simulationJournal} from '../server/workflows/task-journal.ts'

test('observed truncated Skill digest disables adapter before ledger or transport access',()=>{
 let externalAccess=0
 const forbidden=()=>{externalAccess++;throw Error('EXTERNAL_ACCESS_FORBIDDEN')}
 const config={projectId:'7693388932939300905',endpoint:'https://v8bjn44ynd.coze.site/run',token:'synthetic-fixture-token-not-a-secret',maxCreditsPerGraph:24,journalDirectory:'.local/unused',creditsLedgerPath:'.local/unused',binding:{hostSourceDigest:workflowRuntimeVersion.sourceDigest,cloudCommit:'dc28cef33c3645e6234f0bceffc13bc3ff474875',cloudSourceDigest:'b086ec21f77e9301ccbe818159431b822548fdcb04f5d09cf26ac45c5cbc3b37',contentHash:workflowRuntimeVersion.contentHash,skillsDigest:'8917dbcebb168e135485871520a68fececb13dd14da83bacde993373d1ce9a8'}} as CozeDirectionConfig
 assert.throws(()=>createCozeDirectionAdapter({config,freezePath:'.local/unused',readEvidence:async()=>{forbidden();return []},readMethods:async()=>{forbidden();return []},fetchImpl:async()=>{forbidden();return new Response()},syntheticTransport:true}),/CLOUD_REAL_BUILD_BINDING_REQUIRED/)
 config.binding.skillsDigest='8917dbcebb168e135485871520a68fececb13dd14dba83bcade993373d1ce9a8'
 const valid=createCozeDirectionAdapter({config,freezePath:'.local/unused',readEvidence:async()=>{forbidden();return []},readMethods:async()=>{forbidden();return []},fetchImpl:async()=>{forbidden();return new Response()},syntheticTransport:true})
 assert.equal(typeof valid.runRemoteGraph,'function')
 assert.equal(externalAccess,0)
})

test('observed old Gateway commit stops before original CNY slot reservation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'lifeos-binding-preflight-'))
 let slotReservations=0,posts=0;const held:any[]=[],finished:any[]=[]
 try{
  const freezePath=join(root,'freeze.json');writeFileSync(freezePath,JSON.stringify(captureCoachSource()))
  const binding={hostSourceDigest:workflowRuntimeVersion.sourceDigest,cloudCommit:'dc28cef33c3645e6234f0bceffc13bc3ff474875',cloudSourceDigest:'b086ec21f77e9301ccbe818159431b822548fdcb04f5d09cf26ac45c5cbc3b37',contentHash:workflowRuntimeVersion.contentHash,skillsDigest:'8917dbcebb168e135485871520a68fececb13dd14dba83bcade993373d1ce9a8'}
  const config={projectId:'7693388932939300905',endpoint:'https://synthetic-test.coze.site/run',token:'synthetic-fixture-token-not-a-secret',maxCreditsPerGraph:24,journalDirectory:root,creditsLedgerPath:join(root,'unused'),binding} as CozeDirectionConfig
  const budget={snapshot:()=>({currentGrant:{remainingCny:1,paused:false}}),reserveGraph:()=>{slotReservations++;throw Error('MUST_NOT_RESERVE_MODEL')}} as unknown as CoachProviderBudget
  const credits={balance:()=>({availableCredits:1000}),reserve:(row:unknown)=>held.push(row),finishUnknown:(...args:unknown[])=>finished.push(args)} as unknown as CozeCreditBudget
  const f=fixture();f.request.modelBudget.maxCostCny=.2
  const adapter=createCozeDirectionAdapter({config,freezePath,budget,credits,syntheticTransport:true,readEvidence:async()=>f.records,readMethods:async()=>[],fetchImpl:async(_url,init)=>{
   posts++;const body=JSON.parse(String(init?.body));assert.equal(body.host_request.operation,'readback');assert.equal(body.host_request.payloadB64,'');assert.equal(body.host_request.claimsB64,'');assert.equal(body.host_request.signature,'')
   return Response.json({receipt:{status:'unavailable',failure:'invalid_contract',providerCalls:0,costCny:null,reservedCostCny:0,trace:[],suggestedStateChanges:[],runtime:{projectId:config.projectId,businessRole:'growth',hostSourceDigest:binding.hostSourceDigest,cloudCommit:'d3c540234751e5695dc86ce07d7340325f3149c9',cloudSourceDigest:binding.cloudSourceDigest,canonicalContentHash:binding.contentHash,skillsDigest:binding.skillsDigest}}})
  }})
  const receipt=await adapter.runRemoteGraph!(f.request,{...simulationJournal(),durable:true})
  assert.equal(receipt.status,'unavailable');assert.equal(receipt.providerCalls,0);assert.equal(receipt.costCny,0);assert.equal(receipt.reservedCostCny,0)
  assert.equal(posts,1);assert.equal(slotReservations,0);assert.equal(held.length,1);assert.equal(held[0].reservedCredits,24);assert.equal(finished.length,1);assert.equal(finished[0][2],0)
 }finally{
  const target=realpathSync(root);assert(target.startsWith(resolve(tmpdir())+sep)&&target.includes('lifeos-binding-preflight-'));rmSync(target,{recursive:true,force:true})
 }
})
