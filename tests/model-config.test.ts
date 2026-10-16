import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('V1.1 model tiers remain fixed even when legacy model override variables are present',()=>{
  const source=`import {resolveModel} from './server/model.ts'; console.log(JSON.stringify(['default','reasoning','deep'].map(tier=>{const value=resolveModel(tier);return {tier,provider:value.configured?value.model.provider:null,model:value.configured?value.model.id:null,configured:value.configured}})))`
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',source],{cwd:process.cwd(),encoding:'utf8',windowsHide:true,env:{...process.env,LIFEOS_MODEL_DEFAULT_PROVIDER:'zhipu',LIFEOS_DEFAULT_MODEL:'glm-4-flash',LIFEOS_MODEL_REASONING_PROVIDER:'zhipu',LIFEOS_REASONING_MODEL:'glm-reasoning',LIFEOS_MODEL_DEEP_PROVIDER:'bailian',LIFEOS_MODEL_DEEP_ID:'deep-model',LIFEOS_MODEL_DEEP_BASE_URL:'http://127.0.0.1:1'}})
  assert.equal(result.status,0,result.stderr)
  const tiers=JSON.parse(result.stdout)
  assert.deepEqual(tiers,[
    {tier:'default',provider:'bailian',model:'qwen3.8-flash',configured:true},
    {tier:'reasoning',provider:'bailian',model:'deepseek-v4.1-flash',configured:true},
    {tier:'deep',provider:null,model:null,configured:false},
  ])
})
