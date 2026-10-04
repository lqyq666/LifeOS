import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {config} from '../server/config.ts'
import {pool} from '../server/db.ts'
import * as store from '../server/store.ts'
import {grantEntitlement,entitlementView} from '../server/entitlements.ts'
import {setProviderBudget,reserveProviderSpend,settleProviderSpend,providerBudgetView} from '../server/provider-spend.ts'
const db=new URL(config.databaseUrl).pathname.slice(1)
if(!/^lifeos_dialogue_test_[a-z0-9_]+$/.test(db)||(await pool.query('SELECT current_database() AS db')).rows[0].db!==db)throw Error('ACTUAL_DISPOSABLE_RECOVERY_DATABASE_REQUIRED')
config.entitlementsEnabled=true;config.providerBudgetEnabled=true;config.providerBudgetId='synthetic-recovery-pool'
const user='synthetic-access-recovery',revoked=user+'-revoked',expired=user+'-expired',paused='synthetic-recovery-paused'
const signal=new AbortController().signal
async function reserve(amount:number,owner=user){return reserveProviderSpend({user:owner,requestId:randomUUID(),callIndex:1,provider:'SYNTHETIC_NO_PROVIDER',model:'SYNTHETIC_ACCOUNTING_ONLY',ceilingCny:amount})}
try{
 if(process.argv.includes('--seed')){
  for(const id of [user,revoked,expired]){await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[id,id+'@example.invalid']);await grantEntitlement(id,4,new Date(Date.now()+86400000).toISOString());await store.createConversation(id,{id:randomUUID(),title:'SYNTHETIC access recovery'})}
  const chat=(await store.listConversations(user))[0]!.id
  for(let i=0;i<2;i++){const run=(await store.startRun(user,chat,randomUUID(),'合成已完成恢复输入 '+i)).run;await store.finishRun(run,{candidates:[],audit:[]},'合成完成，不含模型调用。',null,signal)}
  await store.startRun(user,chat,randomUUID(),'合成未完成的资格预留。')
  await pool.query('UPDATE lifeos_entitlements SET enabled=false,revision=revision+1 WHERE user_id=$1',[revoked]);await pool.query("UPDATE lifeos_entitlements SET expires_at='2020-01-01',revision=revision+1 WHERE user_id=$1",[expired])
  await setProviderBudget(config.providerBudgetId,.10)
  const known=await reserve(.03);await settleProviderSpend(known,.02)
  const unknown=await reserve(.03,revoked);await settleProviderSpend(unknown,'unknown')
  await reserve(.04)
  const notSent=await reserve(.005);await settleProviderSpend(notSent,'unknown',true)
  config.providerBudgetId=paused;await setProviderBudget(paused,.03);const overrun=await reserve(.02);await settleProviderSpend(overrun,.04)
  console.log(JSON.stringify({evidence:'SYNTHETIC_NONEMPTY_ACCESS_AND_ACCOUNTING_RECOVERY_FIXTURE',seeded:true,providerCalls:0}))
 }else{
  const initial=await entitlementView(user) as any
  assert.equal(initial.used,2);assert.equal(initial.reserved,1);assert.equal(initial.remaining,1)
  for(const [id,code] of [[revoked,'ACCESS_NOT_ENABLED'],[expired,'ACCESS_EXPIRED']]){const chat=(await store.listConversations(id!))[0]!.id;await assert.rejects(store.startRun(id!,chat,randomUUID(),'合成权限恢复边界。'),(e:any)=>e.code===code)}
  const financial=await providerBudgetView();assert.equal(Number(financial.accounted_cny),.09);assert.equal(financial.unknown_or_active_calls,2)
  const statuses=(await pool.query('SELECT status FROM lifeos_provider_spend ORDER BY status')).rows.map(r=>r.status);assert.deepEqual(statuses,['known','not_sent','overrun','reserved','unknown'])
  await assert.rejects(reserve(.011),(e:any)=>e.code==='PROVIDER_BUDGET_EXHAUSTED')
  await assert.rejects(setProviderBudget(config.providerBudgetId,.08),/BUDGET_BELOW_ACCOUNTED_SPEND/)
  config.providerBudgetId=paused;assert.equal((await providerBudgetView()).enabled,false);await assert.rejects(reserve(.001),(e:any)=>e.code==='PROVIDER_BUDGET_NOT_ENABLED');config.providerBudgetId='synthetic-recovery-pool'
  // Delete only this synthetic revoked account in the disposable restored copy.
  await pool.query('DELETE FROM "user" WHERE id=$1',[revoked]);assert.equal(Number((await providerBudgetView()).accounted_cny),.09);assert.equal((await pool.query('SELECT count(*)::int AS n FROM lifeos_provider_spend')).rows[0].n,5)
  const unknown=(await pool.query("SELECT id FROM lifeos_provider_spend WHERE status='unknown'")).rows[0].id;await assert.rejects(settleProviderSpend(unknown,0),/PROVIDER_SPEND_ALREADY_SETTLED/)
  const held=(await pool.query("SELECT id FROM lifeos_provider_spend WHERE status='reserved'")).rows[0].id;await settleProviderSpend(held,.015)
  const next=await reserve(.01);await settleProviderSpend(next,'unknown');assert.equal(Number((await providerBudgetView()).accounted_cny),.075)
  const live=(await pool.query("SELECT request_id,conversation_id FROM runs WHERE user_id=$1 AND status='running'",[user])).rows[0];await store.terminateRun(user,live.request_id,'cancelled','SYNTHETIC_RECOVERY_RELEASE');assert.equal((await entitlementView(user) as any).used,2);assert.equal((await entitlementView(user) as any).remaining,2)
  for(let i=0;i<2;i++){const id=randomUUID(),text='合成恢复后继续输入 '+i,run=(await store.startRun(user,live.conversation_id,id,text)).run;await store.finishRun(run,{candidates:[],audit:[]},'合成恢复后完成。',null,signal);assert.equal((await store.startRun(user,live.conversation_id,id,text)).replay,true)}
  assert.equal((await entitlementView(user) as any).used,4);await assert.rejects(store.startRun(user,live.conversation_id,randomUUID(),'超过合成额度。'),(e:any)=>e.code==='ACCESS_LIMIT_REACHED')
  console.log(JSON.stringify({evidence:'REAL_ISOLATED_PG_RESTORED_ACCESS_AND_SYNTHETIC_SPEND_BEHAVIOR_NO_PROVIDER',usedAndReservedPreserved:true,disabledAndExpiredStillDenied:true,cancelReleasesOnlyReservation:true,idempotentReplayDoesNotConsumeAgain:true,limitStillEnforced:true,knownUnknownReservedNotSentAndOverrunPreserved:true,unknownNotRefunded:true,pausedBudgetStillDenied:true,deletingSyntheticAccountDoesNotRefundSpend:true,restoredReservationSettlesOnce:true,accountedAfterContinuationCny:.075,providerCalls:0}))
 }
}finally{await pool.end()}
