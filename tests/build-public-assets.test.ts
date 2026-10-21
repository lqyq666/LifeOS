import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,symlinkSync,rmSync,realpathSync} from 'node:fs'
import {join,resolve,sep,basename} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'

function runFixture(mode:string){
 const parent=realpathSync(tmpdir()),temp=mkdtempSync(join(parent,'lifeos-asset-tree-'))
 if(!temp.startsWith(parent+sep)||!basename(temp).startsWith('lifeos-asset-tree-'))throw Error('UNSAFE_TEMP_TARGET')
 try{
  const root=mode==='workspace-ancestor-link'?join(temp,'linked-parent','repo'):join(temp,'repo'),outside=join(temp,'outside')
  mkdirSync(outside,{recursive:true})
  if(mode==='workspace-ancestor-link')symlinkSync(outside,join(temp,'linked-parent'),'junction')
  if(mode==='workspace-root-link'){
   mkdirSync(join(outside,'repo'),{recursive:true})
   symlinkSync(join(outside,'repo'),root,'junction')
  }
  mkdirSync(join(root,'deploy'),{recursive:true})
  writeFileSync(join(outside,'outside-marker.txt'),'SYNTHETIC_OUTSIDE_MARKER_NOT_SECRET')
  mkdirSync(join(root,'.local'),{recursive:true})
  if(mode==='source-ancestor'){
   mkdirSync(join(outside,'models'),{recursive:true})
   symlinkSync(join(outside,'models'),join(root,'.local','models'),'junction')
  }
  const model=join(root,'.local','models','bge-small-zh-v1.5'),wheels=join(root,'.local','docker-embedding','wheels')
  mkdirSync(model,{recursive:true});mkdirSync(wheels,{recursive:true})
  writeFileSync(join(model,'config.json'),'SYNTHETIC_CONFIG')
  writeFileSync(join(wheels,'fixture.whl'),'SYNTHETIC_WHEEL')
  if(mode==='nested-link')symlinkSync(outside,join(model,'nested'),'junction')
  if(mode==='context-root-link')symlinkSync(outside,join(root,'.local','image-build-contexts'),'junction')
  const script=join(root,'deploy','build-image.ps1')
  copyFileSync(resolve('deploy/build-image.ps1'),script)
  const env:NodeJS.ProcessEnv={}
  for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','USERPROFILE'])if(process.env[key])env[key]=process.env[key]
  Object.assign(env,{LIFEOS_FIXTURE_SCRIPT:script,LIFEOS_FIXTURE_OUTSIDE:outside,LIFEOS_FIXTURE_MODE:mode})
  const ps=`
$global:FixtureDockerCalled=$false
$global:FixtureContextPath=$null
function git { $global:LASTEXITCODE=0; if($args[0] -eq 'rev-parse'){ 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } }
function tar {
 $global:LASTEXITCODE=0
 $global:FixtureContextPath=$args[-1]
 if($env:LIFEOS_FIXTURE_MODE -eq 'archive-local-link'){
  New-Item -ItemType Junction -Path (Join-Path $global:FixtureContextPath '.local') -Target $env:LIFEOS_FIXTURE_OUTSIDE | Out-Null
 }
}
function docker { $global:FixtureDockerCalled=$true; $global:LASTEXITCODE=0 }
$failure=$null
try { & $env:LIFEOS_FIXTURE_SCRIPT } catch { $failure=$_.Exception.Message }
$marker=$false
if($global:FixtureContextPath){$marker=Test-Path -LiteralPath (Join-Path $global:FixtureContextPath '.local/models/bge-small-zh-v1.5/nested/outside-marker.txt')}
$result=@{rejected=($null -ne $failure);error=$failure;dockerCalled=$global:FixtureDockerCalled;outsideMarkerInContext=$marker;outsideDestinationWritten=($env:LIFEOS_FIXTURE_MODE -eq 'archive-local-link' -and (Test-Path -LiteralPath (Join-Path $env:LIFEOS_FIXTURE_OUTSIDE 'models/bge-small-zh-v1.5/config.json')))}
Write-Output ('RESULT_JSON='+($result | ConvertTo-Json -Compress))
`
  const stdout=execFileSync('pwsh',['-NoProfile','-Command',ps],{env,encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']})
  const line=stdout.split(/\r?\n/).find(line=>line.startsWith('RESULT_JSON='))
  assert.ok(line,'fixture must report the actual script result')
  return JSON.parse(line.slice('RESULT_JSON='.length))
 }finally{
  if(!temp.startsWith(parent+sep)||!basename(temp).startsWith('lifeos-asset-tree-'))throw Error('UNSAFE_TEMP_CLEANUP')
  rmSync(temp,{recursive:true,force:true})
 }
}

test('Windows builder accepts an ordinary public offline asset tree',{skip:process.platform!=='win32'},()=>{
 const result=runFixture('ordinary')
 assert.equal(result.rejected,false,JSON.stringify(result))
 assert.equal(result.dockerCalled,true)
})
for(const mode of ['nested-link','source-ancestor','archive-local-link','context-root-link','workspace-root-link','workspace-ancestor-link'])test('Windows builder refuses '+mode+' before Docker or outside copying',{skip:process.platform!=='win32'},()=>{
 const result=runFixture(mode)
 assert.equal(result.rejected,true,JSON.stringify(result))
 assert.equal(result.dockerCalled,false,JSON.stringify(result))
 assert.equal(result.outsideDestinationWritten,false,JSON.stringify(result))
 assert.match(result.error,/reparse|symlink|private|escapes/i)
})
