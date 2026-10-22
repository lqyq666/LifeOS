import test from 'node:test'
import {openUnreportedChoiceQuestion} from '../server/reply-draft.ts'
import {softenSingleObservationCausality,ownedOpenDefinitionQuestion} from '../server/reply-draft.ts'
import assert from 'node:assert/strict'
import { openingQuestionDraft, safeEarlySentence, weeklyPlanBoundaryDraft, weeklyPlanDraft, groundedStateReadback, groundedFeedbackPreview, requestsOnlyStateReadback, retainsDraftText } from '../server/reply-draft.ts'

test('a positively owned definition question opens the same topic in streamed and final text',()=>{
 const user='我想要自由，但不知道自由具体意味着什么。先暂停创业，只问我一个问题。'
 const question='你说的“自由”具体是指时间上的自主安排，还是经济上不被固定工作绑定？'
 const expected='你说的“自由”具体指什么？'
 assert.equal(openingQuestionDraft(JSON.stringify({lead:question}),'lead',user),expected)
 assert.equal(openUnreportedChoiceQuestion(question,user),expected)
 for(const denied of ['我不要自由','朋友追求自由','我不追求自由','我想要的不是自由'])assert.notEqual(openingQuestionDraft(JSON.stringify({lead:question}),'lead',denied),expected)
 assert.equal(openingQuestionDraft(JSON.stringify({reply:'你是想就业还是想考研？'}),'reply','我不知道做什么。'),null)
})

test('a chat acknowledgement prefix cannot hide a substantive sourced correction or a write receipt',()=>{
 const user='更正：少问一次只是结果，真正让我轻松的是不用反复找。请根据更正更新判断。'
 assert.equal(safeEarlySentence(JSON.stringify({lead:'更正已收到：少问一次只是结果，你当时真正轻松的是自己不用反复找。'}),120,'lead',user),'少问一次只是结果，你当时真正轻松的是自己不用反复找')
 for(const receipt of ['已保存：少问一次只是结果','已更正记忆：少问一次只是结果'])assert.equal(safeEarlySentence(JSON.stringify({lead:receipt+'。'}),120,'lead',user),null)
})

test('a count-change judgment preview preserves the observation and its causal limit',()=>{
 const text='接着整理资料的探索。最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。请根据新信息更新判断，不要重复问已经回答的内容。'
 const preview=groundedFeedbackPreview(text)
 assert.match(preview!,/少问了我一次/)
 assert.match(preview!,/原因仍未知/)
 for(const prefix of ['朋友说：','如果','“'])assert.equal(groundedFeedbackPreview(prefix+text+(prefix==='“'?'”':'')),null,prefix)
 assert.equal(groundedFeedbackPreview('请根据新信息更新判断。是否少问了我一次？'),null)
 assert.equal(groundedFeedbackPreview('第二天20秒找到通知。请根据新信息更新判断。'),null,'elapsed time alone does not imply a decrease')
 const repaired=softenSingleObservationCausality('新信息支持分类规则让同学少问一次。固定会议仍会打断专注。',text)!
 assert.match(repaired,/「少问了我一次」/)
 assert.match(repaired,/固定会议可能会打断专注/)
 assert.doesNotMatch(repaired,/支持分类规则让/)
 assert.equal(ownedOpenDefinitionQuestion('你说的“自由”具体指什么？','我想要自由。'),true)
 for(const source of ['我想要的不是自由','朋友说我想要自由','我对自由没兴趣'])assert.equal(ownedOpenDefinitionQuestion('你说的“自由”具体指什么？',source),false,source)
})

test('draft retention requires actual final content, not a distinct preview or empty heading',()=>{
 assert.equal(retainsDraftText('两次均报告放松。来源仍未知。','两次均报告放松'),true)
 assert.equal(retainsDraftText('两次均报告“放松”。','两次均报告放松。'),true)
 assert.equal(retainsDraftText('没有找到已保存的标签。','已移除错误标签'),false)
 assert.equal(retainsDraftText('来源仍未知。','来源是运动'),false)
 assert.equal(retainsDraftText('来源仍未知。','。'),false)
})

