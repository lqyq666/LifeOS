import type { Model } from '@mariozechner/pi-ai'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from './config.ts'
import {actionCoachTurnSchema} from './action-coach-contracts.ts'
import {turnSystemPrompt,providerTurnMessages} from './turn-prompt.ts'
import {renderCoachReply} from './coach-reply.ts'
import {configureProviderPayload,outputTokenLimit} from './model-payload.ts'

export type ModelTier='default'|'reasoning'|'deep'
export type ModelPricing={inputCnyPerMillion:number;outputCnyPerMillion:number;cachedInputCnyPerMillion?:number}
export type ModelRuntime={tier:ModelTier;model:Model<'openai-completions'>;apiKey:string;pricing:ModelPricing|null;configured:boolean;available:boolean}
type ModelProfile={provider:string;id:string;baseUrl:string;apiKey:string}
function parsePrices():Record<string,ModelPricing>{
  let parsed:unknown
  try{parsed=JSON.parse(config.modelPricingJson)}catch{return {}}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {}
  const result:Record<string,ModelPricing>={}
  for(const [key,value]of Object.entries(parsed)){
    if(!key||!value||typeof value!=='object'||Array.isArray(value))continue
    const price=value as Record<string,unknown>
    if(typeof price.inputCnyPerMillion!=='number'||!Number.isFinite(price.inputCnyPerMillion)||price.inputCnyPerMillion<0||typeof price.outputCnyPerMillion!=='number'||!Number.isFinite(price.outputCnyPerMillion)||price.outputCnyPerMillion<0)continue
    if(price.cachedInputCnyPerMillion!==undefined&&(typeof price.cachedInputCnyPerMillion!=='number'||!Number.isFinite(price.cachedInputCnyPerMillion)||price.cachedInputCnyPerMillion<0))continue
    result[key]={inputCnyPerMillion:price.inputCnyPerMillion,outputCnyPerMillion:price.outputCnyPerMillion,...(typeof price.cachedInputCnyPerMillion==='number'?{cachedInputCnyPerMillion:price.cachedInputCnyPerMillion}:{})}
  }
  return result
}
const prices=parsePrices()
function makeModel(profile:ModelProfile):Model<'openai-completions'>{
  const supportsBailianThinking=profile.provider==='bailian'&&['qwen3.8-flash','deepseek-v4.1-flash'].includes(profile.id)
  return {
  id:profile.id, name:profile.id, provider:profile.provider,
  api: 'openai-completions', baseUrl:profile.baseUrl,
  reasoning: supportsBailianThinking, input: ['text'], contextWindow: 128000, maxTokens: 4096,
  // Runtime cost is estimated separately from the optional external price table.
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false,
    supportsUsageInStreaming: true, maxTokensField: 'max_tokens', supportsStrictMode: false,
    ...(supportsBailianThinking?{thinkingFormat:'qwen' as const}:{}) },
  }
}
const configuredDefault=config.modelTiers.default
export const model:Model<'openai-completions'>=makeModel(configuredDefault)
export function resolveModel(tier:ModelTier):ModelRuntime{
  const profile=config.modelTiers[tier],selected=tier==='default'?model:profile.id&&profile.baseUrl?makeModel(profile):null,apiKey=tier==='default'?config.apiKey:profile.apiKey
  const selectedModel=selected??model
  const configured=Boolean(selected&&profile.provider&&profile.id&&profile.baseUrl)
  return {tier,model:selectedModel,apiKey,configured,available:configured&&/^[\x21-\x7e]{20,200}$/.test(apiKey),pricing:configured?prices[`${selectedModel.provider}:${selectedModel.id}`]??null:null}
}
export function availableModelTiers(){return (['default','reasoning','deep']as const).map(tier=>{const route=resolveModel(tier);return {tier,configured:route.configured,available:route.available,provider:route.configured?route.model.provider:null,model:route.configured?route.model.id:null}})}
function endpointFingerprint(baseUrl:string){
  let normalized=baseUrl
  try{const url=new URL(baseUrl);url.search='';url.hash='';normalized=url.toString()}catch{}
  return createHash('sha256').update(normalized).digest('hex').slice(0,16)
}
export function modelSignatureFor(tier:ModelTier){
  const runtime=resolveModel(tier)
  return `${runtime.model.provider}:${runtime.model.id}:endpoint-${endpointFingerprint(runtime.model.baseUrl)}:pi-ai@0.73.1`
}
export const modelSignature=modelSignatureFor('default')
export function coachContractSignatureFor(tier:ModelTier){
  const route=resolveModel(tier)
  return createHash('sha256').update(JSON.stringify({version:'action-coach-v1.3',schema:actionCoachTurnSchema,prompt:turnSystemPrompt(tier==='reasoning'?'reasoning':'default',route.model.id),dialogueTransport:providerTurnMessages.toString(),rendering:renderCoachReply.toString(),payload:configureProviderPayload({},route.model,tier),outputTokenLimit:outputTokenLimit(route.model,tier)})).digest('hex')
}
// API capabilities survive business prompt/rendering changes. Keep the legacy
// combined signature above for old evidence; never rewrite its historical hash.
export function coachInterfaceSignatureFor(tier:ModelTier){
  const route=resolveModel(tier)
  const structural=(value:unknown):unknown=>Array.isArray(value)?value.map(structural):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='description').map(([key,item])=>[key,structural(item)])):value
  return createHash('sha256').update(JSON.stringify({version:'action-coach-interface-v1',model:modelSignatureFor(tier),api:route.model.api,compat:route.model.compat,schema:structural(actionCoachTurnSchema),payload:structural(configureProviderPayload({},route.model,tier)),payloadImplementation:configureProviderPayload.toString(),outputTokenLimit:outputTokenLimit(route.model,tier),transport:{stream:true,cancel:true,maxRetries:0}})).digest('hex')
}
export function coachCapabilityReuseProof(report:any,tier:ModelTier){
  if(report?.interfaceSignature!==undefined||report?.contractSignature!==coachContractSignatureFor(tier)||!coachCapabilityReportMatches(report,tier))throw new Error('CAPABILITY_EQUIVALENCE_NOT_PROVEN')
  return {kind:'LOCAL_INTERFACE_EQUIVALENCE_NOT_NEW_PROVIDER_CALL',reportDigest:createHash('sha256').update(JSON.stringify(report)).digest('hex'),legacyContractSignature:report.contractSignature,interfaceSignature:coachInterfaceSignatureFor(tier)}
}
export function coachCapabilityReportMatches(report:any,tier:ModelTier,reuseProof?:any){
  const route=resolveModel(tier)
  const provenReuse=reuseProof?.kind==='LOCAL_INTERFACE_EQUIVALENCE_NOT_NEW_PROVIDER_CALL'&&reuseProof.reportDigest===createHash('sha256').update(JSON.stringify(report)??'').digest('hex')&&reuseProof.legacyContractSignature===report?.contractSignature&&reuseProof.interfaceSignature===coachInterfaceSignatureFor(tier)
  const interfaceMatches=report?.interfaceSignature!==undefined?report.interfaceSignature===coachInterfaceSignatureFor(tier):report?.contractSignature===coachContractSignatureFor(tier)||provenReuse
  return report?.status==='PASS'&&report.evidence==='REAL_PROVIDER_API'&&report.contract==='action-coach-v1.3'&&report.tier===tier&&report.signature===modelSignatureFor(tier)&&interfaceMatches&&report.provider===route.model.provider&&report.model===route.model.id&&['streaming','freeOutput','actionOutput','cancel'].every(key=>report.checks?.[key]?.passed===true)&&Array.isArray(report.calls)&&report.calls.length===4&&new Set(report.calls.map((call:any)=>call.callId)).size===4&&report.calls.every((call:any)=>call.status==='finished'&&call.purpose==='capability'&&call.signature===report.signature)
}
export function modelCapabilityVerified(tier:ModelTier){
  const route=resolveModel(tier)
  if(!route.available)return false
  const filename=`coach-capabilities-${tier}.json`
  const evidenceDirectory=process.env.LIFEOS_EVIDENCE?resolve(process.env.LIFEOS_EVIDENCE):resolve('evidence/v1.3-action-coach/provider')
  try{
    const report=JSON.parse(readFileSync(resolve(evidenceDirectory,filename),'utf8'))
    let proof:unknown
    try{proof=JSON.parse(readFileSync(resolve(evidenceDirectory,filename+'.interface-proof.json'),'utf8'))}catch{}
    return coachCapabilityReportMatches(report,tier,proof)
  }catch{return false}
}
