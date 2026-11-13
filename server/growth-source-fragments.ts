/** Pure provenance-preserving amendment. Database ownership/CAS checks are separate. */
export type Source =
  | { type: 'message'; id: string; quote: string; range?:{start:number;end:number} }
  | { type: 'user_edit'; quote: string }
export type Fragment = { text: string; source: Source }
export class FragmentError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}
const fail = (code: string): never => { throw new FragmentError(code) }
const MAX_TEXT = 4000
const MAX_FRAGMENTS = 64
const delimiter = /[，,；;。！？!?\n]/u
export const carriesPersonalText = (text: string): boolean => /[\p{L}\p{N}]/u.test(text)

export function joinFragments(fragments: readonly Fragment[]): string {
  if (!fragments.length || fragments.length > MAX_FRAGMENTS) fail('GROWTH_FRAGMENT_INVALID')
  for (const part of fragments) {
    if (!part.text || part.source.quote !== part.text) fail('GROWTH_FRAGMENT_INVALID')
    if (part.source.type === 'message' && !part.source.id) fail('GROWTH_FRAGMENT_INVALID')
  }
  const text = fragments.map(part => part.text).join('')
  if (!text.trim() || text.length > MAX_TEXT) fail('GROWTH_FRAGMENT_INVALID')
  return text
}

/** Use only after verifying this source against the authoritative database. */
export function fromLegacyText(text: string, sources: readonly Source[]): Fragment[] {
  if (!text.trim() || text.length > MAX_TEXT) fail('GROWTH_FRAGMENT_INVALID')
  const candidates = sources.filter(source => source.quote.includes(text))
  if(candidates.some(source=>source.quote.indexOf(text,source.quote.indexOf(text)+1)>=0))fail('GROWTH_COMPOSITE_REQUIRES_REVIEW')
  const identities = new Map(candidates.map(source => {
    const selected=sliceSource(source,text,source.quote.indexOf(text))
    return [selected.type==='message'?JSON.stringify(['message',selected.id,selected.range?[selected.range.start,selected.range.end]:source.quote]):'user_edit',selected] as const
  }))
  if (identities.size !== 1) fail('GROWTH_COMPOSITE_REQUIRES_REVIEW')
  const source = [...identities.values()][0]!
  return [{ text, source }]
}

export function sliceSource(source:Source,quote:string,offset=source.quote.indexOf(quote)):Source{
  const {range,...base}=source as Extract<Source,{type:'message'}>
  return {...base,quote,...(range&&offset>=0?{range:{start:range.start+offset,end:range.start+offset+quote.length}}:{})} as Source
}

/** All boundaries use JS UTF-16 offsets internally; the model never supplies offsets. */
function sliceFragments(parts: readonly Fragment[], start: number, end: number): Fragment[] {
  const output: Fragment[] = []
  let offset = 0
  for (const part of parts) {
    const lo = Math.max(start - offset, 0)
    const hi = Math.min(end - offset, part.text.length)
    if (hi > lo) {
      const text = part.text.slice(lo, hi)
      output.push({ text, source: sliceSource(part.source,text,lo) })
    }
    offset += part.text.length
  }
  return output
}

export function amendExactClause(
  parts: readonly Fragment[], beforeQuote: string,
  currentSource: Extract<Source, { type: 'message' }>, currentMessageText: string,
): { text: string; fragments: Fragment[]; sources: Source[] } {
  const previous = joinFragments(parts)
  const afterQuote = currentSource.quote
  if (!beforeQuote.trim() || !afterQuote.trim() || delimiter.test(beforeQuote) || delimiter.test(afterQuote)) {
    fail('GROWTH_AMENDMENT_NOT_A_CLAUSE')
  }
  const position = previous.indexOf(beforeQuote)
  if (position < 0 || previous.indexOf(beforeQuote, position + 1) >= 0) {
    fail('GROWTH_AMENDMENT_AMBIGUOUS')
  }
  const end = position + beforeQuote.length
  if ((position > 0 && !delimiter.test(previous[position - 1]!)) ||
      (end < previous.length && !delimiter.test(previous[end]!))) {
    fail('GROWTH_AMENDMENT_NOT_A_CLAUSE')
  }
  // A quoted substring is not enough to establish user intent. The caller must
  // verify a direct correction and matching subject/field before calling this.
  if (!currentMessageText.includes(afterQuote) || !currentSource.id) fail('GROWTH_SOURCE_INVALID')
  if (beforeQuote === afterQuote) fail('GROWTH_UNCHANGED')
  const fragments = [
    ...sliceFragments(parts, 0, position),
    { text: afterQuote, source: { ...currentSource } },
    ...sliceFragments(parts, end, previous.length),
  ]
  const text = joinFragments(fragments)
  // Standalone punctuation is preserved for reconstruction, but is never a
  // privacy suppression token or an independent personal-fact source.
  const sources = fragments.filter(part => carriesPersonalText(part.text)).map(part => part.source)
  return { text, fragments, sources }
}
