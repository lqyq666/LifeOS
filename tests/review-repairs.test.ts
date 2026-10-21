import {readFileSync} from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

test('NN visible first action keeps its duration rather than mistaking it for a job count',()=>{
 const user='只看一个公开远程岗位，不投递、不联系任何人。请给能开始的一步。'
 const reply='用30分钟读一个公开远程岗位的招聘页，只记录它写明的上下班或响应要求。'
 assert.equal(fix(user,reply),reply)
})

test('repeated feelings do not transfer an earlier reported cause to the new episode',()=>{
 const earlier='让我轻松的主要是一起活动时不用表现，也能自然说话；不是因为我打得好。'
 const latest='回来反馈：一周后我又和同一个室友打了一次，仍然放松，但当天身体累所以提前结束。不要用一次疲惫推翻之前的感受。'
 const reply='两次同一个人、同一项活动都让你不用表现就能自然说话，这个条件目前没变。'
 for(const claim of [reply,'两次都由此轻松。','这两次都是因此放松，至于是室友还是运动仍未知。','每次都源于不用表现。']){
  const out=repairReviewedDefects(claim,latest,[earlier])?.reply??claim
  assert.notEqual(out,claim)
  assert.match(out,/本次.*原因.*未知|原因.*是否相同.*未知/)
 }
 assert.equal(repairReviewedDefects(reply,latest.replace('仍然放松','仍然放松，因为也不用表现就能自然说话'),[earlier])?.reply??reply,reply)
 assert.equal(repairReviewedDefects(reply,'朋友说：“'+latest+'”',[earlier])?.reply??reply,reply)
 for(const claim of ['不能说两次都由此轻松。','是否两次都由此轻松仍未知。','“两次都由此轻松”是未经核实的解释。','两次都放松，但尚不清楚原因是否相同。'])assert.equal(repairReviewedDefects(claim,latest,[earlier])?.reply??claim,claim)
})

test('a reported repeat feeling is not mislabeled unknown while its cause stays unknown',()=>{
 const earlier='昨晚和室友打羽毛球后觉得轻松。'
 const latest='回来反馈：一周后我又和同一个室友打了一次，仍然放松，但当天身体累所以提前结束。不要用一次疲惫推翻之前的感受。'
 const update='请更新这段经历的局部理解，保留未知；不生成任务。'
 const reply='两次和同一室友打球都报告放松，本人解释主要因不用表现。提前结束仅因身体累，不推翻该感受。仍未知的是：放松源于运动本身还是这位室友；各次经历的感受是否一致。'
 const out=repairReviewedDefects(reply,update,[earlier,latest])?.reply??reply
 assert.doesNotMatch(out,/各次经历的感受是否一致|感受是否相同仍未知/)
 assert.match(out,/两次.*放松/)
 assert.match(out,/原因.*未知|来源.*未知/)
 assert.doesNotMatch(out,/两次和同一室友打球都报告放松，本人解释主要因不用表现/)
 const noSecondSelfReport=repairReviewedDefects(reply,update,[earlier])?.reply??reply
 assert.match(noSecondSelfReport,/各次经历的感受是否一致/,'a question or an assistant assertion cannot substitute for the second self-report')
 const attributed='朋友说：“一周后我又和同一个室友打了一次，仍然放松。”'
 const otherPerson=repairReviewedDefects(reply,update,[earlier,attributed])?.reply??reply
 assert.match(otherPerson,/各次经历的感受是否一致/,'another person’s quoted report cannot establish the user’s feeling')
})

test('repeating the same report does not prove a second experience or resolve its feeling',()=>{
 const earlier='昨晚打球后很放松。'
 const duplicate='我再次说明，昨晚打球后很放松。'
 const current='今天又打了一次，感受还没想清楚。'
 const reply='各次经历的感受是否一致仍未知。'
 assert.equal(repairReviewedDefects(reply,current,[earlier,duplicate]),null)
})

test('negated feeling reports are not promoted into repeated positive feelings',()=>{
 const update='请更新这段经历的局部理解，保留未知；不生成任务。'
 const reply='仍未知的是：各次经历的感受是否一致。'
 const cases:[string,string][]=[
  ['放松','不觉得轻松'],
  ['开心','没有感到开心'],
  ['紧张','不再紧张'],
  ['舒服','谈不上舒服'],
  ['放松','不怎么放松'],
  ['开心','未必开心'],
  ['放松','不觉得这一次很轻松'],
  ['开心','并没有觉得最近真的开心'],
 ]
 for(const [label,feeling] of cases){
  const earlier=`昨晚和室友打羽毛球后${feeling}。`
  const latest=`回来反馈：一周后我又和同一个室友打了一次，${feeling}。`
  const out=repairReviewedDefects(reply,update,[earlier,latest])?.reply??reply
  assert.doesNotMatch(out,new RegExp(`本人已分别报告两次${label}`),feeling)
  assert.match(out,/感受是否一致/,feeling)
 }
 const earlier='昨晚我不擅长打球，但之后觉得轻松。'
 const latest='回来反馈：一周后我又和同一个室友打了一次，仍然轻松。'
 const positiveOut=repairReviewedDefects(reply,update,[earlier,latest])?.reply??reply
 assert.doesNotMatch(positiveOut,/感受是否一致/,'a negation in a prior contrast clause does not suppress the positive report')
})

test('a no-inference instruction does not establish absence of the target property',()=>{
 const user='请更新这段经历的局部理解，保留未知；不生成任务，也不要把主要节点数量当人生价值排名。'
 const reply='该偏好与其他生活方向之间不存在价值排序关系。'
 const out=fix(user,reply)
 assert.doesNotMatch(out,/不存在价值排序/)
 assert.match(out,/不能凭.*主要节点数量.*推断.*人生价值排名/)
 assert.equal(fix('我明确说不同方向之间不存在价值排序关系。',reply),reply)
 assert.equal(fix('朋友说：“不要把主要节点数量当人生价值排名。”',reply),reply)
})

test('observed outcome repair does not turn a previously reported motive into an unknown',()=>{
 const user='接着整理资料的探索。最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。请根据新信息更新判断，不要重复问已经回答的内容。'
 const reply='这支持你减少反复找东西时间的偏好，但少问一次与定规则之间的因果仍是待验证假设。'
 const out=fix(user,reply)
 assert.equal(out,reply)
 for(const statement of ['你减少反复找东西时间的偏好很明确。','你减少反复找东西时间的意愿没有改变。'])assert.equal(fix(user,statement),statement)
 for(const intention of ['你减少查找时间的目标需要实现。','你减少查找时间的目标应该得到满足。'])assert.equal(fix(user,intention),intention)
 for(const claim of ['你减少查找时间的目标已经完成。','你减少查找时间的目标已经做到。','你减少查找时间的目标产生效果。','你减少整理和反复找东西时间的目标已经实现。']){
  const bounded=fix(user,claim)
  assert.notEqual(bounded,claim);assert.match(bounded,/实际收益仍未确认/)
 }
 const overclaim=fix(user,'分类规则减少了整体查找时间。')
 assert.match(overclaim,/仍不能确认|仍未知/)
})

test('one reported chronological observation keeps variable counts and objects without inventing earlier goals',()=>{
 for(const [change,result] of [['四条标签','两份材料'],['一个索引','三份笔记'],['两条命名规则','一份文件']]){
  const user=`最近一次我先定了${change}，后来同学能直接找到${result}，少问了我一次。请根据新信息更新判断，不要重复问已经回答的内容。`
  const reply=`这次定${change}后同学找到${result}，说明这个做法确实减少了沟通；但只发生一次。`
  const out=fix(user,reply)
  assert.doesNotMatch(out,/说明这个做法确实减少了沟通|你此前希望/)
  assert.ok(out.includes(change)&&out.includes(result),out)
  assert.match(out,/不能确认|不证明|未知/)
 }
})

test('observation correction does not collapse mixed sources, valid updates, experiments or requested actions',()=>{
 const observation='最近一次我先定了四条标签，后来同学能直接找到两份材料，少问了我一次。'
 const request='请根据新信息更新判断。',claim='说明这个做法确实减少了沟通。'
 for(const user of ['同学说：“'+observation+'”'+request,'如果'+observation+request,'```\n'+observation+'\n```'+request,observation+'老师那封邮件仍未回复。'+request,'老师邮件仍未回复，'+observation+request,observation+request+'给一个本周能做的小动作。','最近一次我做了随机对照试验，后来同学能直接找到两份材料。'+request]){
  assert.equal(fix(user,claim),claim,user)
 }
 const valid='你已报告了这一次的具体结果，因果关系仍未知。需要区分你自己的收益和同学的反馈。'
 assert.equal(fix(observation+request,valid),valid)
 assert.equal(fix(observation+request,'同学说：“说明这个做法确实减少了沟通。”'),'同学说：“说明这个做法确实减少了沟通。”')
 assert.equal(fix(observation+request+'只给我一句阶段理解。',claim),claim,'this multi-sentence correction must not override an explicit one-sentence contract')
})

test('a chronological belief or unperformed scenario is not upgraded to an observed result',()=>{
 const reply='说明这个做法确实减少了沟通。'
 for(const verb of ['使','让']){
  const user='最近一次我先定了一个索引，后来这个做法'+verb+'同学找到三份笔记。请根据新信息更新判断。'
  assert.equal(fix(user,reply),reply,user)
 }
 for(const text of ['最近一次我先定了四条标签，后来同学想直接找到两份材料。','最近一次我先定了四条标签，后来我以为同学能直接找到材料。','最近一次我先定了四条标签，后来同学找到材料只是我的猜测。','最近一次我先定了四条标签，后来同学能直接找到材料，这段事情还没发生。']){
  assert.equal(fix(text+'请根据新信息更新判断。',reply),reply,text)
 }
})

test('affirmative causal correction preserves statements that explicitly deny the causal inference',()=>{
 const user='最近一次我先定了四条标签，后来同学能直接找到两份材料，少问了我一次。请根据新信息更新判断。'
 for(const reply of ['同学少问一次并不说明做法减少沟通。','这个结果不表明规则有效。','这不意味着规则已减少了沟通。','这不等于已证明规则有效。'])assert.equal(fix(user,reply),reply,reply)
})

test('causal correction is subtractive and preserves independent unknowns and prior repairs',()=>{
 const observation='最近一次我先定了四条标签，后来同学能直接找到两份材料，少问了我一次。'
 const request='请根据新信息更新判断。'
 const out=fix(observation+request,'说明这个做法确实减少了沟通。是否能复现仍未知。')
 assert.doesNotMatch(out,/说明这个做法确实减少了沟通/)
 assert.ok(out.includes('是否能复现仍未知。'),out)
 const mixed=observation.replace('。','，老师那封邮件仍未回复。')+request
 const mixedReply='老师邮件仍未回复。说明这个做法确实减少了沟通。'
 assert.equal(fix(mixed,mixedReply),mixedReply,'an extra independent source clause stays outside this bounded correction')
 assert.doesNotMatch(fix(observation+request,'说明这个做法确实减少了沟通。是否能复现仍未知）。'),/）/,'local correction must not restore an unmatched parenthesis removed by an earlier phase')
 assert.equal(fix(observation+request,'已有一次线索，可以继续观察其他课程。是否能复现仍未知。'),'已有一次线索。是否能复现仍未知。','removing an unrequested action must not join independent sentences')
 assert.doesNotMatch(fix(observation+request,'可以继续观察其他课程。'),/继续观察/,'an all-action reply must not be restored by a falsy empty repair')
})

test('a single observation does not soften a rule-effect claim into a still-asserted this-time effect',()=>{
 const user='最近一次我先定了四条标签，后来同学能直接找到两份材料，少问了我一次。请根据新信息更新判断。'
 const out=fix(user,'规则有效。')
 assert.doesNotMatch(out,/这次有效/)
 assert.match(out,/不能.*有效|是否.*有效.*未知/)
})

test('observation bounds cover bare generic effects but preserve repetition and future uncertainty',()=>{
 const observation='最近一次我先定了一个索引，后来同学找到三份笔记。',request='请根据新信息更新判断。'
 assert.match(fix(observation+request,'规则有效。'),/不能确认/)
 const future='这表明做法减少了未来的沟通成本。'
 assert.equal(fix(observation+request,future),future,'a future-scope claim is outside this retrospective observation repair; preservation is not semantic approval')
 for(const reply of ['未来是否有效仍未知。','我希望未来规则有效。'])assert.equal(fix(observation+request,reply),reply)
 for(const tail of ['这是第二次','又一次','再次出现','已有两次']){
  const user=observation.replace('。','，'+tail+'。')+request
  assert.equal(fix(user,'说明这个做法确实减少了沟通。'),'说明这个做法确实减少了沟通。',tail)
 }
 const mixed=observation.replace('。','，导师已回复。')+request
 assert.equal(fix(mixed,'说明这个做法确实减少了沟通。'),'说明这个做法确实减少了沟通。')
 assert.equal(fix(observation+request,'我希望规则有效。'),'我希望规则有效。')
})

test('generic effect softening shares source ownership and refuses indivisible compound claims',()=>{
 const observation='最近一次我先定了四条标签，后来同学找到两份材料，少问了我一次。',request='请根据新信息更新判断。'
 for(const user of ['同学说：“'+observation+'”'+request,'如果'+observation+request,observation+'老师邮件仍未回复。'+request])assert.equal(fix(user,'规则有效。'),'规则有效。',user)
 const user='最近一次我先定了一个索引，后来同学找到三份笔记。'+request
 for(const suffix of ['给一个本周能做的小动作。','只给我一句阶段理解。','比较一下两种做法。']){
  const boundedUser=observation+request+suffix
  assert.equal(fix(boundedUser,'规则有效。'),'规则有效。','the earlier generic repair must share requested delivery boundaries: '+suffix)
  assert.equal(fix(boundedUser,'分类规则已验证有效。'),'分类规则已验证有效。','legacy literal replacements share the same delivery boundary')
 }
 const repeated=observation.replace('。','，这是第二次。')+request
 assert.equal(fix(repeated,'分类规则已验证有效。'),'分类规则已验证有效。','the legacy literal replacement cannot bypass repeated-source deferral')
 const compound='这说明规则有效且同学少问了一次。'
 assert.equal(fix(user,compound),compound,'a compound causal conclusion and independent fact cannot be replaced as one clause')
 for(const conjunction of ['和','与']){
  const mixed='这说明这个做法减少了沟通'+conjunction+'找材料更快。'
  assert.equal(fix(user,mixed),mixed,'do not collapse an inseparable second proposition')
 }
 for(const reply of ['你可以继续观察其他课程，因为是否能复现仍未知。','你可以继续观察其他课程因为是否能复现仍未知。'])assert.ok(fix(user,reply).includes('是否能复现仍未知'),reply)
 const embedded='同学找到了三份笔记后说明规则有效。'
 assert.equal(fix(user,embedded),embedded,'a factual prefix before an embedded causal connector must not be erased')
 const joined='已经帮助同学找到三份笔记并减少了沟通成本。'
 assert.equal(fix(user,joined),joined,'an indivisible fact joined with 并 must not disappear with an effect assertion')
 const unmeasured='最近一次我先定了一个索引，后来同学找到三份笔记，少问一次。'+request
 const preference='这验证了“减少反复找东西时间”这一偏好正在通过具体行动得到满足。'
 assert.doesNotMatch(fix(unmeasured,preference),/两份材料|少问一次，是具体结果|偏好正在.*满足/,'an earlier repair must not insert its old two-material receipt or a validated personal preference')
})

test('a latest observation is not a total trial count',()=>{
 const observation='最近一次我先定了一个索引，后来同学找到三份笔记。',request='请根据新信息更新判断。'
 for(const qualifier of ['只发生一次','只发生过一次','仅发生一次']){
  const out=fix(observation+request,'已有一个线索，但'+qualifier+'。是否能复现仍未知。')
  assert.doesNotMatch(out,/只发生(?:过)?一次|仅发生一次/)
  assert.match(out,/本轮只报告了这次结果/)
  assert.ok(out.includes('是否能复现仍未知。'),out)
 }
 for(const reply of ['不能说只发生一次。','这并不是只发生一次。','不只发生一次。','是否只发生一次仍未知。','同学说：“只发生一次。”','如果只发生一次就继续观察。','```只发生一次```'])assert.equal(fix(observation+request,reply),reply,reply)
 const explicit='最近一次我先定了一个索引，后来同学找到三份笔记且只发生过一次。'+request
 assert.equal(fix(explicit,'但只发生过一次。'),'但只发生过一次。')
 assert.equal(fix('同学说：“'+observation+'”'+request,'但只发生一次。'),'但只发生一次。')
})

test('an affirmative effect predicate is bounded without erasing its subject or adjacent facts',()=>{
 const user='最近一次我先定了一个索引，后来同学找到三份笔记。请根据新信息更新判断。'
 for(const reply of ['这个做法确实减少了沟通。','这个索引已经降低了沟通成本。','同学找到三份笔记后减少了追问。']){
  const out=fix(user,reply)
  assert.notEqual(out,reply,reply)
  assert.match(out,/是否.*仍不能确认/)
  assert.ok(out.includes(reply.split(/确实|已经|减少/)[0]),out)
 }
 assert.equal(fix(user,'这个索引起作用了。'),'这个索引是否起作用仍不能确认。')
 for(const reply of ['这个做法不一定减少了沟通。','这个做法未来是否减少沟通未知。','同学说：“这个做法确实减少了沟通。”'])assert.equal(fix(user,reply),reply,reply)
})

