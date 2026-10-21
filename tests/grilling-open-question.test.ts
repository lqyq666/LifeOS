import test from 'node:test'

test('public recruitment lookup survives the contact-channel guard without licensing outreach',()=>{
 const reply='本轮只重开家庭期待影响的判断。小验证：选一个已考虑的方向，用公开渠道查3个真实招聘帖，记录城市和入门门槛；做完即停。'
 assert.equal(removeUnsupportedContactChannels(reply,'请给一个四小时内的小验证。'),null)
 const contact='通过公开渠道联系三位HR，发送简历。先保留已有判断。'
 assert.equal(removeUnsupportedContactChannels(contact,'请给一个四小时内的小验证。'),'先保留已有判断。')
 assert.equal(removeUnsupportedContactChannels('先保留判断。用公开渠道查3个已发布的招聘帖，记录城市。','请给一个四小时内的小验证。'),null)
 assert.equal(removeUnsupportedContactChannels(contact,'我已用公开渠道查过3个招聘帖。请给下一步。'),'先保留已有判断。')
 assert.equal(removeUnsupportedContactChannels(contact,'请通过公开渠道联系三位HR。'),null)
 assert.equal(removeUnsupportedContactChannels('通过公开渠道联系三位HR，发送简历。','请给一个四小时内的小验证。'),'')
 assert.equal(removeUnsupportedContactChannels('先保留判断。用公开渠道查3个招聘帖，发布频率和城市都记录下来。','请给一个四小时内的小验证。'),null)
 assert.equal(removeUnsupportedContactChannels(contact,'现在只用公开渠道查招聘帖，不联系任何人。\n请通过公开渠道联系三位HR。'),'先保留已有判断。')
 assert.equal(removeUnsupportedContactChannels(contact,'用公开渠道查招聘帖，联系HR前先问我。'),'先保留已有判断。')
 assert.equal(removeUnsupportedContactChannels('通过微信联系导师。','历史：请通过微信联系导师。','现在不要联系任何人。'),'')
 assert.equal(removeUnsupportedContactChannels('之前通过微信发过作品集。','之前通过微信发过作品集。','现在不要联系任何人。'),null)
})

