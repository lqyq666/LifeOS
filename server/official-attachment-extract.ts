import {Worker} from 'node:worker_threads'
import {createHash} from 'node:crypto'
import type {AttachmentExtraction} from './official-attachment-parser.ts'
export async function extractOfficialAttachment(bytes:Buffer,url:string):Promise<AttachmentExtraction>{
  const parsed=new URL(url),name=parsed.searchParams.get('filename')??parsed.pathname
  const format=/\.docx$/i.test(name)?'docx':/\.xlsx$/i.test(name)?'xlsx':'unknown'
  const failure=(errorCode:string):AttachmentExtraction=>({status:'rejected',hash:createHash('sha256').update(bytes).digest('hex'),format,text:'',warnings:[],errorCode})
  if(bytes.length>2*1024*1024)return failure('ATTACHMENT_INPUT_LIMIT')
  return new Promise(resolve=>{
    const worker=new Worker(new URL('./official-attachment-worker.ts',import.meta.url),{workerData:{bytes,format},execArgv:['--import','tsx'],resourceLimits:{maxOldGenerationSizeMb:128}})
    let settled=false
    const finish=(result:AttachmentExtraction)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();resolve(result)}
    const timer=setTimeout(()=>finish(failure('ATTACHMENT_PARSE_TIMEOUT')),10000)
    worker.once('message',finish);worker.once('error',()=>finish(failure('ATTACHMENT_PARSE_FAILED')))
    worker.once('exit',()=>{if(!settled)finish(failure('ATTACHMENT_PARSE_FAILED'))})
  })
}
