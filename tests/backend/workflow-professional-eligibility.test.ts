import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import {grantEntitlement} from '../../server/entitlements.ts'
import {createWorkflowHost} from '../../server/workflows/task-host.ts'
import {config} from '../../server/config.ts'

test.after(()=>pool.end())

test('Coze professional capability follows existing account entitlement without marking a normal account synthetic',async()=>{
 const previous=process.env.LIFEOS_ADVANCED_WORKFLOWS
 const previousAccess=config.entitlementsEnabled
 process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
 config.entitlementsEnabled=true
 const allowed='normal-'+randomUUID(),blocked='normal-'+randomUUID()
 const never=async()=>{throw Error('no model call in eligibility test')}
 const adapter={executionKind:'real_provider',maxCostPerCallCny:0.02,analyze:never,critic:never,synthesize:never,runRemoteGraph:never} as any
 const host=createWorkflowHost({syntheticUserId:'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPp',adapter})
 try{
  for(const id of [allowed,blocked])await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[id,id+'@example.invalid'])
  await grantEntitlement(allowed,3,new Date(Date.now()+86400000).toISOString())
  const open=await host.capabilities(allowed),closed=await host.capabilities(blocked)
  assert.equal(open.enabled,true)
  assert.equal(open.syntheticEligible,false)
  assert.equal(closed.enabled,false)
  assert.equal(closed.reason,'专业能力尚未为此账号开放')
 }finally{
  host.close()
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[[allowed,blocked]])
  config.entitlementsEnabled=previousAccess
  if(previous===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=previous
 }
})
