import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { growthContext, growthView, actOnGrowthItem, stageGrowthUpdates } from '../../server/growth.ts'
import { deriveExplicitDirectionControls, readDirectionControls, stageDirectionControls, persistDirectionControls, directionControlsSnapshotKey } from '../../server/growth-controls.ts'
import { buildTurnPrompt } from '../../server/turn-prompt.ts'

test('deriveExplicitDirectionControls recognizes only the user\'s own explicit commands',()=>{
  // Positive: withdrawal plus pause in one message.
  const pause=deriveExplicitDirectionControls('我撤回成绩单信息，也先别推升学相关的安排。')
  assert.equal(pause.status,'explicit')
  if(pause.status==='explicit'){
    assert.deepEqual(pause.changes[0]!.scopes,['overseas_study','postgraduate_exam','postgraduate_recommendation','undergraduate_upgrade'].sort(),'升学 expands to exactly the four further-study scopes')
    assert.equal(pause.changes[0]!.operation,'pause')
  }
  // Resume names one scope only.
  const resume=deriveExplicitDirectionControls('恢复考研建议。')
  assert.equal(resume.status,'explicit')
  if(resume.status==='explicit'){assert.deepEqual(resume.changes[0]!.scopes,['postgraduate_exam']);assert.equal(resume.changes[0]!.operation,'resume')}
  // CTR-03: attribution, questions, negation and quotes never trigger.
  for(const text of [
    '朋友说先别推升学，但我想继续考研。',
    '你是不是以后都不推升学了？',
    '我不是让你停止升学建议。',
    '他之前说“先别推升学相关的安排”，我没同意。',
    '我对视觉设计比较有兴趣，每周能投入6小时。',
  ])assert.deepEqual(deriveExplicitDirectionControls(text),{status:'none'},text)
  // Broad dissatisfaction without a direction asks for confirmation instead of guessing.
  assert.equal(deriveExplicitDirectionControls('别再给我推这些乱七八糟的了。').status,'needs_confirmation')
  // Single named directions.
  const one=deriveExplicitDirectionControls('先别推就业相关的实习建议。')
  if(one.status==='explicit')assert.deepEqual(one.changes[0]!.scopes,['employment'])
})

