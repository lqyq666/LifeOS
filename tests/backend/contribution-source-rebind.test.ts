import test from 'node:test'
import assert from 'node:assert/strict'
import {buildClauseCatalogue,reportedContribution,resolveProcessSourceHandles} from '../../server/clause-catalogue.ts'
import {personalActionClauses,personalContributionClauses,selectStructuralCandidate} from '../../server/experience-content.ts'
import {jointPersonalActorClause,otherActorClause,profileWritesDisallowed} from '../../server/user-command-spans.ts'

test('an embedded other action leaves only the complete owned outer action',()=>{
 const text='我整理了同学分析了数据的报告。结果未知。',catalogue=buildClauseCatalogue(text)
 const output=(actionQuote:string)=>({growthUpdates:[{target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote,skillTags:['数据分析'],resultRef:1}},{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c1'}}]})
 for(const quote of [catalogue[0]!.text,'我整理了']){
  const turn=output(quote)
  resolveProcessSourceHandles(turn,{messageId:'embedded-action',catalogue,text,canonicalFacts:true})
  const proof=reportedContribution(turn.growthUpdates[0]!)
  assert.equal(proof?.actionQuote,'我整理了')
  assert.deepEqual(proof?.skillTags,[])
  assert.equal(proof?.result,undefined)
 }
 for(const quote of ['整理了','同学分析了数据'])assert.throws(()=>resolveProcessSourceHandles(output(quote),{messageId:'embedded-action',catalogue,text,canonicalFacts:true}),/CONTRIBUTION_ACTOR_SOURCE_INVALID/)
})

test('an optional contribution without a proven actor cannot block the reply or a separate fact',()=>{
 const text='我的复习笔记全是整段抄书，考前翻不动。我这周有两小时。'
 const catalogue=buildClauseCatalogue(text)
 const output=()=>({reply:'下一页先用一个问题当标题，合上书后用自己的话答。',growthUpdates:[
  {target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:'整段抄书'}},
  {target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c2'}},
 ],event:{factRefs:[0,1]}})
 const context={messageId:'study-notes',catalogue,text,canonicalFacts:true}
 assert.throws(()=>resolveProcessSourceHandles(output(),context),/CONTRIBUTION_ACTOR_SOURCE_INVALID/)
 const turn=output()
 resolveProcessSourceHandles(turn,{...context,optionalContributions:true})
 assert.deepEqual(turn.growthUpdates,[output().growthUpdates[1]])
 assert.deepEqual((turn.event as unknown as {nodes:{source:{quote:string}}[]}).nodes.map(node=>node.source.quote),['我这周有两小时'])
 assert.equal(turn.reply,output().reply)
 const planTurn={...output(),weeklyPlan:{budgetRef:{updateIndex:1},basis:[{updateIndex:1}]}}
 resolveProcessSourceHandles(planTurn,{...context,optionalContributions:true})
 assert.deepEqual(planTurn.weeklyPlan,{budgetRef:{updateIndex:0},basis:[{updateIndex:0}]})
 const invalidPlan={...output(),weeklyPlan:{budgetRef:{updateIndex:1},basis:[{updateIndex:0}]}}
 assert.throws(()=>resolveProcessSourceHandles(invalidPlan,{...context,optionalContributions:true}),/CONTRIBUTION_ACTOR_SOURCE_INVALID/)
})

test('an ambiguous model action records its candidate ranges without claiming the whole clause',()=>{
 const action='分析了问卷数据',text='我先分析了问卷数据再分析了问卷数据并写了报告。',catalogue=buildClauseCatalogue(text)
 const fact={target:{operation:'create'},kind:'feedback',assertion:'user_reported',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:action}}
 resolveProcessSourceHandles({growthUpdates:[fact]},{messageId:'ambiguous-action',catalogue,text,canonicalFacts:true})
 const ranges=reportedContribution(fact)?.rejectedActionRanges
 assert.deepEqual(ranges,[text.indexOf(action),text.lastIndexOf(action)].map(start=>({start,end:start+action.length})))
 assert.ok(ranges!.every(range=>range.end<=text.indexOf('写了报告')))
})

test('a unique exact action in the same sentence rebinds a misplaced contribution source',()=>{
  const action='只把已保存资料的三列标题核对完了'
  const text='实际反馈：我只做了四分钟，'+action+'，没有分析；结果并没有帮我决定考研还是就业。'
  const catalogue=buildClauseCatalogue(text)
  const selected=catalogue.find(clause=>clause.text.includes('只做了四分钟'))!
  const actionClause=catalogue.find(clause=>clause.text===action)!
  assert.ok(selected)
  assert.ok(actionClause)
  assert.equal(selected.sentenceStart,actionClause.sentenceStart)

  const fact:any={
    target:{operation:'create'},
    assertion:'user_reported',
    kind:'feedback',
    progressState:'completed',
    source:{clauseId:selected.clauseId},
    contribution:{actor:'self',actionQuote:action,skillTags:['数据分析']},
  }
  resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true})

  assert.equal(fact.source.clauseId,actionClause.clauseId)
  assert.deepEqual(reportedContribution(fact),{
    actor:'unknown',
    actionQuote:'',
    pendingActionQuote:action,
    proposedActor:'self',
    skillTags:[],
    sourceQuote:action,
    sourceMessageId:'message-1',
    sourceClauseId:actionClause.clauseId,
    factQuote:action,
  })
})

