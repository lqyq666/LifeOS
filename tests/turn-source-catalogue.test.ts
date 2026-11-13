import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {buildClauseCatalogue,resolveContiguousClauseRange,reportedContribution,processFactInputIndices,sourceQuotesOverlap,sourceQuoteRanges,sourceControlRanges} from '../server/clause-catalogue.ts'
import {requiresExperienceCandidate,resolveCandidateContent} from '../server/experience-content.ts'
import {deriveStructuralLinks} from '../server/experience-content.ts'
import {parseActionCoachTurn} from '../server/action-coach-contracts.ts'
import {deriveTurnContract} from '../server/turn-contract.ts'
import {turnSystemPrompt} from '../server/turn-prompt.ts'
import {extractSkillTags} from '../server/starmap-enrichment.ts'
import {resolveGrowthDeltas} from '../server/growth-authority.ts'

test('a contextual action stays unconfirmed instead of failing a valid feedback or claiming skills',()=>{
 const parse=(text:string,action:string)=>{
  const catalogue=buildClauseCatalogue(text),source=catalogue.find(clause=>clause.text.includes(action))
  assert.ok(source)
  return parseActionCoachTurn(JSON.stringify({reply:'保留报告，执行者尚未核验，不推断能力或结果。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:source.clauseId},contribution:{actor:'self',actionQuote:action,skillTags:['数据分析']}}]}),{sourceCatalogue:{messageId:randomUUID(),catalogue,text}})
 }
 const action='只把已保存资料的三列标题核对完了'
 const contextual=parse('实际反馈：我只做了四分钟，'+action+'，没有分析。',action)
 const proposed=reportedContribution(contextual.growthUpdates![0]!)!
 assert.equal(proposed.actor,'unknown')
 assert.equal(proposed.actionQuote,'')
 assert.equal(proposed.pendingActionQuote,action)
 assert.deepEqual(proposed.skillTags,[])
 assert.equal(proposed.result,undefined)
 for(const delegated of ['把第二份问卷交给同学分析了','把第二份问卷供张三分析了','把第二份问卷喊张三分析完了','把第二份问卷经张三分析完成']){
  const tentative=reportedContribution(parse('实际反馈：我分析了第一份数据，'+delegated+'。',delegated).growthUpdates![0]!)!
  assert.equal(tentative.actor,'unknown',delegated)
  assert.equal(tentative.actionQuote,'',delegated)
  assert.deepEqual(tentative.skillTags,[],delegated)
 }
 for(const text of ['实际反馈:我只做了四分钟，'+action+'。','实际反馈：室友只做了四分钟，'+action+'。','实际反馈：如果我只做了四分钟，'+action+'。','老师说“实际反馈：我只做了四分钟，'+action+'”。','实际反馈：我打算明天，'+action+'。','实际反馈：我还没有执行，'+action+'。','实际反馈：我写完了资料，我打算明天，'+action+'。'])assert.throws(()=>parse(text,action),/CONTRIBUTION_.*INVALID/,text)
 for(const own of ['我把申请表核对完了','我把转让协议整理完了','我把委托书归档了','我把同学的报告整理完了','我把问卷里的问题请教了老师'])assert.equal(reportedContribution(parse(own+'。',own).growthUpdates![0]!)?.actor,'self',own)
})

test('a tentative canonical contribution wins its clause in either order and cannot support an observation',()=>{
 const action='只把已保存资料的三列标题核对完了',text='实际反馈：我只做了四分钟，'+action+'，没有分析。',catalogue=buildClauseCatalogue(text),messageId=randomUUID(),actionClause=catalogue.find(clause=>clause.text.includes(action))!
 const ordinary={target:{operation:'create' as const},assertion:'user_reported' as const,kind:'context' as const,source:{clauseId:actionClause.clauseId}}
 const contribution={target:{operation:'create' as const},assertion:'user_reported' as const,kind:'feedback' as const,progressState:'completed' as const,source:{clauseId:actionClause.clauseId},contribution:{actor:'self',actionQuote:action}}
 for(const growthUpdates of [[ordinary,contribution],[contribution,ordinary]]){
  const parsed=parseActionCoachTurn(JSON.stringify({reply:'保留原文，行动归属仍待核验。',growthUpdates}),{sourceCatalogue:{messageId,catalogue,text}})
  const resolved=resolveGrowthDeltas({deltas:parsed.growthUpdates!,currentMessageId:messageId,currentText:text,catalogue,authorized:[],correctionPlan:null,controlClauseTexts:[]})
  assert.equal(resolved.deltas.length,1)
  assert.equal(reportedContribution(resolved.deltas[0]!)?.actor,'unknown','ordinary same-clause output cannot win by model order')
 }
 const knownId=randomUUID(),observationFirst=parseActionCoachTurn(JSON.stringify({reply:'保留待核验报告，不让观察抢占其来源。',growthUpdates:[
  {target:{operation:'create'},assertion:'ai_observation',kind:'observation',text:'用户可能不擅长分析',source:{clauseId:actionClause.clauseId},dependencies:[{id:knownId,revision:1}],limitation:'只有既有一般事实'},
  contribution,
 ]}),{sourceCatalogue:{messageId,catalogue,text}})
 const observationFirstResolved=resolveGrowthDeltas({deltas:observationFirst.growthUpdates!,currentMessageId:messageId,currentText:text,catalogue,authorized:[{id:knownId,revision:1,kind:'context',assertion:'user_reported',text:'既有一般事实',unavailableReason:null,status:'active'}],correctionPlan:null,controlClauseTexts:[]})
 assert.equal(observationFirstResolved.deltas.length,1)
 assert.equal(reportedContribution(observationFirstResolved.deltas[0]!)?.actor,'unknown','an observation cannot reserve a canonical contribution clause by appearing first')
 const withEvidence=text+'我还不知道后续效果。',evidenceCatalogue=buildClauseCatalogue(withEvidence),evidenceMessageId=randomUUID(),evidenceAction=evidenceCatalogue.find(clause=>clause.text.includes(action))!,evidenceResult=evidenceCatalogue.find(clause=>clause.text.includes('后续效果'))!
 const parsed=parseActionCoachTurn(JSON.stringify({reply:'只保留待核验报告，不据此推断本人特征。',growthUpdates:[
  {...contribution,source:{clauseId:evidenceAction.clauseId}},
  {target:{operation:'create'},assertion:'ai_observation',kind:'observation',text:'用户可能不擅长分析',source:{clauseId:evidenceResult.clauseId},dependencies:[{updateIndex:0}],limitation:'行动执行者尚未核验'},
 ]}),{sourceCatalogue:{messageId:evidenceMessageId,catalogue:evidenceCatalogue,text:withEvidence}})
 const resolved=resolveGrowthDeltas({deltas:parsed.growthUpdates!,currentMessageId:evidenceMessageId,currentText:withEvidence,catalogue:evidenceCatalogue,authorized:[],correctionPlan:null,controlClauseTexts:[]})
 assert.equal(resolved.deltas.some(delta=>delta.assertion==='ai_observation'),false,'unknown-owner evidence cannot derive an ordinary observation')
})

test('source identity distinguishes a whole clause from its incidental prefix in a later clause',()=>{
 const action='我分析了问卷数据',result=action+'后确认结果无效',text=action+'，'+result+'。'
 assert.deepEqual(sourceQuoteRanges(text,action),[{start:0,end:action.length}])
 assert.equal(sourceQuotesOverlap(text,action,result),false)
 assert.equal(sourceQuotesOverlap(text,result,'确认结果无效'),true)
 assert.equal(sourceQuotesOverlap(text,action+'，'+result,result),true)
 const joint='王小明和我一起分析了问卷数据',fragment='分析了问卷数据',repeated=joint+'，'+fragment+'。'
 const range={start:joint.indexOf(fragment),end:joint.length}
 assert.deepEqual(sourceQuoteRanges(repeated,fragment,joint),[range],'scope is applied before whole-clause preference')
 assert.equal(sourceQuotesOverlap(joint+'，'+fragment+'后确认结果无效',fragment+'后确认结果无效',{quote:fragment,range}),false)
 const duplicate='结果未知。结果未知。'
 for(const invalid of [{start:99,end:103},{start:1,end:5},{start:0,end:99},{start:-1,end:3}]){
  const ref={quote:'结果未知',range:invalid}
  assert.deepEqual(sourceControlRanges(duplicate,ref),[],'invalid explicit bounds cannot broaden to every literal match')
  assert.equal(sourceQuotesOverlap(duplicate,'结果未知',ref),false)
  assert.deepEqual(sourceQuoteRanges(duplicate,'结果未知',ref),[])
 }
 assert.deepEqual(sourceControlRanges(duplicate,{quote:'结果未知',range:{start:5,end:9}}),[{start:5,end:9}])
 assert.equal(sourceControlRanges(duplicate,'结果未知').length,2,'legacy unbound controls retain literal lookup')
})

test('native contribution selects accepted fact references and never copies an intervening instruction',()=>{
 const messageId=randomUUID(),text='我分析了问卷数据。请只讨论，不新增建议。还不知道效果。',catalogue=buildClauseCatalogue(text)
 const turn=(contribution:unknown)=>({reply:'已做分析，效果未知。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution},{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c3'}}]})
 const resultIndex=catalogue.findIndex(clause=>clause.text==='还不知道效果')
 const valid=turn({actor:'self',actionQuote:'我分析了问卷数据',resultRef:1})
 valid.growthUpdates[1]!.source.clauseId='c'+resultIndex
 const parsed=parseActionCoachTurn(JSON.stringify(valid),{sourceCatalogue:{messageId,catalogue,text}})
 assert.equal(reportedContribution(parsed.growthUpdates![0]!)?.result?.quote,'还不知道效果')
 assert.equal(reportedContribution(parsed.growthUpdates![0]!)?.sourceQuote,'我分析了问卷数据')
 assert.ok(!Object.hasOwn(parsed.growthUpdates![0]!,'contribution'),'private metadata never leaks into public or saved formats')
 const duplicate={reply:'只引用第二个输入。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c0'}},{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'}}],event:{target:{operation:'create',title:'分析',source:{clauseId:'c0'}},factRefs:[1]}}
 const selected=parseActionCoachTurn(JSON.stringify(duplicate),{sourceCatalogue:{messageId,catalogue,text}})
 assert.deepEqual(processFactInputIndices(selected.event!.nodes![0]!),[1],'same-clause siblings cannot lend input authority')
 for(const contribution of [{actor:'self',actionQuote:''},{actor:'joint',actionQuote:''},{actor:'self',actionQuote:'我打印了材料'},{actor:'self',actionQuote:'我分析了问卷数据',resultRef:0},{actor:'self',actionQuote:'我分析了问卷数据',resultRef:7},{actor:'self',actionQuote:'我分析了问卷数据',resultClauseId:'c1'},{actor:'other',actionQuote:'我分析了问卷数据'},{actor:'unknown',actionQuote:'我分析了问卷数据'}]){
  assert.throws(()=>parseActionCoachTurn(JSON.stringify(turn(contribution)),{sourceCatalogue:{messageId,catalogue,text}}))
 }
 const hypothetical='如果我分析了问卷数据',conditional=buildClauseCatalogue(hypothetical)
 assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:'仅是假设。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:'我分析了问卷数据'}}]}),{sourceCatalogue:{messageId,catalogue:conditional,text:hypothetical}}))
})

