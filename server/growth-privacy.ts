import type { PoolClient } from 'pg'
import type { DialogueMessage } from './dialogue.ts'
import { pool } from './db.ts'
type DB=Pick<PoolClient,'query'>

export async function growthQuoteSuppressed(c:DB,user:string,messageId:string,quote:string) {
  return !!(await c.query('SELECT 1 FROM growth_source_suppressions WHERE user_id=$1 AND message_id=$2 AND (strpos($3,quote)>0 OR strpos(quote,$3)>0) LIMIT 1',[user,messageId,quote])).rowCount
}
export async function redactGrowthHistory(user:string,messages:DialogueMessage[]):Promise<DialogueMessage[]> {
  if(!messages.length)return messages
  const suppressions=(await pool.query('SELECT s.message_id,s.quote,m.run_request_id FROM growth_source_suppressions s JOIN messages m ON m.user_id=s.user_id AND m.id=s.message_id WHERE s.user_id=$1',[user])).rows
  if(!suppressions.length)return messages
  const derivedRuns=(await pool.query("SELECT origin_request_id FROM growth_items WHERE user_id=$1 AND text='' AND status IN ('forgotten','stale') AND origin_request_id IS NOT NULL",[user])).rows
  const hiddenRuns=[...new Set([...suppressions.map(row=>row.run_request_id),...derivedRuns.map(row=>row.origin_request_id)])]
  const hiddenAssistantIds=new Set((await pool.query("SELECT id FROM messages WHERE user_id=$1 AND role='assistant' AND run_request_id=ANY($2::uuid[])",[user,hiddenRuns])).rows.map(row=>row.id))
  return messages.filter(message=>!hiddenAssistantIds.has(message.id)).map(message=>{
    let content=message.content
    for(const row of suppressions)if(message.role==='assistant'||row.message_id===message.id)content=content.split(row.quote).join('[这项信息已停止使用]')
    return {...message,content}
  })
}
