// Explicit dispatch of a frozen, independently reviewed private rehearsal.
// No deployment, paid calls, image upload or automatic retry.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const sha=value=>createHash('sha256').update(value).digest('hex');
const args=process.argv.slice(2),execute=args.includes('--execute');
const option=name=>{const index=args.indexOf(name);if(index<0||!args[index+1])throw Error('REQUIRED_'+name);return args[index+1];};
const bindingFile=path.resolve(option('--binding')),reviewRoot=path.resolve(option('--review'));
const raw=fs.readFileSync(bindingFile),binding=JSON.parse(raw);
if(!/^[a-f0-9]{40}$/.test(binding.expectedHead)||!/^recovery-[a-f0-9]{7}-[a-f0-9]{8}$/.test(binding.releaseLabel)||binding.releaseLabel.slice(9,16)!==binding.expectedHead.slice(0,7)||binding.publish!==false)throw Error('FROZEN_PRIVATE_REHEARSAL_REQUIRED');
const files=['deploy/rehearse-production.py','deploy/recovery-guards.py','deploy/verify-restoration.py'];
const sources=files.map(file=>({file,sha256:sha(fs.readFileSync(file))}));
for(const [index,key] of ['operationSha256','guardsSha256','verifierSha256'].entries())if(binding[key]!==sources[index].sha256)throw Error('FROZEN_OPERATION_CHANGED');
const manifest=JSON.parse(fs.readFileSync(path.join(reviewRoot,'manifest.json'))),report=JSON.parse(fs.readFileSync(path.join(reviewRoot,'report.json')));
if(report.verdict!=='PASS'||report.executionEligible!==true||manifest.bindingSha256!==sha(raw)||manifest.wrapperSha256!==sha(fs.readFileSync(new URL(import.meta.url)))||sources.some(row=>!manifest.sources.some(old=>old.file===row.file&&old.sha256===row.sha256)))throw Error('EXACT_OPERATION_WRAPPER_BINDING_REVIEW_REQUIRED');
const remote='/opt/lifeos/releases/'+binding.releaseLabel;
const remoteCommand='timeout --signal=TERM --kill-after=15s 480s python3 '+remote+'/rehearse-production.py --binding '+remote+'/operation-binding.json';
const sshArgs=['-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes','root@8.137.181.86',remoteCommand];
if(!execute){console.log(JSON.stringify({status:'REVIEWED_DISPATCH_PLAN',remoteReport:remote+'/isolated-rehearsal-report.json',remoteCommand,providerCalls:0,cozeCalls:0,publish:false}));process.exit(0);}
const receiptDirectory=path.join('.local','production-recovery',binding.releaseLabel);fs.mkdirSync(receiptDirectory,{recursive:true});
const initial=path.join(receiptDirectory,'dispatch-first.json'),final=path.join(receiptDirectory,'dispatch-final.json');
const receipt={status:'OUTCOME_PENDING',automaticRetry:false,sourceCommit:binding.expectedHead,bindingSha256:sha(raw),startedAt:new Date().toISOString(),remoteReport:remote+'/isolated-rehearsal-report.json',inspection:'Read the remote report, current public ready/version, exact container identity and the rescue unit before taking another action.',remoteCommand};
fs.writeFileSync(initial,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
const diagnostic=(stream,output)=>{
 const file=path.join(receiptDirectory,stream+'.txt');
 if(!fs.existsSync(file))fs.writeFileSync(file,output,{flag:'wx',mode:0o600});
 const saved=fs.readFileSync(file);receipt[stream+'Sha256']=sha(saved);receipt[stream+'Bytes']=saved.length;
};
try{
 const stdout=execFileSync('ssh',sshArgs,{encoding:'utf8',timeout:520000,maxBuffer:4*1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']});
 diagnostic('stdout',stdout);
 const result=JSON.parse(stdout.trim().split('\n').at(-1));receipt.report=result;receipt.status=result.status;
 if(result.status!=='PASS_PRIVATE_STARTUP_AND_SOURCE_RESTORE_FIDELITY'||result.originalServiceRestored!==true)process.exitCode=1;
}catch(error){
 receipt.status='FAILED_OR_UNKNOWN_INSPECT_REMOTE_NO_REISSUE';receipt.exitCode=error.status??null;receipt.signal=error.signal??null;
 for(const stream of ['stdout','stderr'])diagnostic(stream,error[stream]??'');
 process.exitCode=1;
}finally{
 receipt.completedAt=new Date().toISOString();
 const temporary=final+'.tmp';fs.writeFileSync(temporary,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,final);
 console.log(JSON.stringify({status:receipt.status,receipt:final,remoteReport:receipt.remoteReport,publish:false}));
}
