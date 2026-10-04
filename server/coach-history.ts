import { transaction, HttpError } from './db.ts'
import { decisionVersions } from './store.ts'
import { assertMemoryEvidence } from './memory.ts'
import { campusView } from './campus.ts'

// A narrow read adapter for saved legacy records, never a planning fallback.
export async function coachHistoryView(user:string,conversation:string){
  return transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user+':memory-settings'])
    const enabled=(await c.query('SELECT enabled FROM user_memory_settings WHERE user_id=$1',[user])).rows[0]?.enabled===true
    const rows=await decisionVersions(user,conversation)
    const decisions=[]
    for(const row of rows){
      let valid=true,hasSource=false
      const refs=[...(row.payload.conditions??[]).map((item:any)=>item.sourceMessageId?{type:'message',messageId:item.sourceMessageId,quote:item.quote??item.text}:item.sourceMemoryId?{type:'memory',memoryId:item.sourceMemoryId,revision:item.sourceRevision}:null),...(row.payload.basis??[])].filter(Boolean)
      for(const ref of refs){
        hasSource=true
        if(ref.type==='memory'){
          try{await assertMemoryEvidence(user,ref.memoryId,ref.revision,enabled)}catch(error){if(!(error instanceof HttpError))throw error;valid=false}
        }else{
          const source=(await c.query(`SELECT m.content,m.conversation_id FROM messages m WHERE m.user_id=$1 AND m.id=$2 AND m.role='user'
            AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE s.user_id=m.user_id AND s.source_message_id=m.id)
            AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)
            AND NOT EXISTS(SELECT 1 FROM experiences e WHERE e.user_id=m.user_id AND e.source_message_id=m.id AND e.status='deleted')`,[user,ref.messageId])).rows[0]
          if(!source||(!enabled&&source.conversation_id!==conversation)||typeof ref.quote!=='string'||!ref.quote.trim()||!source.content.includes(ref.quote))valid=false
        }
      }
      decisions.push({version:row.version,payload:valid&&hasSource?row.payload:null})
    }
    const campus=await campusView(user,conversation)
    return {decisions,inquiries:campus.inquiries.map(item=>({id:item.id,stale:item.stale||item.sources.some(source=>!source.valid),payload:item.stale||item.sources.some(source=>!source.valid)?null:{question:item.payload.question,experiments:item.payload.experiments.map(experiment=>({action:experiment.action}))}}))}
  })
}
