import { localEmbedding } from './local-embedding.ts'
import { startCoachIndexing } from './coach-retrieval.ts'
import { createApp, modelReady } from './http.ts'
import { pool } from './db.ts'
import { config, validateConfig } from './config.ts'
import { verifySchema } from './schema.ts'
validateConfig()
const owner=await pool.connect()
try{
  if(!(await owner.query('SELECT pg_try_advisory_lock(6100102) AS acquired')).rows[0].acquired)throw new Error('LIFEOS_ALREADY_RUNNING: one app instance per database is supported')
  await verifySchema(owner)
  await localEmbedding.start()
  await owner.query("UPDATE runs SET status='failed',error_code='SERVER_RESTARTED',finished_at=now() WHERE status='running'")
}catch(error){await localEmbedding.close();owner.release();await pool.end();throw error}
const stopIndexing=startCoachIndexing()
const app=createApp()
app.listen(config.port,config.host,()=>console.log(JSON.stringify({service:'LifeOS',port:config.port,host:config.host,embeddingPid:localEmbedding.pid,modelCapabilitiesVerified:modelReady(),providerLiveness:'not_checked_at_startup',database:'postgresql',signupEnabled:config.signupEnabled})))
let stopping=false
async function stop(){
  if(stopping)return;stopping=true
  const deadline=setTimeout(()=>{app.closeAllConnections();process.exit(1)},15000);deadline.unref()
  try{const draining=app.drain();const indexingStopped=stopIndexing();await localEmbedding.close();await indexingStopped;await draining;await new Promise<void>(resolve=>app.close(()=>resolve()));owner.release();await pool.end();clearTimeout(deadline)}catch{console.error('SHUTDOWN_FAILED');process.exitCode=1}
}
owner.on('error',()=>{console.error('INSTANCE_LOCK_CONNECTION_LOST');void stop()})
app.on('error',()=>{console.error('SERVER_LISTEN_FAILED');process.exitCode=1;void stop()})
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>void stop())
// Optional local process-manager IPC uses the same drain as OS signals. No HTTP shutdown route.
process.on('message',message=>{if(message&&typeof message==='object'&&'type' in message&&message.type==='lifeos_shutdown')void stop().finally(()=>process.disconnect?.())})
