import {entitlementView} from './entitlements.ts'
import { coachHistoryView } from './coach-history.ts'
import { searchCoachEvents } from './coach-retrieval.ts'
import { eventSearchSchema } from './action-coach-contracts.ts'
import { openingQuestionDraft } from './reply-draft.ts'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { auth } from './auth.ts'
import { config, credentialReady } from './config.ts'
import { model, modelCapabilityVerified, availableModelTiers } from './model.ts'
import { pool, HttpError } from './db.ts'
import { runAgent, type Engine } from './agent.ts'
import { validate, validateId, createChatSchema, chatPatchSchema, messageSchema, experienceActionSchema, memorySettingsSchema, memoryActionSchema } from './contracts.ts'
import * as store from './store.ts'
import * as memory from './memory.ts'
import { clientIP, modelState, checkModelCooldown, recordModelFailure, recordModelSuccess, checkMessageLimit } from './operations.ts'
import { loadSnapshot } from './memory.ts'
import { isKnownMajorQuestion, readKnownMajor } from './model-router.ts'
import {campusView} from './campus.ts'
import { RequestScheduler } from './request-scheduler.ts'
import { coachEventView } from './action-coach-events.ts'
import { localEmbedding } from './local-embedding.ts'
import { growthView, createGrowthItem, actOnGrowthItem } from './growth.ts'
import { growthCreateSchema, growthActionSchema } from './growth-contracts.ts'
import { officialSourcesView } from './official-sources.ts'
import { officialPaths } from './official-paths.ts'