test('question previews use the same unverified external-status boundary as sentence previews',()=>{
 for(const claim of ['你最近一次被导师拒绝是什么时候？','你被同学否定后，准备怎么做？','导师已读后，你想怎么做？']){
  const raw=JSON.stringify({lead:claim,reply:claim})
  assert.equal(openingQuestionDraft(raw,'lead'),null)
  assert.equal(openingQuestionDraft(raw),null)
  assert.equal(safeEarlySentence(raw),null)
 }
 assert.equal(openingQuestionDraft(JSON.stringify({reply:'你希望这次交流改变什么？'})),'你希望这次交流改变什么？')
})

test('an explicitly unknown stability is not an affirmative stability claim',()=>{
 for(const sentence of ['这种放松是否稳定仍未知','稳定性尚未确认','稳定效果仍未知','稳定对你的重要性尚不明确']){
  assert.equal(safeEarlySentence(JSON.stringify({reply:sentence+'。'})),sentence,sentence)
 }
 for(const sentence of ['这是稳定的放松感，原因仍未知','稳定效果已验证，但原因未知','你的稳定偏好持续存在，来源未知']){
  assert.equal(safeEarlySentence(JSON.stringify({reply:sentence+'。'})),null,sentence)
 }
})

test('announcing the number of options is framing, not effective first content',()=>{
 const heading='在每周最多两小时、不找客户不收款的前提下，可比较的更低成本探索方式主要有两类。'
 assert.equal(safeEarlySentence(JSON.stringify({reply:heading})),null)
 assert.equal(safeEarlySentence(JSON.stringify({reply:heading+'方式一：有现成学习记录时先整理其中已做过的事情。'})),'方式一：有现成学习记录时先整理其中已做过的事情')
})

test('early questions cannot expose unreported alternatives through either preview lane',()=>{
 const choice='你想确认的是网盘还是网页？'
 for(const user of ['朋友问：‘你要网盘还是网页？’','我读到‘网盘还是网页’。','如果选择网盘还是网页，会怎样？'])assert.notEqual(openUnreportedChoiceQuestion(choice,user),null,user)
 assert.notEqual(openUnreportedChoiceQuestion('你想确认的是考研还是就业？','我想比较‘考研’，还是我读到‘就业’。'),null)
 const question='你考虑考研时，最想获得的是“更多准备时间”，还是“一个具体方向”？'
 const raw=JSON.stringify({lead:question,reply:question})
 const user='我不确定为什么要考研。'
 assert.equal(openingQuestionDraft(raw,'lead',user),null)
 assert.equal(openingQuestionDraft(raw,'reply',user),null)
 assert.equal(safeEarlySentence(raw,120,'lead',user),null)
 assert.equal(safeEarlySentence(raw,120,'reply',user),null)
 assert.equal(openingQuestionDraft(raw,'reply','我想比较更多准备时间和一个具体方向'),question)
})

test('category questions drop parenthetical answer choices but preserve the actual unknown and final explanation',()=>{
 const question='你发的是哪种链接（网盘、在线文档还是网页），对方有没有提到具体提示？'
 const opened='你发的是哪种链接，对方有没有提到具体提示？'
 const explanation='先辨认访问条件，不推断内容好坏。'
 assert.equal(openUnreportedChoiceQuestion(question+explanation,'先处理访问条件。'),opened+explanation)
 const raw=JSON.stringify({lead:question,reply:question+explanation})
 assert.equal(openingQuestionDraft(raw,'lead','先处理访问条件。'),opened)
 assert.equal(openingQuestionDraft(raw,'reply','先处理访问条件。'),opened)
 assert.equal(safeEarlySentence(raw,120,'reply','先处理访问条件。'),opened.slice(0,-1))
 assert.equal(openUnreportedChoiceQuestion('对方问：“你要哪种链接（网盘还是网页）？”','先处理访问条件。'),null)
 const owned='哪种链接（网盘还是网页）？'
 assert.equal(openUnreportedChoiceQuestion(owned,'我的链接可能是网盘还是网页。'),null)
 assert.equal(openingQuestionDraft(JSON.stringify({reply:owned}),'reply','我的链接可能是网盘还是网页。'),owned)
})

test('zero-generation state recall cannot absorb new reports, mixed requests or hypotheticals',()=>{
 const request='请把已发、已读、已回复、是否采用、实际效果分开说，只更新相关理解，不安排催促。'
 assert.equal(requestsOnlyStateReadback(request),true)
 for(const text of ['我发了PDF。'+request,'导师确认读到。'+request,request+'请给一个行动。',request+'如果没回复怎么办？','如果有空，'+request,'“'+request+'”','已发、已读、已回复、是否采用、实际效果分别都是肯定。',request+'请解释老师为何没有回复。'])assert.equal(requestsOnlyStateReadback(text),false,text)
})
import { bindPlanBudgetSchema, deriveTurnContract } from '../server/turn-contract.ts'

