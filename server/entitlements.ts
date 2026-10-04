import type {PoolClient} from 'pg'
import {pool,transaction,HttpError} from './db.ts'
import {config} from './config.ts'

// Lock before conversation/run rows in both start and commit. Reservations are
// existing running rows: cancellation and crash recovery release them naturally.
export async function lockEntitlement(c:PoolClient,user:string){
  return (await c.query('SELECT *,expires_at>clock_timestamp() AS unexpired FROM lifeos_entitlements WHERE user_id=$1 FOR UPDATE',[user])).rows[0]
}
export async function reserveEntitlement(c:PoolClient,user:string){
  if(!config.entitlementsEnabled)return false
  const row=await lockEntitlement(c,user)
  if(!row||!row.enabled)throw new HttpError(403,'ACCESS_NOT_ENABLED')
  if(!row.unexpired)throw new HttpError(403,'ACCESS_EXPIRED')
  const reserved=(await c.query("SELECT count(*)::int AS n FROM runs WHERE user_id=$1 AND status='running' AND entitlement_reserved",[user])).rows[0].n
  if(row.used_turns+reserved>=row.turn_limit)throw new HttpError(429,'ACCESS_LIMIT_REACHED')
  return true
}
export async function consumeEntitlement(c:PoolClient,user:string,reserved:boolean){
  if(!reserved)return
  const changed=await c.query('UPDATE lifeos_entitlements SET used_turns=used_turns+1,updated_at=now() WHERE user_id=$1 AND enabled AND expires_at>clock_timestamp() AND used_turns<turn_limit RETURNING user_id',[user])
  if(!changed.rowCount)throw new HttpError(403,'ACCESS_CHANGED')
}
export async function entitlementView(user:string){
  if(!config.entitlementsEnabled)return {required:false}
  const row=(await pool.query(`SELECT e.enabled,e.expires_at,e.turn_limit,e.used_turns,e.revision,e.expires_at>clock_timestamp() AS unexpired,
    (SELECT count(*)::int FROM runs r WHERE r.user_id=e.user_id AND r.status='running' AND r.entitlement_reserved) AS reserved
    FROM lifeos_entitlements e WHERE e.user_id=$1`,[user])).rows[0]
  if(!row)return {required:true,enabled:false,remaining:0,reserved:0,expiresAt:null}
  return {required:true,enabled:row.enabled&&row.unexpired,expiresAt:row.expires_at,limit:row.turn_limit,used:row.used_turns,reserved:row.reserved,remaining:Math.max(0,row.turn_limit-row.used_turns-row.reserved),revision:row.revision}
}
// Called only by a trusted operator CLI, never from a body/model/user endpoint.
export async function grantEntitlement(user:string,limit:number,expiresAt:string){
  if(!user||!Number.isInteger(limit)||limit<0||limit>1000000||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now())throw new Error('INVALID_ENTITLEMENT_GRANT')
  return transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':entitlement-grant'])
    const row=await lockEntitlement(c,user)
    const reserved=(await c.query("SELECT count(*)::int AS n FROM runs WHERE user_id=$1 AND status='running' AND entitlement_reserved",[user])).rows[0].n
    if(limit<(row?.used_turns??0)+reserved)throw new Error('GRANT_BELOW_COMMITTED_OR_RESERVED_USAGE')
    await c.query(`INSERT INTO lifeos_entitlements(user_id,turn_limit,expires_at) VALUES($1,$2,$3)
      ON CONFLICT(user_id) DO UPDATE SET enabled=true,turn_limit=$2,expires_at=$3,revision=lifeos_entitlements.revision+1,updated_at=now()`,[user,limit,expiresAt])
  })
}
