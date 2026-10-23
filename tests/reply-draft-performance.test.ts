import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {openUnreportedChoiceQuestion,openingQuestionDraft,repairSingleJobJd,requestsOneQuestionReply,groundedFeedbackPreview} from '../server/reply-draft.ts'

test('a comma before an owned definition does not block its safe open question',()=>{
 const user='我是成年大学生，我想要更自由的生活，但明确不想创业。不要换词劝我创业，先问一个问题厘清我说的自由。'
 const reply='你说的“更自由的生活”，具体是指时间上的自主（比如不被固定打卡束缚），还是经济上的独立，或是其他什么？'
 const expected='你说的“更自由的生活”具体指什么？'
 assert.equal(requestsOneQuestionReply(user),true)
 assert.equal(openUnreportedChoiceQuestion(reply,user),expected)
 assert.equal(openingQuestionDraft(JSON.stringify({reply}),'reply',user),expected)
 const unquoted='你说的自由，更接近哪种日常状态：时间上能自己安排节奏，还是不被某个固定身份或关系绑住？'
 assert.equal(openingQuestionDraft(JSON.stringify({reply:unquoted}),'reply',user),'你说的“自由”具体指什么？')
 for(const other of ['我不想要更自由的生活。','同学说：“我想要更自由的生活”。','如果我说想要更自由的生活呢？'])assert.equal(openingQuestionDraft(JSON.stringify({reply}),'reply',other),null)
 for(const other of ['不要问一个问题厘清我说的自由。','同学说：“先问一个问题厘清我说的自由”。','如果我让你先问一个问题厘清我说的自由呢？'])assert.equal(requestsOneQuestionReply(other),false)
})

test('family expectations preview only through the source-rendered distinction',()=>{
 const user='接着升学和就业的取舍。家里希望我走稳定路线，但这是外部期待；我自己更在意留在目前城市，而且每周最多四小时探索。请更新判断，不要替我选。'
 const sentence='家里希望走稳定路线是外部期待，本人更在意留在目前城市且每周最多四小时探索'
 assert.equal(safeEarlySentence(JSON.stringify({reply:sentence+'。'}),120,'reply',user),null)
 const preview=groundedFeedbackPreview(user)
 assert.ok(preview?.includes('「家里希望我走稳定路线」'))
 assert.ok(preview?.includes('「我自己更在意留在目前城市」'))
 assert.ok(preview?.includes('不自动成为本人的选择或硬性约束'))
 for(const other of ['我没说家里希望走稳定路线。','同学说：“家里希望我走稳定路线”。','如果家里希望我走稳定路线会怎样？'])assert.equal(safeEarlySentence(JSON.stringify({reply:sentence+'。'}),120,'reply',other),null)
 for(const extra of ['，这保证你能录取','，这条路线能带来稳定收入'])assert.equal(safeEarlySentence(JSON.stringify({reply:sentence+extra+'。'}),120,'reply',user),null)
 for(const extra of ['，所以你当前应优先选择升学','，因此你应该选择升学','，你当前应优先选择升学','，升学应优先于就业','，是你犹豫的原因'])assert.equal(safeEarlySentence(JSON.stringify({reply:'家里希望走稳定路线'+extra+'。'}),120,'reply',user),null)
 for(const other of ['同学说：“'+user+'”','如果家里希望我走稳定路线，而我更在意留城，请更新判断。','我没说家里希望走稳定路线。请更新判断。',user+'请给一个小行动。',user.replace('请更新判断','不要更新判断')])assert.equal(groundedFeedbackPreview(other),null)
 for(const other of ['家里希望我走稳定路线。我自己更在意留在目前城市。请不要替我更新判断。','同学说，家里希望我走稳定路线。我自己更在意留在目前城市。请更新判断，不要替我选。'])assert.equal(groundedFeedbackPreview(other),null)
})
import {repairReviewedDefects} from '../server/review-repairs.ts'

test('a requested paused-direction summary can retain its complete clause before a long sentence ends',()=>{
 const user='先暂停考研方向，不删除刚才查过的事实。说明当前暂定理解和仍未知的地方，这周不再安排任务。'
 const frame='考研方向已暂停，查过的事实保留，这周不安排新任务。\n\n'
 const clause='当前暂定理解：你真正想要的是毕业后做有清晰产出的工作'
 const reply=frame+clause+'；你自己更在意留在目前城市；仍未知的地方等你准备好了再聊。'
 const prefix=JSON.stringify({reply}).split('；')[0]+'；'
 const draft=safeEarlySentence(prefix,120,'reply',user)
 assert.equal(draft,clause)
 const final=repairReviewedDefects(reply,user)?.reply??reply
 assert.ok(final.includes(draft!), 'the preview must be an exact retained fragment, not an operation claim')
})