test('saved family correction does not turn a reported hope into a requirement',()=>{
 const user='更正：家里没有要求我必须本校读研，只是希望稳定。请只重开受这条更正影响的判断，并给一个四小时内的小验证。'
 const reply='家里只要求稳定，非本校读研。你的城市偏好不变。'
 const out=fix(user,reply)
 assert.doesNotMatch(out,/家里只要求稳定/)
 assert.match(out,/家里希望稳定/)
 assert.ok(out.includes('你的城市偏好不变。'))
 const quoted='同学说：“'+user+'”'
 assert.equal(fix(quoted,reply),reply)
})

test('a deferred teacher reply never proves reading by inference from the reply',()=>{
 const user='回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。请只更新各自相关状态。'
 const reply='老师邮件：已回复（这周忙，下周再看）；老师的实质回复说明至少已读到邮件；下周是否进一步查看及后续结果未知。'
 const out=fix(user,reply)
 assert.doesNotMatch(out,/实质回复说明至少已读/)
 assert.match(out,/是否.*读.*未知/)
 assert.ok(out.includes('下周是否进一步查看及后续结果未知。'))
 const other='老师已回复（这周忙，下周再看）。同学回复说明已经读过邮件。'
 assert.equal(fix(user,other),other,'teacher source cannot rewrite another recipients reading claim')
 const separate='老师后来回复说这周忙。同学下周再看。请更新判断。'
 assert.equal(fix(separate,'老师已回复。'),'老师已回复。','two people across separate sentences cannot form one teacher receipt')
 const claim='老师已回复（这周忙，下周再看）；老师的实质回复说明至少已读到邮件。'
 assert.doesNotMatch(fix('老师后来回复说这周忙，下周再看。同学明确说已读完全文。',claim),/实质回复说明至少已读/)
 assert.equal(fix('老师后来回复说这周忙，下周再看。老师明确说已读完全文。',claim),claim,'an explicit same-recipient read receipt must remain')
 for(const wrapped of ['同学说：“'+user+'”','如果'+user,'```'+user+'```'])assert.equal(fix(wrapped,reply),reply,wrapped)
})

test('a later relaxed report cannot inherit unreported feeling details from the first event',()=>{
 const earlier='让我轻松的主要是一起活动时不用表现，也能自然说话。'
 const latest='回来反馈：一周后我又和同一个室友打了一次，仍然放松，但当天身体累所以提前结束。不要用一次疲惫推翻之前的感受。'
 for(const claim of ['不用表现、能自然说话的状态是持续的。','不用表现、能自然说话的状态在两次中都出现了。']){
  const reply='两次都放松。'+claim+'身体累所以提前结束。'
  for(const [user,prior] of [[latest,[earlier]],['请更新这段经历的局部理解，保留未知。',[earlier,latest]]] as const){
   const out=repairReviewedDefects(reply,user,prior)?.reply??reply
   assert.doesNotMatch(out,/状态是持续的|状态在两次中都出现了/)
   assert.ok(out.includes('两次都放松。')&&out.includes('身体累所以提前结束。'),out)
   assert.match(out,/本次未报告/)
  }
 }
 const explicit=latest+'这次同样不用表现，也能自然说话。'
 const claim='不用表现、能自然说话的状态在两次中都出现了。'
 assert.equal(repairReviewedDefects(claim,explicit,[earlier])?.reply??claim,claim)
 for(const [user,prior] of [['回来反馈：今天我和导师讨论项目，自然说话而且不用表现。',[earlier,latest]],['请更新这段经历的局部理解，保留未知。',[earlier,latest,'回来反馈：后来我和导师讨论项目。']],['同学说：“'+latest+'”',[earlier]]] as const)assert.equal(repairReviewedDefects(claim,user,prior)?.reply??claim,claim,user)
 const separate='回来反馈：我又和同一个室友打了一次。导师仍然放松。请更新这段经历的局部理解，保留未知。'
 assert.equal(repairReviewedDefects(claim,separate,[earlier])?.reply??claim,claim,'a separate persons feeling cannot ground my repeated event')
})

test('legacy single-case substitutions preserve protected reply statements and valid negations',()=>{
 const user='最近一次我先定了一个索引，后来同学找到两份材料。请根据新信息更新判断。'
 for(const claim of ['分类规则已验证有效','说明三条规则在实际协作中降低了沟通成本','尚未测时间','这支持了“分类规则能减少反复找东西的时间”这一初步观察','说明分类规则对“减少反复找东西的时间”这个目标有实际帮助','这验证了“减少反复找东西时间”这一偏好正在通过具体行动得到满足'])for(const reply of ['同学说：“'+claim+'。”','“'+claim+'”','```\n'+claim+'\n```','示例：`'+claim+'`','如果'+claim+'就继续观察。','不能说'+claim+'。'])assert.equal(fix(user,reply),reply,reply)
 for(const reply of ['并不说明三条规则在实际协作中降低了沟通成本。','否认分类规则已验证有效。'])assert.equal(fix(user,reply),reply,reply)
 for(const reply of ['不要说分类规则已验证有效。','别说尚未测时间。'])assert.equal(fix(user,reply),reply,reply)
 assert.equal(fix(user,'尚未测时间。'),'本轮未报告用时。','unknown measurement must not become punctuation-only content')
 const measured='我测了用时，找到两份材料用40秒。'
 assert.match(fix(measured,'尚未测时间。'),/你报告用时40秒/)
 for(const reply of ['同学说：“尚未测时间。”','```尚未测时间```','并非尚未测时间。'])assert.equal(fix(measured,reply),reply,reply)
 const mixed='同学说：“分类规则已验证有效。”我仍保留未知。分类规则已验证有效。'
 const out=fix(user,mixed)
 assert.ok(out.includes('同学说：“分类规则已验证有效。”'),out)
 assert.ok(out.includes('我仍保留未知。'),out)
 assert.notEqual(out,mixed,'an independent unprotected own assertion may still be bounded')
 const variant='最近一次我先定了一个索引，后来同学找到三份笔记。请根据新信息更新判断。'
 const hypothesis='这支持了“分类规则能减少反复找东西的时间”这一初步观察。'
 const bounded=fix(variant,hypothesis)
 assert.doesNotMatch(bounded,/这支持了/)
 assert.ok(bounded.includes('“分类规则能减少反复找东西的时间”'))
 assert.match(bounded,/仍未知/)
 const measuredOnly=fix(measured,'分类规则已验证有效。')
 assert.doesNotMatch(measuredOnly,/这次分类规则|积极线索/,'a measurement report must not invent an episode involving classification rules')
 assert.match(measuredOnly,/是否有效.*不能确认/)
})

test('a one-change exploration never maps one possible outcome to a cause',()=>{
 for(const [user,reply] of [
  ['我不确定是运动本身还是这个室友带来的。请给一个很小的区分办法。','下次找另一位同学做同样的运动，观察是否仍然放松。若感觉相似，可能偏向运动；若差异明显，可能偏向室友。'],
  ['我不确定哪个因素起作用。','保持学习材料不变，只改复习时段。假如差异明显，就表明时段更关键。'],
  ['我不确定哪个因素起作用。','保持其他条件不变。若结果相似，则说明原方法不是主要来源。'],
 ]){
  const out=fix(user,reply)
  assert.doesNotMatch(out,/可能偏向|就表明|则说明原方法不是/)
  assert.match(out,/观察|保持/)
  assert.match(out,/未知|不能|无法区分/)
  if(!/运动|室友/.test(user))assert.doesNotMatch(out,/运动|陪伴/)
 }
})

test('causal branch boundaries apply beyond the historical sport and roommate names',()=>{
 const causal=fix('我无法判断放松来自跑步还是朋友。','只观察这次感受。如果再放松就说明跑步是主因。')
 assert.doesNotMatch(causal,/说明跑步是主因/)
 assert.match(causal,/未知|不能|无法区分/)
 const mixed=fix('我记下“先观察”但我不确定是画展还是同学带来的。','只观察感受。若再放松，说明画展是主因。')
 assert.doesNotMatch(mixed,/说明画展是主因/)
 const user='昨天和一位同学逛画展时很放松。我不确定是画展本身还是这位同学带来的。请给一个很小的区分办法。'
 const reply='近期单独去一次同样的画展，只观察自己是否仍感到放松。若仍放松，说明画展本身有作用；若明显不同，说明那位同学是重要条件。一次对照只是线索，不是因果证明。'
 const out=fix(user,reply)
 assert.match(out,/单独去一次同样的画展/)
 assert.doesNotMatch(out,/说明画展本身有作用|说明那位同学是重要条件/)
 assert.match(out,/未知|不能|不(?:是|证明)/)
})

test('the generic factor boundary does not treat a hypothetical or another person as my reported experiment',()=>{
 const generic='只观察这次感受。若结果不同，说明时段是主要原因。'
 for(const user of ['朋友说：我不确定是哪个因素起作用。','如果我不确定是哪个因素起作用，该怎么办？','我读到“我不确定是哪个因素起作用”。'])assert.equal(fix(user,generic),generic,user)
 const reply='若仍放松，说明画展本身有作用。'
 for(const user of ['朋友说：我不确定是画展本身还是这位同学带来的。','如果我不确定是画展本身还是这位同学带来的，该怎么描述？','我读到“我不确定是画展本身还是这位同学带来的”。'])assert.equal(fix(user,reply),reply,user)
})
import {boundedDistinctionReply,unresolvedTwoFactors,distinctionActionAccepts,repairReviewedDefects} from '../server/review-repairs.ts'
import {normalizeModelFeedbackDelta} from '../server/growth-model-normalize.ts'
import {openUnreportedChoiceQuestion,removeQuestionOnZeroTime,repairUnsupportedPreferenceClaim,ensureLowCostSelfStart} from '../server/reply-draft.ts'

const fix=(user:string,reply:string)=>repairReviewedDefects(reply,user)?.reply??reply

test('historical support is specific to the fact, not any sample token',()=>{
  const current='这周只剩二十分钟。请根据新信息更新判断。'
  const reply='这次同学找到两份材料、少问一次。'
  const measured=repairReviewedDefects(reply,current,['我测了用时，是20秒。'])?.reply??reply
  assert.doesNotMatch(measured,/两份材料|少问一次/)
  const reported='我整理了表格，后来同学直接找到了材料，少问了我一次。'
  const preserved=repairReviewedDefects('此前少问一次的结果保留，原因仍未知。',current,[reported],{preserveReportedObservation:true})?.reply??'此前少问一次的结果保留，原因仍未知。'
  assert.match(preserved,/少问一次/)
  const quoted=repairReviewedDefects(reply,current,['我读到“同学找到了两份材料，少问一次”。'])?.reply??reply
  assert.doesNotMatch(quoted,/两份材料|少问一次/)
  const otherMatter=repairReviewedDefects(reply,'我报名了一个摄影课程。请根据新信息更新判断。',['我整理了表格，后来同学找到了两份材料，少问一次。'])?.reply??reply
  assert.doesNotMatch(otherMatter,/两份材料|少问一次/)
  for(const text of ['摄影课程这周只剩二十分钟。请根据新信息更新判断。','这周摄影课程只剩二十分钟。请根据新信息更新判断。']){
    const result=repairReviewedDefects(reply,text,['我整理表格，后来同学找到两份材料，少问一次。'])?.reply??reply
    assert.doesNotMatch(result,/两份材料|少问一次/)
  }
})

test('an unresolved direction choice is not turned into a causal experiment',()=>{
  assert.equal(unresolvedTwoFactors('我还不清楚究竟是考研还是就业，请给一个很小的下一步行动。'),null)
})

test('preserving an observation does not license a different improvement claim',()=>{
  const user='我整理了表格，后来同学找到了两份材料。请更新判断。'
  const bad='这改善了我的就业机会。'
  const repaired=repairReviewedDefects(bad,user,[],{preserveReportedObservation:true})?.reply??bad
  assert.notEqual(repaired,bad)
  const observed='最近一次我整理了表格，后来同学直接找到了材料，少问了我一次。请根据新信息更新判断。'
  const good='同学减少了一次询问。'
  assert.equal(repairReviewedDefects(good,observed,[],{preserveReportedObservation:true})?.reply??good,good)
  const nominal='同学的询问减少了一次。'
  assert.equal(repairReviewedDefects(nominal,observed,[],{preserveReportedObservation:true})?.reply??nominal,nominal)
})

test('a distinction action must hold one factor constant and change exactly one',()=>{
  const user='我还不清楚究竟是运动本身还是室友带来的，请给一个很小的区分办法。'
  const bounded=boundedDistinctionReply(user)
  assert.ok(bounded)
  assert.equal(distinctionActionAccepts(bounded,user),true)
  assert.equal(distinctionActionAccepts('保持羽毛球不变，换一位同学，同时把时长从半小时延长到一小时，只记录结果。',user),false)
  assert.equal(distinctionActionAccepts('换成散步、换一个室友，并记录结果。',user),false)
  assert.match(boundedDistinctionReply('我还不清楚到底是运动本身，还是室友带来的，请给一个很小的区分办法。')??'',/只有“运动本身”不同的经历/)
  const sensitive=boundedDistinctionReply('我不确定是药物本身还是病情带来的，请给一个区分办法。')!
  assert.match(sensitive,/只回看已有经历/)
  assert.match(sensitive,/找不到这样的经历就停/)
  assert.match(sensitive,/不为验证而改变现实条件/)
  assert.doesNotMatch(sensitive,/只改变|调整药|停药|换药/)
})

test('denied uncertainty does not become a claimed unresolved cause',()=>{
  for(const text of [
    '我并非不确定究竟是运动本身还是室友带来的，请给一个区分办法。',
    '我不是不能区分是运动本身还是室友带来的，请给一个区分办法。',
    '我并不是分不清是运动本身还是室友带来的，请给一个区分办法。',
    '我并没有分不清是运动本身还是室友带来的，请给一个下一步。',
    '我不认为自己不确定究竟是运动本身还是室友带来的，请给一个很小的区分办法。',
  ])assert.equal(unresolvedTwoFactors(text),null,text)
})

test('single-job normalization preserves explicit multiple JDs and other-speaker boundaries',()=>{
 for(const user of ['只了解一个远程岗位，但请对照该岗位3份JD。','朋友说“只看一个岗位”，但我需要比较三个岗位。','我不是说只看一个岗位；请比较三个岗位。','“只看一个岗位”只是反例，请比较三个岗位。']){
  const reply='阅读3份该岗位的JD，读完3份即停。'
  assert.equal(fix(user,reply),reply,user)
 }
 assert.doesNotMatch(fix('只了解一个远程岗位，但请对照该岗位3份JD。','请比较三个不同岗位。'),/三个不同岗位/)
 for(const reply of ['阅读3份该岗位的JD；读完3份后停止。','阅读10-12份该岗位的JD，读完10-12份即停。','阅读12个JD，读完12个后停止。','阅读3条该岗位的JD，读完3条即停。','查看三篇岗位描述；看完三篇后停止。']){
  const out=fix('只了解一个远程岗位。',reply)
  assert.doesNotMatch(out,/3份|3条|三篇|10-12份|12个|1这个/,reply)
  assert.match(out,/这个岗位的JD/)
 }
})

test('one requested job keeps JD count and stopping count consistent in the actual DE form',()=>{
 const user='我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。给一个边界清楚的小行动。'
 const reply='选一个你感兴趣的远程岗位，在招聘平台读3份该岗位的JD，只记录其中关于工作时间、会议频率和响应要求的具体描述。这个动作测的是公开信息里能看到的节奏线索，不联系任何人也不提供资料；投入上限30分钟，读完3份就停。'
 const out=fix(user,reply)
 assert.doesNotMatch(out,/3份|三份/)
 assert.match(out,/这个岗位的JD/)
 assert.match(out,/读完这份/)
 assert.match(out,/30分钟/)
})

test('a reported response preserves message receipt without upgrading material reading',()=>{
 const user='导师回复说手机打不开链接，但没有评价内容。'
 const reply='导师已回复打不开，说明消息已送达。是否阅读内容仍未知。'
 const out=fix(user,reply)
 assert.doesNotMatch(out,/是否送达未知/)
 assert.match(out,/是否阅读内容仍未知/)
})

test('repairs cannot manufacture a notification or a twenty-second retrieval from another task',()=>{
 const out=fix('我整理过课程资料，还在了解。','你目前只整理过一次材料，这说明查找变快。')
 assert.doesNotMatch(out,/通知|20秒|二十秒/)
 assert.match(out,/未知|不能|尚未/)
})

test('an acknowledgement cannot be turned into an invented pause by a summary repair',()=>{
 const out=fix('只给一句阶段理解。','今天先休息。')
 assert.doesNotMatch(out,/先暂停|等你主动回来/)
})

test('a negated pause cannot become an affirmative pause in a phase summary',()=>{
 const out=fix('只给一句阶段理解：我没有暂停，只是今天没精力。','今天先休息。')
 assert.doesNotMatch(out,/先暂停|等你主动回来/)
})

