import seed from './data/lifeos-graph.seed.json' with { type: 'json' }

export type Node = typeof seed.nodes[number] & { serverId?: string; serverRevision?: number; conversationId?: string; conversationTitle?: string; sourceMessageId?: string; themeId?: string; themeKind?: 'goal'|'pursuit'|'valued_point'|'interest'; themeStatus?: 'active'|'pending'|'paused'|'retired'; themePinned?: boolean; themeRevision?: number; themeUpdatedAt?: string }
export type Edge = typeof seed.edges[number]
export type GraphData = Omit<typeof seed, 'nodes'> & { nodes: Node[] }
export type Review = { disposition: 'accepted' | 'edited' | 'rejected'; editedReason?: string; reviewedAt: string }
export type Reviews = Record<string, Review>
export const REVIEW_KEY = 'lifeos.relationship-reviews.v1'

export function createGraph(data: GraphData) {
  const nodes = new Map(data.nodes.map(node => [node.id, node]))
  if (nodes.size !== data.nodes.length) throw new Error('Duplicate node ID')
  if (data.nodes.filter(n => n.type === 'self').length !== 1 || nodes.get(data.rootId)?.type !== 'self') throw new Error('Invalid self root')
  if (data.nodes.some(n => !['self', 'value', 'experience'].includes(n.type))) throw new Error('Invalid content layer')
  const edgeIds = new Set<string>(), pairs = new Set<string>()
  for (const e of data.edges) {
    const source = nodes.get(e.sourceId), target = nodes.get(e.targetId)
    if (!source || !target || target.type !== 'value' || !((e.type === 'HAS_VALUE' && source.type === 'self') || (e.type === 'RELATES_TO_VALUE' && source.type === 'experience'))) throw new Error(`Invalid edge ${e.id}`)
    const pair = `${e.type}:${e.sourceId}:${e.targetId}`
    if (edgeIds.has(e.id) || pairs.has(pair)) throw new Error(`Duplicate edge ${e.id}`)
    edgeIds.add(e.id); pairs.add(pair)
  }
  const ordered = (type: string, ids: string[]) => {
    if (new Set(ids).size !== ids.length || ids.some(id => nodes.get(id)?.type !== type)) throw new Error(`Invalid ${type} order`)
    return [...ids, ...data.nodes.filter(n => n.type === type && !ids.includes(n.id)).sort((a,b)=>(a.overviewOrder ?? 0)-(b.overviewOrder ?? 0)).map(n=>n.id)]
  }
  const values = ordered('value', data.viewConfig.valueOrder)
  const experiences = ordered('experience', data.viewConfig.overviewExperienceOrder)
  if (values.some(id => !data.edges.some(e => e.type === 'HAS_VALUE' && e.targetId === id))) throw new Error('Value without self link')
  const effectiveEdges = (reviews: Reviews = {}) => data.edges.filter(e => reviews[e.id]?.disposition !== 'rejected')
  const getExperiencesForValue = (id: string, reviews: Reviews = {}) => {
    const linked = new Set(effectiveEdges(reviews).filter(e => e.type === 'RELATES_TO_VALUE' && e.targetId === id).map(e=>e.sourceId))
    return experiences.filter(id=>linked.has(id))
  }
  const getValueIdsForExperience = (id: string, reviews: Reviews = {}) => values.filter(value=>effectiveEdges(reviews).some(e=>e.sourceId===id && e.targetId===value))
  const getRelationExplanation = (id: string, value: string) => data.edges.find(e=>e.sourceId===id && e.targetId===value && e.type==='RELATES_TO_VALUE')
  return { data, nodes, values, experiences, effectiveEdges, getExperiencesForValue, getValueIdsForExperience, getRelationExplanation,
    getNode: (id: string) => nodes.get(id),
    getDecisionContext: (ids: string[], reviews: Reviews = {}) => ({ nodes: ids.map(id=>nodes.get(id)).filter(Boolean), edges: effectiveEdges(reviews).filter(e=>ids.includes(e.sourceId)||ids.includes(e.targetId)).map(e=>({ ...e, localReview: reviews[e.id] ?? null, verifiedFact: false })) }) }
}
export let graph = createGraph(seed)
export let graphSource: 'demo' | 'database' = 'demo'
let graphRevision = 0
const graphListeners = new Set<() => void>()
export const subscribeGraph = (listener: () => void) => { graphListeners.add(listener); return () => { graphListeners.delete(listener) } }
export const getGraphRevision = () => graphRevision
export function replaceGraph(data: GraphData | null) {
  const next = createGraph(data ?? seed)
  graph = next; graphSource = data ? 'database' : 'demo'; graphRevision++
  graphListeners.forEach(listener => listener())
}

export function parseReviews(raw: string | null): Reviews {
  if (!raw) return {}
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid review data')
  const result: Reviews = {}
  for (const [id, value] of Object.entries(parsed)) {
    if (!graph.data.edges.some(e=>e.id===id && e.type==='RELATES_TO_VALUE')) continue
    const r = value as Review
    if (!r || !['accepted','edited','rejected'].includes(r.disposition) || !Number.isFinite(Date.parse(r.reviewedAt)) || (r.disposition==='edited' && (typeof r.editedReason !== 'string' || !r.editedReason.trim()))) throw new Error('Invalid review entry')
    result[id] = {disposition:r.disposition,reviewedAt:r.reviewedAt,...(r.editedReason ? {editedReason:r.editedReason.slice(0,2000)} : {})}
  }
  return result
}
