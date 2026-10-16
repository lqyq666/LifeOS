import { isIP } from 'node:net'
import { config } from './config.ts'
import { pool, HttpError } from './db.ts'

export function clientIP(socketIP:string,realIP:string|undefined){
  const peer=socketIP.replace(/^::ffff:/,'')
  // Only one explicitly trusted proxy address; never accept client-chosen X-Forwarded-For chains.
  return config.trustedProxy&&peer===config.trustedProxy&&realIP&&isIP(realIP)?realIP:peer
}
export async function modelState(){
  const row=(await pool.query('SELECT error_code,last_success_at,last_failure_at,GREATEST(0,ceil(extract(epoch FROM retry_until-now())))::int AS retry_after FROM lifeos_model_state WHERE id=1')).rows[0]
  return {lastOutcome:row.error_code??(row.last_success_at?'succeeded':'not_checked'),lastSuccessAt:row.last_success_at,lastFailureAt:row.last_failure_at,retryAfter:row.retry_after??0}
}
export async function checkModelCooldown(){const state=await modelState();if(state.retryAfter>0)throw new HttpError(503,state.lastOutcome,state.retryAfter)}
export async function recordModelFailure(error:HttpError){
  await pool.query("UPDATE lifeos_model_state SET error_code=$1,last_failure_at=now(),retry_until=now()+($2*interval '1 second') WHERE id=1",[error.code,error.retryAfter??15])
}
export async function recordModelSuccess(){await pool.query('UPDATE lifeos_model_state SET error_code=NULL,retry_until=NULL,last_success_at=now() WHERE id=1')}
export async function checkMessageLimit(user:string){
  const row=(await pool.query(`SELECT count(*) FILTER (WHERE started_at>now()-interval '1 minute')::int AS minute,
    count(*) FILTER (WHERE started_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS day FROM (
      SELECT started_at FROM runs WHERE user_id=$1
      UNION ALL SELECT started_at FROM memory_review_runs WHERE user_id=$1
    ) requests`,[user])).rows[0]
  if(row.minute>=config.messagesPerMinute||row.day>=config.messagesPerDay)throw new HttpError(429,'USER_MESSAGE_LIMIT',row.day>=config.messagesPerDay?Math.ceil((86400000-Date.now()%86400000)/1000):60)
}