test('a requested tentative summary never fabricates unrelated unknown fields',()=>{
 const user='先暂停考研方向，不删除刚才查过的事实。说明当前暂定理解和仍未知的地方，这周不再安排任务。'
 const reply='考研先暂停；你仍更在意留在当前城市和有清晰产出的工作，两项课程练习尚不证明符合岗位要求。'
 const out=fix(user,reply)
 assert.equal(out,reply)
 assert.doesNotMatch(out,/具体贡献和目标标准仍未知/)
})

test('causal pruning removes a whole conditional conclusion rather than leaving contradictory connectors',()=>{
 const user='我不确定是运动本身还是这个室友带来的。'
 const out=fix(user,'下次换一位同伴观察感受。若仍有，说明运动本身贡献较大；若明显不同，只能说明这次可能不同，不能确定室友因素更关键。')
 assert.doesNotMatch(out,/说明只能|若仍有，说明/)
 assert.match(out,/下次换一位同伴观察感受/)
})

test('an explicitly attributed family hope is preserved on repeated repair passes',()=>{
 const user='家里希望稳定，这是外部期待。'
 const reply='家里只是希望稳定，没有指定本校读研。'
 const once=fix(user,reply)
 assert.equal(once,reply)
 assert.equal(fix(user,once),once)
})

test('judgment-only updates remove an unsolicited action section across Markdown forms',()=>{
 const user='家里希望稳定，我更在意留在目前城市，每周最多四小时探索。请更新判断，不要替我选。'
 for(const heading of ['**下一步建议**：','### 下一步建议','4. **下一步建议**：']){
  const out=fix(user,`城市是你表达的偏好；探索投入以四小时为上限。\n\n${heading}\n打开一个岗位描述，做一次核对。\n\n**仍未知**：\n岗位具体要求尚未核实。`)
  assert.doesNotMatch(out,/打开一个岗位|做一次核对|下一步建议/)
  assert.match(out,/岗位具体要求尚未核实/)
 }
 const requested=fix('请更新判断，并给一个小行动。','当前条件保留。\n\n**下一步建议**：\n打开一个岗位描述。')
 assert.match(requested,/打开一个岗位描述/)
 for(const reply of ['**下一步建议**：联系导师。','下一步建议：联系导师。','## 下一步\n1. 联系导师。','## 下一步：可以联系导师。','## 下一步\n可以联系导师。','## 下一步\n写一封邮件给导师。','可联系导师确认。','建议你联系导师确认。','建议：继续观察。']){
  assert.equal(fix('请更新判断。',reply),'本轮不新增行动。',reply)
 }
 for(const heading of ['下一步','下一步建议','小行动','验证动作'])for(const format of [heading,'## '+heading,'**'+heading+'**','1. **'+heading+'**'])assert.equal(fix('请更新判断。',format+'：联系导师。'),'本轮不新增行动。',format)
 for(const reply of ['建议你联系导师的说法来自同学。','记录：老师已回复。'])assert.equal(fix('请更新判断。',reply),reply,'attribution and status labels are not assistant advice')
 assert.equal(fix('请根据新信息更新判断，并给一个下一步建议。','建议你联系导师。'),'建议你联系导师。')
 assert.equal(fix('请更新判断。','## 下一步\n记录：老师已回复。'),'记录：老师已回复。','status labels below an action heading remain factual content')
 const mixed=fix('请更新判断。','## 下一步\n1. 联系导师，老师已经回复。')
 assert.doesNotMatch(mixed,/联系导师/)
 assert.ok(mixed.includes('老师已经回复。'),mixed)
 for(const status of ['打开了页面。','联系导师了。','已经发送邮件。','联系导师这件事已经完成。'])assert.ok(fix('请更新判断。','## 下一步\n'+status).includes(status),status)
 for(const protectedText of ['```\n## 下一步\n联系导师。\n```','同学说：“## 下一步：可以联系导师。”','如果要继续就联系导师。'])assert.equal(fix('请更新判断。',protectedText),protectedText,protectedText)
})

test('format cleanup preserves balanced parentheses and removes unmatched closes left by pruning',()=>{
 const out=fix('请更新判断。','城市偏好（仍可修正）保留。\n\n**待核实的关键缺口**：\n）\n\n仍未知的是具体岗位要求。')
 assert.match(out,/城市偏好（仍可修正）保留/)
 assert.doesNotMatch(out,/\n）/)
 assert.match(out,/仍未知的是具体岗位要求/)
})

test('a negated delivery claim is not rewritten',()=>{
  const reply='电脑能打开不证明链接已送达导师；是否已读也还未知。'
  assert.equal(fix('',reply),reply)
})

test('a reported no-reply is not downgraded to unknown',()=>{
  const user='我把作品集链接发给导师了，对方还没回复。不要把未回复说成不采用。'
  const reply='目前仅知“已发送”，其余均为未知。'
  const out=fix(user,reply)
  assert.match(out,/对方未回复/)
  assert.doesNotMatch(out,/其余均为未知/)
})

test('a receiver role is not written as the sender',()=>{
  const user='链接在电脑能打开，我不知道导师是否读过；发送时只说了请看看。'
  const reply='不证明导师已发送，是否送达未知或已读。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/导师已发送/)
  assert.match(out,/导师已收到/)
})

test('a user-supplied alternative is not rewritten into a generic question',()=>{
  const question='我想问的是‘运动本身’，还是‘和室友相处’？'
  assert.equal(openUnreportedChoiceQuestion(question,question),null)
})

test('zero time to execute is not zero time to talk',()=>{
  const user='这周没空执行计划，但现在愿意聊聊，请问我一个问题。'
  const reply='你希望先聊哪一部分？'
  assert.equal(removeQuestionOnZeroTime(reply,user),null)
})

test('a phase summary reflects the reported number of attempts',()=>{
  const user='我已经做了五次类似尝试，今天先暂停，只给一句阶段理解。'
  const out=fix(user,'已暂停，等你回来。')
  assert.match(out,/五次/)
  assert.doesNotMatch(out,/一次/)
})

test('a self-referential question is replaced with a grounded question',()=>{
  const user='让我轻松的主要是一起活动时不用表现，也能自然说话；不是因为我打得好。'
  const out=fix(user,'我想问的具体情况是什么？')
  assert.doesNotMatch(out,/我想问/)
  assert.match(out,/一起活动时/)
})

test('two observations do not become a stable experience',()=>{
  const user='请更新这段经历的局部理解，保留未知；不生成任务。'
  const reply='局部理解已更新。两次打球都带来放松，这是目前稳定的体验。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/稳定的体验/)
  assert.match(out,/样本仍小|不能判定稳定/)
})

test('zero time clarification still gives the boundary',()=>{
  const user='现在我愿意厘清一点，但本周可用时间是零。老师没回复只是结果未知，不等于拒绝我。'
  const reply='先厘清老师未回复的边界。这周先不安排动作，等你有时间再继续。'
  const out=fix(user,reply)
  assert.match(out,/老师没回复只说明结果未知，不等于拒绝/)
})

test('a single search result does not become a time-saving observation',()=>{
  const user='最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='这支持了“分类规则能减少反复找东西的时间”这一初步观察。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/这支持了.*这一初步观察/)
  assert.ok(out.includes('“分类规则能减少反复找东西的时间”'),'the quoted hypothesis remains verbatim, without asserting it as an observation')
  assert.match(out,/是否减少整体查找时间仍未知/)
  assert.doesNotMatch(out,/同学找到|尚未测时间/)
})

test('a goal with no reported sample is not rewritten with sample facts',()=>{
  const user='我想减少反复找东西的时间，还没做过一次。'
  const reply='你想减少反复找东西的时间，这是目标，效果还未报告。'
  assert.equal(fix(user,reply),reply)
})

test('a measured 40-second practice keeps its measurement',()=>{
  const user='我整理一次后测了用时，是40秒；没给同学用，没有前后对照。'
  const reply='你希望减少反复找东西的时间，但这次没有对照，不能得出改进幅度。'
  assert.equal(fix(user,reply),reply)
})

test('state layers do not contaminate another person or event',()=>{
  const user='导师确认已经读到PDF；另一个同学还未回复我的邮件。'
  const reply='导师已读；另一位同学未回复，原因未知。'
  const out=fix(user,reply)
  assert.match(out,/另一位同学未回复/)
  assert.doesNotMatch(out,/另一位同学已回复/)
})

test('a non-paused summary does not inject pause or no-task status',()=>{
  const user='社团活动继续推进，说明当前暂定理解和仍未知。'
  const reply='下面整理当前事项。'
  const out=fix(user,reply)
  assert.equal(out,reply) // A repair cannot synthesize a missing understanding.
  assert.doesNotMatch(out,/已暂停|不安排任务/)
  assert.match(out,/社团|继续|当前事项/)
})

test('C2-T5 separates read, reply, adoption and effect',()=>{
  const user='回来反馈：我发了PDF，导师确认已经读到，但还没有说是否采用其中建议，也没有给效果反馈。'
  const reply='已发送、已读、未回复、未采用、无效果。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/未回复|未采用|无效果/)
  assert.match(out,/已回复：导师确认读到/)
  assert.match(out,/是否采用：未说明/)
  assert.match(out,/实际效果：未反馈/)
})

test('C2-T6 fills the reply dimension instead of content evaluation',()=>{
  const user='请把已发、已读、已回复、是否采用、实际效果分开说。'
  const reply='已发：PDF已发送。已读：导师确认读到。已回复：导师未回复内容评价。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/已回复：导师未回复内容评价/)
  assert.match(out,/已回复：有.*内容评价未报告/)
})

test('C3-T2 handles punctuation around the answered purpose',()=>{
  const user='我主要在意能自己安排一天中专注工作的时间，不在意当老板。'
  const reply='你提到的“更自由的生活”，具体是指哪方面的自由？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/更自由的生活.*哪方面的自由/)
  assert.match(out,/已经明确想要能自己安排专注工作的时间/)
})

test('run38 C1-T3 keeps the time limit hard while softening only the city preference',()=>{
  const user='我更在意留在目前城市，每周最多四小时探索。'
  const reply='留在目前城市是明确偏好，每周最多四小时是硬约束。'
  const out=fix(user,reply)
  assert.match(out,/每周最多四小时是硬约束/)
  const long='你更在意的核心约束是“留在目前城市”，这应作为路径筛选的首要条件。每周最多四小时目前是明确偏好，不代表不可妥协。'
  const longOut=fix(user,long)
  assert.doesNotMatch(longOut,/目前是明确偏好，不代表不可妥协/)
  assert.match(longOut,/每周最多四小时是明确的时间上限/)
  assert.match(longOut,/重要偏好/)
})

test('run39 re-asks of an answered purpose are replaced without a question mark',()=>{
  const prior=['我真正想要的是毕业后做有清晰产出的工作。']
  const reply='升学和就业是两条路径，你希望它们改变什么，目前尚未明确。'
  const out=repairReviewedDefects(reply,'接着升学和就业的取舍。',prior)?.reply??reply
  assert.doesNotMatch(out,/你希望它们改变什么/)
  assert.match(out,/目的已经明确/)
})

test('run40 a cross-session goal in the reply blocks a re-ask without prior messages',()=>{
  const reply='你真正想要的是毕业后做有清晰产出的工作。仍未知：你希望考研或就业分别改变什么。'
  const out=fix('先暂停考研方向。',reply)
  assert.doesNotMatch(out,/你希望考研或就业分别改变什么/)
  assert.match(out,/目的已经明确/)
})

test('run41 empty待补 headings and unverified minute ranges are removed',()=>{
  const reply='目前信息不足：\n\n**待补关键信息（影响判断，非固定问卷）：**\n\n下一步：用4小时中的1小时。只花5-10分钟就能判断。'
  const out=fix('请更新判断。',reply)
  assert.doesNotMatch(out,/待补|目前信息不足|5-10分钟/)
  assert.match(out,/下一步/)
})

test('run45 bracketed field placeholders are removed',()=>{
  const reply='下一步：\n\n【你目前所在城市】\n【你专业或技能方向】\n【“清晰产出”的具体例子】\n\n以上是框架。'
  const out=fix('请更新判断。',reply)
  assert.doesNotMatch(out,/【你目前所在城市】|【你专业或技能方向】|【“清晰产出”/)
  assert.match(out,/以上是框架/)
})

test('run45 a city preference plus time limit is not one hard boundary',()=>{
  const user='我更在意留在目前城市，每周最多四小时探索。'
  const reply='你明确希望留在目前城市，且每周最多投入四小时探索。这是硬边界。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/这是硬边界/)
  assert.match(out,/重要偏好/)
  assert.match(out,/时间上限/)
})

test('run45 no clients or collection does not imply a stable income preference',()=>{
  const user='我不想承担找客户和收款。'
  const reply='你希望的是：有稳定收入来源，但能自主安排专注工作的时间。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/有稳定收入来源/)
  assert.match(out,/不承担找客户和收款/)
})

test('run44 city preference is important but not the primary geographic filter',()=>{
  const user='我更在意留在目前城市，每周最多四小时探索。'
  const reply='你个人的核心偏好是“留在目前城市”，这应作为筛选升学或就业选项的首要地理条件。每周最多四小时是硬约束。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/首要地理条件/)
  assert.match(out,/重要的地理偏好/)
  assert.match(out,/每周最多四小时/) // untouched elsewhere in a longer reply
})

test('run49 stable hope in the same sentence remains a family expectation',()=>{
  const prior=['家里希望我走稳定路线，但这是外部期待。','我真正想要的是毕业后做有清晰产出的工作。']
  const reply='你真正想要的是毕业后做有清晰产出的工作，同时希望稳定。'
  const out=repairReviewedDefects(reply,'先暂停考研方向。',prior)?.reply??reply
  assert.doesNotMatch(out,/同时希望稳定/)
  assert.match(out,/家里希望稳定（外部期待/)
})

test('run49 follow-exam object is known even when the reason is unknown',()=>{
  const prior=['身边同学都在准备考研，我也跟着想报。']
  const reply='你也跟着想报（具体对象和原因未说明）。仍未知：你跟着想报的是什么，以及为什么。'
  const out=repairReviewedDefects(reply,'先暂停考研方向。',prior)?.reply??reply
  assert.match(out,/对象是考研/)
  assert.match(out,/具体原因尚未说明/)
})

test('run49 two same-condition experiences do not support a combined source or stable clue',()=>{
  const user='回来反馈：我又和同一个室友打了一次，仍然放松。'
  const reply='两次经历都支持“不被评价的陪伴”带来放松感。这是目前最稳定的线索。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/支持“不被评价的陪伴”带来放松感|最稳定的线索/)
  assert.match(out,/不能确定前者带来后者/)
  assert.match(out,/不能判定稳定/)
})

test('run47 a refusal-only reply still carries the stated time-autonomy preference',()=>{
  const user='我主要在意能自己安排一天中专注工作的时间，不想创业。'
  const reply='你明确不想创业，我不会再提。'
  const out=fix(user,reply)
  assert.match(out,/自己安排专注工作的时间/)
})

test('run47 a wording slip does not turn not-enjoying into not-wanting-to-enjoy',()=>{
  const reply='你明确不想享受考试本身。'
  const out=fix('我不享受考试本身。',reply)
  assert.match(out,/不享受考试本身/)
  assert.doesNotMatch(out,/不想享受/)
})

test('run47 two same-condition observations do not name a combined source',()=>{
  const user='回来反馈：我又和同一个室友打了一次，仍然放松。'
  const reply='两次同类经历都支持“不被评价的陪伴”来自运动+特定室友的组合。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/来自运动\+特定室友的组合/)
  assert.match(out,/仍不能确认/)
})

test('run50 C1-T5 uses the known two options instead of repeating the definition question',()=>{
  const user='回来反馈：我分别看了一个本地初级岗位和一个硕士培养方案。岗位要求的两项技能我做过课程练习；培养方案里有我不喜欢的纯理论必修。'
  const reply='为了区分这两条路径，我需要了解：你心中“有清晰产出的工作”具体是指什么样的工作场景或成果？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/具体是指什么样的工作场景或成果/)
  assert.match(out,/岗位的两项技能/)
  assert.match(out,/纯理论必修/)
})

test('run50 C2-T4 uses send-complete as the only stop condition',()=>{
  const user='我可以导出PDF，今天只愿意做一个动作。请给能开始的一步，并说明何时停止。'
  const reply='导出PDF并发送，收到回复即停。\n\n停止条件：发送完成即止。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/收到回复即停/)
  assert.match(out,/发送完成即停/)
})

test('run50 C3-T1 removes an already-injected time-autonomy preference',()=>{
  const user='我想要更自由的生活，但明确不想创业。不要换词劝我创业，先问一个问题厘清我说的自由。'
  const reply='你希望自由改变生活里的哪件事？\n\n创业已排除，我不会再提。\n\n你更在意的是能自己安排专注工作的时间；这一点保留，后续只围绕时间自主探索，不重开创业。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/自己安排专注工作的时间/)
  assert.match(out,/你希望自由改变生活里的哪件事/)
})

test('run50 C4-T3 changes only one factor in the two-factor test',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='找一次机会，和另一位你感觉比较放松的同学，一起打一次羽毛球（或进行其他轻度共同活动）。如果感觉不同，则说明这位室友或这项运动本身有独特作用。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/和另一位[^。]*一起打一次羽毛球/)
  assert.match(out,/不同时换两个条件/)
  assert.match(out,/只能记录这次不同/)
})