test('a local file check cannot claim to test a different recipients device',()=>{
 const user='我可以导出PDF，今天只愿意做一个动作。请给能开始的一步，并说明何时停止。'
 const reply='把作品集导出成一个PDF文件，就是今天唯一的一步。它测的是：导师手机能否直接打开这个格式。从现有源文件导出，文件存到本地、确认能正常打开就停，今天不发送。'
 const out=groundReportedAccessAlternative(reply,user)??reply
 assert.doesNotMatch(out,/它测的是：导师手机/)
 assert.match(out,/导出成一个PDF/);assert.match(out,/本地/);assert.match(out,/今天不发送/)
 const inline='把PDF导出到本地用于验证导师手机能否打开。今天不发送，导出完成即停。'
 const limited=groundReportedAccessAlternative(inline,user)??inline
 assert.match(limited,/把PDF导出到本地。/);assert.doesNotMatch(limited,/用于验证导师手机/);assert.match(limited,/导出完成即停/)
 const inlineStop='把PDF导出到本地用于验证导师手机能否打开并在这一步后停止。今天不发送。'
 const boundedStop=groundReportedAccessAlternative(inlineStop,user)??inlineStop
 assert.match(boundedStop,/把PDF导出到本地并在这一步后停止/);assert.doesNotMatch(boundedStop,/验证导师手机/)
 const mixed='把PDF导出到本地用于验证导师手机能否打开并记录显示是否正常，然后停止。今天不发送。'
 assert.equal(groundReportedAccessAlternative(mixed,user),'')
 const sameClause=mixed.replace('，然后停止','然后停止')
 assert.equal(groundReportedAccessAlternative(sameClause,user),'')
 const screenRecord=sameClause.replace('记录显示是否正常','记录屏幕内容')
 assert.equal(groundReportedAccessAlternative(screenRecord,user),'')
 for(const state of ['停留在加载状态','卡在加载状态'])assert.equal(groundReportedAccessAlternative(`把PDF导出到本地用于验证导师手机能否打开并检查页面是否${state}。今天不发送。`,user),'')
 assert.equal(groundReportedAccessAlternative('把PDF导出到本地用于验证导师手机能否打开并不再继续。今天不发送。',user),'')
 assert.equal(groundReportedAccessAlternative('把PDF复制到本地用于验证导师手机能否打开。今天不发送。',user),'')
 assert.equal(groundReportedAccessAlternative('把PDF导出到本地并发给导师用于验证导师手机能否打开。今天不发送。',user),'')
 assert.equal(groundReportedAccessAlternative('把PDF导出到本地用于验证导师手机能否打开并在导师确认后停止。今天不发送。',user),'')
 assert.equal(groundReportedAccessAlternative('把PDF导出到本地用于验证导师手机能否打开并在导师确认后停。今天不发送。',user),'')
 const valid='导出PDF后发给导师，由导师在手机上打开并回复能否打开；确认后即停。'
 assert.equal(groundReportedAccessAlternative(valid,user),null)
 const unknown='只在本地打开PDF，今天不发送。导师手机能否打开仍未知。'
 assert.equal(groundReportedAccessAlternative(unknown,user),null)
 for(const clause of ['不要说它测的是导师手机能否打开','导师说它测的是导师手机能否打开','客户说它测的是客户手机能否打开','对方说它测的是对方手机能否打开','它测的是导师手机能否打开吗？']){
  const source='把PDF导出到本地，今天不发送。'+clause+'。'
  assert.equal(groundReportedAccessAlternative(source,user),null,clause)
 }
})
import assert from 'node:assert/strict'
import {openUnreportedChoiceQuestion,openPresupposedProblemQuestion,removePrematureDemoStep,removePrematureProductization,groundSingleLeadWithoutProduct,removeQuestionOnZeroTime,reportedLeadCount,limitGrillingQuestions,removeUnsupportedContactChannels,groundUnsupportedOperationalResources,prioritizeReportedAccessFailure,groundReportedAccessAlternative,fixReportedReceiptState,openingQuestionDraft,safeEarlySentence,acknowledgeRefusalBoundary,repairUnsupportedPreferenceClaim,repairUnsupportedZeroTimeClaim,enforceReportedQuantity,ensureZeroTimeFocus,removeZeroTimeTasks,ensureLowCostSelfStart,ensureTwoFactorPresenceChange,guardHealthTwoFactor,groundClickablePrototype,ensureClickableValidation,fixClickableCountConsistency,softenSingleObservationCausality,ensureRequestedQuestion,requestsOneQuestionReply} from '../server/reply-draft.ts'

test('unreported alternatives become one grounded open question without another model call',()=>{
  assert.equal(openUnreportedChoiceQuestion('你整理资料时，最让你有成就感的是“混乱变有序”，还是“别人能看懂”？','我喜欢把混乱内容按规则归类。'),'你整理资料时，最让你有成就感的具体情况是什么？')
  assert.equal(openUnreportedChoiceQuestion('你自己想读研，是为了逃避就业，还是为了获得认可？','身边同学都在考研，我还没想清楚。'),'你自己想读研，你希望它具体改变什么？')
  assert.equal(openUnreportedChoiceQuestion('整理资料时，你更享受把混乱变有序的过程，还是更在意整理完能派上用场？','我喜欢把混乱内容按规则归类。'),'整理资料时，具体哪一部分最影响你的感受？')
  assert.equal(openUnreportedChoiceQuestion('你更想考研，还是就业？','我在比较考研还是就业。'),null)
})

test('choice authorization follows the actual alternatives, not punctuation or another pair',()=>{
  for(const [user,reply] of [
    ['我还没想清楚。','你想先探索就业还是考研？'],
    ['我不知道考研还是就业。','你想先补基础，还是直接找实习？'],
  ]){
    assert.ok(openUnreportedChoiceQuestion(reply,user))
    assert.equal(openingQuestionDraft(JSON.stringify({reply}),'reply',user),null)
    assert.equal(safeEarlySentence(JSON.stringify({reply}),120,'reply',user),null)
  }
  assert.equal(openUnreportedChoiceQuestion('你想先探索就业还是考研？','我想比较就业和考研。'),null)
})

