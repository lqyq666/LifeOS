import {readFileSync,writeFileSync} from 'node:fs'
import {knowledgeIntent,kbHash} from '../server/evergreen-guide.ts'
import {retrieveIndexedKnowledge} from '../server/knowledge-index.ts'
import type {KnowledgeCard} from '../server/campus-knowledge.ts'
export async function evaluateEvergreen(cards:KnowledgeCard[],output?:{jsonPath:string;markdownPath:string}){
 const root='.planning/research/evergreen/',bytes=readFileSync(root+'KB_QUERY_BENCHMARK.json','utf8'),freeze=JSON.parse(readFileSync(root+'KB_FREEZE.json','utf8'))
 if(kbHash(bytes)!==freeze.benchmark)throw new Error('FROZEN_BENCHMARK_CHANGED')
 const approved=new Set(cards.filter(c=>c.status==='verified'&&c.guide?.reviewStatus==='approved').map(c=>c.guide!.canonicalKey))
 const results:Record<string,any>[]=[]
 for(const c of JSON.parse(bytes).cases){
  const intent=knowledgeIntent(c.text),eligible=c.acceptableKeys.some((key:string)=>approved.has(key))
  const start=performance.now(),found=!['NONE','CLARIFY'].includes(intent.decision)?await retrieveIndexedKnowledge(intent.query,undefined,intent):null
  const keys=(found?.cards??[]).map(card=>card.guide?.canonicalKey??card.id),targetIds=cards.filter(card=>c.acceptableKeys.includes(card.guide?.canonicalKey)).map(card=>card.id)
  results.push({...c,actualRoute:intent.decision,routeCorrect:intent.decision===c.expectedRoute,keys,availableTarget:eligible,retrievalMs:Math.round((performance.now()-start)*100)/100,top1Correct:eligible&&c.acceptableKeys.includes(keys[0]),recall5:eligible&&Boolean(found?.trace.candidates.some(row=>row.reason==='eligible'&&targetIds.includes(row.id))),trace:found?.trace??null})
 }
 const groups=(field:string)=>Object.fromEntries([...new Set(results.map(r=>r[field]))].map(value=>{const part=results.filter(r=>r[field]===value),available=part.filter(r=>r.availableTarget);return [value,{routing:{numerator:part.filter(r=>r.routeCorrect).length,denominator:part.length},recall5:{numerator:available.filter(r=>r.recall5).length,denominator:available.length},top1:{numerator:available.filter(r=>r.top1Correct).length,denominator:available.length}}]}))
 const available=results.filter(r=>r.availableTarget)
 const evaluation={status:'PARTIAL_CORPUS_EVALUATED',evidence:'REAL_LOCAL_ENCODER_AND_ISOLATED_POSTGRESQL',realProviderCalls:0,benchmarkHash:freeze.benchmark,benchmarkCaveat:'Template queries frozen before code; holdout has now been inspected during regression repair and is no longer an unseen final holdout. No 90% generalization claim.',corpus:{drafts:cards.length,approved:approved.size,unavailablePositiveTargets:results.filter(r=>r.acceptableKeys.length&&!r.availableTarget).length},routing:{numerator:results.filter(r=>r.routeCorrect).length,denominator:results.length},recall5:{numerator:available.filter(r=>r.recall5).length,denominator:available.length},top1:{numerator:available.filter(r=>r.top1Correct).length,denominator:available.length},byDomain:groups('domain'),byStage:groups('stage'),bySplit:groups('split'),cases:results}
 const options=output?{flag:'wx' as const}:undefined
 writeFileSync(output?.jsonPath??root+'KB_RETRIEVAL_EVAL.json',JSON.stringify(evaluation,null,2)+'\n',options)
 writeFileSync(output?.markdownPath??root+'KB_RETRIEVAL_EVAL.md',`# 本地检索评估\n\n证据：真实离线编码器、隔离PostgreSQL，真实Provider调用0。\n\n路由 ${evaluation.routing.numerator}/${evaluation.routing.denominator}；已审卡目标 Recall@5 ${evaluation.recall5.numerator}/${evaluation.recall5.denominator}，Top1 ${evaluation.top1.numerator}/${evaluation.top1.denominator}。\n\n正式32卡中${approved.size}张保留历史approved状态；本轮32修订稿的真实独立审阅和人工批准均为0。未审稿目标不混入可召回分母；全部112范围仍保留。领域、阶段、split与每条trace见JSON。\n\n测试集多数为模板问题；holdout已在回归修复中曝光，不能作为未见最终验收。真实对话、手机、4条连续链和20正常样本另行验收。\n`,options)
 return evaluation
}