test('run50 C4-T6 does not repeat a main-source conclusion',()=>{
  const user='请更新这段经历的局部理解，保留未知；不生成任务。'
  const reply='两次和同一室友打球都感到放松，主要来源是“不用表现”。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/主要来源是“不用表现”/)
  assert.match(out,/不足以确定主要来源/)
})

test('run50 C5-T2 fixes the broken punctuation without changing the state',()=>{
  const reply='厘清：未回复是结果未知。，不安排任何动作。'
  const out=fix('老师没回复只是结果未知，不等于拒绝我。',reply)
  assert.doesNotMatch(out,/。，/)
  assert.match(out,/未回复是结果未知。不安排任何动作/)
})

test('run50 C5-T5 keeps unreported evaluation as unknown, not a negative stage',()=>{
  const user='回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。'
  const reply='老师：已回复，这周忙，下周再看。未进入实质评估或采用阶段。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/未进入实质评估或采用阶段/)
  assert.match(out,/未报告，保持未知/)
})

test('run50 C6-T2 asks about other contexts instead of repeating the feeling question',()=>{
  const user='我会主动继续整理，主要想更快看出哪些信息关键，减少自己反复找东西的时间。'
  const reply='你提到主动整理。在主动整理时，最让你觉得“顺手”或“有意思”的是哪一步？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/最让你觉得“顺手”或“有意思”/)
  assert.match(out,/别的事情上/)
})

test('run50 C6-T3 keeps the concrete result and removes the inferred gain and dangling tail',()=>{
  const user='最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='同学能直接找到材料，说明规则降低了沟通成本。之前问的“顺手或有意思的具体情况是什么？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/降低了沟通成本|之前问的/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run59 C1-T5 keeps family stability external',()=>{
  const prior=['家里希望我走稳定路线，但这是外部期待。']
  const reply='家里没有要求你必须本校读研。你只是希望稳定。'
  const out=repairReviewedDefects(reply,'先暂停考研方向。',prior)?.reply??reply
  assert.doesNotMatch(out,/你只是希望稳定/)
  assert.match(out,/家里希望稳定（外部期待/)
})

test('run71 inline bracketed placeholders are removed without losing text',()=>{
  const reply='【留在目前城市】与【升学/就业】的具体关联是什么？'
  const out=fix('请更新判断。',reply)
  assert.doesNotMatch(out,/【|】/)
  assert.match(out,/留在目前城市与升学\/就业/)
})

test('run71 C4-T3 does not say solo sport proves therapeutic effect',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='如果独自运动时依然感到放松且无压力，说明运动本身具有疗愈性。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/说明运动本身具有疗愈性/)
  assert.match(out,/不能确定运动本身具有疗愈性/)
})

test('run71 C6-T2 asks another context instead of the classification standard',()=>{
  const user='我会主动继续整理，主要想更快看出哪些信息关键，减少自己反复找东西的时间。'
  const reply='整理时，你按什么标准分？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/按什么标准分/)
  assert.match(out,/别的事情上/)
})

test('run71 C6-T3 does not confirm help with quick location',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='能确认规则对“他人快速定位”有帮助。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/能确认规则对“他人快速定位”有帮助/)
  assert.match(out,/不能确认规则对他人快速定位有帮助/)
})

test('run74 C1-T5 does not leave an empty two-question lead',()=>{
  const user='我分别看了一个本地初级岗位和一个硕士培养方案。岗位要求的两项技能我做过课程练习；培养方案里有我不喜欢的纯理论必修。'
  const reply='这两条线索各自指向一个待确认的问题：\n\n这两个问题不需要同时回答。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/待确认的问题：\s*\n/)
  assert.match(out,/岗位技能的实际熟练度/)
})

test('run74 C4-T3 does not lean toward sport or roommate',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='若仍有，偏向运动本身；若没有，偏向室友带来的氛围。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/偏向运动本身|偏向室友带来的氛围/)
  assert.match(out,/不能确定来源/)
})

test('run73 C4-T3 does not map the comparison result to a heavier factor',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='若感觉不同则说明室友因素更重，若感觉相似则说明运动本身更重。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/说明室友因素更重|说明运动本身更重/)
  assert.match(out,/不能确定室友因素更重/)
  assert.match(out,/不能确定运动本身更重/)
})

test('run73 C6-T3 does not support a rule-clarity/communication-cost judgment',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='这支持了“规则清晰有助于减少沟通成本”的初步判断。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/支持了“规则清晰有助于减少沟通成本”/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run72 C4-T3 does not map presence/absence to which factor matters',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='如果还在，说明运动本身可能更重要；如果明显减弱，说明室友的作用更大。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/运动本身可能更重要|室友的作用更大/)
  assert.match(out,/不能确定来源/)
})

test('run72 C4-T5 does not label the experience as stable or repetitive',()=>{
  const reply='体验稳定性：两次均报告积极感受，说明积极感受具有重复性。'
  const out=fix('请更新局部理解，保留未知。',reply)
  assert.doesNotMatch(out,/体验稳定性|积极感受具有重复性/)
  assert.match(out,/两次体验|样本仍小/)
})

test('run72 C6-T2 asks another context instead of the material-sorting process',()=>{
  const user='我会主动继续整理，主要想更快看出哪些信息关键，减少自己反复找东西的时间。'
  const reply='你整理时，是先把所有材料摊开再分类，还是边看边归？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/先.*摊开再分类/)
  assert.match(out,/别的事情上/)
})

test('run72 C6-T3 does not claim verification, transferability or proven lower cost',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='这验证了规则对他人检索有实际帮助，这套整理逻辑具备可传递性，规则已证明能减少沟通成本。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/验证了规则对他人检索有实际帮助|已证明能减少沟通成本/)
  assert.match(out,/只说明这次同学少问了一次/)
  assert.match(out,/不能确认这套整理逻辑具备可传递性/)
})

test('run70 C4-T5 does not call the second observation the most stable clue',()=>{
  const user='回来反馈：一周后我又和同一个室友打了一次，仍然放松。'
  const reply='两次打球都感到放松，这是目前最稳定的线索。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/最稳定的线索/)
  assert.match(out,/不能判定稳定/)
})

test('run70 C6-T3 does not claim preliminary effect, lower cost, or right direction',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='分类规则已初步见效，在降低沟通成本上起了作用，方向是对的。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/初步见效|降低沟通成本上起了作用|方向是对的/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run69 C4-T3 gives one changed condition and no source mapping',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='下次打羽毛球时，若条件允许，尝试与另一位同学（非该室友）进行同样强度的运动，或独自进行同样的运动练习。观察并记录：1. 是否仍感到“不被评价”？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/另一位同学（非该室友）|独自进行同样的运动练习/)
  assert.match(out,/保持人物不变，只改变活动/)
})

test('run69 C5-T5 does not start a numbered list at 2',()=>{
  const reply='状态更新：\n此前“未回复”状态已更正。\n2. 同学表格：维持“明确不适合”结论。'
  const out=fix('回来反馈：老师后来回复说这周忙，下周再看。',reply)
  assert.doesNotMatch(out,/^2\./m)
  assert.match(out,/同学表格/)
})

test('run69 C6-T2 asks another context instead of classification criteria',()=>{
  const user='我会主动继续整理，主要想更快看出哪些信息关键，减少自己反复找东西的时间。'
  const reply='整理时按什么标准分类？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/按什么标准分类/)
  assert.match(out,/别的事情上/)
})

test('run69 C6-T3 does not claim validated rule or reduced cost',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='分类规则已初步验证有效，在“可检索性”上起了作用，减少了沟通成本。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/已初步验证有效|可检索性”上起了作用|减少了沟通成本/)
  assert.match(out,/只说明这次同学少问了一次|这次同学少问了一次/)
})

test('run68 C4-T3 does not name flow or interpersonal safety as the source',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='若独自打球也放松，说明核心是运动带来的心流；若换人后压力重现，说明关键在特定的人际安全感。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/说明核心是运动带来的心流|说明关键在特定的人际安全感/)
  assert.match(out,/不能确定是运动带来的心流|不能据此分配原因/)
})

test('run68 C6-T2 asks another context instead of the smoothest step',()=>{
  const user='我会主动继续整理，主要想更快看出哪些信息关键，减少自己反复找东西的时间。'
  const reply='整理时哪一步最顺手？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/哪一步最顺手/)
  assert.match(out,/别的事情上/)
})

test('run68 C6-T3 does not claim reduced cost or lower usage threshold',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='分类规则已减少沟通成本，对降低他人使用门槛是有效的。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/已减少沟通成本|降低他人使用门槛是有效的/)
  assert.match(out,/不能确认对降低他人使用门槛有效|是否减少沟通成本仍未知/)
})

test('run67 C4-T6 does not say two experiences support stability',()=>{
  const user='请更新这段经历的局部理解，保留未知。'
  const reply='两次同类体验支持“放松”的稳定性，但不足以区分归因。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/支持“放松”的稳定性/)
  assert.match(out,/不能判定稳定/)
})

test('run67 C6-T3 does not claim reduced asking or effective retrieval cost',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='分类规则已减少同学询问次数，产生了可观察的实际效果，能有效降低他人的检索成本。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/分类规则已减少同学询问次数|产生了可观察的实际效果/)
  assert.match(out,/只说明这次同学少问了一次|只记录这次具体结果/)
  assert.match(out,/不能确认能有效降低他人的检索成本/)
})

test('run66 C4-T3 category-level cleanup removes weight and sport-space claims',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='若换人后感觉明显不同，则室友因素权重较大；若独自或换人后仍有类似体验，则运动本身可能提供了这种心理空间。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/权重较大|可能提供了这种心理空间/)
  assert.match(out,/不能确定来源/)
})

test('run66 C6-T3 category-level cleanup removes rule effectiveness and coordination cost',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='说明三条规则在“定位”这个环节是有效的，降低了协作成本，规则初步验证有效。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/环节是有效的|降低了协作成本|初步验证有效/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run65 C4-T3 removes duplicated text and keeps the same activity',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='下次找另一位同学进行同样的低压力运动（如散步或简单球类）。若感受重现，说明只能记录这次是否不同，不能确定只能记录这次是否不同，不能确定运动场景本身贡献较大。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/低压力运动|不能确定只能记录这次是否不同/)
  assert.match(out,/保持同样的羽毛球活动/)
  assert.match(out,/只能记录这次不同/)
})

test('run65 C6-T3 does not say communication cost was actually lowered or utility verified',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='确实降低了沟通成本，验证了你对零散内容分类的偏好具有实际效用。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/确实降低了沟通成本|验证了你对零散内容分类的偏好具有实际效用/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run64 C4-T3 changes only the person and keeps the activity',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='下次和另一位关系不错、但平时不一起打球的室友，进行一项低强度的共同活动（如散步、喝咖啡或一起看个轻松的短片）。如果换人后依然轻松，说明这种体验更多源于你对“非评价性社交”的需求或运动本身的解压属性。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/低强度的共同活动|非评价性社交/)
  assert.match(out,/保持同样的羽毛球活动/)
  assert.match(out,/不能确定体验来源/)
})

test('run64 C6-T3 does not claim lower communication cost or matching retrieval habits',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='说明当前的三条分类规则在减少沟通成本上是有效的，表明整理逻辑符合他人的检索习惯。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/规则在减少沟通成本上是有效的|表明整理逻辑符合他人的检索习惯/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run63 C4-T3 does not judge which factor the feeling depends on',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='通过对比两种情境下的体验差异，判断轻松感更依赖运动本身还是人际互动。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/通过对比两种情境下的体验差异，判断轻松感更依赖/)
  assert.match(out,/只能记录差异/)
})

test('run63 C5-T5 does not write no-progress as a negative stage',()=>{
  const user='老师后来回复说这周忙，下周再看。'
  const reply='老师已回复，当前暂无实质进展或拒绝。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/暂无实质进展或拒绝/)
  assert.match(out,/未报告，保持未知/)
})

test('run63 C6-T3 does not claim actual convenience or lower access threshold',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='这是整理带来的实际便利，说明你的分类逻辑是有效的，减少了沟通成本，价值在于降低他人的获取门槛。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/实际便利|分类逻辑是有效的|价值在于降低他人的获取门槛/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run62 C4-T3 does not map changing the person to weight or importance',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='若换了人感觉明显不同，则室友因素权重较大；若独自或换人后仍有类似放松感，则运动本身可能更重要。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/则室友因素权重较大|则运动本身可能更重要/)
  assert.match(out,/只能记录这次不同/)
  assert.match(out,/只能记录这次相似/)
})

test('run62 C6-T2 asks another context instead of classification criteria',()=>{
  const user='我会主动继续整理，主要想更快看出哪些信息关键，减少自己反复找东西的时间。'
  const reply='你分几类时按什么标准分的？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/按什么标准分的/)
  assert.match(out,/别的事情上/)
})

test('run62 C6-T3 does not claim actual help or observable effect',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='说明规则对“他人自助查找”有实际帮助，分类规则已落地并产生可观察效果（减少一次询问）。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/有实际帮助，|产生可观察效果/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run61 C4-T3 changes only the activity and keeps the same person',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='下次和这位室友一起打球时，留意自己是否更在意“球技被看见/被点评”，还是更在意“和这个人待在一起”。如果换成其他朋友或独自运动，那种“不被评价”的轻松感是否还在？只需观察一次，不要求改变行为。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/换成其他朋友或独自运动/)
  assert.match(out,/保持同一个人，只改变活动/)
})

test('run61 C6-T3 does not call one result strong evidence or reduced asking',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='这提供了一个有力的线索，似乎能直接减少他人向你询问具体材料位置的需求。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/有力的线索|似乎能直接减少他人询问/)
  assert.match(out,/只提供了一条有限线索/)
  assert.match(out,/是否减少他人询问仍未知/)
})

test('run60 C4-T3 removes duplicated repair text and the remaining causal mapping',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='如果仍有，只能只能说明这次可能不同，不能确定这次可能不同，不能确定室友因素更关键；如果感觉不同，则运动本身的作用更大。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/只能只能|不能确定这次可能不同|则运动本身的作用更大/)
  assert.match(out,/不能确定室友因素更关键/)
})

test('run59 C4-T3 keeps one variable and does not assign weight or key status',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='独自或与另一位非室友朋友进行同样的羽毛球活动（或类似低压力运动）。若感觉明显减弱，则室友因素权重较大；若感觉依旧，则运动本身可能是关键。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/或类似低压力运动|则室友因素权重较大|则运动本身可能是关键/)
  assert.match(out,/只能记录这次不同/)
  assert.match(out,/只能记录这次相似/)
})

test('run59 C6-T2 asks about another context instead of the next step',()=>{
  const user='我会主动继续整理，主要想更快看出哪些信息关键，减少自己反复找东西的时间。'
  const reply='你分好类后，下一步做了什么？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/下一步做了什么/)
  assert.match(out,/别的事情上/)
})

test('run57 C4-T3 does not assert that the combination caused the relaxation',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='运动提供了低门槛的共同场景，室友提供了安全的反馈环境，两者共同作用才让你感到轻松。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/两者共同作用才让你感到轻松/)
  assert.match(out,/仍无法区分/)
})

test('run57 C6-T3 does not turn one result into actual help or shared value',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='对他人查找有实际帮助，在“减少他人询问”和“提升查找效率”上产生了实际效果，具备了对外共享的价值。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/有实际帮助，|产生了实际效果|具备了对外共享的价值/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run56 C1-T5 turns a vague option question into a concrete difference',()=>{
  const user='我分别看了一个本地初级岗位和一个硕士培养方案。岗位要求的两项技能我做过课程练习；培养方案里有我不喜欢的纯理论必修。'
  const reply='这两条线索分别指向什么？\n\n岗位技能有基础，培养方案有理论必修。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/这两条线索分别指向什么/)
  assert.match(out,/岗位技能的实际熟练度/)
  assert.match(out,/纯理论必修的可接受度/)
})

test('run56 C4-T3 does not map similarity to a core mode or roommate familiarity',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='若有，说明核心是这种无评价的互动模式；若无，则室友的熟悉度或特定关系更关键。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/说明核心是这种无评价的互动模式|室友的熟悉度或特定关系更关键/)
  assert.match(out,/不能确定/)
})

test('run56 C6-T3 does not turn one result into validated method or lower retrieval friction',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='说明三条规则降低了检索摩擦，产生了可观察的便利效果，属于已验证的整理方法。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/降低了检索摩擦|产生了可观察的便利效果|属于已验证的整理方法/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run55 C3-T1 removes a dangling prompt line',()=>{
  const reply='你希望自由改变什么？\n\n为了准确理解你的需求，我想问：'
  const out=fix('我想要更自由的生活，但不想创业。',reply)
  assert.doesNotMatch(out,/我想问：/)
  assert.match(out,/你希望自由改变什么？/)
})

test('run55 C5-T2 removes a leading comma and keeps the state',()=>{
  const reply='，先停在这里。\n\n老师没回复只是结果未知，不等于拒绝。'
  const out=fix('老师没回复只是结果未知。',reply)
  assert.doesNotMatch(out,/^，/)
  assert.match(out,/先停在这里/)
})