test('verified five-state recall never upgrades uncertain or explicitly negative reading',()=>{
 const ask='请把已发、已读、已回复、是否采用、实际效果分开说。'
 for(const report of ['不知道导师有没有读到，也没回复。','导师还没有读到，也没有回复。']){
  const reply=groundedStateReadback(report+ask,['我把PDF发给导师了'])
  assert.ok(reply)
  assert.doesNotMatch(reply,/导师确认读到/)
  assert.match(reply,report.startsWith('不知道')?/已读：未知/:/已读：.*未读/)
 }
})

test('state request labels with an actor are instructions, and uncertain participant reports remain uncertain',()=>{
 const ask='请把已发、已读、已回复、是否采用、实际效果分开说。'
 const prior=['我把PDF发给导师了']
 for(const text of ['导师说可能已经读过。'+ask,'导师确认可能读到。'+ask,'导师似乎已读。'+ask,'请把已发、导师已读、已回复、是否采用、实际效果分别列出。']){
  const result=groundedStateReadback(text,prior)
  assert.ok(result)
  assert.match(result,/已读：未知/)
  assert.doesNotMatch(result,/导师确认读到/)
 }
})

test('canonical five-state readback uses the shared outcome projection for every reported dimension',()=>{
 const ask='请把已发、已读、已回复、是否采用、实际效果分开说。'
 const prior=['我把PDF发给导师了']
 for(const text of ['导师没有确认读到。','导师没有说他读过。','我不知道导师是否确认收到。']){
  const out=groundedStateReadback(text+ask,prior)!
  assert.match(out,/已读：未知/)
  assert.doesNotMatch(out,/确认收到|报告未读/)
 }
 const reply=groundedStateReadback('导师回复说还没读。'+ask,prior)!
 assert.match(reply,/已读：.*未读/)
 assert.doesNotMatch(reply,/已回复：未知/)
 const adopted=groundedStateReadback('导师已经采用其中两条建议。'+ask,prior)!
 assert.doesNotMatch(adopted,/是否采用：未知/)
 assert.match(adopted,/两条建议/)
 const effect=groundedStateReadback('导师说用了但没有效果。'+ask,prior)!
 assert.doesNotMatch(effect,/实际效果：未反馈|实际效果：未知/)
 assert.match(effect,/没有效果/)
})

test('explicit multiple recipients including pronouns never share a canonical five-state result',()=>{
 const ask='请把已发、已读、已回复、是否采用、实际效果分开说。'
 for(const prior of ['我把PDF发给导师和对方了。','我给导师和他发了PDF。']){
  assert.equal(groundedStateReadback('导师说读过，对方说还没读。'+ask,[prior]),null)
 }
})

test('slim real framing prefixes wait for substantive content rather than fake first content',()=>{
  for(const prefix of ['这是一句可直接复制的简短消息，发送前请自行核对老师姓名和课程名称：','围绕最近一次实际选课经历，可以这样问：']){
    assert.equal(safeEarlySentence(JSON.stringify({reply:prefix+'\n\n'})),null)
    const content='你最近一次选课时，具体是怎么决定选哪门课的？'
    assert.equal(safeEarlySentence(JSON.stringify({reply:prefix+'\n\n'+content})),content.slice(0,-1))
  }
  assert.equal(safeEarlySentence(JSON.stringify({reply:'105分钟按作业60、复习30、缓冲15分配。'})),'105分钟按作业60、复习30、缓冲15分配')
  assert.equal(safeEarlySentence(JSON.stringify({reply:'围绕最近一次选课，先核对课程的先修要求。'})),'围绕最近一次选课，先核对课程的先修要求')
  const substantial='这是一条把105分钟分成作业60、复习30、缓冲15的安排消息：'
  assert.equal(safeEarlySentence(JSON.stringify({reply:substantial+'\n\n'})),substantial)
  for(const unsafe of ['方案已完成。','这是一句可直接复制的简短消息，已为你发送：\n\n','围绕你有焦虑症、必须马上停课的判断，可以这样说：\n\n','这是一条已经替你发送成功的消息：\n\n']){
    assert.equal(safeEarlySentence(JSON.stringify({reply:unsafe+'接下来先核对课程的先修要求。'})),null)
  }
})

