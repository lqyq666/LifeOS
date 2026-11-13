import test from 'node:test'
import assert from 'node:assert/strict'
import {productModePrompt,productModeOpeningPrompt,productModeRequest,DIRECTION_OPTIONS,UNDERSTANDING_DIMENSIONS} from '../src/features/conversation/product-modes.ts'
import {buildTurnPrompt,providerTurnMessages} from '../server/turn-prompt.ts'
import {limitGrillingQuestions,groundUnsupportedOperationalResources} from '../server/reply-draft.ts'
import {repairReviewedDefects} from '../server/review-repairs.ts'

test('mode buttons start an open conversation without choosing paths or campus matters',()=>{
 for(const mode of ['understand','directions','choice'] as const){
  const prompt=productModeOpeningPrompt(mode)
  assert.ok(productModeRequest(prompt))
  assert.match(prompt,/当前允许使用的已有资料/)
  assert.match(prompt,/问/)
  assert.match(prompt,/不修改档案、目标或长期记忆/)
  assert.match(prompt,/不创建任务或经历/)
 }
 assert.match(productModeOpeningPrompt('directions'),/还没有选定路径/)
 assert.match(productModeOpeningPrompt('directions'),/不要求我先选两三条路/)
 assert.match(productModeOpeningPrompt('choice'),/不先列一组选项/)
 for(const mode of ['directions','choice'] as const){
  assert.match(productModeOpeningPrompt(mode),/开场先等我回答/)
  assert.match(productModeOpeningPrompt(mode),/不展开方法步骤/)
 }
 assert.match(productModeOpeningPrompt('understand'),/不要展开整份画像/)
})

test('fixed modes organize requests without asserting a selected path, action or personal fact',()=>{
 assert.equal(UNDERSTANDING_DIMENSIONS.length,6)
 for(const title of ['保研','考研','考公','考编','就业','创业','留学'])assert.ok(DIRECTION_OPTIONS.some(p=>p.title===title))
 assert.throws(()=>productModePrompt('directions',['就业']),/两到三/)
 assert.throws(()=>productModePrompt('directions',['就业','就业']),/两到三/)
 assert.throws(()=>productModePrompt('directions',['就业','虚构']),/两到三/)
 const text=productModePrompt('directions',['考研','就业'],'','这周只剩两小时，不是长期可用时间。')
 for(const phrase of ['个人依据','时间投入','共同准备','独有投入','最小验证行动','官方资格','不代表我已选择','这周只剩两小时'])assert.ok(text.includes(phrase))
 assert.match(productModePrompt('choice',[],'竞赛'),/先问关键缺口/)
 assert.throws(()=>productModePrompt('choice',[],'伪造活动'),/校园事项/)
 assert.match(productModePrompt('understand'),/不能由单次经历断言稳定人格/)
 assert.match(productModePrompt('understand'),/没有候选来源就省略观察栏目/)
 assert.equal(productModeRequest('引用：【选方向】\n就业'),null)
 assert.equal(productModeRequest('```\n【选方向】\n```'),null)
})

test('understanding reads only supplied live candidate observations and never fills empty observation slots',()=>{
 const render=(growth:any[])=>providerTurnMessages(JSON.stringify({currentUserMessage:{id:'q',role:'user',text:productModePrompt('understand')},messages:[],growth}),{provider:'bailian',id:'qwen3.8-flash'}).at(-1)!.content as string
 const candidate={id:'candidate',revision:2,status:'proposed',assertion:'ai_observation',text:'两次记录都提到收到反馈后修改。',sources:[{type:'message',id:'one',quote:'我修改了。'}]}
 const result=render([candidate,{...candidate,id:'forgotten',status:'forgotten',text:'不可回读观察'},{...candidate,id:'unavailable',unavailableReason:'source_changed',text:'失效观察'}])
 assert.match(result,/savedObservationSources/);assert.ok(result.includes(candidate.text));assert.ok(!result.includes('不可回读观察'));assert.ok(!result.includes('失效观察'))
 assert.ok(render([]).includes('"savedObservationSources":[]'));assert.match(render([]),/不能新增观察/)
})

