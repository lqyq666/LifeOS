import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import {providerReservationCny,reserveProviderSpend,settleProviderSpend,setProviderBudget,providerBudgetView} from '../../server/provider-spend.ts'

test('global configured-price budget is serialized and keeps unknown liabilities (real isolated PostgreSQL, no provider)',async t=>{
 const enabled=config.providerBudgetEnabled,id=config.providerBudgetId
 config.providerBudgetEnabled=true;config.providerBudgetId='synthetic-'+randomUUID()
 const reserve=(ceilingCny=.6,user=randomUUID())=>reserveProviderSpend({user,requestId:randomUUID(),callIndex:1,provider:'synthetic',model:'synthetic',ceilingCny})
 try{
  await t.test('missing activation and missing prices block before a request',async()=>{
   await assert.rejects(reserve(),(e:any)=>e.code==='PROVIDER_BUDGET_NOT_ENABLED')
   assert.throws(()=>providerReservationCny(128000,8192,null),(e:any)=>e.code==='PROVIDER_PRICE_REQUIRED')
   assert.throws(()=>providerReservationCny(128000,8192,{inputCnyPerMillion:0,outputCnyPerMillion:0}),(e:any)=>e.code==='PROVIDER_PRICE_REQUIRED')
   assert.equal(providerReservationCny(100000,10000,{inputCnyPerMillion:1,cachedInputCnyPerMillion:2,outputCnyPerMillion:3}),.23)
  })
  await t.test('concurrent accounts share one upper-bound reservation pool',async()=>{
   await setProviderBudget(config.providerBudgetId,1)
   const results=await Promise.allSettled([reserve(),reserve()])
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
   assert.equal((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.code,'PROVIDER_BUDGET_EXHAUSTED')
   const receipt=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<string>).value
   assert.equal(Number((await providerBudgetView())!.accounted_cny),.6)
   await settleProviderSpend(receipt,.2)
   assert.equal(Number((await providerBudgetView())!.accounted_cny),.2)
   await assert.rejects(settleProviderSpend(receipt,0),/ALREADY_SETTLED/)
  })
  await t.test('unknown and interrupted calls retain their ceiling, including after pause or reconfiguration',async()=>{
   const receipt=await reserve(.6)
   await settleProviderSpend(receipt,'unknown')
   const pending=await reserve(.1)
   assert.ok(pending)
   assert.equal(Number((await providerBudgetView())!.accounted_cny),.9)
   assert.equal((await providerBudgetView())!.unknown_or_active_calls,2)
   await assert.rejects(reserve(.2),(e:any)=>e.code==='PROVIDER_BUDGET_EXHAUSTED')
   await assert.rejects(setProviderBudget(config.providerBudgetId,.8),/BELOW_ACCOUNTED/)
   await setProviderBudget(config.providerBudgetId,1)
   assert.equal(Number((await providerBudgetView())!.accounted_cny),.9)
   await pool.query('UPDATE lifeos_provider_budgets SET enabled=false WHERE id=$1',[config.providerBudgetId])
   await assert.rejects(reserve(.01),(e:any)=>e.code==='PROVIDER_BUDGET_NOT_ENABLED')
   await settleProviderSpend(pending,0,true)
   assert.equal(Number((await providerBudgetView())!.accounted_cny),.8)
  })
  await t.test('overrun is retained as actual estimate and pauses every new reservation',async()=>{
   await setProviderBudget(config.providerBudgetId,2)
   const receipt=await reserve(.1)
   assert.equal((await settleProviderSpend(receipt,.15))!.overrun,true)
   assert.equal((await providerBudgetView())!.enabled,false)
   assert.equal(Number((await providerBudgetView())!.accounted_cny),.95)
   await assert.rejects(reserve(.01),(e:any)=>e.code==='PROVIDER_BUDGET_NOT_ENABLED')
  })
 }finally{
  await pool.query('DELETE FROM lifeos_provider_spend WHERE budget_id=$1',[config.providerBudgetId])
  await pool.query('DELETE FROM lifeos_provider_budgets WHERE id=$1',[config.providerBudgetId])
  config.providerBudgetEnabled=enabled;config.providerBudgetId=id
 }
})
