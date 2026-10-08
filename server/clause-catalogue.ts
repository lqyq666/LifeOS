// P1 (D-gate replay): the server owns every quote the model can anchor a
// personal fact to. The current user message is split into stable, numbered
// clause handles rendered into the prompt; the model only ever SELECTS a
// clauseId and the server resolves the exact verbatim span and messageId.
// A fabricated, drifted or cross-message quote is unrepresentable.

import { scanUserClauses } from './user-command-spans.ts'

export type ClauseHandle={
  clauseId:string
  text:string
  start:number;end:number
  // Structural flags reused by the anchor guards: a question, a hypothesis, a
  // quoted span or code is never a personal-fact anchor.
  interrogative:boolean
  conditional:boolean
  quoted:boolean
  code:boolean
  attributedToOther:boolean
  sentenceStart:number;sentenceEnd:number
}

const carriesClauseText=(text:string)=>/[\p{L}\p{N}]/u.test(text)

export function buildClauseCatalogue(text:string):ClauseHandle[]{
  const handles:ClauseHandle[]=[]
  for(const clause of scanUserClauses(text)){
    if(!carriesClauseText(clause.text))continue
    handles.push({
      clauseId:'c'+handles.length,
      text:clause.text,
      start:clause.start,end:clause.end,
      interrogative:clause.interrogative,
      conditional:clause.conditional,
      quoted:clause.quoted,
      code:clause.code,
      attributedToOther:clause.attributedToOther,
      sentenceStart:clause.sentenceStart,sentenceEnd:clause.sentenceEnd,
    })
  }
  return handles
}

export function resolveClause(catalogue:readonly ClauseHandle[],clauseId:unknown):ClauseHandle|null{
  return typeof clauseId==='string'?catalogue.find(handle=>handle.clauseId===clauseId)??null:null
}

// An experience candidate may span several clauses; the accepted quote is the
// exact server-owned text from the first to the last selected clause and the
// selection must be contiguous in the message.
export function resolveContiguousClauseRange(sourceText:string,catalogue:readonly ClauseHandle[],clauseIds:readonly string[]):{quote:string;start:number;end:number}|null{
  if(!clauseIds.length||clauseIds.length>8)return null
  const resolved=clauseIds.map(id=>resolveClause(catalogue,id))
  if(resolved.some(handle=>!handle))return null
  const indexes=resolved.map(handle=>catalogue.indexOf(handle!))
  for(let index=1;index<indexes.length;index++)if(indexes[index]!==indexes[index-1]!+1)return null
  const first=resolved[0]!,last=resolved[resolved.length-1]!
  if(first.start>last.end)return null
  return {quote:sourceText.slice(first.start,last.end),start:first.start,end:last.end}
}
