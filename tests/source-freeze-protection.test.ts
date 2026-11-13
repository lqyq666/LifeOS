import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,unlinkSync,realpathSync,rmSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'

const {captureCoachSource}=await import(process.env.SOURCE_FREEZE_CAPTURE_MODULE??'../scripts/coach-source-freeze.ts')
test('frozen source skips the protected path before reading or following links; ordinary links still fail closed',()=>{
 const parent=realpathSync(tmpdir()),root=mkdtempSync(join(parent,'lifeos-freeze-root-')),outside=mkdtempSync(join(parent,'lifeos-freeze-unused-'))
 const protectedLink=join(root,'tests/backend/action-coach-engine.test.ts'),ordinaryLink=join(root,'server/untrusted-link')
 try{
  for(const [name,body] of [['package.json','{}'],['server/turn-engine.ts','// synthetic engine'],['server/action-coach-contracts.ts','// synthetic contract'],['src/backend/client.ts','// synthetic client']]){const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,body)}
  mkdirSync(dirname(protectedLink),{recursive:true});writeFileSync(join(outside,'never-follow.txt'),'synthetic excluded contents')
  symlinkSync(outside,protectedLink,process.platform==='win32'?'junction':'dir')
  const snapshot=captureCoachSource(root);assert.ok(!snapshot.files.some((file:{path:string})=>file.path.startsWith('tests/backend/action-coach-engine.test.ts')))
  symlinkSync(outside,ordinaryLink,process.platform==='win32'?'junction':'dir');assert.throws(()=>captureCoachSource(root),/SOURCE_FREEZE_SYMLINK_REJECTED/)
 }finally{
  for(const link of [protectedLink,ordinaryLink])try{unlinkSync(link)}catch{}
  for(const directory of [root,outside]){assert.equal(dirname(realpathSync(directory)),parent);assert.match(directory,/lifeos-freeze-(?:root|unused)-/);rmSync(directory,{recursive:true,force:true})}
 }
})