test('a rebound source never confirms the performer from contextual ownership',()=>{
  const action='我整理了三份材料'
  const text='我完成了初稿，'+action+'。'
  const catalogue=buildClauseCatalogue(text)
  const selected=catalogue.find(clause=>clause.text==='我完成了初稿')!
  const actionClause=catalogue.find(clause=>clause.text===action)!
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:selected.clauseId},contribution:{actor:'self',actionQuote:action,skillTags:['数据分析']},
  }
  resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true})
  const contribution=reportedContribution(fact)!
  assert.equal(fact.source.clauseId,actionClause.clauseId)
  assert.equal(contribution.actor,'unknown')
  assert.equal(contribution.actionQuote,'')
  assert.equal(contribution.pendingActionQuote,action)
  assert.equal(contribution.proposedActor,'self')
  assert.deepEqual(contribution.skillTags,[])
})

test('source rebinding rejects cross-sentence, ambiguous and protected actions',()=>{
  const action='只把已保存资料的三列标题核对完了'
  const cases=[
    '实际反馈：我只做了四分钟。'+action+'。',
    '实际反馈：我只做了四分钟，'+action+'，后来又'+action+'。',
    '实际反馈：我只做了四分钟，“'+action+'”是同学原话。',
    '实际反馈：我只做了四分钟，我运行了`npm test`。',
    '实际反馈：我只做了四分钟，我引用了"'+action+'"。',
    '"背景，我只做了四分钟，'+action+'"',
    "'背景，我只做了四分钟，"+action+"'",
    '"背景 \\"示例\\"，我只做了四分钟，'+action+'"',
    "'背景 \\'示例\\'，我只做了四分钟，"+action+"'",
    '实际反馈：我只做了四分钟，'+action+'，同学原话是“'+action+'”。',
    '实际反馈：我只做了四分钟，先喝了水，'+action+'。',
    '实际反馈：我只做了四分钟，'+action+'。同学原话是“'+action+'”。',
    '实际反馈：我只做了四分钟. 后来，'+action+'。',
    '实际反馈：我只做了四分钟.2分钟后，'+action+'。',
    '实际反馈：我只做了四分钟．两分钟后，'+action+'。',
  ]
  for(const text of cases){
    const catalogue=buildClauseCatalogue(text)
    const selected=catalogue.find(clause=>clause.text.includes('只做了四分钟'))!
    const selectedAction=text.includes('npm test')?'我运行了`npm test`':action
    const fact:any={
      target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
      source:{clauseId:selected.clauseId},contribution:{actor:'self',actionQuote:selectedAction},
    }
    assert.throws(
      ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
      /CONTRIBUTION_ACTION_SOURCE_INVALID/,
      text,
    )
  }
})

test('source rebinding counts clauses omitted from the model catalogue',()=>{
  const action='只把已保存资料的三列标题核对完了'
  const text='实际反馈：我只做了四分钟，'+action+'。同学原话是“'+action+'”。'
  const complete=buildClauseCatalogue(text)
  const catalogue=complete.filter(clause=>clause.sentenceStart===complete[0]!.sentenceStart)
  const selected=catalogue.find(clause=>clause.text.includes('只做了四分钟'))!
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:selected.clauseId},contribution:{actor:'self',actionQuote:action},
  }
  assert.throws(
    ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
    /CONTRIBUTION_ACTION_SOURCE_INVALID/,
  )
})

test('source rebinding requires the complete original message',()=>{
  const action='只把已保存资料的三列标题核对完了'
  const text='实际反馈：我只做了四分钟，'+action+'。'
  const catalogue=buildClauseCatalogue(text)
  const selected=catalogue.find(clause=>clause.text.includes('只做了四分钟'))!
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:selected.clauseId},contribution:{actor:'self',actionQuote:action},
  }
  assert.throws(
    ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,canonicalFacts:true}),
    /CONTRIBUTION_ACTION_SOURCE_INVALID/,
  )
})

test('source rebinding rejects an explicitly named third-party performer',()=>{
  for(const actor of ['辅导员','项目负责人','陌生评委']){
    const action=actor+'整理了三份材料'
    const text='实际反馈：我只做了四分钟，'+action+'。'
    const catalogue=buildClauseCatalogue(text)
    const selected=catalogue.find(clause=>clause.text.includes('只做了四分钟'))!
    const fact:any={
      target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
      source:{clauseId:selected.clauseId},contribution:{actor:'self',actionQuote:action},
    }
    assert.throws(
      ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
      /CONTRIBUTION_ACTION_SOURCE_INVALID/,
      actor,
    )
  }
})

test('source rebinding rejects an action excerpt delegated to another performer',()=>{
  const action='把问卷发了'
  for(const prefix of ['我安排小王','我要求小王','我看到小王']){
    const text='我完成了复盘，'+prefix+action+'。'
    const catalogue=buildClauseCatalogue(text)
    const fact:any={
      target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
      source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
    }
    assert.throws(
      ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
      /CONTRIBUTION_ACTION_SOURCE_INVALID/,
      prefix,
    )
  }
})