test('a streamed weekly plan becomes useful first content only after its bounded allocation is complete',()=>{
 const expected={period:'this_week',availableMinutes:120,allowedActions:['课程作业','复习'],mustLeaveSlack:true}
 assert.equal(weeklyPlanDraft({period:'this_week',availableMinutes:120,items:[{action:'课程作业',minutes:40},{action:'复习',minutes:40}]},expected),'先安排课程作业40分钟、复习40分钟，保留40分钟未安排')
 for(const value of [
  {period:'this_week',availableMinutes:120,items:[{action:'课程作业',minutes:60},{action:'复习',minutes:60}]},
  {period:'this_week',availableMinutes:120,items:[{action:'联系学长',minutes:40}]},
  {period:'next_week',availableMinutes:120,items:[{action:'课程作业',minutes:40}]},
  {period:'this_week',availableMinutes:120,items:[{action:'课程作业',minutes:121}]},
 ])assert.equal(weeklyPlanDraft(value,expected),null)
})

test('server-owned weekly plan boundaries can surface before provider allocation without inventing minutes',()=>{
 const boundary=weeklyPlanBoundaryDraft({period:'this_week',availableMinutes:120,allowedActions:['课程作业','复习'],mustLeaveSlack:true})
 assert.equal(boundary,'本周120分钟只安排课程作业和复习，并保留未安排时间')
 assert.equal(safeEarlySentence(JSON.stringify({reply:boundary+'。'})),boundary,'HTTP draft guard accepts the normalized sentence')
 assert.equal(weeklyPlanBoundaryDraft({period:'next_week',availableMinutes:90,allowedActions:['整理作品'],mustLeaveSlack:false}),'下周90分钟只安排整理作品')
 assert.equal(weeklyPlanBoundaryDraft({period:'this_week',availableMinutes:120,mustLeaveSlack:true}),null,'an open task lane still waits for the validated provider allocation')
 assert.equal(weeklyPlanBoundaryDraft({period:'this_week',availableMinutes:0,allowedActions:['课程作业'],mustLeaveSlack:false}),null)
})

test('bounded weekly plan is first in both schema properties and required order',()=>{
 const text='这周还剩两小时，帮我安排课程作业和复习，不要全排满。'
 const base=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:true,material:false})
 const schema=bindPlanBudgetSchema(base,{minutes:120,period:'this_week'},text,[]).schema as {properties:Record<string,unknown>;required:string[]}
 assert.equal(Object.keys(schema.properties)[0],'weeklyPlan')
 assert.equal(schema.required[0],'weeklyPlan')
})

test('progressive JSON decoding waits for a complete question and handles split escapes',()=>{
  const raw=JSON.stringify({reply:'你想先处理哪一步？然后我们再看。',event:{}})
  for(let i=0;i<raw.indexOf('？')+1;i++)assert.equal(openingQuestionDraft(raw.slice(0,i)),null)
  assert.equal(openingQuestionDraft(raw),'你想先处理哪一步？')
  assert.equal(openingQuestionDraft('{"reply":"你想先处理哪一步\\uFF1'),null)
  assert.equal(openingQuestionDraft('{"reply":"你想先处理哪一步\\uFF1F'),'你想先处理哪一步？')
})

test('quoted noun phrases and neutral confirmation syntax do not expose quoted questions or unvalidated status',()=>{
  for(const question of ['先确认一下具体是哪件事：你说的“上次的行动”是什么？','那当时你是通过什么方式发给他的？','我想再确认一个时间点：是在考试前还是考试后？','能具体说说“没有使用”是指什么吗？']){
    const raw=JSON.stringify({reply:question})
    assert.equal(openingQuestionDraft(raw),question)
    assert.equal(openingQuestionDraft(raw.slice(0,raw.lastIndexOf('？'))),null)
  }
  for(const reply of ['示例“你想说什么？”不是实际问句。','你说的“哪个人？”','你说的『哪个人？』','你说的‘哪个人？’','你说的`哪个人？`','那你已经为你保存的材料是什么？','先确认一下：你有焦虑症吗？','先确认一下：<a>材料</a>是哪份？'])assert.equal(openingQuestionDraft(JSON.stringify({reply})),null)
})
test('claims, reasoning, nested JSON, cited content and material do not become preliminary replies',()=>{
  for(const raw of [
    '{"thinking":"你想先处理哪一步？","reply":"你想先处理哪一步？"}',
    '{"event":{"reply":"你想先处理哪一步？"}}',
    '{"reply":"你有焦虑症。你想先处理哪一步？"}',
    '{"reply":"已保存。你想先处理哪一步？"}',
    '{"reply":"你想因为性格问题去治疗吗？"}',
    '{"reply":"你想按照[资料]处理吗？"}',
    '{"reply":"可以说说https://example.invalid吗？"}',
    '{"reply":"你上次做了什么导致他拒绝你？"}',
    '{"reply":"你当时有没有[研究支持]？"}',
    '{"reply":"你这次是怎么已发送材料的？"}',
    '{"reply":"你当时已经发了资料，所以他拒绝了你？"}',
  ])assert.equal(openingQuestionDraft(raw),null,raw)
})

