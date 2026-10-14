import {growthSnapshot} from '../../server/workflows/committed-growth-diff.ts'
import {growthDiff} from '../../server/workflows/growth-diff.ts'
import type {GrowthItem} from '../../src/features/growth/types.ts'
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
test('the host contract preserves confirmation boundaries without parsing Skill prose',()=>{
 const f=fixture();f.request.mode='growth_diff'
 for(const [assertion,status,expected] of [['user_reported','active',false],['ai_observation','active',true],['user_reported','proposed',true]] as const){
  const source=f.records[0]!,after=[{ref:source.ref,kind:'context' as const,status,assertion,text:source.text}]
  const output=growthDiff(f.request,{traceId:f.request.traceId,requestId:f.request.requestId,committed:true,changedIds:[source.ref.id]},[],after,f.records)
  assert.equal(output[0].needsConfirmation,expected)
 }
})
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
  mkdirSync(resolve(root,'src/features/growth'),{recursive:true});writeFileSync(resolve(root,'src/features/growth/types.ts'),readFileSync('src/features/growth/types.ts'))
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


test('feedback keeps its kind and a completed Skill trace binds the actual explanation',()=>{
 const f=fixture();f.request.mode='growth_diff'
 const source=f.records[0]!,item={id:source.ref.id,revision:source.ref.revision,kind:'feedback',text:source.text,status:'active',assertion:'user_reported',unavailableReason:null} as GrowthItem
 const after=growthSnapshot([item]);assert.equal(after[0]!.kind,'feedback')
 after[0]!.ref=source.ref
 const trace=createTrace(),changes=growthDiff(f.request,{traceId:f.request.traceId,requestId:f.request.requestId,committed:true,changedIds:[source.ref.id]},[],after,f.records,row=>trace.append(row))
 assert.match(changes[0]!.now,/行动反馈/)
 assert.ok(changes[0]!.unknowns[0]!.includes('未报告的采用、付款与效果仍未知'))
 const execution=trace.rows.find(row=>row.skillPhase==='output_validated')!
 assert.equal(execution.skill,'lifeos-growth-diff');assert.deepEqual(execution.usedEvidenceIds,[source.ref.id]);assert.equal(execution.providerCalls,0)
 assert.notEqual(execution.outputRefDigest,trace.rows.find(row=>row.skill===execution.skill&&row.skillPhase==='loaded')!.outputRefDigest)
})


test('missing optional Skill at process import is unavailable without preventing host startup',async()=>{
 const root=resolve('.local/simulation-skill-cold-'+randomUUID());assert.ok(root.startsWith(resolve('.local')+'\\'));mkdirSync(resolve(root,'server/workflows'),{recursive:true})
 try{
  for(const name of ['skills.ts','contracts.ts'])writeFileSync(resolve(root,'server/workflows',name),readFileSync('server/workflows/'+name))
  const cold=await import(pathToFileURL(resolve(root,'server/workflows/skills.ts')).href)
  assert.ok(cold.businessSkillSnapshot.every((entry:any)=>entry.version==='unavailable'))
  const trace=createTrace()
  assert.throws(()=>cold.loadBusinessSkill('lifeos-growth-diff',randomUUID(),trace),/unavailable/)
  assert.equal(trace.rows.at(-1)!.status,'failed');assert.equal(trace.rows.at(-1)!.providerCalls,0)
  mkdirSync(resolve(root,'skills/lifeos-growth-diff'),{recursive:true});writeFileSync(resolve(root,'skills/lifeos-growth-diff/SKILL.md'),readFileSync('skills/lifeos-growth-diff/SKILL.md'))
  assert.throws(()=>cold.loadBusinessSkill('lifeos-growth-diff',randomUUID(),trace),/source_invalid/,'late copy cannot impersonate the running snapshot; reload the process')
 }finally{assert.ok(root.startsWith(resolve('.local')+'\\'));rmSync(root,{recursive:true})}
})


test('committed feedback, correction and new-session memory share the actual star-map transaction',async()=>{
 const store=await import('../../server/store.ts'),{stageGrowthUpdates,growthContext}=await import('../../server/growth.ts')
 const previous=process.env.LIFEOS_ADVANCED_WORKFLOWS;process.env.LIFEOS_ADVANCED_WORKFLOWS='true'
 const user='skill-loop-'+randomUUID(),chat=randomUUID()
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1)',[user])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC feedback loop'})
  const first=(await store.startRun(user,chat,randomUUID(),'我决定就业优先。我已经交付排版稿。')).run
  const growth=await stageGrowthUpdates(first,[
   {target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{messageId:first.source_message_id,quote:'我决定就业优先'}},
   {target:{operation:'create'},kind:'feedback',progressState:'completed',assertion:'user_reported',source:{messageId:first.source_message_id,quote:'我已经交付排版稿'}},
  ],[])
  const saved=await store.finishRun(first,{candidates:[],audit:[],growth},'按你的报告保留交付，采用与效果未知。',null,new AbortController().signal)
  assert.ok(saved.stateChange.growthDiff.some(x=>x.now.includes('行动反馈')))
  assert.equal((await pool.query('SELECT count(*)::int n FROM user_themes WHERE user_id=$1',[user])).rows[0].n,1,'feedback does not manufacture a second goal')
  const audit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,first.request_id])).rows[0].tool_audit
  assert.ok(audit.some((x:any)=>x.skill==='lifeos-growth-diff'&&x.skillPhase==='output_validated'))
  const secondChat=randomUUID();await store.createConversation(user,{id:secondChat,title:'SYNTHETIC correction session'})
  const context=await growthContext(user,secondChat),feedback=context.find(x=>x.kind==='feedback')!
  assert.equal(feedback.text,'我已经交付排版稿')
  const correction=(await store.startRun(user,secondChat,randomUUID(),'我更正一下，排版稿还没交付。')).run
  const corrected=await stageGrowthUpdates(correction,[{target:{operation:'replace',itemId:feedback.id,expectedRevision:feedback.revision},kind:'feedback',progressState:'unattempted',assertion:'user_reported',source:{messageId:correction.source_message_id,quote:'排版稿还没交付'}}],context)
  const receipt=await store.finishRun(correction,{candidates:[],audit:[],growth:corrected},'保留更正后的状态。',null,new AbortController().signal)
  assert.ok(receipt.stateChange.growthDiff.some(x=>x.change==='corrected'&&x.now.includes('排版稿还没交付')))
  assert.equal((await growthContext(user,chat)).find(x=>x.id===feedback.id)!.progressState,'unattempted')
  assert.equal((await pool.query('SELECT count(*)::int n FROM experiences WHERE user_id=$1',[user])).rows[0].n,0,'feedback alone is not a confirmed experience')
  await pool.query('UPDATE user_memory_settings SET enabled=false WHERE user_id=$1',[user])
  const thirdChat=randomUUID();await store.createConversation(user,{id:thirdChat,title:'SYNTHETIC memory off'})
  assert.equal((await growthContext(user,thirdChat)).length,0)
 }finally{if(previous===undefined)delete process.env.LIFEOS_ADVANCED_WORKFLOWS;else process.env.LIFEOS_ADVANCED_WORKFLOWS=previous}
})
