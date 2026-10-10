import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {kbHash,guideIsUsable,validateEvergreenGuide,guideContentHash} from '../server/evergreen-guide.ts'
import type {KnowledgeCard} from '../server/campus-knowledge.ts'

// This command only creates a reviewable local plan from the public corpus.
// It never reads user data, credentials, databases or invokes the Coze CLI.
const root='.planning/research/evergreen/',out='.planning/research/coze-codex/'
const read=(file:string)=>readFileSync(root+file,'utf8').trim().split('\n').map(line=>JSON.parse(line))
const cards=read('KB_GUIDES.jsonl') as KnowledgeCard[]
const sources=read('KB_SOURCE_REGISTRY.jsonl'),evidence=read('KB_EVIDENCE.jsonl')
const approved=cards.filter(card=>card.guide&&guideIsUsable(card))
for(const card of approved)validateEvergreenGuide(card)
const documents=approved.map(card=>({
 documentId:'evergreen-'+card.guide!.canonicalKey,
 canonicalId:card.id,revision:card.revision,guideContentHash:guideContentHash(card.guide!),sourceHash:card.sourceHash,
 sourceRevisions:card.guide!.review!.sourceRevisions,evidenceIds:card.guide!.evidenceIds,
 remoteConfirmed:false,registryEnabled:false,
 // Exact local public content; a remote generator must not rewrite this card.
 card,
}))
const sourceIds=new Set(approved.flatMap(card=>[...card.guide!.sourceGroups,...Object.keys(card.guide!.review!.sourceRevisions)]))
const evidenceIds=new Set(approved.flatMap(card=>card.guide!.evidenceIds))
for(const document of documents){
 if(!document.evidenceIds.every(id=>evidence.some(item=>item.evidence_id===id)))throw new Error('MIRROR_EVIDENCE_MISSING')
 if(!Object.entries(document.sourceRevisions).every(([id,revision])=>sources.some(source=>source.source_id===id&&source.source_revision===revision)))throw new Error('MIRROR_SOURCE_REVISION_MISSING')
}
const plan={schemaVersion:1,createdAt:new Date().toISOString(),state:'LOCAL_PLAN_NOT_SYNCED',targetProjectId:'7693465311558795327',datasetId:null,authorization:'Separate mirror sync authorization required; this plan performs no external write.',privateDataIncluded:false,corpusFileHash:kbHash(readFileSync(root+'KB_GUIDES.jsonl','utf8')),documents,sources:sources.filter(source=>sourceIds.has(source.source_id)),evidence:evidence.filter(item=>evidenceIds.has(item.evidence_id)),excludedCards:cards.filter(card=>!approved.includes(card)).map(card=>({id:card.id,revision:card.revision,reason:card.guide?.reviewStatus??card.status})),activationChecks:['Confirm cloud dataset and explicit sync scope','Revalidate approved status, source revision, canonical ID and hash against current local authority','Import exact public content idempotently; preserve historical revisions','Read remote content back and compare canonical ID/revision/hash','Enable registry bindings only after successful content comparison','Prove public query whitelist and zero student memory upload; do not make this workflow a second companion']}
mkdirSync(out,{recursive:true})
writeFileSync(out+'COZE_MIRROR_PLAN.json',JSON.stringify(plan,null,2)+'\n')
console.log(JSON.stringify({status:plan.state,approved:documents.length,excluded:plan.excludedCards.length,remoteWrites:0,privateDataIncluded:false}))