test('an optional negated or ambiguous action cannot become a performed contribution',()=>{
 for(const [text,actionQuote] of [['我没有分析过问卷数据','分析过问卷数据'],['我没有校准过标尺','校准过标尺'],['我没有校准过标尺','我没有校准过标尺'],['我们没有校准过标尺','我们没有校准过标尺'],['我先分析了问卷数据再分析了问卷数据','分析了问卷数据']]){
  const parsed=parseActionCoachTurn(JSON.stringify({reply:'保留本人原话，执行证据仍需核实。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote,skillTags:['数据分析']}}]}),{sourceCatalogue:{messageId:randomUUID(),catalogue:buildClauseCatalogue(text!),text}})
  const fact=parsed.growthUpdates![0]!,contribution=reportedContribution(fact)!
  assert.equal(contribution.actionQuote,'',text)
  assert.deepEqual(contribution.skillTags,[])
  assert.equal(fact.progressState,'unknown')
 }
 const text='我校准了标尺',parsed=parseActionCoachTurn(JSON.stringify({reply:'记录本人实际校准，结果未知。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:text}}]}),{sourceCatalogue:{messageId:randomUUID(),catalogue:buildClauseCatalogue(text),text}})
 assert.equal(reportedContribution(parsed.growthUpdates![0]!)?.actionQuote,text,'positive novel verbs do not need a legacy completion word-list entry')
})

test('native semantic tags do not infer competence from quoted objects and allow an actual action containing a quote',()=>{
 const messageId=randomUUID(),text='我整理了“分析过数据”的笔记',catalogue=buildClauseCatalogue(text)
 const turn=(actionQuote:string,skillTags:string[]=[])=>({reply:'只记录了整理笔记，其他能力未知。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote,skillTags}}]})
 const parsed=parseActionCoachTurn(JSON.stringify(turn(text)),{sourceCatalogue:{messageId,catalogue,text}})
 assert.deepEqual(reportedContribution(parsed.growthUpdates![0]!)?.skillTags,[])
 assert.equal(reportedContribution(parsed.growthUpdates![0]!)?.actionQuote,text)
 assert.throws(()=>parseActionCoachTurn(JSON.stringify(turn('分析过数据')),{sourceCatalogue:{messageId,catalogue,text}}),'a quote-only fragment cannot certify an actual action')
 const unsupported=parseActionCoachTurn(JSON.stringify(turn(text,['高级分析师'])),{sourceCatalogue:{messageId,catalogue,text}})
 assert.deepEqual(reportedContribution(unsupported.growthUpdates![0]!)?.skillTags,[],'unknown optional labels stay unknown while the valid reply and source fact survive')
})

test('known other actors cannot become my contribution or my independently owned outcome',()=>{
 const messageId=randomUUID(),other='室友分析了问卷数据。室友因此拿了奖。',catalogue=buildClauseCatalogue(other)
 assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:'原话归属仍需正确保留。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:'分析了问卷数据',resultRef:1}},{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}}]}),{sourceCatalogue:{messageId,catalogue,text:other}}))
 const text='我整理了三列数据。室友因此拿了奖。',parsed=parseActionCoachTurn(JSON.stringify({reply:'只记录本人实际整理的部分。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:'我整理了三列数据',resultRef:1}},{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c1'}}]}),{sourceCatalogue:{messageId,catalogue:buildClauseCatalogue(text),text}})
 assert.equal(reportedContribution(parsed.growthUpdates![0]!)?.result,undefined,'a rejected quote cannot retain any dangling semantic result index')
 assert.equal(parsed.growthUpdates!.length,2,'the other report remains an independent canonical fact')
 for(const name of ['王小明','客户','组员','对方']){
  const text=name+'分析了问卷数据。'
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:'归属保持未知。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:'分析了问卷数据'}}]}),{sourceCatalogue:{messageId,catalogue:buildClauseCatalogue(text),text}}))
 }
 for(const text of ['我们让同学分析了问卷数据。','我们把问卷交给同学分析了。'])assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:'只有委托，执行归属不能写成本人。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:text.slice(0,-1)}}]}),{sourceCatalogue:{messageId,catalogue:buildClauseCatalogue(text),text}}))
 const own='我看到同学提交后自己分析了问卷数据。'
 const observed=parseActionCoachTurn(JSON.stringify({reply:'只保留本人随后实际分析的动作。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor:'self',actionQuote:'自己分析了问卷数据'}}]}),{sourceCatalogue:{messageId,catalogue:buildClauseCatalogue(own),text:own}})
 assert.equal(reportedContribution(observed.growthUpdates![0]!)?.actionQuote,'自己分析了问卷数据')
 for(const [text,actor,expected] of [['我和王小明一起分析了问卷数据','self','joint'],['我分析了问卷数据','joint','self']]){
  const projected=parseActionCoachTurn(JSON.stringify({reply:'只保留有来源的本人参与范围。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'},contribution:{actor,actionQuote:text}}]}),{sourceCatalogue:{messageId,catalogue:buildClauseCatalogue(text!),text}})
  assert.equal(reportedContribution(projected.growthUpdates![0]!)?.actor,expected,'a conservative ownership projection does not reject the valid full reply')
 }
})

test('performer attribution and reported progress are independent when no personal action is claimed',()=>{
 const prompt=turnSystemPrompt('default','qwen3.8-flash',deriveTurnContract({text:'我接受这个步骤但还没有执行。',knowledgeCount:0,currentEventExists:true,planIntent:false,material:false}),false)
 assert.ok(prompt.includes('actor独立表示执行者'),'the actual supplier prompt permits the same orthogonal state as its schema')
 assert.ok(!prompt.includes('只反映本人报告的动作状态'),'a contradictory legacy ownership restriction must not survive in the runtime prompt')
 for(const [text,actor,progressState] of [['我接受这个步骤但还没有执行','unknown','unattempted'],['室友完成了问卷分析','other','completed']]){
  const parsed=parseActionCoachTurn(JSON.stringify({reply:'保留已知进度，不补造本人行动。',growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState,source:{clauseId:'c0'},contribution:{actor,actionQuote:''}}]}),{sourceCatalogue:{messageId:randomUUID(),catalogue:buildClauseCatalogue(text!),text}})
  assert.equal(parsed.growthUpdates![0]!.progressState,progressState)
  assert.equal(reportedContribution(parsed.growthUpdates![0]!)?.actor,actor)
  assert.equal(reportedContribution(parsed.growthUpdates![0]!)?.actionQuote,'')
 }
})

test('process facts select the same server-owned clause catalogue as personal memory',()=>{
 const messageId=randomUUID(),text='我把表格发给同学了，但他打不开，还没有评价。'
 const catalogue=buildClauseCatalogue(text)
 const turn={reply:'已经发出，对方还没有看到内容，评价和使用效果仍未知。',event:{target:{operation:'create',title:'表格交付',source:{clauseId:'c0'}},nodes:[{kind:'fact',source:{clauseId:'c0'}},{kind:'fact',source:{clauseId:'c1'}}]},growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'}}]}
 const parsed=parseActionCoachTurn(JSON.stringify(turn),{sourceCatalogue:{messageId,catalogue}})
 assert.deepEqual(parsed.event?.nodes?.[0],{kind:'fact',source:{messageId,quote:catalogue[0]!.text}})
 assert.equal(parsed.event?.nodes?.[1]?.kind,'fact')
 assert.equal(parsed.growthUpdates?.[0]?.source.clauseId,'c0')
 const legacy={...turn,event:{...turn.event,target:{operation:'create',title:'表格交付',source:{messageId,quote:catalogue[0]!.text}},nodes:[{kind:'fact',source:{messageId,quote:catalogue[0]!.text}}]}}
 assert.equal(parseActionCoachTurn(JSON.stringify(legacy),{sourceCatalogue:{messageId,catalogue}}).reply,turn.reply)
 for(const source of [{clauseId:'c99'},{clauseId:'c0',quote:'我没有发送'},{clauseId:'c0',messageId:randomUUID()}]){
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({...turn,event:{...turn.event,target:{...turn.event.target,source}}}),{sourceCatalogue:{messageId,catalogue}}))
 }
 assert.throws(()=>parseActionCoachTurn(JSON.stringify(turn)))
 for(const source of [{messageId:randomUUID(),quote:catalogue[0]!.text},{messageId,quote:'我拿到了并不存在的录用通知'}]){
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({...turn,event:{...turn.event,target:{...turn.event.target,source}}}),{sourceCatalogue:{messageId,catalogue}}))
 }
 let rejected=false
 assert.throws(()=>parseActionCoachTurn(JSON.stringify({...turn,event:{...turn.event,target:{...turn.event.target,source:{clauseId:'c999'}}}}),{sourceCatalogue:{messageId,catalogue},onRejection(){rejected=true}}))
 assert.equal(rejected,true)
 assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:'确认。',event:{target:{operation:'create',title:'交付',source:{messageId,quote:'按时交付'}},nodes:[{kind:'fact',source:{messageId,quote:'按时交付'}}]}}),{sourceCatalogue:{messageId,catalogue:buildClauseCatalogue('我没有按时交付。'),text:'我没有按时交付。'}}))
})

