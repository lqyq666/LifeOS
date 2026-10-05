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

export function configureProviderPayload(payload:unknown,profile:ProviderProfile,tier:ModelTier,schema:unknown=actionCoachTurnSchema,schemaName='lifeos_action_coach',maxOutputTokens?:number,currentMessageId?:string,eventTargets?:readonly {id:string;revision:number;activeUnknownIds?:readonly string[];nodeIds?:readonly string[];actionIds?:readonly string[]}[],growthTargets?:readonly {id:string;revision:number}[],thinkingBudget=0,requireMaterial=false):unknown{
  if(currentMessageId&&!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(currentMessageId))throw new Error('CURRENT_MESSAGE_ID_INVALID')
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return payload
  const body={...payload as Record<string,unknown>}
  if(profile.provider!=='bailian')return payload
  if(['qwen3.8-flash','qwen3.8-max','qwen3.7-plus'].includes(profile.id)){
    if(!Number.isSafeInteger(thinkingBudget)||thinkingBudget<0||thinkingBudget>4096||(thinkingBudget>0&&(!maxOutputTokens||thinkingBudget>=maxOutputTokens)))throw new Error('QWEN_THINKING_BUDGET_INVALID')
    body.enable_thinking=thinkingBudget>0
    delete body.reasoning_effort
    delete body.thinking_budget
    if(thinkingBudget>0)body.thinking_budget=thinkingBudget
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
        for(const unknownId of event.activeUnknownIds??[])if(!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(unknownId))throw new Error('EVENT_TARGET_INVALID')
        const previous=unique.get(event.id)
        if(previous&&previous.revision!==event.revision)throw new Error('EVENT_TARGET_REVISION_AMBIGUOUS')
        unique.set(event.id,event)
      }
      target.anyOf=[create,...Array.from(unique.values(),event=>({...existing,properties:{...existing.properties,eventId:{...existing.properties.eventId,enum:[event.id]},expectedRevision:{...existing.properties.expectedRevision,enum:[event.revision]}}}))]
      // Bind unknown dispositions to still-active unknown node IDs across the
      // authorized events, so stale or invented IDs are unrepresentable.
      const activeUnknowns=[...new Set(eventTargets.flatMap(event=>[...(event.activeUnknownIds??[])]))]
      const knownNodes=[...new Set(eventTargets.flatMap(event=>[...(event.nodeIds??[])]))]
      const knownActions=[...new Set(eventTargets.flatMap(event=>[...(event.actionIds??[])]))]
      const eventProperties=compiled.properties?.event?.properties
      if(eventProperties){
        for(const key of ['resolveUnknowns','declineUnknowns']){
          if(!eventProperties[key])continue
          if(activeUnknowns.length)eventProperties[key]={...eventProperties[key],items:{type:'string',enum:activeUnknowns}}
          else delete eventProperties[key]
        }
        if(eventProperties.corrections){
          if(knownNodes.length){
            const items={...eventProperties.corrections.items,properties:{...eventProperties.corrections.items.properties,nodeId:{...eventProperties.corrections.items.properties.nodeId,enum:knownNodes}}}
            eventProperties.corrections={...eventProperties.corrections,items}
          }else delete eventProperties.corrections
        }
        if(Array.isArray(eventProperties.action?.anyOf)){
          const branches=eventProperties.action.anyOf.filter((branch:any)=>{
            if(!branch?.properties?.actionId)return true
            if(knownActions.length){branch.properties.actionId={...branch.properties.actionId,enum:knownActions};return true}
            return false
          })
          if(branches.length)eventProperties.action.anyOf=branches
        }
      }
    }
    if(growthTargets){
      // The growth-enabled native protocol has one personal-fact lane. Legacy
      // stored profiles remain readable and the parser still accepts old turns;
      // confirmed-experience candidates keep their separate opt-in lifecycle.
      delete compiled.properties?.background
      const unique=new Map<string,number>()
      for(const ref of growthTargets){
        if(!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(ref.id)||!Number.isInteger(ref.revision)||ref.revision<1)throw new Error('GROWTH_TARGET_INVALID')
        if(unique.has(ref.id)&&unique.get(ref.id)!==ref.revision)throw new Error('GROWTH_TARGET_REVISION_AMBIGUOUS')
        unique.set(ref.id,ref.revision)
      }
      const items=compiled.properties?.growthUpdates?.items
      if(items?.anyOf)items.anyOf=items.anyOf.filter((branch:any)=>{
        const properties=branch.properties,target=properties?.target
        if(target?.anyOf){
          const create=target.anyOf.find((entry:any)=>entry.properties?.operation?.const==='create'),replace=target.anyOf.find((entry:any)=>entry.properties?.operation?.const==='replace')
          target.anyOf=[create,...Array.from(unique,([id,revision])=>({...replace,properties:{...replace.properties,itemId:{...replace.properties.itemId,enum:[id]},expectedRevision:{...replace.properties.expectedRevision,enum:[revision]}}}))]
        }
        if(properties?.assertion?.const==='ai_observation'){
            const alternatives=properties.dependencies.items.anyOf
            const dependency=alternatives.find((branch:any)=>branch.properties?.id),local=alternatives.find((branch:any)=>branch.properties?.updateIndex)
            properties.dependencies.items={anyOf:[local,...Array.from(unique,([id,revision])=>({...dependency,properties:{...dependency.properties,id:{...dependency.properties.id,enum:[id]},revision:{...dependency.properties.revision,enum:[revision]}}}))]}
        }
        return true
      })
    }
    if(requireMaterial){
      const event=compiled.properties?.event,action=event?.properties?.action
      const drafts=action?.anyOf?.filter((branch:any)=>branch.properties?.draft)
      if(!drafts?.length)throw new Error('MATERIAL_SCHEMA_REQUIRED')
      compiled.required=[...new Set([...compiled.required??[],'event'])]
      event.required=[...new Set([...event.required??[],'action'])]
      action.anyOf=drafts
      compiled.description='本轮明确要求直接起草，reply与event.action均必填。完整可用成品仅生成于draft.content，由服务器展示同一材料；不能仅承诺稍后起草。'
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
