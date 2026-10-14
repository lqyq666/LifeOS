import {randomUUID} from 'node:crypto'
import type {PoolClient} from 'pg'
import {transaction,HttpError,requireRow} from './db.ts'
import type {Run} from './store.ts'
import {readCoachEvent} from './action-coach-events.ts'
import type {KnowledgeCard} from './campus-knowledge.ts'
import {scanUserClauses,methodReferenceClause} from './user-command-spans.ts'
import {growthQuoteSuppressed} from './growth-privacy.ts'
import {assertCoachKnowledge} from './coach-knowledge.ts'
import {kbTerms} from './evergreen-guide.ts'
export type GuideUsageStatus='suggested'|'accepted'|'attempted'|'waiting_result'|'completed'|'declined'|'blocked'
export type GuideUsage={guideId:string;revision:number;branch:string;stepId:string;status:GuideUsageStatus;eventId:string;sourceMessageId:string|null;sourceQuote:string|null}
export function feedbackMatchesCurrent(text:string,title:string,task:string){
 if(/现在想|换个话题|另外一件|新的任务|新任务/.test(text))return false
 if(/^(?:还是不行|仍然不行|还是卡住了|还没结果)[。！？?]*$/.test(text.trim()))return true
 const matters=[/考试|期末|复习|备考|考研|考公/,/产品|创业|用户|客户|需求|接单|交付|改稿/,/导师|科研|论文/,/竞赛|比赛|队友|社团/,/岗位|求职|投递|面试/,/宿舍|舍友|人际/,/休息|过载|恢复/]
 const named=matters.filter(pattern=>pattern.test(text))
 if(named.length&&!named.some(pattern=>pattern.test(title+' '+task)))return false
 if(/(?:我|这次)[^，。；]{0,20}(?:不想继续|暂时不继续|先不继续|不再试|拒绝继续)|先停在这里/.test(text))return true
 if(/按上次|这个方法|这次行动|我愿意试|我不想继续|我不做了/.test(text))return true
 if(methodReferenceClause(text))return true
 const taskTerms=new Set(kbTerms(title+' '+task))
 return kbTerms(text).filter(t=>taskTerms.has(t)).length>=2
}
export function classifyGuideFeedback(text:string):Exclude<GuideUsageStatus,'suggested'>|null{
 const report=scanUserClauses(text).filter(c=>!c.interrogative&&!c.conditional&&!c.attributedToOther&&!c.quoted&&!c.code&&!c.quoteSpans.length&&!c.codeSpans.length).map(c=>c.text).join('；')
 if(/(?:我|这(?:个|次))[^；]{0,20}(?:不想继续|暂时不继续|先不继续|不做了|放弃这个|不再试|拒绝继续)/.test(report))return 'declined'
 const acted=/(?:我|按上次)[^；]{0,35}(?:已经|已)?(?:发了|交了|交付了|完成了|做完|尝试了?|试了|联系了|开始了)/.test(report)&&!/(?:我|按上次)[^；]{0,16}(?:没|没有|未)(?:开始|尝试|完成|交付|发)/.test(report)
 if(acted&&/等(?:待)?(?:结果|回复)|(?:还)?没(?:有)?(?:回复|收到结果)|没收到结果/.test(report))return 'waiting_result'
 if(/(?:我|按上次)[^；]{0,35}(?:没|没有|未)(?:开始|做|尝试)/.test(report)&&/打不开|找不到|缺少|卡住|没材料/.test(report))return 'blocked'
 if(/(?:我[^；]{0,24}(?:打不开|找不到|卡住)|(?:还是|仍然)(?:不行|卡住|打不开))/.test(report))return 'blocked'
 if(acted&&/没效果|没人回|没回复|卡住|失败|没用/.test(report))return 'blocked'
 if(acted&&/结果|收到|回复|付款|用上|通过/.test(report))return 'completed'
 if(acted)return 'attempted'
 if(/我[^；]{0,15}(?:愿意试|接受这个|同意这样做|可以试试)/.test(report))return 'accepted'
 return null
}
export async function readGuideUsage(user:string,conversation:string,eventId:string){
 return transaction(async c=>{
 requireRow((await c.query('SELECT id FROM conversations WHERE user_id=$1 AND id=$2',[user,conversation])).rows[0])
 await readCoachEvent(c,user,conversation,eventId)
 const rows=(await c.query(`SELECT u.*, (SELECT b->>'task' FROM campus_knowledge k CROSS JOIN LATERAL jsonb_array_elements(k.payload#>'{guide,branches}') b WHERE k.id=u.guide_id AND b->>'id'=u.branch) AS branch_task FROM kb_guide_usage u JOIN messages m ON m.user_id=u.user_id AND m.id=COALESCE(u.source_message_id,(SELECT source_message_id FROM runs r WHERE r.user_id=u.user_id AND r.request_id=u.request_id))
 WHERE u.user_id=$1 AND u.event_id=$2 AND (m.conversation_id=$3 OR (SELECT enabled FROM user_memory_settings WHERE user_id=$1))
 AND NOT EXISTS(SELECT 1 FROM memory_suppressions s WHERE s.user_id=m.user_id AND s.source_message_id=m.id)
 AND NOT EXISTS(SELECT 1 FROM coach_source_withdrawals w WHERE w.user_id=m.user_id AND w.message_id=m.id)
 AND coach_knowledge_refs_valid(jsonb_build_array(jsonb_build_object('sourceId',u.guide_id,'revision',u.revision)))
 ORDER BY u.created_at DESC,u.id DESC LIMIT 12`,[user,eventId,conversation])).rows
 const allowed=[]
 for(const row of rows)if(!row.source_quote||!await growthQuoteSuppressed(c,user,row.source_message_id,row.source_quote))allowed.push(row)
 return allowed
 })
}
export function suggestedGuideUsage(card:KnowledgeCard,eventId:string,branchId?:string):GuideUsage|null{
 const g=card.guide,branch=g?.branches.find(b=>b.id===branchId)??g?.branches[0]
 return g&&branch?{guideId:card.id,revision:card.revision,branch:branch.id,stepId:branch.steps[0].id,status:'suggested',eventId,sourceMessageId:null,sourceQuote:null}:null
}
export async function persistGuideUsage(c:PoolClient,run:Run,usage:GuideUsage[]){
 await assertCoachKnowledge(c,usage.map(u=>({sourceId:u.guideId,revision:u.revision})))
 for(const u of usage){
  await readCoachEvent(c,run.user_id,run.conversation_id,u.eventId)
  const knowledge=(await c.query("SELECT payload FROM campus_knowledge WHERE id=$1 AND revision=$2 AND status='verified' AND kb_knowledge_current(payload) FOR SHARE",[u.guideId,u.revision])).rows[0]?.payload as KnowledgeCard|undefined
  const branch=knowledge?.guide?.branches.find(b=>b.id===u.branch)
  if(!branch||!branch.steps.some(step=>step.id===u.stepId))throw new HttpError(409,'KB_USAGE_GUIDE_INVALIDATED')
  if(u.status!=='suggested'){
   const source=(await c.query("SELECT content FROM messages WHERE user_id=$1 AND id=$2 AND role='user'",[run.user_id,u.sourceMessageId])).rows[0]
   if(u.sourceMessageId!==run.source_message_id||!u.sourceQuote||!source?.content.includes(u.sourceQuote)||classifyGuideFeedback(u.sourceQuote)!==u.status||await growthQuoteSuppressed(c,run.user_id,u.sourceMessageId!,u.sourceQuote))throw new HttpError(400,'KB_USER_REPORT_REQUIRED')
  }
  await c.query('INSERT INTO kb_guide_usage(id,user_id,event_id,guide_id,revision,branch,step_id,status,source_message_id,source_quote,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(user_id,request_id,guide_id) DO NOTHING',[randomUUID(),run.user_id,u.eventId,u.guideId,u.revision,u.branch,u.stepId,u.status,u.sourceMessageId,u.sourceQuote,run.request_id])
 }
}
