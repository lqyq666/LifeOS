import {scanUserClauses,currentConversationOnly} from './user-command-spans.ts'
import {reportedPerformedTaskClauses} from './turn-contract.ts'
import {hoursIn} from './turn-obligations.ts'
import type {KnowledgeIntent} from './evergreen-guide.ts'
import type {TurnContract} from './turn-contract.ts'

export type BoundedReply={basis:'editorial_adaptation';sourceStatus:'NO_PUBLIC_METHOD'|'PUBLIC_METHOD_NOT_USED';stage:'start'|'blocked'|'waiting_result'|'adopted'|'reported_result';choices:string[];nextUnknown:string}

// This is a budget boundary for a proposed plan, not a source-backed method or
// an assertion that tasks have been chosen, saved, executed or effective.
export function boundedPlanningReply(budget:{minutes:number;period:'current'|'this_week'|'next_week'}):BoundedReply{
 const period=budget.period==='next_week'?'下周':budget.period==='this_week'?'本周':'当前安排时段'
 return {basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'start',nextUnknown:'具体任务仍是候选安排；执行及效果需要实际反馈',choices:[
  `先只安排${period}，把任务总投入控制在你明确的${budget.minutes}分钟以内。具体任务是待你选择的建议，执行和效果仍待反馈。`,
  `先把${period}的可用时间与其他时段分开，以你报告的${budget.minutes}分钟为上限，不要求用满。具体安排尚待你选择，实际执行后再复盘。`,
 ]}
}