test('source rebinding rejects unsafe lead clauses and performer claims inside the action',()=>{
  const cases=[
    {text:'如果这是小王的反馈，我整理了三份材料。',action:'我整理了三份材料'},
    {text:'我只做了四分钟，我看到小王把问卷发了。',action:'我看到小王把问卷发了'},
    {text:'我只做了四分钟，我安排了一个负责本周校园调研资料归档的小王把问卷发了。',action:'把问卷发了'},
    {text:'我完成了复盘，只把问卷委托小王发了。',action:'只把问卷委托小王发了'},
  ]
  for(const {text,action} of cases){
    const catalogue=buildClauseCatalogue(text)
    const fact:any={
      target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
      source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
    }
    assert.throws(
      ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
      /CONTRIBUTION_ACTION_SOURCE_INVALID/,
      text,
    )
  }
})

test('source rebinding keeps decimal, filename and domain periods inside one sentence',()=>{
  const action='只把已保存资料的三列标题核对完了'
  for(const detail of ['3.5分钟','report.md','example.com']){
    const text='实际反馈：我只做了'+detail+'，'+action+'。'
    const catalogue=buildClauseCatalogue(text)
    const selected=catalogue.find(clause=>clause.text.includes(detail))!
    const actionClause=catalogue.find(clause=>clause.text===action)!
    const fact:any={
      target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
      source:{clauseId:selected.clauseId},contribution:{actor:'self',actionQuote:action},
    }
    resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true})
    assert.equal(fact.source.clauseId,actionClause.clauseId,detail)
    assert.equal(reportedContribution(fact)?.actor,'unknown',detail)
  }
})

test('full-message ASCII quote scanning ignores escaped inner delimiters and word apostrophes',()=>{
  for(const text of ['"背景 \\"示例\\"，我只做了四分钟"',"'背景 \\'示例\\'，我只做了四分钟'"]){
    const catalogue=buildClauseCatalogue(text)
    assert.equal(catalogue.length,1,text)
    assert.equal(catalogue[0]?.quoted,true,text)
  }
  const ordinary=buildClauseCatalogue("I don't know, but I finished it.")
  assert.equal(ordinary.length,2)
  assert.ok(ordinary.every(clause=>!clause.quoted&&!clause.quoteSpans?.length))
})

test('source rebinding rejects suffix conditions and unpunctuated questions',()=>{
  const cases=[
    {text:'我完成了复盘的话，把问卷发了。',action:'把问卷发了'},
    {text:'我完成了复盘，把问卷发了没有。',action:'把问卷发了'},
  ]
  for(const {text,action} of cases){
    const catalogue=buildClauseCatalogue(text)
    const fact:any={
      target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
      source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
    }
    assert.throws(
      ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
      /CONTRIBUTION_ACTION_SOURCE_INVALID/,
      text,
    )
  }
})

test('source rebinding rejects exact third-party and delegated performance spans',()=>{
  const cases=[
    {text:'我完成了复盘，我协调了小王完成数据分析。',action:'小王完成数据分析'},
    {text:'我完成了复盘，把问卷交给小王发了。',action:'把问卷交给小王发了'},
    {text:'我完成了复盘，把问卷发了 by John。',action:'把问卷发了 by John'},
  ]
  for(const {text,action} of cases){
    const catalogue=buildClauseCatalogue(text)
    const fact:any={
      target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
      source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
    }
    assert.throws(
      ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
      /CONTRIBUTION_ACTION_SOURCE_INVALID/,
      text,
    )
  }
})

test('ASCII periods preserve real tokens but never join a letter to a later numeric sentence',()=>{
  const action='只把问卷发了'
  for(const detail of ['U.S.资料','Example.COM','README.MD','.env文件','.env.local文件','Ph.D.学位']){
    const text='我核对了'+detail+'，'+action+'。'
    const catalogue=buildClauseCatalogue(text)
    const selected=catalogue.find(clause=>clause.text.includes(detail))!
    const target=catalogue.find(clause=>clause.text===action)!
    const fact:any={
      target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
      source:{clauseId:selected.clauseId},contribution:{actor:'self',actionQuote:action},
    }
    resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true})
    assert.equal(fact.source.clauseId,target.clauseId,detail)
  }

  const text='我完成了draft.2 minutes later，'+action+'。'
  const catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
  }
  assert.throws(
    ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
    /CONTRIBUTION_ACTION_SOURCE_INVALID/,
  )
})

test('source rebinding accepts a unique safe action in either adjacent direction',()=>{
  const action='我整理了三份材料'
  const text=action+'，实际只做了四分钟。'
  const catalogue=buildClauseCatalogue(text)
  const selected=catalogue.find(clause=>clause.text.includes('只做了四分钟'))!
  const actionClause=catalogue.find(clause=>clause.text===action)!
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:selected.clauseId},contribution:{actor:'self',actionQuote:action},
  }
  resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true})
  assert.equal(fact.source.clauseId,actionClause.clauseId)
  assert.equal(reportedContribution(fact)?.pendingActionQuote,action)
})

