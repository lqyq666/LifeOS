import {randomUUID,createHash} from 'node:crypto'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createInterface} from 'node:readline'
import {pathToFileURL} from 'node:url'
import {Client} from 'pg'
import {config} from '../server/config.ts'
import {assertCoachSourceFreeze} from './coach-source-freeze.ts'
import {CoachProviderBudget,activeCoachFunding} from './coach-provider-budget.ts'
import {coachBudgetObserver} from './coach-budget-observer.ts'
import {collectCoachStream,coachSpeedSummary} from './coach-stream-evidence.ts'
import {campusCostSummary,campusReviewRows,campusDualCostSummary} from './campus-benchmark-summary.ts'

// ---- P0: one authenticated account per campus trajectory actor ----
// Every campus trajectory (C01..C10) runs as its own synthetic student: its own
// BetterAuth signup, its own cookie jar and its own conversation map. Accounts
// are never shared across trajectories, and a new conversation is never a new
// student. Legacy non-campus fixtures keep their historical single account.
export type ActorKey = string
export type ActorApi = (path:string,body?:unknown)=>Promise<any>
export type ActorContext = {
  actorKey: ActorKey
  userId: string
  headers: Readonly<Record<string, string>>
  conversationByTrajectory: Map<string, string>
}

// Runs before an actor's first input: the freshly signed-up account must be
// verifiably empty, otherwise the run is a fixture isolation failure and no
// provider request may be made for it.
export async function assertFreshActorIsolated(api:ActorApi):Promise<{checkedAt:string}>{
  const reasons:string[]=[]
  const growth=await api('/api/growth')
  if(Array.isArray(growth?.items)&&growth.items.length)reasons.push('growth_not_empty')
  const experiences=await api('/api/experiences')
  if(Array.isArray(experiences)&&experiences.some((row:{status?:string})=>row.status==='confirmed'))reasons.push('confirmed_experiences_not_empty')
  const memory=await api('/api/memory')
  if(Array.isArray(memory?.items)&&memory.items.length)reasons.push('memory_profile_not_empty')
  const conversations=await api('/api/conversations')
  if(Array.isArray(conversations)&&conversations.length)reasons.push('history_not_empty')
  if(reasons.length)throw new Error('FIXTURE_ISOLATION_FAILED:'+reasons.join(','))
  return {checkedAt:new Date().toISOString()}
}

export function createCampusActors(deps:{
  origin:string
  trajectoryIds:readonly string[]
  emailPrefix:string
  storePrivateSession(entry:{actorKey:string;origin:string;email:string;password:string;userId:string}):void
  onActorReady?(evidence:{actorKey:string;userId:string;isolated:true;checkedAt:string}):void
}){
  const actors=new Map<ActorKey,ActorContext>()
  const apiFor=(actor:Pick<ActorContext,'headers'>):ActorApi=>{
    // Closes over exactly this actor's headers. There is no mutable shared
    // "current headers" another actor request could read or overwrite.
    const headers=actor.headers
    return async(path:string,body?:unknown)=>{
      const response=await fetch(deps.origin+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)})
      if(!response.ok)throw new Error('HTTP_'+response.status+':'+await response.text())
      return response.json() as Promise<any>
    }
  }
  const ensureActor=async(actorKey:ActorKey):Promise<ActorContext>=>{
    if(!deps.trajectoryIds.includes(actorKey))throw new Error('UNKNOWN_ACTOR_KEY_'+actorKey)
    const cached=actors.get(actorKey)
    if(cached)return cached
    // Real BetterAuth signup; the userId is always fetched back from the
    // authenticated session, never accepted as an argument. Better-auth caps
    // sign-ups per IP (3 per 10s by default); a local, free account creation
    // may wait out that window instead of failing the isolated cohort.
    const email=deps.emailPrefix+'-actor-'+actorKey+'@example.invalid'
    const password='Synthetic-'+randomUUID()
    const signupBody=JSON.stringify({email,password,name:'Synthetic campus actor '+actorKey})
    let signup:Response|null=null
    for(let attempt=0;attempt<8;attempt++){
      signup=await fetch(deps.origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:deps.origin,'Content-Type':'application/json'},body:signupBody})
      if(signup.ok)break
      if(signup.status!==429||attempt===7)throw new Error('SIGNUP_FAILED_'+actorKey+'_'+signup.status)
      const retryAfter=Number(signup.headers.get('retry-after'))
      const waitMs=(Number.isFinite(retryAfter)&&retryAfter>0&&retryAfter<=15?retryAfter:10)*1000
      await new Promise(resolve=>setTimeout(resolve,waitMs))
    }
    if(!signup||!signup.ok)throw new Error('SIGNUP_FAILED_'+actorKey)
    const cookie=signup.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
    const headers={Origin:deps.origin,'Content-Type':'application/json',Cookie:cookie}
    const bootstrap=apiFor({headers})
    const isolation=await assertFreshActorIsolated(bootstrap)
    const session=await bootstrap('/api/session')
    if(typeof session?.id!=='string'||!session.id)throw new Error('SESSION_USER_ID_MISSING_'+actorKey)
    const actor:ActorContext={actorKey,userId:session.id,headers,conversationByTrajectory:new Map<string,string>()}
    actors.set(actorKey,actor)
    deps.storePrivateSession({actorKey,origin:deps.origin,email,password,userId:actor.userId})
    deps.onActorReady?.({actorKey,userId:actor.userId,isolated:true,checkedAt:isolation.checkedAt})
    return actor
  }
  return {actors,ensureActor,apiFor}
}