test('ordinary process schema references clauses instead of generating duplicate quotes',()=>{
 const contract=deriveTurnContract({text:'我把表格发给同学了。',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
 const event=(contract.schema as any).properties.event
 assert.deepEqual(Object.keys(event.properties.target.anyOf[0].properties.source.properties),['clauseId'])
 const reported=event.properties.nodes.items.anyOf.find((entry:any)=>entry.properties.source)
 assert.deepEqual(Object.keys(reported.properties.source.properties),['clauseId'])
 assert.ok(event.properties.factRefs)
 assert.ok(!reported.properties.kind.anyOf.some((kind:any)=>kind.const==='fact'))
})

test('process projections reference one canonical personal fact interpretation',()=>{
 const messageId=randomUUID(),text='我把表格发给同学了。',catalogue=buildClauseCatalogue(text)
 const turn={reply:'本人已发出，使用结果尚未知。',event:{target:{operation:'create',title:'表格交付',source:{clauseId:'c0'}},factRefs:[0]},growthUpdates:[{target:{operation:'create'},assertion:'user_reported',kind:'feedback',progressState:'completed',source:{clauseId:'c0'}}]}
 const parsed=parseActionCoachTurn(JSON.stringify(turn),{sourceCatalogue:{messageId,catalogue,text}})
 assert.deepEqual(parsed.event?.nodes,[{kind:'fact',source:{messageId,quote:catalogue[0]!.text}}])
 assert.ok(!Object.hasOwn(parsed.event!,'factRefs'),'public and stored event format remains compatible')
 const normalized:string[]=[]
 const stale=parseActionCoachTurn(JSON.stringify({...turn,event:{...turn.event,factRefs:[1]}}),{sourceCatalogue:{messageId,catalogue,text},onNormalization:kind=>normalized.push(kind)})
 assert.deepEqual(stale.event?.nodes,[],'a stale optional projection cannot create an event fact')
 assert.deepEqual(normalized,['invalid_event_fact_refs_dropped'])
 for(const factRefs of [[-1],[0,0],['0'],[0.5]])assert.throws(()=>parseActionCoachTurn(JSON.stringify({...turn,event:{...turn.event,factRefs}}),{sourceCatalogue:{messageId,catalogue,text}}))
 assert.throws(()=>parseActionCoachTurn(JSON.stringify({...turn,growthUpdates:[{...turn.growthUpdates[0],assertion:'unknown',kind:'unknown',text:'是否发送'}]}),{sourceCatalogue:{messageId,catalogue,text}}))
 const legacy=parseActionCoachTurn(JSON.stringify({reply:turn.reply,event:{target:turn.event.target,nodes:[{kind:'fact',source:{clauseId:'c0'}}]}}),{sourceCatalogue:{messageId,catalogue,text}})
 assert.equal(legacy.growthUpdates?.[0]?.assertion,'user_reported')
 assert.equal(legacy.growthUpdates?.[0]?.kind,'context','legacy facts preserve raw context without inventing ability or feedback states')
 const temporary=parseActionCoachTurn(JSON.stringify({reply:turn.reply,event:{target:turn.event.target,nodes:[{kind:'fact',source:{clauseId:'c0'}}]}}),{sourceCatalogue:{messageId,catalogue,text,canonicalFacts:false}})
 assert.equal(temporary.growthUpdates,undefined,'an event-only contract never manufactures a personal-memory write')
 assert.throws(()=>parseActionCoachTurn(JSON.stringify({...turn,event:{...turn.event,nodes:[{kind:'fact',source:{clauseId:'c0'}}]}}),{sourceCatalogue:{messageId,catalogue,text}}),'mixed native/legacy fact representations have ambiguous input authority')
})

test('star-map skill tags use the same owned performed contribution as experiences',()=>{
 assert.deepEqual(extractSkillTags('','','室友整理了设计稿，我打印了材料。'),[])
 assert.deepEqual(extractSkillTags('','','我整理了问卷数据的三列，但没有做分析。'),[])
 assert.ok(extractSkillTags('','','我分析了问卷数据。').includes('数据分析'))
 assert.ok(extractSkillTags('','','昨天我核对了样本，随后分析了数据。').includes('数据分析'))
 assert.deepEqual(extractSkillTags('','','我请同学分析了问卷数据。'),[])
 assert.deepEqual(extractSkillTags('','','我想分析数据。'),[])
 for(const source of ['同学和我一起分析了问卷数据。','我的室友和我一起分析了问卷数据。','我看到同学提交后自己分析了问卷数据。','我看到同学提交后我分析了问卷数据。'])assert.ok(extractSkillTags('','',source).includes('数据分析'),source)
 for(const source of ['我的室友分析了问卷数据。','我朋友分析了问卷数据。','同学分析了问卷数据。'])assert.deepEqual(extractSkillTags('','',source),[],source)
 for(const source of ['我没有分析过问卷数据。','我没有统计过样本。','我没有可视化过数据。','昨天我朋友分析了问卷数据。','上周我的室友整理了设计稿。']){
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(source)),false,source)
  assert.deepEqual(extractSkillTags('','',source),[],source)
 }
 assert.ok(extractSkillTags('','','我辅导过同学。').includes('教学'))
 assert.ok(extractSkillTags('','','我翻译过一篇文章。').includes('外语'))
 for(const actor of ['客户','组员','对方','工具','王小明'])assert.deepEqual(extractSkillTags('','',`我打印了材料，${actor}分析了问卷数据。`),[],actor)
 for(const actor of ['同事','客户','组员','王小明']){
  assert.deepEqual(extractSkillTags('','',`我请${actor}分析了问卷数据。`),[],actor)
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(`我${actor}分析了问卷数据。`)),false,actor)
 }
 assert.ok(extractSkillTags('','','我没有完成排版，但分析了问卷数据。').includes('数据分析'))
 assert.deepEqual(extractSkillTags('','','我整理了写着“分析了问卷数据”的笔记。'),[])
 assert.deepEqual(extractSkillTags('','','我整理了写着`分析了问卷数据`的笔记。'),[])
 assert.ok(extractSkillTags('','','我亲自分析了问卷数据。').includes('数据分析'))
 assert.ok(extractSkillTags('','','我参与分析了问卷数据。').includes('数据分析'))
 for(const source of ['我先让同学分析了问卷数据。','我负责让室友分析了问卷数据。','我已经请同学分析了问卷数据。','我把问卷交给同学分析了数据。'])assert.deepEqual(extractSkillTags('','',source),[],source)
 for(const source of ['王小明和我一起分析了问卷数据。','客户和我一起分析了问卷数据。','昨天同学和我一起分析了问卷数据。'])assert.ok(extractSkillTags('','',source).includes('数据分析'),source)
 assert.deepEqual(deriveStructuralLinks('我整理了写着“反馈很好”的笔记。'),[])
 assert.deepEqual(deriveStructuralLinks('我打印了材料','笔记里写着“导师反馈很好”'),[])
 for(const source of ['可能同学和我一起分析过问卷数据。','好像同学和我一起分析过问卷数据。','我没有像原计划那样在昨天持续两个小时的课程练习中真正分析过问卷数据。']){
  assert.equal(requiresExperienceCandidate(buildClauseCatalogue(source)),false,source)
  assert.deepEqual(extractSkillTags('','',source),[],source)
 }
 assert.deepEqual(extractSkillTags('','','我打印了材料，分析了问卷数据的是王小明。'),[])
 assert.deepEqual(extractSkillTags('','','我听说室友回家后分析了问卷数据。'),[])
 assert.deepEqual(deriveStructuralLinks('我打印了材料','室友反馈她从自己的设计中学到很多'),[])
 assert.deepEqual(extractSkillTags('','','也许客户和我一起分析过问卷数据。'),[])
 assert.ok(extractSkillTags('','','我打印了材料，分析了问卷数据的是我和王小明。').includes('数据分析'))
 const text='我打印了材料，室友整理了设计稿，分析了问卷数据。',catalogue=buildClauseCatalogue(text)
 assert.deepEqual(resolveCandidateContent(catalogue,resolveContiguousClauseRange(text,catalogue,['c0','c1','c2'])!,{action:{clauseId:'c2'}},'2026-10-29T00:00:00Z').dropped,['action'])
})