test('a directly selected action keeps negative wording inside its quoted object',()=>{
  const action='我把“没做完”写进报告了'
  const text=action+'。'
  const catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
  }
  resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true})
  assert.equal(fact.progressState,'completed')
  assert.equal(reportedContribution(fact)?.actionQuote,action)
})

test('an inch mark cannot consume the next real opening quote',()=>{
  const catalogue=buildClauseCatalogue('我把画布裁成15", 同学说"他提交了报告"。')
  assert.equal(catalogue.length,2)
  assert.equal(catalogue[0]?.text,'我把画布裁成15"')
  assert.equal(catalogue[0]?.attributedToOther,false)
  assert.equal(catalogue[1]?.attributedToOther,true)
  assert.ok(catalogue[1]?.quoteSpans?.length)
})

test('source rebinding rejects a subjectless excerpt nested under another performer',()=>{
  const text='我完成了复盘，我协调了小王完成了数据分析。'
  const catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:'完成了数据分析'},
  }
  assert.throws(
    ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
    /CONTRIBUTION_ACTION_SOURCE_INVALID/,
  )
})

test('a leading context phrase does not turn an explicit first-person action into another actor',()=>{
  const action='在图书馆我完成了报告'
  const text=action+'。'
  const catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
  }
  resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true})
  assert.equal(reportedContribution(fact)?.actionQuote,action)
})

test('possessive words are not a suffix condition',()=>{
  const catalogue=buildClauseCatalogue('我记住了老师的话，把问卷发了。')
  assert.equal(catalogue.length,2)
  assert.ok(catalogue.every(clause=>!clause.conditional))
})

test('English self and method by-phrases remain personal actions',()=>{
  for(const suffix of ['by myself','by hand']){
    const action='我完成了报告 '+suffix
    const text=action+'。'
    const catalogue=buildClauseCatalogue(text)
    const fact:any={
      target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
      source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
    }
    resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true})
    assert.equal(reportedContribution(fact)?.actionQuote,action,suffix)
  }
})

test('an unrecognized no-space lowercase word after a period starts a new sentence',()=>{
  const action='我只把问卷发了'
  const text='我完成了draft.then I rested，'+action+'。'
  const catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
  }
  assert.throws(
    ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
    /CONTRIBUTION_ACTION_SOURCE_INVALID/,
  )
})

test('direct action sources reject attributed conditional and interrogative clauses',()=>{
  const cases=[
    {text:'同学说，我完成了报告。',action:'我完成了报告'},
    {text:'我完成初稿的话，我把问卷发了。',action:'我把问卷发了'},
    {text:'我把问卷发了没有。',action:'我把问卷发了没有'},
  ]
  for(const {text,action} of cases){
    const catalogue=buildClauseCatalogue(text)
    const clause=catalogue.find(candidate=>candidate.text.trim()===action)!
    const fact:any={
      target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
      source:{clauseId:clause.clauseId},contribution:{actor:'self',actionQuote:action},
    }
    assert.throws(
      ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
      /CONTRIBUTION_ACTION_SOURCE_INVALID/,
      text,
    )
  }
})

test('fictional leading context cannot become first-person evidence',()=>{
  const text='在同学编的故事里我完成了报告。'
  const catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:'我完成了报告'},
  }
  assert.throws(
    ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
    /CONTRIBUTION_ACTOR_SOURCE_INVALID/,
  )
})

test('bounded leading location context preserves explicit joint ownership',()=>{
  const text='在图书馆我和同学一起完成了报告。'
  const catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'joint',actionQuote:'我和同学一起完成了报告'},
  }
  resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true})
  assert.equal(reportedContribution(fact)?.actor,'joint')
})

test('scheduling without another performer remains a personal action',()=>{
  const action='我安排了本周任务并完成了初稿'
  const text=action+'。'
  const catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
  }
  resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true})
  assert.equal(reportedContribution(fact)?.actionQuote,action)
})

test('an initialism cannot absorb an arbitrary following English sentence',()=>{
  const action='我把问卷发了'
  const text='我查看了U.S.then I stopped，'+action+'。'
  const catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
  }
  assert.throws(
    ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
    /CONTRIBUTION_ACTION_SOURCE_INVALID/,
  )
})

test('arbitrary speaker possessives are not suffix conditions',()=>{
  const catalogue=buildClauseCatalogue('我记录了评委的话，把问卷发了。')
  assert.equal(catalogue.length,2)
  assert.ok(catalogue.every(clause=>!clause.conditional))
})

test('a whole-message quoted privacy opt-out remains authoritative',()=>{
  assert.equal(profileWritesDisallowed('“不要保存我的个人资料”'),true)
  assert.equal(profileWritesDisallowed('"不要保存我的个人资料"'),true)
  assert.equal(profileWritesDisallowed('“不要修改档案”只是示例，我昨天交了作业。'),false)
})

