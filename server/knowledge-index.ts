import {pool,transaction,HttpError} from './db.ts'
import type {KnowledgeCard} from './campus-knowledge.ts'
import {localEmbedding,embeddingSignature} from './local-embedding.ts'
import {readFileSync} from 'node:fs'
import {guideSegments,kbHash,stableJson,kbTerms,guideIsUsable,reciprocalRankFusion,deduplicateGuides,type KnowledgeIntent} from './evergreen-guide.ts'

type Encode=(texts:string[],query?:boolean,signal?:AbortSignal)=>Promise<number[][]>
type Segment={guide_id:string;revision:number;part:string;content_hash:string;body:string;evidence_ids:string[];embedding:number[]}
type Snapshot={epoch:string;cards:KnowledgeCard[];segments:Segment[]}
let snapshot:Snapshot|undefined,building:Promise<unknown>|undefined
const activeCardsSql=`SELECT payload FROM campus_knowledge k WHERE status='verified' AND (valid_until IS NULL OR valid_until>now()) AND official_knowledge_current(payload) AND kb_knowledge_current(payload)
 AND (NOT synthetic OR current_database() ~ '^lifeos_dialogue_(test|live)_')
 AND NOT EXISTS(SELECT 1 FROM kb_aliases a JOIN campus_knowledge target ON target.id=a.guide_id WHERE a.alias=k.id::text AND target.status='verified' AND target.payload#>>'{guide,reviewStatus}'='approved' AND kb_knowledge_current(target.payload)) ORDER BY id`
// Index-only editorial paraphrases carry no steps, sources or effect claims.
// Bind them to the exact canonical body; a new revision cannot inherit stale cues.
const expressionProfiles=JSON.parse(readFileSync(new URL('../.planning/research/evergreen/KB_RETRIEVAL_EXPRESSIONS.json',import.meta.url),'utf8')).profiles as {canonicalKey:string;contentHash:string;revision:number;expressions:string[]}[]
export const knowledgeIndexSignature=embeddingSignature+':evergreen-segments-v3-expressions:'+kbHash(stableJson(expressionProfiles))
function retrievalExpressions(card:KnowledgeCard){return expressionProfiles.find(p=>p.canonicalKey===card.guide?.canonicalKey&&p.contentHash===card.guide?.contentHash&&p.revision===card.revision)?.expressions??[]}
const dot=(a:number[],b:number[])=>a.reduce((sum,x,i)=>sum+x*b[i],0)

