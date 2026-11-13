import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {createTurnEngine} from '../../server/agent.ts'
import {model} from '../../server/model.ts'
import {config} from '../../server/config.ts'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {setMemorySettings} from '../../server/memory.ts'
import {localEmbedding} from '../../server/local-embedding.ts'
import {decisionOrderRelation,type DecisionProposal} from '../../server/decision-comparison.ts'

type ProviderEnding={finishReason?:'stop'|'length';includeUsage?:boolean}

// Real engine/store boundaries; only the external provider is simulated.
export async function residualHarness(){
 const database=(await pool.query('SELECT current_database() AS name')).rows[0].name
 assert.match(database,/^lifeos_dialogue_test_/)
 const outputs:{body:string|Record<string,unknown>;ending:ProviderEnding}[]=[],requests:any[]=[],emitted:Record<string,unknown>[]=[],original={url:model.baseUrl,key:config.apiKey}
 const fake=createServer((req,res)=>{
  const chunks:Buffer[]=[];req.on('data',chunk=>chunks.push(Buffer.from(chunk)))
  req.on('end',()=>{
   const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));requests.push(payload)
   const fixture=outputs.shift()
   if(!fixture){res.writeHead(500);res.end('UNEXPECTED_SYNTHETIC_CALL');return}
   const {body:generated,ending}=fixture
   const out:Record<string,any>=typeof generated==='string'?{}:generated
   const allowed=payload.response_format?.json_schema?.schema?.properties?.reply?.enum
   if(allowed?.length)out.reply=allowed[0]
   // Ancillary private proposal fixture for ownership/state tests only. These
   // conservative fake decisions are never a semantic-quality acceptance.
   if(payload.response_format?.json_schema?.schema?.required?.includes('decisionProposal')&&!Object.hasOwn(out,'decisionProposal')){
    const ctx=JSON.parse(payload.messages.find((m:any)=>m.role==='user'&&m.content.startsWith('{')).content).decisionPlanContract
    const first=ctx.cases.filter((c:any)=>c.candidateKinds.some((x:string)=>['advance','prepare'].includes(x))&&out.reply.includes(c.title)).sort((a:any,b:any)=>out.reply.indexOf(a.title)-out.reply.indexOf(b.title))[0]
    const items=ctx.cases.map((c:any)=>({eventId:c.eventId,mode:c.candidateKinds.length===1&&c.candidateKinds.includes('none')?'leave_stopped':c===first&&(ctx.minuteCeiling===null||ctx.minuteCeiling>0)?c.candidateKinds.includes('advance')?'do_now':'prepare_only':'wait',minutesCeiling:c===first?ctx.minuteCeiling===null?null:Math.min(ctx.minuteCeiling,1):0})) as DecisionProposal['items']
    const prior=ctx.previousProposal?.firstChoiceUnavailable?undefined:ctx.previousProposal?.items.find((i:any)=>['do_now','prepare_only'].includes(i.mode)&&(i.minutesCeiling===null||i.minutesCeiling>0)),old=ctx.cases.find((c:any)=>c.eventId===prior?.eventId)
    const change=(first?'本轮优先：'+first.title:'本轮暂不安排动作')+'。'+(old?'上次优先：'+old.title+'。':'')+'按本轮已核对条件讨论。',stable='已知记录和未知边界保持不变。'
    out.reply=change+'\n'+out.reply+'\n'+stable
    out.decisionProposal={items:items.map(item=>({caseIndex:ctx.cases.findIndex((c:any)=>c.eventId===item.eventId),kind:ctx.cases.find((c:any)=>c.eventId===item.eventId).candidateKinds[item.mode==='prepare_only'?Math.max(0,ctx.cases.find((c:any)=>c.eventId===item.eventId).candidateKinds.indexOf('prepare')):0],minutesCeiling:item.minutesCeiling}))}
   }
   const schemaOrder=Object.keys(payload.response_format?.json_schema?.schema?.properties??{})
   if(schemaOrder[0]==='answer'||payload.messages.some((message:any)=>message.role==='system'&&message.content.includes('JSON首字段是answer对象'))){
    if(!Object.hasOwn(out,'answer'))out.answer={deliver:out.reply}
    delete out.reply
   }
   const ordered=Object.fromEntries([...schemaOrder.filter(key=>Object.hasOwn(out,key)),...Object.keys(out).filter(key=>!schemaOrder.includes(key))].map(key=>[key,out[key]]))
   const base={id:'synthetic-residual-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id}
   res.writeHead(200,{'Content-Type':'text/event-stream'})
   res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{content:typeof generated==='string'?generated:JSON.stringify(ordered)},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:ending.finishReason??'stop'}],usage:ending.includeUsage===false?undefined:{prompt_tokens:200,completion_tokens:100,total_tokens:300}})+'\n\ndata: [DONE]\n\n')
  })
 })
 await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve))
 model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port;config.apiKey='synthetic-residual-only'
 const engine=createTurnEngine({capabilityVerified:()=>true}),signal=new AbortController().signal
 return {
  requests,emitted,
  async account(){
   const user='residual-'+randomUUID(),chat=randomUUID()
   await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
   await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
   await store.createConversation(user,{id:chat,title:'SYNTHETIC residual acceptance'})
   return {user,chat}
  },
  async execute(user:string,chat:string,text:string,extra:string|Record<string,unknown>|((run:store.Run)=>Record<string,unknown>)={},reply='已依据你本轮原话核对，未说明的情况保持未知。',contextBoundary?:(rows:Awaited<ReturnType<typeof store.contextForRun>>)=>Awaited<ReturnType<typeof store.contextForRun>>,ending:ProviderEnding={}){
   const before=requests.length
   const {run}=await store.startRun(user,chat,randomUUID(),text),staged:store.Staged={candidates:[],audit:[]}
   outputs.push({body:typeof extra==='string'?extra:{reply,...(typeof extra==='function'?extra(run):extra)},ending})
   const rows=await store.contextForRun(run)
   let result:Awaited<ReturnType<typeof engine>>
   try{result=await engine({run,staged,context:contextBoundary?contextBoundary(rows):rows,decision:null,signal,emit:event=>emitted.push(event)})}
   catch(error){if(requests.length===before)outputs.pop();throw error}
   await store.finishRun(run,staged,result.text,result.usage,signal)
   if(requests.length===before)outputs.pop() // existing deterministic control acknowledgement
   assert.ok(requests.length===before||requests.length===before+1,'no extraction or repair calls')
   return run
  },
  async close(){
   model.baseUrl=original.url;config.apiKey=original.key
   fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(()=>resolve()))
   await localEmbedding.close();await pool.end()
  }
 }
}
