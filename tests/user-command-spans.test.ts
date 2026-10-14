import test from 'node:test'
import assert from 'node:assert/strict'
import {weeklyTimeIntent} from '../server/turn-obligations.ts'
import {scanUserClauses,parseExactHours,assistantRequestClause} from '../server/user-command-spans.ts'

test('actual UI action and interpretation instructions are not autobiographical context',()=>{
 assert.equal(assistantRequestClause('请按我的实际情况帮我选一个能做的最小行动'),true)
 assert.equal(assistantRequestClause('不要把做过工具当作适合创业的证明'),true)
 assert.equal(assistantRequestClause('我想先了解就业实习'),false)
 assert.equal(assistantRequestClause('我不会把一次付款当作稳定收入'),false)
})

// N1.1/N1.2 behavioral red→green suite: the audit cases from AUDIT_EVIDENCE §3
// asserted against the live detectors. Questions never become settings,
// conditionals never become facts, 1.5h is 90 minutes, and 为什么 must be
// answered instead of being swallowed by a "pure control" shortcut.

test('A03/A04 exact hours and period inheritance',()=>{
  assert.deepEqual(weeklyTimeIntent('我每周1.5小时。'),{quote:'我每周1.5小时',minutes:90,period:'current'},'1.5小时=90分钟')
  assert.deepEqual(weeklyTimeIntent('我每周0.5小时。'),{quote:'我每周0.5小时',minutes:30,period:'current'})
  assert.deepEqual(weeklyTimeIntent('我每周0小时。'),{quote:'我每周0小时',minutes:0,period:'current'},'零投入不伪造不忽略')
  assert.deepEqual(weeklyTimeIntent('每周1.75小时'),{quote:'每周1.75小时',minutes:105,period:'current'})
  const next=weeklyTimeIntent('下周，每周只有2小时。')
  assert.deepEqual({...next},{quote:'每周只有2小时',minutes:120,period:'next_week'},'周期从同句前置分句继承')
  assert.deepEqual(weeklyTimeIntent('这周先按每周4小时安排'),{quote:'这周先按每周4小时安排',minutes:240,period:'this_week'})
  // kept positives and negatives
  assert.deepEqual(weeklyTimeIntent('我每周只有3小时了，安排帮我改一下。'),{quote:'我每周只有3小时了',minutes:180,period:'current'})
  assert.equal(weeklyTimeIntent('做作品花了3小时。'),null,'花费时长不是每周预算')
  assert.equal(weeklyTimeIntent('室友每周3小时。'),null)
  assert.equal(weeklyTimeIntent('我不是每周只有3小时。'),null)
  assert.equal(weeklyTimeIntent('这周剩3小时，不是以后每周3小时。'),null,'剩余预算本批不覆盖weekly记录')
  assert.equal(weeklyTimeIntent('我每周大概4小时吧。'),null)
  assert.equal(weeklyTimeIntent('我每周至少3小时。'),null)
  assert.equal(weeklyTimeIntent('我每周3到4小时。'),null)
})

test('parseExactHours returns exact integer minutes only',()=>{
  assert.equal(parseExactHours('1.5'),90)
  assert.equal(parseExactHours('0.5'),30)
  assert.equal(parseExactHours('0'),0)
  assert.equal(parseExactHours('1.75'),105)
  assert.equal(parseExactHours('三'),180)
  assert.equal(parseExactHours('两'),120)
  assert.equal(parseExactHours('一小时半'),90)
  assert.equal(parseExactHours('一个半小时'),90)
  assert.equal(parseExactHours('1.555'),null,'超过两位小数不解析成近似值')
  assert.equal(parseExactHours('-1'),null)
  assert.equal(parseExactHours('很多'),null)
  assert.equal(parseExactHours(''),null)
})

test('scanUserClauses keeps absolute offsets, quotes, code and sentence facts',()=>{
  const text='如果压力太大，就暂停考研。朋友说：“先别推升学”。'
  const clauses=scanUserClauses(text)
  assert.ok(clauses.length>=3)
  for(const clause of clauses){
    assert.equal(text.slice(clause.start,clause.end),clause.text,'offsets are absolute')
    assert.ok(clause.end>=clause.sentenceStart&&clause.sentenceEnd>=clause.end)
  }
  const conditional=clauses.find(clause=>clause.text.includes('就暂停考研'))!
  assert.equal(conditional.conditional,true,'条件状态跨逗号延续到同句后续分句')
  const reported=clauses.find(clause=>clause.text.includes('先别推升学'))!
  assert.equal(reported.attributedToOther,true,'转述范围不因逗号丢失')
  assert.equal(scanUserClauses('“先别推升学相关安排”')[0]!.quoted,true,'纯引号分句是引用')
  assert.ok(scanUserClauses('如果压力太大再说，现在先暂停考研建议。').find(clause=>clause.text.includes('现在先暂停'))!.conditional===false,'转折/现实陈述重置条件')
  const nextSentence=clauses.filter(clause=>clause.sentenceStart>conditional.sentenceStart)
  assert.ok(nextSentence.every(clause=>!clause.conditional),'句级终止后条件重新判断')
  const interrogative=scanUserClauses('暂停考研吗？')
  assert.equal(interrogative[0]!.interrogative,true,'问句在原始句子上判定')
})