test('one unknown outreach channel never replaces an entire requested direction comparison',()=>{
 const user=productModePrompt('directions',['就业','创业','考研'])
 const analysis='**就业**\n已有脚本经历，岗位能力仍待核实。\n**创业**\n客户与收入未知。\n**考研**\n研究能力与资格未知。\n**最小验证行动**\n'
 const reply=analysis+'从校园社群联系从业者。\n**测什么**\n了解实际工作节奏。\n**停止条件**\n联系不到就停。'
 const fixed=groundUnsupportedOperationalResources(reply,user)!
 assert.ok(fixed.startsWith(analysis));assert.ok(!fixed.includes('校园社群'));assert.match(fixed,/未确认可用渠道前/)
 assert.ok(fixed.includes('了解实际工作节奏。'));assert.ok(fixed.includes('联系不到就停。'))
})

test('campus trial advice qualifies an unsupported unique completion guarantee without dropping its steps',()=>{
 const user=productModePrompt('choice',[],'竞赛','本周可用三十分钟。')
 const promise='这是唯一能在当前预算内完成、且能显著降低决策不确定性的动作。'
 const before='### 最小尝试\n向邀请你的同学问清三个具体信息。\n',after='\n### 停止条件\n时间用完就停，不承诺参赛。'
 const reply=before+promise+after,changed=repairReviewedDefects(reply,user)
 assert.ok(changed?.phases.includes('choice_action_guarantee'))
 assert.ok(changed!.reply.startsWith(before));assert.ok(changed!.reply.endsWith(after))
 assert.ok(!changed!.reply.includes('唯一能'));assert.ok(!changed!.reply.includes('显著降低'));assert.ok(changed!.reply.includes('以实际进展为准'))
 for(const mode of [productModePrompt('understand'),productModePrompt('directions',['就业','考研'])])assert.equal(repairReviewedDefects(reply,mode)?.reply??reply,reply)
 const quoted=before+'“'+promise+'”'+after
 assert.equal(repairReviewedDefects(quoted,user)?.reply??quoted,quoted)
 const confirmed=productModePrompt('choice',[],'竞赛','我已核实，'+promise)
 assert.equal(repairReviewedDefects(reply,confirmed)?.reply??reply,reply)
 const unknowns='**待补关键信息**：\n* 未来三周的可用时间。\n* 竞赛截止日期。'
 const preserved=repairReviewedDefects(unknowns,user)?.reply??unknowns
 assert.match(preserved,/^\*\*(?:待补关键信息|仍待确认)\*\*：\n\*/)
 assert.ok(preserved.endsWith('* 未来三周的可用时间。\n* 竞赛截止日期。'))
})

test('campus competition trial preserves past-problem content while unrelated exam preparation stays suppressed',()=>{
 const user=productModePrompt('choice',[],'竞赛','校园数据建模竞赛，需要连续四周每周约六小时。')
 const reply='### 自学模拟\n利用周末时间找一道往年真题，独自完成全流程。\n### 停止条件\n超出本周可用时间就停。'
 assert.equal(repairReviewedDefects(reply,user)?.reply??reply,reply)
 const unrelated='### 自学模拟\n先刷考研真题。\n### 停止条件\n超出本周可用时间就停。'
 assert.ok(!(repairReviewedDefects(unrelated,user)?.reply??unrelated).includes('考研真题'))
})

test('six-dimensional understanding keeps requested unknowns and two key questions without widening ordinary followups',()=>{
 const reply='### 行为方式\n**未知**：没有外部反馈时怎样自查？遇到分歧时怎样处理？\n### 最关键的两个问题\n1. 这次产品要验证什么？\n2. 本周时间分配在哪里？'
 assert.equal(limitGrillingQuestions(reply,productModePrompt('understand')),null)
 assert.notEqual(limitGrillingQuestions(reply,'先只问我一个问题。'),null)
 assert.notEqual(limitGrillingQuestions(reply,'引用：“【认识我】”\n先聊聊。'),null)
 assert.notEqual(limitGrillingQuestions(reply,productModePrompt('understand')+'先只问我一个问题。'),null)
})