test('summary clause previews do not surface incomplete quoted or conditional propositions',()=>{
 const user='请说明当前暂定理解和仍未知的地方。'
 for(const opening of ['当前暂定理解：如果你愿意改变方向再决定下一步','当前暂定理解：同学说“你应该马上确定方向','当前暂定理解：`先决定方向再观察效果']){
  assert.equal(safeEarlySentence(JSON.stringify({reply:opening+'；后续文字尚未到达'}),120,'reply',user),null,opening)
 }
})

test('summary previews retain source and operation gates across Unicode and request scope',()=>{
 const user='先暂停考研方向，不删除刚才查过的事实。说明当前暂定理解和仍未知的地方，这周不再安排任务。'
 const frame='考研方向已暂停，查过的事实保留，这周不安排新任务。\n\n'
 const clause='当前暂定理解：你希望毕业后做有清晰产出的工作'
 const wire=JSON.stringify({reply:frame+clause+'；其他内容尚未到达'}).replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))
 assert.equal(safeEarlySentence(wire,120,'reply',user),clause)
 for(const unauthorized of ['请给一个小行动。','同学说：“'+user+'”','如果我说“'+user+'”，你会怎么做？','```\n'+user+'\n```'])assert.equal(safeEarlySentence(JSON.stringify({reply:frame+clause+'；'}),120,'reply',unauthorized),null,unauthorized)
 for(const opening of ['考研方向已删除。','同学已采用方案。','考研方向已暂停，已帮你保存事实。'])assert.equal(safeEarlySentence(JSON.stringify({reply:opening+clause+'；'}),120,'reply',user),null,opening)
 for(const body of ['导师已读你的邮件','这证明你就是适合读研的人','这个方法有效而且能保证录取'])assert.equal(safeEarlySentence(JSON.stringify({reply:frame+'当前暂定理解：'+body+'；'}),120,'reply',user),null,body)
 assert.equal(safeEarlySentence(JSON.stringify({reply:clause}),120,'reply',user),null)
 assert.equal(safeEarlySentence(JSON.stringify({lead:clause+'；'}),120,'lead',user),null)
})

test('actual DE single-job first clause is the same bounded content in preview and final repair',()=>{
 const user='我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。给一个边界清楚的小行动。'
 const opening='选一个你感兴趣的远程岗位，在招聘平台读3份该岗位的JD，只记录其中关于工作时间、会议频率和响应要求的具体描述。'
 const reply=opening+'这个动作测的是公开信息里能看到的节奏线索，不联系任何人也不提供资料；投入上限30分钟，读完3份就停。'
 const final=repairReviewedDefects(reply,user)?.reply??reply
 for(const field of ['lead','reply'] as const){
  const draft=safeEarlySentence(JSON.stringify({[field]:opening}),120,field,user)
  assert.equal(draft,'选一个你感兴趣的远程岗位，在招聘平台读这个岗位的JD，只记录其中关于工作时间、会议频率和响应要求的具体描述')
  assert.ok(final.includes(draft!), 'the exact bounded fragment survives the real final repair path')
 }
 const multiple='只了解一个远程岗位，但请对照该岗位3份JD。'
 assert.match(safeEarlySentence(JSON.stringify({reply:opening}),120,'reply',multiple)!,/3份/)
})

test('early JD bounding never rewrites a past report, quotation or negative instruction',()=>{
 const user='只了解一个远程岗位。给一个小行动。'
 for(const reply of ['你此前读了3份该岗位的JD。','同学说：“我已经看过3份该岗位的JD”。','不要读3份该岗位的JD，先只列未知项。','如果读3份该岗位的JD会怎样？','读3份该岗位的JD，是你上周已完成的任务。','读3份该岗位的JD后，我发现会议很多。','读3份该岗位的JD并不合适。']){
  assert.equal(repairSingleJobJd(reply,user),null,reply)
  assert.equal(repairReviewedDefects(reply,user)?.reply??reply,reply,'full repair must also preserve '+reply)
 }
 assert.equal(safeEarlySentence(JSON.stringify({reply:'先阅读3份该岗位的JD，已经验证这能省时间。'}),120,'reply',user),null)
 assert.equal(safeEarlySentence('{"reply":"先阅读3份该岗位的JD',120,'reply',user),null)
})

test('an unsupported closed-universe lead is rejected by the same comparison guard before display',()=>{
 const text='在每周最多两小时、没有客户也不愿找客户的前提下，能比较的只有两类不需要接单的低成本探索。'
 const user='请比较一个更低成本的探索方式。'
 assert.equal(safeEarlySentence(JSON.stringify({lead:text}),120,'lead',user),null)
 assert.equal(safeEarlySentence(JSON.stringify({reply:text}),120,'reply',user),null)
})