test('run55 C4-T3 does not map a single comparison to a source',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='轻松来自无评价的互动，而非特定运动或人。若有：说明是室友带来的安全感。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/轻松来自无评价的互动|说明是室友带来的安全感/)
  assert.match(out,/仍不能确定/)
})

test('run58 C6-T3 does not say the rule lowered communication cost',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='这套分类规则在真实使用中降低了沟通成本。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/在真实使用中降低了沟通成本/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run55 C6-T3 does not claim collaboration value from one result',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='这是整理动作产生外部协作价值的线索，减少了沟通摩擦，属于带有协作属性的信息处理。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/产生了外部协作价值|减少了沟通摩擦|带有协作属性/)
  assert.match(out,/不能确认/)
})

test('run54 C4-T3 does not turn a one-factor comparison into a source judgment',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='换一位同学作为搭档。通过对比不同搭档下的体验，可初步判断“不被评价的陪伴”更多源于运动情境，还是特定人际关系。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/可初步判断“不被评价的陪伴”更多源于/)
  assert.match(out,/不能判断来源/)
})

test('run54 C4-T6 does not say the activity itself brought the relaxation',()=>{
  const user='请更新这段经历的局部理解，保留未知。'
  const reply='疲惫不推翻感受，也不改变活动本身带来的放松体验。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/活动本身带来的放松体验/)
  assert.match(out,/放松来源仍未知/)
})

test('run54 C6-T2 does not ask which moment was most obvious',()=>{
  const user='我会主动继续整理，主要想更快看出哪些信息关键，减少自己反复找东西的时间。'
  const reply='整理时哪个瞬间最明显？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/哪个瞬间最明显/)
  assert.match(out,/别的事情上/)
})

test('run54 C6-T3 does not infer retrieval efficiency or collaboration value',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='说明你的分类规则在“减少他人询问”和“提升检索效率”上产生了实际效果，而是具备了协作价值。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/产生了实际效果|具备了协作价值/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run53 C4-T3 keeps one factor and does not map similarity to a stronger factor',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='找另一位朋友一起打球（或做其他轻松活动）。如果感觉相似，说明“不被评价的互动模式”或运动本身更重要。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/或做其他轻松活动/)
  assert.doesNotMatch(out,/说明“不被评价的互动模式”或运动本身更重要/)
  assert.match(out,/只能记录这次相似/)
})

test('run53 C4-T6 does not say the relaxation is stable',()=>{
  const user='请更新这段经历的局部理解，保留未知。'
  const reply='局部理解：放松感稳定，疲惫是单次身体状态。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/放松感稳定/)
  assert.match(out,/不能判定稳定/)
})

test('run53 C6-T2 does not ask which step is most cared about',()=>{
  const user='我会主动继续整理，主要想更快看出哪些信息关键，减少自己反复找东西的时间。'
  const reply='整理时最在意哪一步？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/整理时最在意哪一步/)
  assert.match(out,/别的事情上/)
})

test('run52 C6-T2 asks about another context rather than another feeling question',()=>{
  const user='我会主动继续整理，主要想更快看出哪些信息关键，减少自己反复找东西的时间。'
  const reply='当你把那些零散内容成功归类时，你心里主要是一种什么样的感觉？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/心里主要是一种什么样的感觉/)
  assert.match(out,/别的事情上/)
})

test('run52 C6-T3 does not turn less asking into lower lookup cost',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='规则确实降低了他人查找成本，支持规则方向可行。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/规则确实降低了他人查找成本|支持规则方向可行/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run52 C4-T6 does not say the companionship brought the relaxation',()=>{
  const user='请更新这段经历的局部理解，保留未知。'
  const reply='两次都指向“不被评价的陪伴”带来的放松感。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/陪伴”带来的放松感/)
  assert.match(out,/两者关系仍不能确定/)
})

test('run51 a one-factor comparison still does not map the result to a main cause',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='下次与另一位同学进行同样的羽毛球活动。若感受相似，则运动本身可能是主要因素；若感受明显不同，则室友的特质可能更关键。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/运动本身可能是主要因素|室友的特质可能更关键/)
  assert.match(out,/只能记录这次相似/)
  assert.match(out,/不能确定室友特质更关键/)
})

test('run51 a single result does not support a reduced communication cost',()=>{
  const user='我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='说明三条分类规则在减少沟通成本上起了作用。这是有限线索，支持规则方向可行。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/减少沟通成本上起了作用|支持规则方向可行/)
  assert.match(out,/只说明这次同学少问了一次/)
})

test('run46 a stable-relaxation sentence and a two-observation conclusion are softened',()=>{
  const user='回来反馈：一周后我又和同一个室友打了一次，仍然放松。不要用一次疲惫推翻之前的感受。'
  const reply='这说明轻松感是稳定的。这两次经历已经足够支撑一个暂定理解。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/轻松感是稳定的|已经足够支撑/)
  assert.match(out,/不能判定稳定|暂定线索/)
})

test('run48 not-suitable feedback is not rewritten as explicit non-adoption or refusal',()=>{
  const user='同学试过我做的表格后明确说不适合他。'
  const reply='状态为“已交付，已回复，明确不采用”。这是已报告的拒绝，原因是“不适合他”。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/明确不采用|已报告的拒绝/)
  assert.match(out,/明确反馈不适合/)
  assert.match(out,/是否采用或持续使用未报告/)
})

test('run46 trial feedback of not suitable is not rewritten as explicit refusal',()=>{
  const user='同学试过我做的表格后明确说不适合他。'
  const reply='另一位同学试过表格后明确说不适合他——已交付，已反馈，对方明确拒绝。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/对方明确拒绝/)
  assert.match(out,/是否采用或持续使用未报告/)
})

test('run46 a twenty-minute completion promise is removed',()=>{
  const reply='只看公开信息，时间控制在20分钟内，看完这个岗位即可停。'
  const out=fix('只看一个岗位。',reply)
  assert.doesNotMatch(out,/20分钟/)
  assert.match(out,/看完即停/)
})

test('run44 two observations do not make the feeling stable',()=>{
  const user='回来反馈：一周后我又和同一个室友打了一次，仍然放松。不要用一次疲惫推翻之前的感受。'
  const reply='两次体验都指向同一位室友，轻松感来源仍待观察，但你的感受是稳定的。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/感受是稳定的/)
  assert.match(out,/不能判定稳定/)
})

test('run44 a fixed five-minute completion claim is removed',()=>{
  const reply='只查公开信息，5分钟看完即停。'
  const out=fix('只看一个远程岗位。',reply)
  assert.doesNotMatch(out,/5分钟/)
  assert.match(out,/看完即停/)
})

test('run43 a prior preference for non-judgmental company is not denied',()=>{
  const prior=['让我轻松的主要是一起活动时不用表现，也能自然说话。','我想保留这种不被评价的陪伴。']
  const reply='关于“不被评价的陪伴”这个已有偏好，这两次打球是否和它有关，你之前没有明确说，我不自动归入。'
  const out=repairReviewedDefects(reply,'回来反馈：一周后我又和同一个室友打了一次。',prior)?.reply??reply
  assert.doesNotMatch(out,/你之前没有明确说/)
  assert.match(out,/你之前明确说想保留/)
})

test('run42 a three-item heading with a missing second item is reduced to two',()=>{
  const reply='记录三件事：\n1. 是否写明固定协作时段。\n\n3. 是否提到响应时间要求。'
  const out=fix('只了解一个远程岗位。',reply)
  assert.doesNotMatch(out,/三件事/)
  assert.match(out,/记录两件事/)
  assert.match(out,/2\. 是否提到响应时间要求/)
})

test('run41 a missing action under the second option is filled with one step',()=>{
  const reply='2. **微技能验证（极小交付风险）**\n\n   - **成本**：需投入30-60分钟完成一次小任务。'
  const out=fix('请比较一个更低成本的探索方式。',reply)
  assert.match(out,/动作/)
  assert.match(out,/30分钟/)
})

test('run39 a placeholder is removed instead of shown as content',()=>{
  const reply='你目前如何安排专注时间？\n\n【待补：你当前每周可自主支配的专注工作时长】'
  const out=fix('我主要在意能自己安排一天中专注工作的时间。',reply)
  assert.doesNotMatch(out,/待补/)
  assert.match(out,/你目前如何安排专注时间？/)
})

test('run38 C1-T5/T6 keeps family stability as an external expectation',()=>{
  const prior=['我是成年大学生，身边同学都在准备考研，我也跟着想报。','我真正想要的是毕业后做有清晰产出的工作。','家里希望我走稳定路线，但这是外部期待。']
  const reply='结合你之前提到的：更在意留在目前城市、希望稳定、真正想要毕业后做有清晰产出的工作。'
  const out=repairReviewedDefects(reply,'接着升学和就业的取舍。',prior)?.reply??reply
  assert.doesNotMatch(out,/更在意留在目前城市、希望稳定/)
  assert.match(out,/家里希望稳定（外部期待，不是你的愿望）/)
})

test('run38 C3-T2 does not reopen the创业 refusal',()=>{
  const prior=['我想要更自由的生活，但明确不想创业。不要换词劝我创业。']
  const reply='这组偏好指向的是对时间自主权的重视，以及对商业运营责任的回避，而非对创业本身的全面否定。'
  const out=repairReviewedDefects(reply,'我主要在意能自己安排一天中专注工作的时间。',prior)?.reply??reply
  assert.doesNotMatch(out,/全面否定/)
  assert.match(out,/拒绝处理/)
})

test('run38 C3-T4 keeps one job instead of three to five JDs',()=>{
  const user='我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。给一个边界清楚的小行动。'
  const reply='筛选出一个岗位。只阅读岗位描述（JD）。读完3-5个JD，或30分钟到。停止条件：读完3-5个JD，或30分钟到。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/3-5个JD|3–5个JD/)
  assert.match(out,/这个岗位的JD即停/)
  assert.match(out,/不增加其他岗位/)
})

test('run38 C4-T5/T6 stops calling two observations stable or roommate-caused',()=>{
  const user='回来反馈：一周后我又和同一个室友打了一次，仍然放松，但当天身体累所以提前结束。不要用一次疲惫推翻之前的感受。'
  const reply='这进一步支持了“不被评价的陪伴”这个体验是稳定的。目前两次体验都指向同一个室友带来的放松感。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/体验是稳定的|两次体验都指向同一个室友/)
  assert.match(out,/不能判定稳定/)
  assert.match(out,/不能把放松归因于室友/)
  const noTask='请更新这段经历的局部理解，保留未知；不生成任务。'
  const noTaskOut=fix(noTask,reply+' 如果之后有机会和不同的人打，可以留意一下。')
  assert.doesNotMatch(noTaskOut,/如果之后有机会/)
})

test('run38 C5-T3 separates trial feedback from adoption',()=>{
  const user='另一位同学试过我做的表格后明确说不适合他。不要把两件事合并。'
  const reply='事件二：同学试用表格。状态：已交付，已试用，明确反馈不适合。这是已报告的采用结果。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/采用结果/)
  assert.match(out,/试用反馈/)
  assert.match(out,/是否采用或持续使用未报告/)
})

test('a reported non-reply stays reported instead of becoming unknown',()=>{
  const user='我是成年大学生，方向暂定找产品实习。我把作品集链接发给导师了，对方还没回复。'
  const reply='已发：作品集链接已发给导师。已读：未知。已回复：未知（对方还没回复）。'
  const out=fix(user,reply)
  assert.match(out,/已回复：未回复（截至报告）/)
})

test('a teacher reply update keeps the reported next week',()=>{
  const user='回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。请只更新各自相关状态。'
  const reply='两件事状态已分开更新。\n\n此前记录的“未回复”状态已更正。\n\n同学表格：反馈维持不变，明确不适合。'
  const out=fix(user,reply)
  assert.match(out,/这周忙，下周再看/)
})

test('a teacher next-week update is not reduced to waiting only',()=>{
  const user='回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。请只更新各自相关状态。'
  const reply='两件事状态已分开更新。\n\n当前状态为等待下周，未进入采用或效果阶段。\n\n同学表格：明确不适合他。该结论保持不变，此前“先暂停”的状态继续有效。'
  const out=fix(user,reply)
  assert.match(out,/这周忙，下周再看/)
  assert.doesNotMatch(out,/先暂停/)
})

test('a dangling punctuation after a question is removed',()=>{
  const user='更正：家里没有要求我必须本校读研，只是希望稳定。'
  const reply='家庭对“稳定”的具体定义是什么？）这决定哪些路径符合期待。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/？）/)
  assert.match(out,/是什么？这决定/)
})

test('one two-factor comparison does not assert the source',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='如果感觉相似，说明运动本身提供了这种体验。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/说明运动本身提供了这种体验/)
  assert.match(out,/不能确定运动本身提供了这种体验/)
})

test('a previously stated purpose is not asked again with a plural pronoun',()=>{
  const user='接着升学和就业的取舍。家里希望我走稳定路线，我自己更在意留在目前城市，每周最多四小时探索。请更新判断。'
  const reply='升学和就业是手段，不是目的。你希望它们改变什么？目前已知你希望做有清晰产出的工作。'
  const out=repairReviewedDefects(reply,user,['我真正想要的是毕业后做有清晰产出的工作。'])?.reply??reply
  assert.doesNotMatch(out,/你希望它们改变什么/)
  assert.match(out,/目的已经明确|不重问目的/)
})

test('one alternative activity does not prove the core need or a mere carrier',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='如果依然轻松，说明核心需求是“无评价的互动状态”，室友只是载体之一。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/说明核心需求是“无评价的互动状态”/)
  assert.match(out,/不能确定核心需求/)
  assert.match(out,/不能确定室友只是载体之一/)
})

test('one two-factor comparison does not assign a larger contribution',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='若后者有，则室友特质贡献较大。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/则室友特质贡献较大/)
  assert.match(out,/不能确定室友特质贡献较大/)
})

test('one two-factor comparison does not say运动形式 provided the space',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='如果依然轻松，说明运动形式本身可能提供了这种空间。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/说明运动形式本身可能提供了这种空间/)
  assert.match(out,/不能确定运动形式本身提供了这种空间/)
})

test('one disappearance does not name a key cause',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='若消失，说明运动场景或共同出汗的氛围更关键。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/说明运动场景或共同出汗的氛围更关键/)
  assert.match(out,/不能确定原因/)
})

test('a small local sample does not prove升学 is necessary',()=>{
  const user='接着升学和就业的取舍。家里希望我走稳定路线，我自己更在意留在目前城市，每周最多四小时。'
  const reply='若发现本地稳定岗位普遍要求升学，则升学成为实现城市偏好的必要手段；若发现本地有无需升学即可进入的清晰产出岗位，则就业路径的可行性上升。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/则升学成为|则就业路径/)
  assert.match(out,/不能证明升学是必要手段/)
})

test('a single two-factor observation does not name a main source',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='若依然存在，运动本身可能是主要来源；若明显减弱，室友的互动特质可能更关键。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/可能是主要来源|可能更关键/)
  assert.match(out,/不能确定/)
})

test('a five-state answer cannot upgrade verified values into adoption or effect',()=>{
  const user='请把已发、已读、已回复、是否采用、实际效果分开说，只更新相关理解，不安排催促。'
  const prior=['我发了PDF，导师确认已经读到，但还没有说是否采用其中建议，也没有给效果反馈。']
  const reply='已发：PDF已发送。已读：导师已阅读并采用了建议。已回复：已回复。是否采用：已采用。实际效果：很好。'
  const out=repairReviewedDefects(reply,user,prior)?.reply??reply
  assert.match(out,/已读：导师确认读到/)
  assert.match(out,/是否采用：未说明/)
  assert.match(out,/实际效果：未反馈/)
  assert.doesNotMatch(out,/已采用|效果：很好/)
  const partial='已发已读，采用与效果未知。\n\n状态分层：\n- 已读：导师确认读到\n- 是否采用建议：未报告'
  const partialOut=repairReviewedDefects(partial,user,prior)?.reply??partial
  assert.match(partialOut,/^已发：PDF已发送。/)
  assert.match(partialOut,/是否采用：未说明/)
})

test('a current pause does not execute a historical public-lookup action',()=>{
  const user='现在不继续行动，只给阶段理解。'
  const reply='只打开一个公开招聘页面，阅读职位描述里的工作时间。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/只打开一个公开招聘页面/)
  assert.match(out,/当前不继续行动|阶段理解/)
})

test('a feedback turn does not fall back to the old public action',()=>{
  const user='回来反馈：我只查看了一位校友公开分享的远程岗位经历。他说地点自由，但每天固定开两次会。这是一条个例。'
  const reply='只打开一个公开招聘页面，阅读职位描述里的工作时间。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/只打开一个公开招聘页面/)
  assert.match(out,/地点自由|固定会议|会议/)
})

test('C2-T1 clarifies who will resend the file',()=>{
  const user='导师说手机打不开链接。'
  const reply='如有需要我可以重新发送或提供PDF版本。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/我可以重新发送/)
  assert.match(out,/如果你需要|由你决定/)
})

test('C2-T3 and C2-T4 keep access cause and stop condition conservative',()=>{
  const user='导师回复说手机打不开链接，但我今天只愿意做一个动作。'
  const reply='只是受限于设备或链接兼容性。若导师回复已能打开，则停止；若仍无法打开，再询问。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/只是受限于设备或链接兼容性|若导师回复已能打开/)
  assert.match(out,/具体原因.*仍未知|文件发出即完成/)
})

