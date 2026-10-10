import {createHash,createHmac,timingSafeEqual} from 'node:crypto'
import {openSync,closeSync,writeSync,fsyncSync,appendFileSync} from 'node:fs'
import {CoachProviderBudget,activeCoachFunding} from './coach-provider-budget.ts'

export const cozeModelEndpoint='https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex')
const digest=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x)
export function deriveCozePermitSecret(existingRunToken:string){
 if(existingRunToken.length<20)throw Error('EXISTING_RUNTIME_TOKEN_REQUIRED')
 return createHmac('sha256',existingRunToken).update('lifeos-host-permit-v1').digest('hex')
}
type Binding={hostSourceDigest:string;cloudCommit:string;cloudSourceDigest:string;contentHash:string;skillsDigest:string}
type Slot={nodeId:string;callId:string;reservedCostCny:number}
type Claims=Binding&{schemaVersion:1;kind:'LIFEOS_COZE_HOST_RESERVED_GRAPH';requestId:string;projectId:'7693388932939300905';payloadDigest:string;issuedAt:string;expiresAt:string;model:'qwen3.8-flash';endpoint:string;maxOutputTokens:2048;maxPromptUtf8Bytes:12000;inputCnyPerMillion:0.8;outputCnyPerMillion:2.7;slots:Slot[]}
export type CozeHostPermit={payloadB64:string;claimsB64:string;signature:string}
type RestoredApproval={kind:string;approvalSource:string;cozePauseLifted:boolean;productModelPauseLifted:boolean;directHttpRouteApproval?:{source:string;exactAnswer:string;newBudget:number;automaticPaidRetry:boolean;publishBeforeCoreGates:boolean}}
function validateBinding(binding:Binding){
 if(!/^[a-f0-9]{40}$/.test(binding.cloudCommit)||Object.entries(binding).some(([key,value])=>key!=='cloudCommit'&&!digest(value)))throw Error('CLOUD_REAL_BUILD_BINDING_REQUIRED')
}
function mac(secret:string,value:string){if(!digest(secret))throw Error('PERMIT_SECRET_INVALID');return createHmac('sha256',secret).update(value,'ascii').digest('hex')}
function decode(value:unknown){
 if(typeof value!=='string'||value.length>350000||!value.length||Buffer.from(value,'base64').toString('base64')!==value)throw Error('PERMIT_BASE64_INVALID')
 return Buffer.from(value,'base64')
}
function claimsAndPayload(wire:CozeHostPermit,secret:string,binding:Binding,now:number){
 validateBinding(binding)
 const expected=mac(secret,wire.claimsB64)
 if(!digest(wire.signature)||!timingSafeEqual(Buffer.from(wire.signature,'hex'),Buffer.from(expected,'hex')))throw Error('PERMIT_SIGNATURE_INVALID')
 const claims=JSON.parse(decode(wire.claimsB64).toString('utf8')) as Claims,payloadBytes=decode(wire.payloadB64),payload=JSON.parse(payloadBytes.toString('utf8'))
 if(claims.schemaVersion!==1||claims.kind!=='LIFEOS_COZE_HOST_RESERVED_GRAPH'||claims.projectId!=='7693388932939300905'||!uuid(claims.requestId)||claims.requestId!==payload.requestId||sha(payloadBytes)!==claims.payloadDigest||Object.entries(binding).some(([key,value])=>claims[key as keyof Claims]!==value))throw Error('PERMIT_PAYLOAD_OR_RUNTIME_CONFLICT')
 const issued=Date.parse(claims.issuedAt),expires=Date.parse(claims.expiresAt)
 if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now||expires<=now||expires-issued>300000||expires<=issued)throw Error('PERMIT_EXPIRED_OR_CLOCK_INVALID')
 if(claims.model!=='qwen3.8-flash'||claims.endpoint!==cozeModelEndpoint||claims.maxOutputTokens!==2048||claims.maxPromptUtf8Bytes!==12000||claims.inputCnyPerMillion!==0.8||claims.outputCnyPerMillion!==2.7)throw Error('PERMIT_MODEL_OR_LIMIT_CONFLICT')
 validatePayload(payload,claims.slots?.map(x=>x.nodeId),claims.slots?.[0]?.reservedCostCny)
 if(!Array.isArray(claims.slots)||new Set(claims.slots.map(x=>x.callId)).size!==claims.slots.length||claims.slots.some(x=>!uuid(x.callId)||x.reservedCostCny!==claims.slots[0].reservedCostCny))throw Error('PERMIT_SLOTS_INVALID')
 return {claims,payload}
}
function validatePayload(payload:any,nodeIds:string[],maximum:number){
 if(!payload||payload.schemaVersion!==2||payload.businessRole!=='growth'||payload.syntheticAdult!==true||!uuid(payload.requestId)||!['direction_decision','action_review','growth_diff','kb_maintenance'].includes(payload.mode))throw Error('SYNTHETIC_AUTHORIZED_HOST_PAYLOAD_REQUIRED')
 if(!Array.isArray(nodeIds)||nodeIds.length<1||nodeIds.length>5||new Set(nodeIds).size!==nodeIds.length||nodeIds.some(x=>typeof x!=='string'||!x.length||x.length>100))throw Error('PERMIT_GRAPH_INVALID')
 if(payload.mode==='direction_decision'){
  if(!Array.isArray(payload.directions)||![2,3].includes(payload.directions.length)||payload.directions.some((d:any)=>typeof d.id!=='string'||!d.id))throw Error('PERMIT_DIRECTIONS_INVALID')
  const expected=[...payload.directions.map((d:any)=>'path:'+d.id),'critic','synthesize']
  if(expected.length!==nodeIds.length||expected.some(id=>!nodeIds.includes(id)))throw Error('PERMIT_GRAPH_INVALID')
 }
 // A conservative UTF-8/token cap is enforced again on the actual complete
 // messages by the cloud. Use full input price, never optimistic cache pricing.
 const minimum=(16384*0.8+2048*2.7)/1e6
 if(!Number.isFinite(maximum)||maximum<minimum||!payload.modelBudget||!Number.isInteger(payload.modelBudget.maxProviderCalls)||payload.modelBudget.maxProviderCalls<nodeIds.length||payload.modelBudget.maxProviderCalls>5||!(payload.modelBudget.maxCostCny>=nodeIds.length*maximum)||!Number.isInteger(payload.modelBudget.deadlineMs)||payload.modelBudget.deadlineMs<1||payload.modelBudget.deadlineMs>120000)throw Error('PERMIT_GRAPH_BUDGET_INVALID')
}

