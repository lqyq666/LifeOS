import {parseStreamingJson} from '@mariozechner/pi-ai'
import {duplicateTurnFrameKey,groundedReplyText,type GroundedReplyFrame} from './action-coach-contracts.ts'

// Wire optimization only. The engine still validates the complete preview;
// replacements are explicit and the final saved delta always carries full text.
export function replyDraftFrame(text:string,previous:string,incremental:boolean){
 const append=incremental&&previous.length>0&&text.startsWith(previous)
 return {type:'draft',text:append?text.slice(previous.length):text,saved:false,...(append?{append:true}:{})}
}

// Display-only draft; never expose the JSON envelope or write metadata.
export function streamingReplyText(raw:string,ordinaryAnswerSourceIds?:readonly string[]):string|null{
 try{
  const frame=parseStreamingJson<GroundedReplyFrame>(raw)
  let reply=frame?.reply
  if(ordinaryAnswerSourceIds){
   if(duplicateTurnFrameKey(raw,'reply'))return null
   reply=groundedReplyText(frame,ordinaryAnswerSourceIds,true)
  }
  return typeof reply==='string'&&reply.trim()?reply:null
 }catch{return null}
}
