import test from 'node:test'
import assert from 'node:assert/strict'
import {explicitlyConfirmsLabel,violatesLabelInferenceBoundary} from '../server/forget-intent.ts'
import {buildClauseCatalogue} from '../server/clause-catalogue.ts'
import {resolveGrowthDeltas} from '../server/growth-authority.ts'

test('an unconfirmed personal label cannot be regenerated as a fact or hypothesis',()=>{
 const boundaries=[{label:'我喜欢销售',active:true}]
 for(const text of ['你喜欢销售。','这些经历说明你确实喜欢销售。','你可能喜欢销售，但仍待核实。','喜欢销售'])assert.equal(violatesLabelInferenceBoundary(text,boundaries),true,text)
 for(const text of ['不能据此说你喜欢销售。','你喜欢销售是否成立仍未知。','不会再从这些经历推断你喜欢销售。','“我喜欢销售”不是已确认事实。','室友喜欢销售。','我的室友喜欢销售。','导师说你喜欢销售。'])assert.equal(violatesLabelInferenceBoundary(text,boundaries),false,text)
 assert.equal(violatesLabelInferenceBoundary('你喜欢销售。',[{...boundaries[0]!,active:false}]),false)
 assert.equal(violatesLabelInferenceBoundary('你喜欢销售。',boundaries,'我现在确实喜欢销售。'),false,'a later direct confirmation is owned by the user')
 for(const text of ['喜欢销售，是你从这些经历里表现出的倾向。','喜欢销售这一点，从你的经历中可以看出来。'])assert.equal(violatesLabelInferenceBoundary(text,boundaries),true,text)
 for(const text of ['喜欢销售，是室友从她的经历中表现出的倾向。','喜欢销售这一点，不能从你的经历中确认。','喜欢销售这一点，你是否如此仍未知。'])assert.equal(violatesLabelInferenceBoundary(text,boundaries),false,text)
 for(const text of ['喜欢销售，是你刚才否认的标签。','喜欢销售，是你拒绝的推断。','你否认喜欢销售。'])assert.equal(violatesLabelInferenceBoundary(text,boundaries),false,text)
 for(const text of ['我喜欢销售吗？','如果我喜欢销售，再考虑。','朋友说我喜欢销售。','我读到“我喜欢销售”。'])assert.equal(explicitlyConfirmsLabel(text,'我喜欢销售'),false,text)
})

test('the existing growth authority drops forbidden inferred labels without shifting other source handles',()=>{
 const text='我今天整理了资料',catalogue=buildClauseCatalogue(text),source={clauseId:catalogue[0]!.clauseId}
 const deltas:any[]=[{target:{operation:'create'},assertion:'ai_observation',kind:'observation',text:'你可能喜欢销售',source,dependencies:[{id:'fact',revision:1}],limitation:'一次经历不足'},
  {target:{operation:'create'},assertion:'user_reported',kind:'context',source}]
 const authorized=[{id:'boundary',revision:1,kind:'context',assertion:'user_reported',text:'控制原话',status:'active',unavailableReason:null,inferenceBoundary:{label:'我喜欢销售',active:true}},
  {id:'fact',revision:1,kind:'context',assertion:'user_reported',text:'我整理了资料',status:'active',unavailableReason:null}]
 const result=resolveGrowthDeltas({deltas,currentMessageId:'source',currentText:text,catalogue,authorized,correctionPlan:null,controlClauseTexts:[]})
 assert.equal(result.deltas.length,1);assert.equal(result.deltas[0]!.assertion,'user_reported')
 assert.equal(result.indexMap.get(0),undefined);assert.equal(result.indexMap.get(1),0)
 assert.ok(result.audit.some(entry=>entry.phase==='growth_rejected_label_inference_dropped'))
})