test('a heading is not substantive first content',()=>{
  assert.equal(safeEarlySentence('{"reply":"先比较两种低成本探索方式。方式A是观察记录。"}'),'方式A是观察记录')
  assert.equal(safeEarlySentence('{"reply":"先按四小时排一个探索动作。方式A是观察记录。"}'),'方式A是观察记录')
  assert.equal(safeEarlySentence('{"reply":"先确认导师是否已读。链接能打开只说明技术可用。"}'),'链接能打开只说明技术可用')
})

test('a five-state readback is rendered only from user-reported values',()=>{
  const user='请把已发、已读、已回复、是否采用、实际效果分开说，只更新相关理解，不安排催促。'
  const prior=['我发了PDF，导师确认已经读到，但还没有说是否采用其中建议，也没有给效果反馈。']
  assert.equal(groundedStateReadback(user,prior),'已发：PDF已发送。已读：导师确认读到。已回复：导师确认读到。是否采用：未说明。实际效果：未反馈。')
  assert.equal(groundedStateReadback(user,['导师已经读到并采用了建议，效果很好。']),null)
  assert.equal(groundedStateReadback('请把状态分开说。',prior),null)
  const feedback='回来反馈：我发了PDF，导师确认已经读到，但还没有说是否采用其中建议，也没有给效果反馈。'
  const feedbackOut=groundedStateReadback(feedback,[])
  assert.match(feedbackOut??'',/已发：PDF已发送/)
  assert.match(feedbackOut??'',/是否采用：未说明/)
  assert.match(feedbackOut??'',/当前缺口/)
  assert.doesNotMatch(feedbackOut??'',/但未评价内容/)
  assert.match(feedbackOut??'',/是否评价内容未报告/)
  assert.equal(groundedStateReadback('我是成年大学生，方向暂定找产品实习。我把作品集链接发给导师了，对方还没回复。请复盘真正影响下一步的缺口，不要把未回复说成不采用。',[]),null)
  const link='链接在电脑能打开，我不知道导师是否读过；发送时只说了请看看，没有约定回复时间。'
  const linkOut=groundedStateReadback(link,['我把作品集链接发给导师了，对方还没回复。'])
  assert.match(linkOut??'',/已发：作品集链接已发送/)
  assert.match(linkOut??'',/已回复：未回复（截至报告）/)
  assert.match(linkOut??'',/没有约定回复时间/)
})

test('a stability value is not an assertion of stable effects, while outcome stability remains gated',()=>{
 const sentence='家里希望稳定，这是外部期待，不等同于你的价值排序'
 assert.equal(safeEarlySentence(JSON.stringify({reply:sentence+'。'})),sentence)
 for(const claim of ['两次经历说明这种体验是稳定的。','放松感稳定存在。','这种状态是持续的。','这说明你有稳定的倾向。','这是稳定的规律。','你们的关系已经稳定。'])assert.equal(safeEarlySentence(JSON.stringify({reply:claim})),null,claim)
})

test('abstract distinction and time-prefixed observation headings are not first content',()=>{
 for(const title of ['先区分运动与室友两个变量。','两小时先观察时间自主感。'])assert.equal(safeEarlySentence(JSON.stringify({reply:title})),null,title)
 assert.equal(safeEarlySentence(JSON.stringify({reply:'先把作品集导出PDF并发给导师。'})),'先把作品集导出PDF并发给导师')
})

