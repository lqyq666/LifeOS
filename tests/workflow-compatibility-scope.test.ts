import assert from 'node:assert/strict'
import test from 'node:test'
import {createHash} from 'node:crypto'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {captureCoachSource,workflowCompatibilityDigest,assertCoachSourceFreeze} from '../scripts/coach-source-freeze.ts'

const snapshot=captureCoachSource()
function changed(path:string){
  const next=structuredClone(snapshot)
  const file=next.files.find(file=>file.path===path)
  if(file)file.sha256='0'.repeat(64)
  else next.files.push({path,sha256:'0'.repeat(64)})
  next.digest=createHash('sha256').update(JSON.stringify({files:next.files,runtime:next.runtime})).digest('hex')
  return next
}

test('Coze compatibility survives browser/test changes while the complete audit digest changes',()=>{
  for(const path of ['tests/unrelated.test.ts','src/features/conversation/ConversationPage.tsx','public/icon.svg','scripts/unrelated-test-report.ts','PRODUCT.md','server/turn-engine.ts','server/reply-draft.ts']){
    const next=changed(path)
    assert.notEqual(next.digest,snapshot.digest,path)
    assert.equal(workflowCompatibilityDigest(next),workflowCompatibilityDigest(snapshot),path)
  }
})

test('execution, account controls, protocol, Skill and source verification still invalidate compatibility',()=>{
  for(const path of ['server/workflows/task-host.ts','server/workflows/task-commit.ts','server/workflows/contracts.ts','server/growth.ts','server/auth.ts','scripts/coze-host-permit.ts','scripts/coach-provider-budget.ts','scripts/coze-credit-budget.ts','scripts/coach-source-freeze.ts','skills/lifeos-personal-companion/SKILL.md','skills/lifeos-direction-analysis/SKILL.md','src/features/growth/types.ts','evidence/v1.3-action-coach/research/source-verification.json','.planning/research/workflow-integration/INDEPENDENT_EXECUTION_BINDINGS.json']){
    assert.notEqual(workflowCompatibilityDigest(changed(path)),workflowCompatibilityDigest(snapshot),path)
  }
  const configured=structuredClone(snapshot)
  configured.runtime.access.entitlementsEnabled=!configured.runtime.access.entitlementsEnabled
  assert.notEqual(workflowCompatibilityDigest(configured),workflowCompatibilityDigest(snapshot))
})

test('the real dispatch freeze permits UI edits but still refuses changed protocol bytes',()=>{
 const prefix=join(tmpdir(),'lifeos-coze-compat-'),root=mkdtempSync(prefix)
 try{
  for(const path of ['server/workflows','src/backend'])mkdirSync(join(root,path),{recursive:true})
  for(const path of ['package.json','server/turn-engine.ts','server/action-coach-contracts.ts','src/backend/client.ts','server/workflows/contracts.ts'])writeFileSync(join(root,path),'original')
  const path=join(root,'freeze.json');writeFileSync(path,JSON.stringify(captureCoachSource(root)))
  writeFileSync(join(root,'src/backend/client.ts'),'new UI')
  writeFileSync(join(root,'server/turn-engine.ts'),'new ordinary generator')
  assert.doesNotThrow(()=>assertCoachSourceFreeze(path,root,'workflow'))
  assert.throws(()=>assertCoachSourceFreeze(path,root),/SOURCE_OR_CONFIG_CHANGED/)
  writeFileSync(join(root,'server/workflows/contracts.ts'),'new protocol')
  assert.throws(()=>assertCoachSourceFreeze(path,root,'workflow'),/SOURCE_OR_CONFIG_CHANGED/)
 }finally{assert.ok(root.startsWith(prefix));rmSync(root,{recursive:true})}
})
