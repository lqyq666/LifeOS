import test from 'node:test'
import assert from 'node:assert/strict'
import {Value} from 'typebox/value'
import {scopedCampusSchema} from '../../server/campus-contracts.ts'
import {campusGenerationConstraints} from '../../server/campus-domain.ts'
import {turnSchema} from '../../server/contracts.ts'
import {campusReferenceCards} from '../../server/campus-reference-data.ts'

const id='00000000-0000-4000-8000-000000000001',text='请区分实际结果和原因并修正原假设。'
const observation='同学没用资料，我很失望。'
const contract={statement:'本次结果不足以确认原判断：'+observation+'；原因仍未知。',conditions:'仅限这次原行动及其实际反馈，不推断动机、偏好或普遍原因。',falsifier:'后续同边界的实际反馈若与原预测不同，继续复核；单次反馈不确认或排除原因。'}
const base={domain:'life_goal',newInquiry:true,question:text,questionSource:{id,quote:text},criteria:[],readiness:'bounded',questions:[],studentContext:[],pathways:[],opportunities:[],evidence:[],experiment:{kind:'verify',question:'实际使用情况',action:'在对方自愿的情况下询问实际使用情况',cap:'建议15分钟，可调整',observe:'只记录对方实际回答',adjustWhen:'拒绝或超时停止'}}
const context:any={currentMessageId:id,messages:[{id,role:'user',text}],knownProfile:[],confirmedExperiences:[],campus:{references:[],current:null,feedbackBoundary:{observation:{text:observation},hypothesisContract:contract}}}

test('feedback provider grammar cannot turn an observation into an unsupported personal cause',()=>{
  const schema:any=scopedCampusSchema(turnSchema('default',true),context)
  assert.equal(Value.Check(schema.properties.campus,{...base,hypothesis:{...contract,evidence:[]}}),true)
  assert.equal(Value.Check(schema.properties.campus,{...base,hypothesis:{...contract,statement:'失望可能源于双方价值预期不一致。',evidence:[]}}),false)
})

test('external case comparison requires a visible paired comparison, not two invented personal options',()=>{
  const references=campusReferenceCards.filter(card=>card.kind==='case'&&card.comparisonGroup)
  const schema:any=scopedCampusSchema(turnSchema('default',true),{...context,campus:{references,current:null,generationConstraints:{externalCaseComparison:'Required'}}})
  assert.equal(Value.Check(schema.properties.campus,base),false)
  const support=references.find(card=>card.outcome==='support')!,boundary=references.find(card=>card.outcome==='boundary')!
  const link=(card:any,role:string)=>({source:{type:'knowledge',id:card.id,revision:card.revision,quote:card.claim},role,match:'该研究提供相应结果',limitation:'研究对象不同，不代表个人结果'})
  const opportunity={name:'小访谈',goal:'观察当前需求',choice:'shrink',reason:'培训参与不代表收入改善，按个人时间约束缩小探索',investment:'建议15分钟',role:'尝试',output:'一次实际回答',feedback:'记录实际反馈',alternative:'暂无其他个人选项',stopWhen:'超时停止',evidence:[],caseComparison:{support:link(support,'support'),boundary:link(boundary,'counterexample')}}
  assert.equal(Value.Check(schema.properties.campus,{...base,opportunities:[opportunity]}),true)
})

// Saved C04 / targeted-05: unknown capacity was expanded to daily 1–3 hours.
test('unknown capacity admits only a bounded suggested effort, never daily work assumptions',()=>{
  const constraints=campusGenerationConstraints('课程只剩两周，请先安排关键缺口。')
  const schema:any=scopedCampusSchema(turnSchema('default',true),{...context,campus:{references:[],current:null,generationConstraints:constraints}})
  const check=(cap:string)=>Value.Check(schema.properties.campus,{...base,experiment:{...base.experiment,cap}})
  assert.equal(check('建议上限：每天3小时，可调整'),false)
  assert.equal(check('建议上限15分钟，可调整'),true)
  const known=campusGenerationConstraints('每周最多一小时')
  assert.ok(known.effortCaps.every((cap:string)=>!cap.includes('每天')))
})

test('same-goal stale policy review cannot become a new inquiry',()=>{
  const current={id,stale:true,studentContext:[],experiments:[]}
  const schema:any=scopedCampusSchema(turnSchema('default',true),{...context,campus:{references:[],current}})
  assert.equal(Value.Check(schema.properties.campus,{...base,newInquiry:true}),false)
  assert.equal(Value.Check(schema.properties.campus,{...base,newInquiry:false}),true)
})
