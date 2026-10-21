import test from 'node:test'
import assert from 'node:assert/strict'

test('a later substantive summary request overrides listening without inventing a task',()=>{
 assert.equal(currentConversationOnly('我只想聊聊，给我一句阶段理解。'),false)
 assert.equal(currentConversationOnly('给我一句阶段理解，但现在只想聊聊，不要总结。'),true)
 assert.equal(currentConversationOnly('我只想聊聊，朋友说给我一句阶段理解。'),true)
})
import {weeklyTimeIntent} from '../server/turn-obligations.ts'
import {scanUserClauses,parseExactHours,assistantRequestClause,responseRequestScope,currentConversationOnly} from '../server/user-command-spans.ts'

test('direct sentence-scoped understanding requests share the existing summary authority',()=>{
 for(const text of ['用一句话说明当前理解和仍未知的地方。','请只用一句话概括当前判断。','以一句表述当前理解。']){
  const scope=responseRequestScope(text);assert.equal(scope.summaryRequested,true,text);assert.equal(scope.sentenceLimit,1,text);assert.equal(scope.actionRequested,false,text)
 }
 for(const text of ['朋友说：“用一句话说明当前理解。”','如果我说“用一句话说明当前理解”，你会怎么回应？','我会用一句话说明自己当前的理解。','```\n用一句话说明当前理解\n```'])assert.equal(responseRequestScope(text).summaryRequested,false,text)
 assert.equal(responseRequestScope('用一段话说明当前理解。').sentenceLimit,undefined)
})
import {reportedPreferenceClauses,reportedPursuitClauses} from '../server/turn-contract.ts'

test('embedded content questions in an owned intention retain the stated goal and outcome',()=>{
 const text='不是因为老师要求；我会主动继续整理，主要想更快看出哪些信息关键，减少自己反复找东西的时间。我还不知道这是否只是一次偶然。'
 const expected=['主要想更快看出哪些信息关键','减少自己反复找东西的时间']
 assert.deepEqual(reportedPursuitClauses(text).map(c=>c.text),expected)
 for(const c of reportedPursuitClauses(text)){assert.equal(c.interrogative,false);assert.equal(text.slice(c.start,c.end),c.text)}
 assert.deepEqual(reportedPursuitClauses('我希望弄清哪些课程需要先修，避免自己重复报名。').map(c=>c.text),['我希望弄清哪些课程需要先修','避免自己重复报名'])
 for(const t of ['主要想更快看出哪些信息关键。','朋友说他会主动整理，主要想更快看出哪些信息关键。','如果我继续整理，主要想更快看出哪些信息关键。','我读到“我想更快看出哪些信息关键”。','我想更快看出哪些信息关键吗？','我整理完了，减少了找东西的时间。','我希望你告诉我哪些信息关键。','我整理过，哪些信息关键？'])assert.deepEqual(reportedPursuitClauses(t),[],t)
})

test('direct enjoyment and dislike remain owned preferences across source extraction',()=>{
 for(const quote of ['我并不享受考试本身','我不享受反复背诵','我享受做实验','我享受不了考试'])assert.deepEqual(reportedPreferenceClauses(quote+'。').map(c=>c.text),[quote])
 for(const text of ['室友说他不享受考试。','如果我不享受考试，该怎么办？','我读到“我不享受考试”。','我不享受什么你来猜。'])assert.deepEqual(reportedPreferenceClauses(text),[],text)
})

test('a requested startable step is an action request rather than a status-only reply',()=>{
 const scope=responseRequestScope('我可以导出PDF，今天只愿意做一个动作。请给能开始的一步，并说明何时停止。')
 assert.equal(scope.actionRequested,true);assert.equal(scope.actionLimit,1)
 assert.equal(responseRequestScope('今天不要给能开始的一步。').actionRequested,false)
})

test('a direct request to update judgment from new information is summary intent, not a personal report',()=>{
 const request='请根据新信息更新判断'
 assert.equal(assistantRequestClause(request),true)
 assert.equal(responseRequestScope(request).summaryRequested,true)
 assert.equal(responseRequestScope(request).actionRequested,false)
 for(const text of ['同学说：“'+request+'”','如果我说“'+request+'”，你会怎样回应？','```\n'+request+'\n```'])assert.equal(responseRequestScope(text).summaryRequested,false,text)
})