test('mode request repeats only authorized active source boundaries and keeps ordinary input exact',()=>{
 const context={currentUserMessage:{id:'request',role:'user',text:productModePrompt('directions',['就业','创业'])},messages:[],growth:[
  {id:'time',revision:2,status:'active',kind:'constraint',text:'本周可用六小时。',sources:[{type:'user_edit'}]},
  {id:'missing',revision:1,status:'active',kind:'unknown',text:'尚未提供客户与收入信息。',sources:[{type:'user_edit'}]},
  {id:'forgotten',status:'forgotten',kind:'ability',text:'不可使用的旧经历',sources:[{type:'user_edit'}]},
  {id:'unavailable',status:'active',unavailableReason:'source_invalid',kind:'ability',text:'失效来源',sources:[{type:'user_edit'}]},
  {id:'no-source',status:'active',kind:'ability',text:'无来源记录',sources:[]},
 ]}
 const render=(data:unknown)=>providerTurnMessages(JSON.stringify(data),{provider:'bailian',id:'qwen3.8-flash'}).at(-1)!.content as string
 const text=render(context);assert.match(text,/本周可用六小时/);assert.match(text,/尚未提供客户与收入信息/)
 for(const phrase of ['不可使用的旧经历','失效来源','无来源记录'])assert.ok(!text.includes(phrase))
 assert.match(text,/其他周未知/);assert.match(text,/不据此证明稳定执行力/)
 assert.match(text,/个人细节只引用本人原话/)
 assert.match(text,/候选观察也不能猜测人格或动机/)
 assert.match(text,/完整参与与最小验证分别估计投入/)
 assert.match(text,/已报告的能力自述仍按本人自述承接/)
 assert.ok(!render({...context,growth:[]}).includes('本周可用六小时'))
 assert.equal(render({...context,currentUserMessage:{id:'ordinary',role:'user',text:'我只想被听见。'}}),'我只想被听见。')
})
test('mode metadata is current-request only; ordinary chat and listening retain their prompt shape',()=>{
 const id='11111111-1111-4111-8111-111111111111'
 const render=(text:string)=>JSON.parse(buildTurnPrompt({currentMessageId:id,messages:[{id,role:'user',content:text,created_at:new Date().toISOString()}]}))
 assert.equal(render('我只想被听见，先不要建议。').currentTask.responseScope.entryRequest,undefined)
 assert.equal(render(productModePrompt('directions',['就业','考研'])).currentTask.responseScope.entryRequest.title,'选方向')
 const current=render('这周只有两小时，之前的建议先暂停。');assert.equal(current.currentTask.responseScope.entryRequest,undefined)
})


test('path motive guard removes only an unreported escape hypothesis and preserves source-backed self-report',()=>{
 const user=productModePrompt('directions',['就业','创业','考研'])
 const sentence='若为逃避就业而考，动机未确认，不作推断。'
 const reply='### 考研\n'+sentence+'\n资格和研究兴趣未知。\n### 最小验证\n看一个公开课题，时间到就停。'
 const changed=repairReviewedDefects(reply,user,[],{reportedPersonalEvidence:['我重视自主和创造。']})
 assert.ok(changed?.phases.includes('path_motive_neutrality'))
 assert.ok(!changed!.reply.includes('逃避就业'));assert.ok(changed!.reply.includes('考研动机尚未确认'))
 assert.ok(changed!.reply.endsWith('资格和研究兴趣未知。\n### 最小验证\n看一个公开课题，时间到就停。'))
 for(const source of ['我确实是为了逃避就业才考虑考研。'])assert.equal(repairReviewedDefects(reply,user,[],{reportedPersonalEvidence:[source]})?.reply??reply,reply)
 for(const source of ['我不想逃避就业。','我不是为了逃避就业才考研。','我是在逃避就业吗？','同学说他想逃避就业。','如果我只是想逃避就业呢？','“我想逃避就业。”'])assert.ok(!(repairReviewedDefects(reply,user,[],{reportedPersonalEvidence:[source]})?.reply??reply).includes('逃避就业'),source)
 const quoted='“'+sentence+'”'
 assert.equal(repairReviewedDefects(quoted,user)?.reply??quoted,quoted)
 assert.equal(repairReviewedDefects(reply,'只继续普通聊天。')?.reply??reply,reply)
})

