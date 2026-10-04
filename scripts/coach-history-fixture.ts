import {createHash,randomUUID} from 'node:crypto'
import {pool,transaction} from '../server/db.ts'
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')

// Explicit synthetic history, never provider turns or latency samples.
export async function seedCoachHistoryFixture(user:string,conversationId:string,count=45){
  const database=(await pool.query('SELECT current_database() AS name')).rows[0].name
  if(!/^lifeos_dialogue_(?:live|test)_[a-z0-9_]+$/.test(database))throw new Error('ISOLATED_HISTORY_DATABASE_REQUIRED')
  if(count!==45)throw new Error('FROZEN_A07_DISTRACTOR_COUNT_CHANGED')
  const messageIds:string[]=[],requestIds:string[]=[],assistantMessageIds:string[]=[]
  await transaction(async client=>{
    for(let i=0;i<count;i++){
      const id=randomUUID(),request=randomUUID(),assistant=randomUUID(),text='SYNTHETIC_NON_PROVIDER_DISTRACTOR '+(i+1)+'：今天随便聊了天气、午餐和图书馆座位，没有新的资料交付事件。'
      messageIds.push(id);requestIds.push(request);assistantMessageIds.push(assistant)
      await client.query("INSERT INTO messages(id,user_id,conversation_id,role,content,run_request_id,created_at) VALUES($1,$2,$3,'user',$4,$5,clock_timestamp())",[id,user,conversationId,text,request])
      await client.query("INSERT INTO runs(user_id,request_id,conversation_id,source_message_id,fingerprint,status,expected_version,response,started_at,finished_at) VALUES($1,$2,$3,$4,$5,'completed',0,$6,clock_timestamp(),clock_timestamp())",[user,request,conversationId,id,hash({conversation:conversationId,text}),{requestId:request,dialoguePath:'direct',upstreamCalls:0,syntheticHistory:true}])
      await client.query("INSERT INTO messages(id,user_id,conversation_id,role,content,run_request_id,created_at) VALUES($1,$2,$3,'assistant',$4,$5,clock_timestamp())",[assistant,user,conversationId,'这是合成历史回复，不是模型生成或新资料交付事件。',request])
    }
  })
  return {messageIds,assistantMessageIds,requestIds,count,paidCalls:0,evidence:'SYNTHETIC_NON_PROVIDER_COMPLETED_HISTORY_SETUP_NOT_REAL_MODEL_TURNS',quotaEffect:'Synthetic runs count toward unchanged default request limits; no quota or timestamps are bypassed.'}
}
