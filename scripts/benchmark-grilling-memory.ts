import {mkdirSync,writeFileSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {performance} from 'node:perf_hooks'
import {execFileSync} from 'node:child_process'
import {clearExperienceVectorCache,experienceVectorCacheStats,rankConfirmedCoachExperiences} from '../server/coach-retrieval.ts'
import {embeddingSignature,localEmbedding} from '../server/local-embedding.ts'

const output=resolve(process.argv[2]??'.local/grilling/memory-scale.json')
const results:Record<string,unknown>[]=[]

try{
  await localEmbedding.start()
  for(const size of [100,1000]){
    clearExperienceVectorCache()
    let encodedTexts=0,encodeCalls=0
    const encode=async(texts:string[],query=false)=>{
      encodedTexts+=texts.length;encodeCalls++
      return localEmbedding.encode(texts,query)
    }
    const rows=Array.from({length:size},(_,index)=>({
      id:`grilling-memory-${size}-${index}`,revision:1,conversation_id:index%2?'other':'current',updated_at:new Date(Date.UTC(2025,0,1+index%20)).toISOString(),source_message_id:`synthetic-message-${index}`,source_quote:index===0?'三年前我负责过校园旧书活动的现场协调':'合成经历',
      content:index===0
        ?{summary:'三年前我负责过校园旧书活动的现场协调',action:'我协调摊位和志愿者轮班',result:'当天活动顺利结束',reflection:'旧但关键的组织经历仍应在相关问题中找回'}
        :{summary:`第${index}次普通课程记录`,action:`完成课程练习${index}`,result:`保存练习结果${index}`,reflection:`普通复盘${index}`},
    }))
    const query='我以前有没有协调校园旧书活动和志愿者的经历？'
    const coldStart=performance.now(),cold=await rankConfirmedCoachExperiences(rows,query,4,{currentConversationId:'current',encode}),coldMs=performance.now()-coldStart
    const coldEncoded=encodedTexts,coldCalls=encodeCalls
    const warmStart=performance.now(),warm=await rankConfirmedCoachExperiences(rows,query,4,{currentConversationId:'current',encode}),warmMs=performance.now()-warmStart
    const hitId=rows[0]!.id
    results.push({size,cold:{milliseconds:Number(coldMs.toFixed(3)),encodedTexts:coldEncoded,encodeCalls:coldCalls,topId:cold[0]?.id,oldRelevantFactFound:cold.some(row=>row.id===hitId)},warm:{milliseconds:Number(warmMs.toFixed(3)),encodedTexts:encodedTexts-coldEncoded,encodeCalls:encodeCalls-coldCalls,topId:warm[0]?.id,oldRelevantFactFound:warm.some(row=>row.id===hitId)},cache:experienceVectorCacheStats()})
  }
  const report={status:results.every((result:any)=>result.cold.oldRelevantFactFound&&result.warm.oldRelevantFactFound&&result.warm.encodedTexts===1)?'PASS':'FAIL',evidence:'REAL_LOCAL_EMBEDDING_SYNTHETIC_ADULT_SCALE',codeHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),embeddingSignature,generatedAt:new Date().toISOString(),results}
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n')
  process.stdout.write(JSON.stringify(report,null,2)+'\n')
  if(report.status!=='PASS')process.exitCode=1
}finally{
  await localEmbedding.close()
}
