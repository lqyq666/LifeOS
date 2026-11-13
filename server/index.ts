import { localEmbedding } from './local-embedding.ts'
import { startCoachIndexing } from './coach-retrieval.ts'
import { createApp, modelReady } from './http.ts'
import { pool,closeDatabasePools } from './db.ts'
import { config, validateConfig } from './config.ts'
import { verifySchema } from './schema.ts'
import {drainPasswordResetMail,stopPasswordResetMail} from './password-reset-mail.ts'
import {configureProviderTransport,warmProviderConnection} from './provider-connection.ts'
import {RuntimeCoordination} from './runtime-coordination.ts'
validateConfig()
const owner=await pool.connect()
const runtime=new RuntimeCoordination(owner)
try{
  await owner.query("SET application_name='lifeos-runtime-v2'")
  await verifySchema(owner)
  await localEmbedding.start()
  await runtime.maintain()
}catch(error){await localEmbedding.close();owner.release();await closeDatabasePools();throw error}
let stopIndexing:(()=>Promise<void>)|undefined,maintaining=false
const providerTransport=configureProviderTransport(config.modelTiers.default)
const providerConnectionWarmup=await warmProviderConnection(config.modelTiers.default)
const app=createApp(undefined,undefined,undefined,runtime)
app.listen(config.port,config.host,()=>console.log(JSON.stringify({service:'LifeOS',port:config.port,host:config.host,embeddingPid:localEmbedding.pid,modelCapabilitiesVerified:modelReady(),providerConnectionWarmup,providerLiveness:'not_checked_at_startup',database:'postgresql',signupEnabled:config.signupEnabled})))
let stopping=false
let maintenanceWork=Promise.resolve()
const maintenance=setInterval(()=>{
  if(maintaining||stopping)return
  maintaining=true
  maintenanceWork=(async()=>{
  try{if(await runtime.maintain()&&!stopping)stopIndexing??=startCoachIndexing()}
  catch{console.error('RUNTIME_MAINTENANCE_FAILED');void stop()}
  finally{maintaining=false}
  })()
},500)
maintenance.unref()
async function stop(){
  if(stopping)return;stopping=true
  clearInterval(maintenance)
  try{await app.drain();await new Promise<void>(resolve=>app.close(()=>resolve()));await drainPasswordResetMail();await stopPasswordResetMail();await maintenanceWork;await stopIndexing?.();await localEmbedding.close();await providerTransport.close?.()}catch{console.error('SHUTDOWN_FAILED');process.exitCode=1}
  finally{owner.release(true);await closeDatabasePools()}
}
owner.on('error',()=>{console.error('INSTANCE_LOCK_CONNECTION_LOST');void stop()})
app.on('error',()=>{console.error('SERVER_LISTEN_FAILED');process.exitCode=1;void stop()})
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>void stop())
// Optional local process-manager IPC uses the same drain as OS signals. No HTTP shutdown route.
process.on('message',message=>{if(message&&typeof message==='object'&&'type' in message&&message.type==='lifeos_shutdown')void stop().finally(()=>process.disconnect?.())})