test('campus uncertainty does not deny an actual prior contest award',()=>{
 const user=productModePrompt('choice',[],'竞赛')
 const reply='在没有过往竞赛成绩或团队实力评估的情况下，获奖概率未知。\n### 停止条件\n时间到就停。'
 const fixed=repairReviewedDefects(reply,user,[],{reportedPersonalEvidence:['我独立完成三人比赛任务，获得二等奖。']})
 assert.ok(fixed?.phases.includes('campus_evidence_scope'));assert.ok(fixed!.reply.includes('本次竞赛的历史成绩数据尚未核实'))
 assert.ok(fixed!.reply.endsWith('获奖概率未知。\n### 停止条件\n时间到就停。'))
 for(const text of ['我没有竞赛成绩。','如果我获得二等奖呢？','同学参加比赛获得二等奖。'])assert.equal(repairReviewedDefects(reply,user,[],{reportedPersonalEvidence:[text]})?.reply??reply,reply)
 assert.equal(repairReviewedDefects('“'+reply+'”',user,[],{reportedPersonalEvidence:['我参加比赛获得二等奖。']})?.reply??'“'+reply+'”','“'+reply+'”')
})


test('campus reply distinguishes related experience, full participation and a timed attempt without losing options',()=>{
 const user=productModePrompt('choice',[],'竞赛','竞赛要求连续四周每周六小时，本周只有三十分钟。')
 const reply='### 参加价值\n**能力匹配度较高**：竞赛资料整理与答辩，这与你的实际经历高度重合。\n### 约束\n这意味着**本周无法启动实质性的竞赛工作**（如建模、写代码或深度整理资料）。\n### 选项\n1. 拒绝：本周时间不足以启动。\n2. 调整：利用已有能力（资料整理、答辩）贡献价值。\n3. 先获取信息。\n### 最小尝试\n发消息问分工与弹性。它能在30分钟内完成（仅涉及沟通，不涉及实际建模工作）。\n### 停止条件\n三十分钟到就停，不承诺参赛。'
 const changed=repairReviewedDefects(reply,user)!
 assert.ok(changed.phases.includes('campus_evidence_scope'));assert.ok(changed.phases.includes('choice_action_guarantee'))
 for(const text of ['能力匹配度较高','高度重合','无法启动实质性','时间不足以启动','利用已有能力（资料整理、答辩）','它能在30分钟内完成'])assert.ok(!changed.reply.includes(text),text)
 for(const text of ['### 参加价值','### 约束','1. 拒绝','2. 调整','3. 先获取信息','发消息问分工与弹性','### 停止条件','三十分钟到就停'])assert.ok(changed.reply.includes(text),text)
 assert.match(changed.reply,/是否完成或收到回复仍未知/)
 const quoted='“'+reply+'”';assert.equal(repairReviewedDefects(quoted,user)?.reply??quoted,quoted)
 assert.equal(repairReviewedDefects(reply,'只聊天。')?.reply??reply,reply)
})