test('unsafe feedback anchors reject empty actions too',()=>{
  for(const text of ['如果我完成了报告的话。','同学说，我完成了报告。','我完成了报告没有。','“我完成了报告”。']){
    const catalogue=buildClauseCatalogue(text)
    const fact:any={
      target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'unattempted',
      source:{clauseId:catalogue.at(-1)!.clauseId},contribution:{actor:'unknown',actionQuote:''},
    }
    assert.throws(
      ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
      /CONTRIBUTION_ACTION_SOURCE_INVALID/,
      text,
    )
  }
})

test('a direct action cannot cross out of a protected span',()=>{
  const text='我记录了“同学完成了报告”并提交了记录。'
  const catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:'同学完成了报告”并提交了记录'},
  }
  assert.throws(
    ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
    /CONTRIBUTION_ACTION_SOURCE_INVALID/,
  )
})

test('fiction labels cannot be stripped as personal location context',()=>{
  const text='在虚构场景中我完成了报告。'
  const catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:'我完成了报告'},
  }
  assert.throws(
    ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
    /CONTRIBUTION_ACTOR_SOURCE_INVALID/,
  )
})

test('direct sources reject relational Chinese and English third-party performers',()=>{
  for(const action of ['我同事完成了报告','我把问卷交由小王去发了','我完成了报告 by my teammate']){
    const text=action+'。',catalogue=buildClauseCatalogue(text)
    const fact:any={
      target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
      source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
    }
    assert.throws(
      ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
      /CONTRIBUTION_ACTOR_SOURCE_INVALID/,
      action,
    )
  }
})

test('an explicit coordinated subject is joint without an extra adverb',()=>{
  const action='我和同学完成了报告',text=action+'。',catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
  }
  resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true})
  assert.equal(reportedContribution(fact)?.actor,'joint')

  const ownedObject='我和同学一起的报告整理完了',ownedText=ownedObject+'。',ownedCatalogue=buildClauseCatalogue(ownedText)
  const ownedFact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:ownedCatalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:ownedObject},
  }
  resolveProcessSourceHandles({growthUpdates:[ownedFact]}, {messageId:'message-2',catalogue:ownedCatalogue,text:ownedText,canonicalFacts:true})
  assert.equal(reportedContribution(ownedFact)?.actor,'self')
})

test('a trailing conversational particle keeps a negative question unsafe',()=>{
  const action='我把问卷发了没呀',text=action+'。',catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
  }
  assert.throws(
    ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
    /CONTRIBUTION_ACTION_SOURCE_INVALID/,
  )
})

test('a scheduling object cannot be invented as a Chinese delegate',()=>{
  assert.equal(otherActorClause('我安排了方案并完成了初稿'),false)
})

test('straight quotes distinguish possessives and Chinese-number measurements',()=>{
  const possessive="'students' work was submitted'，我完成了报告。"
  const possessiveCatalogue=buildClauseCatalogue(possessive)
  assert.equal(possessiveCatalogue[0]?.quoteSpans?.length,1)
  assert.deepEqual(possessiveCatalogue[0]?.quoteSpans?.[0],{start:0,end:possessive.indexOf('，')})

  const measurement='我把画布裁成十五", 同学说"他提交了报告"。'
  const measurementCatalogue=buildClauseCatalogue(measurement)
  assert.equal(measurementCatalogue[0]?.quoteSpans?.length,0)
  assert.equal(measurementCatalogue[1]?.quoteSpans?.length,1)
  assert.equal(measurementCatalogue[1]?.attributedToOther,true)
})

test('a selected third-party action cannot inherit ownership from its enclosing personal clause',()=>{
  const text='我记录了同学完成报告。',catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:'同学完成报告'},
  }
  assert.throws(
    ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
    /CONTRIBUTION_ACTOR_SOURCE_INVALID/,
  )
})

test('delegated Chinese names are bounded by the following action verb',()=>{
  assert.equal(otherActorClause('我安排王正完成报告'),true)
  assert.equal(otherActorClause('我安排了方案设计并完成了初稿'),false)
  assert.equal(otherActorClause('我安排了王者荣耀项目并完成了报告'),false,'a project title beginning with a family-name character is not a person')
  assert.equal(otherActorClause('我安排了小王者荣耀项目并完成了报告'),false,'a nickname-like project title is not a delegated person')
  assert.equal(selectStructuralCandidate('我安排了王者荣耀项目并完成了报告。',buildClauseCatalogue('我安排了王者荣耀项目并完成了报告。'),new Date().toISOString())?.content.action,'我安排了王者荣耀项目并完成了报告')
  assert.equal(otherActorClause('我请李老师指导我完成了报告'),false,'the named helper is not the performer after an explicit self actor')
  assert.equal(otherActorClause('我了解到李老师帮助我联系的同学完成了报告'),true,'a relative-clause actor after the helper remains the performer')
  assert.equal(otherActorClause('我了解到李老师帮助我提交了报告'),true,'a helper-mediated transfer is not explicit proof that the user performed it')
  assert.equal(otherActorClause('我请李老师指导我亲自提交了报告'),false,'explicit self performance outranks the helper-mediated transfer guard')
  assert.equal(otherActorClause('我委托小王替我完成了报告'),true,'替我 marks delegated third-party execution')
  assert.equal(otherActorClause('我委托王建中替我完成了报告'),true,'a complete Chinese name remains the delegate before 替我')
  assert.equal(otherActorClause('我让王建中按上次方法做了，为什么还是卡住了？'),true,'a complete three-character name remains the delegate before a bounded method phrase')
})

