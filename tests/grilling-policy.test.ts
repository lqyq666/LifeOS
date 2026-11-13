import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mainCompanionPolicy,extractCompanionPolicies} from '../server/companion-policy.ts'
import {turnSystemPrompt,buildTurnPrompt,providerTurnMessages} from '../server/turn-prompt.ts'
import {deriveTurnContract,bindRequestedSummarySchema} from '../server/turn-contract.ts'
import {readFileSync} from 'node:fs'
import {productModeOpeningPrompt} from '../src/features/conversation/product-modes.ts'

const gapHeading='## Personal understanding — gap checks, not a questionnaire'
const gapSection=mainCompanionPolicy.instructions.slice(mainCompanionPolicy.instructions.indexOf(gapHeading),mainCompanionPolicy.instructions.indexOf('## LifeOS Grilling — evidence-led exploration'))
const gapPolicy=gapSection.trim()

test('personal understanding gap rules lie inside the consumed business policy, not a detached appendix',()=>{
 const source=readFileSync(new URL('../skills/lifeos-personal-companion/SKILL.md',import.meta.url),'utf8')
 const extracted=extractCompanionPolicies(source)
 assert.ok(gapPolicy.startsWith(gapHeading));assert.ok(gapPolicy.length<1800,'keep the checklist compact')
 assert.ok(extracted.instructions.includes(gapPolicy))
 assert.ok(!extracted.grillingInstructions.includes(gapHeading),'independent grilling policy remains unchanged')
 for(const name of ['基础处境','经历与能力证据','兴趣、价值与意义','行为与学习方式','精力与现实条件','方向与生活愿景','思维与情绪应对','关系、支持与协作'])assert.ok(gapPolicy.includes(name))
 for(const text of ['我独立完成过一次比赛，但有人帮我检查结果。','最近疲惫、不想去实验室。']){
  const contract=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
  const system=turnSystemPrompt('default','qwen3.8-flash',contract,false)
  assert.ok(system.includes(gapPolicy),'normal runtime model prompt consumes the entire checklist')
  assert.match(system,/一次独立完成比赛只支持当次行动，不推出排斥合作或适合创业/)
  assert.match(system,/未核对前不保存为科研兴趣不足或不适合科研/)
  assert.match(system,/反馈速度偏好仍需本人陈述或具体取舍证据/)
  assert.match(system,/不能称为短板、能力不足或准备不足/)
  assert.match(system,/年级、先修课程、成绩、专业限制及申请流程未核实时，列为待核对条件/)
  assert.match(system,/比较中不笼统排序自主最高、反馈最慢或离帮助别人最远/)
  assert.match(system,/阅读摘要的反应只支持对该材料的当时兴趣/)
 }
})

test('ordinary unmarked follow-up inherits evidence limits for route attributes and tiny probes',()=>{
 const text='继续选方向。比较独立产品、实习和科研的投入与未知。'
 const contract=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
 const prompt=turnSystemPrompt('default','qwen3.8-flash',contract,false)
 assert.match(prompt,/每个选项的属性须另有该选项的报告，缺少就未知/)
 assert.match(prompt,/未核实的路径属性不能填写高\/中\/低匹配度/)
 assert.match(prompt,/一次无人使用、疲惫、中途停止或读不下摘要/)
 assert.match(prompt,/不保证两小时做完Demo/)
 assert.match((contract.schema.properties as any).reply.description,/比较路径不按名称排自主高低、助人远近或反馈快慢/)
 assert.equal((contract.schema.properties as any).reply.maxLength,16000)
})

test('gap checks keep refusal, counterexamples, partial history and existing memory controls explicit',()=>{
 for(const phrase of ['先解决当前问题','每轮优先只问一个','拒答保留为拒答','不要求一次问全','当前读取范围没有依据','新反例收窄旧观察','其他有效事实保留','模式开场、只读总结、AI问题和建议不是用户事实','同一段经历不重复计为多份独立证据','记忆关闭、拒绝、暂停和遗忘'])assert.ok(gapPolicy.includes(phrase),phrase)
 assert.match(productModeOpeningPrompt('understand'),/当前最影响帮助的缺口问一个问题/)
 assert.match(productModeOpeningPrompt('understand'),/不重复询问已知或拒答内容/)
 assert.match(productModeOpeningPrompt('understand'),/不要展开整份画像/)
 assert.match(gapPolicy,/尚未说明是否喜欢研究.*是未知，不是本人已否认不喜欢/)
 assert.match(gapPolicy,/一次求助只证明该次求助，不推出排斥或不排斥合作等稳定偏好/)
 assert.match(gapPolicy,/不把“如果有\/如果没有”的多个追问/)
})

