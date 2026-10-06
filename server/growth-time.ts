/** Explicit time evidence only. No inferred semester, deadline or model timestamp. */
export type Zone = 'Asia/Shanghai' | 'UTC'
export type TimeEvidence =
  | { kind: 'date_inclusive'; date: string; quote: string }
  | { kind: 'duration'; count: number; unit: 'day' | 'week'; quote: string }
  | { kind: 'calendar_week'; which: 'this' | 'next'; quote: string }
export type TimeWindow = {
  validFrom: string; validUntil: string;
  basis: TimeEvidence & { anchor: string; zone: Zone; endExclusive: true }
}
export class TimeEvidenceError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}
const fail = (): never => { throw new TimeEvidenceError('GROWTH_TIME_UNVERIFIED') }
const DAY = 86_400_000
function offset(zone: Zone): number {
  if (zone !== 'Asia/Shanghai' && zone !== 'UTC') return fail()
  return zone === 'Asia/Shanghai' ? 8 * 3_600_000 : 0
}
function dateParts(value: string): [number, number, number] {
  const match = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return fail()
  const y = Number(match[1]), m = Number(match[2]), d = Number(match[3])
  const check = new Date(Date.UTC(y, m - 1, d))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return fail()
  return [y, m, d]
}

// Side-effect-free Chinese numeral conversion for the integer amounts used in
// time expressions. The stored quote always keeps the user's original words;
// this only lets a duration phrase like 未来六周 resolve to count 6. Uncovered
// expressions still refuse rather than guess.
export function chineseInteger(text: string): number | null {
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units: Record<string, number> = { 十: 10, 百: 100 }
  if (/^\d+$/.test(text)) return Number(text)
  if (!/^[\d零一二两三四五六七八九十百]+$/.test(text)) return null
  let total = 0, current = 0, any = false
  for (const char of text) {
    if (char in digits) { current = current * 10 + digits[char]!; any = true }
    else if (char in units) { total += (current || 1) * units[char]!; current = 0; any = true }
  }
  if (!any) return null
  return total + current
}

export function resolveTimeWindow(
  evidence: TimeEvidence, sourceText: string, requestTimeUtc: string, zone: Zone,
): TimeWindow {
  if (!evidence.quote.trim() || !sourceText.includes(evidence.quote)) return fail()
  // Anchor is injected from messages.created_at, never supplied by the model.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(requestTimeUtc)) return fail()
  const now = Date.parse(requestTimeUtc)
  if (!Number.isFinite(now)) return fail()
  const zoneOffset = offset(zone)
  let from = now, until: number
  if (evidence.kind === 'date_inclusive') {
    const [y, m, d] = dateParts(evidence.date)
    const match = /^(?:截至|截止到?|直到|到)\s*(20\d{2})(?:年|-)(\d{1,2})(?:月|-)(\d{1,2})日?$/.exec(evidence.quote)
    if (!match || +match[1]! !== y || +match[2]! !== m || +match[3]! !== d) return fail()
    // Inclusive user-facing cutoff day, right-open interval: 截至10月20日 in
    // Shanghai ends at Shanghai Oct 21 00:00 (Oct 20 16:00 UTC).
    until = Date.UTC(y, m - 1, d + 1) - zoneOffset
  } else if (evidence.kind === 'duration') {
    if (!Number.isSafeInteger(evidence.count) || evidence.count < 1 || evidence.count > 366 ||
        !['day', 'week'].includes(evidence.unit)) return fail()
    const match = /^(?:从现在起|接下来|未来)\s*([\d零一二两三四五六七八九十百]+)\s*(天|周)$/.exec(evidence.quote)
    if (!match) return fail()
    const amount = chineseInteger(match[1]!)
    if (amount === null || amount !== evidence.count || (match[2] === '天' ? 'day' : 'week') !== evidence.unit) return fail()
    until = now + evidence.count * (evidence.unit === 'week' ? 7 : 1) * DAY
  } else if (evidence.kind === 'calendar_week') {
    if (!['this', 'next'].includes(evidence.which)) return fail()
    if (!(evidence.which === 'this' ? ['本周', '这周'] : ['下周']).includes(evidence.quote)) return fail()
    const local = new Date(now + zoneOffset)
    const daysSinceMonday = (local.getUTCDay() + 6) % 7
    const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday) - zoneOffset
    // 下周 never starts today: its window opens next Monday.
    from = evidence.which === 'this' ? now : monday + 7 * DAY
    until = monday + (evidence.which === 'this' ? 7 : 14) * DAY
  } else return fail()
  if (!Number.isFinite(until) || until <= from) return fail()
  return {
    validFrom: new Date(from).toISOString(), validUntil: new Date(until).toISOString(),
    basis: { ...evidence, anchor: requestTimeUtc, zone, endExclusive: true },
  }
}

// Extract an explicitly stated cutoff day (截至…日) from a user quote. Used
// both to cross-check legacy model validUntil values and to synthesize the
// stored time basis for them. Returns null when the quote states no date.
export function quoteStatedCutoff(quote: string, zone: Zone): { date: string; quote: string; validUntil: string } | null {
  const match = /(?:截至|截止到?|直到|到)\s*(20\d{2})\s*(?:年|-)\s*(\d{1,2})\s*(?:月|-)\s*(\d{1,2})\s*日?/.exec(quote)
  if (!match) return null
  const y = Number(match[1]), m = Number(match[2]), d = Number(match[3])
  const check = new Date(Date.UTC(y, m - 1, d))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null
  const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return { date, quote: match[0], validUntil: new Date(Date.UTC(y, m - 1, d + 1) - offset(zone)).toISOString() }
}

// Legacy cross-check for old-style model validUntil values: a non-empty expiry
// without time evidence is only accepted when the user's own quoted words state
// the same cutoff date explicitly (anywhere in the quote). Everything else is
// GROWTH_TIME_UNVERIFIED — never silently dropped and counted as complete.
export function legacyValidUntilMatchesQuote(validUntil: string, quote: string, zone: Zone): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(validUntil) || !Number.isFinite(Date.parse(validUntil))) return false
  const stated = quoteStatedCutoff(quote, zone)
  return stated !== null && Date.parse(validUntil) === Date.parse(stated.validUntil)
}
