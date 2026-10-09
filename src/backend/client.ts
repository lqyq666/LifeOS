import { emptyConversation, type Conversation } from '../features/conversation/flow.ts'
import { newChat, type Workspace } from '../features/conversation/workspace.ts'
export type SessionUser={id:string;name:string;email:string}
export class ApiError extends Error{code:string;status:number;retryAfter?:number;constructor(code:string,status:number,retryAfter?:number){super(code);this.code=code;this.status=status;this.retryAfter=Number.isFinite(retryAfter)?retryAfter:undefined}}
const notices:Record<string,string>={LOGIN_REQUIRED:'请先登录，正式对话将保存在你的账户中。',MODEL_CAPABILITY_TEST_REQUIRED:'模型能力测试尚未通过，请稍后重试。',MODEL_BUSY:'模型正在处理另一条请求，请稍后重试。',CONVERSATION_BUSY:'这段对话仍在处理，请先取消或等待完成。',RUN_IN_PROGRESS:'这条请求仍在处理，请稍后刷新。',CANCELLED:'已取消。已发送的文字已保留，本轮没有保存派生记忆、方案或经历。',MODEL_REQUEST_FAILED:'模型调用失败，本轮没有保存派生记忆、方案或经历。',MODEL_OUTPUT_TRUNCATED:'模型输出未完整结束，本轮没有保存派生记忆、方案或经历。',EXPERIENCE_REVISION_CONFLICT:'记录已发生变化，请刷新后再保存。',IDEMPOTENCY_KEY_REUSED:'重复请求的内容不一致，请重试。',MEMORY_LOAD_FAILED:'暂时无法安全读取已保存背景，本轮没有继续个性化规划。',MEMORY_DISABLED:'请先开启长期记忆，再整理当前对话。',MEMORY_REVISION_CONFLICT:'记忆已发生变化，请刷新后再操作。',PATTERN_SOURCES_CHANGED:'支持这段解释的经历已改变，请先重新核对，暂时不能认可旧解释。',MEMORY_SNAPSHOT_INVALIDATED:'记忆在处理期间发生变化，请重新发送本轮内容。',MEMORY_REVIEW_IN_PROGRESS:'这段对话正在整理，请等待当前请求完成。',MEMORY_CURSOR_INVALID:'整理进度已失效，请从当前对话重新开始。'}
Object.assign(notices,{MODEL_RATE_LIMITED:'模型平台暂时限流，本轮没有保存派生记忆、方案或经历。',MODEL_OVERLOADED:'模型平台当前拥塞，本轮没有保存派生记忆、方案或经历。',MODEL_TIMEOUT:'等待模型响应超时，本轮没有保存派生记忆、方案或经历。',MODEL_TOOL_ARGUMENT_REJECTED:'模型生成的方案未通过来源校验，本轮没有保存派生内容。',MODEL_CONFIGURATION_ERROR:'模型服务配置异常，请联系服务维护者。',USER_MESSAGE_LIMIT:'本账户暂时达到试运行请求上限。',SERVER_SHUTTING_DOWN:'服务正在重启，请稍后重试。',MODEL_TURN_LIMIT:'本轮处理达到上限，本轮没有保存派生记忆、方案或经历。',INCOMPLETE_STREAM:'连接中断，正在核对服务端保存状态。',DIALOGUE_ANALYSIS_INVALID:'本轮信息未能可靠校验，请调整说法后重试。',MODEL_DECISION_REQUIRED:'方案未通过完整性校验，本轮没有保存派生内容。',PLAN_FIELDS_REQUIRED:'方案内容不完整，本轮没有保存派生内容。',UPSTREAM_CALL_LIMIT:'本轮处理达到模型调用上限，没有保存派生内容。'})
Object.assign(notices,{CAMPUS_EXTERNAL_CASE_COMPARISON_INCOMPLETE:'可比案例的正向结果或收入边界还没有完整关联到建议；输入已保留，请重新核对外部资料与个人约束。'})
Object.assign(notices,{REQUEST_TOO_LARGE:'这段内容超过单次请求容量，全文已保留，请分段发送。',MODEL_QUEUE_FULL:'当前等待的人较多，本轮没有保存派生内容，请稍后重试。'})
Object.assign(notices,{PROVIDER_BUDGET_NOT_ENABLED:'服务暂未开放对话，请稍后再试。',PROVIDER_BUDGET_EXHAUSTED:'服务本期对话额度已用完，已保存内容仍可查看。',PROVIDER_PRICE_REQUIRED:'服务费用配置尚未核验，请稍后再试。',PROVIDER_PRICE_CHANGED:'服务费用出现变化，已暂停新对话；本轮没有保存。'})
Object.assign(notices,{ACCESS_NOT_ENABLED:'当前账户尚未开通对话资格，请联系邀请人。',ACCESS_EXPIRED:'账户的使用期限已结束，已保存内容仍可查看。',ACCESS_LIMIT_REACHED:'本次对话额度已用完或正在使用，已保存内容仍可查看。',ACCESS_CHANGED:'账户资格在处理期间发生变化，本轮没有保存或扣除对话额度。'})
Object.assign(notices,{COACH_KNOWLEDGE_INVALIDATED:'引用的资料在处理期间已更新或失效，本轮没有保存，请重新核验。',COACH_CITATION_INVALID:'这条回应的外部依据未能核验，本轮没有保存，请重试。',COACH_ACTION_REVIEW_REQUIRED:'这份材料的依据已改变，请先核验并修改后再使用。'})
export function explainError(error:unknown){return error instanceof ApiError?(notices[error.code]??'服务端未能保存本次操作，请重试。')+(error.retryAfter?` 请在 ${Math.ceil(error.retryAfter)} 秒后重试。`:''):'服务端暂时无法连接，输入仍保留在页面中。'}
Object.assign(notices,{GROWTH_REVISION_CONFLICT:'这项情况已在另一处更新，已刷新记录；请核对后再保存。',GROWTH_DEPENDENCY_INVALID:'相关个人依据已变化或不在当前记忆范围，请重新核对。',GROWTH_SNAPSHOT_INVALIDATED:'个人情况在回复期间发生变化，本轮未保存，请根据新情况继续。',GROWTH_TIME_REQUIRED:'请填写这项时间约束适用到哪一天。',GROWTH_TIME_INVALID:'适用时间未能读取，请重新选择。',GROWTH_FORGOTTEN:'这项已遗忘，不能恢复旧内容；你可以明确补充新的情况。',REQUEST_ID_REUSED:'同一操作请求的内容已变化，请重新操作。'})
async function responseError(response:Response){
  Object.assign(notices,{CAMPUS_REVISION_CONFLICT:'这条判断已更新。请重新打开梳理后再操作；输入仍保留。',CAMPUS_INQUIRY_CHANGED:'当前问题已切换，请刷新后重试。',CAMPUS_REVIEW_REQUIRED:'依据已改变，请继续讨论并核对新的判断。',CAMPUS_MEMORY_DISABLED:'长期记忆已关闭，请回到原对话处理这项行动。',CAMPUS_SOURCE_REVOKED:'所依据的内容已被忘记或撤回，这条历史操作已隐藏，无法继续修改。',CAMPUS_MEMORY_FORGOTTEN:'所依据的内容已被忘记，这条历史操作已隐藏。',CAMPUS_SOURCE_DELETED:'所依据的内容已删除，这条历史操作已隐藏。',ACCEPTED_EXPERIMENT_RESULT_REQUIRED:'请先接受行动，再填写已发生的结果。'})
  const data=await response.json().catch(()=>({}))
  const delay=Number(data.retryAfter??response.headers.get('Retry-After'))
  return new ApiError(data.error??data.code??'REQUEST_FAILED',response.status,delay>0?delay:undefined)
}
export async function api<T=any>(path:string,body?:unknown,method?:string):Promise<T>{
  const response=await fetch(path,{credentials:'same-origin',method:method??(body===undefined?'GET':'POST'),headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
  if(!response.ok)throw await responseError(response)
  return await response.json() as T
}
export function dataChanged(){window.dispatchEvent(new Event('lifeos-data-changed'))}
export function conversationFromRows(rows:any[]):Conversation{
  return {...emptyConversation(),stage:rows.length?'followup':'opening',messages:rows.map((m,i)=>({id:i,role:m.role,text:m.content,sourceId:m.id}))}
}
export async function loadWorkspace(user:SessionUser,current?:Workspace):Promise<Workspace>{
  const rows=await api<any[]>('/api/conversations')
  const cached=current?.chats??[]
  const chats=rows.map(row=>({id:row.id,title:row.title,renamed:row.renamed,pinned:row.pinned,projectId:row.project_id,updatedAt:new Date(row.updated_at).getTime(),draft:cached.find(c=>c.id===row.id)?.draft??'',conversation:conversationFromRows(row.messages)}))
  // Unsent drafts and explicitly marked demos remain account-scoped browser data.
  // Cached formal messages can never replace missing or newer database messages.
  for(const chat of cached)if(!chats.some(c=>c.id===chat.id)&&(chat.conversation.demo||chat.conversation.messages.length===0))chats.push(chat)
  if(!chats.length)chats.push(newChat())
  // Projects are existing UI grouping, scoped to this account's browser. Formal messages always come from the database.
  const validProjects=current?.projects??[]
  for(const chat of chats)if(chat.projectId&&!validProjects.some(p=>p.id===chat.projectId))chat.projectId=null
  void user
  return {version:1,projects:validProjects,chats,activeId:chats.some(c=>c.id===current?.activeId)?current!.activeId:chats[0].id}
}
export async function streamChat(conversationId:string,requestId:string,text:string,signal:AbortSignal,onEvent:(event:any)=>void,focusContext?:{type:'theme'|'experience';id:string;label:string}){
  const response=await fetch('/api/conversations/'+conversationId+'/messages',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,text,...(focusContext?{focusContext}:{})}),signal})
  if(!response.ok)throw await responseError(response)
  if(!response.body)throw new ApiError('MISSING_STREAM',502)
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',finished=false
  try{
    while(true){
      const chunk=await reader.read();if(chunk.done)break
      pending+=decoder.decode(chunk.value,{stream:true})
      let boundary:number
      while((boundary=pending.indexOf('\n\n'))>=0){
        const event=pending.slice(0,boundary);pending=pending.slice(boundary+2)
        const line=event.split('\n').find(l=>l.startsWith('data: '))
        if(!line)continue
        const value=JSON.parse(line.slice(6));onEvent(value)
        if(value.type==='done')finished=true
        if(value.type==='error')throw new ApiError(value.code,value.status??502,value.retryAfter)
      }
    }
    if(!finished)throw new ApiError('INCOMPLETE_STREAM',502)
  }finally{if(!finished)await reader.cancel().catch(()=>{});reader.releaseLock()}
}
export type Experience={id:string;revision:number;status:'candidate'|'confirmed';content:{summary:string;title:string;reflection?:string};source_quote:string;source_text:string;links:any[]}
export type MemorySource={type:'message'|'user_edit'|'experience';conversationTitle?:string;quote?:string;label?:string;experienceId?:string;revision?:number;observedAt?:string}
export type MemoryItem={id:string;kind:'fact'|'pattern_candidate';key:string|null;value:any;assertion:string;scope:string;taskType:string|null;observedAt:string;validUntil:string|null;revision:number;status:string;sources:MemorySource[];sourceValidity:'valid'|'changed'}
export type MemoryView={settings:{enabled:boolean;revision:number};items:MemoryItem[]}
export type ServerDecision={version:number;payload:{conditions:{text:string;quote?:string;sourceMessageId?:string;sourceMemoryId?:string;sourceRevision?:number}[];basis?:({type:'message';messageId:string;quote:string}|{type:'memory';memoryId:string;revision:number})[];unknowns:string[];recommendation:{title:string;text:string};actions:{title:string;steps:string[]}[];problem?:string;firstStep?:string;doneWhen?:string;adjustWhen?:string;assumptions?:string[];mode?:'plan'|'provisional'}}
