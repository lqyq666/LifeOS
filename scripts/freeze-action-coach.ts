import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {captureCoachSource} from './coach-source-freeze.ts'
if(!process.argv.includes('--write'))throw new Error('Use --write to save the current source/configuration freeze; no provider call is made.')
const snapshot=captureCoachSource(),directory=resolve('evidence/v1.3-action-coach/freeze')
mkdirSync(directory,{recursive:true})
const path=resolve(directory,'source-'+Date.now()+'.json')
writeFileSync(path,JSON.stringify({...snapshot,at:new Date().toISOString(),evidence:'SOURCE_FREEZE_ONLY_NOT_PROVIDER_ACCEPTANCE'},null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({path,digest:snapshot.digest,files:snapshot.files.length,providerCalls:0}))