export async function buildKnowledgeIndex(signal?:AbortSignal,encode:Encode=localEmbedding.encode.bind(localEmbedding)){
 signal?.throwIfAborted()
 const state=(await pool.query('SELECT * FROM kb_index_state WHERE singleton')).rows[0]
 const rows=(await pool.query(activeCardsSql)).rows
 const cards=rows.map(row=>row.payload as KnowledgeCard).filter(guideIsUsable)
 const previous=(await pool.query('SELECT guide_id,revision,part,content_hash,body,evidence_ids,embedding FROM kb_segments WHERE signature LIKE $1',[embeddingSignature+':evergreen-segments-%'])).rows as Segment[]
 const cached=new Map(previous.map(row=>[`${row.guide_id}:${row.revision}:${row.part}:${row.content_hash}`,row]))
 const segments=cards.flatMap(card=>[...guideSegments(card),...retrievalExpressions(card).map((text,i)=>({part:'expression:'+i,text,evidenceIds:card.guide?.evidenceIds??[]}))].map(part=>({guide_id:card.id,revision:card.revision,part:part.part,body:part.text,content_hash:kbHash(part.text),evidence_ids:part.evidenceIds,embedding:[] as number[]})))
 const missing:Segment[]=[]
 for(const segment of segments){const old=cached.get(`${segment.guide_id}:${segment.revision}:${segment.part}:${segment.content_hash}`);if(old)segment.embedding=old.embedding;else missing.push(segment)}
 for(let at=0;at<missing.length;at+=32){signal?.throwIfAborted();const batch=missing.slice(at,at+32),vectors=await encode(batch.map(part=>part.body),false,signal);if(vectors.length!==batch.length||vectors.some(v=>v.length!==512||v.some(n=>!Number.isFinite(n))))throw new HttpError(503,'KB_INDEX_VECTOR_INVALID');batch.forEach((part,i)=>part.embedding=vectors[i])}
 const corpusHash=kbHash(stableJson(cards.map(card=>({id:card.id,revision:card.revision,hash:card.guide?.contentHash??card.sourceHash}))))
 await transaction(async c=>{
  const latest=(await c.query('SELECT * FROM kb_index_state WHERE singleton FOR UPDATE')).rows[0]
  if(String(latest.epoch)!==String(state.epoch))throw new HttpError(409,'KB_INDEX_CHANGED_DURING_BUILD')
  for(const segment of segments)await c.query('INSERT INTO kb_segments(guide_id,revision,signature,part,content_hash,body,evidence_ids,embedding) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[segment.guide_id,segment.revision,knowledgeIndexSignature,segment.part,segment.content_hash,segment.body,JSON.stringify(segment.evidence_ids),segment.embedding])
  // Publish only after the entire build is complete. A failed/cancelled build
  // never advertises a partial new serving generation.
  await c.query('UPDATE kb_index_state SET signature=$1,indexed_epoch=epoch,corpus_hash=$2 WHERE singleton',[knowledgeIndexSignature,corpusHash])
 })
 snapshot={epoch:String(state.epoch),cards,segments}
 return {signature:knowledgeIndexSignature,epoch:String(state.epoch),corpusHash,cards:cards.length,segments:segments.length,encodedSegments:missing.length,cacheHits:segments.length-missing.length}
}

async function readIndex(signal?:AbortSignal){
 signal?.throwIfAborted()
 const state=(await pool.query('SELECT * FROM kb_index_state WHERE singleton')).rows[0]
 if(state.signature!==knowledgeIndexSignature||String(state.indexed_epoch)!==String(state.epoch)){
  // Legacy importers remain compatible: one cold maintenance build. Warm
  // turns encode just the query, never 1000 cards through a 128-row LRU.
  if(!building){building=buildKnowledgeIndex(signal);try{await building}finally{building=undefined}}
  else await building
  signal?.throwIfAborted()
 }
 const current=(await pool.query('SELECT * FROM kb_index_state WHERE singleton')).rows[0]
 if(!snapshot||snapshot.epoch!==String(current.epoch)){
  const rows=(await pool.query(activeCardsSql)).rows
  const cards=rows.map(row=>row.payload as KnowledgeCard).filter(guideIsUsable)
  const segments=(await pool.query('SELECT s.guide_id,s.revision,s.part,s.content_hash,s.body,s.evidence_ids,s.embedding FROM kb_segments s JOIN campus_knowledge k ON k.id=s.guide_id AND k.revision=s.revision WHERE s.signature=$1',[knowledgeIndexSignature])).rows as Segment[]
  snapshot={epoch:String(current.epoch),cards,segments}
 }
 return snapshot!
}
export type KnowledgeTrace={signature:string;epoch:string;candidates:{id:string;keyword:number;semantic:number;rrf:number;reason:string}[];selected:string[];queryEncoded:boolean}

export function rankKnowledgeCandidates(cards:KnowledgeCard[],segments:Segment[],query:string,vector:number[],intent?:KnowledgeIntent){
 const generic=new Set(kbTerms('怎么如何怎样什么哪些方法办法步骤一下一个这个那个上次下次可以应该需要先做先问从哪开始现在已经还有仍然本人实际问题任务知道结果调整比较第一次方式当前情况出来这样事情'))
 const terms=kbTerms(query).filter(t=>!generic.has(t)),querySet=new Set(terms)
 // Rank the requested mechanism, not repeated generic instructions in every
 // feedback/step paragraph. Full boundaries still travel with the selected card.
 const searchable=(card:KnowledgeCard)=>[card.title,...card.guide?.aliases??[],card.guide?.retrievalSummary??card.claim,...(card.guide?.branches??[]).map(b=>b.task),...retrievalExpressions(card)].join(' ')
 const documents=cards.map(card=>new Set(kbTerms(searchable(card))))
 const weights=new Map(terms.map(term=>[term,Math.log(1+(cards.length+1)/(documents.filter(doc=>doc.has(term)).length+1))]))
 const byGuide=new Map<string,Segment[]>()
 for(const segment of segments){const key=segment.guide_id+':'+segment.revision;const group=byGuide.get(key)??[];group.push(segment);byGuide.set(key,group)}
 const scored=cards.filter(guideIsUsable).map(card=>{
  const keyword=kbTerms(searchable(card)).filter(t=>querySet.has(t)).reduce((sum,t)=>sum+(weights.get(t)??0),0)
  const parts=byGuide.get(card.id+':'+card.revision)??[]
  const core=parts.filter(s=>s.part==='mechanism'||s.part.startsWith('action:')||s.part.startsWith('expression:')||s.part==='legacy')
  const semantic=Math.max(-1,...(core.length?core:parts).map(s=>dot(s.embedding,vector)))
  const aliasExact=(card.guide?.aliases??[]).filter(a=>a.length>=2&&query.includes(a)&&!generic.has(a)).length
  const directTask=(card.guide?.branches??[]).filter(b=>query.includes(b.task)).length
  return {card,keyword:keyword+aliasExact*4+directTask*12,semantic}
 })
 const lexical=scored.filter(s=>s.keyword>=5).sort((a,b)=>b.keyword-a.keyword||a.card.id.localeCompare(b.card.id)).slice(0,20)
 const semantic=scored.filter(s=>s.semantic>=0.43).sort((a,b)=>b.semantic-a.semantic||a.card.id.localeCompare(b.card.id)).slice(0,20)
 const fused=reciprocalRankFusion([lexical.map(s=>s.card.id),semantic.map(s=>s.card.id)])
 // RRF provides candidates. Only lexical evidence strong enough to enter
 // the lexical candidate list may affect ordering; an incidental single
 // word must not overturn the semantic match of the actual problem.
 const lexicalSupport=(keyword:number)=>keyword>=5?Math.min(keyword,15)*0.012:0
 const ranked=fused.map(([id,rrf])=>({...scored.find(s=>s.card.id===id)!,rrf})).sort((a,b)=>(b.semantic+lexicalSupport(b.keyword))-(a.semantic+lexicalSupport(a.keyword))||b.rrf-a.rrf||b.keyword-a.keyword||a.card.id.localeCompare(b.card.id))
 // Applicability unknowns are kept. A case-only ask may use a bounded method
 // for comparison, but no made-up case is returned.
 const candidates=ranked.slice(0,20),eligible=candidates.filter(s=>s.card.guide?(s.keyword>=5||s.semantic>=0.43):s.semantic>=0.5)
 const top5=eligible.slice(0,5)
 return {top5:top5.map(s=>s.card),selected:deduplicateGuides(top5.map(s=>s.card)),candidates:candidates.map(s=>({id:s.card.id,keyword:s.keyword,semantic:s.semantic,rrf:s.rrf,reason:top5.some(x=>x.card.id===s.card.id)?'eligible':'below_applicability_cutoff'}))}
}
export async function retrieveIndexedKnowledge(query:string,signal?:AbortSignal,intent?:KnowledgeIntent,applies:(card:KnowledgeCard)=>boolean=()=>true){
 const index=await readIndex(signal)
 const vector=index.cards.length?(await localEmbedding.encode([query],true,signal))[0]:[]
 const ranked=rankKnowledgeCandidates(index.cards.filter(applies),index.segments,query,vector,intent)
 // Query-phase revalidation in SQL after scoring, including synthetic scope.
 const ids=ranked.top5.map(card=>card.id),rows=ids.length?(await pool.query("SELECT id,revision FROM campus_knowledge WHERE id=ANY($1::uuid[]) AND status='verified' AND (valid_until IS NULL OR valid_until>now()) AND official_knowledge_current(payload) AND kb_knowledge_current(payload) AND (NOT synthetic OR current_database() ~ '^lifeos_dialogue_(test|live)_')",[ids])).rows:[]
 const selected=deduplicateGuides(ranked.top5.filter(card=>rows.some(row=>row.id===card.id&&row.revision===card.revision)))
 return {cards:selected,trace:{signature:knowledgeIndexSignature,epoch:index.epoch,candidates:ranked.candidates,selected:selected.map(c=>c.id),queryEncoded:Boolean(vector.length)} satisfies KnowledgeTrace}
}
export function clearKnowledgeIndexMemory(){snapshot=undefined}