test('a trailing advice attribution is not the users own instruction',()=>{
 for(const actor of ['同学','朋友','老师']){
  const text='建议你联系导师的说法来自'+actor+'。'
  assert.equal(scanUserClauses(text)[0]?.attributedToOther,true,text)
 }
 for(const text of ['这个建议来自我。','这份材料来自同学。','这个说法不是来自同学。'])assert.equal(scanUserClauses(text)[0]?.attributedToOther,false,text)
})

test('action scope distinguishes embedded quotations, explicit plural and turn transitions',()=>{
 assert.equal(responseRequestScope('请根据新信息更新判断，并给一个下一步建议。').actionRequested,true)
 assert.equal(responseRequestScope('请根据新信息更新判断，并给一个下一步建议。').actionLimit,1)
 assert.equal(responseRequestScope('请复述“给一个本周能开始的小动作”。').actionRequested,false)
 for(const text of ['给两个本周能开始的小动作。','给2-3个验证动作。','给一项小行动。','朋友说先别做，但我现在请你给一个小动作。'])assert.equal(responseRequestScope(text).actionRequested,true,text)
 assert.equal(responseRequestScope('给两个本周能开始的小动作。').actionLimit,undefined)
 assert.equal(responseRequestScope('给一项小行动。').actionLimit,1)
 assert.equal(responseRequestScope('给21个验证动作。').actionLimit,undefined)
 assert.equal(responseRequestScope('请给我解释“行动”这个词的意思。').actionRequested,false)
 assert.equal(responseRequestScope('请给我两个本周能开始的小动作。').actionRequested,true)
 assert.equal(responseRequestScope('请解释“更新当前判断”这句话。').summaryRequested,false)
 assert.equal(responseRequestScope('招聘方说，只看一个岗位。').singleJobRequested,false)
})

test('mixed understanding and one small distinction method is an action request with one new attempt',()=>{
 const text='请给暂定理解和一个很小的区分办法。'
 assert.equal(assistantRequestClause(text.slice(0,-1)),true)
 const scope=responseRequestScope(text)
 assert.equal(scope.summaryRequested,true)
 assert.equal(scope.actionRequested,true)
 assert.equal(scope.actionLimit,1)
 assert.equal(responseRequestScope('请给一个很小的区分办法，同时安排两轮实验。').actionLimit,undefined,'an explicit multi-trial request is not silently reduced to one method')
 assert.equal(responseRequestScope('请安排两次尝试且每次只给一个行动验证。').actionLimit,undefined)
 for(const other of ['朋友说：'+text,'“'+text+'”','如果'+text])assert.equal(responseRequestScope(other).actionLimit,undefined,other)
})

test('an owned report of not knowing is declarative, while an explicit question remains a question',()=>{
 for(const text of ['但我还说不清自己要什么。','我不知道自己喜欢什么。','我不确定这是什么。'])assert.equal(scanUserClauses(text)[0]?.interrogative,false,text)
 for(const text of ['我不知道自己喜欢什么？','我不知道这样做可以吗。'])assert.equal(scanUserClauses(text)[0]?.interrogative,true,text)
})

test('explicit comparison is a delivery request, not an invented action or a quoted instruction',()=>{
 assert.equal(responseRequestScope('我想让你比较保研和就业。').comparisonRequested,true)
 assert.equal(responseRequestScope('请比较保研和就业。别给我比较了。').comparisonRequested,false)
 for(const text of ['请比较一个更低成本的探索方式。','帮我比较两种办法，不安排新任务。','能不能帮我对比这两个选项？']){
  const scope=responseRequestScope(text)
  assert.equal(scope.comparisonRequested,true,text)
  assert.equal(scope.actionRequested,false,text)
 }
 for(const text of ['朋友说：请比较两个选项。','如果我请你比较两个选项，会怎样？','“请比较两个选项”。','不要比较两个选项。','请比较两个选项，现在不要比较了。','请比较两个选项，但今天我只想聊聊。'])assert.equal(responseRequestScope(text).comparisonRequested,false,text)
 assert.equal(responseRequestScope('今天只想聊聊。现在请比较两种办法。').comparisonRequested,true)
})

