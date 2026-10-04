import test from 'node:test'
import assert from 'node:assert/strict'
import { requestsCrossExperienceReview, type ProfileFact } from '../server/dialogue.ts'
import { initialModelRoute, readKnownMajor } from '../server/model-router.ts'
import type { MemorySnapshot } from '../server/memory.ts'

const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const snapshot=(overrides:Partial<MemorySnapshot>={}):MemorySnapshot=>({settings:{enabled:true,revision:1},writeProfile:[],profile:[],confirmedExperiences:[],...overrides})

test('only the explicit saved-fact question is answered deterministically from an active current major',()=>{
  const profile:ProfileFact[]=[{id:uuid(1),key:'education.major',value:'软件工程',scope:'user',taskType:null,observedAt:'2026-10-01T00:00:00Z',validUntil:null,revision:2,status:'active',source:{type:'message',messageId:uuid(2),conversationId:uuid(3),quote:'我读软件工程'}}]
  assert.equal(readKnownMajor('我之前说过我是什么专业吗？',profile),'软件工程')
  assert.equal(readKnownMajor('我最近对方向有点迷茫',profile),undefined)
  assert.equal(readKnownMajor('我之前说过我是什么专业吗？',[{...profile[0]!,status:'stale'}]),undefined)
})

test('complex routing is explicit, evidence-bounded, and ordinary requests stay on the default tier',()=>{
  const base=snapshot({confirmedExperiences:[{id:uuid(10),revision:1,content:{summary:'项目一'},conversationId:uuid(11),conversationTitle:'一',sourceMessageId:uuid(12),quote:'我完成项目一'},{id:uuid(13),revision:1,content:{summary:'项目二'},conversationId:uuid(14),conversationTitle:'二',sourceMessageId:uuid(15),quote:'我完成项目二'}]})
  assert.deepEqual(initialModelRoute('想做一个小项目验证方向',base),{tier:'default',escalated:false,reason:null})
  assert.deepEqual(initialModelRoute('请完整复盘所有经历',base,()=>true),{tier:'reasoning',escalated:true,reason:'explicit_deep_review'})
  assert.deepEqual(initialModelRoute('请完整复盘所有经历',base,()=>false),{tier:'default',escalated:false,reason:null})
  assert.deepEqual(initialModelRoute('请复盘可能重复出现的做法',base),{tier:'default',escalated:false,reason:null})
  assert.deepEqual(initialModelRoute('请结合这两段不同经历复盘可能重复出现的做法',base,()=>true),{tier:'reasoning',escalated:true,reason:'cross_experience_synthesis'})
  assert.deepEqual(initialModelRoute('请结合这两段不同经历复盘可能重复出现的做法',base,()=>false),{tier:'default',escalated:false,reason:null})
  assert.deepEqual(initialModelRoute('请复盘可能重复出现的做法',snapshot({confirmedExperiences:base.confirmedExperiences.slice(0,1)})),{tier:'default',escalated:false,reason:null})
})
test('pattern reflection and reasoning require an explicit cross-experience request and two independent events',()=>{
  const ordinary=snapshot({confirmedExperiences:[{id:uuid(1),revision:1,content:{},conversationId:uuid(2),conversationTitle:'a',sourceMessageId:uuid(3),quote:'经历'}]})
  const eligible={...ordinary,confirmedExperiences:[...ordinary.confirmedExperiences,{...ordinary.confirmedExperiences[0]!,id:uuid(4),quote:'另一段已确认经历'}]}
  assert.equal(requestsCrossExperienceReview('请结合这两段不同经历复盘共同做法'),true)
  assert.deepEqual(initialModelRoute('请结合这两段不同经历复盘共同做法',{...eligible,confirmedExperiences:[...eligible.confirmedExperiences.slice(0,1),{...eligible.confirmedExperiences[1]!,quote:eligible.confirmedExperiences[0]!.quote}]}),{tier:'default',escalated:false,reason:null})
})