async function main(){
// Operator supplies synthetic user answers after reading each actual reply.
// Hidden fixture facts and review criteria are never included in model requests.
const preflight=process.argv.includes('--preflight')
if(preflight&&process.argv.includes('--paid'))throw new Error('PREFLIGHT_AND_PAID_ARE_MUTUALLY_EXCLUSIVE')
if(!preflight&&!process.argv.includes('--paid'))throw new Error('Explicit --paid or no-provider --preflight is required; no provider request made.')
const option=(name:string)=>{const i=process.argv.indexOf(name),value=process.argv[i+1];if(i<0||!value||value.startsWith('--'))throw new Error(name+' is required');return value}
const freezePath=resolve(option('--freeze')),sourceDigest=assertCoachSourceFreeze(freezePath)
const budget=new CoachProviderBudget(),availableBudget=budget.snapshot(),funding=activeCoachFunding(availableBudget);if(!preflight&&(funding?funding.paused||funding.remainingCny<=0:availableBudget.remaining<1))throw new Error('AUTHORIZED_PROVIDER_CALL_BUDGET_EXHAUSTED')
const mainURL=new URL(config.databaseUrl)
if(!['127.0.0.1','localhost','::1'].includes(mainURL.hostname)||decodeURIComponent(mainURL.pathname.slice(1))!=='lifeos')throw new Error('LOCAL_PRIMARY_IDENTITY_REQUIRED')
const runId='coach-'+randomUUID(),databaseName='lifeos_dialogue_live_'+randomUUID().replaceAll('-',''),target=new URL(mainURL)
target.pathname='/'+databaseName
const directory=resolve('evidence/v1.3-action-coach/real',runId),privateDirectory=resolve('.local/v1.3-action-coach',runId)
mkdirSync(directory,{recursive:true});mkdirSync(privateDirectory,{recursive:true})
const fixturePath=process.argv.includes('--fixture')?option('--fixture'):'tests/fixtures/action-coach-trajectories.json'
if(!['tests/fixtures/action-coach-trajectories.json','tests/fixtures/campus-growth-trajectories.json'].includes(fixturePath))throw new Error('REVIEWED_FIXTURE_PATH_REQUIRED')
const fixtureBytes=readFileSync(fixturePath),fixture=JSON.parse(fixtureBytes.toString()),campus=fixture.kind==='SYNTHETIC_ADULT_CAMPUS_GROWTH_OPERATOR_FIXTURE'
if(campus){config.messagesPerMinute=1000;config.messagesPerDay=1000}
const report:any={runId,evidence:preflight?'REAL_HTTP_AUTH_ISOLATED_POSTGRESQL_NO_PROVIDER_PREFLIGHT':'REAL_PROVIDER_REAL_HTTP_REAL_AUTH_REAL_ISOLATED_POSTGRESQL_SYNTHETIC_USER',sourceDigest,fixturePath,fixtureSha256:createHash('sha256').update(fixtureBytes).digest('hex'),databaseName,comparisonMode:{model:config.modelTiers.default.id,thinkingBudget:config.qwenThinkingBudget},createdAt:new Date().toISOString(),status:'NOT_READY',humanSemanticReview:'PENDING',turns:[],operations:[],trajectoryConversations:campus?undefined:{},maximumUserTurns:campus?null:47,automaticRetry:false}
if(campus)delete report.trajectoryConversations
const save=()=>{report.speed=coachSpeedSummary(report.turns);if(campus)report.mixedCost=campusCostSummary(report.turns,report.providerCalls??[]);writeFileSync(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n')}
report.runtimeAccess={entitlementsEnabled:config.entitlementsEnabled,providerBudgetEnabled:config.providerBudgetEnabled,messagesPerMinute:config.messagesPerMinute,messagesPerDay:config.messagesPerDay,quotaEvidence:campus?'SYNTHETIC_COHORT_RATE_OVERRIDE_NOT_PUBLIC_THROTTLE_ACCEPTANCE':'ACTUAL_LOCAL_CONFIGURATION'}
if(campus)report.actors={}
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
  // P3: self-authored campus guide cards (hash-bound to their manifest) ride
  // along into the isolated database for the guide retrieval verification chain.
  const guideCardsFile=JSON.parse(readFileSync(resolve('evidence/campus-guides/guide-cards.json'),'utf8')) as {manifestSha256:string;cards:unknown[]}
  const guideManifestHash=createHash('sha256').update(readFileSync(resolve('evidence/campus-guides/guides-manifest.json'))).digest('hex')
  if(guideCardsFile.manifestSha256!==guideManifestHash||!Array.isArray(guideCardsFile.cards)||!guideCardsFile.cards.length)throw new Error('GUIDE_CARDS_MANIFEST_MISMATCH')
  const imported=await importKnowledge([...cards,...guideCardsFile.cards as never[]])
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
    report.providerRequests.push({logicalCallId:call.callId,purpose:call.purpose,sha256:createHash('sha256').update(text).digest('hex'),chars:text.length,model:request.model,enableThinking:request.enable_thinking,thinkingBudget:request.thinking_budget??0,temperature:request.temperature,responseFormat:request.response_format?.type,maxCompletionTokens:request.max_completion_tokens,evidence:'ACTUAL_SDK_OUTGOING_BODY_PRIVATE_SYNTHETIC_CONTEXT_NO_CREDENTIAL_HEADERS'})
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

  // Campus mode: per-trajectory actors. The per-actor private logins stay in
  // .local (never in the public report); the report only keeps actorKey,
  // synthetic userId, conversation map and memory toggle.
  const reviewSessions:any={runId,databaseName,origin,actors:[]}
  const trajectoryIds:string[]=fixture.trajectories.map((row:any)=>row.id)
  const campusActors=campus?createCampusActors({
    origin,trajectoryIds,emailPrefix:runId,
    storePrivateSession:entry=>{reviewSessions.actors.push(entry);writeFileSync(resolve(privateDirectory,'review-sessions.json'),JSON.stringify(reviewSessions,null,2)+'\n',{mode:0o600})},
    onActorReady:evidence=>{report.actors[evidence.actorKey]={userId:evidence.userId,conversations:{},memoryEnabled:false,isolationCheckedAt:evidence.checkedAt};save()},
  }):undefined
  const actorMemoryEnabled=new Map<string,boolean>()
  const actorEvidence=(actor:ActorContext)=>{
    if(!campus)return
    report.actors[actor.actorKey]={userId:actor.userId,conversations:Object.fromEntries(actor.conversationByTrajectory),memoryEnabled:actorMemoryEnabled.get(actor.actorKey)??false,isolationCheckedAt:report.actors[actor.actorKey]?.isolationCheckedAt??null}
    save()
  }

  // Legacy mode keeps its historical single synthetic account, unchanged.
  let legacyApi:(path:string,body?:unknown)=>Promise<any>|undefined,legacyUserId='',legacyHeaders:Record<string,string>|undefined
  if(!campus){
    const email=runId+'@example.invalid',password='Synthetic-'+randomUUID()
    const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password,name:'Synthetic V1.3 review'})})
    if(!signup.ok)throw new Error('SIGNUP_FAILED_'+signup.status)
    const cookie=signup.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
    // Private review login is local-only; excluded from evidence and source packages.
    writeFileSync(resolve(privateDirectory,'review-session.json'),JSON.stringify({origin,email,password,databaseName,runId}),{mode:0o600})
    legacyHeaders={Origin:origin,'Content-Type':'application/json',Cookie:cookie}
    legacyApi=async(path:string,body?:unknown)=>{
      const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:legacyHeaders,body:body===undefined?undefined:JSON.stringify(body)})
      if(!response.ok)throw new Error('HTTP_'+response.status+':'+await response.text())
      return response.json() as Promise<any>
    }
    legacyUserId=(await legacyApi('/api/session')).id
  }
  report.origin=origin;save()
  console.log(JSON.stringify({ready:true,runId,origin,directory,databaseName,fixtureIds:trajectoryIds,instructions:'JSONL stdin: {trajectory:<fixture id>,actorKey:<same fixture id>,text:<explicit user answer>,sampleClass:opening|ordinary_followup|long_material,logicalStepId:<stable operator step id>}. actorKey is required on every input and operation and must match the frozen fixture trajectory. {newConversation:true} creates a new conversation for the same actor only. {operation:memorySettings,actorKey,value:{requestId:<uuid>,enabled:true,expectedRevision:<current revision>}}. {operation:exit} drains and preserves this isolated DB for formal UI review. No automatic answers/retries.'}))
  if(preflight){
    if(campus){
      const first=await campusActors!.ensureActor(trajectoryIds[0]!),second=await campusActors!.ensureActor(trajectoryIds[1]!)
      if(first.userId===second.userId)throw new Error('ACTOR_ACCOUNTS_NOT_DISTINCT')
      const api=campusActors!.apiFor(first)
      const conversation=await api('/api/conversations',{id:randomUUID(),title:'NO PROVIDER preflight'})
      const event=await api('/api/conversations/'+conversation.id+'/event')
      if(event!==null)throw new Error('PREFLIGHT_EVENT_SHOULD_BE_EMPTY')
      const memory=await api('/api/memory?conversation='+conversation.id)
      const growth=await api('/api/growth?conversation='+conversation.id)
      if(!Array.isArray(growth.items)||growth.items.length)throw new Error('PREFLIGHT_GROWTH_SHOULD_BE_EMPTY')
      report.preflight={actualDatabase:databaseName,auth:true,actors:2,distinctActorAccounts:true,conversation:true,eventRead:true,memoryRead:!!memory,growthRead:true,fixturePath,paidCalls:0};save()
      console.log(JSON.stringify({preflight:'PASS',...report.preflight}))
    }else{
      const conversation=await legacyApi!('/api/conversations',{id:randomUUID(),title:'NO PROVIDER preflight'})
      const event=await legacyApi!('/api/conversations/'+conversation.id+'/event')
      if(event!==null)throw new Error('PREFLIGHT_EVENT_SHOULD_BE_EMPTY')
      const memory=await legacyApi!('/api/memory?conversation='+conversation.id)
      const growth=await legacyApi!('/api/growth?conversation='+conversation.id)
      if(!Array.isArray(growth.items)||growth.items.length)throw new Error('PREFLIGHT_GROWTH_SHOULD_BE_EMPTY')
      report.preflight={actualDatabase:databaseName,auth:true,conversation:true,eventRead:true,memoryRead:!!memory,growthRead:true,fixturePath,paidCalls:0};save()
      console.log(JSON.stringify({preflight:'PASS',...report.preflight}))
    }
  }else for await(const line of (inputLines=createInterface({input:process.stdin,crlfDelay:Infinity}))){
    if(!line.trim())continue
    assertCoachSourceFreeze(freezePath)
    const command=JSON.parse(line)
    if(command.operation==='exit')break
    if(campus){
      // Every input and operation names its actor, validated against the frozen
      // fixture mapping. Nothing may fall back to a shared identity.
      const actorKey=typeof command.actorKey==='string'?command.actorKey:''
      if(!actorKey)throw new Error('ACTOR_KEY_REQUIRED')
      const actor=await campusActors!.ensureActor(actorKey)
      const api=campusActors!.apiFor(actor)
      if(command.operation==='readMemory'){
        const value=await api('/api/memory');console.log(JSON.stringify({operation:'readMemory',actorKey,value}));continue
      }
      if(command.operation==='readGrowth'){
        const value=await api('/api/growth');console.log(JSON.stringify({operation:'readGrowth',actorKey,value}));continue
      }
      if(command.operation==='growthAction'){
        const value=await api('/api/growth/'+command.itemId+'/actions',command.value)
        report.operations.push({at:new Date().toISOString(),operation:'growthAction',actorKey,value});save();console.log(JSON.stringify({operation:'growthAction',actorKey,value}));continue
      }
      if(command.operation==='memorySettings'){
        const value=await api('/api/memory/settings',command.value)
        if(typeof value?.enabled==='boolean')actorMemoryEnabled.set(actorKey,value.enabled)
        report.operations.push({at:new Date().toISOString(),operation:'memorySettings',actorKey,value});actorEvidence(actor);save();console.log(JSON.stringify({operation:'memorySettings',actorKey,value}));continue
      }
      if(command.operation==='seedA07Distractors')throw new Error('LEGACY_OPERATION_NOT_AVAILABLE_IN_CAMPUS_MODE')
    }else{
      if(command.operation==='readMemory'){
        const value=await legacyApi!('/api/memory');console.log(JSON.stringify({operation:'readMemory',value}));continue
      }
      if(command.operation==='readGrowth'){
        const value=await legacyApi!('/api/growth');console.log(JSON.stringify({operation:'readGrowth',value}));continue
      }
      if(command.operation==='growthAction'){
        const value=await legacyApi!('/api/growth/'+command.itemId+'/actions',command.value)
        report.operations.push({at:new Date().toISOString(),operation:'growthAction',value});save();console.log(JSON.stringify({operation:'growthAction',value}));continue
      }
      if(command.operation==='memorySettings'){
        const value=await legacyApi!('/api/memory/settings',command.value)
        report.operations.push({at:new Date().toISOString(),operation:'memorySettings',value});save();console.log(JSON.stringify({operation:'memorySettings',value}));continue
      }
      if(command.operation==='seedA07Distractors'){
        if(report.operations.some((operation:any)=>operation.operation==='seedA07Distractors'))throw new Error('A07_SETUP_ALREADY_APPLIED')
        const conversationId=report.trajectoryConversations.A01
        if(!conversationId||!report.turns.some((turn:any)=>turn.trajectory==='A01'&&turn.status==='SAVED'&&turn.event))throw new Error('ACTUAL_A01_EVENT_REQUIRED_BEFORE_A07_SETUP')
        const count=fixture.trajectories.find((item:any)=>item.id==='A07').distractorCount
        if(count!==45)throw new Error('FROZEN_A07_DISTRACTOR_COUNT_CHANGED')
        const seeded=await seedCoachHistoryFixture(legacyUserId,conversationId,count)
        report.operations.push({operation:'seedA07Distractors',conversationId,...seeded});save()
        console.log(JSON.stringify({operation:'seedA07Distractors',count,paidCalls:0,quotaEffect:seeded.quotaEffect}));continue
      }
    }
    if(command.operation==='revokeVerifiedSource'){
      const card=cards.find((card:any)=>card.id===command.sourceId)
      if(!card||report.operations.some((item:any)=>item.operation==='revokeVerifiedSource'&&item.sourceId===card.id))throw new Error('SOURCE_NOT_IMPORTED_OR_ALREADY_REVOKED')
      const result=await importKnowledge([{...card,revision:card.revision+1,status:'revoked'}])
      report.operations.push({operation:'revokeVerifiedSource',sourceId:card.id,previousRevision:card.revision,revision:card.revision+1,result,paidCalls:0});save()
      console.log(JSON.stringify({operation:'revokeVerifiedSource',sourceId:card.id,revision:card.revision+1,paidCalls:0}));continue
    }
    if(!fixture.trajectories.some((item:any)=>item.id===command.trajectory)||typeof command.text!=='string'||!command.text.trim()||command.text.length>16000||!['opening','ordinary_followup','long_material'].includes(command.sampleClass))throw new Error('EXPLICIT_TRAJECTORY_TEXT_AND_SAMPLE_CLASS_REQUIRED')
    if(campus&&command.actorKey!==command.trajectory)throw new Error('ACTOR_TRAJECTORY_MISMATCH')
    if(report.maximumUserTurns!==null&&report.turns.length>=report.maximumUserTurns)throw new Error('MAXIMUM_USER_TURNS_REACHED')
    const id=command.trajectory
    const actor=campus?await campusActors!.ensureActor(id):undefined
    const actorApi=campus?campusActors!.apiFor(actor!):undefined
    if(campus?!actor!.conversationByTrajectory.has(id)||command.newConversation:!report.trajectoryConversations[id]||command.newConversation){
      if(campus){actor!.conversationByTrajectory.set(id,(await actorApi!('/api/conversations',{id:randomUUID(),title:'Campus growth '+id})).id);actorEvidence(actor!)}
      else report.trajectoryConversations[id]=(await legacyApi!('/api/conversations',{id:randomUUID(),title:'V1.3 '+id})).id
    }
    const conversationId=campus?actor!.conversationByTrajectory.get(id)!:report.trajectoryConversations[id]
    const requestId=randomUUID()
    const logicalStepId=typeof command.logicalStepId==='string'&&command.logicalStepId.trim()?command.logicalStepId:id+':'+report.turns.filter((turn:any)=>turn.trajectory===id).length
    const turn:any={trajectory:id,conversationId,requestId,attemptId:randomUUID(),logicalStepId,...(campus?{actorKey:id}:{}),input:command.text,sampleClass:command.sampleClass,startedAt:new Date().toISOString(),status:'RESERVED_USER_TURN'}
    report.turns.push(turn);save() // Input/classification durable before any model request.
    try{
      const started=performance.now()
      const response=await fetch(origin+'/api/conversations/'+conversationId+'/messages',{method:'POST',headers:campus?actor!.headers:legacyHeaders,body:JSON.stringify({requestId,text:command.text})})
      const measured=await collectCoachStream(response,started)
      const afterApi=campus?campusActors!.apiFor(actor!):undefined
      Object.assign(turn,measured,{status:'SAVED',providerCallCount:measured.done.upstreamCalls,stateChange:measured.done.stateChange??null,event:await (afterApi??legacyApi!)('/api/conversations/'+conversationId+'/event'),...(campus?{growth:await afterApi!('/api/growth?conversation='+conversationId)}:{})})
      console.log(JSON.stringify({trajectory:id,actorKey:campus?id:undefined,turn:report.turns.length,...measured}))
    }catch(error){turn.status='FAILED';turn.error=error instanceof Error?error.message:'UNKNOWN';turn.streamEvidence=(error as any)?.streamEvidence??null;console.log(JSON.stringify({trajectory:id,actorKey:campus?id:undefined,turn:report.turns.length,error:turn.error,retry:false}))}
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
  console.log(JSON.stringify({closed:true,runId,databasePreserved:preflight?false:databaseName,status:'NOT_READY',semanticReview:'PENDING',...(campus?{actorCount:Object.keys(report.actors??{}).length}:{})}))
}
}

const entryScript=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:null
if(entryScript&&import.meta.url===entryScript)await main()