test('campus boundary covers another actual impossible-start wording and unreported past duration',()=>{
 const user=productModePrompt('choice',[],'竞赛','本周可用三十分钟。')
 const reply='这与之前的短期独立任务不同。**本周无法启动任何实质性准备**。以下是零时间成本或极低时间成本的步骤：\n### 小尝试\n问同学分工，时间到即停。'
 const changed=repairReviewedDefects(reply,user)!
 assert.ok(!changed.reply.includes('无法启动任何'));assert.ok(!changed.reply.includes('短期独立任务'));assert.ok(!changed.reply.includes('零时间成本'))
 assert.ok(changed.reply.includes('实际持续时长尚未核实'));assert.ok(changed.reply.endsWith('### 小尝试\n问同学分工，时间到即停。'))
 const parsed=JSON.parse(buildTurnPrompt({currentMessageId:'q',messages:[{id:'q',role:'user',content:user,created_at:new Date().toISOString()}]}));assert.ok(parsed.currentTask.responseScope.rules.some((s:string)=>s.includes('校园机会分析：')))
 const ordinary=JSON.parse(buildTurnPrompt({currentMessageId:'q',messages:[{id:'q',role:'user',content:'只想听你说说。',created_at:new Date().toISOString()}]}));assert.ok(!ordinary.currentTask.responseScope.rules.some((s:string)=>s.includes('校园机会分析：')))
})


test('campus qualifier covers captured ability extrapolation and another budget variant with complete content',()=>{
 const user=productModePrompt('choice',[],'竞赛')
 const reply='### 已有经历\n这说明具备独立处理复杂任务的能力。视频实践暗示一定的综合呈现能力。\n### 约束\n本周内无法启动任何实质性准备，甚至无法完成一次完整的会议或代码调试。本周时间预算不足以支撑任何实质行动。\n### 可选步骤\n这部分工作上手成本低；核对你正在学习的Python/API等技能。\n### 停点\n时间到就停。'
 const changed=repairReviewedDefects(reply,user)!
 for(const bad of ['具备独立处理复杂任务的能力','暗示一定的综合呈现能力','无法启动任何实质性准备','无法完成一次完整的会议','不足以支撑任何实质行动','上手成本低','正在学习的Python'])assert.ok(!changed.reply.includes(bad),bad)
 for(const title of ['已有经历','约束','可选步骤','停点'])assert.ok(changed.reply.includes(title))
 assert.ok(changed.reply.endsWith('时间到就停。'))
 const quoted='“'+reply+'”';assert.equal(repairReviewedDefects(quoted,user)?.reply??quoted,quoted)
 const message=providerTurnMessages(JSON.stringify({currentUserMessage:{id:'q',role:'user',text:user},messages:[],growth:[]}),{provider:'bailian',id:'qwen3.8-flash'}).at(-1)!.content as string;assert.ok(message.includes('校园机会分析：'))
})


test('captured campus reply does not guarantee a zero-progress week or completion within thirty minutes',()=>{
 const user=productModePrompt('choice',[],'竞赛')
 const reply='### 投入冲突\n**在本周内无法完成任何实质性的组队磨合或模型构建工作**。这不代表不能启动准备。了解信息、询问细节或进行极短的体验式接触，可以在30分钟内完成。\n### 下一步\n问邀请的同学分工，时间到就停。'
 const changed=repairReviewedDefects(reply,user)!
 assert.ok(changed.phases.includes('campus_evidence_scope'));assert.ok(changed.phases.includes('choice_action_guarantee'))
 assert.ok(!changed.reply.includes('无法完成任何实质性'));assert.ok(!changed.reply.includes('可以在30分钟内完成'))
 assert.ok(changed.reply.includes('这不代表不能启动准备'));
 const butStep='本周无法启动任何实质性准备但可以先问同学分工。';assert.ok((repairReviewedDefects(butStep,user)?.reply??butStep).endsWith('但可以先问同学分工。'));
 assert.ok(changed.reply.endsWith('问邀请的同学分工，时间到就停。'))
 const quoted='“'+reply+'”';assert.equal(repairReviewedDefects(quoted,user)?.reply??quoted,quoted)
})