test('ordinary grilling keeps one grounded question and drops invented channels',()=>{
  assert.equal(limitGrillingQuestions('先保留等待状态。你上次向学长具体问了什么？要不要去群里或公开渠道再问一次？','仍然没收到回复，我不想换到私人微信催他。','仍然没收到回复，我不想换到私人微信催他。学长'), '先保留等待状态。你上次向学长具体问了什么？')
  assert.equal(limitGrillingQuestions('现在线索还不足。下一次访谈问题：他最近一次因为课表冲突放弃了什么安排？你愿意今天再问三个人吗？','我问了一个同学，下一步怎么判断这个线索？'), '现在线索还不足。下一次访谈问题：他最近一次因为课表冲突放弃了什么安排？')
  assert.equal(limitGrillingQuestions('先问动机是什么？再问时间有多少？','请分别给我两个问题。'),null)
})

test('a contact action cannot add an unreported channel',()=>{
  const reply='下一步只需提供一份手机能打开的格式。建议导出PDF，通过微信或邮件直接发给导师。这样先解决访问条件。'
  assert.equal(removeUnsupportedContactChannels(reply,'导师说手机打不开链接。'), '下一步只需提供一份手机能打开的格式。这样先解决访问条件。')
  assert.equal(removeUnsupportedContactChannels(reply,'导师说手机打不开链接，我之前用邮件发送。'), '下一步只需提供一份手机能打开的格式。这样先解决访问条件。')
})

test('a missing operational source becomes one prerequisite question',()=>{
  const reply='去即刻、V2EX或小红书找几位接单者，再到校友群私信他们。'
  assert.equal(groundUnsupportedOperationalResources(reply,'我没有客户，想低成本了解独立接项目。'),'这一步需要一个你确实能访问、也愿意使用的公开资料来源；你目前没有提供具体来源。你手上已有哪一个可用来源？')
  assert.equal(groundUnsupportedOperationalResources('先查看你提到的小红书收藏。','我在小红书收藏了一篇公开经历。'),null)
  assert.equal(groundUnsupportedOperationalResources('在 GitHub 搜索 solo developer 的公开记录。','我没有提供使用什么平台，也不要虚构渠道。'),'这一步需要一个你确实能访问、也愿意使用的公开资料来源；你目前没有提供具体来源。你手上已有哪一个可用来源？')
  assert.equal(groundUnsupportedOperationalResources('可以先在 LinkedIn 查看公开岗位的工作时间和协作方式。','我不联系陌生人，只了解一个岗位，不提供私人资料。'),null)
  assert.equal(groundUnsupportedOperationalResources('去 LinkedIn 私信几位从业者了解岗位。','我不联系陌生人，只了解一个岗位。'),'这一步需要一个你确实能访问、也愿意使用的公开资料来源；你目前没有提供具体来源。你手上已有哪一个可用来源？')
})

test('an interview question does not presuppose that a trouble exists',()=>{
  assert.equal(
    openPresupposedProblemQuestion('你最近一次选课，印象最深的一个麻烦是什么？'),
    '你最近一次选课，实际经过是什么？有没有遇到麻烦，还是没有？')
  assert.equal(
    openPresupposedProblemQuestion('你上次选课的时候，最让你头疼的问题是什么？'),
    '你上次选课的时候，实际经过是什么？有没有遇到麻烦，还是没有？')
  assert.equal(openPresupposedProblemQuestion('你上次选课的时候，具体是怎么选的？'),null)
})

test('a single lead without a product cannot become a demo step',()=>{
  const user='我问了一个同学，他说课表冲突不好找。我没有交付产品，也没人采用或付款。下一步怎么判断这个线索？'
  const reply='先确认“课表冲突”是拒绝理由还是真实障碍。下一步：找另一个时间充裕的同学，直接问“你平时什么时候有空，我能不能占用你10分钟演示一下？”'
  assert.equal(removePrematureDemoStep(reply,user),'先确认“课表冲突”是拒绝理由还是真实障碍。')
  assert.equal(removePrematureDemoStep('现在先不做产品，也不演示，只核对对方原话。',user),null)
  assert.equal(removePrematureDemoStep('下一步找一个同学演示一下。','我想先了解同学怎么选课。'),null)
})

