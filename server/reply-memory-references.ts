import {pool,HttpError} from './db.ts'
import {getMemoryView} from './memory.ts'
import {growthContext} from './growth.ts'

export type ReplyMemoryReference={kind:'memory'|'experience'|'growth';id:string;revision:number}
// These are records supplied to this exact model request, not a claim that the
// model explicitly quoted every record. Never reconstruct old receipts.
export function collectReplyMemoryReferences(serialized:string):ReplyMemoryReference[]{
 const envelope=JSON.parse(serialized),p=envelope.authorizedContext??envelope
 const refs:ReplyMemoryReference[]=[]
 for(const [kind,rows] of [['memory',p.knownProfile],['experience',p.confirmedExperiences],['growth',[...p.growth??[],...p.growthBackground??[]]]] as const){
  for(const row of Array.isArray(rows)?rows:[])if(typeof row?.id==='string'&&Number.isSafeInteger(row.revision)&&row.revision>0)refs.push({kind,id:row.id,revision:row.revision})
 }
 return [...new Map(refs.map(ref=>[ref.kind+':'+ref.id,ref])).values()]
}
export async function readReplyMemoryReferences(user:string,messageId:string){
 const row=(await pool.query(`SELECT m.conversation_id,r.response FROM messages m JOIN runs r ON r.user_id=m.user_id AND r.request_id=m.run_request_id WHERE m.user_id=$1 AND m.id=$2 AND m.role='assistant' AND r.status='completed' AND NOT EXISTS(SELECT 1 FROM deleted_conversations d WHERE d.user_id=m.user_id AND d.conversation_id=m.conversation_id)`,[user,messageId])).rows[0]
 if(!row)throw new HttpError(404,'NOT_FOUND')
 const refs=row.response?.memoryReferences as ReplyMemoryReference[]|undefined
 if(!Array.isArray(refs))return {recorded:false,items:[],unavailableCount:0,notice:'这条历史回复没有逐轮记忆依据记录，不补造引用。'}
 const view=await getMemoryView(user,row.conversation_id)
 if(!view.settings.enabled)return {recorded:true,items:[],unavailableCount:refs.length,notice:'长期记忆已关闭，不展示历史个人依据。'}
 const [{listExperiences},growth]=await Promise.all([import('./store.ts'),growthContext(user,row.conversation_id)])
 const experiences=await listExperiences(user)
 const items: {kind:ReplyMemoryReference['kind'];id:string;text:string;source:string}[]=[]
 for(const ref of refs){
  if(ref.kind==='memory'){
   const item=view.items.find(item=>item.id===ref.id&&item.revision===ref.revision&&item.status==='active'&&item.sourceValidity==='valid')
   if(item)items.push({kind:ref.kind,id:ref.id,text:typeof item.value==='string'?item.value:JSON.stringify(item.value),source:item.sources.map(source=>source.conversationTitle??'本人保存的资料').join('、')})
  }else if(ref.kind==='experience'){
   const item=experiences.find(item=>item.id===ref.id&&item.revision===ref.revision&&item.status==='confirmed')
   if(item)items.push({kind:ref.kind,id:ref.id,text:item.content?.summary??item.source_quote,source:item.content?.title??'已确认经历'})
  }else if(ref.kind==='growth'){
   const item=growth.find(item=>item.id===ref.id&&item.revision===ref.revision)
   if(item)items.push({kind:ref.kind,id:ref.id,text:item.text,source:'本人仍有效的个人记录'})
  }
 }
 return {recorded:true,items,unavailableCount:refs.length-items.length,notice:'这些是本轮实际提供给模型的记忆依据，不代表正文逐条引用了每一项。已更正、遗忘或失效的内容不再展示。'}
}