test('an observed ordinary noun cannot collide with a bare Chinese name',()=>{
  const text='我看到周报后完成了报告。',catalogue=buildClauseCatalogue(text)
  assert.equal(otherActorClause(text.slice(0,-1)),false)
  assert.deepEqual(personalActionClauses(catalogue).map(clause=>clause.text),[text.slice(0,-1)])
  assert.equal(selectStructuralCandidate(text,catalogue,new Date().toISOString())?.content.action,text.slice(0,-1))
})

test('an unlisted observed nickname cannot inherit the user performer',()=>{
  const text='我整理了目录，发现阿杰完成了报告。'
  assert.deepEqual(personalActionClauses(buildClauseCatalogue(text)).map(clause=>clause.text),['我整理了目录'])
  assert.equal(selectStructuralCandidate(text,buildClauseCatalogue(text),new Date().toISOString())?.content.action,'我整理了目录')
  const self='我整理了目录，发现自己完成了报告。'
  assert.deepEqual(personalActionClauses(buildClauseCatalogue(self)).map(clause=>clause.text),['我整理了目录','发现自己完成了报告'])
  const observedObject='我整理了目录，发现问题后完成了报告。'
  assert.deepEqual(personalActionClauses(buildClauseCatalogue(observedObject)).map(clause=>clause.text),['我整理了目录','发现问题后完成了报告'])
  const threeCharacterName='我整理了目录，发现王建中完成了报告。'
  assert.deepEqual(personalActionClauses(buildClauseCatalogue(threeCharacterName)).map(clause=>clause.text),['我整理了目录'])
  assert.equal(selectStructuralCandidate(threeCharacterName,buildClauseCatalogue(threeCharacterName),new Date().toISOString())?.content.action,'我整理了目录')
})

test('a method-prefixed clause cannot inherit ownership across an embedded performer',()=>{
  for(const text of ['我整理了目录，按照分工小王完成了报告。','我整理了目录，用现有材料小王完成了报告。','我整理了目录，按照分工欧阳娜娜完成了报告。','我整理了目录，按照分工王建中完成了报告。']){
    const actions=personalActionClauses(buildClauseCatalogue(text)).map(clause=>clause.text)
    assert.deepEqual(actions,['我整理了目录'],text)
    assert.equal(selectStructuralCandidate(text,buildClauseCatalogue(text),new Date().toISOString())?.content.action,'我整理了目录',text)
  }
  const own='我整理了目录，按照计划完成了报告。'
  assert.deepEqual(personalActionClauses(buildClauseCatalogue(own)).map(clause=>clause.text),['我整理了目录','按照计划完成了报告'])
  const describedPlan='我整理了目录，按照老师的计划完成了报告。'
  assert.deepEqual(personalActionClauses(buildClauseCatalogue(describedPlan)).map(clause=>clause.text),['我整理了目录','按照老师的计划完成了报告'])
  for(const possessiveMethod of ['我整理了目录，按照李老师的方法完成了报告。','我整理了目录，按照导师提供的模板完成了报告。','我整理了目录，按照李老师要求完成了报告。']){
    assert.deepEqual(personalActionClauses(buildClauseCatalogue(possessiveMethod)).map(clause=>clause.text),['我整理了目录',possessiveMethod.split('，')[1]!.slice(0,-1)],possessiveMethod)
  }
  const projectPlan='我整理了目录，按照项目计划完成了报告。'
  assert.deepEqual(personalActionClauses(buildClauseCatalogue(projectPlan)).map(clause=>clause.text),['我整理了目录','按照项目计划完成了报告'])
  const delegated='我按照分工让小王完成了报告。'
  assert.equal(otherActorClause(delegated.slice(0,-1)),true)
  assert.deepEqual(personalActionClauses(buildClauseCatalogue(delegated)),[])
})

test('guidance preserves an explicit self submission performer',()=>{
  assert.equal(otherActorClause('我请李老师指导我提交了报告'),false)
  assert.equal(selectStructuralCandidate('我请李老师指导我提交了报告。',buildClauseCatalogue('我请李老师指导我提交了报告。'),new Date().toISOString())?.content.action,'我请李老师指导我提交了报告')
  assert.equal(otherActorClause('我了解到李老师帮助我提交了报告'),true,'ambiguous helper-mediated transfer stays conservative')
  for(const text of ['李老师帮助我一起提交了报告。','李老师协助我共同交付了材料。']){
    assert.equal(otherActorClause(text.slice(0,-1)),false,text)
    assert.deepEqual(personalActionClauses(buildClauseCatalogue(text)).map(clause=>clause.text),[text.slice(0,-1)],text)
  }
})