test('a single report without a product cannot become selling or a sample-size plan',()=>{
  const user='我问了一个同学，他说课表冲突不好找。我没有交付产品，也没人采用或付款。下一步怎么判断这个线索？'
  const reply='先别急着把它当成死局，这其实是一个信号。判断这个线索，核心在于区分人和事。试着找 3-5 个不同专业的同学，或在朋友圈发一个需求测试。先做一个能立刻交付的场景，卖这页纸。你觉得原本想解决的那个痛点是什么？'
  assert.equal(removePrematureProductization(reply,user),'先别急着把它当成死局，这其实是一个信号。判断这个线索，核心在于区分人和事。你觉得原本想解决的那个痛点是什么？')
  assert.equal(removePrematureProductization('先别急着卖，也不要收费，先问清楚他当时具体卡在哪一步。',user),null)
  assert.equal(removePrematureProductization('试着找 3-5 个同学做一个小测试。','我想了解同学怎么选课。'),null)
})

test('sample counts and explicit prototype requests are not rewritten into one lead',()=>{
  const twenty='我访谈了20个同学，18个反馈选课冲突，尚未做产品，也没人采用或付款。现在帮我设计一个验证原型。'
  assert.equal(groundSingleLeadWithoutProduct('先制作一个最小可行原型，用来验证需求。',twenty),null)
  const unknown='我访谈了一些同学，反馈选课冲突，尚未做产品，也没人采用或付款。现在帮我设计一个验证原型。'
  assert.equal(groundSingleLeadWithoutProduct('先制作一个最小可行原型，用来验证需求。',unknown),null)
  const hasProduct='我已经有一个可演示原型，还没有交付，也没人采用或付款。'
  assert.equal(groundSingleLeadWithoutProduct('先制作一个最小可行原型，用来验证需求。',hasProduct),null)
  assert.equal(reportedLeadCount('我访谈了20个同学，18个反馈选课冲突'),20)
  assert.equal(reportedLeadCount('我问了一个同学，他说课表冲突不好找'),1)
  assert.equal(reportedLeadCount('我访谈了一些同学'),null)
})

test('removing every unsafe sentence does not let the original reply back through',()=>{
  const user='我没有交付产品，也没人采用或付款。'
  assert.equal(removePrematureDemoStep('找一个同学演示一下。',user),'先确认这条反馈具体指什么，再决定下一步。')
  assert.equal(removePrematureProductization('卖这页纸，再找3-5个同学试点。',user),'先确认这条反馈具体指什么，再决定下一步。')
})

test('zero available time does not end with another question',()=>{
  const user='现在我愿意厘清一点，但本周可用时间是零。老师没回复只是结果未知，不等于拒绝我。'
  assert.equal(removeQuestionOnZeroTime('收到，这周零时间也完全没问题。既然你愿意厘清一点，我想先确认一下：你之前联系老师，主要是为了推进哪件具体的事？',user),'收到，这周零时间也完全没问题。\n\n这周先不安排动作，等你有时间再继续。')
  assert.equal(removeQuestionOnZeroTime('你希望这周先做什么？','本周可用时间是零。'),'这周先不安排动作，等你有时间再继续。')
  assert.equal(removeQuestionOnZeroTime('你希望这周先做什么？','我想了解同学怎么选课。'),null)
})

test('a single lead without a product is grounded back to the reported condition',()=>{
  const user='我问了一个同学，他说课表冲突不好找。我没有交付产品，也没人采用或付款。下一步怎么判断这个线索？'
  const productReply='先别急着否定这个线索。接下来要验证需求的刚性程度，并思考你的产品形态能否改变。'
  assert.equal(groundSingleLeadWithoutProduct(productReply,user),'目前只有这一条反馈。先弄清“课表冲突不好找”具体指什么，不推进产品。可以问他最近一次遇到这件事的完整经过：当时在做什么、具体卡在哪一步、后来怎么处理的。')
  assert.equal(groundSingleLeadWithoutProduct('先别急着升级成需求验证；下一步不是做产品，而是再问两三个同学。','只有一个同学提到课程资料难找。我没有做产品，也没人使用。'),'目前只有这一条反馈。先弄清“课程资料难找”具体指什么，不推进产品。可以问他最近一次遇到这件事的完整经过：当时在做什么、具体卡在哪一步、后来怎么处理的。')
  assert.equal(groundSingleLeadWithoutProduct(productReply,'我想先了解同学怎么选课。'),null)
})