export function modelReady() {
  return credentialReady()&&modelCapabilityVerified('default')
}
async function body(req:IncomingMessage){
  if(!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(415,'JSON_REQUIRED')
  let size=0;const chunks:Buffer[]=[]
  for await(const chunk of req){size+=chunk.length;if(size>65536)throw new HttpError(413,'REQUEST_TOO_LARGE');chunks.push(chunk)}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown}catch{throw new HttpError(400,'INVALID_JSON')}
}
function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
function sse(res:ServerResponse,event:unknown){if(!res.destroyed&&!res.writableEnded)res.write('data: '+JSON.stringify(event)+'\n\n')}
export function createApp(engine:Engine=runAgent,runTimeoutMs=180000){
  const modelManaged=engine.modelManaged===true,engineReady=()=>engine.modelReadiness?.()??modelReady()
  const active=new Map<string,AbortController>()
  const scheduler=new RequestScheduler(config.generationConcurrency,config.generationQueueLimit)
  let shuttingDown=false
  const authHandler=toNodeHandler(auth)
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff')
    res.setHeader('X-Frame-Options','DENY')
    res.setHeader('Referrer-Policy','same-origin')
    if(config.production)res.setHeader('Strict-Transport-Security','max-age=31536000')
    // Overwrite the private header using the socket; clients cannot choose their rate-limit bucket.
    req.headers['x-lifeos-client-ip']=clientIP(req.socket.remoteAddress??'unknown',typeof req.headers['x-real-ip']==='string'?req.headers['x-real-ip']:undefined)
    try{
      const url=new URL(req.url??'/',config.origin), path=url.pathname, method=req.method??'GET'
      if(path==='/api/access-policy'&&method==='GET'){json(res,200,{signupEnabled:config.signupEnabled});return}
      if(path==='/api/health'&&method==='GET'){await pool.query('SELECT 1');json(res,200,{database:'postgresql',model:model.id,modelTiers:availableModelTiers(),capabilitiesVerified:modelReady(),provider:await modelState(),providerCheckedByHealth:false});return}
      if(path==='/api/ready'&&method==='GET'){await pool.query('SELECT id FROM lifeos_model_state WHERE id=1');const ready=!shuttingDown&&localEmbedding.healthy;json(res,ready?200:503,{ready,scope:'application-database-and-offline-embedding',embedding:{ready:localEmbedding.healthy,offline:true},modelLiveVerified:false});return}
      if(shuttingDown)throw new HttpError(503,'SERVER_SHUTTING_DOWN',10)
      if(!['GET','HEAD'].includes(method)&&req.headers.origin!==config.origin)throw new HttpError(403,'ORIGIN_REJECTED')
      if(Number(req.headers['content-length']??0)>65536)throw new HttpError(413,'REQUEST_TOO_LARGE')
      if(path.startsWith('/api/auth/')){await authHandler(req,res);return}
      if(path.startsWith('/api/')){
        const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)})
        if(!session)throw new HttpError(401,'LOGIN_REQUIRED')
        // Effective identity is always derived here. No body, URL or model field can override it.
        const user=session.user.id
        if(path==='/api/access'&&method==='GET'){json(res,200,await entitlementView(user));return}
        if(path==='/api/session'&&method==='GET'){json(res,200,{id:user,name:session.user.name,email:session.user.email});return}
        if(path==='/api/official-sources'&&method==='GET'){json(res,200,await officialSourcesView());return}
        if(path==='/api/official-paths'&&method==='GET'){json(res,200,{paths:officialPaths});return}
        if(path==='/api/growth'&&method==='GET'){const conversation=url.searchParams.get('conversation');json(res,200,await growthView(user,conversation?validateId(conversation):undefined));return}
        if(path==='/api/growth'&&method==='POST'){json(res,201,await createGrowthItem(user,validate(growthCreateSchema,await body(req))));return}
        const growthAction=path.match(/^\/api\/growth\/([^/]+)\/actions$/)
        if(growthAction&&method==='POST'){json(res,200,await actOnGrowthItem(user,validateId(growthAction[1]),validate(growthActionSchema,await body(req))));return}
        const history=path.match(/^\/api\/conversations\/([^/]+)\/history$/)
        if(history&&method==='GET'){json(res,200,await coachHistoryView(user,validateId(history[1])));return}
        const search=path.match(/^\/api\/conversations\/([^/]+)\/event\/search$/)
        if(search&&method==='POST'){json(res,200,await searchCoachEvents(user,validateId(search[1]),validate(eventSearchSchema,await body(req))));return}
        const coach=path.match(/^\/api\/conversations\/([^/]+)\/event$/)
        if(coach&&method==='GET'){
          const event=url.searchParams.get('id')
          json(res,200,await coachEventView(user,validateId(coach[1]),event?validateId(event):undefined));return
        }
        const campus=path.match(/^\/api\/conversations\/([^/]+)\/campus$/)
        if(campus&&method==='GET'){json(res,200,await campusView(user,validateId(campus[1])));return}
        if(path==='/api/memory'&&method==='GET'){const conversation=url.searchParams.get('conversation');json(res,200,await memory.getMemoryView(user,conversation?validateId(conversation):undefined));return}
        if(path==='/api/memory/settings'&&method==='POST'){json(res,200,await memory.setMemorySettings(user,validate(memorySettingsSchema,await body(req))));return}
        const memoryAction=path.match(/^\/api\/memory\/([^/]+)\/actions$/)
        if(memoryAction&&method==='POST'){json(res,200,await memory.applyMemoryAction(user,validateId(memoryAction[1]),validate(memoryActionSchema,await body(req))));return}
        if(path==='/api/conversations'&&method==='GET'){json(res,200,await store.listConversations(user));return}
        if(path==='/api/conversations'&&method==='POST'){json(res,201,await store.createConversation(user,validate(createChatSchema,await body(req))));return}
        const chat=path.match(/^\/api\/conversations\/([^/]+)$/)
        if(chat&&method==='PATCH'){json(res,200,await store.patchConversation(user,validateId(chat[1]),validate(chatPatchSchema,await body(req))));return}
        const decisions=path.match(/^\/api\/conversations\/([^/]+)\/decisions$/)
        if(decisions&&method==='GET'){json(res,200,await store.decisionVersions(user,validateId(decisions[1])));return}
        if(path==='/api/experiences'&&method==='GET'){
          const conversation=url.searchParams.get('conversation');json(res,200,await store.listExperiences(user,conversation?validateId(conversation):undefined));return
        }
        const experience=path.match(/^\/api\/experiences\/([^/]+)\/actions$/)
        if(experience&&method==='POST'){json(res,200,await store.experienceAction(user,validateId(experience[1]),validate(experienceActionSchema,await body(req))));return}
        if(path==='/api/cognition'&&method==='GET'){json(res,200,await store.cognitionGraph(user));return}
        const runStatus=path.match(/^\/api\/runs\/([^/]+)$/)
        if(runStatus&&method==='GET'){json(res,200,await store.runStatus(user,validateId(runStatus[1])));return}
        const cancel=path.match(/^\/api\/runs\/([^/]+)\/cancel$/)
        if(cancel&&method==='POST'){
          const id=validateId(cancel[1]);active.get(user+':'+id)?.abort()
          json(res,200,await store.terminateRun(user,id,'cancelled','USER_CANCELLED'));return
        }
        const send=path.match(/^\/api\/conversations\/([^/]+)\/messages$/)
        if(send&&method==='POST'){
          const input=validate(messageSchema,await body(req)), conversation=validateId(send[1])
          if(modelManaged){
            const exists=(await pool.query('SELECT 1 FROM runs WHERE user_id=$1 AND request_id=$2',[user,input.requestId])).rowCount
            if(!exists){
              await checkMessageLimit(user)
              const knownFactAnswer=isKnownMajorQuestion(input.text)?readKnownMajor(input.text,(await loadSnapshot(user,conversation,input.text)).profile):undefined
              if(!knownFactAnswer){if(!engineReady())throw new HttpError(503,'MODEL_CAPABILITY_TEST_REQUIRED');await checkModelCooldown()}
            }
          }
          const started=await store.startRun(user,conversation,input.requestId,input.text)
          const run=started.run
          if(started.replay){
            if(run.status==='running')throw new HttpError(409,'RUN_IN_PROGRESS')
            if(run.status!=='completed')throw new HttpError(409,'RUN_'+run.status.toUpperCase())
            const response=await store.validRunResponse(user,run.request_id,run.response)
            res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-store'});sse(res,{type:'done',...response,replayed:true});res.end();return
          }
          const controller=new AbortController(),key=user+':'+run.request_id;active.set(key,controller)
          if(shuttingDown)controller.abort('SERVER_SHUTTING_DOWN')
          const timer=setTimeout(()=>controller.abort('MODEL_TIMEOUT'),runTimeoutMs)
          res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders()
          sse(res,{type:'started',requestId:run.request_id,sourceMessageId:run.source_message_id})
          const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n')},10000)
          const closed=()=>{if(!res.writableEnded){controller.abort();void store.terminateRun(user,run.request_id,'cancelled','CLIENT_DISCONNECTED').catch(()=>{})}}
          res.on('close',closed)
          if(res.destroyed)closed()
          const staged:store.Staged={candidates:[],audit:[]}
          let release:(()=>void)|undefined
          try{
            release=await scheduler.acquire(user,controller.signal,()=>sse(res,{type:'queued',requestId:run.request_id}))
            controller.signal.throwIfAborted()
            sse(res,{type:'processing',requestId:run.request_id})
            const context=await store.contextForRun(run),versions=await store.decisionVersions(user,conversation)
            const safeEvents:Record<string,unknown>[]=[]
            const result=await engine({run,staged,context,decision:versions[0]?.payload,signal:controller.signal,emit:event=>{
              if(controller.signal.aborted)return
              if(event.type==='draft'&&typeof event.text==='string'&&event.saved===false&&openingQuestionDraft(JSON.stringify({reply:event.text}))===event.text)sse(res,{type:'draft',text:event.text,saved:false})
              if(event.type==='draft_discarded')sse(res,{type:'draft_discarded'})
              if(event.type==='tool'&&typeof event.name==='string'&&typeof event.status==='string')safeEvents.push(event)
            }})
            const response=await store.finishRun(run,staged,result.text,result.usage,controller.signal,staged.dialoguePath,staged.upstreamCalls)
            if(modelManaged&&staged.upstreamCalls)await recordModelSuccess().catch(()=>{})
            for(const event of safeEvents)sse(res,event)
            sse(res,{type:'delta',text:result.text,replace:true,saved:true})
            sse(res,{type:'done',...response})
          }catch(error){
            const timedOut=controller.signal.reason==='MODEL_TIMEOUT',cancelled=controller.signal.aborted&&!timedOut
            const failure=timedOut?new HttpError(504,'MODEL_TIMEOUT',15):error instanceof HttpError?error:new HttpError(502,'MODEL_REQUEST_FAILED',15)
            const code=cancelled?(controller.signal.reason==='SERVER_SHUTTING_DOWN'?'SERVER_SHUTTING_DOWN':'CANCELLED'):failure.code
            if(!cancelled&&modelManaged&&code.startsWith('MODEL_'))await recordModelFailure(failure).catch(()=>{})
            await store.terminateRun(user,run.request_id,cancelled?'cancelled':'failed',code)
            await pool.query('UPDATE runs SET usage=$3,tool_audit=$4 WHERE user_id=$1 AND request_id=$2',[user,run.request_id,staged.modelUsage??null,JSON.stringify(staged.audit)]).catch(()=>{})
            sse(res,{type:'draft_discarded'})
            sse(res,{type:'error',code,status:cancelled?409:failure.status,retryAfter:cancelled?undefined:failure.retryAfter})
            console.info(JSON.stringify({event:'run_finished',requestId:run.request_id,status:cancelled?'cancelled':'failed',code}))
          }finally{release?.();clearTimeout(timer);clearInterval(heartbeat);active.delete(key);res.off('close',closed);res.end()}
          return
        }
        throw new HttpError(404,'NOT_FOUND')
      }
      // Optional built frontend, scoped strictly to dist. Never expose server files or environment files.
      if(method==='GET'||method==='HEAD'){
        const base=resolve('dist'),target=resolve(base,'.'+decodeURIComponent(path))
        if(!target.startsWith(base+sep)&&target!==base)throw new HttpError(404,'NOT_FOUND')
        if(extname(target)&&!existsSync(target))throw new HttpError(404,'NOT_FOUND')
        const file=existsSync(target)&&extname(target)?target:resolve(base,'index.html')
        if(!existsSync(file))throw new HttpError(404,'FRONTEND_NOT_BUILT')
        const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json'}
        res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Cache-Control':'no-cache'})
        res.end(method==='HEAD'?undefined:readFileSync(file));return
      }
      throw new HttpError(404,'NOT_FOUND')
    }catch(error){
      const status=error instanceof HttpError?error.status:500,code=error instanceof HttpError?error.code:'INTERNAL_ERROR'
      const retryAfter=error instanceof HttpError?error.retryAfter:undefined
      if(retryAfter&&!res.headersSent)res.setHeader('Retry-After',String(retryAfter))
      if(res.headersSent){sse(res,{type:'error',code,status,retryAfter});res.end()}else json(res,status,{error:code,retryAfter})
      if(status===500)console.error('INTERNAL_ERROR',error instanceof Error?error.name:'unknown')
    }
  })
  server.on('close',()=>{for(const controller of active.values())controller.abort()})
  server.headersTimeout=15000
  server.requestTimeout=60000
  return Object.assign(server,{drain:async()=>{
    shuttingDown=true
    const entries=[...active.entries()];for(const [,controller] of entries)controller.abort('SERVER_SHUTTING_DOWN')
    await Promise.all(entries.map(([key])=>{const split=key.lastIndexOf(':');return store.terminateRun(key.slice(0,split),key.slice(split+1),'cancelled','SERVER_SHUTTING_DOWN')}))
  }})
}
