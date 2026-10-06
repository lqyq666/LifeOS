import {createHash} from 'node:crypto'
import type { GrowthItem } from '../src/features/growth/types.ts'

/** Renderer accepts server-verified catalogue entries, never free model factual prose. */
export type MaterialField = 'identity' | 'target' | 'project' | 'skill' | 'contact'
export type VerifiedMaterialFact = {
  catalogueId: string; field: MaterialField; text: string;
  // Created by server catalogue validation; do not deserialize this type from an LLM.
  sourceKind: 'user_reported' | 'user_edit';
  completeForField: boolean; // True only for explicitly provided complete field data.
}
export type MaterialResult = {
  content: string; readiness: 'template' | 'draft_for_user_review';
  missingRequired: MaterialField[]; usedCatalogueIds: string[];
}
const labels: Record<MaterialField, string> = {
  identity: '个人基本信息', target: '求职意向', project: '作品与本人贡献',
  skill: '本人明确提供的技能', contact: '联系方式',
}
const required: MaterialField[] = ['identity', 'target', 'project', 'contact']
export function renderGroundedResume(
  selectedIds: readonly string[], catalogue: readonly VerifiedMaterialFact[],
): MaterialResult {
  if (selectedIds.length > 32 || new Set(selectedIds).size !== selectedIds.length) throw new Error('MATERIAL_REFERENCE_INVALID')
  const byId = new Map(catalogue.map(fact => [fact.catalogueId, fact]))
  if (byId.size !== catalogue.length) throw new Error('MATERIAL_CATALOGUE_INVALID')
  const selected = selectedIds.map(id => {
    const fact = byId.get(id)
    if (!fact || !['user_reported', 'user_edit'].includes(fact.sourceKind) || !fact.text.trim() ||
        !Object.hasOwn(labels, fact.field) || fact.text.length > 4000) throw new Error('MATERIAL_REFERENCE_INVALID')
    return fact
  })
  const present = new Set(selected.filter(fact => fact.completeForField === true).map(fact => fact.field))
  const missingRequired = required.filter(field => !present.has(field))
  const readiness = missingRequired.length ? 'template' : 'draft_for_user_review'
  const lines = [readiness === 'template' ? '简历与作品清单（待补信息模板）' : '简历与作品清单（发送前请核对）']
  for (const field of Object.keys(labels) as MaterialField[]) {
    lines.push('', labels[field])
    const facts = selected.filter(fact => fact.field === field)
    if (facts.length) for (const fact of facts) lines.push(fact.text)
    else lines.push(field === 'skill' ? '【尚未提供工具和熟练程度，可先删除本栏】' : `【待补：${labels[field]}】`)
  }
  lines.push('', '请核对个人信息、项目贡献和联系方式；不要将待补字段当作已确认事实。')
  const content = lines.join('\n')
  if (content.length > 12000) throw new Error('MATERIAL_OUTPUT_LIMIT')
  return { content, readiness, missingRequired, usedCatalogueIds: [...selectedIds] }
}

// ---- P4.3 server catalogue: candidates come only from the user's own verified
// words, real user edits and confirmed experiences — never AI observations,
// unknowns, assistant replies or plan inferences.

export type ConfirmedExperienceLike={id:string;revision:number;content:{summary?:string}|null;source_quote?:string}
const catalogueId=(value:string)=>`mf-${createHash('sha256').update(value).digest('hex').slice(0,24)}`
const kindField:Partial<Record<GrowthItem['kind'],MaterialField>>={
  goal:'target',direction:'target',ability:'project',preference:'skill',context:'identity',
}
// A complete contact is a strictly patterned value the user actually supplied.
const completeContact=(text:string)=>/(?:[\w.+-]+@[\w-]+\.[\w.-]+)|(?:1[3-9]\d{9})/.test(text)
const completeIdentity=(text:string)=>/姓名[:：]\s*\S{1,20}/.test(text)

export function buildMaterialFactCatalogue(growth: readonly GrowthItem[], confirmedExperiences: readonly ConfirmedExperienceLike[]=[]):VerifiedMaterialFact[]{
  const catalogue:VerifiedMaterialFact[]=[]
  for(const item of growth){
    if(item.unavailableReason||!['active','proposed'].includes(item.status))continue
    if(item.assertion!=='user_reported'&&item.assertion!=='user_edit')continue
    if(!item.text.trim()||item.text.length>4000)continue
    const field=item.kind==='constraint'||item.kind==='feedback'||item.kind==='priority'||item.kind==='decision'||item.kind==='unknown'||item.kind==='observation'?null:kindField[item.kind]
    if(!field)continue
    // "我有三个作品" only proves works exist — it is never a complete project
    // entry with role/outcome. Completeness is reserved for patterned values.
    const completeForField=(field==='contact'&&completeContact(item.text))||(field==='identity'&&completeIdentity(item.text))
    catalogue.push({catalogueId:catalogueId(`growth:${item.id}:${item.revision}`),field,text:item.text,sourceKind:item.assertion==='user_edit'?'user_edit':'user_reported',completeForField})
  }
  for(const experience of confirmedExperiences){
    const text=(experience.content?.summary??experience.source_quote??'').trim()
    if(!text||text.length>4000)continue
    catalogue.push({catalogueId:catalogueId(`experience:${experience.id}:${experience.revision}`),field:'project',text,sourceKind:'user_reported',completeForField:false})
  }
  return catalogue
}

// Resolve a model's selection against THIS turn's server catalogue; any
// invented, stale or cross-account id is MATERIAL_REFERENCE_INVALID.
export function resolveSelectedMaterialFacts(selectedIds:readonly string[],catalogue:readonly VerifiedMaterialFact[],ownerId:string,expectedOwnerId:string):MaterialResult{
  if(ownerId!==expectedOwnerId)throw new Error('MATERIAL_REFERENCE_INVALID')
  return renderGroundedResume(selectedIds,catalogue)
}