test('a reported access failure outranks a withheld delivery channel',()=>{
  const reply='真正影响下一步的缺口是原发送渠道。你当时是通过什么方式把作品集发给导师的？'
  const user='导师说手机打不开我发的作品集。我没有提供原发送渠道，也不要你替我选平台或写消息。现在只处理真正影响下一步的缺口。'
  assert.equal(prioritizeReportedAccessFailure(reply,user),'先核对手机端的访问条件：用手机浏览器打开同一链接，记录是空白、报错、需要登录还是加载失败。')
  assert.equal(prioritizeReportedAccessFailure(reply,'导师说手机打不开，我之前用邮件发送。'),null)
})

test('an access failure with no other version gets a format alternative, not a receipt check or a rewrite',()=>{
  const user='我把简历PDF链接发给HR，对方说手机上打不开。我没有别的版本，先怎么处理访问问题？'
  const reply='先确认对方是否已收到链接。 如果已收到但打不开，下一步是询问对方方便接收的文件格式（如Word或图片），然后按该格式重新制作简历并发送。'
  assert.equal(groundReportedAccessAlternative(reply,user),'下一步是询问对方方便接收的文件格式（如Word或图片），然后按该格式重新导出简历并发送。')
  assert.equal(groundReportedAccessAlternative('先确认对方是否已收到链接。','我把链接发给HR，对方说手机上打不开。'),null)
  assert.equal(groundReportedAccessAlternative(reply,'我把PDF发给HR，对方说手机上打不开。'),null)
})

test('a read-unknown sentence is not rewritten into a receipt',()=>{
  const user='老师回复说收到了，但没评价内容。'
  assert.equal(fixReportedReceiptState('目前状态：已确认收到；是否已读仍未知。',user),null)
  assert.equal(fixReportedReceiptState('老师已读，但没有回复。',user),'老师已确认收到，但没有回复。')
})

test('a read claim after a receipt is corrected even when content is unknown',()=>{
  const user='我把PDF发给导师，他确认收到了，但没说有没有看。'
  const out=fixReportedReceiptState('状态已更新：PDF已送达且导师确认读到，但内容评价仍未知。这属于“已读未评”。',user)??''
  assert.match(out,/确认收到/)
  assert.doesNotMatch(out,/确认读到|已读未评/)
  assert.equal(fixReportedReceiptState('目前状态：已确认收到；是否已读仍未知。',user),null)
})

test('a status list keeps the read dimension unknown',()=>{
  const user='我把PDF发给导师，他回复说收到了，但没说有没有看。'
  const out=fixReportedReceiptState('状态已按五个环节分开更新：\n- 已读：导师确认已读到。\n- 是否采用：未知。\n\n当前卡在“已读但未回复”。',user)??''
  assert.match(out,/- 已读：未知（目前只确认收到）/)
  assert.match(out,/已确认收到但未回复/)
  assert.doesNotMatch(out,/导师确认已读到/)
})

test('the early draft finds reply after an event field',()=>{
  assert.equal(openingQuestionDraft('{"event":{"x":1},"reply":"你具体想先做哪一步？第二句"}'),'你具体想先做哪一步？')
  assert.equal(safeEarlySentence('{"event":{"x":1},"reply":"材料按截止日期排序。第二句"}'),'材料按截止日期排序')
})

test('a multi-person clickable request is not rewritten into a single-lead clarification',()=>{
  const user='我问了13个同学，10个说图书馆座位信息太乱。我还没做产品，想先做一个可点击原型，怎么设计最小验证？'
  assert.equal(removePrematureDemoStep('先做两页可点击原型，找同学测试。',user),null)
  assert.equal(removePrematureDemoStep('先做一个演示，再找同学。','我只问了一个同学，还没有产品。'),'先确认这条反馈具体指什么，再决定下一步。')
})

test('a receipt is not a read state and the reply cannot contradict itself',()=>{
  const user='我按上次说的给老师发了邮件，他回复说收到了，但没评价内容。现在算什么状态？'
  const reply='目前算“已送达且已读，但内容未评价”。 老师回复“收到了”只确认了邮件到达，不代表他看过或认可了里面的内容。'
  assert.equal(fixReportedReceiptState(reply,user),'目前算“已送达且已确认收到，但内容未评价”。 老师回复“收到了”只确认了邮件到达，不代表他已阅读内容或认可了里面的内容。')
  assert.equal(fixReportedReceiptState('老师已读，但没有回复。','老师回复说收到了。'),'老师已确认收到，但没有回复。')
  assert.equal(fixReportedReceiptState(reply,'老师已经读过邮件，但没有评价。'),null)
})

