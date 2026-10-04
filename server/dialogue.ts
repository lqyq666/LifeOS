import type {MemoryKey} from './contracts.ts'
export type DialoguePath='direct'|'support'|'clarify'|'align'|'plan'|'provisional'
export type DialogueTask='none'|'university_direction'|'study_project'|'internship'|'personal_choice'
export type ProfileFact={id:string;key:MemoryKey;value:unknown;scope:'user'|'task';taskType:DialogueTask|null;taskInquiryId?:string|null;taskConversationId?:string|null;observedAt:string;validUntil:string|null;revision:number;status:'active'|'unknown'|'declined'|'stale';source:{type:'message'|'user_edit';conversationId?:string;messageId?:string;quote?:string}}
export type DialogueMessage={id:string;role:'user'|'assistant';content:string;created_at?:string}
export function requestsCrossExperienceReview(text:string){
  const explicitReview=/(?:复盘|总结|分析|归纳|共性|共同点|重复|反复|模式|规律)/.test(text)
  const multipleExperiences=/(?:跨.{0,4}经历|(?:两|二|几|多|不同|多个|这些|各段).{0,12}(?:经历|事件|项目)|(?:结合|比较|对照|综合).{0,16}(?:经历|事件|项目)|(?:经历|事件|项目).{0,16}(?:共同|共性|重复|反复|模式|规律))/.test(text)
  return explicitReview&&multipleExperiences
}
