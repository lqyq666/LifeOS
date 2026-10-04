import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {loadSnapshot} from '../../server/memory.ts'
import {loadCampus,stageCampus,campusView,campusDecision} from '../../server/campus.ts'
import type {CampusTurn} from '../../server/campus-contracts.ts'

test('Campus updates preserve prior goals, discard unsupported values and keep the original audit before normalization',async()=>{
  const user='campus-repair-'+randomUUID(),chat=randomUUID()
  try{
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',[user,'SYNTHETIC repair',user+'@example.invalid'])
    await store.createConversation(user,{id:chat,title:'SYNTHETIC repair'})
    const text='我读大二，想就业，每周四小时。',run=(await store.startRun(user,chat,randomUUID(),text)).run
    const ref={type:'message' as const,id:run.source_message_id,quote:'想就业'}
    const turn:CampusTurn={domain:'university_exit',newInquiry:true,question:'制作求职作品',questionSource:{id:run.source_message_id,quote:text},criteria:[],readiness:'bounded',questions:[],studentContext:[{key:'taskGoal',value:'想就业',status:'known',source:ref,scope:'inquiry'}],pathways:[],opportunities:[],evidence:[],experiment:{kind:'explore',question:'作品是否可用',action:'试运行一张小表',cap:'建议半小时，可调整',observe:'可用结果',adjustWhen:'超时即缩小'}}
    const snapshot=await loadSnapshot(user,chat,text),staged:store.Staged={candidates:[],audit:[],snapshot}
    await stageCampus(run,staged,turn,await loadCampus(user,chat,text,snapshot))
    await store.finishRun(run,staged,'合成方案',null,new AbortController().signal)
    const follow='现在每周只有两小时。',next=(await store.startRun(user,chat,randomUUID(),follow)).run,nextSnapshot=await loadSnapshot(user,chat,follow)
    const proposed={...turn,newInquiry:false,questionSource:{id:next.source_message_id,quote:follow},studentContext:[{key:'taskGoal',value:'我读大二',status:'known' as const,source:{type:'message' as const,id:run.source_message_id,quote:'我读大二'},scope:'inquiry' as const},{key:'availableTime',value:'两小时',status:'known' as const,source:{type:'message' as const,id:next.source_message_id,quote:follow},scope:'inquiry' as const},{key:'institution',value:'虚构大学',status:'known' as const,source:{type:'message' as const,id:next.source_message_id,quote:follow},scope:'user' as const}]}
    const second:store.Staged={candidates:[],audit:[],snapshot:nextSnapshot}
    await stageCampus(next,second,proposed,await loadCampus(user,chat,follow,nextSnapshot))
    assert.deepEqual(second.campus?.turn.studentContext.map(x=>x.key),['availableTime'])
    assert.equal(proposed.studentContext.length,3,'caller input is not mutated by normalization')
    await store.finishRun(next,second,'合成调整',null,new AbortController().signal)
    const view=await campusView(user,chat),current=view.inquiries.find(x=>x.id===view.currentId)!
    assert.equal(current.payload.studentContext.find(x=>x.key==='taskGoal')?.value,'想就业')
    assert.equal(current.payload.studentContext.find(x=>x.key==='availableTime')?.value,'两小时')
    assert.equal(current.payload.studentContext.some(x=>x.value==='虚构大学'),false)
    assert.equal(current.payload.experiments[0].needsReview,true,'changed resource requires the old action to be reviewed')
    assert.equal(current.payload.experiments.at(-1)?.needsReview,undefined)
    const changedText='把同一动作缩小为十五分钟。',changedRun=(await store.startRun(user,chat,randomUUID(),changedText)).run
    const changedMemory=await loadSnapshot(user,chat,changedText),changedSnapshot=await loadCampus(user,chat,changedText,changedMemory)
    const changed:store.Staged={candidates:[],audit:[],snapshot:changedMemory}
    await stageCampus(changedRun,changed,{...turn,newInquiry:false,questionSource:{id:changedRun.source_message_id,quote:changedText},studentContext:[],change:'已增加从未出现的诊断',experiment:{...turn.experiment!,cap:'建议15分钟，可调整'}},changedSnapshot,changedText)
    assert.doesNotMatch(changed.campus!.turn.change??'',/从未出现的诊断/,'change is projected from effective action versions, not generated historical claims')
    assert.match(changed.campus!.turn.change??'',/十五分钟|15分钟/)
    changed.dialoguePath="plan"
    await store.stageDecision(changedRun,changed,campusDecision(changed.campus!))
    await store.finishRun(changedRun,changed,'同一动作缩小投入。',null,new AbortController().signal)
    const changedView=await campusView(user,chat),changedInquiry=changedView.inquiries.find(x=>x.id===changedView.currentId)!
    assert.equal(changedInquiry.payload.experiments.at(-1)?.cap,'建议15分钟，可调整','same action text with a different cap is a new effective version')
    const reuseText='沿用刚才的安排。',reuseRun=(await store.startRun(user,chat,randomUUID(),reuseText)).run
    const reuseMemory=await loadSnapshot(user,chat,reuseText),reuseSnapshot=await loadCampus(user,chat,reuseText,reuseMemory)
    const reused:store.Staged={candidates:[],audit:[],snapshot:reuseMemory}
    const reuseTurn={...turn,newInquiry:false,questionSource:{id:reuseRun.source_message_id,quote:reuseText},studentContext:[],experiment:undefined,reuseExperimentId:changedInquiry.payload.experiments.at(-1)!.id}
    await stageCampus(reuseRun,reused,reuseTurn,reuseSnapshot,reuseText)
    reused.dialoguePath="plan"
    await store.stageDecision(reuseRun,reused,campusDecision(reused.campus!))
    await store.finishRun(reuseRun,reused,'沿用明确指定的有效行动。',null,new AbortController().signal)
    const versions=await store.decisionVersions(user,chat)
    assert.equal(versions.at(-1)?.payload.firstStep,changedInquiry.payload.experiments.at(-1)?.action)
    assert.equal(versions.at(-1)?.payload.recommendation.text,'投入上限：'+changedInquiry.payload.experiments.at(-1)?.cap)
    const reusedView=await campusView(user,chat)
    assert.equal(reusedView.inquiries.find(x=>x.id===reusedView.currentId)?.payload.experiments.length,changedInquiry.payload.experiments.length,'explicit reuse does not create another experiment')
    const past='上月我参加创业工作坊，做完商业计划很兴奋，但兼职少了两班，生活费变紧。'
    const historical=(await store.startRun(user,chat,randomUUID(),past)).run
    const candidate:store.Staged={candidates:[],audit:[]}
    await store.stageCandidate(historical,candidate,{sourceMessageId:historical.source_message_id,quote:past,links:[]})
    assert.equal(candidate.candidates.length,1,'a completed business plan is a past event')
    await store.terminateRun(user,historical.request_id,'cancelled','SYNTHETIC_CLEANUP')
    for(const value of ['我接受这个行动，接受不代表已经完成。','我会Python。']){
      const attempt=(await store.startRun(user,chat,randomUUID(),value)).run
      await assert.rejects(()=>store.stageCandidate(attempt,{candidates:[],audit:[]},{sourceMessageId:attempt.source_message_id,quote:value,links:[]}))
      await store.terminateRun(user,attempt.request_id,'cancelled','SYNTHETIC_CLEANUP')
    }
  }finally{
    for(const table of ['experiences','decision_versions','runs'])await pool.query('DELETE FROM '+table+' WHERE user_id=$1',[user])
    await pool.query('DELETE FROM "user" WHERE id=$1',[user]);await pool.end()
  }
})