test('zero time with 没时间/不想安排 does not turn into an information checklist',()=>{
  const user='这周完全没空，不想安排任何事。只想让你帮我理一下期末最该先看什么。'
  assert.equal(removeQuestionOnZeroTime('先帮你理，不安排任何事。 要判断最该先看什么，我需要知道你有哪几门课。你方便列一下吗？比如：课程名、考试日期。',user),'先帮你理，不安排任何事。\n\n这周先不安排动作，等你有时间再继续。')
})

test('a single lead reply cannot expand the sample after saying not to build',()=>{
  const user='我只问了一个学弟，他说社团报名流程太绕。我还没做产品，也没人用。下一步怎么判断？'
  const reply='先别急着做产品。停止条件：若无法获得具体行为描述，或对方不愿再聊，则暂停产品方向，转为观察更多人的实际报名行为。'
  assert.equal(groundSingleLeadWithoutProduct(reply,user),'目前只有这一条反馈。先弄清“社团报名流程太绕”具体指什么，不推进产品。可以问他最近一次遇到这件事的完整经过：当时在做什么、具体卡在哪一步、后来怎么处理的。')
  const course='我只问了一个同班同学，他说选课系统太难用。我还没做产品，也没人用。下一步怎么判断？'
  assert.equal(groundSingleLeadWithoutProduct('先别急着做产品。下一步再找两三个同学问问。',course),'目前只有这一条反馈。先弄清“选课系统太难用”具体指什么，不推进产品。可以问他最近一次遇到这件事的完整经过：当时在做什么、具体卡在哪一步、后来怎么处理的。')
})

test('a clickable prototype request is not downgraded to a paper sketch',()=>{
  const user='我问了12个同学，9个说社团活动通知太乱。我还没做产品，想先做一个可点击原型，怎么设计最小验证？'
  const fallback=groundClickablePrototype('先画一张只含关键步骤的草图。现在最需要验证的一个假设是什么？',user)??''
  assert.match(fallback,/可点击/)
  assert.match(fallback,/假设/)
  assert.match(fallback,/2 位/)
  assert.equal(groundClickablePrototype('先做一个可点击的 3 页流程：入口→列表→详情。',user),null)
  const enriched=ensureClickableValidation('先做一个可点击的 3 页流程，找 1 位同学走一遍。',user)??''
  assert.match(enriched,/假设/)
  assert.match(enriched,/2 位/)
  assert.equal(ensureClickableValidation(fallback,user),null)
  assert.match(groundClickablePrototype('先画一张草图，用户点击报名。',user)??'',/可点击/)
  assert.match(fixClickableCountConsistency('找 1 位之前反馈过这个问题的同学，给他一个具体任务；3 位里 2 位能完成即可。',user)??'',/找 3 位/)
  assert.match(fixClickableCountConsistency('找那5个说乱的同学试用；如果3个人里超过2个还卡住，就改流程。',user)??'',/找那3个说/)
  assert.equal(fixClickableCountConsistency('先找1位走通，再找2位复测，共3位。',user),null)
  assert.equal(groundClickablePrototype('先画一张草图。','我想了解同学怎么选课。'),null)
  const canteen='我问了14个同学，11个说食堂排队信息太乱。我还没做产品，想先做一个可点击原型，怎么设计最小验证？'
  assert.match(groundClickablePrototype('先画一张只含关键步骤的草图。',canteen)??'',/食堂排队信息/)
})

test('a lowest-cost comparison adds a self-start fallback when it relies on finding people',()=>{
  const user='我在准备就业，也在考虑考公。每周只有4小时。先帮我比较一个最低成本的了解方式。'
  const reply='先各花1小时找一位在职者聊。就业找一位目标岗位的从业者，考公找一位上岸者。'
  assert.match(ensureLowCostSelfStart(reply,user)??'',/真题|面经/)
  assert.equal(ensureLowCostSelfStart('先各看1套公开真题，自己记录卡点。',user),null)
})

