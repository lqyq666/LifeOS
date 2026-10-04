import { actionCoachTurnSchema } from './action-coach-contracts.ts'
import type { ModelTier } from './model.ts'

type ProviderProfile={provider:string;id:string}
export type OutputPath='turn'|'repair'
const nonProviderSchemaKeys=new Set(['~optional','$schema','$id'])

export function outputTokenLimit(profile:ProviderProfile,tier:ModelTier){
  return profile.provider==='bailian'&&profile.id==='deepseek-v4.1-flash'&&tier==='reasoning'?16384:8192
}

function providerSchema(value:unknown,currentMessageId?:string):unknown{
  if(Array.isArray(value))return value.map(item=>providerSchema(item,currentMessageId))
  if(!value||typeof value!=='object')return value
  const schema=value as Record<string,unknown>
  if(Array.isArray(schema.anyOf)&&schema.anyOf.length&&schema.anyOf.every(item=>item&&typeof item==='object'&&(item as Record<string,unknown>).type==='string'&&typeof(item as Record<string,unknown>).const==='string')){
    return {type:'string',enum:schema.anyOf.map(item=>(item as Record<string,unknown>).const)}
  }
  return Object.fromEntries(Object.entries(schema).filter(([key])=>!nonProviderSchemaKeys.has(key)).map(([key,item])=>[
    key,key==='messageId'&&currentMessageId?{...item as Record<string,unknown>,enum:[currentMessageId]}:providerSchema(item,currentMessageId),
  ]))
}

export function configureProviderPayload(payload:unknown,profile:ProviderProfile,tier:ModelTier,schema:unknown=actionCoachTurnSchema,schemaName='lifeos_action_coach',maxOutputTokens?:number,currentMessageId?:string,eventTargets?:readonly {id:string;revision:number}[]):unknown{
  if(currentMessageId&&!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(currentMessageId))throw new Error('CURRENT_MESSAGE_ID_INVALID')
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return payload
  const body={...payload as Record<string,unknown>}
  if(profile.provider!=='bailian')return payload
  if(profile.id==='qwen3.8-flash'){
    body.enable_thinking=false
    body.temperature=0
    body.presence_penalty=0
    const compiled=providerSchema(schema,currentMessageId) as any
    if(eventTargets){
      const target=compiled.properties?.event?.properties?.target
      if(!target?.anyOf)throw new Error('EVENT_TARGET_SCHEMA_REQUIRED')
      const create=target.anyOf.find((branch:any)=>branch.properties?.operation?.const==='create')
      const existing=target.anyOf.find((branch:any)=>branch.properties?.operation?.const==='continue')
      if(!create||!existing)throw new Error('EVENT_TARGET_SCHEMA_REQUIRED')
      const unique=new Map<string,{id:string;revision:number}>()
      for(const event of eventTargets){
        if(!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(event.id)||!Number.isInteger(event.revision)||event.revision<1)throw new Error('EVENT_TARGET_INVALID')
        const previous=unique.get(event.id)
        if(previous&&previous.revision!==event.revision)throw new Error('EVENT_TARGET_REVISION_AMBIGUOUS')
        unique.set(event.id,event)
      }
      target.anyOf=[create,...Array.from(unique.values(),event=>({...existing,properties:{...existing.properties,eventId:{...existing.properties.eventId,enum:[event.id]},expectedRevision:{...existing.properties.expectedRevision,enum:[event.revision]}}}))]
    }
    body.response_format={type:'json_schema',json_schema:{name:schemaName,strict:true,schema:compiled}}
    if(maxOutputTokens)body.max_completion_tokens=maxOutputTokens
    delete body.max_tokens
  }else if(profile.id==='deepseek-v4.1-flash'){
    body.enable_thinking=tier==='reasoning'
    if(tier==='reasoning')body.reasoning_effort='low'
    body.response_format={type:'json_object'}
    if(maxOutputTokens)body.max_completion_tokens=maxOutputTokens
    delete body.max_tokens
  }
  return body
}
