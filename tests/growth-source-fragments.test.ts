import test from 'node:test'
import assert from 'node:assert/strict'
import {amendExactClause,carriesPersonalText,fromLegacyText,joinFragments,FragmentError,type Fragment,type Source} from '../server/growth-source-fragments.ts'

const COMPOSITE='我有三个数字媒体作品，每周能投入6小时，倾向就业但想看看真实反馈。'
const m1:Source={type:'message',id:'m1',quote:COMPOSITE}

test('joinFragments enforces quote-text identity, ids and bounds',()=>{
  const part:Fragment={text:'每周能投入6小时',source:{type:'message',id:'m1',quote:'每周能投入6小时'}}
  assert.equal(joinFragments([part]),'每周能投入6小时')
  assert.throws(()=>joinFragments([]),(error:unknown)=>error instanceof FragmentError&&error.code==='GROWTH_FRAGMENT_INVALID')
  assert.throws(()=>joinFragments([{text:'每周能投入6小时',source:{type:'message',id:'m1',quote:'别的原话'}}]),/GROWTH_FRAGMENT_INVALID/)
  assert.throws(()=>joinFragments([{text:'每周能投入6小时',source:{type:'message',id:'',quote:'每周能投入6小时'}}]),/GROWTH_FRAGMENT_INVALID/)
  assert.throws(()=>joinFragments([{text:'   ',source:{type:'user_edit',quote:'   '}}]),/GROWTH_FRAGMENT_INVALID/)
  assert.throws(()=>joinFragments(Array.from({length:65},()=>part)),/GROWTH_FRAGMENT_INVALID/)
  assert.throws(()=>joinFragments([{text:'x'.repeat(4001),source:{type:'user_edit',quote:'x'.repeat(4001)}}]),/GROWTH_FRAGMENT_INVALID/)
})

test('fromLegacyText keeps provenance and refuses ambiguous originals',()=>{
  assert.deepEqual(fromLegacyText('每周能投入6小时',[m1]),[{text:'每周能投入6小时',source:{type:'message',id:'m1',quote:'每周能投入6小时'}}])
  assert.deepEqual(fromLegacyText('我喜欢绘画',[{type:'user_edit',quote:'我喜欢绘画，先探索就业。'}]),[{text:'我喜欢绘画',source:{type:'user_edit',quote:'我喜欢绘画'}}])
  assert.throws(()=>fromLegacyText('每周能投入6小时',[{type:'message',id:'m2',quote:'无关原话'}]),(error:unknown)=>error instanceof FragmentError&&error.code==='GROWTH_COMPOSITE_REQUIRES_REVIEW')
  // Two different identities covering the same text cannot decide provenance.
  assert.throws(()=>fromLegacyText('每周能投入6小时',[m1,{type:'user_edit',quote:COMPOSITE}]),/GROWTH_COMPOSITE_REQUIRES_REVIEW/)
  // The same identity repeated is still one provenance.
  assert.doesNotThrow(()=>fromLegacyText('每周能投入6小时',[m1,{type:'message',id:'m1',quote:COMPOSITE}]))
})

test('carriesPersonalText separates punctuation from personal content',()=>{
  assert.equal(carriesPersonalText('，'),false)
  assert.equal(carriesPersonalText('。！？'),false)
  assert.equal(carriesPersonalText('三个作品'),true)
  assert.equal(carriesPersonalText('6h'),true)
})

test('amendExactClause replaces exactly one unique clause and preserves the rest',()=>{
  const parts=fromLegacyText(COMPOSITE,[m1])
  const result=amendExactClause(parts,'每周能投入6小时',{type:'message',id:'m2',quote:'每周只有3小时了'},'最近课程变多了，每周只有3小时了，安排帮我改一下。')
  assert.equal(result.text,'我有三个数字媒体作品，每周只有3小时了，倾向就业但想看看真实反馈。')
  const personal=result.fragments.filter(fragment=>carriesPersonalText(fragment.text))
  assert.equal(personal.length,3,'punctuation-only slices stay in text but are not fact sources')
  assert.deepEqual(personal.map(fragment=>fragment.source.id),['m1','m2','m1'])
  assert.equal(result.sources.length,3)
})

test('amendExactClause rejects absent, duplicated, mid-clause and unchanged quotes',()=>{
  const parts=fromLegacyText(COMPOSITE,[m1])
  const twice=fromLegacyText('每周有6小时，舍友也说每周有6小时。',[{type:'message',id:'m1',quote:'每周有6小时，舍友也说每周有6小时。'}])
  const clause=(quote:string)=>({type:'message' as const,id:'m2',quote})
  const message='最近课程变多了，每周只有3小时了，安排帮我改一下。'
  assert.throws(()=>amendExactClause(parts,'每周能投入8小时',clause('每周只有3小时了'),message),(error:unknown)=>error instanceof FragmentError&&error.code==='GROWTH_AMENDMENT_AMBIGUOUS')
  assert.throws(()=>amendExactClause(twice,'每周有6小时',clause('每周只有3小时了'),message),/GROWTH_AMENDMENT_AMBIGUOUS/)
  assert.throws(()=>amendExactClause(parts,'作品，每周',clause('每周只有3小时了'),message),(error:unknown)=>error instanceof FragmentError&&error.code==='GROWTH_AMENDMENT_NOT_A_CLAUSE')
  assert.throws(()=>amendExactClause(parts,'能投入',clause('每周只有3小时了'),message),/GROWTH_AMENDMENT_NOT_A_CLAUSE/)
  assert.throws(()=>amendExactClause(parts,'每周能投入6小时',clause('每周只有3小时了，安排'),message),/GROWTH_AMENDMENT_NOT_A_CLAUSE/)
  assert.throws(()=>amendExactClause(parts,'每周能投入6小时',clause('这句话不在当前消息里'),message),/GROWTH_SOURCE_INVALID/)
  assert.throws(()=>amendExactClause(parts,'每周能投入6小时',{type:'message',id:'',quote:'每周只有3小时了'},message),/GROWTH_SOURCE_INVALID/)
  assert.throws(()=>amendExactClause(parts,'每周能投入6小时',clause('每周能投入6小时'),'用户重复说每周能投入6小时。'),/GROWTH_UNCHANGED/)
})

test('amendExactClause on a single-clause fact yields exactly the new clause',()=>{
  const parts=fromLegacyText('每周能投入6小时',[{type:'message',id:'m1',quote:'每周能投入6小时'}])
  const result=amendExactClause(parts,'每周能投入6小时',{type:'message',id:'m2',quote:'每周只有3小时了'},'最近课程变多了，每周只有3小时了，安排帮我改一下。')
  assert.equal(result.text,'每周只有3小时了')
  assert.equal(result.fragments.length,1)
  assert.equal(result.fragments[0]!.source.id,'m2')
})
