import {scanUserClauses} from './user-command-spans.ts'
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
export function boundedOrdinaryReply(input:{text:string;intent:KnowledgeIntent;contract:TurnContract;knowledgeCount:number;tier:string}):BoundedReply|null{
 const contactQuestion=/(?:联系|请教|联络)/.test(input.text)&&/(?:怎么|如何|怎样)/.test(input.text)
 if(input.tier!=='default'||(input.knowledgeCount&&!contactQuestion)||input.contract.capabilities.material||input.contract.capabilities.plan)return null
 if(['listening_or_refusal','control','greeting','memory_query','reuse_material','professional_or_prediction_boundary'].includes(input.intent.reason))return null
 const clauses=scanUserClauses(input.text)
 const own=clauses.filter(c=>!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther).map(c=>c.text).join('；')
 const make=(stage:BoundedReply['stage'],nextUnknown:string,choices:string[]):BoundedReply=>({basis:'editorial_adaptation',sourceStatus:input.knowledgeCount?'PUBLIC_METHOD_NOT_USED':'NO_PUBLIC_METHOD',stage,nextUnknown,choices})
 if(input.intent.reason==='adoption_not_method_request')return make('adopted','尚未报告实际执行或反馈',[
  '好，先沿用刚才选的那一步。愿意尝试和实际做过分开；做后告诉我发生了什么，我们再按反馈调整。',
  '好，先试刚才那一步，不重新发整套方法。还没做时不记为已执行；遇到具体阻碍再一起调整。',
 ])
 if(/我.{0,8}(?:已经)?交付/.test(own)&&/(?:采用|付款)/.test(own))return make('reported_result','实际效果与再次选择的条件',[
  '交付、采用和付款按你分别报告的情况保留，实际效果仍需另看反馈。想继续复盘这次结果，还是转到现在更优先的事情？',
  '先保留这次报告的结果，不据此推成稳定收入或长期适配。你现在想核对实际反馈，还是先处理另一件事？',
 ])
 const actionQuestion=/(?:怎么|如何|怎样|哪一步|下一步|要不要|还要[^，；]{0,12}吗|该不该|能不能|怎么办|调整)/
 const questions=clauses.filter(c=>(c.interrogative||actionQuestion.test(c.text))&&!c.quoted&&!c.code&&!c.attributedToOther)
 const request=questions.map(c=>c.text).join('；')
 const report=clauses.filter(c=>!questions.includes(c)&&!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther).map(c=>c.text).join('；')
 const materialUnavailable=/(?:材料|教材|课件|链接|资料|网页).{0,6}(?:打不开|无法打开)/.test(report)
 const continueBlocked=materialUnavailable&&/(?:先处理|先继续|继续(?:原来|这件|这个|刚才))/.test(report)
 if(!/(?:怎么|如何|怎样|哪一步|先做|下一步|要不要|还要|该不该|能不能|怎么办|调整)/.test(request)&&input.intent.decision!=='CLARIFY'&&input.intent.stage!=='adjust'&&!continueBlocked)return null
 // A direction comparison needs actual analysis, not an action catalogue.
 if(input.intent.stage==='compare'||/取舍|比较|对比|更适合|选哪个/.test(request))return null
 const waiting=/(?:没(?:有)?|尚未|还未|未)(?:回复|回应|收到结果)|没回(?:；|$)|等待(?:回复|结果)|还没结果/.test(report)
 const blocked=materialUnavailable||/(?:没|没有|未)[^；]{0,12}(?:开始|做完|完成)|没(?:有)?效果|卡住|受阻|失败|还是不行|仍然不行/.test(report)
 if(waiting)return {basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'waiting_result',nextUnknown:'实际约定与截止；未回应原因保留未知',choices:[
  '先核对是否约定过回复时间，以及这件事有没有必须确认的截止时间。你们原先是怎么约定的？',
  '还没收到回复，原因和结果都先保留未知。有没有约定回复时间，或者这件事必须确认的截止时间？',
 ]}
 if(blocked&&(materialUnavailable||/(?:第[一二三四五六七八九十\d]+(?:道|个)?题|做到|停在|卡在|遇到)/.test(own)))return make('blocked','已知阻碍处的实际材料',[
  '先处理你刚说的阻碍，不重发入门方法。把打不开的材料信息或卡住的题目发来，我们从这里继续；不方便提供也可以先暂停。',
  '已经知道这次卡住的地方，先不重复问进度。可以一起查看该处的材料或题目；如果暂时无法查看，就保留原因未知，不说方法无效。',
 ])
 if(blocked||input.intent.stage==='adjust')return {basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'blocked',nextUnknown:'原尝试中实际受阻的一步',choices:[
  '先保留已经完成的部分，只处理剩下的一小部分。上次具体停在哪一步，这次还有什么必须完成的？',
  '先回看上次真正做过的那一步和实际反馈，不重新安排整套入门方法。是没开始、做到中途卡住，还是做完后结果不符合预期？',
  '可以先缩小这次要处理的范围，不补猜失败原因。已经有哪些可继续使用的内容，哪一步还缺材料？',
 ]}
 if(/(?:联系|请教|学长|导师|访谈)/.test(own))return make('start','本次交流中希望对方确认的一项信息',[
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
