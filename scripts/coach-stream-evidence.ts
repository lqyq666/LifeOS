// Measurements begin at HTTP submission, never at the first raw provider delta.
export async function collectCoachStream(response:Response,started:number,now=()=>performance.now()){
  if(!response.ok)throw new Error('HTTP_'+response.status+':'+await response.text())
  if(!response.body)throw new Error('MISSING_STREAM')
  const events:{atMs:number;value:any}[]=[],reader=response.body.getReader(),decoder=new TextDecoder()
  let pending='',draft:number|null=null,committedFirst:number|null=null,done:any=null,completed:number|null=null
  try{
    while(true){
      const chunk=await reader.read();if(chunk.done)break
      pending+=decoder.decode(chunk.value,{stream:true})
      let boundary:number
      while((boundary=pending.indexOf('\n\n'))>=0){
        const lines=pending.slice(0,boundary);pending=pending.slice(boundary+2)
        const line=lines.split('\n').find(value=>value.startsWith('data: '));if(!line)continue
        const value=JSON.parse(line.slice(6)),atMs=now()-started;events.push({atMs,value})
        if(value.type==='draft'&&typeof value.text==='string'&&value.text.trim())draft??=atMs
    // Loading hints, restatements and internal JSON are not valid first
    // content; a discarded safe draft resets it and never counts as success.
    if(value.type==='draft_discarded')draft=null
        if(value.type==='draft_discarded')draft=null
        if(value.type==='delta'&&value.saved===true&&typeof value.text==='string'&&value.text.trim())committedFirst??=atMs
        if(value.type==='error')throw new Error(value.code??'STREAM_ERROR')
        if(value.type==='done'){if(done)throw new Error('DUPLICATE_DONE');done=value;completed=atMs}
      }
    }
    if(!done||completed===null)throw new Error('INCOMPLETE_STREAM')
    return {events,done,meaningfulFirstMs:draft??committedFirst??completed,completionMs:completed,firstKind:draft===null?'committed_reply':'unsaved_safe_question_draft',firstSafeDraftMs:draft,firstCommittedContentMs:committedFirst}
  }catch(error){if(error instanceof Error)Object.assign(error,{streamEvidence:{events,done,completionMs:completed}});throw error}
  finally{if(!done)await reader.cancel().catch(()=>{});reader.releaseLock()}
}

export function coachSpeedSummary(turns:{sampleClass:string;status:string;providerCallCount:number;meaningfulFirstMs?:number;completionMs?:number}[]){
  const selected=turns.filter(turn=>turn.sampleClass==='ordinary_followup'),valid=selected.filter(turn=>turn.status==='SAVED'&&turn.providerCallCount>0&&typeof turn.meaningfulFirstMs==='number'&&typeof turn.completionMs==='number')
  const quantile=(values:number[],p:number)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(p*values.length)-1]!:null
  const first=valid.map(turn=>turn.meaningfulFirstMs!),completion=valid.map(turn=>turn.completionMs!)
  const p50=quantile(first,.5),p95=quantile(first,.95),complete95=quantile(completion,.95)
  // N4.4 groups: real-model successes, real-model failures, deterministic
  // zero-model successes (not failures, never in model quantiles), missing
  // measurements, and indeterminate call states. HTTP failures without a call
  // count stay visible instead of being dropped for a missing field.
  const zeroModel=selected.filter(turn=>turn.status==='SAVED'&&turn.providerCallCount===0)
  const httpFailed=selected.filter(turn=>turn.status!=='SAVED')
  const modelSuccess=valid
  const missingMeasurement=selected.filter(turn=>turn.status==='SAVED'&&turn.providerCallCount>0&&(typeof turn.meaningfulFirstMs!=='number'||typeof turn.completionMs!=='number'))
  const indeterminate=selected.filter(turn=>turn.status==='SAVED'&&turn.providerCallCount<0)
  const failedOrdinary=httpFailed.length+missingMeasurement.length
  return {evidence:'ACTUAL_HTTP_SSE_TIMINGS_ONLY',predeclaredOrdinary:selected.length,groups:{realModelSuccess:modelSuccess.length,realModelFailure:httpFailed.length,deterministicZeroModel:zeroModel.length,missingMeasurement:missingMeasurement.length,indeterminateCallState:indeterminate.length},savedOrdinary:valid.length,failedOrdinary,sampleFailureRate:selected.length?Number((failedOrdinary/selected.length).toFixed(4)):null,deterministicZeroModelTurns:zeroModel.length,p50MeaningfulFirstMs:p50,p95MeaningfulFirstMs:p95,p95CompletionMs:complete95,status:valid.length>=20&&selected.length===valid.length&&p50!==null&&p50<=3000&&p95!==null&&p95<=5000&&complete95!==null&&complete95<=15000?'PASS':'NOT_READY'}
}
