// Prime the official provider's DNS/TLS connection once at startup. This GET
// sends no credentials or student content and never generates model output.
// Its result is a transport hint, not capability or provider-health evidence.
export async function warmProviderConnection(profile:{provider:string;baseUrl:string},fetchImpl:typeof fetch=fetch){
 const started=performance.now()
 let url:URL
 try{url=new URL(profile.baseUrl)}catch{return {attempted:false}}
 if(profile.provider!=='bailian'||url.protocol!=='https:'||url.hostname!=='dashscope.aliyuncs.com'||url.port||url.username||url.password||url.search||url.hash||url.pathname.replace(/\/$/,'')!=='/compatible-mode/v1')return {attempted:false}
 url.pathname='/compatible-mode/v1/models'
 try{
  const response=await fetchImpl(url,{method:'GET',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)})
  const reader=response.body?.getReader();let bytes=0
  if(reader)for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>65536){await reader.cancel();return {attempted:true,status:response.status,elapsedMs:Math.round(performance.now()-started),completed:false}}}
  return {attempted:true,status:response.status,elapsedMs:Math.round(performance.now()-started),completed:true}
 }catch{return {attempted:true,elapsedMs:Math.round(performance.now()-started),completed:false}}
}
