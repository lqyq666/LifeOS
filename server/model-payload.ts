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

export function configureProviderPayload(payload:unknown,profile:ProviderProfile,tier:ModelTier,schema:unknown=actionCoachTurnSchema,schemaName='lifeos_action_coach',maxOutputTokens?:number,currentMessageId?:string,eventTargets?:readonly {id:string;revision:number;activeUnknownIds?:readonly string[];nodeIds?:readonly string[];actionIds?:readonly string[]}[],growthTargets?:readonly {id:string;revision:number}[],thinkingBudget=0,requireMaterial=false,resumePortfolioCatalogueIds?:readonly string[],slimUpdateTimeMode=false,clauseIds?:readonly string[],requireCandidate=false):unknown{
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
    if(eventTargets&&compiled.properties?.event){
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
    if(slimUpdateTimeMode){
      // P5.4: a turn that only updates time/arrangements and reports no
      // executed behaviour does not offer the experience-candidate lane; events
      // stay available for real feedback. This is mode-scoped, never global.
      delete compiled.properties?.experienceCandidate
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
      const updates=compiled.properties?.growthUpdates
      if(updates)updates.description='只保存本轮新增本人事实：source.clauseId选择currentUserMessage.clauses列出的分句，服务器保存其精确原文；本轮没有新事实就输出空数组，寒暄或确认语不是事实；更正旧条目才用correct并选其itemId。'
      const items=updates?.items
      if(items?.anyOf){
        // P1/P2: every clause handle the model can name is enum-bound to the
        // server-built catalogue; a fabricated clauseId (hence a fabricated
        // quote) is unrepresentable.
        const bindClauseId=(node:any)=>{
          if(node?.properties?.clauseId&&clauseIds?.length)node.properties.clauseId={...node.properties.clauseId,enum:[...clauseIds]}
        }
        items.anyOf=items.anyOf.map((branch:any)=>{
          const properties=branch.properties,target=properties?.target
          bindClauseId(properties?.source)
          if(properties?.timeEvidence?.anyOf)for(const evidence of properties.timeEvidence.anyOf)bindClauseId(evidence)
          // The server derives user_reported text from the verified clause; the
          // legacy free-text field only ever let models smuggle stale paraphrases.
          if(properties?.assertion?.const==='user_reported')delete properties.text
          if(target?.anyOf){
            const create=target.anyOf.find((entry:any)=>entry.properties?.operation?.const==='create'),correct=target.anyOf.find((entry:any)=>entry.properties?.operation?.const==='correct')
            if(!create||!correct)throw new Error('GROWTH_TARGET_SCHEMA_REQUIRED')
            // Each authorized item becomes ONE correct alternative; the model
            // selects the item, never the operation or the revision.
            target.anyOf=[create,...Array.from(unique,([id])=>({...correct,properties:{...correct.properties,itemId:{...correct.properties.itemId,enum:[id]}}}))]
          }
          if(properties?.assertion?.const==='ai_observation'){
            const alternatives=properties.dependencies.items.anyOf
            const dependency=alternatives.find((branch:any)=>branch.properties?.id),local=alternatives.find((branch:any)=>branch.properties?.updateIndex)
            properties.dependencies.items={anyOf:[local,...Array.from(unique,([id,revision])=>({...dependency,properties:{...dependency.properties,id:{...dependency.properties.id,enum:[id]},revision:{...dependency.properties.revision,enum:[revision]}}}))]}
          }
          return branch
        })
        const candidate=compiled.properties?.experienceCandidate
        if(candidate?.properties?.source?.properties?.clauseIds&&clauseIds?.length)candidate.properties.source.properties.clauseIds={...candidate.properties.source.properties.clauseIds,items:{...candidate.properties.source.properties.clauseIds.items,enum:[...clauseIds]}}
        // Structured action/result handles are enum-bound to the same
        // server-built catalogue; a fabricated clauseId is unrepresentable.
        for(const field of ['action','result']as const){
          const handle=candidate?.properties?.[field]?.properties?.clauseId
          if(handle&&clauseIds?.length)handle.enum=[...clauseIds]
        }
      }
    }
    if(requireCandidate&&!slimUpdateTimeMode&&compiled.properties?.experienceCandidate){
      // Same pattern as requireMaterial: when the message structurally reports
      // a completed first-person action, the candidate lane stops being
      // omittable — the model must select the verbatim clause range.
      const candidate=compiled.properties.experienceCandidate as {properties?:Record<string,unknown>,required?:string[],description?:string}
      compiled.required=[...new Set([...compiled.required??[],'experienceCandidate'])]
      candidate.required=[...new Set([...candidate.required??[],'source'])]
      const source=candidate.properties?.source as {required?:string[]}|undefined
      if(source)source.required=[...new Set([...source.required??[],'clauseIds'])]
      candidate.description='本轮用户报告了本人已完成的行动：必须选择currentUserMessage.clauses中连续相邻的分句作为经历候选原话；行动与结果分不清时省略action/result。'
    }
    if(requireMaterial){
      const event=compiled.properties?.event,action=event?.properties?.action
      const drafts=action?.anyOf?.filter((branch:any)=>branch.properties?.draft)
      if(!drafts?.length)throw new Error('MATERIAL_SCHEMA_REQUIRED')
      compiled.required=[...new Set([...compiled.required??[],'event'])]
      event.required=[...new Set([...event.required??[],'action'])]
      if(resumePortfolioCatalogueIds){
        // P4.2: a resume/portfolio turn can ONLY select server-verified facts;
        // the legacy free-text branch is unrepresentable in native schema.
        const create=drafts.find((branch:any)=>branch.properties?.operation?.const==='create')
        if(!create)throw new Error('MATERIAL_SCHEMA_REQUIRED')
        const selection=create.properties.draft.anyOf?.find((branch:any)=>branch.properties?.kind?.const==='resume_portfolio')
        if(!selection)throw new Error('MATERIAL_SCHEMA_REQUIRED')
        selection.properties.selectedFactIds={type:'array',items:{type:'string',enum:[...resumePortfolioCatalogueIds]},maxItems:32,description:'只能选择本轮growthCatalogue列出的catalogueId；不能自创新id或提交文字。'}
        create.properties.draft={...create.properties.draft,anyOf:[selection]}
        action.anyOf=[create]
        compiled.description='本轮要求直接起草简历/作品清单类材料。action.draft只能是resume_portfolio选择：从growthCatalogue的catalogueId中选择事实，服务器核对并渲染内容与缺口；不得提交自由文本、新id或宣称可直接发送。'
      }else{
        action.anyOf=drafts
        compiled.description='本轮明确要求直接起草，reply与event.action均必填。完整可用成品仅生成于draft.content，由服务器展示同一材料；不能仅承诺稍后起草。'
      }
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