test('fixed mode source clarification never becomes an unrequested week or two-hour freelance plan',()=>{
 const answer='### 个人依据\n已有任务记录，岗位熟练度仍未知。\n### 最小取证动作\n你手上已有哪一个可用来源？\n### 停止条件\n未确认渠道前不执行，时间到就停。'
 for(const user of [productModePrompt('directions',['就业','创业','考研'],'','请比较三条路，付费客户与收入尚未提供。'),productModePrompt('understand'),productModePrompt('choice',[],'竞赛','比较参与方式，客户与收入未知。')]){
  const fixed=repairReviewedDefects(answer,user)?.reply??answer
  assert.ok(!fixed.includes('两小时'));assert.ok(!fixed.includes('用一周'))
  assert.ok(fixed.includes('你手上已有哪一个可用来源？'));assert.ok(fixed.startsWith('### 个人依据\n已有任务记录，岗位熟练度仍未知。'));assert.ok(fixed.endsWith('未确认渠道前不执行，时间到就停。'))
 }
})

test('fixed modes qualify captured prize and one-task capability extrapolations without dropping paths',()=>{
 const user=productModePrompt('directions',['就业','创业','考研'])
 const claims=['这显示一定的技术基础','这显示了你具备基本的工程执行力和对反馈的快速响应能力','这些经历证明你有能力在缺乏外部支持时推进项目']
 for(const claim of claims){
  const reply='### 科研\n你有比赛获奖经历。'+claim+'，但长期表现未知。\n### 就业\n核对岗位要求。\n### 产品\n核对真实需求。\n### 行动\n读一份JD，三十分钟到就停。'
  const fixed=repairReviewedDefects(reply,user)?.reply??reply
  assert.ok(!fixed.includes(claim),claim)
  assert.ok(fixed.startsWith('### 科研\n你有比赛获奖经历。'))
  assert.ok(fixed.endsWith('，但长期表现未知。\n### 就业\n核对岗位要求。\n### 产品\n核对真实需求。\n### 行动\n读一份JD，三十分钟到就停。'))
  assert.match(fixed,/当次|这次/)
 }
})

test('mode capability boundary keeps quotations, code, negative claims and direct self-reports',()=>{
 const user=productModePrompt('understand')
 for(const reply of ['“这显示一定的技术基础”。','`这显示一定的技术基础`','这不能证明你具备稳定能力。','是否具备技术基础仍未知。','你自述“我熟练掌握Python和Git”。'])assert.equal(repairReviewedDefects(reply,user)?.reply??reply,reply)
 const reply='哪些是你已掌握的（如Python、Git），哪些是未知的？'
 const fixed=repairReviewedDefects(reply,user)?.reply??reply
 assert.ok(!fixed.includes('你已掌握的'));assert.ok(fixed.includes('Python、Git'));assert.match(fixed,/需核实/)
 assert.equal(repairReviewedDefects(reply,user,[],{reportedPersonalEvidence:['我熟练掌握Python和Git。']})?.reply??reply,reply)
 for(const reported of ['我还没掌握Python和Git。','我掌握Excel。','我是否已经掌握Python和Git？'])assert.ok(!(repairReviewedDefects(reply,user,[],{reportedPersonalEvidence:[reported]})?.reply??reply).includes('你已掌握的'))
})

test('a captured time-to-stop budget is not rewritten as a completion guarantee',()=>{
 const user=productModePrompt('directions',['就业','创业','考研'])
 const reply='### 本周最小取证动作\n选择一条路径，了解准入条件。\n**停止条件**：\n1. 时间用完（严格控制在30分钟内）。\n2. 收集到三条条件就停。'
 assert.equal(repairReviewedDefects(reply,user)?.reply??reply,reply)
 const guarantee='此步骤可在30分钟内完成。';assert.notEqual(repairReviewedDefects(guarantee,user)?.reply??guarantee,guarantee)
})