test('a completed self action before delegation remains separate personal evidence',()=>{
  const text='我完成了初稿后让小王提交了报告。'
  const catalogue=buildClauseCatalogue(text)
  assert.deepEqual(catalogue.map(clause=>clause.text),['我完成了初稿','让小王提交了报告'])
  assert.deepEqual(personalActionClauses(catalogue).map(clause=>clause.text),['我完成了初稿'])
  assert.equal(selectStructuralCandidate(text,catalogue,new Date().toISOString())?.content.action,'我完成了初稿')
})

test('English performer attribution remains unsafe before trailing modifiers',()=>{
  assert.equal(otherActorClause('我完成了报告 by my teammate yesterday'),true)
})

test('a fictional personal role cannot become autobiographical after context stripping',()=>{
  const text='在课程中我扮演的角色完成了报告。',catalogue=buildClauseCatalogue(text)
  const fact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:'我扮演的角色完成了报告'},
  }
  assert.throws(
    ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
    /CONTRIBUTION_ACTOR_SOURCE_INVALID/,
  )
})

test('Chinese negative verb questions and negated ba clauses stay unsafe',()=>{
  for(const action of ['我把问卷发没发呀','我把问卷没发']){
    const text=action+'。',catalogue=buildClauseCatalogue(text)
    const fact:any={
      target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
      source:{clauseId:catalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:action},
    }
    if(catalogue[0]!.interrogative){
      assert.throws(
        ()=>resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true}),
        /CONTRIBUTION_ACTION_SOURCE_INVALID/,
        action,
      )
    }else{
      resolveProcessSourceHandles({growthUpdates:[fact]}, {messageId:'message-1',catalogue,text,canonicalFacts:true})
      assert.equal(reportedContribution(fact)?.actionQuote,'',action)
      assert.equal(fact.progressState,'unknown',action)
    }
  }
})

test('a closing ASCII quote is not discarded by an arbitrary following English word',()=>{
  const catalogue=buildClauseCatalogue("我转述了'我完成了tasks' sounds wrong。")
  assert.equal(catalogue[0]?.quoteSpans?.length,1)
})

test('a quoted whole-message privacy opt-out tolerates harmless trailing symbols',()=>{
  assert.equal(profileWritesDisallowed('“不要保存我的个人资料”🙏'),true)
  assert.equal(profileWritesDisallowed('"不要保存我的个人资料" :)'),true)
})

test('possessive passive subjects are not personal work and quantified partners stay joint',()=>{
  const passive='我和同学的报告被老师整理好了',passiveText=passive+'。',passiveCatalogue=buildClauseCatalogue(passiveText)
  const passiveFact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:passiveCatalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:passive},
  }
  assert.throws(
    ()=>resolveProcessSourceHandles({growthUpdates:[passiveFact]}, {messageId:'message-1',catalogue:passiveCatalogue,text:passiveText,canonicalFacts:true}),
    /CONTRIBUTION_ACTOR_SOURCE_INVALID/,
  )

  const joint='我和两个同学共同完成了报告',jointText=joint+'。',jointCatalogue=buildClauseCatalogue(jointText)
  assert.equal(jointPersonalActorClause(joint),true)
  const jointFact:any={
    target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',
    source:{clauseId:jointCatalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:joint},
  }
  resolveProcessSourceHandles({growthUpdates:[jointFact]}, {messageId:'message-2',catalogue:jointCatalogue,text:jointText,canonicalFacts:true})
  assert.equal(reportedContribution(jointFact)?.actor,'joint')
})

test('a final initialism period stays structural before a following English word',()=>{
  const catalogue=buildClauseCatalogue('我核对了Ph.D. degree，把问卷发了。')
  assert.deepEqual(catalogue.map(clause=>clause.text),['我核对了Ph.D. degree','把问卷发了'])
  assert.equal(catalogue[0]?.sentenceStart,catalogue[1]?.sentenceStart)
})

test('common recent-time modifiers still expose personal completed contributions',()=>{
  for(const text of ['我刚刚完成了报告。','我本周完成了报告。']){
    const catalogue=buildClauseCatalogue(text)
    assert.deepEqual(personalContributionClauses(catalogue).map(clause=>clause.text),[text.slice(0,-1)],text)
  }
})