test('a real comparison streams its complete substantive clause without waiting for the whole multi-clause option',()=>{
 const raw=readFileSync(new URL('./fixtures/real-comparison-db.txt',import.meta.url),'utf8').trim()
 const user='每周最多两小时。请比较一个更低成本的探索方式。'
 const prefix=raw.slice(0,raw.indexOf('；代价')+1)
 const draft=safeEarlySentence(prefix,120,'reply',user)
 assert.equal(draft,'1. 在当前学业或工作中争取一次自主安排专注时间的机会：从哪开始——挑一件本周必须完成的任务，向老师或负责人提出由你自定完成时段')
 assert.ok(JSON.parse(raw).reply.includes(draft))
 assert.equal(safeEarlySentence(prefix,120,'reply','只想聊聊，不做比较。'),null)
 for(const framing of ['方式一；','相比之下；','这里先解释一下两个选项的不同之处；','方式一：从哪开始——后续再详细说明具体步骤；'])assert.equal(safeEarlySentence(JSON.stringify({reply:framing}),120,'reply',user),null,framing)
 for(const label of ['路径一：','对象一：','选项甲：','一、']){
  const clause=label+'起点——回看一条本人已有的任务记录，不补猜结果'
  assert.equal(safeEarlySentence(JSON.stringify({reply:clause+'；后续说明还未到达'}),120,'reply',user),clause,label)
 }
})

test('opening unsupported choices preserves reported experience instead of a repeated generic judgment question',()=>{
 const raw='昨晚打完球觉得轻松，是身体活动开了的那种松快，还是和室友一起待着、暂时不用想别的事的感觉？'
 const opened=openUnreportedChoiceQuestion(raw,'昨晚和室友打羽毛球后觉得轻松。')
 assert.ok(opened?.includes('昨晚打完球觉得轻松'))
 assert.ok(!opened?.includes('影响你的判断'))
 for(const question of ['这种不用表现、能自然说话的状态，是昨晚打球时特有的，还是和这几个室友平时相处也这样？','接下来想继续这样相处，还是有别的想聊的？'])assert.equal(openUnreportedChoiceQuestion(question,'一起活动时不用表现，也能自然说话。'),null)
})
import {safeEarlySentence} from '../server/reply-draft.ts'

test('incomplete multi-KB drafts have bounded JSON decoding work',()=>{
 const raw=JSON.stringify({reply:'这是一段尚未到句尾的文字'.repeat(300)}),parse=JSON.parse
 let decodes=0
 try{
  JSON.parse=(...args:Parameters<typeof JSON.parse>)=>{decodes++;return parse(...args)}
  assert.equal(safeEarlySentence(raw),null)
 }finally{JSON.parse=parse}
 assert.ok(decodes<=32,`unfinished sentence caused ${decodes} full-prefix decodes`)
})

test('streamed drafts retain completed-sentence, Unicode and source-sensitive boundaries',()=>{
 // A heading such as “先核对课程的先修要求” is not substantive first content.
 const content='课程先修要求里，哪一门最容易卡住？',prefix='好的。'
 const encode=(value:unknown)=>JSON.stringify(value).replace(/[^\x00-\x7f]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'))
 for(const wire of [JSON.stringify({reply:prefix+content}),encode({reply:prefix+content})]){
  for(let end=0;end<=wire.length;end++){
   const draft=safeEarlySentence(wire.slice(0,end))
   assert.ok(draft===null||draft===content.slice(0,-1),JSON.stringify({end,draft}))
  }
  assert.equal(safeEarlySentence(wire),content.slice(0,-1))
 }
 for(const prefix of ['已帮你保存。','https://example.invalid。','你就是这样的人。'])assert.equal(safeEarlySentence(JSON.stringify({reply:prefix+content})),null)
 assert.equal(safeEarlySentence(JSON.stringify({reply:'围绕最近一次实际选课经历，可以这样问：\n\n'})),null)
 assert.equal(safeEarlySentence(JSON.stringify({reply:'课程先修要求里，哪一门最容易卡住\n\n还需了解具体课程。'})),content.slice(0,-1))
 assert.equal(safeEarlySentence(JSON.stringify({reply:'尚未完成的句子'})),null)
})

test('material headers do not count as content, while an actual completed answer still streams',()=>{
 for(const header of ['消息如下，你自行发送即可：','给同学的访谈问题：','这次可以从这里开始:']){
  assert.equal(safeEarlySentence(JSON.stringify({reply:header+'\n\n'})),null)
  assert.equal(safeEarlySentence(JSON.stringify({reply:header+'\n\n先问对方最近一次实际选课时怎么决定。'})),'先问对方最近一次实际选课时怎么决定')
 }
 assert.equal(safeEarlySentence(JSON.stringify({reply:'已为你保存：\n\n先问对方最近一次实际选课时怎么决定。'})),null)
})

test('observed portfolio completion announcement waits for actual material',()=>{
 const header='作品描述已按你实际负责的整理资料和排版撰写，代码部分未计入。'
 assert.equal(safeEarlySentence(JSON.stringify({reply:header})),null)
 assert.equal(safeEarlySentence(JSON.stringify({reply:header+'本人负责课程小组的资料整理和排版。'})),'本人负责课程小组的资料整理和排版')
 assert.equal(safeEarlySentence(JSON.stringify({reply:'我已替你发送作品描述。本人负责资料整理。'})),null)
})
