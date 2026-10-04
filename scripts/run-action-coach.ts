import {randomUUID,createHash} from 'node:crypto'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createInterface} from 'node:readline'
import {Client} from 'pg'
import {config} from '../server/config.ts'
import {assertCoachSourceFreeze} from './coach-source-freeze.ts'
import {CoachProviderBudget} from './coach-provider-budget.ts'
import {coachBudgetObserver} from './coach-budget-observer.ts'
import {collectCoachStream,coachSpeedSummary} from './coach-stream-evidence.ts'

// Operator supplies synthetic user answers after reading each actual reply.
// Hidden fixture facts and review criteria are never included in model requests.
const preflight=process.argv.includes('--preflight')
if(preflight&&process.argv.includes('--paid'))throw new Error('PREFLIGHT_AND_PAID_ARE_MUTUALLY_EXCLUSIVE')
if(!preflight&&!process.argv.includes('--paid'))throw new Error('Explicit --paid or no-provider --preflight is required; no provider request made.')
const option=(name:string)=>{const i=process.argv.indexOf(name),value=process.argv[i+1];if(i<0||!value||value.startsWith('--'))throw new Error(name+' is required');return value}
const freezePath=resolve(option('--freeze')),sourceDigest=assertCoachSourceFreeze(freezePath)
const budget=new CoachProviderBudget(),availableBudget=budget.snapshot();if(!preflight&&availableBudget.remaining<1&&!(availableBudget.additional&&!availableBudget.additional.paused&&availableBudget.additional.remainingCny>0))throw new Error('AUTHORIZED_PROVIDER_CALL_BUDGET_EXHAUSTED')
const mainURL=new URL(config.databaseUrl)
if(!['127.0.0.1','localhost','::1'].includes(mainURL.hostname)||decodeURIComponent(mainURL.pathname.slice(1))!=='lifeos')throw new Error('LOCAL_PRIMARY_IDENTITY_REQUIRED')
const runId='coach-'+randomUUID(),databaseName='lifeos_dialogue_live_'+randomUUID().replaceAll('-',''),target=new URL(mainURL)
target.pathname='/'+databaseName
const directory=resolve('evidence/v1.3-action-coach/real',runId),privateDirectory=resolve('.local/v1.3-action-coach',runId)
mkdirSync(directory,{recursive:true});mkdirSync(privateDirectory,{recursive:true})
const fixtureBytes=readFileSync('tests/fixtures/action-coach-trajectories.json'),fixture=JSON.parse(fixtureBytes.toString())
const report:any={runId,evidence:preflight?'REAL_HTTP_AUTH_ISOLATED_POSTGRESQL_NO_PROVIDER_PREFLIGHT':'REAL_PROVIDER_REAL_HTTP_REAL_AUTH_REAL_ISOLATED_POSTGRESQL_SYNTHETIC_USER',sourceDigest,fixtureSha256:createHash('sha256').update(fixtureBytes).digest('hex'),databaseName,createdAt:new Date().toISOString(),status:'NOT_READY',humanSemanticReview:'PENDING',turns:[],operations:[],trajectoryConversations:{},maximumUserTurns:47,automaticRetry:false}
const save=()=>{report.speed=coachSpeedSummary(report.turns);writeFileSync(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n')}
save()
const admin=new Client({connectionString:mainURL.href});await admin.connect()
try{await admin.query(`CREATE DATABASE "${databaseName}"`)}finally{await admin.end()}
// Configure the isolated target before loading any pool/auth/application modules.
config.databaseUrl=target.href
const {pool,transaction}=await import('../server/db.ts')
const {seedCoachHistoryFixture}=await import('./coach-history-fixture.ts')
let app:ReturnType<typeof import('../server/http.ts').createApp>|undefined,stopIndex:(()=>Promise<void>)|undefined
let inputLines:ReturnType<typeof createInterface>|undefined
const {localEmbedding}=await import('../server/local-embedding.ts')
try{
  // Verify the actual pool target, not just mutable configuration. Refuse before
  // any migration/write even if a future import accidentally initializes it early.
  const actual=(await pool.query('SELECT current_database() AS database')).rows[0].database
  if(actual!==databaseName||!/^lifeos_dialogue_live_[a-f0-9]{32}$/.test(actual))throw new Error('ACTUAL_POOL_TARGET_IS_NOT_THIS_DISPOSABLE_DATABASE')
  const {readdirSync}=await import('node:fs')
  await pool.query('CREATE TABLE lifeos_schema_migrations (name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())')
  for(const name of readdirSync('server/migrations').filter(name=>name.endsWith('.sql')).sort()){
    const sql=readFileSync(resolve('server/migrations',name),'utf8')
    await transaction(async client=>{await client.query(sql);await client.query('INSERT INTO lifeos_schema_migrations(name,sha256) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')])})
  }
  // Import only the reviewed primary-source definition into this new isolated
  // database. Hash-check its actual downloaded PDF, not a search snippet.
  const cardsPath=resolve('evidence/v1.3-action-coach/research/verified-method-cards.json')
  const cardsBytes=readFileSync(cardsPath),cards=JSON.parse(cardsBytes.toString())
  const pdfBytes=readFileSync(resolve('.local/v1.3-action-coach/research/implementation-intentions-2006.pdf'))
  const pdfHash=createHash('sha256').update(pdfBytes).digest('hex')
  if(cards.length!==1||cards[0].id!=='a5f7c3ba-0872-4184-a806-7eaacb71576c'||cards[0].revision!==1||cards[0].synthetic!==false||cards[0].sourceHash!==pdfHash)throw new Error('REVIEWED_PRIMARY_SOURCE_CHANGED')
  const {importKnowledge}=await import('../server/campus-knowledge.ts')
  const imported=await importKnowledge(cards)
  report.operations.push({operation:'importVerifiedPrimarySource',evidence:'ACTUAL_VERIFIED_SOURCE_IMPORTED_IN_ISOLATED_DATABASE_NOT_PROVIDER_RESULT',databaseName,cardsSha256:createHash('sha256').update(cardsBytes).digest('hex'),pdfSha256:pdfHash,sources:cards.map((card:any)=>({id:card.id,revision:card.revision,sourceHash:card.sourceHash})),result:imported,paidCalls:0});save()
  const {createTurnEngine}=await import('../server/turn-engine.ts'),{modelCapabilityVerified}=await import('../server/model.ts')
  if(!preflight&&!modelCapabilityVerified('default'))throw new Error('MODEL_CAPABILITY_TEST_REQUIRED')
  await localEmbedding.start()
  // Better Auth captures trustedOrigins at import time; bind the review origin
  // before importing HTTP/auth, rather than changing it after construction.
  const {createServer}=await import('node:net'),portReservation=createServer()
  await new Promise<void>(ready=>portReservation.listen(0,'127.0.0.1',ready))
  const port=(portReservation.address() as {port:number}).port,origin='http://127.0.0.1:'+port
  await new Promise<void>(done=>portReservation.close(()=>done()))
  config.origin=origin
  const {createApp}=await import('../server/http.ts'),{startCoachIndexing}=await import('../server/coach-retrieval.ts')
  const providerCallObserver=coachBudgetObserver({runId,freezePath,budget})
  const reserveProviderCall=providerCallObserver.before
  providerCallObserver.before=async call=>{
    try{await reserveProviderCall(call)}catch(error){
      // Local pre-network failures must not masquerade as provider failures.
      // Capture codes only: error messages can contain paths or credentials.
      const failure=error as {code?:string;message?:string;syscall?:string}
      const code=typeof failure.code==='string'?failure.code:typeof failure.message==='string'&&/^[A-Z_]+$/.test(failure.message)?failure.message:'LOCAL_RESERVATION_FAILED'
      report.operations.push({operation:'providerReservationFailed',code,syscall:failure.syscall??null,providerRequestSent:false});save()
      throw error
    }
  }
  providerCallObserver.payload=(call,payload)=>{
    const text=JSON.stringify(payload),name='request-'+call.requestId+'-'+call.purpose+'.json'
    writeFileSync(resolve(privateDirectory,name),text,{flag:'wx',mode:0o600})
    const request=payload as any
    report.providerRequests??=[]
    report.providerRequests.push({logicalCallId:call.callId,purpose:call.purpose,sha256:createHash('sha256').update(text).digest('hex'),chars:text.length,model:request.model,enableThinking:request.enable_thinking,temperature:request.temperature,responseFormat:request.response_format?.type,maxCompletionTokens:request.max_completion_tokens,evidence:'ACTUAL_SDK_OUTGOING_BODY_PRIVATE_SYNTHETIC_CONTEXT_NO_CREDENTIAL_HEADERS'})
    save()
  }
  providerCallObserver.output=(call,text)=>{
    // Only this isolated synthetic acceptance entry point opts into raw JSON
    // capture. Credentials and private login are never in the model context.
    const name='raw-'+call.requestId+'-'+call.purpose+'.txt',path=resolve(privateDirectory,name)
    writeFileSync(path,text,{flag:'wx',mode:0o600})
    report.rawOutputs??=[]
    report.rawOutputs.push({logicalCallId:call.callId,purpose:call.purpose,path:'.local/v1.3-action-coach/'+runId+'/'+name,sha256:createHash('sha256').update(text).digest('hex'),chars:text.length,evidence:'ACTUAL_SYNTHETIC_ACCEPTANCE_MODEL_TEXT_NOT_REASONING_NOT_VISIBLE_UNLESS_VALIDATED'})
    save()
  }
  app=createApp(createTurnEngine({providerCallObserver}))
  await new Promise<void>((ready,reject)=>{app!.once('error',reject);app!.listen(port,'127.0.0.1',ready)})
  stopIndex=startCoachIndexing()
  const email=runId+'@example.invalid',password='Synthetic-'+randomUUID()
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password,name:'Synthetic V1.3 review'})})
  if(!signup.ok)throw new Error('SIGNUP_FAILED_'+signup.status)
  const cookie=signup.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  // Private review login is local-only; excluded from evidence and source packages.
  writeFileSync(resolve(privateDirectory,'review-session.json'),JSON.stringify({origin,email,password,databaseName,runId}),{mode:0o600})
  const headers={Origin:origin,'Content-Type':'application/json',Cookie:cookie}
  const api=async(path:string,body?:unknown)=>{
    const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)})
    if(!response.ok)throw new Error('HTTP_'+response.status+':'+await response.text())
    return response.json() as Promise<any>
  }
  const user=(await api('/api/session')).id
  report.origin=origin;save()
  console.log(JSON.stringify({ready:true,runId,origin,directory,databaseName,instructions:'JSONL stdin: {trajectory:A01..A08,text:<explicit user answer>,sampleClass:opening|ordinary_followup|long_material}. {newConversation:true} creates a new conversation for the same trajectory. {operation:memorySettings,value:{requestId:<uuid>,enabled:true,expectedRevision:<current revision>}}. {operation:exit} drains and preserves this isolated DB for formal UI review. No automatic answers/retries.'}))
  if(preflight){
    const conversation=await api('/api/conversations',{id:randomUUID(),title:'NO PROVIDER preflight'})
    const event=await api('/api/conversations/'+conversation.id+'/event')
    if(event!==null)throw new Error('PREFLIGHT_EVENT_SHOULD_BE_EMPTY')
    const memory=await api('/api/memory?conversation='+conversation.id)
    report.preflight={actualDatabase:databaseName,auth:true,conversation:true,eventRead:true,memoryRead:!!memory,paidCalls:0};save()
    console.log(JSON.stringify({preflight:'PASS',...report.preflight}))
  }else for await(const line of (inputLines=createInterface({input:process.stdin,crlfDelay:Infinity}))){
    if(!line.trim())continue
    assertCoachSourceFreeze(freezePath)
    const command=JSON.parse(line)
    if(command.operation==='exit')break
    if(command.operation==='readMemory'){
      const value=await api('/api/memory');console.log(JSON.stringify({operation:'readMemory',value}));continue
    }
    if(command.operation==='revokeVerifiedSource'){
      const card=cards.find((card:any)=>card.id===command.sourceId)
      if(!card||report.operations.some((item:any)=>item.operation==='revokeVerifiedSource'&&item.sourceId===card.id))throw new Error('SOURCE_NOT_IMPORTED_OR_ALREADY_REVOKED')
      const result=await importKnowledge([{...card,revision:card.revision+1,status:'revoked'}])
      report.operations.push({operation:'revokeVerifiedSource',sourceId:card.id,previousRevision:card.revision,revision:card.revision+1,result,paidCalls:0});save()
      console.log(JSON.stringify({operation:'revokeVerifiedSource',sourceId:card.id,revision:card.revision+1,paidCalls:0}));continue
    }
    if(command.operation==='memorySettings'){
      const value=await api('/api/memory/settings',command.value)
      report.operations.push({at:new Date().toISOString(),operation:'memorySettings',value});save();console.log(JSON.stringify({operation:'memorySettings',value}));continue
    }
    if(command.operation==='seedA07Distractors'){
      if(report.operations.some((operation:any)=>operation.operation==='seedA07Distractors'))throw new Error('A07_SETUP_ALREADY_APPLIED')
      const conversationId=report.trajectoryConversations.A01
      if(!conversationId||!report.turns.some((turn:any)=>turn.trajectory==='A01'&&turn.status==='SAVED'&&turn.event))throw new Error('ACTUAL_A01_EVENT_REQUIRED_BEFORE_A07_SETUP')
      const count=fixture.trajectories.find((item:any)=>item.id==='A07').distractorCount
      if(count!==45)throw new Error('FROZEN_A07_DISTRACTOR_COUNT_CHANGED')
      const seeded=await seedCoachHistoryFixture(user,conversationId,count)
      report.operations.push({operation:'seedA07Distractors',conversationId,...seeded});save()
      console.log(JSON.stringify({operation:'seedA07Distractors',count,paidCalls:0,quotaEffect:seeded.quotaEffect}));continue
    }
    if(!fixture.trajectories.some((item:any)=>item.id===command.trajectory)||typeof command.text!=='string'||!command.text.trim()||command.text.length>16000||!['opening','ordinary_followup','long_material'].includes(command.sampleClass))throw new Error('EXPLICIT_TRAJECTORY_TEXT_AND_SAMPLE_CLASS_REQUIRED')
    if(report.turns.length>=47)throw new Error('MAXIMUM_USER_TURNS_REACHED')
    const id=command.trajectory
    if(!report.trajectoryConversations[id]||command.newConversation){
      const conversation=await api('/api/conversations',{id:randomUUID(),title:'V1.3 '+id})
      report.trajectoryConversations[id]=conversation.id
    }
    const conversationId=report.trajectoryConversations[id],requestId=randomUUID()
    const turn:any={trajectory:id,conversationId,requestId,input:command.text,sampleClass:command.sampleClass,startedAt:new Date().toISOString(),status:'RESERVED_USER_TURN'}
    report.turns.push(turn);save() // Input/classification durable before any model request.
    try{
      const started=performance.now()
      const response=await fetch(origin+'/api/conversations/'+conversationId+'/messages',{method:'POST',headers,body:JSON.stringify({requestId,text:command.text})})
      const measured=await collectCoachStream(response,started)
      Object.assign(turn,measured,{status:'SAVED',providerCallCount:measured.done.upstreamCalls,event:await api('/api/conversations/'+conversationId+'/event')})
      console.log(JSON.stringify({trajectory:id,turn:report.turns.length,...measured}))
    }catch(error){turn.status='FAILED';turn.error=error instanceof Error?error.message:'UNKNOWN';turn.streamEvidence=(error as any)?.streamEvidence??null;console.log(JSON.stringify({trajectory:id,turn:report.turns.length,error:turn.error,retry:false}))}
    finally{report.providerCalls=budget.snapshot().calls.filter((call:any)=>call.runId===runId);save()}
  }
}finally{
  inputLines?.close();process.stdin.pause()
  await app?.drain();await stopIndex?.();if(app)await new Promise<void>(done=>app!.close(()=>done()))
  await localEmbedding.close();await pool.end()
  if(preflight){
    // This exact newly created preflight database is empty of real user data.
    const cleanup=new Client({connectionString:mainURL.href});await cleanup.connect()
    try{if(!/^lifeos_dialogue_live_[a-f0-9]{32}$/.test(databaseName))throw new Error('CLEANUP_TARGET_INVALID');await cleanup.query(`DROP DATABASE "${databaseName}"`);report.preflightDatabaseRemoved=true}
    finally{await cleanup.end()}
  }
  report.closedAt=new Date().toISOString();report.status='NOT_READY';save()
  console.log(JSON.stringify({closed:true,runId,databasePreserved:preflight?false:databaseName,status:'NOT_READY',semanticReview:'PENDING'}))
}