// An ordinary action question with no authorized public method may select a
// small editorial action or a process question. The model cannot add a cause,
// effect claim, deadline, number or personal fact to the selected reply.
// Material delivery, scheduling, listening and personal decisions keep their
// existing contracts. This is not a second guide corpus.
export function boundedOrdinaryReply(input:{text:string;intent:KnowledgeIntent;contract:TurnContract;knowledgeCount:number;tier:string;priorInterviewQuestion?:string;verifiedBudget?:{minutes:number;period:'current'|'this_week'|'next_week';quote:string}}):BoundedReply|null{
 const contactQuestion=/(?:联系|请教|联络)/.test(input.text)&&/(?:怎么|如何|怎样)/.test(input.text)
 if(input.tier!=='default'||input.contract.capabilities.material||input.contract.capabilities.plan)return null
 const clauses=scanUserClauses(input.text)
 const own=clauses.filter(c=>!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther).map(c=>c.text).join('；')
 const make=(stage:BoundedReply['stage'],nextUnknown:string,choices:string[]):BoundedReply=>({basis:'editorial_adaptation',sourceStatus:input.knowledgeCount?'PUBLIC_METHOD_NOT_USED':'NO_PUBLIC_METHOD',stage,nextUnknown,choices})
 if(currentConversationOnly(input.text))return make('reported_result','本人愿意表达的内容；不推测感受或原因',[
  '我在听。你接着说，按你想说的节奏来。',
  '嗯，我在这儿听着。你想先说什么都可以。',
 ])
 if(/第[一二三四五六七八九十\d]+(?:道|个)?题(?:不会做|不会|不懂|没思路)/.test(own))return make('blocked','本人所报受阻题目的题干、实际做到的位置',[
  '先只看你说不会做的这一题。把题干、关键条件和已经做到的位置发来，我们从卡住处继续；原因与结果仍待核对，不重发整套入门方法。',
 ])
 if(input.verifiedBudget&&/(?:先|暂时)不(?:备考|复习)/.test(own)&&/处理第[一二三四五六七八九十\d]+(?:道|个)?题/.test(own))return make('blocked','当前题目的题干和实际受阻位置',[
  `按你刚说的${input.verifiedBudget.period==='next_week'?'下周':'本周'}${input.verifiedBudget.minutes}分钟上限，先暂停备考，只看当前这一题。先发来题干和已经做到的位置；能处理到哪一步取决于题目和实际尝试。`,
 ])
 const demanded=clauses.find(c=>!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther&&/需要每周/.test(c.text))
 const demandMinutes=demanded?hoursIn(demanded.text):null
 if(demandMinutes!==null&&input.verifiedBudget&&demandMinutes>input.verifiedBudget.minutes)return make('blocked','机会能否缩小或推迟，后续周时间是否不同',[
  `这个机会要求每周${demandMinutes}分钟，你报告的${input.verifiedBudget.period==='next_week'?'下周':'本周'}可用时间是${input.verifiedBudget.minutes}分钟，当前时段不足以按原范围投入。先核对能否缩小或推迟；已明确的优先事项继续保留，其他周的条件仍未知。`,
 ])
 if(/我.{0,20}优先/.test(own)&&!/(?:怎么|如何|怎样|比较|取舍)/.test(own))return make('reported_result','新的优先事项需要什么帮助',[
  '先按你刚说的优先事项来，其他方向不继续加任务。已报告的经历保留；接下来可以只处理当前优先的事情。',
 ])
 if(/(?:已经|已)(?:读了|读过|看过)|对方看过/.test(own)&&/(?:没(?:有)?|尚未|未)(?:回复|回应)|没回/.test(own))return make('waiting_result','尚未回应原因及实际效果仍未知',[
  '你已经报告对方读过、尚未回应，这两项分别保留。是否采用和实际效果以你报告为准；没有新结果时先不判有效或失败。',
 ])
 // A narrow certainty correction must not reclassify read/sent/payment or
 // restart an already stated request. State correction still uses the
 // existing correction/transaction machinery, independently of this reply.
 if(input.intent.reason==='control'&&/更正/.test(own)&&/是否(?:采用|使用|付款|有效).{0,6}(?:我)?(?:不知道|不清楚|未知)/.test(own))return make('reported_result','只有本人更正的结果项变为未知',[
  '按你的更正，这一项结果先保留未知，不据此判断有效或无效。其他已经报告的情况不因此改成未知，也不重新问原来的目标。',
  '这次只更正你指出的结果项。未知与否定分开，其他报告保留；后续帮助以更正后的信息为依据。',
 ])
 if(['listening_or_refusal','control','greeting','memory_query','reuse_material','professional_or_prediction_boundary'].includes(input.intent.reason))return null
 if(/我想把(?:验证问题|访谈问题|提问|这个问题).{0,20}(?:改成|换成)/.test(own))return make('start','新的问法会取得什么实际反馈',[
  '可以把这次问题改成你刚提出的问法，先核对一段最近的实际经历。这里只调整这一步，需求成立与否和访谈效果仍待核对；之后按实际回答再判断。',
  '沿用你刚提出的新问题，不重发整套访谈方法。下一轮分别保留原回答和实际行为，效果仍待核对。',
 ])
 const interviewReport=/(?:我.{0,12}(?:访谈|聊过|问过)|我已经访谈)/.test(own)&&/(?:感兴趣|使用|付费|采用)/.test(input.text)
 if(interviewReport)return make('reported_result','实际遇到的问题、已有行为与尚未发生的使用分别核对',[
  '先把访谈中的表达与实际行动分开。尚未使用或付款，不能据此判断需求成立，也不能判断需求不存在；这次有没有讲到最近实际遇到的问题？',
  '保留这次访谈报告，不把感兴趣当成使用、付款或有效。下一步先核对对方最近一次遇到的具体困难，是否继续由你决定。',
 ])
 const explorationQuestion=(/(?:校园产品|创业|校园项目)/.test(own)||/(?:了解|核对|访谈).{0,14}(?:实际|具体).{0,12}(?:问题|麻烦|困难)/.test(own))&&/(?:怎么|如何|怎样)/.test(own)&&/(?:发现|找到|找问题|问题|开始)/.test(own)
 if(explorationQuestion)return make('start','当前有没有一个本人观察到的具体问题',[
  '这是编辑小建议：先找一位愿意交流的同学，围绕你想了解的一件具体麻烦问「最近一次碰到这件事，你当时怎么处理的？」先保留原回答和实际做法，不把兴趣当采用、付款或效果；还没明确场景时，先用一件日常麻烦作为待核对问题。',
  '可以先写下一个待核对的问题，再请愿意交流的同学说最近一次具体经历和当时做法。只记实际回答，拒绝交流就停，尚无回答继续保留未知；这是编辑建议，尚未证明需求或产品效果。',
 ])
 if(/(?:自由职业|接单)/.test(own)&&/(?:需求|交付范围)/.test(own)&&/(?:怎么|如何|怎样)/.test(input.text))return make('start','本次服务、使用对象和交付边界',[
  '先写清一个拟交付的东西和谁会使用它，再把还需对方确认的范围留作问题。这里是编辑建议，尚未接单或交付；你想提供哪一种服务？',
  '先核对一个具体需求：对方要拿交付物做什么，哪些内容由你完成，哪些还没有约定。没有实际客户时先从拟提供的服务开始，不把探索算成接单。你想交付什么？',
 ])
 if(input.verifiedBudget&&(/(?:预算|平衡)/.test(own)||(/课程/.test(own)&&/(?:备考|复习)/.test(own)&&/(?:取舍|重新判断)/.test(own)))&&/(?:怎么|如何|怎样|重新判断)/.test(own)){
  const label=input.verifiedBudget.period==='next_week'?'下周':input.verifiedBudget.period==='this_week'?'本周':/每周/.test(input.verifiedBudget.quote)?'常规每周':'当前时段'
  return make('start','本次课程与其他目标各自最需要完成的一项',[
   `以你明确的${label}${input.verifiedBudget.minutes}分钟为上限，先列课程和其他目标各一项必须处理的事，再判断取舍，不要求用满。现在有没有已确定的课程任务或备考事项？`,
   `先分清${label}的${input.verifiedBudget.minutes}分钟和其他时段，再选当前最需要处理的一项。具体任务还待核对，不把时间分配当成执行；哪一项有明确要求？`,
  ])
 }
 if(input.knowledgeCount&&!contactQuestion)return null
 if(input.intent.reason==='adoption_not_method_request')return make('adopted','尚未报告实际执行或反馈',[
  '好，先沿用刚才选的那一步。愿意尝试和实际做过分开；做后告诉我发生了什么，我们再按反馈调整。',
  '好，先试刚才那一步，不重新发整套方法。还没做时不记为已执行；遇到具体阻碍再一起调整。',
 ])
 if(/(?:不再把|不再将).{0,20}主线/.test(own)&&/优先/.test(own))return make('reported_result','新阶段的具体帮助需求',[
  '按你这次明确的取舍调整当前主线，已经完成的实际经历继续保留。接下来的帮助以新优先事项为准，旧方向是否恢复由你决定。',
 ])
 if((/我.{0,8}(?:已经)?交付/.test(own)||reportedPerformedTaskClauses(input.text).length)&&/(?:采用|用了|付款|还没付|没有付款|未付款)/.test(input.text))return make('reported_result','实际效果与再次选择的条件',[
  '交付、采用和付款按你分别报告的情况保留，实际效果仍需另看反馈。想继续复盘这次结果，还是转到现在更优先的事情？',
  '先保留这次报告的结果，不据此推成稳定收入或长期适配。你现在想核对实际反馈，还是先处理另一件事？',
 ])
 const actionQuestion=/(?:怎么|如何|怎样|哪一步|下一步|要不要|还要[^，；]{0,12}吗|该不该|能不能|怎么办|调整)/
 const questions=clauses.filter(c=>(c.interrogative||actionQuestion.test(c.text))&&!c.quoted&&!c.code&&!c.attributedToOther)
 const request=questions.map(c=>c.text).join('；')
 const report=clauses.filter(c=>!questions.includes(c)&&!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther).map(c=>c.text).join('；')
 const materialUnavailable=/(?:材料|教材|课件|链接|资料|网页).{0,6}(?:打不开|无法打开)/.test(report)
 const continueBlocked=materialUnavailable&&/(?:先处理|先继续|继续(?:原来|这件|这个|刚才))/.test(report)
 if(!/(?:怎么|如何|怎样|哪一步|先做|下一步|要不要|还要|该不该|能不能|怎么办|调整)/.test(request)&&!continueBlocked&&!materialUnavailable&&!/(?:没回|未回应|没有回复|还没有回复|未回复|卡住|尚未开始|失败|受阻|没效果|还是不行|仍然不行)/.test(report))return null
 // A direction comparison needs actual analysis, not an action catalogue.
 if(input.intent.stage==='compare'||/取舍|比较|对比|更适合|选哪个/.test(request))return null
 const waiting=/(?:没(?:有)?|尚未|还未|未)(?:回复|回应|收到结果)|没回(?:；|$)|等待(?:回复|结果)|还没结果/.test(report)
 const blocked=materialUnavailable||/(?:没|没有|未)[^；]{0,12}(?:开始|做完|完成)|没(?:有)?效果|卡住|受阻|失败|还是不行|仍然不行/.test(report)
 if(waiting)return {basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'waiting_result',nextUnknown:'实际约定与截止；未回应原因保留未知',choices:[
  '先核对是否约定过回复时间，以及这件事有没有必须确认的截止时间。你们原先是怎么约定的？',
  '还没收到回复，原因和结果都先保留未知。有没有约定回复时间，或者这件事必须确认的截止时间？',
 ]}
 if(blocked&&!materialUnavailable&&/(?:第[一二三四五六七八九十\d]+(?:道|个)?题|做到|停在|卡在|遇到)/.test(own))return make('blocked','当前受阻题目与实际尝试',[
  '这次已经尝试过，先只看当前卡住的题目，不重发入门方法。你可以发来题目和做到的位置；不方便提供就先暂停。',
  '沿着这次实际尝试继续，先看卡住处的题目和已有步骤。原因和效果仍未知，暂时不换整套方法。',
 ])
 if(blocked&&materialUnavailable)return make('blocked','已知阻碍处的实际材料',[
  '先处理你刚说的阻碍，不重发入门方法。把打不开的材料信息或卡住的题目发来，我们从这里继续；不方便提供也可以先暂停。',
  '已经知道这次卡住的地方，先不重复问进度。可以一起查看该处的材料或题目；如果暂时无法查看，就保留原因未知，不说方法无效。',
 ])
 if(blocked||input.intent.stage==='adjust')return {basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'blocked',nextUnknown:'原尝试中实际受阻的一步',choices:[
  '先保留已经完成的部分，只处理剩下的一小部分。上次具体停在哪一步，这次还有什么必须完成的？',
  '先回看上次真正做过的那一步和实际反馈，不重新安排整套入门方法。是没开始、做到中途卡住，还是做完后结果不符合预期？',
  '可以先缩小这次要处理的范围，不补猜失败原因。已经有哪些可继续使用的内容，哪一步还缺材料？',
 ]}
 if(/访谈/.test(own)&&/上次|还是|继续|接下来/.test(own))return make('reported_result','这次原步骤中的实际回答与行为',[
  input.priorInterviewQuestion?`沿用你提出的问法「${input.priorInterviewQuestion}」，只继续这次访谈的一步，不重发入门方法。先看对方最近一次实际遇到的情况与当时做法；采用、付款和效果仍分别核对。你想先看哪段回答？`:'先接着这次访谈的原步骤与实际反馈，核对最近一次具体困难和对方当时怎样处理。采用、付款和效果分别保留；你想先看哪段回答？',
 ])
 if(/(?:联系|请教|学长|导师)/.test(own))return make('start','本次交流中希望对方确认的一项信息',[
  '先围绕你这次请教的目标，选一个最需要对方确认的问题。尚未联系时不记为发送。你想先写这句话，还是直接起草消息？',
  '先把这次交流要确认的一个问题写清楚，其他问题暂放。需要的话我们可以一起起草；发出以后再分别记录回应与结果。',
 ])
 return {basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'start',nextUnknown:'当前交付目标与已有材料',choices:[
  '先把这次要完成的核心内容写成一句话，再用已有材料补这句话。你现在已经有哪部分内容？',
  '先选这次最需要完成的一小部分，把已有材料放到一起。哪一部分已经有内容，哪一部分还缺？',
  '先选当前事情的一小步，沿用已经说清的目标。哪部分可以直接开始，哪部分还缺必要材料？',
 ]}
}

export function bindBoundedReplySchema(contract:TurnContract,bounded:BoundedReply|null):TurnContract{
 if(!bounded)return contract
 const schema=structuredClone(contract.schema) as {properties:Record<string,unknown>}
 schema.properties.reply={type:'string',enum:bounded.choices}
 // Retrieved material remains available as context, but this selected reply
 // makes only an editorial process request. Do not attach an unused claim.
 delete schema.properties.citations
 return {...contract,capabilities:{...contract.capabilities,citations:false},schema,schemaChars:JSON.stringify(schema).length}
}

export function boundedReplyAccepts(reply:string,bounded:BoundedReply|null){return !bounded||bounded.choices.includes(reply)}

export function boundedDraftAccepts(question:string,bounded:BoundedReply|null){
 return !bounded||bounded.choices.some(reply=>reply.endsWith(question))
}

export function boundedSentenceAccepts(sentence:string,bounded:BoundedReply){
 return bounded.choices.some(reply=>reply.startsWith(sentence)&&/^[。！!？?]/.test(reply.slice(sentence.length)))
}
