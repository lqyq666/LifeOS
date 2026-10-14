import {Agent,Dispatcher,buildConnector,getGlobalDispatcher,setGlobalDispatcher} from 'undici'
type Profile={provider:string;baseUrl:string}
function officialProviderUrl(profile:Profile){
 let url:URL
 try{url=new URL(profile.baseUrl)}catch{return null}
 return profile.provider==='bailian'&&url.protocol==='https:'&&url.hostname==='dashscope.aliyuncs.com'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname.replace(/\/$/,'')==='/compatible-mode/v1'?url:null
}
// Only this origin uses a persistent pool and a shared TLS-session connector.
// Coze/local requests retain the original dispatcher; SDK retries/cancel stay intact.
export function configureProviderTransport(profile:Profile,createAgent:()=>Dispatcher=()=>new Agent({keepAliveTimeout:60000,keepAliveMaxTimeout:60000,connect:buildConnector({timeout:10000})})){
 const url=officialProviderUrl(profile);if(!url)return {configured:false}
 const previous=getGlobalDispatcher(),target=createAgent()
 class ScopedDispatcher extends Dispatcher{
  dispatch(options:Dispatcher.DispatchOptions,handler:Dispatcher.DispatchHandler){return (String(options.origin)===url!.origin?target:previous).dispatch(options,handler)}
 }
 const scoped=new ScopedDispatcher();setGlobalDispatcher(scoped)
 return {configured:true,async close(){if(getGlobalDispatcher()===scoped)setGlobalDispatcher(previous);await target.close()}}
}
// Prime the official provider's DNS/TLS connection once at startup. This GET
// sends no credentials or student content and never generates model output.
// Its result is a transport hint, not capability or provider-health evidence.
export async function warmProviderConnection(profile:Profile,fetchImpl:typeof fetch=fetch){
 const started=performance.now()
 const url=officialProviderUrl(profile);if(!url)return {attempted:false}
 url.pathname='/compatible-mode/v1/models'
 try{
  const response=await fetchImpl(url,{method:'GET',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)})
  const reader=response.body?.getReader();let bytes=0
  if(reader)for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>65536){await reader.cancel();return {attempted:true,status:response.status,elapsedMs:Math.round(performance.now()-started),completed:false}}}
  return {attempted:true,status:response.status,elapsedMs:Math.round(performance.now()-started),completed:true}
 }catch{return {attempted:true,elapsedMs:Math.round(performance.now()-started),completed:false}}
}