test('a two-factor test must remove a factor, not only move its time',()=>{
  const user='我改成每天阅读后专注力好，但同时也开始早睡。不确定是哪个起作用。给一个不折腾的区分办法。'
  const reply='连续三天早睡，但把阅读时间挪到下午，观察专注力。'
  const fixed=ensureTwoFactorPresenceChange(reply,user)??''
  assert.match(fixed,/暂停阅读/)
  assert.match(fixed,/暂停其中一个/)
  assert.equal(ensureTwoFactorPresenceChange('先停阅读三天，保留早睡。',user),null)
})

test('a health two-factor test does not stop a health habit',()=>{
  const user='我改成每天拉伸后睡眠好，但同时也开始早睡。不确定是哪个起作用。给一个不折腾的区分办法。'
  assert.match(guardHealthTwoFactor('先停掉拉伸三天，保留早睡。',user)??'',/健康边界/)
  assert.equal(guardHealthTwoFactor('先停阅读三天，保留早睡。','我改成每天阅读后睡眠好，但同时也开始早睡。'),null)
})

test('one two-factor observation is a clue, not proof of the cause',()=>{
  const user='我改成早起后效率高，但同时也开始每天跑步。不确定是哪个起作用。给一个不折腾的区分办法。'
  assert.equal(softenSingleObservationCausality('先停跑步，只保留早起。若明显下降，跑步是主因；若持平，早起是主因。',user),'先停跑步，只保留早起。若明显下降，跑步更可能是主因；若持平，早起更可能是主因。\n\n一次结果只是线索，不证明因果。')
  assert.equal(softenSingleObservationCausality('睡眠没变差 → 散步可能更可能是主因。','我戒咖啡后睡眠好，但同时也开始每天散步。不确定是哪个起作用。'),'睡眠没变差 → 散步更可能是主因。\n\n一次结果只是线索，不证明因果。')
  assert.equal(softenSingleObservationCausality('如果效率下降，说明番茄钟起了作用。','我换到图书馆学习后效率高，但同时也开始用番茄钟。不确定是哪个起作用。'),'如果效率下降，说明番茄钟更可能起了作用。\n\n一次结果只是线索，不证明因果。')
  assert.equal(softenSingleObservationCausality('记录三天的精力变化，先不下结论。',user),null)
})

test('an absence of clients is not a preference against clients',()=>{
  const user='我还没有客户，也没有自由职业经历，每周最多两小时。请比较一个更低成本的探索方式，不要推出我适合自由职业。'
  const reply='先厘清：自由的核心是自主安排专注时间，且你明确不想承担找客户和收款。因此，自由职业路径与你已排除的约束冲突。'
  assert.equal(repairUnsupportedPreferenceClaim(reply,user),'先厘清：自由的核心是自主安排专注时间，且你目前还没有客户，也没有自由职业经历。因此，自由职业路径与你目前的经历和约束不符。')
  assert.equal(repairUnsupportedPreferenceClaim('你明确不想找客户。','我不想找客户，也没有客户。'),null)
})

test('a form access failure gets a fillable alternative, not PDF-only',()=>{
  const user='我把实习报名表的在线链接发给HR，对方说手机上打不开。我不想重做表格，先怎么让他填？'
  const reply='先问HR是链接打不开还是页面加载慢。可以先导出 PDF 或截图，按对方能打开的格式重新发送。'
  assert.match(groundReportedAccessAlternative(reply,user)??'',/可编辑|电脑|在线填写/)
  assert.match(groundReportedAccessAlternative('先导出 PDF 或截图发给老师。','我把奖学金申请表的链接发给老师，她说手机上打不开。我不想重做表格。')??'',/可编辑|电脑|在线填写/)
  assert.match(groundReportedAccessAlternative('在电脑浏览器打开链接，用打印→另存为PDF导出。','我把奖学金申请表的链接发给老师，她说手机上打不开。我不想重做表格。')??'',/可编辑|电脑.*填|在线填写/)
  assert.equal(groundUnsupportedOperationalResources('打开一个招聘网站，阅读职位描述里的工作时间。','我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。'),null)
  assert.equal(groundUnsupportedOperationalResources('你手上已有哪一个可用来源？','我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。'),null,'a source question does not authorize replacing the requested exploration')
  assert.equal(groundUnsupportedOperationalResources('打开一个招聘网站，阅读岗位工作时间，不联系任何人，不注册账号。','我愿意只了解一个远程岗位，不联系陌生人、不提供私人资料。'),null)
  assert.equal(groundUnsupportedOperationalResources('打开一个招聘网站，阅读岗位工作时间；不联系任何人；不注册账号。','我愿意只了解一个远程岗位，不联系陌生人、不提供私人资料。'),null)
  assert.equal(groundUnsupportedOperationalResources('只打开一个公开招聘页面，阅读职位描述里的工作时间。','现在不继续行动，只给阶段理解。'),null)
})