test('summary cardinality is a current assistant instruction, not a personal fact or reported instruction',()=>{
 for(const text of ['只给一句阶段理解。','请只说一句当前判断。','先给我一句暂定总结。']){
  const scope=responseRequestScope(text)
  assert.equal(scope.summaryRequested,true)
  assert.equal(scope.sentenceLimit,1)
  assert.equal(scope.actionRequested,false)
  assert.equal(scope.instructions.length,1)
 }
 for(const text of ['朋友说：只给一句阶段理解。','如果我只给一句阶段理解，就结束。','“只给一句阶段理解”。','不要只给一句阶段理解。']){
  assert.equal(responseRequestScope(text).sentenceLimit,undefined)
 }
 assert.equal(responseRequestScope('请给一段当前总结。').summaryRequested,true)
 assert.equal(responseRequestScope('请给一段当前总结。').sentenceLimit,undefined)
})

test('only explicit own preferences are supplementable, never questions, examples or requests',()=>{
 assert.deepEqual(reportedPreferenceClauses('我主要在意能自己安排专注时间，不在意当老板，也不想承担找客户和收款。').map(clause=>clause.text),['我主要在意能自己安排专注时间','不在意当老板','也不想承担找客户和收款'])
 assert.deepEqual(reportedPreferenceClauses('我喜欢研究，室友更在意收入，也不喜欢加班。').map(clause=>clause.text),['我喜欢研究'])
 assert.deepEqual(reportedPreferenceClauses('我喜欢研究，朋友说他在意收入，也不喜欢加班。').map(clause=>clause.text),['我喜欢研究'])
 for(const text of ['不想承担额外沟通。','朋友说：我主要在意时间，也不想承担额外沟通。','如果我主要在意时间，也不想承担额外沟通怎么办？','我读到“我主要在意时间，也不想承担额外沟通”。'])assert.deepEqual(reportedPreferenceClauses(text),[],text)
 assert.deepEqual(reportedPreferenceClauses('我读到‘我喜欢研究’。'),[])
 const quote='我主要在意能自己安排一天中专注工作的时间'
 assert.deepEqual(reportedPreferenceClauses(quote+'。').map(clause=>clause.text),[quote])
 for(const text of ['如果'+quote+'，再说。','朋友说，'+quote+'。','“'+quote+'”','`'+quote+'`',quote+'吗？','我喜欢怎么安排你来猜。','请帮我分析偏好。'])assert.deepEqual(reportedPreferenceClauses(text),[],text)
})

test('actual UI action and interpretation instructions are not autobiographical context',()=>{
 for(const instruction of ['请更新判断','请只重开受这条更正影响的判断','请更新这段经历的局部理解','给一个四小时内的小验证','请比较一个更低成本的探索方式'])assert.equal(assistantRequestClause(instruction),true,instruction)
 for(const instruction of ['不生成任务','保留未知','不要用一次疲惫推翻之前的感受','这周不再安排任务'])assert.equal(assistantRequestClause(instruction),true,instruction)
 for(const instruction of ['不删除刚才查过的事实','说明当前暂定理解和仍未知的地方','依据这条反馈更新“自由”的理解','也不要把主要节点数量当人生价值排名','不要自动重开'])assert.equal(assistantRequestClause(instruction),true,instruction)
 for(const fact of ['我更新了课程表','我调整了每周的预算','老师更新判断后回复了我'])assert.equal(assistantRequestClause(fact),false,fact)
 assert.equal(assistantRequestClause('请按我的实际情况帮我选一个能做的最小行动'),true)
 assert.equal(assistantRequestClause('不要把做过工具当作适合创业的证明'),true)
 assert.equal(assistantRequestClause('我想先了解就业实习'),false)
 assert.equal(assistantRequestClause('那就用那个贡献核对方法吧'),true)
 assert.equal(assistantRequestClause('我不会把一次付款当作稳定收入'),false)
 assert.equal(assistantRequestClause('请重新基于我已保存的具体依据给出可修改的暂定理解'),true)
 assert.equal(assistantRequestClause('这个动作要说明验证什么'),true)
 assert.equal(assistantRequestClause('看到什么算有进展'),true)
 assert.equal(assistantRequestClause('何时停止'),true)
 assert.equal(assistantRequestClause('不要再让我复述两段经历'),true)
})

// N1.1/N1.2 behavioral red→green suite: the audit cases from AUDIT_EVIDENCE §3
// asserted against the live detectors. Questions never become settings,
// conditionals never become facts, 1.5h is 90 minutes, and 为什么 must be
// answered instead of being swallowed by a "pure control" shortcut.

