import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveTimeWindow,legacyValidUntilMatchesQuote,quoteStatedCutoff,chineseInteger,TimeEvidenceError,resolveOccurredDate} from '../server/growth-time.ts'

const ANCHOR='2026-10-06T04:00:00.000Z' // Tuesday 12:00 Shanghai
const SOURCE='我到2026年10月20日前都要备考，接下来三周很忙，下周只有两小时，本周先赶作业。'

test('date_inclusive cutoffs end right-open at Shanghai midnight',()=>{
  const window=resolveTimeWindow({kind:'date_inclusive',date:'2026-10-20',quote:'到2026年10月20日'},SOURCE,ANCHOR,'Asia/Shanghai')
  assert.equal(window.validFrom,ANCHOR)
  assert.equal(window.validUntil,'2026-10-20T16:00:00.000Z','Oct 20 inclusive in Shanghai ends at Oct 20 16:00 UTC')
  assert.equal(window.basis.zone,'Asia/Shanghai')
  assert.equal(window.basis.endExclusive,true)
  // The stated quote and the date field must agree; anything else is refused.
  assert.throws(()=>resolveTimeWindow({kind:'date_inclusive',date:'2026-10-21',quote:'到2026年10月20日'},SOURCE,ANCHOR,'Asia/Shanghai'),(error:unknown)=>error instanceof TimeEvidenceError&&error.code==='GROWTH_TIME_UNVERIFIED')
  assert.throws(()=>resolveTimeWindow({kind:'date_inclusive',date:'2027-02-29',quote:'到2027年2月29日'},SOURCE,ANCHOR,'Asia/Shanghai'),/GROWTH_TIME_UNVERIFIED/,'2027 is not a leap year')
  assert.doesNotThrow(()=>resolveTimeWindow({kind:'date_inclusive',date:'2028-02-29',quote:'截至2028年2月29日'},'截至2028年2月29日交材料',ANCHOR,'Asia/Shanghai'),'2028 is a leap year')
  assert.throws(()=>resolveTimeWindow({kind:'date_inclusive',date:'2026-02-30',quote:'到2026年2月30日'},SOURCE,ANCHOR,'Asia/Shanghai'),/GROWTH_TIME_UNVERIFIED/)
})

test('duration windows use the fixed message anchor and accept Chinese numerals',()=>{
  const weeks=resolveTimeWindow({kind:'duration',count:3,unit:'week',quote:'接下来三周'},SOURCE,ANCHOR,'Asia/Shanghai')
  assert.equal(weeks.validUntil,new Date(Date.parse(ANCHOR)+21*86400000).toISOString())
  assert.equal(weeks.basis.anchor,ANCHOR)
  const days=resolveTimeWindow({kind:'duration',count:6,unit:'week',quote:'未来6周'},'未来6周内都有课。',ANCHOR,'Asia/Shanghai')
  assert.equal(days.validUntil,new Date(Date.parse(ANCHOR)+42*86400000).toISOString())
  assert.equal(resolveTimeWindow({kind:'duration',count:2,unit:'day',quote:'从现在起两天'},'从现在起两天要闭关。',ANCHOR,'Asia/Shanghai').validUntil,new Date(Date.parse(ANCHOR)+2*86400000).toISOString())
  assert.equal(chineseInteger('三'),3)
  assert.equal(chineseInteger('两'),2)
  assert.equal(chineseInteger('六'),6)
  assert.equal(chineseInteger('十二'),12)
  assert.equal(chineseInteger('二十'),20)
  assert.equal(chineseInteger('10'),10)
  assert.equal(chineseInteger('很多'),null)
  // A count that disagrees with the quote, or an uncovered phrase, is refused —
  // 每周3小时 is a rate, never a duration of 3 weeks.
  assert.throws(()=>resolveTimeWindow({kind:'duration',count:3,unit:'day',quote:'接下来三周'},SOURCE,ANCHOR,'Asia/Shanghai'),/GROWTH_TIME_UNVERIFIED/)
  assert.throws(()=>resolveTimeWindow({kind:'duration',count:5,unit:'week',quote:'每周3小时'},SOURCE,ANCHOR,'Asia/Shanghai'),/GROWTH_TIME_UNVERIFIED/)
  assert.throws(()=>resolveTimeWindow({kind:'duration',count:400,unit:'week',quote:'未来400周'},SOURCE,ANCHOR,'Asia/Shanghai'),/GROWTH_TIME_UNVERIFIED/)
})

