import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import {getMemoryView,setMemorySettings,applyMemoryAction} from '../../server/memory.ts'
import * as store from '../../server/store.ts'

test('saved historical interpretations remain user-confirmed, idempotent and invalidated by supporting experience revisions',async()=>{
  const user='historical-pattern-'+randomUUID(),signal=new AbortController().signal
  try{
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
    await setMemorySettings(user,{enabled:true,expectedRevision:0,requestId:randomUUID()})
    const records:{type:string;experienceId:string;revision:number;conversationId:string;messageId:string;quote:string}[]=[]
    for(const quote of ['我先完成课程接口，收到同学反馈后调整，最后按时交付。','我先做出演示页面，听完组员意见后修改，最后完成展示。']){
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'历史合成经历'})
      const run=(await store.startRun(user,conversation,randomUUID(),quote)).run,staged:store.Staged={candidates:[],audit:[]}
      await store.stageCandidate(run,staged,{sourceMessageId:run.source_message_id,quote,links:[]})
      await store.finishRun(run,staged,'请核对这段已发生的经历。',null,signal)
      const candidate=(await store.listExperiences(user,conversation))[0]
      const confirmed=await store.experienceAction(user,candidate.id,{requestId:randomUUID(),expectedRevision:candidate.revision,action:'confirm'})
      records.push({type:'experience',experienceId:confirmed.id,revision:confirmed.revision,conversationId:conversation,messageId:run.source_message_id,quote})
    }
    // SQL imports already-saved historical rows only in the runner's disposable DB.
    // No pattern generator or staging API is retained in production source.
    async function seed(refs=records){
      const id=randomUUID(),value={context:'少量课程任务',behavior:'先做出可用片段再根据反馈修改',outcome:'这两次都完成交付',limitations:['仅两段历史经历，不能推断人格']}
      await pool.query("INSERT INTO memory_items(id,user_id,kind,value,assertion,scope,source_refs,observed_at,status) VALUES($1,$2,'pattern_candidate',$3,'system_pattern_candidate','user',$4,now(),'pending')",[id,user,JSON.stringify(value),JSON.stringify(refs)])
      return id
    }
    for(const refs of [[records[0]], [records[0],records[0]], [records[0],{...records[1],experienceId:randomUUID()}], [records[0],{...records[1],messageId:randomUUID()}], [records[0],{...records[1],quote:'未发生的解释'}]]){
      const invalidId=await seed(refs),requestId=randomUUID()
      await assert.rejects(()=>applyMemoryAction(user,invalidId,{requestId,expectedRevision:1,action:'accept'}),(error:any)=>error.code==='PATTERN_SOURCES_CHANGED')
      assert.equal((await pool.query('SELECT status FROM memory_items WHERE user_id=$1 AND id=$2',[user,invalidId])).rows[0].status,'pending')
      assert.equal((await pool.query('SELECT 1 FROM user_operations WHERE user_id=$1 AND request_id=$2',[user,requestId])).rowCount,0)
    }
    const rejectedId=await seed(),reject={requestId:randomUUID(),expectedRevision:1,action:'reject' as const}
    const rejected=await applyMemoryAction(user,rejectedId,reject)
    assert.equal(rejected.status,'rejected')
    assert.deepEqual(JSON.parse(JSON.stringify(await applyMemoryAction(user,rejectedId,reject))),JSON.parse(JSON.stringify(rejected)))
    assert.equal((await pool.query('SELECT 1 FROM memory_suppressions WHERE user_id=$1',[user])).rowCount,2)
    const acceptedId=await seed()
    const before=(await getMemoryView(user)).items.find(item=>item.id===acceptedId)!
    assert.equal(before.status,'pending');assert.equal(before.sources.length,2)
    const accepted=await applyMemoryAction(user,acceptedId,{requestId:randomUUID(),expectedRevision:1,action:'accept'})
    assert.equal(accepted.status,'accepted')
    await store.experienceAction(user,records[0].experienceId,{requestId:randomUUID(),expectedRevision:records[0].revision,action:'correct',content:{summary:'我重新核对了这段经历，交付其实延迟了。'}})
    assert.equal((await getMemoryView(user)).items.find(item=>item.id===acceptedId)?.status,'revoked')
    const staleId=await seed()
    await assert.rejects(()=>applyMemoryAction(user,staleId,{requestId:randomUUID(),expectedRevision:1,action:'accept'}),(error:any)=>error.code==='PATTERN_SOURCES_CHANGED')
  }finally{await pool.query('DELETE FROM experiences WHERE user_id=$1',[user]);await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end()}
})
