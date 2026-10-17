import {scanUserClauses} from './user-command-spans.ts'

export type GrillingInteractionMode='crisis_support'|'listen'|'direct_delivery'|'explore'|'ordinary'

export function crisisSupportIntent(text:string){
  return scanUserClauses(text).some(clause=>!clause.interrogative&&!clause.conditional&&!clause.quoted&&!clause.code&&!clause.attributedToOther&&/(?:我.{0,8}(?:想|要|准备)(?:自杀|伤害自己|结束生命)|我不想活了|我活不下去了)/.test(clause.text))
}

export function grillingInteractionMode(text:string,options:{material?:boolean;plan?:boolean;listen?:boolean}={}):GrillingInteractionMode{
  if(crisisSupportIntent(text))return 'crisis_support'
  if(options.listen||/(?:只想聊聊|只想说说|不要追问|别追问|先听我说|不想要建议)/.test(text))return 'listen'
  if(options.material||options.plan||/(?:直接给我|直接写|帮我改写|翻译|只要成品|不要分析)/.test(text))return 'direct_delivery'
  if(/(?:没有方向|不知道.{0,8}(?:方向|选择|想要什么)|迷茫|纠结|犹豫|适合什么|想清楚|深入探索|复盘|做了.{0,12}(?:没效果|没人用|没坚持)|为什么.{0,12}(?:没效果|没坚持))/.test(text))return 'explore'
  return 'ordinary'
}