test('calendar weeks: this week starts now; next week never starts today',()=>{
  // 2026-10-06 is a Tuesday; Monday was Oct 5 (Oct 4 16:00 UTC in Shanghai).
  const thisWeek=resolveTimeWindow({kind:'calendar_week',which:'this',quote:'本周'},SOURCE,ANCHOR,'Asia/Shanghai')
  assert.equal(thisWeek.validFrom,ANCHOR)
  assert.equal(thisWeek.validUntil,'2026-10-11T16:00:00.000Z')
  const next=resolveTimeWindow({kind:'calendar_week',which:'next',quote:'下周'},SOURCE,ANCHOR,'Asia/Shanghai')
  assert.equal(next.validFrom,'2026-10-11T16:00:00.000Z','下周 opens next Monday, never today')
  assert.equal(next.validUntil,'2026-10-18T16:00:00.000Z')
  assert.throws(()=>resolveTimeWindow({kind:'calendar_week',which:'this',quote:'这周'},SOURCE,ANCHOR,'Asia/Shanghai'),/GROWTH_TIME_UNVERIFIED/,'这周 is not the stated 本周')
  // Late-Sunday UTC anchor is already Monday morning in Shanghai: the week
  // then runs through the following Sunday.
  const mondayMorning=resolveTimeWindow({kind:'calendar_week',which:'this',quote:'本周'},SOURCE,'2026-10-11T20:00:00.000Z','Asia/Shanghai')
  assert.equal(mondayMorning.validUntil,'2026-10-18T16:00:00.000Z')
})

test('unverifiable inputs are refused: absent quotes, bad anchors, unknown zones',()=>{
  assert.throws(()=>resolveTimeWindow({kind:'duration',count:2,unit:'day',quote:'这句话不在原话里'},SOURCE,ANCHOR,'Asia/Shanghai'),/GROWTH_TIME_UNVERIFIED/)
  assert.throws(()=>resolveTimeWindow({kind:'date_inclusive',date:'2026-10-20',quote:'到2026年10月20日'},SOURCE,'2026-10-06 04:00','Asia/Shanghai'),/GROWTH_TIME_UNVERIFIED/,'anchor must come from messages.created_at')
  assert.throws(()=>resolveTimeWindow({kind:'date_inclusive',date:'2026-10-20',quote:'到2026年10月20日'},SOURCE,ANCHOR,'America/New_York' as 'Asia/Shanghai'),/GROWTH_TIME_UNVERIFIED/,'only Shanghai and UTC are implemented')
})

test('legacy validUntil is accepted only when the quote states the same cutoff',()=>{
  const quote='本学期每周最多四小时，截至2026年12月31日'
  assert.equal(legacyValidUntilMatchesQuote('2026-12-31T16:00:00.000Z',quote,'Asia/Shanghai'),true)
  assert.equal(legacyValidUntilMatchesQuote('2026-12-31T23:59:59Z',quote,'Asia/Shanghai'),false,'a guessed end-of-year timestamp is not the stated cutoff')
  assert.equal(legacyValidUntilMatchesQuote('2026-12-31T16:00:00.000Z','本学期每周最多四小时','Asia/Shanghai'),false,'no stated date, no verification')
  assert.equal(legacyValidUntilMatchesQuote('not-a-date',quote,'Asia/Shanghai'),false)
  assert.equal(quoteStatedCutoff('期末忙，先备考','Asia/Shanghai'),null)
  assert.equal(quoteStatedCutoff(quote,'Asia/Shanghai')!.date,'2026-12-31')
})

test('resolveOccurredDate derives past dates only from explicit user words',()=>{
  // Thursday 2026-10-08, 20:00 Shanghai.
  const anchor='2026-10-08T12:00:00.000Z'
  assert.equal(resolveOccurredDate('约好周五交、我上周五才交过去',anchor,'Asia/Shanghai'),'2026年10月2日（周五）')
  assert.equal(resolveOccurredDate('昨天把海报交了',anchor,'Asia/Shanghai'),'2026年10月7日（周三）')
  assert.equal(resolveOccurredDate('前天答辩结束了',anchor,'Asia/Shanghai'),'2026年10月6日（周二）')
  assert.equal(resolveOccurredDate('今天上午交了报名表',anchor,'Asia/Shanghai'),'2026年10月8日（周四）')
  assert.equal(resolveOccurredDate('10月2日交的终稿',anchor,'Asia/Shanghai'),'2026年10月2日（周五）')
  assert.equal(resolveOccurredDate('2026年9月30日签的字',anchor,'Asia/Shanghai'),'2026年9月30日（周三）')
  assert.equal(resolveOccurredDate('2026-9-30签的字',anchor,'Asia/Shanghai'),'2026年9月30日（周三）')
  assert.equal(resolveOccurredDate('上个月参加了招新',anchor,'Asia/Shanghai'),'2026年9月')
  assert.equal(resolveOccurredDate('上周参加了一个工作坊',anchor,'Asia/Shanghai'),'上周')
  // A month/day already past this year with no year stated belongs to last year.
  assert.equal(resolveOccurredDate('12月30日交的',anchor,'Asia/Shanghai'),'2025年12月30日（周二）')
  // Bare weekdays, future weekdays and vague futures stay unresolved.
  assert.equal(resolveOccurredDate('周五交',anchor,'Asia/Shanghai'),null)
  assert.equal(resolveOccurredDate('这周五交',anchor,'Asia/Shanghai'),null,'the named day is still ahead: a plan, not an experience')
  assert.equal(resolveOccurredDate('下个月再说',anchor,'Asia/Shanghai'),null)
  assert.equal(resolveOccurredDate('上周五交了','2026-10-08 04:00','Asia/Shanghai'),null,'anchor must come from messages.created_at')
})
