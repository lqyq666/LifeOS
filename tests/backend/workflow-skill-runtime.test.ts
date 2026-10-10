import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {fixture} from '../workflows/fixtures.ts'
import {randomUUID,createHash} from 'node:crypto'
import {businessSkills,loadBusinessSkill} from '../../server/workflows/skills.ts'
import {createTrace} from '../../server/workflows/trace.ts'
import {pool} from '../../server/db.ts'
test.after(()=>pool.end())
test('Skill invocation loads the frozen actual version and refuses missing or replaced instructions',()=>{
 const trace=createTrace(),loaded=businessSkills.map(name=>loadBusinessSkill(name,randomUUID(),trace))
 for(const s of loaded){assert.equal(s.digest,createHash('sha256').update(readFileSync('skills/'+s.name+'/SKILL.md')).digest('hex'));assert.equal(s.version,'0.2.0-candidate');assert.ok(s.instructions.includes(s.name))}
 const root=resolve('.local/simulation-skill-version-'+randomUUID());assert.ok(root.startsWith(resolve('.local')+'\\'));mkdirSync(root)
 try{
  const name=businessSkills[0];mkdirSync(resolve(root,name));writeFileSync(resolve(root,name,'SKILL.md'),loaded[0].instructions)
  assert.equal(loadBusinessSkill(name,randomUUID(),trace,root).digest,loaded[0].digest)
  writeFileSync(resolve(root,name,'SKILL.md'),loaded[1].instructions)
  assert.throws(()=>loadBusinessSkill(name,randomUUID(),trace,root),/source_invalid/)
  assert.throws(()=>loadBusinessSkill(businessSkills[1],randomUUID(),trace,root),/unavailable/)
  assert.equal(trace.rows.at(-1)!.status,'failed');assert.equal(trace.rows.at(-1)!.providerCalls,0)
 }finally{assert.ok(root.startsWith(resolve('.local')+'\\'));rmSync(root,{recursive:true})}
})
test('a failed optional growth Skill yields no explanation and preserves the committed host facts',async()=>{
 const root=resolve('.local/simulation-skill-fallback-'+randomUUID());assert.ok(root.startsWith(resolve('.local')+'\\'));mkdirSync(resolve(root,'server/workflows'),{recursive:true})
 try{
  for(const name of ['growth-diff.ts','skills.ts','contracts.ts','trace.ts','evidence-gate.ts'])writeFileSync(resolve(root,'server/workflows',name),readFileSync('server/workflows/'+name))
  for(const name of businessSkills){mkdirSync(resolve(root,'skills',name),{recursive:true});writeFileSync(resolve(root,'skills',name,'SKILL.md'),readFileSync('skills/'+name+'/SKILL.md'))}
  const {growthDiff}=await import(pathToFileURL(resolve(root,'server/workflows/growth-diff.ts')).href)
  rmSync(resolve(root,'skills/lifeos-growth-diff/SKILL.md'))
  const f=fixture(),trace=createTrace();f.request.mode='growth_diff'
  const after=[{ref:f.records[0].ref,kind:'experience',status:'active',assertion:'user_reported',text:f.records[0].text}]
  const before=JSON.stringify(after)
  assert.deepEqual(growthDiff(f.request,{traceId:f.request.traceId,requestId:f.request.requestId,committed:true,changedIds:[after[0].ref.id]},[],after,f.records,(r:any)=>trace.append(r)),[])
  assert.equal(JSON.stringify(after),before);assert.equal(trace.rows.at(-1)!.status,'failed');assert.equal(trace.rows.at(-1)!.providerCalls,0)
 }finally{assert.ok(root.startsWith(resolve('.local')+'\\'));rmSync(root,{recursive:true})}
})
