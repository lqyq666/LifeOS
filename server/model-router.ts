import type { MemorySnapshot } from './memory.ts'
import { modelCapabilityVerified, type ModelTier } from './model.ts'
import { requestsCrossExperienceReview, type ProfileFact } from './dialogue.ts'

export type EscalationReason='complex_multi_constraint'|'cross_experience_synthesis'|'explicit_deep_review'
export type ModelRoute={tier:ModelTier;escalated:boolean;reason:EscalationReason|null}

const explicitDeep=(text:string)=>/(?:完整|全面|深入|系统地).{0,6}(?:复盘|分析|梳理)|(?:复盘|分析|梳理).{0,6}(?:全部|所有|完整|深入)/.test(text)
const hasTwoIndependentExperiences=(snapshot:MemorySnapshot)=>new Set(snapshot.confirmedExperiences.map(item=>item.quote.trim().toLocaleLowerCase()).filter(Boolean)).size>=2

export function initialModelRoute(text:string,snapshot:MemorySnapshot,capabilityVerified:(tier:ModelTier)=>boolean=modelCapabilityVerified):ModelRoute{
  if(!capabilityVerified('reasoning'))return {tier:'default',escalated:false,reason:null}
  if(explicitDeep(text)&&hasTwoIndependentExperiences(snapshot))return {tier:'reasoning',escalated:true,reason:'explicit_deep_review'}
  const crossExperienceChoice=/(?:结合|根据|对照).{0,25}(?:经历|背景)|这些经历|已经保存.{0,12}经历/.test(text)&&/选|判断|决定|取舍|比较|差异/.test(text)
  if((requestsCrossExperienceReview(text)||crossExperienceChoice)&&hasTwoIndependentExperiences(snapshot))return {tier:'reasoning',escalated:true,reason:'cross_experience_synthesis'}
  return {tier:'default',escalated:false,reason:null}
}

export function readKnownMajor(text:string,profile:ProfileFact[]):string|undefined{
  if(!isKnownMajorQuestion(text))return undefined
  const fact=profile.filter(item=>item.key==='education.major'&&item.scope==='user'&&item.status==='active').sort((a,b)=>b.observedAt.localeCompare(a.observedAt))[0]
  return typeof fact?.value==='string'?fact.value:undefined
}
export function isKnownMajorQuestion(text:string){
  const normalized=text.trim().replace(/[\s，。！？?!、]/g,'')
  return /^(?:我(?:之前|以前)?(?:说过|提过)?(?:我|自己)?(?:是什么|读什么|学什么|哪个)(?:专业|学科)(?:吗|呢)?|我(?:之前|以前)说过自己(?:是什么|读什么)(?:专业|学科)(?:吗|呢)?)$/.test(normalized)
}
