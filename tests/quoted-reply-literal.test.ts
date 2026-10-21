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