test('runtime prompt avoids a framing-only lead example without invalidating the original native capability probe',()=>{
 const contract=deriveTurnContract({text:'请更新当前理解。',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
 const full=turnSystemPrompt('default','qwen3.8-flash')
 assert.equal(createHash('sha256').update(full).digest('hex'),'a67a5baded5ce6a82d8bbe60180a264e1bfd6a82cd0b25efaba3c84445582e46')
 const prompt=turnSystemPrompt('default','qwen3.8-flash',contract,false)
 assert.ok(prompt.includes(mainCompanionPolicy.instructions))
 // This budget covers the existing runtime prompt, excluding the exact
 // instructions relocated from per-turn metadata into its cacheable prefix.
 const context=JSON.parse(buildTurnPrompt({currentMessageId:'current',messages:[{id:'current',role:'user',content:'请更新当前理解。'}]}))
 const cachedRules=context.currentTask.responseScope.rules.filter((rule:string)=>prompt.includes(rule))
 assert.equal(cachedRules.length,16)
 // The added checklist has its own 1800-character ceiling above. Keep the
 // pre-existing runtime budget unchanged rather than silently widening it.
 assert.ok(prompt.length-cachedRules.join('\n').length-gapSection.length<14000)
 assert.doesNotMatch(prompt,/"lead":"先核对课程先修要求。"/)
})

test('one-sentence summaries cannot create a separate short lead and a second full sentence',()=>{
 const text='只给一句阶段理解。'
 const contract=bindRequestedSummarySchema(deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false,readOnly:true}),text)
 assert.equal(Object.hasOwn((contract.schema as any).properties,'lead'),false)
 const prompt=turnSystemPrompt('default','qwen3.8-flash',contract,false)
 assert.match(prompt,/不输出lead/)
})

test('normal LifeOS requests consume the versioned grilling policy instead of a detached file',()=>{
  const contract=deriveTurnContract({text:'我不知道毕业后想做什么，想从最近经历开始理清。',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
  const prompt=turnSystemPrompt('default','qwen3.8-flash',contract,false)
  assert.equal(mainCompanionPolicy.version,'1.3.0-candidate')
  assert.equal(mainCompanionPolicy.grilling.version,'lifeos-grilling/1.0.21')
  assert.ok(prompt.includes(mainCompanionPolicy.grilling.instructions))
  assert.match(prompt,/Ask one[\s\S]*change the current understanding or next action/)
  assert.match(prompt,/direct deliverables stay direct/)
  assert.match(prompt,/Do not invent a motive or force[\s\S]{0,8}alternatives/)
  assert.match(prompt,/what outcome the person wants this path to change/)
  assert.match(prompt,/不得给本人未报告的动机或价值补选项/)
  assert.match(prompt,/本人原话已经提出两个选项/)
  assert.match(prompt,/紧接上一问给出的具体回答必须关闭对应unknown/)
  assert.match(prompt,/要求一个动作时只给一项可执行动作/)
  assert.match(prompt,/Reported conditions are not refusals/)
  assert.match(prompt,/Silence is unresolved, not\s+refusal/)
  assert.match(prompt,/A single lead is not a product, a demo or a universal demand/)
  assert.match(prompt,/not a sample-size plan, a recruitment plan or a manual\s+MVP/)
  assert.match(prompt,/this turn is not business validation/)
  assert.match(prompt,/do not propose selling, pricing,\s+a pilot, recruiting participants or a manual MVP/)
  assert.match(prompt,/Interview questions leave "nothing happened", "no trouble"/)
  assert.match(prompt,/Ask first whether the experience happened at\s+all/)
  assert.match(prompt,/do not ask it again/)
  assert.match(prompt,/deliver a startable action with a stop point/)
  assert.match(prompt,/A read receipt is not a content evaluation/)
  assert.match(prompt,/prefer changing one relevant condition/)
  assert.match(prompt,/do\s+not end with a question or a new task/)
  assert.match(prompt,/separate sent, delivered, read, replied/)
  assert.match(prompt,/Do not infer a deadline, pressure, motive or context/)
  assert.match(prompt,/Store no hidden chain of thought/)
})

test('grilling policy replacement changes the independently auditable digest',()=>{
  const original=extractCompanionPolicies(mainCompanionPolicy.instructions+'\n## Three kinds of unknown')
  const changedSource=(mainCompanionPolicy.instructions+'\n## Three kinds of unknown').replace('Ask one','Ask exactly one')
  const changed=extractCompanionPolicies(changedSource)
  const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
  assert.equal(digest(original.grillingInstructions),mainCompanionPolicy.grilling.policyDigest)
  assert.notEqual(digest(changed.grillingInstructions),mainCompanionPolicy.grilling.policyDigest)
  assert.throws(()=>extractCompanionPolicies('## When to follow up, deliver, or stop\nmissing section'),/MAIN_COMPANION_POLICY_UNAVAILABLE/)
})


test('unmarked follow-up repeats only authorized time boundaries beside the actual request',()=>{
 const input={currentUserMessage:{id:'current',role:'user',text:'那个本周需十小时的实习，现在应该怎样判断？'},messages:[],requestTimeUtc:new Date().toISOString(),growth:[{id:'time',revision:2,kind:'constraint',text:'本周只剩三十分钟用于方向探索',assertion:'user_edit',status:'active',sources:[{type:'message',id:'source'}]}],growthBackground:[]}
 const messages=providerTurnMessages(JSON.stringify(input),{provider:'bailian',id:'qwen3.8-flash'})
 const current=messages.at(-1)!.content as string
 assert.match(current,/"amountMinutes":30/)
 assert.match(current,/机会需要的时长不是本人可用预算/)
 assert.ok(current.startsWith(input.currentUserMessage.text))
 assert.doesNotMatch(current,/"amountMinutes":600/)
 const off=providerTurnMessages(JSON.stringify({...input,growth:[]}),{provider:'bailian',id:'qwen3.8-flash'})
 assert.equal(off.at(-1)!.content,input.currentUserMessage.text,'no inaccessible cross-session source is synthesized')
})
