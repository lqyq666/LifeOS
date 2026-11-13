// Isolated real-HTTP transport fixture. No provider, probe or migrations.
import {createApp} from './server/http.ts'
import {pool} from './server/db.ts'
import {RuntimeCoordination} from './server/runtime-coordination.ts'
import {setTimeout as delay} from 'node:timers/promises'
const owner=await pool.connect()
await owner.query("SET application_name='lifeos-runtime-v2'")
const runtime=new RuntimeCoordination(owner);await runtime.maintain()
const text='SYNTHETIC 46秒完整正文：'+'每个片段与最后一句均完整保存。'.repeat(60)
const engine=async({signal,emit}:any)=>{
 console.log('SYNTHETIC_DISPATCH')
 for(let step=1;step<=23;step++){
  emit({type:'draft',text:text.slice(0,Math.ceil(text.length*step/23)),saved:false,draftKind:'stream_reply'})
  await delay(2000,undefined,{signal})
 }
 return {text,usage:null}
}
engine.modelManaged=true;engine.modelReadiness=()=>true
const app=createApp(engine,65000,undefined,runtime)
app.prependListener('request',(_req,res)=>res.setHeader('X-LifeOS-Synthetic-Instance',process.env.SYNTHETIC_INSTANCE??''))
app.listen(8787,'0.0.0.0',()=>console.log('SYNTHETIC_READY'))
let stopping=false,busy=false
const timer=setInterval(()=>{if(stopping||busy)return;busy=true;void runtime.maintain().finally(()=>{busy=false})},250)
process.on('SIGTERM',()=>{if(stopping)return;stopping=true;clearInterval(timer);void(async()=>{await app.drain();await new Promise<void>(resolve=>app.close(()=>resolve()));owner.release(true);await pool.end();console.log('SYNTHETIC_DRAINED')})()})