test('direction controls persist per account, expand 升学 atomically, resume one scope, conflict on stale snapshots, and survive forgetting (CTR-01..05)',async t=>{
  const user='growth-controls-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC direction controls'})
  const prepare=async(text:string)=>{
    await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_TEST_CLEANUP',finished_at=now() WHERE user_id=$1 AND conversation_id=$2 AND status='running'",[user,chat])
    return (await store.startRun(user,chat,randomUUID(),text)).run
  }
  const commitControls=async(run:store.Run)=>{
    const derived=deriveExplicitDirectionControls((await pool.query('SELECT content FROM messages WHERE id=$1',[run.source_message_id])).rows[0].content)
    if(derived.status!=='explicit')throw new Error('DERIVE_NOT_EXPLICIT')
    const staged=await stageDirectionControls(run,derived.changes)
    return store.finishRun(run,{candidates:[],audit:[],directionControls:staged,directionControlSnapshotKey:staged.expectedSnapshotKey},'已按你的要求更新方向设置。',null,new AbortController().signal)
  }
  try{
    await t.test('CTR-01 pausing 升学 keeps personal facts and blocks the four scopes across sessions',async()=>{
      const first=await prepare('我有三个数字媒体作品，对视觉设计有兴趣。')
      const growthStage=await stageGrowthUpdates(first,[{target:{operation:'create'},kind:'ability',assertion:'user_reported',source:{messageId:first.source_message_id,quote:'我有三个数字媒体作品'}}],[])
      await store.finishRun(first,{candidates:[],audit:[],growth:growthStage},'已记录。',null,new AbortController().signal)
      const pauseRun=await prepare('我撤回成绩单信息，也先别推升学相关的安排。')
      const saved=await commitControls(pauseRun)
      assert.equal(saved.directionControls!.changedScopes.length,4)
      const controls=await readDirectionControls(user)
      assert.deepEqual(controls.map(row=>row.scope),['overseas_study','postgraduate_exam','postgraduate_recommendation','undergraduate_upgrade'])
      assert.ok(controls.every(row=>row.state==='paused'&&row.sourceMessageId===pauseRun.source_message_id))
      // Personal facts survive: pausing suggestions never deletes records, and
      // the prompt carries the blocked set for any later turn.
      const facts=await growthContext(user,chat)
      assert.ok(facts.some(row=>row.text==='我有三个数字媒体作品'),'works fact is untouched')
      const prompt=buildTurnPrompt({currentMessageId:'x',messages:[{id:'x',role:'user',content:'接下来做什么',created_at:new Date().toISOString()}],directionControls:controls,allowedDirectionScopes:['employment','entrepreneurship','public_service'],blockedDirectionScopes:controls.map(row=>row.scope)})
      assert.ok(prompt.includes('"blockedDirectionScopes":["overseas_study'),'paused scopes reach the model prompt as blocked')
      assert.ok(prompt.includes('"allowedDirectionScopes":["employment"'),'remaining scopes stay allowed')
    })
    await t.test('CTR-02 resuming 考研 resumes exactly that scope',async()=>{
      const resumeRun=await prepare('恢复考研建议。')
      await commitControls(resumeRun)
      const controls=await readDirectionControls(user)
      assert.equal(controls.find(row=>row.scope==='postgraduate_exam')!.state,'enabled')
      assert.equal(controls.find(row=>row.scope==='postgraduate_exam')!.revision,2)
      for(const scope of ['overseas_study','postgraduate_recommendation','undergraduate_upgrade'])assert.equal(controls.find(row=>row.scope===scope)!.state,'paused','other paused scopes stay paused')
    })
    await t.test('CTR-03 questions, negations and third-party speech change nothing',async()=>{
      const before=directionControlsSnapshotKey(await readDirectionControls(user))
      for(const text of ['朋友说先别推就业，但我想继续找实习。','你是不是不推就业了？','我不是让你停止创业建议。']){
        const run=await prepare(text)
        assert.equal(deriveExplicitDirectionControls(text).status,'none')
        await store.terminateRun(user,run.request_id,'failed','SYNTHETIC_TEST_CLEANUP')
      }
      assert.equal(directionControlsSnapshotKey(await readDirectionControls(user)),before)
    })
    await t.test('CTR-04 a control snapshot changed during generation rejects the commit with 409',async()=>{
      const other=await prepare('先别推创业相关的建议。')
      await store.finishRun(other,{candidates:[],audit:[]},'已暂停创业建议。',null,new AbortController().signal)
      const run=await prepare('先别推就业相关的建议。')
      const staged=await stageDirectionControls(run,[{scopes:['employment'],operation:'pause',quote:'先别推就业相关的建议'}])
      // Another device commits a pause between staging and this commit.
      await pool.query("INSERT INTO growth_direction_controls(user_id,scope,state,revision,source_conversation_id,source_message_id,source_quote,origin_request_id) VALUES($1,'entrepreneurship','paused',1,$2,$3,'先别推创业相关的建议',$4)",[user,chat,other.source_message_id,other.request_id])
      await assert.rejects(store.finishRun(run,{candidates:[],audit:[],directionControls:staged,directionControlSnapshotKey:staged.expectedSnapshotKey},'过时的提交。',null,new AbortController().signal),{code:'DIRECTION_CONTROL_CONFLICT'})
      assert.equal((await readDirectionControls(user)).find(row=>row.scope==='employment')?.state??'enabled','enabled','the stale commit wrote nothing')
    })
    await t.test('CTR-05 forgetting the original words redacts provenance but keeps the pause; controls ignore memory settings',async()=>{
      // The control and a growth item share one source message, exactly like a
      // real mixed turn; forgetting that item's message retires the control's
      // private quote while the pause itself stays.
      const pauseRun=await prepare('先别推考公相关的建议。')
      const derived=deriveExplicitDirectionControls('先别推考公相关的建议。')
      const stagedControls=await stageDirectionControls(pauseRun,derived.status==='explicit'?derived.changes:[])
      const staged=await stageGrowthUpdates(pauseRun,[{target:{operation:'create'},kind:'preference',assertion:'user_reported',source:{messageId:pauseRun.source_message_id,quote:'先别推考公相关的建议'}}],[])
      const saved=await store.finishRun(pauseRun,{candidates:[],audit:[],growth:staged,directionControls:stagedControls,directionControlSnapshotKey:stagedControls.expectedSnapshotKey},'已暂停考公建议。',null,new AbortController().signal)
      const item=(await growthView(user,chat)).items.find(row=>row.id===saved.growthIds[0])!
      await actOnGrowthItem(user,item.id,{requestId:randomUUID(),expectedRevision:item.revision,action:'forget'})
      const controls=await readDirectionControls(user)
      const civil=controls.find(row=>row.scope==='public_service')!
      assert.equal(civil.state,'paused','the pause itself survives forgetting')
      assert.equal(civil.sourceRedacted,true)
      assert.equal(civil.sourceMessageId,null)
      assert.equal(civil.sourceQuote,'原话已遗忘')
      const snapshots=(await pool.query("SELECT snapshot->>'sourceQuote' AS quote FROM growth_direction_control_revisions WHERE user_id=$1 AND scope='public_service'",[user])).rows
      assert.ok(snapshots.length>0)
      assert.ok(snapshots.every(row=>row.quote==='原话已遗忘'),'historical snapshots are redacted too — lineage is not a privacy bypass')
    })
  }finally{
    await pool.query('DELETE FROM growth_direction_control_revisions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_direction_controls WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_source_suppressions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_item_lineage WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_items WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_revisions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM runs WHERE user_id=$1',[user])
    await pool.query('DELETE FROM messages WHERE user_id=$1',[user])
    await pool.query('DELETE FROM conversations WHERE user_id=$1',[user])
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
  }
})