test('owned method and finding clauses keep one completed personal action chain',()=>{
  const text='今天我在课程小组里负责整理传感器采样数据，用老师提供的脚本绘图，发现两处异常并标注出来。'
  assert.deepEqual(personalActionClauses(buildClauseCatalogue(text)).map(clause=>clause.text),['发现两处异常并标注出来'])

  const other='我整理了目录，发现同学完成了报告。'
  assert.ok(!personalActionClauses(buildClauseCatalogue(other)).some(clause=>clause.text==='发现同学完成了报告'))

  for(const report of ['我整理了目录，发现同学已经独立完成了报告。','我整理了目录，发现小王主动完成了报告。']){
    assert.ok(!personalActionClauses(buildClauseCatalogue(report)).some(clause=>clause.text.includes('完成了报告')),report)
    assert.equal(selectStructuralCandidate(report,buildClauseCatalogue(report),new Date().toISOString())?.content.action,'我整理了目录',report)
  }

  for(const [namedOther,actionQuote] of [
    ['我记录了王明完成报告。','王明完成报告'],
    ['我记录了王明在昨晚完成报告。','王明在昨晚完成报告'],
    ['我记录了王明在图书馆完成报告。','王明在图书馆完成报告'],
    ['我记录了王明用自己的电脑完成报告。','王明用自己的电脑完成报告'],
  ]){
    const namedCatalogue=buildClauseCatalogue(namedOther),namedClause=namedCatalogue[0]!
    const namedFact:any={target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:namedClause.clauseId},contribution:{actor:'self',actionQuote,skillTags:['材料整理']}}
    assert.throws(
      ()=>resolveProcessSourceHandles({growthUpdates:[namedFact]}, {messageId:'message-named-other',catalogue:namedCatalogue,text:namedOther,canonicalFacts:true}),
      /CONTRIBUTION_ACTOR_SOURCE_INVALID/,
      namedOther,
    )
  }

  const excludedEndingName='我记录了王建中完成报告。',excludedCatalogue=buildClauseCatalogue(excludedEndingName)
  assert.equal(otherActorClause('王建中完成报告',{allowOmittedSubject:true}),true,'an ambiguous three-character subject fails closed as another performer')
  const excludedFact:any={target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:excludedCatalogue[0]!.clauseId},contribution:{actor:'self',actionQuote:'王建中完成报告',skillTags:['材料整理']}}
  assert.throws(()=>resolveProcessSourceHandles({growthUpdates:[excludedFact]},{messageId:'message-excluded-ending-name',catalogue:excludedCatalogue,text:excludedEndingName,canonicalFacts:true}),/CONTRIBUTION_ACTOR_SOURCE_INVALID/)

  const delegatedPlan='我计划让小王先整理报告，再把附录写完了。',delegatedPlanCatalogue=buildClauseCatalogue(delegatedPlan)
  const delegatedAction=delegatedPlanCatalogue.find(clause=>clause.text==='再把附录写完了')!
  const delegatedPlanFact:any={target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:delegatedAction.clauseId},contribution:{actor:'self',actionQuote:delegatedAction.text}}
  assert.throws(()=>resolveProcessSourceHandles({growthUpdates:[delegatedPlanFact]},{messageId:'message-delegated-plan',catalogue:delegatedPlanCatalogue,text:delegatedPlan,canonicalFacts:true}),/CONTRIBUTION_ACTOR_SOURCE_INVALID/)

  const planned='我准备明天交报告，再把附录完成。'
  assert.deepEqual(personalActionClauses(buildClauseCatalogue(planned)).map(clause=>clause.text),[],planned)
  assert.equal(selectStructuralCandidate(planned,buildClauseCatalogue(planned),new Date().toISOString()),null,planned)
  const plannedCatalogue=buildClauseCatalogue(planned),plannedAction=plannedCatalogue.find(clause=>clause.text==='再把附录完成')!
  const plannedFact:any={target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:plannedAction.clauseId},contribution:{actor:'self',actionQuote:plannedAction.text,skillTags:['材料整理']}}
  resolveProcessSourceHandles({growthUpdates:[plannedFact]}, {messageId:'message-planned',catalogue:plannedCatalogue,text:planned,canonicalFacts:true})
  assert.equal(plannedFact.progressState,'unknown')
  assert.deepEqual(reportedContribution(plannedFact),{
    actor:'unknown',actionQuote:'',skillTags:[],sourceQuote:plannedAction.text,sourceMessageId:'message-planned',sourceClauseId:plannedAction.clauseId,factQuote:plannedAction.text,
  })

  for(const future of ['我将整理报告，再把附录写好。','我会整理报告，再把附录写好。','我还会整理报告，再把附录写好。','我目前计划整理报告，再把附录写好。']){
    assert.deepEqual(personalActionClauses(buildClauseCatalogue(future)).map(clause=>clause.text),[],future)
    assert.equal(selectStructuralCandidate(future,buildClauseCatalogue(future),new Date().toISOString()),null,future)
  }

  const checklist='上周我给课程任务整理了一个执行清单。我用纸笔写下两步，再把必须等同学确认的那一步单独标出来。'
  assert.ok(selectStructuralCandidate(checklist,buildClauseCatalogue(checklist),new Date().toISOString())?.content.action.includes('必须等同学确认'))

  const examples='前天我核对了学习笔记里的两道例题。我照着老师的解题过程逐行重算，发现一处单位换算错误，改完后又用原题条件验了一遍。'
  assert.ok(selectStructuralCandidate(examples,buildClauseCatalogue(examples),new Date().toISOString())?.content.action.includes('原题条件验了一遍'))

  const contact='我通过校内邮箱发了消息，他还没回复，把消息改短。'
  assert.equal(selectStructuralCandidate(contact,buildClauseCatalogue(contact),new Date().toISOString())?.quote,'我通过校内邮箱发了消息，他还没回复')

  const unresolved='实际反馈：我只做了四分钟，只把已保存资料的三列标题核对完了，没有分析。'
  assert.ok(!personalContributionClauses(buildClauseCatalogue(unresolved)).some(clause=>clause.text==='只把已保存资料的三列标题核对完了'))
})
