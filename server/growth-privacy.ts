import type { PoolClient } from 'pg'
import type { DialogueMessage } from './dialogue.ts'
import { pool } from './db.ts'
type DB=Pick<PoolClient,'query'>

export async function growthQuoteSuppressed(c:DB,user:string,messageId:string,quote:string) {
  return !!(await c.query('SELECT 1 FROM growth_source_suppressions WHERE user_id=$1 AND message_id=$2 AND (strpos($3,quote)>0 OR strpos(quote,$3)>0) LIMIT 1',[user,messageId,quote])).rowCount
}
// All experience readers use the same source projection. A later result keeps
// its own source; withdrawing it blanks only that field, never restores an
// older outcome or erases the independently sourced original episode.
export async function redactExperienceResultSources(c:DB,user:string,rows:any[]){
  if(!rows.length)return rows
  const revisions=(await c.query(`SELECT DISTINCT ON (r.experience_id) r.experience_id,r.snapshot,m.content AS source_content,
    EXISTS(SELECT 1 FROM memory_suppressions s WHERE s.user_id=r.user_id AND s.source_message_id=m.id) AS memory_suppressed,
    EXISTS(SELECT 1 FROM growth_source_suppressions s WHERE s.user_id=r.user_id AND s.message_id=m.id AND (strpos(r.snapshot->>'quote',s.quote)>0 OR strpos(s.quote,r.snapshot->>'quote')>0)) AS growth_suppressed,
    EXISTS(SELECT 1 FROM coach_source_withdrawals s WHERE s.user_id=r.user_id AND s.message_id=m.id) AS withdrawn
    FROM experience_revisions r LEFT JOIN messages m ON m.user_id=r.user_id AND m.id::text=r.snapshot->>'fromMessageId' AND m.role='user'
    WHERE r.user_id=$1 AND r.experience_id=ANY($2::uuid[]) AND r.action='correct'
      AND r.snapshot#>>'{correction,version}'='1' AND r.snapshot#>'{correction,changedFields}' ? 'result'
    ORDER BY r.experience_id,r.revision DESC`,[user,rows.map(row=>row.id)])).rows
  const byId=new Map(revisions.map(row=>[row.experience_id,row]))
  return rows.map(row=>{
    const revision=byId.get(row.id),source=revision?.snapshot?.fromMessageId,quote=revision?.snapshot?.quote
    if(!source||revision.snapshot.content?.result!==row.content?.result)return row
    const available=typeof quote==='string'&&quote.length>0&&revision.source_content?.includes(quote)&&!revision.memory_suppressed&&!revision.growth_suppressed&&!revision.withdrawn
    return available?{...row,result_source_message_id:source}:{...row,content:{...row.content,result:''}}
  })
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
