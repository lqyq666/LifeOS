import test from 'node:test'
import assert from 'node:assert/strict'
import {safeEarlySentence} from '../server/reply-draft.ts'

test('incomplete multi-KB drafts have bounded JSON decoding work',()=>{
 const raw=JSON.stringify({reply:'这是一段尚未到句尾的文字'.repeat(300)}),parse=JSON.parse
 let decodes=0
 try{
  JSON.parse=(...args:Parameters<typeof JSON.parse>)=>{decodes++;return parse(...args)}
  assert.equal(safeEarlySentence(raw),null)
 }finally{JSON.parse=parse}
 assert.ok(decodes<=32,`unfinished sentence caused ${decodes} full-prefix decodes`)
})

test('streamed drafts retain completed-sentence, Unicode and source-sensitive boundaries',()=>{
 const content='先核对课程的先修要求。',prefix='好的。'
 const encode=(value:unknown)=>JSON.stringify(value).replace(/[^\x00-\x7f]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'))
 for(const wire of [JSON.stringify({reply:prefix+content}),encode({reply:prefix+content})]){
  for(let end=0;end<=wire.length;end++){
   const draft=safeEarlySentence(wire.slice(0,end))
   assert.ok(draft===null||draft===content.slice(0,-1),JSON.stringify({end,draft}))
  }
  assert.equal(safeEarlySentence(wire),content.slice(0,-1))
 }
 for(const prefix of ['已帮你保存。','https://example.invalid。','你就是这样的人。'])assert.equal(safeEarlySentence(JSON.stringify({reply:prefix+content})),null)
 assert.equal(safeEarlySentence(JSON.stringify({reply:'围绕最近一次实际选课经历，可以这样问：\n\n'})),null)
 assert.equal(safeEarlySentence(JSON.stringify({reply:'先核对课程的先修要求\n\n还需了解具体课程。'})),content.slice(0,-1))
 assert.equal(safeEarlySentence(JSON.stringify({reply:'尚未完成的句子'})),null)
})