test('verified readback never promotes exporting, hypothetical sending or another recipient to a sent report',()=>{
 const ask='请把已发、已读、已回复、是否采用、实际效果分开说。'
 for(const prior of ['我可以导出PDF。','我导出了PDF，还没有发。','如果我发了PDF，导师可能就能读到。','“我发了PDF”是示例，不是我的实际报告。'])assert.equal(groundedStateReadback(ask,[prior]),null,prior)
 assert.equal(groundedStateReadback('回来反馈：我发了PDF，导师确认读到；另一位同学还没读邮件。',[]),null)
 for(const prior of ['我发了PDF。如果导师确认读到，再记录。','我发了PDF。“导师确认读到”只是示例。','我发了PDF。更正：还没有发PDF。'])assert.equal(groundedStateReadback(ask,[prior]),null,prior)
})

test('five-state canonical readback cannot overwrite an independent evaluation report with unknown',()=>{
 for(const text of [
  '回来反馈：我发了PDF，导师确认已经读到，但明确没有评价内容，也没有说是否采用。',
  '回来反馈：我发了PDF，导师确认已经读到，导师已经评价了内容，采用和效果还未知。',
 ])assert.equal(groundedStateReadback(text,[]),null,'unsupported evaluation facts retain ordinary source-aware generation')
 const prior='我发了PDF，导师确认已经读到，但没有评价内容。'
 assert.equal(groundedStateReadback('请把已发、已读、已回复、是否采用、实际效果分开说。',[prior]),null)
 assert.ok(groundedStateReadback('回来反馈：我发了PDF，导师确认已经读到，还没有说是否采用。',[]),'ordinary five-state-only reports remain eligible')
})

test('two-option feedback gets a grounded first summary',()=>{
  const user='回来反馈：我分别看了一个本地初级岗位和一个硕士培养方案。岗位要求的两项技能我做过课程练习；培养方案里有我不喜欢的纯理论必修。这个小样本只代表这两个选项。'
  const out=groundedFeedbackPreview(user)
  assert.match(out??'',/两项技能你做过课程练习/)
  assert.match(out??'',/纯理论必修/)
  assert.match(out??'',/不能证明岗位适合/)
  assert.equal(groundedFeedbackPreview('回来反馈：今天下雨了。'),null)
})

test('feedback preview cannot promote quoted, hypothetical, negated or other-person practice into mine',()=>{
  for(const report of [
    '回来反馈：如果我看了岗位和硕士培养方案，岗位要求的两项技能我做过课程练习，培养方案有我不喜欢的纯理论必修。',
    '回来反馈：同学说：“我看了岗位和硕士培养方案，岗位要求的两项技能我做过课程练习，培养方案有我不喜欢的纯理论必修。”',
    '回来反馈：我看了一个岗位和硕士培养方案。岗位要求的两项技能我没有做过课程练习。',
    '回来反馈：我看了一个岗位和硕士培养方案。岗位要求的两项技能室友做过课程练习。',
    '回来反馈：我看了岗位和硕士培养方案。培养方案没有纯理论必修。',
    '回来反馈：我看了岗位和硕士培养方案。培养方案有纯理论必修，我喜欢这些课程。',
  ])assert.equal(groundedFeedbackPreview(report),null,report)
})

test('an unverified state summary is not surfaced as a preview',()=>{
  assert.equal(safeEarlySentence('{"reply":"已发：PDF已发送。已读：导师确认读到。"}'),null)
})

test('a structured lead streams before reply',()=>{
  assert.equal(safeEarlySentence('{"lead":"课程先修要求是第一条要核对的线索。","reply":"状态已更新。先核对课程先修要求。"}',120,'lead'),'课程先修要求是第一条要核对的线索')
  assert.equal(openingQuestionDraft('{"lead":"你具体想先做哪一步？","reply":"先核对要求。"}','lead'),'你具体想先做哪一步？')
  assert.equal(safeEarlySentence('{"thinking":"先看哪一步？","lead":"先核对要求。","reply":"..."}',120,'lead'),null)
})

test('a pure self-state update may be skipped for the next safe sentence',()=>{
  assert.equal(safeEarlySentence('{"reply":"局部理解已更新，未知保留。两次打羽毛球都感到放松。"}'),'两次打羽毛球都感到放松')
  assert.equal(safeEarlySentence('{"reply":"方案已完成。接下来先核对课程先修要求。"}'),null)
})

