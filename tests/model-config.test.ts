import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

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

test('synthetic output diagnostics stay off in production and require loopback, flag, and user allowlist locally',()=>{
  const cwd=mkdtempSync(join(resolve('.local'),'lifeos-config-test-'))
  const moduleUrl=pathToFileURL(resolve('server/config.ts')).href
  const source=`import {config} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify({enabled:config.syntheticModelDiagnosticsEnabled,allowlisted:config.syntheticDiagnosticUserIds.length}))`
  const userId='a'.repeat(32)
  const read=(nodeEnv:'production'|'development',overrides:Record<string,string>={})=>{
    const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',source],{
      cwd,encoding:'utf8',windowsHide:true,
      env:{PATH:process.env.PATH??'',NODE_ENV:nodeEnv,LIFEOS_HOST:'127.0.0.1',LIFEOS_SYNTHETIC_MODEL_DIAGNOSTICS:'true',LIFEOS_SYNTHETIC_DIAGNOSTIC_USERS:userId,...overrides},
    })
    assert.equal(result.status,0,result.stderr)
    return JSON.parse(result.stdout)
  }
  try{
    assert.deepEqual(read('production'),{enabled:false,allowlisted:1})
    assert.deepEqual(read('production',{LIFEOS_HOST:'0.0.0.0'}),{enabled:false,allowlisted:1})
    assert.deepEqual(read('development'),{enabled:true,allowlisted:1})
    assert.deepEqual(read('development',{LIFEOS_HOST:'0.0.0.0'}),{enabled:false,allowlisted:1})
    assert.deepEqual(read('development',{LIFEOS_SYNTHETIC_MODEL_DIAGNOSTICS:'false'}),{enabled:false,allowlisted:1})
    assert.deepEqual(read('development',{LIFEOS_SYNTHETIC_DIAGNOSTIC_USERS:''}),{enabled:false,allowlisted:0})
  }finally{
    const root=resolve('.local'),target=resolve(cwd)
    if(target.startsWith(root+sep)&&target.slice(root.length+sep.length).startsWith('lifeos-config-test-'))rmSync(target,{recursive:true,force:true})
  }
})
