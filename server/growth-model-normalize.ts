import {reportedActionProgress} from './workflows/action-review.ts'

export function reportedFeedbackProgress(quote:string):'completed'|'unattempted'|'attempted'|'stuck'|'unknown'|undefined{
 const report=reportedActionProgress(quote)
 if(report.state==='unattempted'||report.state==='attempted'||report.state==='completed')return report.state
 if(report.state==='partial')return 'attempted'
 if(report.state==='blocked')return 'stuck'
 return report.state||report.choice?'unknown':undefined
}

// The provider sometimes labels a correction as feedback without a
// progressState. The growth store deliberately rejects that ambiguous shape.
// Normalize only the model's delta before strict staging: a reported progress
// word gets an explicit unknown/unattempted state; a correction with no
// progress word is a context update, not a feedback claim.
export function normalizeModelFeedbackDelta<T extends {kind:string;source:{quote:string};progressState?:string}>(delta:T):T{
  if(delta.kind!=='feedback'){
    if(delta.progressState===undefined)return delta
    const {progressState,...rest}=delta as T&{progressState?:string}
    return rest as T
  }
  const valid=new Set(['completed','unattempted','attempted','stuck','unknown'])
  if(delta.progressState&&valid.has(delta.progressState))return delta
  const quote=delta.source?.quote??''
  const reported=reportedFeedbackProgress(quote)
  if(reported)return {...delta,progressState:reported}
  const attempted=/(?:已经|已|开始|试过|尝试了|做了|发了|交了)/.test(quote)
  const unfinished=/(?:还没|尚未|没有|未)(?:完成|做完)/.test(quote)
  // "已经开始/试过但尚未完成" is attempted with unknown completion, not
  // unattempted. Only a true not-started statement may become unattempted.
  if(attempted&&unfinished)return {...delta,progressState:'attempted'}
  if(/(?:还没|从未|没有|尚未|未)(?:开始|动手|问)/.test(quote))return {...delta,progressState:'unattempted'}
  if(attempted)return {...delta,progressState:'unknown'}
  const {progressState,...rest}=delta as T&{progressState?:string}
  return {...rest,kind:'context'} as T
}