test('an unsafe status update gates the display draft',()=>{
  for(const claim of ['已移除错误标签，不再推导。','考研方向已暂停，事实保留。','分类规则让同学少问一次，是有效线索。','一次整理有效，方向暂停。'])assert.equal(safeEarlySentence(JSON.stringify({lead:claim}),120,'lead'),null,claim)
  for(const title of ['更新判断：城市偏好与时间预算已纳入，不替选。','重开稳定期待，给四小时验证。','比较两种低成本探索方式。'])assert.equal(safeEarlySentence(JSON.stringify({lead:title}),120,'lead'),null,title)
  // The safety contract wins over first-content latency: an unsafe prefix
  // cannot be followed by a later sentence as if the prefix did not exist.
  assert.equal(safeEarlySentence('{"reply":"状态已更新：PDF已送达且导师确认读到。这属于“动作完成，结果未定”。"}'),null)
  assert.equal(safeEarlySentence('{"reply":"状态已更新：PDF已送达。你想先处理哪一步？"}'),null)
})

test('neutral retrospective interrogatives can stream without making factual claims',()=>{
  for(const question of ['你上次具体做了什么？','你当时是怎么交付的？','你这次有没有约定时间？','能简单说一下你当时做了什么、针对的是哪件事吗？','你整理的是给谁看的、什么用途的材料？']){
    const raw=JSON.stringify({reply:question+'随后核对其他环节。'})
    assert.equal(openingQuestionDraft(raw),question)
    assert.equal(openingQuestionDraft(raw.slice(0,raw.indexOf('？'))),null)
  }
})

test('neutral questions use interrogative syntax without a growing name or sentence-prefix allowlist',()=>{
  for(const question of ['那小林说“资料很乱”时，他具体指的是什么？','这里“资料很乱”是他对内容的判断，还是你转述时的概括？','对方当时具体希望拿到哪种材料？']){
    const raw=JSON.stringify({reply:'前面这段承接不提前展示。'+question})
    assert.equal(openingQuestionDraft(raw),question)
    assert.equal(openingQuestionDraft(raw.slice(0,raw.indexOf('？'))),null)
  }
  for(const question of ['对方是不是因为你不认真才不用材料？','小林肯定拒绝你了，你是不是应该继续催？','你是不是应该再发一份新的材料？','这说明你需要治疗吗？'])assert.equal(openingQuestionDraft(JSON.stringify({reply:question})),null)
})

test('a neutral completed question after a factual preamble is an exact fragment, never the unvalidated preamble',()=>{
  const question='能具体说说这次行动是什么吗？'
  const reply='你提到做了上次的行动，但对方没有使用。'+question+'比如是发了什么内容？'
  assert.equal(openingQuestionDraft(JSON.stringify({reply})),question)
  const encoded=JSON.stringify({reply})
  assert.equal(openingQuestionDraft(encoded.slice(0,encoded.indexOf('？'))),null)
  assert.ok(reply.includes(openingQuestionDraft(encoded)!))
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'已保存。'+question})),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'你有焦虑症。'+question})),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'依据[研究]。'+question})),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'对方因为性格拒绝你。'+question})),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'示例“你想说什么？”还没有真实问句。'})),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'长的自然承接。'.repeat(1000)+question})),question)
  const confirm='想确认一下：这份就是你交付的材料吗？'
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'你提到整理了资料。'+confirm})),confirm)
  for(const claim of ['已为你保存。','已经替你发送。','已帮你起草。'])assert.equal(openingQuestionDraft(JSON.stringify({reply:claim+confirm})),null)
})

test('an unrendered ordinary causal preamble cannot delay a separate neutral question or expose its assertion',()=>{
  const question='那这位同学当时有没有提出具体需要？'
  const raw=JSON.stringify({reply:'他明确说手机打不开，所以没看。'+question})
  assert.equal(openingQuestionDraft(raw),question)
  assert.equal(openingQuestionDraft(raw.slice(0,raw.indexOf('？'))),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'没有引用资料。那当时有没有约定反馈？'})),'那当时有没有约定反馈？')
  for(const preamble of ['已为你保存。','你有焦虑症。','因为你性格有问题。','依据[来源]。'])assert.equal(openingQuestionDraft(JSON.stringify({reply:preamble+question})),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'那这位同学是因为你不认真所以拒绝你吗？'})),null)
})

