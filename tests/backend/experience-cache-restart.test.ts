import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,sep} from 'node:path'
import {rankConfirmedCoachExperiences,clearExperienceVectorCache} from '../../server/coach-retrieval.ts'
import {pool} from '../../server/db.ts'

test.after(async()=>{await pool.end()})
test('restart reuses only owner and content bound offline vectors',async()=>{
 const directory=await mkdtemp(resolve(tmpdir(),'lifeos-vector-test-'))
 let documents=0
 const encode=async(texts:string[],query=false)=>{if(!query)documents+=texts.length;return texts.map(()=>[1,...Array(511).fill(0)])}
 const row={user_id:'owner-one',id:'experience-one',revision:1,source_message_id:'message-one',source_quote:'我完成了原型',content:{summary:'我完成了原型',action:'整理反馈'},updated_at:'2026-10-24T00:00:00Z'}
 const options:any={encode,cacheDirectory:directory}
 try{
  clearExperienceVectorCache();await rankConfirmedCoachExperiences([row],'原型',4,options);assert.equal(documents,2)
  clearExperienceVectorCache();await rankConfirmedCoachExperiences([row],'原型的新问题',4,options)
  assert.equal(documents,2,'a process restart must not re-encode unchanged personal history')
  clearExperienceVectorCache();await rankConfirmedCoachExperiences([{...row,user_id:'owner-two'}],'原型',4,options);assert.equal(documents,4,'another owner cannot reuse the private entry')
  clearExperienceVectorCache();await rankConfirmedCoachExperiences([{...row,revision:2,content:{summary:'已更正的原型',action:'整理反馈'}}],'原型',4,options);assert.equal(documents,6,'correction invalidates old vectors')
  const before=documents;await rankConfirmedCoachExperiences([],'已经遗忘',4,options);assert.equal(documents,before)
 }finally{clearExperienceVectorCache();assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));await rm(directory,{recursive:true,force:true})}
})
