import {scanUserClauses} from './user-command-spans.ts'
import type {KnowledgeIntent} from './evergreen-guide.ts'
import type {TurnContract} from './turn-contract.ts'

export type BoundedReply={basis:'editorial_adaptation';sourceStatus:'NO_PUBLIC_METHOD';stage:'start'|'blocked'|'waiting_result';choices:string[];nextUnknown:string}

// An ordinary action question with no authorized public method may select a
// small editorial action or a process question. The model cannot add a cause,
// effect claim, deadline, number or personal fact to the selected reply.
// Material delivery, scheduling, listening and personal decisions keep their
// existing contracts. This is not a second guide corpus.
export function boundedOrdinaryReply(input:{text:string;intent:KnowledgeIntent;contract:TurnContract;knowledgeCount:number;tier:string}):BoundedReply|null{
 if(input.tier!=='default'||input.knowledgeCount||input.contract.capabilities.material||input.contract.capabilities.plan)return null
 if(['listening_or_refusal','control','greeting','memory_query','reuse_material','professional_or_prediction_boundary','adoption_not_method_request'].includes(input.intent.reason))return null
 const clauses=scanUserClauses(input.text)
 const actionQuestion=/(?:怎么|如何|怎样|哪一步|下一步|要不要|还要[^，；]{0,12}吗|该不该|能不能|怎么办|调整)/
 const questions=clauses.filter(c=>(c.interrogative||actionQuestion.test(c.text))&&!c.quoted&&!c.code&&!c.attributedToOther)
 const request=questions.map(c=>c.text).join('；')
 if(!/(?:怎么|如何|怎样|哪一步|先做|下一步|要不要|还要|该不该|能不能|怎么办|调整)/.test(request)&&input.intent.decision!=='CLARIFY'&&input.intent.stage!=='adjust')return null
 // A direction comparison needs actual analysis, not an action catalogue.
 if(input.intent.stage==='compare'||/取舍|比较|对比|更适合|选哪个/.test(request))return null
 const report=clauses.filter(c=>!questions.includes(c)&&!c.conditional&&!c.quoted&&!c.code&&!c.attributedToOther).map(c=>c.text).join('；')
 const waiting=/没(?:有)?(?:回复|回应|收到结果)|没回(?:；|$)|等待(?:回复|结果)|还没结果/.test(report)
 const blocked=/(?:没|没有|未)[^；]{0,12}(?:做完|完成)|没(?:有)?效果|卡住|受阻|失败|还是不行|仍然不行/.test(report)
 if(waiting)return {basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'waiting_result',nextUnknown:'实际约定、截止与原请求',choices:[
  '先核对是否约定过回复时间，以及这件事有没有必须确认的截止时间。你们原先是怎么约定的？',
  '还没收到回复，原因和结果都先保留未知。原消息想让对方确认哪一件事，有没有明确截止时间？',
  '先回看原消息是否把要确认的事情说清楚；缺少约定时，暂时不能判断今天是否需要再联系。原消息具体问了什么？',
 ]}
 if(blocked||input.intent.stage==='adjust')return {basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'blocked',nextUnknown:'原尝试中实际受阻的一步',choices:[
  '先保留已经完成的部分，只处理剩下的一小部分。上次具体停在哪一步，这次还有什么必须完成的？',
  '先回看上次真正做过的那一步和实际反馈，不重新安排整套入门方法。是没开始、做到中途卡住，还是做完后结果不符合预期？',
  '可以先缩小这次要处理的范围，不补猜失败原因。已经有哪些可继续使用的内容，哪一步还缺材料？',
 ]}
 return {basis:'editorial_adaptation',sourceStatus:'NO_PUBLIC_METHOD',stage:'start',nextUnknown:'当前交付目标与已有材料',choices:[
  '先把这次要完成的核心内容写成一句话，再用已有材料补这句话。你现在已经有哪部分内容？',
  '先选这次最需要完成的一小部分，把已有材料放到一起。哪一部分已经有内容，哪一部分还缺？',
  '先核对这次要交付什么；如果目标已经清楚，就直接从现有材料开始。你现在准备完成哪一部分？',
 ]}
}

export function bindBoundedReplySchema(contract:TurnContract,bounded:BoundedReply|null):TurnContract{
 if(!bounded)return contract
 const schema=structuredClone(contract.schema) as {properties:Record<string,unknown>}
 schema.properties.reply={type:'string',enum:bounded.choices}
 return {...contract,schema,schemaChars:JSON.stringify(schema).length}
}

export function boundedReplyAccepts(reply:string,bounded:BoundedReply|null){return !bounded||bounded.choices.includes(reply)}

export function boundedDraftAccepts(question:string,bounded:BoundedReply|null){
 return !bounded||bounded.choices.some(reply=>reply.endsWith(question))
}