// This function does not dispatch. Durable journal + the ORIGINAL model ledger
// precede signing. Neither credentials nor the ledger are sent to Coze.
export function reserveCozeHostPermit(input:{payload:Record<string,unknown>;binding:Binding;nodeIds:string[];maxCostPerCallCny:number;secret:string;approval:RestoredApproval;budget:CoachProviderBudget;journalPath:string;now?:number}):CozeHostPermit{
 const {approval,binding,payload,budget}=input,route=approval.directHttpRouteApproval,now=input.now??Date.now()
 if(approval.kind!=='OWNER_APPROVED_LIFEOS_COZE_CORE_LAUNCH'||approval.approvalSource!=='CURRENT_CHAT_DIRECT_HUMAN_REPLY'||!approval.cozePauseLifted||!approval.productModelPauseLifted||route?.source!=='CURRENT_CHAT_DIRECT_HUMAN_REPLY'||route.exactAnswer!=='批准新的实现路线，仍只用已有额度'||route.newBudget!==0||route.automaticPaidRetry!==false||route.publishBeforeCoreGates!==false)throw Error('DIRECT_HUMAN_HTTP_ROUTE_APPROVAL_REQUIRED')
 validateBinding(binding);validatePayload(payload,input.nodeIds,input.maxCostPerCallCny);mac(input.secret,'validate')
 const funding=activeCoachFunding(budget.snapshot())
 if(!funding||funding.paused||funding.remainingCny<input.nodeIds.length*input.maxCostPerCallCny)throw Error('ORIGINAL_CNY_FUNDING_UNAVAILABLE')
 const payloadBytes=Buffer.from(JSON.stringify(payload)),payloadDigest=sha(payloadBytes)
 if(payloadBytes.length>256000)throw Error('HOST_PAYLOAD_TOO_LARGE')
 const requestId=payload.requestId as string,fd=openSync(input.journalPath,'wx',0o600)
 try{writeSync(fd,JSON.stringify({type:'first_graph_intent',requestId,payloadDigest,binding,nodeIds:input.nodeIds,newBudget:0})+'\n');fsyncSync(fd)}finally{closeSync(fd)}
 const signature=sha(JSON.stringify({binding,endpoint:cozeModelEndpoint,model:'qwen3.8-flash',maxOutputTokens:2048,maxPromptUtf8Bytes:12000}))
 const slots=budget.reserveGraph(input.nodeIds.map(nodeId=>({runId:requestId,purpose:'diagnostic',tier:'default',provider:'bailian',model:'qwen3.8-flash',signature,sourceDigest:binding.hostSourceDigest,logicalCallId:sha(requestId+':'+nodeId),reservedCostCny:input.maxCostPerCallCny}))).map((row,index)=>({nodeId:input.nodeIds[index],callId:row.callId,reservedCostCny:input.maxCostPerCallCny}))
 const claims:Claims={schemaVersion:1,kind:'LIFEOS_COZE_HOST_RESERVED_GRAPH',requestId,projectId:'7693388932939300905',payloadDigest,...binding,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString(),model:'qwen3.8-flash',endpoint:cozeModelEndpoint,maxOutputTokens:2048,maxPromptUtf8Bytes:12000,inputCnyPerMillion:0.8,outputCnyPerMillion:2.7,slots}
 const claimsB64=Buffer.from(JSON.stringify(claims)).toString('base64'),wire={payloadB64:payloadBytes.toString('base64'),claimsB64,signature:mac(input.secret,claimsB64)}
 const out=openSync(input.journalPath,'a',0o600)
 try{writeSync(out,JSON.stringify({type:'reserved_signed_first_attempt',wire})+'\n');fsyncSync(out)}finally{closeSync(out)}
 return wire
}
export function verifyCozeHostPermit(wire:CozeHostPermit,secret:string,binding:Binding,now=Date.now()){
 return claimsAndPayload(wire,secret,binding,now)
}

// Absence of a fully validated cloud record proves neither non-dispatch nor
// zero cost. Finish every reserved slot unknown; a duplicate settlement fails.
export function retainUnknownCozeGraph(wire:CozeHostPermit,secret:string,binding:Binding,budget:CoachProviderBudget,outcome:'failed'|'cancelled',journalPath:string){
 const {claims}=claimsAndPayload(wire,secret,binding,Date.parse(JSON.parse(decode(wire.claimsB64).toString('utf8')).issuedAt))
 const snapshot=budget.snapshot()
 if(claims.slots.some(slot=>!snapshot.calls.some((row:any)=>row.callId===slot.callId&&row.runId===claims.requestId&&row.status==='reserved'&&row.reservedCostCny===slot.reservedCostCny&&row.sourceDigest===binding.hostSourceDigest)))throw Error('ORIGINAL_GRAPH_RESERVATION_CONFLICT')
 for(const slot of claims.slots)budget.finish(slot.callId,{outcome,usage:'unknown',estimatedCostCny:'unknown',providerResponseId:null})
 appendFileSync(journalPath,JSON.stringify({type:'unknown_graph_finished',requestId:claims.requestId,outcome,reservationRetained:true})+'\n')
}