test('A03/A04 exact hours and period inheritance',()=>{
  assert.deepEqual(weeklyTimeIntent('我每周1.5小时。'),{quote:'我每周1.5小时',minutes:90,period:'current'},'1.5小时=90分钟')
  assert.deepEqual(weeklyTimeIntent('我每周0.5小时。'),{quote:'我每周0.5小时',minutes:30,period:'current'})
  assert.deepEqual(weeklyTimeIntent('我每周0小时。'),{quote:'我每周0小时',minutes:0,period:'current'},'零投入不伪造不忽略')
  assert.deepEqual(weeklyTimeIntent('每周1.75小时'),{quote:'每周1.75小时',minutes:105,period:'current'})
  const next=weeklyTimeIntent('下周，每周只有2小时。')
  assert.deepEqual({...next},{quote:'每周只有2小时',minutes:120,period:'next_week'},'周期从同句前置分句继承')
  assert.deepEqual(weeklyTimeIntent('这周先按每周4小时安排'),{quote:'这周先按每周4小时安排',minutes:240,period:'this_week'})
  // kept positives and negatives
  assert.deepEqual(weeklyTimeIntent('我每周只有3小时了，安排帮我改一下。'),{quote:'我每周只有3小时了',minutes:180,period:'current'})
  assert.equal(weeklyTimeIntent('做作品花了3小时。'),null,'花费时长不是每周预算')
  assert.equal(weeklyTimeIntent('室友每周3小时。'),null)
  assert.equal(weeklyTimeIntent('我不是每周只有3小时。'),null)
  assert.equal(weeklyTimeIntent('这周剩3小时，不是以后每周3小时。'),null,'剩余预算本批不覆盖weekly记录')
  assert.equal(weeklyTimeIntent('我每周大概4小时吧。'),null)
  assert.equal(weeklyTimeIntent('我每周至少3小时。'),null)
  assert.equal(weeklyTimeIntent('我每周3到4小时。'),null)
})

test('parseExactHours returns exact integer minutes only',()=>{
  assert.equal(parseExactHours('1.5'),90)
  assert.equal(parseExactHours('0.5'),30)
  assert.equal(parseExactHours('0'),0)
  assert.equal(parseExactHours('1.75'),105)
  assert.equal(parseExactHours('三'),180)
  assert.equal(parseExactHours('两'),120)
  assert.equal(parseExactHours('一小时半'),90)
  assert.equal(parseExactHours('一个半小时'),90)
  assert.equal(parseExactHours('1.555'),null,'超过两位小数不解析成近似值')
  assert.equal(parseExactHours('-1'),null)
  assert.equal(parseExactHours('很多'),null)
  assert.equal(parseExactHours(''),null)
})

test('scanUserClauses keeps absolute offsets, quotes, code and sentence facts',()=>{
  const text='如果压力太大，就暂停考研。朋友说：“先别推升学”。'
  const clauses=scanUserClauses(text)
  assert.ok(clauses.length>=3)
  for(const clause of clauses){
    assert.equal(text.slice(clause.start,clause.end),clause.text,'offsets are absolute')
    assert.ok(clause.end>=clause.sentenceStart&&clause.sentenceEnd>=clause.end)
  }
  const conditional=clauses.find(clause=>clause.text.includes('就暂停考研'))!
  assert.equal(conditional.conditional,true,'条件状态跨逗号延续到同句后续分句')
  const reported=clauses.find(clause=>clause.text.includes('先别推升学'))!
  assert.equal(reported.attributedToOther,true,'转述范围不因逗号丢失')
  assert.equal(scanUserClauses('“先别推升学相关安排”')[0]!.quoted,true,'纯引号分句是引用')
  assert.ok(scanUserClauses('如果压力太大再说，现在先暂停考研建议。').find(clause=>clause.text.includes('现在先暂停'))!.conditional===false,'转折/现实陈述重置条件')
  const nextSentence=clauses.filter(clause=>clause.sentenceStart>conditional.sentenceStart)
  assert.ok(nextSentence.every(clause=>!clause.conditional),'句级终止后条件重新判断')
  const interrogative=scanUserClauses('暂停考研吗？')
  assert.equal(interrogative[0]!.interrogative,true,'问句在原始句子上判定')
  assert.equal(scanUserClauses('按我提供的作品分工，我负责哪些部分，哪些不能算在我身上？')[1]!.interrogative,true,'an earlier clause in a compound recall question is still a question')
  assert.equal(scanUserClauses('我想了解哪些方向符合我的约束。')[0]!.interrogative,false,'a plan to learn is not a direct question')
  assert.equal(scanUserClauses('我负责排版，我承担哪些其他任务？')[0]!.interrogative,false,'the preceding actual fact remains a fact')
})
