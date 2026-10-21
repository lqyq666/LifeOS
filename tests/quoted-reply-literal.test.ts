import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseActionCoachTurn,completeCoachJsonFrame} from '../server/action-coach-contracts.ts'
const saved=JSON.parse(readFileSync(new URL('./fixtures/nz-quoted-reply-failure.json',import.meta.url),'utf8'))

test('actual NZ balanced literal quotes in a complete reply-only body preserve every displayed character',()=>{
 const raw=saved.turns[3].raw,notices:string[]=[]
 assert.throws(()=>JSON.parse(raw),'the original transport is invalid JSON and retained as failure evidence')
 const value=parseActionCoachTurn(raw,{onNormalization:kind=>notices.push(kind)})
 assert.equal(value.reply,raw.slice('{"reply":"'.length,-2))
 assert.deepEqual(Object.keys(value),['reply'])
 assert.deepEqual(notices,['quoted_reply_literal'])
 assert.equal(completeCoachJsonFrame(raw),null,'stream framing remains strict; this is not partial JSON acceptance')
 const canonical=JSON.stringify(value);assert.deepEqual(parseActionCoachTurn(canonical),value)
})

test('quote normalization never reconstructs partial objects, extra fields, operations or broken escapes',()=>{
 const bad=['{"reply":"未完的"引号。"}','{"reply":"缺少尾部"','{"reply":"正文"等待结果"。","growthUpdates":[]}','{"reply":"正文"等待结果"。","event":{"target":{"operation":"create"}}}','{"reply":"一段","reply":"另段"broken"。"}','{"reply":"正文"{}"。"}','{"reply":"正文"保存:成功"。"}','{"reply":"正文"   "。"}','{"reply":"正文"等待结果"。\\q"}']
 for(const raw of bad)assert.throws(()=>parseActionCoachTurn(raw),raw)
 assert.throws(()=>parseActionCoachTurn('{"reply":"正文, "等待结果""}'),'ASCII structural punctuation is outside this narrow normalization')
 for(const code of [0,8,9,10,13,31])assert.throws(()=>parseActionCoachTurn('{"reply":"甲'+String.fromCharCode(code)+'"等待结果""}'),'raw JSON control '+code)
 const valid={reply:'原样保留“中文引号”、"转义引号"与路径。'}
 assert.deepEqual(parseActionCoachTurn(JSON.stringify(valid)),valid)
})

test('explicit final frame never merges an intermediate draft or chooses an ambiguous trailing object',()=>{
 const draft=JSON.stringify({reply:'内部草稿',event:{untrusted:true}}),final=JSON.stringify({reply:'最终回复'})
 const notices:string[]=[]
 assert.deepEqual(parseActionCoachTurn(draft+'\n</thinking>\n'+final,{onNormalization:n=>notices.push(n)}),{reply:'最终回复'})
 assert.deepEqual(notices,['explicit_final_json_frame'])
 assert.deepEqual(parseActionCoachTurn(JSON.stringify({reply:'字面值 </thinking> 不改变来源。'})),{reply:'字面值 </thinking> 不改变来源。'})
 for(const raw of [draft+'\n'+final,draft+'\n</thinking>\n'+final+'\n'+final,draft+'\n</thinking>\n'+final.slice(0,-1),'任意前言\n</thinking>\n'+final,draft+'\n</thinking>\n[]',draft+'\n</thinking>\n'+JSON.stringify({reply:'坏状态',event:{untrusted:true}})])assert.throws(()=>parseActionCoachTurn(raw))
})

test('captured interrupted final frame remains rejected instead of committing its complete draft',()=>{
 const raw=readFileSync(new URL('./fixtures/coach-truncated-final-frame.txt',import.meta.url),'utf8')
 assert.ok(completeCoachJsonFrame(raw),'the old host had seen a complete prefix')
 assert.throws(()=>parseActionCoachTurn(raw),'the interrupted final object cannot be reconstructed or replaced by the prefix')
})

test('captured render-only tail cannot add authority or replace canonical business text',()=>{
 const raw=readFileSync(new URL('./fixtures/coach-render-metadata-response.txt',import.meta.url),'utf8'),frame=completeCoachJsonFrame(raw)!
 const notices:string[]=[]
 assert.deepEqual(parseActionCoachTurn(raw,{onNormalization:n=>notices.push(n)}),JSON.parse(frame))
 assert.deepEqual(notices,['verified_render_metadata_ignored'])
 for(const tail of [{lead:'不同内容',body:'另一个答案'},{lead:'',body:JSON.parse(frame).reply,event:{target:{operation:'create'}}},{lead:'',body:JSON.parse(frame).reply,growthUpdates:[]}])assert.throws(()=>parseActionCoachTurn(frame+'\n<|render|>'+JSON.stringify(tail)))
 for(const separator of ['\n','\n\n'])assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:'首句'+separator+'正文'})+'\n<|render|>'+JSON.stringify({lead:'首句',body:'正文'})))
 assert.throws(()=>parseActionCoachTurn(raw.slice(0,-1)))
 assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:JSON.parse(frame).reply,event:{untrusted:true}})+raw.slice(frame.length)))
})

test('captured unauthorized source and conversation trailer remain rejected without prefix recovery',()=>{
 const raw=readFileSync(new URL('./fixtures/coach-invalid-write-scope-trailer.txt',import.meta.url),'utf8'),frame=completeCoachJsonFrame(raw)!
 assert.ok(frame)
 assert.throws(()=>parseActionCoachTurn(raw))
 assert.throws(()=>parseActionCoachTurn(frame),'invented time field and source are not canonical business data')
 assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:'有效回复。'})+raw.slice(frame.length)),'even valid business data cannot authorize a conversation trailer')
 assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:'有效回复。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'server_owned_memory_clauses'}}]})))
})