test.after(async()=>{await pool.end()})
import { scanUserClauses } from '../../server/user-command-spans.ts'

test('N1.1 audit cases: questions, conditionals and quotes never become pause settings',()=>{
  // A01: a question never executes; A05 keeps 为什么 answerable (not pure).
  assert.deepEqual(deriveExplicitDirectionControls('暂停考研吗？'),{status:'none'})
  assert.deepEqual(deriveExplicitDirectionControls('要不要暂停考研？'),{status:'none'})
  assert.deepEqual(deriveExplicitDirectionControls('你是不是要停止推考研建议？'),{status:'none'})
  // A02: conditional spans the comma; the realistic clause after the turn is valid.
  assert.deepEqual(deriveExplicitDirectionControls('如果压力太大，就暂停考研'),{status:'none'})
  assert.deepEqual(deriveExplicitDirectionControls('如果以后不考研了，先别推考研建议。'),{status:'none'})
  assert.equal(deriveExplicitDirectionControls('如果压力太大再说，现在先暂停考研建议。').status,'explicit')
  // Kept positives and attribution negatives.
  const pause=deriveExplicitDirectionControls('先暂停考研建议。')
  assert.equal(pause.status,'explicit')
  assert.deepEqual(deriveExplicitDirectionControls('朋友说：暂停考研'),{status:'none'})
  assert.equal(deriveExplicitDirectionControls('暂停考研建议。另外帮我安排课程。').status,'explicit')
  // Politeness question asks for confirmation instead of executing.
  assert.equal(deriveExplicitDirectionControls('请暂停考研建议，可以吗？').status,'needs_confirmation')
  // Backtick content is not a command.
  assert.deepEqual(deriveExplicitDirectionControls('代码：`先暂停考研` 不执行'),{status:'none'})
})
