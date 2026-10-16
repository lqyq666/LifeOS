import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectRepository,validateBlob} from '../scripts/safe-sync.mjs';

// Only disposable local Git fixtures; never contact a remote or mutate source.
function fixture(label) {
  const dir=mkdtempSync(path.join(tmpdir(),'lifeos-sync-'+label+'-'));
  const git=(...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8',windowsHide:true});
  git('init','-b','release-test');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');
  writeFileSync(path.join(dir,'README.md'),label);git('add','README.md');git('commit','-m','safe initial');
  return {dir,git,head:()=>git('rev-parse','HEAD').trim()};
}
test('clean committed changes validate without staging or network',()=>{
  const source=fixture('source'),pub=fixture('publication');
  assert.equal(inspectRepository(pub.dir,pub.head(),source.dir).scannedBlobs,1);
  assert.equal(pub.git('status','--porcelain'),'');
  assert.throws(()=>inspectRepository(source.dir,source.head(),source.dir),/SOURCE_HISTORY/);
});
test('dirty publication copy and main are refused',()=>{
  const source=fixture('source2'),pub=fixture('publication2');
  writeFileSync(path.join(pub.dir,'unfinished.txt'),'unfinished');
  assert.throws(()=>inspectRepository(pub.dir,pub.head(),source.dir),/UNFINISHED/);
  unlinkSync(path.join(pub.dir,'unfinished.txt'));pub.git('branch','-m','main');
  assert.throws(()=>inspectRepository(pub.dir,pub.head(),source.dir),/DEFAULT_BRANCH/);
});
test('development ancestry is refused even in a separate clean clone',()=>{
  const source=fixture('source3'),pub=fixture('publication3');
  pub.git('fetch',source.dir,'release-test');pub.git('checkout','-B','source-copy','FETCH_HEAD');
  assert.throws(()=>inspectRepository(pub.dir,pub.head(),source.dir),/DEVELOPMENT_HISTORY/);
});
test('secrets deleted in later commits still block upload',()=>{
  const source=fixture('source4'),pub=fixture('publication4');
  writeFileSync(path.join(pub.dir,'config.txt'),'token=gh'+'p_'+'A'.repeat(30));
  pub.git('add','config.txt');pub.git('commit','-m','bad historical file');
  pub.git('rm','config.txt');pub.git('commit','-m','delete bad file');
  assert.throws(()=>inspectRepository(pub.dir,pub.head(),source.dir),/POSSIBLE_SECRET/);
});
test('private paths and credentials in ordinary extensions are refused',()=>{
  for(const name of ['.env','x/.env.production','backups/a.txt','.local/a.json','evidence/private.json','deploy/__pycache__/a.pyc'])
    assert.throws(()=>validateBlob(name,Buffer.from('data')),/PRIVATE_OR_UNREVIEWED/);
  assert.throws(()=>validateBlob('src/config.ts',Buffer.from('postgres://person:private@host/db')),/POSSIBLE_SECRET/);
  validateBlob('.env.production.example',Buffer.from('KEY=<set-locally>'));
});
test('runtime evidence is allowed only by exact reviewed bytes; private ledgers remain blocked',()=>{
  const data=Buffer.from('{"publicSource":"reviewed"}'),hash=createHash('sha256').update(data).digest('hex');
  const name='evidence/runtime/public-proof.json';
  validateBlob(name,data,{[name]:hash});
  assert.throws(()=>validateBlob(name,Buffer.from('changed'),{[name]:hash}),/UNREVIEWED/);
  assert.throws(()=>validateBlob('.local/ledger.json',data,{'.local/ledger.json':hash}),/PRIVATE/);
});