test('C4-T3 does not map one context change to a source',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='若独自打球时仍有此感，则偏向运动本身；若换人后感觉消失，则偏向室友。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/则偏向/)
  assert.match(out,/不能确定来源/)
})

test('C5-T2 does not guarantee relief or judge the feeling',()=>{
  const user='老师没回复只是结果未知，不等于拒绝我。'
  const reply='这能帮你卸下一些不必要的失落感。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/卸下|不必要的失落感/)
  assert.match(out,/是否变轻由你决定|不评判/)
})

test('C1-T3 matches the goal sentence through markdown formatting',()=>{
  const user='接着升学和就业的取舍。家里希望我走稳定路线，我自己更在意留在目前城市。请更新判断。'
  const reply='已有目标：毕业后做有清晰产出的工作。\n\n待确认：尚未说明**你希望升学或就业具体改变什么现状**。\n\n**下一步建议**：\n）'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/尚未说明\*\*你希望升学或就业具体改变什么现状/)
  assert.match(out,/已表达想要做有清晰产出的工作/)
  // This turn requests judgment only. The old assertion required inventing
  // an action from an empty heading, contradicting that delivery boundary.
  assert.doesNotMatch(out,/先核对具体产出例子|下一步建议/)
  assert.match(out,/具体产出例子、技能差距和岗位要求/)
})

test('C3-T3 replaces a lone source question with a concrete comparison',()=>{
  const user='我还没有客户，也没有自由职业经历，每周最多两小时。请比较一个更低成本的探索方式。'
  const reply='你手上已有哪一个可用来源？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/你手上已有哪一个可用来源/)
  assert.match(out,/两种不依赖客户的小探索|先选一个/)
})

test('C1-T6 does not move the already stated goal into unknowns',()=>{
  const user='先暂停考研方向，不删除刚才查过的事实。说明当前暂定理解和仍未知的地方。'
  const reply='当前暂定理解：你希望毕业后做有清晰产出的工作。\n\n仍未知的地方：你希望考研（或其他路径）具体改变生活中的哪一部分，目前还没有明确答案。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/目前还没有明确答案/)
  assert.match(out,/已表达想要做有清晰产出的工作/)
})

test('C2-T2 keeps the reported no-reply as known',()=>{
  const user='链接在电脑能打开，我不知道导师是否读过；发送时只说了请看看，没有约定回复时间。'
  const reply='当前状态停留在“已发送”，后续环节（已读、回复、评价、采用、效果）均为未知。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/后续环节.*均为未知/)
  assert.match(out,/对方未回复|未来是否回复未知/)
})

test('C2-T6 completes a dangling state tail',()=>{
  const user='请把已发、已读、已回复、是否采用、实际效果分开说。'
  const reply='- 已发：PDF已发送\n- 已读：导师确认读到\n- 已回复：导师确认收到（非内容评价）\n- 是否采用：未知\n- 实际效果：未知\n\n当前停在'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/当前停在/)
  assert.match(out,/其余状态保持未知/)
})

test('C3-T2 handles the actual free-exploration question form',()=>{
  const user='我主要在意能自己安排一天中专注工作的时间，不在意当老板。'
  const reply='好的，不劝创业。你说的自由，最希望它改变生活里的哪一件具体的事？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/最希望它改变生活里的哪一件具体的事/)
  assert.match(out,/已经明确想要能自己安排专注工作的时间/)
})

test('C3-T3 does not leave a dependency guarantee',()=>{
  const user='我还没有客户，也没有自由职业经历，每周最多两小时。请比较一个更低成本的探索方式。'
  const reply='方式A：找1-2个自由职业者聊。成本：几乎零，只需发消息和听。建议：先做A。找1个你好奇的自由职业者。\n\n这样不依赖别人也能开始。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/不依赖别人也能开始|几乎零/)
  assert.match(out,/取决于对方|不强行推进/)
})

test('C3-T3 removes the fixed exam fallback for free exploration',()=>{
  const user='请比较一个更低成本的探索方式。'
  assert.equal(ensureLowCostSelfStart('先找1位自由职业者聊一次工作节奏，记录对方回答后停止。',user),null)
})

test('C4-T3 does not assign key-variable or main-source weights',()=>{
  const user='我不确定是运动本身还是这个室友带来的。'
  const reply='若换人后体验明显不同，则“室友”是关键变量；若仍有类似舒适感，则“运动本身”或“非评价性环境”是主要来源。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/则“室友”是关键变量|则[^。]*是主要来源/)
  assert.match(out,/不能确定|只能作为线索/)
})

test('C6-T3 does not validate a time preference without time data',()=>{
  const user='同学能直接找到两份材料，少问了我一次。'
  const reply='这验证了“减少反复找东西时间”这一偏好正在通过具体行动得到满足。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/这验证了/)
  assert.match(out,/不能验证省时收益/)
})

test('C6-T2 does not turn this behavior into a stable trait',()=>{
  const user='我会主动继续整理，主要想更快看出关键信息。我还不知道这是否只是一次偶然。'
  const reply='这种对效率的敏感和分类的意愿，是处理信息时的一种自然倾向。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/自然倾向/)
  assert.match(out,/本次自发行为|不能确认是稳定倾向/)
})

test('C1-T3 uses the already expressed goal instead of re-asking it',()=>{
  const prior=['我真正想要的是毕业后做有清晰产出的工作，也担心直接就业准备不足；我并不享受考试本身。']
  const user='接着升学和就业的取舍。家里希望我走稳定路线，我自己更在意留在目前城市。请更新判断，不要替我选。'
  const reply='升学和就业的取舍，你希望它改变什么？先说一个你最想让它变好的方面。'
  const out=repairReviewedDefects(reply,user,prior)?.reply??reply
  assert.doesNotMatch(out,/你希望它改变什么/)
  assert.match(out,/之前已经表达想要毕业后做有清晰产出的工作/)
})

test('C1-T5 does not infer job fit without output evidence',()=>{
  const user='我分别看了一个本地初级岗位和一个硕士培养方案。岗位要求的两项技能我做过课程练习。'
  const reply='岗位：技能有基础，且符合“留在本地”和“清晰产出”的方向。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/符合“留在本地”和“清晰产出”的方向/)
  assert.match(out,/尚不足以判断|实际产出信息/)
})

test('C2-T3 does not determine the access cause',()=>{
  const user='导师回复说手机打不开链接，但没有评价内容。'
  const reply='说明链接本身有效，只是导师当前设备或渠道受限。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/设备或渠道受限/)
  assert.match(out,/具体原因.*仍未知/)
})

test('C2-T6 fills the reply dimension after confirmed reading',()=>{
  const user='请把已发、已读、已回复、是否采用、实际效果分开说。'
  const reply='已发：PDF已发送。已读：导师确认读到。已回复：导师未就内容给出评价。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/已回复：导师未就内容给出评价/)
  assert.match(out,/已回复：有.*内容评价未报告/)
})

test('C3-T3 does not close a whole direction or promise zero cost',()=>{
  const user='我主要在意能自己安排一天中专注工作的时间，不想承担找客户和收款。'
  const reply='自由职业路径（需找客户、收款）与你的约束直接冲突，不作为探索方向。成本：零额外投入。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/不作为探索方向|零额外投入/)
  assert.match(out,/不等于排除整个方向|不承诺零成本/)
})

test('C4-T6 keeps the stated wish out of the unknown list',()=>{
  const user='请更新这段经历的局部理解，保留未知。'
  const reply='目前仍未知的是：未来是否希望继续此类陪伴。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/未来是否希望继续此类陪伴/)
  assert.match(out,/具体形式、频率或对象仍未知/)
})

test('C5-T2 does not guarantee an emotional change',()=>{
  const user='老师没回复只是结果未知，不等于拒绝我。'
  const reply='把“没回复”和“拒绝我”分开，失落感会轻一点。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/失落感会轻一点/)
  assert.match(out,/是否变轻由你决定|不保证情绪变化/)
})

test('C6-T3 does not invent a failed material search',()=>{
  const user='同学能直接找到两份材料，少问了我一次。'
  const reply='下一步：拿一份同学没找到的材料，看它落在哪条规则里。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/同学没找到的材料/)
  assert.match(out,/你手边还没整理的材料/)
})

test('C6-T4 does not deny an unreported sense of achievement',()=>{
  const user='同学少问一次只是结果，不代表我因此有成就感；我当时真正轻松的是自己不用反复找。'
  const reply='更正已记录：少问一次只是结果，成就感不成立。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/成就感不成立/)
  assert.match(out,/不能据此确认成就感|不否定/)
})

test('C4-T2 does not confirm a relationship attribute from one activity',()=>{
  const user='让我轻松的主要是一起活动时不用表现，也能自然说话；不是因为我打得好。'
  const reply='说明你和室友之间有一种很舒服的默契。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/很舒服的默契/)
  assert.match(out,/不能确认关系属性|稳定默契/)
})

test('C5-T5 preserves the old state while correcting the current one',()=>{
  const user='老师后来回复说这周忙，下周再看。'
  const reply='此前记录的“未回复”已更正。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/此前记录的“未回复”已更正/)
  assert.match(out,/当时状态|不是删除历史/)
})

test('C3-T3 keeps the exploration anchored to time autonomy',()=>{
  const user='我还没有客户，也没有自由职业经历，每周最多两小时。主要在意能自己安排一天中专注工作的时间。'
  const reply='目的：确认“自由”对你而言具体指什么。方式二：小范围技能展示，发布在公开平台，外界是否有反馈。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/确认“自由”对你而言具体指什么|发布在公开平台|外界是否有反馈/)
  assert.match(out,/自主掌控哪一段专注时间|时间是否被打断/)
})

test('C3-T3 anchors the target on a later free-exploration turn',()=>{
  const user='接着自由这件事。我还没有客户，也没有自由职业经历，每周最多两小时。请比较一个更低成本的探索方式。'
  const reply='目的：确认“自由”对你而言具体指什么。方式二：小范围技能展示，发布在公开平台，外界是否有反馈。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/确认“自由”对你而言具体指什么|发布在公开平台|外界是否有反馈/)
  assert.match(out,/自主掌控哪一段专注时间|时间是否被打断/)
})

test('C5-T3 does not turn “明确说不适合” into a rejection scope',()=>{
  const user='另一位同学试过我做的表格后明确说不适合他。'
  const reply='这是已反馈、已拒绝。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/这是已反馈、已拒绝/)
  assert.match(out,/已试用、已反馈不适合本人/)
})

test('C3-T5 clarifies whose meetings are described',()=>{
  const user='我只查看了一位校友公开分享的远程岗位经历。他说地点自由，但每天固定开两次会。'
  const reply='这两次固定会议是否占用了你希望自主安排的时间段？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/这两次固定会议/)
  assert.match(out,/校友分享里是否提到固定会议/)
})

test('C5-T3 does not turn negative feedback into a rejection scope',()=>{
  const user='同学表格仍是明确不适合他。'
  const reply='这是已反馈、已拒绝。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/这是已反馈、已拒绝/)
  assert.match(out,/已试用、已反馈不适合本人/)
})

test('C6-T6 does not claim a speed-up without a baseline',()=>{
  const user='我今天没精力继续验证，先暂停这个方向。只给一句阶段理解。'
  const reply='只确认了一次“按三条规则整理后查找变快”的线索。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/查找变快/)
  assert.match(out,/没有基线/)
})

test('C1-T3 keeps a preference from becoming a hard constraint',()=>{
  const user='家里希望我走稳定路线，但这是外部期待；我自己更在意留在目前城市，每周最多四小时探索。'
  const reply='留在目前城市是硬约束。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/硬约束/)
  assert.match(out,/偏好|探索上限/)
})

test('C2-T1 does not invent a mentor research-direction gap',()=>{
  const user='方向暂定找产品实习。我把作品集链接发给导师了，对方还没回复。'
  const reply='真正影响下一步的缺口是：与导师研究方向或近期项目相关的案例。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/导师研究方向/)
  assert.match(out,/产品实习方向/)
})

test('C2-T2 does not infer inability from one week of silence',()=>{
  const user='链接在电脑能打开，我不知道导师是否读过；没有约定回复时间。'
  const reply='如果一周后仍无回复，可视为导师暂时无法处理。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/无法处理/)
  assert.match(out,/原因和导师能否处理仍未知/)
})

test('C2-T4 stops on sending, not on the mentor response',()=>{
  const user='我可以导出PDF，今天只愿意做一个动作。请说明何时停止。'
  const reply='停止条件：文件成功送达且导师确认收到，或导师反馈仍无法打开。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/导师确认收到/)
  assert.match(out,/文件成功发出即完成/)
})

test('C4-T3 does not assign causal weights after one context change',()=>{
  const user='接着羽毛球那次体验。我不确定是运动本身还是这个室友带来的。'
  const reply='若有，则运动本身贡献较大；若无，则室友因素权重更高。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/贡献较大|权重更高/)
  assert.match(out,/不能分配运动贡献|不能确定室友权重/)
})

test('C2-T3/T4 do not turn an unreported chat window into a channel',()=>{
  const user='我可以导出PDF，今天只愿意做一个动作。'
  const reply='直接通过当前聊天窗口发送给导师，文件发出即完成。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/当前聊天窗口/)
  assert.match(out,/通过你原本发送的方式/)
})

test('C1-T2 does not turn a motive into a conclusion or a necessary condition',()=>{
  const user='我真正想要的是毕业后做有清晰产出的工作，也担心直接就业准备不足；我并不享受考试本身。'
  const reply='这说明考研对你而言不是目的，而是为了弥补某种“准备不足”的焦虑。如果确实需要学历门槛或系统训练，考研才值得投入。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/这说明考研对你而言不是目的/)
  assert.doesNotMatch(out,/考研才值得投入/)
  assert.match(out,/待核对|不是唯一条件/)
})

test('C1-T5 does not infer job fit without output evidence',()=>{
  const user='我分别看了一个本地初级岗位和一个硕士培养方案。岗位要求的两项技能我做过课程练习；培养方案里有我不喜欢的纯理论必修。'
  const reply='这个岗位看起来更贴近你对“清晰产出”的偏好。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/看起来更贴近/)
  assert.match(out,/尚不足以判断|实际产出信息/)
})

test('C3-T2 carries an answered purpose instead of reasking it',()=>{
  const user='我主要在意能自己安排一天中专注工作的时间，不在意当老板，也不想承担找客户和收款。'
  const reply='你提到的“更自由的生活”具体是指哪方面的自由？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/更自由的生活.*哪方面的自由/)
  assert.match(out,/已经明确想要能自己安排专注工作的时间/)
})

test('C6-T5 limits same-experience wording to behavior similarity',()=>{
  const user='我把奖学金材料按三条规则整理了一次，第二天大约20秒找到通知，但目前只发生过一次。'
  const reply='之前你提到真正轻松的是自己不用反复找，这次也落在同一类体验上。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/同一类体验/)
  assert.match(out,/行为与之前相似|本次是否也有同样的轻松感/)
})

test('C1-T3/T4 do not harden preferences or compatibility',()=>{
  const user='家里希望我走稳定路线，但这是外部期待；我自己更在意留在目前城市。'
  const reply='这两条不冲突：留在目前城市是硬约束。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/这两条不冲突/)
  assert.doesNotMatch(out,/是硬约束/)
  assert.match(out,/不必然冲突|明确偏好/)
})

test('C6-T6 limits the one-result count to this event',()=>{
  const user='我今天没精力继续验证，先暂停这个方向，不要再安排动作。只给一句阶段理解。'
  const reply='你目前只整理过一次材料，第二天约20秒找到通知。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/你目前只整理过一次材料/)
  assert.match(out,/不足以确认整理的总次数/)
})

test('C6-T3 removes an unreported untested-time claim',()=>{
  const user='最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='这次同学找到两份材料、少问一次（尚未测时间）。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/尚未测时间/)
  assert.match(out,/两份材料/)
})

test('C6-T3 keeps a reported 40-second measurement',()=>{
  const user='我整理一次后测了用时，是40秒；没给同学用，没有前后对照。'
  const reply='这次同学找到两份材料、少问一次（尚未测时间）。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/尚未测时间/)
  assert.match(out,/40秒/)
})

test('C6-T2 does not receive a future sample fact',()=>{
  const user='不是因为老师要求；我会主动继续整理，主要想更快看出哪些信息关键，减少自己反复找东西的时间。我还不知道这是否只是一次偶然。'
  const reply='你提到主动继续整理，主要想更快看出关键信息、这次同学找到两份材料、少问一次（尚未测时间）。我想了解的是，当你把零散内容分成几类时，那个瞬间你的感受是什么？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/两份材料|少问一次|尚未测时间/)
  assert.match(out,/主动继续整理/)
})

test('C5-T4 keeps receipt and reply dimensions separate',()=>{
  const user='只谈老师邮件：如果不增加任务，你目前能形成什么暂定理解？'
  const reply='2. 接收状态：老师未回复。3. 归因边界：未回复的原因未知。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/接收状态：老师未回复/)
  assert.match(out,/是否收到未知；截至报告老师未回复/)
})

