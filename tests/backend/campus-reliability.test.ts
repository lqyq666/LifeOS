import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {pool,HttpError} from '../../server/db.ts'
import {createConversation,startRun,finishRun,experienceAction,type Staged} from '../../server/store.ts'
import {applyMemoryAction,loadSnapshot,setMemorySettings} from '../../server/memory.ts'
import {loadCampus,campusContext,stageCampus,campusView,campusAction} from '../../server/campus.ts'
import type {CampusTurn} from '../../server/campus-contracts.ts'

test.after(async()=>{await pool.end()})

test('Campus keeps exact reported-action links, hypothesis dependencies, and redacts corrected results',async()=>{
  const user='campus-reliability-'+randomUUID()
  const conversations={origin:randomUUID(),second:randomUUID(),third:randomUUID(),report:randomUUID(),ambiguous:randomUUID(),time:randomUUID(),rejection:randomUUID()}
  try{
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',[user,'SYNTHETIC reliability',user+'@example.invalid'])
    for(const [name,id] of Object.entries(conversations))await createConversation(user,{id,title:'SYNTHETIC '+name})
    await setMemorySettings(user,{requestId:randomUUID(),enabled:true,expectedRevision:0})
    async function propose(conversation:string,text:string,options:{newInquiry?:boolean;question?:string;hypothesis?:string|false;experimentAction?:string;experimentCap?:string;hypothesisId?:string|null;studentContext?:CampusTurn['studentContext']}={}){
      const {run}=await startRun(user,conversation,randomUUID(),text)
      const snapshot=await loadSnapshot(user,conversation,text),campus=await loadCampus(user,conversation,text,snapshot)
      const source={type:'message' as const,id:run.source_message_id,quote:text}
      const turn:CampusTurn={
        domain:'life_goal',newInquiry:options.newInquiry??true,question:options.question??text,questionSource:{id:source.id,quote:source.quote},criteria:[],readiness:'act',questions:[],studentContext:(options.studentContext??[]).map(item=>({...item,source:item.source.type==='message'?{...item.source,id:source.id}:item.source})),pathways:[],opportunities:[],
        evidence:[{source,role:'background',match:'本人提出了当前问题',limitation:'不推断未陈述的信息'}],
        ...(options.hypothesis===false?{}:{hypothesis:{statement:options.hypothesis??'具体反馈可能帮助判断是否值得继续',conditions:'行动范围可承受',falsifier:'没有获得实际反馈',evidence:[{source,role:'background',match:'用于形成待核对判断',limitation:'尚未验证'}]}}),
        experiment:{kind:'explore',question:'是否获得实际反馈',action:options.experimentAction??'询问一位同学并记录反馈',cap:options.experimentCap??'建议半小时，零费用',observe:'对方是否使用及实际投入',adjustWhen:'没有反馈或影响休息则暂停',...(options.hypothesisId!==undefined?{hypothesisId:options.hypothesisId}:{})},
      }
      const boundary=campusContext(campus,text).feedbackBoundary
      if(boundary?.hypothesisContract&&boundary.observation&&turn.hypothesis)turn.hypothesis={...boundary.hypothesisContract,evidence:[{source:boundary.observation.source,role:'counterexample',match:'原行动的实际反馈',limitation:'原因仍未知'}]}
      const staged:Staged={candidates:[],audit:[],snapshot}
      await stageCampus(run,staged,turn,campus,text)
      await finishRun(run,staged,'SYNTHETIC Campus reliability fixture',null,new AbortController().signal)
      return {inquiryId:staged.campus!.targetInquiryId,turn}
    }
    async function currentInquiry(conversation:string){
      const view=await campusView(user,conversation)
      return view.inquiries.find(item=>item.id===view.currentId)!
    }
    async function accept(conversation:string,inquiryId:string,experimentId:string){
      const inquiry=await currentInquiry(conversation)
      return campusAction(user,conversation,inquiryId,{requestId:randomUUID(),expectedRevision:inquiry.revision,action:'experiment_accept',targetId:experimentId})
    }
    async function report(conversation:string,inquiryId:string,revision:number,experimentId:string,text:string){
      return campusAction(user,conversation,inquiryId,{requestId:randomUUID(),expectedRevision:revision,action:'experiment_result',targetId:experimentId,text})
    }

    const first=await propose(conversations.origin,'我想用一次短访谈判断是否继续投入。')
    let origin=await currentInquiry(conversations.origin)
    const h1=origin.payload.hypotheses[0]!,e1=origin.payload.experiments[0]!
    await propose(conversations.origin,'补充第二个判断，并明确新行动依赖原判断。',{newInquiry:false,hypothesis:'另一个独立判断需要单独核对',experimentAction:'询问第二位同学并记录结果',hypothesisId:h1.id})
    origin=await currentInquiry(conversations.origin)
    const h2=origin.payload.hypotheses.find(item=>item.statement==='另一个独立判断需要单独核对')!
    const e2=origin.payload.experiments.find(item=>item.action==='询问第二位同学并记录结果')!
    assert.equal(e2.hypothesisId,h1.id,'an explicit hypothesis ID wins over a newly proposed hypothesis')
    assert.notEqual(h2.id,h1.id)

    const accepted=await accept(conversations.origin,first.inquiryId,e1.id)
    const resultText='受访同学没有使用资料，我感觉投入过多。'
    const reported=await report(conversations.report,first.inquiryId,accepted.revision,e1.id,resultText)
    assert.equal(reported.payload.hypotheses.find((item:any)=>item.id===h1.id)?.status,'stale','the exact linked hypothesis is reconsidered after a result')
    assert.equal(reported.payload.hypotheses.find((item:any)=>item.id===h2.id)?.status,'pending','an unrelated hypothesis remains untouched')

    const afterReport=await currentInquiry(conversations.origin)
    const rejected=await campusAction(user,conversations.origin,first.inquiryId,{requestId:randomUUID(),expectedRevision:afterReport.revision,action:'hypothesis_reject',targetId:h1.id})
    assert.equal(rejected.payload.hypotheses.find((item:any)=>item.id===h1.id)?.status,'rejected','new result does not override an explicit rejection')
    assert.equal(rejected.payload.experiments.find((item:any)=>item.id===e2.id)?.needsReview,true,'rejecting a hypothesis flags only actions linked to it')
    assert.equal(rejected.payload.experiments.find((item:any)=>item.id===e1.id)?.status,'reported')

    const planningText='新的问题：我想探索完全不同的方向；请准确关联刚回填的行动结果。'
    const planningSnapshot=await loadCampus(user,conversations.report,planningText,await loadSnapshot(user,conversations.report,planningText))
    assert.equal(planningSnapshot.current,null)
    assert.deepEqual(planningSnapshot.continuedFrom,{inquiryId:first.inquiryId,experimentId:e1.id})
    assert.deepEqual(planningSnapshot.related.map(item=>item.id),[first.inquiryId],'explicitly switching inquiry exposes only the exact reported source')
    const context=campusContext(planningSnapshot,planningText)
    assert.equal(context.current,null)
    assert.deepEqual(context.continuedFrom?.inquiryId,first.inquiryId)
    assert.deepEqual(context.continuedFrom?.experiment.id,e1.id)
    assert.deepEqual(context.relatedAcceptedActions.flatMap((item:any)=>item.experiments).map((item:any)=>item.id),[e1.id])
    const uniqueView=await campusView(user,conversations.report)
    assert.equal(uniqueView.reportedInquiryId,first.inquiryId,'a single exact result is selected as the report to continue')

    const continuation=await propose(conversations.report,planningText,{newInquiry:true,question:'探索新的方向'})
    const continuedView=await campusView(user,conversations.report)
    const continued=continuedView.inquiries.find(item=>item.id===continuation.inquiryId)!
    assert.deepEqual(continued.payload.continuedFrom,{inquiryId:first.inquiryId,experimentId:e1.id})
    assert.equal(continuedView.inquiries.find(item=>item.id===first.inquiryId)?.payload.experiments.find(item=>item.id===e1.id)?.result?.text,resultText)

    const fallbackText='新的问题：根据刚回填的结果修正假设并提出下一步。'
    const fallbackRun=(await startRun(user,conversations.report,randomUUID(),fallbackText)).run
    const fallbackMemory=await loadSnapshot(user,conversations.report,fallbackText),fallbackSnapshot=await loadCampus(user,conversations.report,fallbackText,fallbackMemory)
    assert.deepEqual(fallbackSnapshot.continuedFrom,{inquiryId:first.inquiryId,experimentId:e1.id})
    const fallbackSource={type:'message' as const,id:fallbackRun.source_message_id,quote:fallbackText}
    const fallbackTurn:CampusTurn={domain:'life_goal',newInquiry:true,question:'根据实际反馈修正下一步',questionSource:{id:fallbackSource.id,quote:fallbackText},criteria:[],readiness:'act',questions:[],studentContext:[],pathways:[],opportunities:[],evidence:[{source:fallbackSource,role:'counterexample',match:'原行动结果已回填',limitation:'一个结果不能证明普遍原因'}],hypothesis:{statement:'本次未使用资料可能与事前需求确认不足有关',conditions:'原因仍需向原参与者核对',falsifier:'对方说明另有具体原因',evidence:[{source:fallbackSource,role:'counterexample',match:'依据用户回填结果形成待核对假设',limitation:'不把结果当作原因'}]}}
    const fallbackStaged:Staged={candidates:[],audit:[],snapshot:fallbackMemory}
    assert.equal(campusContext(fallbackSnapshot,fallbackText).feedbackBoundary?.originalHypothesisId,h1.id)
    await assert.rejects(()=>stageCampus(fallbackRun,fallbackStaged,fallbackTurn,fallbackSnapshot,fallbackText,true),error=>error instanceof HttpError&&error.code==='CAMPUS_FEEDBACK_INTERPRETATION_UNSUPPORTED','even a repair cannot add an unconfirmed causal interpretation')
    const feedbackBoundary=campusContext(fallbackSnapshot,fallbackText).feedbackBoundary!
    fallbackTurn.hypothesis={...feedbackBoundary.hypothesisContract!,evidence:[{source:feedbackBoundary.observation!.source,role:'counterexample',match:'原行动的实际反馈',limitation:'原因仍未知'}]}
    const psychologicalExperiment={kind:'execute' as const,question:'能否分离出对他人反馈的依赖？',action:'完成个人复习提纲并记录内心平静度',cap:'建议上限30分钟，可调整',observe:'观察内心平静度或掌控感',adjustWhen:'若平静则支持结构化偏好独立存在'}
    await assert.rejects(()=>stageCampus(fallbackRun,{candidates:[],audit:[],snapshot:fallbackMemory},{...fallbackTurn,experiment:psychologicalExperiment},fallbackSnapshot,fallbackText),error=>error instanceof HttpError&&error.code==='CAMPUS_FEEDBACK_INTERPRETATION_UNSUPPORTED','saved C21 causal expansion must also fail in experiment fields')
    const missingHypothesis={...fallbackTurn,hypothesis:undefined,experiment:{kind:'verify' as const,question:'原行动结果原因待核验',action:'用十五分钟核对原资料是否符合对方需要',cap:'建议上限15分钟，可调整',observe:'记录对方实际原因，未答仍未知',adjustWhen:'达到上限即暂停'}}
    await assert.rejects(()=>stageCampus(fallbackRun,{candidates:[],audit:[],snapshot:fallbackMemory},missingHypothesis,fallbackSnapshot,fallbackText),error=>error instanceof HttpError&&error.code==='CAMPUS_HYPOTHESIS_UPDATE_REQUIRED')
    await assert.rejects(()=>stageCampus(fallbackRun,fallbackStaged,fallbackTurn,fallbackSnapshot,fallbackText),error=>error instanceof HttpError&&error.code==='CAMPUS_EXPERIMENT_REQUIRED')
    await assert.rejects(()=>stageCampus(fallbackRun,fallbackStaged,fallbackTurn,fallbackSnapshot,fallbackText,true),error=>error instanceof HttpError&&error.code==='CAMPUS_EXPERIMENT_REQUIRED')
    await stageCampus(fallbackRun,fallbackStaged,{...fallbackTurn,experiment:missingHypothesis.experiment},fallbackSnapshot,fallbackText,true)
    assert.equal(fallbackStaged.campus?.turn.readiness,'bounded')
    assert.equal(fallbackStaged.campus?.turn.experiment?.kind,'verify')
    assert.ok(!fallbackStaged.audit.some((item:any)=>item.phase==='campus_continuation_experiment_fallback'),'repair must not invent a fallback action')
    await finishRun(fallbackRun,fallbackStaged,'已关联原结果并提出有限核验。',null,new AbortController().signal)
    const fallbackView=await campusView(user,conversations.report)
    const fallbackInquiry=fallbackView.inquiries.find(item=>item.id===fallbackStaged.campus!.targetInquiryId)!
    assert.deepEqual(fallbackInquiry.payload.continuedFrom,{inquiryId:first.inquiryId,experimentId:e1.id})
    assert.equal(fallbackInquiry.payload.experiments.at(-1)?.kind,'verify')

    const timeFirst=await propose(conversations.time,'我每周四小时，先完成一个小任务。',{studentContext:[{key:'availableTime',value:'每周四小时',status:'known',source:{type:'message',id:randomUUID(),quote:'我每周四小时'},scope:'inquiry'}],experimentCap:'两周总计不超过八小时，可调整'})
    let timeView=await currentInquiry(conversations.time),timeBefore=timeView.payload.experiments.at(-1)!
    assert.equal(timeView.payload.studentContext.find(item=>item.key==='availableTime')?.value,'每周四小时')
    const timeUpdate=await propose(conversations.time,'现在每周只有两小时，毕业课程优先，请缩小安排。',{newInquiry:false,studentContext:[{key:'availableTime',value:'每周两小时',status:'known',source:{type:'message',id:randomUUID(),quote:'现在每周只有两小时'},scope:'inquiry'}],experimentCap:'建议上限两小时，可调整'})
    timeView=await currentInquiry(conversations.time)
    assert.equal(timeView.payload.studentContext.find(item=>item.key==='availableTime')?.value,'每周两小时','a fully quoted normalized correction replaces the prior value')
    assert.equal(timeView.payload.experiments.find(item=>item.id===timeBefore.id)?.needsReview,true,'a changed time budget flags the old unreported action for review')
    assert.equal(timeUpdate.inquiryId,timeFirst.inquiryId)
    const partialText='时间调整：周三没空，周六只有一小时。'
    const partialRun=(await startRun(user,conversations.time,randomUUID(),partialText)).run
    const partialMemory=await loadSnapshot(user,conversations.time,partialText),partialSnapshot=await loadCampus(user,conversations.time,partialText,partialMemory)
    const partialSource={type:'message' as const,id:partialRun.source_message_id,quote:partialText}
    const partialTurn:CampusTurn={domain:'life_goal',newInquiry:false,question:'调整每周可用时间',questionSource:{id:partialSource.id,quote:partialText},criteria:[],readiness:'bounded',questions:[],studentContext:[{key:'availableTime',value:'周三没空，周六只有一小时',status:'known',source:{type:'message',id:partialSource.id,quote:'周三没空'},scope:'inquiry'}],pathways:[],opportunities:[],evidence:[{source:partialSource,role:'background',match:'用户更新了时间安排',limitation:'须完整引用时间信息'}],experiment:{kind:'verify',question:'可用时段是否满足',action:'核对一项短体验的实际时长',cap:'建议半小时，可调整',observe:'确认的时间段',adjustWhen:'超过可用时间即停止'}}
    await assert.rejects(()=>stageCampus(partialRun,{candidates:[],audit:[],snapshot:partialMemory},partialTurn,partialSnapshot,partialText),error=>error instanceof HttpError&&error.code==='CAMPUS_TIME_SOURCE_INCOMPLETE')

    const rejectedStart=await propose(conversations.rejection,'我想检验一个短行动是否值得继续。')
    const rejectionInitial=await currentInquiry(conversations.rejection),rejectedHypothesis=rejectionInitial.payload.hypotheses[0]!,rejectedExperiment=rejectionInitial.payload.experiments[0]!
    const rejectText=`我拒绝“${rejectedHypothesis.statement}”这个假设，请尊重拒绝并重新判断。`
    await propose(conversations.rejection,rejectText,{newInquiry:false,hypothesis:rejectedHypothesis.statement})
    const rejectionView=await currentInquiry(conversations.rejection)
    assert.equal(rejectionView.payload.hypotheses.find(item=>item.id===rejectedHypothesis.id)?.status,'rejected','a clearly targeted natural-language rejection updates the exact hypothesis')
    assert.equal(rejectionView.payload.experiments.find(item=>item.id===rejectedExperiment.id)?.needsReview,true,'an unreported action depending on the rejected hypothesis needs review')
    assert.equal(rejectedStart.inquiryId,rejectionView.id)

    const second=await propose(conversations.second,'我想检验是否愿意做一次小体验。')
    const secondInquiry=await currentInquiry(conversations.second),secondExperiment=secondInquiry.payload.experiments[0]!
    const third=await propose(conversations.third,'我想判断是否值得参加一次活动。')
    const thirdInquiry=await currentInquiry(conversations.third),thirdExperiment=thirdInquiry.payload.experiments[0]!
    const secondAccepted=await accept(conversations.second,second.inquiryId,secondExperiment.id)
    const thirdAccepted=await accept(conversations.third,third.inquiryId,thirdExperiment.id)
    await report(conversations.ambiguous,second.inquiryId,secondAccepted.revision,secondExperiment.id,'第二个行动有结果。')
    await report(conversations.ambiguous,third.inquiryId,thirdAccepted.revision,thirdExperiment.id,'第三个行动也有结果。')
    const ambiguousView=await campusView(user,conversations.ambiguous)
    assert.equal(ambiguousView.reportedInquiryId,null,'multiple reports do not select an arbitrary inquiry')
    const ambiguousText='新的问题：请提出新的探索计划。'
    const ambiguousSnapshot=await loadCampus(user,conversations.ambiguous,ambiguousText,await loadSnapshot(user,conversations.ambiguous,ambiguousText))
    assert.equal(ambiguousSnapshot.continuedFrom,undefined,'multiple exact report links stay unassigned')
    assert.equal(campusContext(ambiguousSnapshot,ambiguousText).continuedFrom,null)
    assert.deepEqual(campusContext(ambiguousSnapshot,ambiguousText).relatedAcceptedActions,[])
    assert.ok(secondInquiry.id&&thirdInquiry.id)

    const candidateId=reported.payload.experiments.find((item:any)=>item.id===e1.id)?.result?.candidateId
    const candidate=(await pool.query('SELECT revision FROM experiences WHERE user_id=$1 AND id=$2',[user,candidateId])).rows[0]
    await experienceAction(user,candidateId,{requestId:randomUUID(),expectedRevision:candidate.revision,action:'correct',content:{summary:'更正：实际没有访谈。'}})
    const redactedView=await campusView(user,conversations.report)
    const redacted=redactedView.inquiries.find(item=>item.id===first.inquiryId)!
    const redactedResult=redacted.payload.experiments.find(item=>item.id===e1.id)!.result!
    assert.equal(redactedResult.invalidated,true)
    assert.equal(redactedResult.invalidationReason,'corrected')
    assert.equal(redactedResult.text,'')
    assert.equal(redactedResult.source.quote,'[已隐藏]')
    assert.equal(JSON.stringify(redacted.payload).includes(resultText),false,'corrected report text and derived change copy are removed from the view')

    const forgottenQuestion=second.turn.questionSource.quote,forgottenMessageId=second.turn.questionSource.id,memoryId=randomUUID()
    const memorySource=[{type:'message',conversationId:conversations.second,messageId:forgottenMessageId,quote:forgottenQuestion}]
    await pool.query("INSERT INTO memory_items(id,user_id,kind,key,value,assertion,scope,source_refs,observed_at,revision,status) VALUES($1,$2,'fact','currentConcern',$3::jsonb,'user_reported','user',$4::jsonb,now(),1,'active')",[memoryId,user,JSON.stringify(forgottenQuestion),JSON.stringify(memorySource)])
    await pool.query("INSERT INTO memory_revisions(user_id,memory_item_id,revision,action,snapshot) VALUES($1,$2,1,'create',$3::jsonb)",[user,memoryId,JSON.stringify({key:'currentConcern',value:forgottenQuestion,sourceRefs:memorySource})])
    await applyMemoryAction(user,memoryId,{requestId:randomUUID(),expectedRevision:1,action:'forget'})
    const forgottenView=await campusView(user,conversations.second)
    const forgotten=forgottenView.inquiries.find(item=>item.id===second.inquiryId)!
    const serializedForgotten=JSON.stringify(forgotten)
    assert.equal(forgotten.redactedForRevocation,true,'forgetting a cited memory source marks the complete historical view for redaction')
    assert.equal(forgotten.payload.question,'这条历史记录的依据已被忘记或撤回，内容已隐藏。')
    assert.deepEqual(forgotten.sources,[])
    assert.equal(forgotten.payload.hypotheses.length,0)
    assert.equal(forgotten.payload.experiments.length,0)
    assert.equal(serializedForgotten.includes(forgottenQuestion),false,'forgotten question text cannot leak through the Campus history response')
    assert.equal(serializedForgotten.includes(second.turn.hypothesis!.statement),false,'forgotten-source-derived hypotheses are hidden from history')
    assert.equal(serializedForgotten.includes(second.turn.experiment!.action),false,'forgotten-source-derived actions are hidden from history')
  }finally{
    for(const table of ['experiences','decision_versions','runs'])await pool.query('DELETE FROM '+table+' WHERE user_id=$1',[user])
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
  }
})
