import {request} from 'node:https'
import {lookup} from 'node:dns/promises'

export const officialHosts=new Set(['yz.chsi.com.cn','www.zjzs.net','www.beijing.gov.cn','www.ncss.cn','portal.cscse.edu.cn','www.crs.jsj.edu.cn'])
export class OfficialFetchError extends Error{constructor(public code:string){super(code)}}
export function officialUrl(raw:string){
  let url:URL
  try{url=new URL(raw)}catch{throw new OfficialFetchError('OFFICIAL_URL_INVALID')}
  if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||url.search||!officialHosts.has(url.hostname))throw new OfficialFetchError('OFFICIAL_URL_NOT_ALLOWED')
  url.hash='';return url
}
export function officialAttachmentUrl(raw:string){
  const url=new URL(raw),plain=new URL(url);plain.search='';officialUrl(plain.href)
  if(!url.search)return officialUrl(raw)
  const keys=[...url.searchParams.keys()]
  if(url.hostname!=='www.zjzs.net'||url.pathname!=='/module/download/downfile.jsp'||keys.length!==3||!keys.every(key=>['classid','showname','filename'].includes(key))||keys.some(key=>url.searchParams.getAll(key).length!==1)||!/^\d+$/.test(url.searchParams.get('classid')??'')||! /^[a-f0-9]{32}\.(?:docx|xlsx|pdf)$/.test(url.searchParams.get('filename')??''))throw new OfficialFetchError('OFFICIAL_URL_NOT_ALLOWED')
  url.hash='';return url
}
export function publicIPv4(value:string){
  if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value))return false
  const parts=value.split('.').map(Number)
  if(parts.length!==4||parts.some(part=>!Number.isInteger(part)||part<0||part>255))return false
  const [a,b]=parts
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51)||a===203&&b===0)
}
type Page={status:number;headers:Record<string,string|undefined>;bytes:Buffer}
type Transport={resolve:(hostname:string)=>Promise<{address:string;family:number}[]>;get:(url:URL,address:string,signal:AbortSignal)=>Promise<Page>}
const maximumBytes=2*1024*1024
const transport:Transport={
  resolve:hostname=>lookup(hostname,{all:true,family:4}),
  get:(url,address,signal)=>new Promise((resolve,reject)=>{
    const req=request(url,{signal,agent:false,family:4,headers:{'Accept':'text/html','Accept-Encoding':'identity','User-Agent':'LifeOS-Official-Source-Check/1.0'},lookup:(_host,_options,cb)=>cb(null,address,4)},res=>{
      const status=res.statusCode??0,headers={location:res.headers.location,'content-type':res.headers['content-type'],'content-encoding':String(res.headers['content-encoding']??'identity')}
      if(status>=300&&status<400){res.resume();resolve({status,headers,bytes:Buffer.alloc(0)});return}
      if(Number(res.headers['content-length'])>maximumBytes){res.destroy();reject(new OfficialFetchError('OFFICIAL_BODY_TOO_LARGE'));return}
      let length=0;const chunks:Buffer[]=[]
      res.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>maximumBytes){res.destroy(new OfficialFetchError('OFFICIAL_BODY_TOO_LARGE'));return}chunks.push(chunk)})
      res.on('end',()=>resolve({status,headers,bytes:Buffer.concat(chunks)}));res.on('error',reject)
    })
    req.on('error',reject);req.end()
  }),
}
// DNS answers are checked and pinned into TLS lookup; redirects go through the
// same allowlist and IP gate. No cookie, credential, proxy or page script executes.
export async function fetchOfficialDocument(raw:string,testTransport:Transport=transport){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000)
  let url=officialUrl(raw)
  try{
    for(let redirect=0;redirect<=2;redirect++){
      const addresses=await Promise.race([testTransport.resolve(url.hostname),new Promise<never>((_resolve,reject)=>controller.signal.addEventListener('abort',()=>reject(new OfficialFetchError('OFFICIAL_FETCH_TIMEOUT')),{once:true}))])
      if(!addresses.length||addresses.some(row=>row.family!==4||!publicIPv4(row.address)))throw new OfficialFetchError('OFFICIAL_ADDRESS_REJECTED')
      const page=await testTransport.get(url,addresses[0].address,controller.signal)
      if(page.status>=300&&page.status<400){if(!page.headers.location||redirect===2)throw new OfficialFetchError('OFFICIAL_REDIRECT_LIMIT');url=officialUrl(new URL(page.headers.location,url).href);continue}
      if(page.status!==200)throw new OfficialFetchError('OFFICIAL_HTTP_FAILED')
      if(page.bytes.length>maximumBytes)throw new OfficialFetchError('OFFICIAL_BODY_TOO_LARGE')
      if(!/^text\/html\b/i.test(page.headers['content-type']??'')||!['identity',''].includes(page.headers['content-encoding']??''))throw new OfficialFetchError('OFFICIAL_CONTENT_UNSUPPORTED')
      return {url:url.href,bytes:page.bytes,contentType:page.headers['content-type']!}
    }
    throw new OfficialFetchError('OFFICIAL_REDIRECT_LIMIT')
  }catch(error){if(error instanceof OfficialFetchError)throw error;throw new OfficialFetchError(controller.signal.aborted?'OFFICIAL_FETCH_TIMEOUT':'OFFICIAL_FETCH_FAILED')}
  finally{clearTimeout(timer)}
}