test('a non-exam summary does not inject an exam direction',()=>{
  const user='社团复盘先暂停，说明当前暂定理解和仍未知。'
  const reply='先梳理这件事。'
  const out=fix(user,reply)
  assert.equal(out,reply)
  assert.doesNotMatch(out,/考研/)
  assert.doesNotMatch(out,/具体贡献|目标标准/)
})

test('C1-T6 does not conceal a missing summary with fabricated unknowns',()=>{
  const user='先暂停考研方向，不删除刚才查过的事实。说明当前暂定理解和仍未知的地方，这周不再安排任务。'
  const reply='考研方向已暂停，事实保留。这周先不安排动作，等你有时间再继续。'
  const out=fix(user,reply)
  assert.equal(out,reply)
  assert.doesNotMatch(out,/具体贡献|目标标准/)
})

test('C4-T5 stable wording is softened after two reports',()=>{
  const user='回来反馈：一周后我又和同一个室友打了一次，仍然放松，但当天身体累所以提前结束。不要用一次疲惫推翻之前的感受。'
  const reply='两次体验均支持放松感。身体疲惫导致的提前结束属于独立变量，这一感受在重复实践中保持稳定。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/保持稳定|属于独立变量/)
  assert.match(out,/不能判定稳定|单独记录的身体状态/)
})

test('C2-T2 a computer-open link is not technical delivery',()=>{
  const user='链接在电脑能打开，我不知道导师是否读过；发送时只说了请看看。'
  const reply='链接在电脑能打开，说明技术送达无问题。后续可以确认已读。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/说明技术送达无问题/)
  assert.match(out,/只说明链接在你这边可用/)
})

test('not caring about being a boss is not a refusal',()=>{
  const user='我主要在意能自己安排一天中专注工作的时间，不在意当老板，也不想承担找客户和收款。'
  const reply='你排除了当老板、找客户和收款，在意的是能自己安排一天中专注工作的时间。'
  const out=repairUnsupportedPreferenceClaim(reply,user)??reply
  assert.doesNotMatch(out,/你排除了当老板/)
  assert.match(out,/没有把当老板作为目标/)
})

test('ambiguous model feedback is normalized before strict growth staging',()=>{
  assert.deepEqual(normalizeModelFeedbackDelta({kind:'feedback',source:{quote:'同学少问一次只是结果'}}),{kind:'context',source:{quote:'同学少问一次只是结果'}})
  assert.equal(normalizeModelFeedbackDelta({kind:'feedback',source:{quote:'我还没开始整理'}}).progressState,'unattempted')
  assert.equal(normalizeModelFeedbackDelta({kind:'feedback',source:{quote:'我已经整理完了'}}).progressState,'unknown')
  assert.deepEqual(normalizeModelFeedbackDelta({kind:'feedback',source:{quote:'同学少问一次'},progressState:'bogus'}),{kind:'context',source:{quote:'同学少问一次'}})
  assert.deepEqual(normalizeModelFeedbackDelta({kind:'feedback',source:{quote:'同学少问一次'},progressState:''}),{kind:'context',source:{quote:'同学少问一次'}})
  assert.equal(normalizeModelFeedbackDelta({kind:'feedback',source:{quote:'我已经开始整理，尚未完成'},progressState:'in_progress'}).progressState,'unknown')
  assert.equal(normalizeModelFeedbackDelta({kind:'feedback',source:{quote:'我试过这个方法，但没有完成'},progressState:'in_progress'}).progressState,'unknown')
  assert.equal(normalizeModelFeedbackDelta({kind:'feedback',source:{quote:'我还没开始整理'},progressState:'in_progress'}).progressState,'unattempted')
  assert.equal('progressState'in normalizeModelFeedbackDelta({kind:'context',source:{quote:'同学少问一次'},progressState:'completed'}),false)
})

test('C1-T3 removes a dangling question lead and missing answers',()=>{
  const user='接着升学和就业的取舍。家里希望我走稳定路线，但这是外部期待；我自己更在意留在目前城市，而且每周最多四小时探索。请更新判断，不要替我选。'
  const reply=`先厘清稳定路线与城市偏好。

你提到家里希望走稳定路线，但你更在意留在目前城市，且每周最多四小时探索。这里有一个关键点需要确认：你所说的“稳定路线”具体指什么？

因为“留在目前城市”和“稳定路线”并不必然冲突，也不必然一致。如果“稳定路线”恰好就在目前城市，那两者可以兼容；如果“稳定路线”意味着必须离开目前城市，那才构成真正的取舍。

所以，在更新判断之前，我需要知道：

这两个答案会直接改变“升学 vs 就业”这个框架是否成立，以及四小时探索该往哪个方向用。`
  const out=fix(user,reply)
  assert.doesNotMatch(out,/我需要知道|这两个答案/)
  assert.match(out,/稳定路线.*具体指什么/)
})

test('C1-T4 does not prove no local job exists and keeps hope separate from requirement',()=>{
  const user='更正：家里没有要求我必须本校读研，只是希望稳定。请只重开受这条更正影响的判断，并给一个四小时内的小验证。'
  const reply=`先核对稳定路线是否兼容留城。

更正已生效：家里没有要求必须本校读研，只是希望稳定。这条更正重开了之前可能存在的“本校读研=家里要求”的判断，现在家里要求的是“稳定”，而非特定路径。

四小时内的小验证：
列出目前城市里，你认为符合“稳定”定义的具体工作或岗位类型（例如：本地国企、公务员、事业单位、本地大型企业等）。这一步不需要做决定，只需要把“稳定”这个抽象词，映射到“目前城市”这个具体空间里，看看两者是否有交集。

停止条件：
列出至少三个具体岗位类型，或确认目前城市内没有符合“稳定”定义的岗位类型，即可停止。`
  const out=fix(user,reply)
  assert.doesNotMatch(out,/家里要求的是/)
  assert.doesNotMatch(out,/确认目前城市内没有/)
  assert.match(out,/不等于当地没有/)
})

test('C1-T6 clarifies the external-expectation pronoun',()=>{
  const user='先暂停考研方向，不删除刚才查过的事实。说明当前暂定理解和仍未知的地方，这周不再安排任务。'
  const reply=`考研方向已暂停，之前查过的事实全部保留，不删除。

当前暂定理解：
- 家里没有要求你必须本校读研，但这是外部期待，不是你的内在驱动。`
  const out=fix(user,reply)
  assert.doesNotMatch(out,/但这是外部期待，不是你的内在驱动/)
  assert.match(out,/家里希望你稳定/)
})

test('C2-T1 does not assert delivery without receipt or invent a content cause',()=>{
  const user='我是成年大学生，方向暂定找产品实习。我把作品集链接发给导师了，对方还没回复。请复盘真正影响下一步的缺口，不要把未回复说成不采用。'
  const reply=`先核对作品集与岗位匹配。

已发送链接，对方未回复，状态为“已送达、未回复”，不等于拒绝或不采用。

如果作品集仍是通用展示（如课程作业、设计稿），而导师或潜在雇主需要看到产品思维（如需求分析、原型迭代、用户反馈处理），那么“未回复”可能源于内容相关性不足，而非态度问题。`
  const out=fix(user,reply)
  assert.doesNotMatch(out,/已送达/)
  assert.doesNotMatch(out,/源于内容相关性不足/)
  assert.match(out,/是否送达未知|未回复原因仍未知/)
})

test('C2-T2 a computer-open link is not proof of delivery',()=>{
  const user='链接在电脑能打开，我不知道导师是否读过；发送时只说了请看看，没有约定回复时间。'
  const reply='链接能打开，说明送达无技术障碍。未约定回复时间，意味着当前处于“等待自然反馈”状态，而非“逾期”。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/说明送达无技术障碍/)
  assert.match(out,/只说明链接在你这边可用/)
})

test('C2-T4 uses one stop condition',()=>{
  const user='我可以导出PDF，今天只愿意做一个动作。请给能开始的一步，并说明何时停止。'
  const reply='导出PDF并发送，收到回复即停。\n\n今天只做一个动作：把作品集导出成PDF，通过你们已经在用的那个渠道发给导师。\n\n停止条件：发送完成即停。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/收到回复即停/)
  assert.match(out,/发送完成即停/)
})

test('C2-T5 an unreported stage is unknown, not proof it did not happen',()=>{
  const user='回来反馈：我发了PDF，导师确认已经读到，但还没有说是否采用其中建议，也没有给效果反馈。'
  const reply='已送达已读，采用与效果待确认。目前状态停留在“已读”，尚未进入“内容评估”、“采纳”或“产生效果”环节。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/尚未进入/)
  assert.match(out,/是否采用和实际效果仍未知/)
})

test('C2-T6 reply and read layers cannot contradict',()=>{
  const user='请把已发、已读、已回复、是否采用、实际效果分开说，只更新相关理解，不安排催促。'
  const reply='已发：PDF已送达导师。已读：导师确认读到。已回复：未报告导师有回复。是否采用：未报告导师是否采纳建议。实际效果：未报告任何效果。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/已回复：未报告导师有回复/)
  assert.match(out,/已回复：有（此前回复访问问题\/确认读到）/)
})

test('C2-T6 collapses duplicate state blocks after unifying reply status',()=>{
  const user='请把已发、已读、已回复、是否采用、实际效果分开说，只更新相关理解，不安排催促。'
  const reply=`已发：PDF已发送。
已读：导师确认已读。
已回复：有（此前回复访问问题/确认读到）。
是否采用：未知。
实际效果：未知。

不安排催促，等待导师反馈。

已发：PDF已发送。
已读：导师确认已读。
已回复：未回复。
是否采用：未知。
实际效果：未知。`
  const out=fix(user,reply)
  assert.doesNotMatch(out,/已回复：未报告|已回复：未回复/)
  assert.equal((out.match(/已回复：有/g)??[]).length,1)
})

test('C3-T4 a later two-or-three-job expansion is reduced to one',()=>{
  const user='我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。给一个边界清楚的小行动。'
  const reply='你可以打开一个招聘网站，搜索“远程”或“线上”岗位，只阅读职位描述（JD）中关于工作时间的部分。重点看是否提到“异步沟通”、“固定在线时段”或“结果导向”。这个行动不需要联系任何人，也不需要提交资料。只需记录你看到的两三个不同岗位对时间的描述差异。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/两三个不同岗位/)
  assert.match(out,/这个岗位|一个岗位/)
})

test('C6-T6 labels an existing substantive summary instead of duplicating it',()=>{
  const user='我今天没精力继续验证，先暂停这个方向，不要再安排动作。只给一句阶段理解，等我以后主动回来再继续。'
  const reply='先暂停，等你主动回来。目前只整理过一次奖学金材料，第二天约20秒找到通知，仅此一次，不代表稳定效果。'
  const out=fix(user,reply)
  assert.match(out,/^阶段理解：/)
  assert.equal((out.match(/阶段理解/g)??[]).length,1)
})

test('C3-T3 removes unrequested exam-prep advice',()=>{
  const user='接着自由这件事。我还没有客户，也没有自由职业经历，每周最多两小时。请比较一个更低成本的探索方式，不要推出我适合自由职业。'
  const reply='方式A：观察记录。方式B：微型交付。如果一时约不到人，先用公开的真题/面经各花 30 分钟自测，再决定是否约人；这样不依赖别人也能开始。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/真题|面经/)
  assert.match(out,/方式A|方式B/)
})

test('C3-T4 one reported job stays one and the three items are complete',()=>{
  const user='我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。给一个边界清楚的小行动。'
  const reply='看岗位描述里的协作工具。这三项信息直接反映真实工作节奏，不需要联系任何人。如果JD里没写这些，就换下一个岗位看，最多看两个。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/就换下一个|最多看两个/)
  assert.match(out,/不换下一个/)
  assert.match(out,/协作工具、会议节奏、响应时间/)
})

test('C4-T1 opens an invented binary question',()=>{
  const user='我是成年大学生，昨晚和室友打羽毛球后觉得轻松。请从生活体验聊起，不要加付款、采用、效率评分或职业标签。先问一个值得问的问题。'
  const reply='想问一个值得问的问题：这种轻松，是身体动完之后的那种松快，还是跟室友待在一起、不用想别的事的那种放松？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/还是/)
  assert.match(out,/具体是什么感觉/)
})

test('C4-T3/T5/T6 preserve the two-factor unknown',()=>{
  const user='接着羽毛球那次体验。我想保留这种不被评价的陪伴，但不确定是运动本身还是这个室友带来的。请给暂定理解和一个很小的区分办法。'
  const reply='暂定理解：目前尚无法确定它主要源于羽毛球这项运动本身，还是源于这位室友带来的特定氛围。\n\n一个很小的区分办法：如果依然存在，说明运动本身的低压力属性是关键；如果感觉明显不同，说明这位室友的个人特质是核心变量。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/是关键|核心变量/)
  assert.match(out,/不能确定|保留未知|仍无法区分/)
})

test('C4-T5 does not turn two observations into a stable main cause',()=>{
  const user='回来反馈：一周后我又和同一个室友打了一次，仍然放松，但当天身体累所以提前结束。不要用一次疲惫推翻之前的感受。'
  const reply='两次和同一个室友打球都感到放松，说明“不被评价的陪伴”这个体验是稳定的。这更支持“室友带来的安全感”是主要来源，因为如果是纯运动，疲劳时体验通常会打折。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/体验是稳定的|是主要来源/)
  assert.match(out,/不能判定|不能确定|线索/)
})

test('C5-T5 separates teacher intent and table rejection from adoption',()=>{
  const user='回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。请只更新各自相关状态。'
  const reply='状态已分别更新。当前状态为已回复、待下周跟进，未回复阶段结束。同学表格：状态仍为已交付、已反馈、未采用。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/待下周跟进|未采用/)
  assert.match(out,/老师表示下周再看|已反馈不适合/)
})

test('C6-T3 a single result is a clue, not validation',()=>{
  const user='接着整理资料的探索。最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。请根据新信息更新判断，不要重复问已经回答的内容。'
  const reply='分类规则已验证有效。同学能直接找到材料且少问一次，说明三条规则在实际协作中降低了沟通成本。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/已验证有效|降低了沟通成本/)
  assert.match(out,/分类规则是否有效仍不能确认/)
  assert.match(out,/同学能直接找到材料且少问一次/)
})

test('C6-T5 does not move a prior feeling into the new event',()=>{
  const user='回来反馈：我把奖学金材料按三条规则整理了一次，第二天大约20秒找到通知，但目前只发生过一次。不要把一次成功当成职业适合。'
  const reply='你报告的“20秒找到通知”和“不用反复找”的轻松感，是这次整理动作带来的具体结果。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/是这次整理动作带来的具体结果/)
  assert.match(out,/来自此前的经历/)
})

test('C6-T6 supplies the requested one-sentence phase understanding',()=>{
  const user='我今天没精力继续验证，先暂停这个方向，不要再安排动作。只给一句阶段理解，等我以后主动回来再继续。'
  const reply='已暂停，等你回来。'
  const out=fix(user,reply)
  assert.match(out,/阶段理解/)
  assert.doesNotMatch(out,/安排|任务/)
})

test('a preparation concern is not upgraded into an anxiety motive or default choice',()=>{
  const user='我真正想要的是毕业后做有清晰产出的工作，也担心直接就业准备不足；我并不享受考试本身。'
  const reply='这三点放在一起，说明考研目前更像是一个缓解“准备不足”焦虑的默认选项，而不是基于对“清晰产出”的明确追求。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/缓解.*焦虑|默认选项|而不是基于/)
  assert.match(out,/只能确认|仍需核对|不能据此/)
})

test('an explicit time-autonomy answer is acknowledged instead of re-asked against an invented preference',()=>{
  const user='我主要在意能自己安排一天中专注工作的时间，不在意当老板，也不想承担找客户和收款。'
  const reply='你更在意时间自主还是少管人？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/还是少管人/)
  assert.match(out,/能自己安排.*专注工作的时间/)
})

test('not-disliking an activity is not upgraded into a confirmed liking',()=>{
  const user='今天只想聊聊，不做实验，也不要继续追问。我有点累，但这不代表我不喜欢羽毛球。'
  const reply='累了就歇，喜欢还在。不想做实验、不想被追问，都听你的。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/喜欢还在/)
  assert.match(out,/疲惫不等于不喜欢羽毛球/)
})

test('a clue repair cannot contradict itself by banning the same clue wording',()=>{
  const user='最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。'
  const reply='这是目前唯一一次可观察的结果，只能作为线索，不能写成“这次分类规则带来一个积极线索”或“稳定减少询问”。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/不能写成.*积极线索/)
  assert.match(out,/积极线索/)
  assert.match(out,/不能证明|尚不能/)
})

test('an unanswered portfolio link does not prove the portfolio content is the operative gap',()=>{
  const user='我把作品集链接发给导师了，对方还没回复。请复盘真正影响下一步的缺口，不要把未回复说成不采用。'
  const reply='目前真正影响下一步的缺口是：作品集本身是否具备可被导师快速评估的产品实习相关证据。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/真正影响下一步的缺口是：作品集本身/)
  assert.match(out,/是否收到|是否读过|未回复原因仍未知/)
})

