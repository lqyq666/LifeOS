import assert from 'node:assert/strict'
import test from 'node:test'
import {createHash} from 'node:crypto'
import {captureCoachSource,workflowCompatibilityDigest} from '../scripts/coach-source-freeze.ts'

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
  for(const path of ['tests/unrelated.test.ts','src/features/conversation/ConversationPage.tsx','public/icon.svg','scripts/unrelated-test-report.ts','PRODUCT.md']){
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
