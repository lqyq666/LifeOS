import { setTimeout as delay } from 'node:timers/promises'
import type { PoolClient } from 'pg'
import { HttpError } from './db.ts'

const runKey=(user:string,id:string)=>'lifeos-run:'+user+':'+id
// Session locks disappear with the owning DB connection. A slow stream/save
// must never be mistaken for a crash by a heartbeat expiry.
export class RuntimeCoordination {
  private readonly runs=new Set<string>()
  private readonly slots=new Set<number>()
  private readonly accounts=new Set<string>()
  private readonly lostHandlers=new Set<()=>void>()
  private leader=false
  private lost=false
  constructor(private readonly owner:PoolClient){
    owner.on('error',()=>{this.lost=true;for(const fn of this.lostHandlers)fn()})
  }
  onLost(fn:()=>void){this.lostHandlers.add(fn);return()=>{this.lostHandlers.delete(fn)}}
  private async tryLock(key:string){
    if(this.lost)throw new HttpError(503,'INSTANCE_LOCK_CONNECTION_LOST')
    return (await this.owner.query('SELECT pg_try_advisory_lock(hashtextextended($1,6100103)) AS acquired',[key])).rows[0].acquired as boolean
  }
  private async unlock(key:string){
    if(!this.lost)await this.owner.query('SELECT pg_advisory_unlock(hashtextextended($1,6100103))',[key])
  }
  async claimRun(user:string,id:string):Promise<null|(()=>Promise<void>)>{
    const key=runKey(user,id)
    // PG session locks are reentrant: reserve locally before awaiting.
    if(this.runs.has(key))return null
    this.runs.add(key)
    try{if(!await this.tryLock(key)){this.runs.delete(key);return null}}
    catch(error){this.runs.delete(key);throw error}
    let released=false
    return async()=>{if(released)return;released=true;try{await this.unlock(key)}finally{this.runs.delete(key)}}
  }
  async maintain(){
    if(!this.leader)this.leader=(await this.owner.query('SELECT pg_try_advisory_lock(6100102) AS acquired')).rows[0].acquired
    if(this.leader)await this.recoverAbandonedRuns()
    return this.leader
  }
  private async legacyRunningCount(){
    const legacy=(await this.owner.query(`SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
      WHERE l.locktype='advisory' AND l.classid=0 AND l.objid=6100102 AND l.objsubid=1
      AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
      AND l.pid<>pg_backend_pid() AND a.application_name<>'lifeos-runtime-v2' LIMIT 1`)).rowCount
    if(!legacy)return 0
    const rows=(await this.owner.query("SELECT user_id,request_id FROM runs WHERE status='running'")).rows
    let count=0
    for(const row of rows){
      const key=runKey(row.user_id,row.request_id)
      if(this.runs.has(key))continue
      if(await this.tryLock(key)){count++;await this.unlock(key)}
    }
    return count
  }
  async acquireGeneration(user:string,limit:number,signal:AbortSignal){
    const account='lifeos-generation-account:'+user
    let accountHeld=false,slot:number|undefined
    try{
      while(true){
        signal.throwIfAborted()
        if(!accountHeld&&!this.accounts.has(user)){
          this.accounts.add(user)
          try{accountHeld=await this.tryLock(account)}finally{if(!accountHeld)this.accounts.delete(user)}
        }
        if(accountHeld){
          const legacyCount=await this.legacyRunningCount()
          const other=(await this.owner.query("SELECT request_id FROM runs WHERE user_id=$1 AND status='running'",[user])).rows
          let legacyAccount=false
          if(legacyCount)for(const row of other){
            const key=runKey(user,row.request_id)
            if(!this.runs.has(key)&&await this.tryLock(key)){legacyAccount=true;await this.unlock(key)}
          }
          if(!legacyAccount)for(let i=legacyCount;i<limit;i++){
            if(this.slots.has(i))continue
            this.slots.add(i)
            try{if(await this.tryLock('lifeos-generation-slot:'+i)){slot=i;break}}
            finally{if(slot!==i)this.slots.delete(i)}
          }
          if(slot!==undefined)break
        }
        await delay(100,undefined,{signal})
      }
      signal.throwIfAborted()
    }catch(error){
      if(slot!==undefined){await this.unlock('lifeos-generation-slot:'+slot);this.slots.delete(slot)}
      if(accountHeld)try{await this.unlock(account)}finally{this.accounts.delete(user)}
      throw error
    }
    let released=false
    return async()=>{
      if(released)return;released=true
      try{await this.unlock('lifeos-generation-slot:'+slot)}finally{this.slots.delete(slot!);try{await this.unlock(account)}finally{this.accounts.delete(user)}}
    }
  }
  async recoverAbandonedRuns(){
    if(!this.leader)throw new Error('RECOVERY_REQUIRES_BACKGROUND_LEADER')
    const rows=(await this.owner.query("SELECT user_id,request_id FROM runs WHERE status='running'")).rows
    for(const row of rows){
      const release=await this.claimRun(row.user_id,row.request_id)
      if(!release)continue
      try{await this.owner.query("UPDATE runs SET status='failed',error_code='SERVER_RESTARTED',finished_at=now() WHERE user_id=$1 AND request_id=$2 AND status='running'",[row.user_id,row.request_id])}
      finally{await release()}
    }
  }
}