test('a next-week teacher reply never proves full reading, including repeated repair passes',()=>{
  const user='老师后来回复说这周忙，下周再看。'
  const reply='老师邮件：已回复（这周忙，下周再看）；是否已读和后续回应仍未知。'
  const out=fix(user,reply)
  assert.match(out,/是否已读.*未知/)
  assert.doesNotMatch(out,/至少已读|实质回复说明/)
  assert.match(out,/后续.*未知|下周.*未知/)
  assert.equal(fix(user,out),out)
})

test('a requested one-sentence phase understanding discards duplicate preambles',()=>{
  const user='我今天没精力继续验证，先暂停这个方向，不要再安排动作。只给一句阶段理解，等我以后主动回来再继续。'
  const reply='一次整理有效，方向已暂停。\n\n你按三条规则整理后找到通知，这是一次经历。\n\n阶段理解：目前线索有限，尚不能判定稳定效果；先暂停，等你主动回来。'
  const out=fix(user,reply)
  assert.equal(out,'阶段理解：目前线索有限，尚不能判定稳定效果；先暂停，等你主动回来。')
})

test('the absence of a family requirement is not itself labeled an external expectation',()=>{
  const user='先暂停考研方向，不删除刚才查过的事实。'
  const reply='- 家里没有要求你必须本校读研，但这是外部期待。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/没有要求[^。]*但这是外部期待/)
  assert.match(out,/家里希望.*稳定|没有要求.*本校读研/)
})

test('an update or feedback turn does not re-ask the unresolved clear-output definition',()=>{
  for(const user of [
    '请更新判断，不要替我选。',
    '回来反馈：我分别看了一个本地初级岗位和一个硕士培养方案。这个小样本只代表这两个选项。',
  ]){
    const reply='你真正想要的是有清晰产出的工作。你心中“清晰产出”的具体画面是什么？'
    const out=fix(user,reply)
    assert.doesNotMatch(out,/具体画面是什么[？?]/)
  }
})

test('a family-requirement correction does not invent expanded paths or nontraditional directions',()=>{
  const user='更正：家里没有要求我必须本校读研，只是希望稳定。请只重开受这条更正影响的判断，并给一个四小时内的小验证。'
  const reply='升学路径不再局限于本校，选择面扩大。若感到模糊或排斥，说明“清晰产出”可能指向非传统就业场景（如自由职业、内部创业等）。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/选择面扩大|自由职业|内部创业/)
  assert.match(out,/只解除.*家庭要求|不能据此/)
})

test('a paused exam direction does not introduce unreported alternative directions',()=>{
  const user='先暂停考研方向，不删除刚才查过的事实。这周不再安排任务。'
  const reply='考研方向暂停，但其他方向（就业、自由职业、科研探索等）未关闭。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/自由职业|科研探索/)
  assert.match(out,/考研方向.*暂停/)
})

test('no-reply cannot make a missing explanatory message the operative cause or schedule another message',()=>{
  const user='我把作品集链接发给导师了，对方还没回复。请复盘真正影响下一步的缺口，不要把未回复说成不采用。'
  const reply='真正影响下一步的缺口是：发送时是否附带了具体说明。如果只有链接，下一步可以补发一条简短说明。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/真正影响.*具体说明|补发/)
  assert.match(out,/未回复原因仍未知|是否收到|是否读过/)
})

test('comparison proposals are not replaced by the fallback for assigned low-cost actions',()=>{
  const actual=JSON.parse(readFileSync(new URL('./fixtures/nx-comparison-transform-failure.json',import.meta.url),'utf8')).turns[2]
  assert.equal(fix(actual.user,actual.raw.reply),actual.raw.reply,'keep the requested options, original evidence, costs and limits')
  // The legacy action-stage protection remains; selecting or assigning a task
  // is a different operation from comparing proposed candidates.
  const actionUser='我还没有客户，也没有自由职业经历，每周最多两小时。请给两个更低成本的探索动作。'
  const unsafe='方式一：参与开源项目或线上志愿活动。方式二：帮同学改简历或做简单设计。成本：零金钱成本。先找一个线上小任务。'
  const out=fix(actionUser,unsafe)
  assert.doesNotMatch(out,/开源项目|志愿活动|帮同学|找一个线上小任务|零金钱成本/)
  assert.match(out,/公开信息|现有日程|不联系/)
})

test('one public job remains exactly one even if rhythm information is absent',()=>{
  const user='我愿意只了解一个远程岗位的真实工作节奏，不联系陌生人、不提供私人资料。给一个边界清楚的小行动。'
  const reply='只看一个岗位。如果公开信息里找不到节奏描述，就换下一个岗位，仍找不到则停。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/换下一个岗位/)
  assert.match(out,/这个岗位.*停|找不到.*停/)
})

test('two fixed meetings may affect focus but do not prove that time blocks are cut',()=>{
  const user='他说地点自由，但每天固定开两次会。这是一条个例。'
  const reply='固定的两次会议也会切割你的时间块。这只是一个线索。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/会切割/)
  assert.match(out,/可能|是否影响.*未知/)
})

test('an exploration time limit is not converted into an exam preparation capacity claim',()=>{
  const user='接着升学和就业的取舍。家里希望我走稳定路线，但这是外部期待；我自己更在意留在目前城市，而且每周最多四小时探索。请更新判断，不要替我选。'
  const reply='若目标院校在本地，需评估4小时/周是否足以支撑备考（通常不足，需额外时间或降低强度）。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/足以支撑备考|通常不足|降低强度/)
  assert.match(out,/四小时.*只约束探索|备考投入.*未知/)
})

test('a family correction does not narrate an unobserved prior hard requirement',()=>{
  const user='更正：家里没有要求我必须本校读研，只是希望稳定。请只重开受这条更正影响的判断，并给一个四小时内的小验证。'
  const reply='这意味着“本校读研”从“必须项”降级为“可选路径之一”，且升学路径不再局限于本校。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/从“必须项”降级|不再局限于本校/)
  assert.match(out,/只确认.*不是家庭硬要求|可选路径是否变化仍未知/)
})

test('a settled time-autonomy definition carries into later low-cost comparison',()=>{
  const prior=['我主要在意能自己安排一天中专注工作的时间，不在意当老板，也不想承担找客户和收款。']
  const user='接着自由这件事。我还没有客户，也没有自由职业经历，每周最多两小时。请比较一个更低成本的探索方式，不要推出我适合自由职业。'
  const reply='观察一周，区分你想要的“自由”是时间控制、地点灵活，还是决策权。'
  const out=repairReviewedDefects(reply,user,prior)?.reply??reply
  assert.doesNotMatch(out,/区分.*时间控制.*地点灵活.*决策权/)
  assert.match(out,/已经明确.*安排.*专注工作的时间/)
})

test('a public job description cannot support invented daily weekly or occasional frequencies',()=>{
  const user='我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。给一个边界清楚的小行动。'
  const reply='把岗位描述里的具体任务逐条抄下来，旁边标注“这条是每天做、每周做、还是偶尔做”。抄完后你就有这个岗位一天大概做什么的真实工作节奏。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/标注.*每天做.*每周做.*偶尔做|一天大概做什么的真实工作节奏/)
  assert.match(out,/只记录公开页面明确写出的.*时间|未写明.*信息不足/)
})

test('a one-question-only request returns only the first substantive question',()=>{
  const user='先别排备考日程，只问一个会改变选择的问题。'
  const reply='你希望考研改变什么？\n\n身边同学都在准备考研，你跟着想报。先别排备考日程，只问一个会改变选择的问题：'
  const out=fix(user,reply)
  assert.equal(out,'你希望考研改变什么？')
})

test('a dangling example heading and open parenthesis are normalized as prose',()=>{
  const user='我想要有清晰产出的工作，也担心直接就业准备不足。'
  const reply='你希望“清晰产出”具体指什么？\n\n例如：\n\n（请描述你脑海中最典型的一天或一个场景，这有助于判断准备不足到底缺的是什么。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/例如：\s*$|（请描述/)
  assert.match(out,/请描述你脑海中最典型的一天或一个场景/)
})

test('a correction-only answer removes invented history before the requested validation',()=>{
  const user='更正：家里没有要求我必须本校读研，只是希望稳定。请只重开受这条更正影响的判断，并给一个四小时内的小验证。'
  const reply='受此更正影响的判断重开如下：\n1. 外部期待性质变化：家里的稳定不再绑定本校读研。\n2. 决策变量解耦：之前可能将本校与稳定混同。\n\n**四小时内的小验证**：只看公开信息。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/性质变化|之前可能|变量解耦/)
  assert.match(out,/只确认.*不是家庭硬要求/)
  assert.match(out,/四小时内的小验证/)
})

test('the observed public-job instruction records only explicit schedule fields',()=>{
  const user='我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。给一个边界清楚的小行动。'
  const reply='小行动：挑一个你已知的远程岗位名称，在招聘网站或公司官网找它的公开职位描述，只看“工作内容”和“任职要求”两段，用10分钟把里面提到的具体任务逐条抄下来，旁边标注“这条是每天做、每周做、还是偶尔做”。\n\n停止条件：抄完或10分钟到即停，不继续找第一个岗位。做完后你手里会有一张“这个岗位一天大概做什么”的清单，这就是真实工作节奏的公开线索。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/每天做、每周做、还是偶尔做|不继续找第一个岗位|一天大概做什么/)
  assert.match(out,/只记录公开页面明确写出的.*时间/)
  assert.match(out,/不换其他岗位|信息不足/)
})

test('a public-rhythm action leaves no later request to guess task frequency',()=>{
  const user='我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。给一个边界清楚的小行动。'
  const reply='用公开信息还原岗位一天。\n\n只记录页面明确写出的时间要求；未写明的频率标记为信息不足。\n\n带回来的反馈：哪几条任务你标了“每天做”，哪几条标不出来。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/还原岗位一天|标了“每天做”/)
  assert.match(out,/核对岗位节奏线索|明确写了哪些时间要求/)
})

test('a public-rhythm stop condition and feedback stay tied to explicit fields',()=>{
  const user='我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。给一个边界清楚的小行动。'
  const reply='停止条件：抄完或10分钟到即停。带回来的反馈：明确写了哪些时间要求。标不出来的那条，就是下一步值得再看的点。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/抄完或|标不出来的那条/)
  assert.match(out,/记录完明确字段或10分钟到即停/)
})

test('a carried time-autonomy definition removes repeated definition claims and zero-time language',()=>{
  const prior=['我主要在意能自己安排一天中专注工作的时间。']
  const user='接着自由这件事。我还没有客户，也没有自由职业经历，每周最多两小时。请比较一个更低成本的探索方式。'
  const reply='方式一：观察与记录（成本最低，几乎零额外时间）。在接下来一周记录三天。它能帮你澄清“自由”的个人定义。'
  const out=repairReviewedDefects(reply,user,prior)?.reply??reply
  assert.doesNotMatch(out,/几乎零额外时间|接下来一周|澄清“自由”的个人定义/)
  assert.match(out,/实际耗时未知|接下来三天|专注时间是否可自主安排/)
})

test('an update-only turn does not append an unrequested exploration task',()=>{
  const user='请更新判断，不要替我选。'
  const reply='已更新：城市与时间优先，不替你选。\n\n3. **下一步建议（基于4小时/周）**：\n- 行动：列出3个岗位或3个院校。\n- 目的：比较路径。\n\n**待确认**：稳定具体指什么？'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/城市与时间优先|下一步建议|列出3个/)
  assert.match(out,/记录城市偏好与探索时间上限/)
  assert.match(out,/待确认/)
})

test('a correction validation does not equate company type with stability or compare hidden costs',()=>{
  const user='更正：家里没有要求我必须本校读研，只是希望稳定。请只重开受这条更正影响的判断，并给一个四小时内的小验证。'
  const reply='**四小时内的小验证**：\n**动作**：筛选3个你认为“相对稳定”（如非初创、有明确职责）的岗位。\n**目的**：验证直接就业的稳定程度，同时对比本校读研的隐性成本。\n**停止条件**：找到3个岗位即停。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/非初创|稳定程度|隐性成本|找到3个岗位/)
  assert.match(out,/最多三项可核对条件/)
  assert.match(out,/不判断哪条路径更好/)
})

test('not enjoying exams does not create a generic graduate-study contradiction',()=>{
  const user='我真正想要的是毕业后做有清晰产出的工作，也担心直接就业准备不足；我并不享受考试本身。'
  const reply='这三点放在一起，指向一个核心矛盾：你追求工作成果的可感知性，而考研通常被视为一种延迟产出、以考试为门槛的路径。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/核心矛盾|考研通常被视为|延迟产出/)
  assert.match(out,/只能确认|是否适合仍需具体核对/)
})

test('an unmatched Chinese parenthesis is removed without changing the sentence',()=>{
  const user='请更新判断。'
  const reply='当前只整理已报告的信息。\n\n（注：以上不替你选择。'
  const out=fix(user,reply)
  assert.equal(out,'当前只整理已报告的信息。\n\n注：以上不替你选择。')
})

test('no-task relationship summary removes future observation tasks and stable wording',()=>{
  const user='请更新这段经历的局部理解，保留未知；不生成任务。'
  const reply='两次打球都报告了放松，这是目前最稳的线索。如果之后还想继续，可以留意下次是否仍然放松。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/最稳|可以留意|下次/)
  assert.match(out,/样本仍小|保留未知|不能判定稳定/)
})

test('listening does not invent that the user does not want to think',()=>{
  const user='今天只想说说：老师没回复邮件让我有点失落。不要建议、不要追问。'
  const reply='今天不想动脑子，就停在这儿，不用急着找原因。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/不想动脑子/)
  assert.match(out,/只想说说|不建议|不追问/)
})

test('sent mail is not delivered mail without a receipt',()=>{
  const user='只谈老师邮件：如果不增加任务，你目前能形成什么暂定理解？'
  const reply='暂定理解：邮件已送达，但老师是否阅读未知。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/已送达/)
  assert.match(out,/已发送|是否送达未知/)
})

test('one classification result cannot be validation or reduced communication cost',()=>{
  const user='最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。请根据新信息更新判断。'
  const reply='新信息确认了分类规则的实际效果。这切实降低了他人的沟通成本，并验证了这种整理方式在协作场景下的有效性。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/确认了.*实际效果|切实降低|验证了|有效性/)
  assert.match(out,/一次|线索|未知/)
})

test('a corrected personal gain does not keep colleague feedback in the next action',()=>{
  const user='同学少问一次只是结果，不代表我因此有成就感；我当时真正轻松的是自己不用反复找。只更新受影响的判断，给一个本周能开始的小动作。'
  const reply='下次整理时，记录两件事——你自己找东西时是否少了一次来回翻找，以及同学是否仍来问你。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/同学是否仍来问/)
  assert.match(out,/自己.*反复找|自己.*翻找/)
})

test('a one-factor relationship comparison never maps the outcome to a core or key cause',()=>{
  const user='我不确定是运动本身还是这个室友带来的。请给一个很小的区分办法。'
  const reply='如果换人后仍放松，说明“不被评价的陪伴”本身是核心；如果换人后明显不自在，说明这位室友的特定互动方式起了关键作用。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/说明.*核心|说明.*关键作用/)
  assert.match(out,/只能记录|不能确定|来源仍未知/)
})

test('not-disliking an activity does not establish a preference that must be trusted',()=>{
  const user='我有点累，但这不代表我不喜欢羽毛球。'
  const reply='不用因为今天没劲就怀疑自己的喜好。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/自己的喜好/)
  assert.match(out,/疲惫.*不等于不喜欢羽毛球/)
})

test('two matching reports are not called the steadiest clue',()=>{
  const user='一周后我又和同一个室友打了一次，仍然放松，但当天身体累。'
  const reply='两次打球都报告了放松，这是目前最稳的线索。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/最稳/)
  assert.match(out,/样本仍小|不能判定稳定/)
})

test('a hoped-for lookup benefit is not rewritten as an observed personal value',()=>{
  const user='我主要想更快看出哪些信息关键，减少自己反复找东西的时间。我还不知道这是否只是一次偶然。'
  const reply='这已经说明整理对你有实际价值，也说明你在这件事里找到了自己的用处。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/有实际价值|找到了自己的用处/)
  assert.match(out,/这是目标|效果仍未知|是否实现仍未知/)
})

test('a choice update does not introduce freelancing as an unreported option',()=>{
  const user='请更新判断，不要替我选。'
  const reply='此缺口决定是优先积累作品集（偏向直接就业/自由职业）还是了解行业门槛。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/自由职业/)
  assert.match(out,/未提及|不新增/)
})

test('the two-factor distinction changes one factor only',()=>{
  const user='我不确定是运动本身还是这个室友带来的。请给一个很小的区分办法。'
  const reply='下次找另一个你愿意一起活动的人，做一件同样不需要表现的事，比如散步或拼图。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/散步|拼图|做一件/)
  assert.match(out,/换一位.*同样.*羽毛球|保持.*羽毛球/)
})

test('the exact one-sample classification update is replaced as one conservative result',()=>{
  const user='最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。请根据新信息更新判断，不要重复问已经回答的内容。'
  const reply='这表明规则减少了自己反复找东西的时间，还切实降低了他人的沟通成本；这一具体场景下的效果已得到验证，可以继续观察其他课程。'
  const out=fix(user,reply)
  assert.doesNotMatch(out,/减少了自己|切实降低|得到验证|继续观察/)
  assert.match(out,/一次具体结果|不能确认|未知/)
})
