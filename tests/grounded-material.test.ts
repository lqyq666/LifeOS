import test from 'node:test'
import assert from 'node:assert/strict'
import {renderGroundedResume,singleUniqueContributionFact} from '../server/grounded-material.ts'

const fact=(catalogueId:string,field:'identity'|'target'|'project'|'skill'|'contact',text:string,complete=false)=>({catalogueId,field,text,sourceKind:'user_reported' as const,completeForField:complete})

test('renderer keeps facts verbatim and marks template gaps honestly',()=>{
  const catalogue=[
    fact('p1','project','我有三个数字媒体作品'),
    fact('t1','target','倾向就业但想看看真实反馈'),
  ]
  const result=renderGroundedResume(['p1','t1'],catalogue)
  assert.equal(result.readiness,'template','three works alone never complete a resume')
  assert.deepEqual(result.missingRequired,['identity','target','project','contact'],'an unconfirmed leaning is not a complete 求职意向 field')
  assert.ok(result.content.includes('简历与作品清单（待补信息模板）'))
  assert.ok(result.content.includes('我有三个数字媒体作品'))
  assert.ok(result.content.includes('【尚未提供工具和熟练程度，可先删除本栏】'),'no default PS/Figma/Excel skills')
  assert.ok(!result.content.includes('（熟练）')&&!/(?:PS|Figma|Premiere|Excel)/.test(result.content),'no invented tools or proficiency markers')
  assert.ok(result.content.includes('【待补：个人基本信息】'))
})

test('a complete contact plus identity yields a review draft, still without invented skills',()=>{
  const catalogue=[
    fact('i1','identity','姓名：小林',true),
    fact('t1','target','倾向就业但想看看真实反馈',true),
    fact('p1','project','三个数字媒体作品；本人负责排版与配色',true),
    fact('c1','contact','xiaolin@example.com',true),
    fact('s1','skill','我会Figma但还不熟练'),
  ]
  const result=renderGroundedResume(['i1','t1','p1','c1','s1'],catalogue)
  assert.equal(result.readiness,'draft_for_user_review')
  assert.deepEqual(result.missingRequired,[])
  assert.ok(result.content.includes('我会Figma但还不熟练'),'negation and degree words are kept verbatim — never flipped to 熟练')
  assert.ok(!result.content.includes('Figma（熟练）'))
})

test('invalid references and malformed catalogues are hard failures',()=>{
  const catalogue=[fact('p1','project','作品')]
  assert.throws(()=>renderGroundedResume(['nope'],catalogue),/MATERIAL_REFERENCE_INVALID/)
  assert.throws(()=>renderGroundedResume(['p1','p1'],catalogue),/MATERIAL_REFERENCE_INVALID/,'duplicate selections are invalid')
  assert.throws(()=>renderGroundedResume(['a','b'],[fact('a','project','x'),fact('a','skill','y')]),/MATERIAL_CATALOGUE_INVALID/,'duplicate catalogue ids are invalid')
  assert.throws(()=>renderGroundedResume(Array.from({length:33},(_,i)=>`id${i}`),Array.from({length:33},(_,i)=>fact(`id${i}`,'skill','x'))),/MATERIAL_REFERENCE_INVALID/)
  // Only server-verified provenance may enter the renderer.
  // @ts-expect-error Deliberately malformed: an AI-observation source kind must never pass.
  assert.throws(()=>renderGroundedResume(['x'],[{catalogueId:'x',field:'skill',text:'很有天赋',sourceKind:'ai_observation',completeForField:true}]),/MATERIAL_REFERENCE_INVALID/)
})

test('current-project or byte-identical contribution sources remain one content decision',()=>{
  const first={...fact('p1','project','我在课程小组里负责整理资料和排版'),sourceRef:{type:'growth' as const,id:'g-new',revision:1}}
  const repeated={...fact('p2','project','我在课程小组里负责整理资料和排版'),sourceRef:{type:'growth' as const,id:'g-old',revision:1}}
  assert.equal(singleUniqueContributionFact([first,repeated])?.catalogueId,'p1','the first authorized source is retained')
  const different={...fact('p3','project','我在社团活动里负责海报排版'),sourceRef:{type:'growth' as const,id:'g-other',revision:1}}
  assert.equal(singleUniqueContributionFact([first,different]),null,'different contribution wording still requires a real selection')
  const current={...first,contextKey:'current-chat'}
  const unrelated={...different,contextKey:'other-chat'}
  assert.equal(singleUniqueContributionFact([current,unrelated],'current-chat')?.catalogueId,'p1','the current conversation contribution wins over an unrelated project')
  assert.equal(singleUniqueContributionFact([current,unrelated],'other-chat')?.catalogueId,'p3','context selection follows the requested conversation')
})