test('zero time with a focus request keeps a provisional focus',()=>{
  const user='这周完全没空，不想安排任何事。只想让你帮我理一下奖学金申请最该先看什么。'
  const reply='这周不安排任何事，只帮你理一下奖学金申请最该先看什么。\n\n这周先不安排动作，等你有时间再继续。'
  assert.equal(ensureZeroTimeFocus(reply,user),'这周不安排任何事，只帮你理一下奖学金申请最该先看什么。\n\n先看这件事的截止时间和硬性条件；等你有时间再展开。\n\n这周先不安排动作，等你有时间再继续。')
  assert.equal(ensureZeroTimeFocus('这周先看截止日期和资格。','这周没空，最该先看什么？'),null)
})

test('zero time keeps the focus but removes the hidden action checklist',()=>{
  const user='这周完全没空，不想安排任何事。只想让你帮我理一下实习申请最该先看什么。'
  const reply='这周不安排任何事，只帮你理顺序。 实习申请最该先看的是：目标岗位的 JD。 原因：JD 是筛选标准。 具体操作： 1. 找3-5个岗位 JD 2. 列出关键词 3. 对照经历。'
  assert.equal(removeZeroTimeTasks(reply,user),'这周不安排任何事，只帮你理顺序。 实习申请最该先看的是：目标岗位的 JD。 原因：JD 是筛选标准。')
})

test('not arranging tasks is not zero time when the user says they have time',()=>{
  assert.equal(repairUnsupportedZeroTimeClaim('这周没有时间。','先不安排任务，但我其实有空。'),'这条时间信息还没有来源；先保留为未知。')
})

test('a request not to add tasks is not a report of zero time',()=>{
  const user='只谈老师邮件：如果不增加任务，你目前能形成什么暂定理解？'
  assert.equal(repairUnsupportedZeroTimeClaim('暂定理解：老师邮件处于未回复状态，且本周无可用时间。',user),'暂定理解：老师邮件处于未回复状态。')
  assert.equal(repairUnsupportedZeroTimeClaim('本周无可用时间。','这周完全没空。'),null)
})

test('a reported quantity of one stays one',()=>{
  const user='我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。给一个边界清楚的小行动。'
  assert.equal(enforceReportedQuantity('在招聘网站上找3个你感兴趣的远程岗位JD，只看工作时间。',user),'在招聘网站上找一个你感兴趣的远程岗位JD，只看工作时间。')
  assert.equal(enforceReportedQuantity('在招聘网站上找一个你感兴趣的远程岗位JD。',user),null)
  assert.equal(enforceReportedQuantity('找3个你感兴趣的同学聊聊。','我愿意只了解一个远程岗位。'),null)
})

test('a refusal boundary is acknowledged, not silently skipped',()=>{
  const user='我不想聊考研，也别给我建议，今天只想说说最近很累。'
  assert.equal(acknowledgeRefusalBoundary('最近很累，我听着。',user),'好，不聊考研，也不给建议。\n\n最近很累，我听着。')
  assert.equal(acknowledgeRefusalBoundary('好，不聊考研，也不给建议。你说，我听着。',user),null)
  assert.equal(acknowledgeRefusalBoundary('最近很累，我听着。','我最近有点累。'),null)
})

test('a request for one question is answered with a grounded question, never a bare acknowledgement',()=>{
  const user='我大三，没想好方向，也没什么经历。最近帮社团做了一次海报，发现自己挺愿意改细节。先问一个具体问题。'
  assert.equal(requestsOneQuestionReply(user),true)
  assert.equal(ensureRequestedQuestion('好的，请说。',user),'你提到“发现自己挺愿意改细节”，其中具体哪个细节最影响你？')
  assert.equal(ensureRequestedQuestion('那次海报里，你具体改了哪个细节？',user),null)
  assert.equal(ensureRequestedQuestion('好的，请说。','我最近有点累。'),null)
})
