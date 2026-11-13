import assert from 'node:assert/strict'
import {readFileSync,statSync} from 'node:fs'
import {resolve} from 'node:path'

// Run after build: opening chat must not eagerly download the 3D scene.
const root=resolve(process.argv[2]??'dist'),html=readFileSync(resolve(root,'index.html'),'utf8')
const files=[...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="(\/assets\/[^" ]+\.js)"/g)].map(match=>match[1])
assert.ok(files.length>0,'No built JavaScript entry found')
assert.ok(files.every(file=>!/(?:three-|LifeFlywheel-|decode-)/.test(file)),'Chat still eagerly loads 3D code')
const initialBytes=files.reduce((total,file)=>total+statSync(resolve(root,'.'+file)).size,0)
assert.ok(initialBytes<600_000,'Chat entry JavaScript exceeds the verified 600KB raw budget')
console.log(JSON.stringify({status:'PASS_CHAT_ENTRY_3D_LAZY',initialBytes,files}))
