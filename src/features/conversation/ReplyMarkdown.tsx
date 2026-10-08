import { Fragment, type ReactNode } from 'react'

// Structured reply rendering: companion replies already carry markdown-shaped
// emphasis (bold leads, numbered steps, quotes, citation links). Rendering
// them as plain paragraphs leaked raw ** asterisks into the chat. This
// component parses a safe subset into React elements — bold, italic, code,
// links, ordered/unordered lists, quotes and headings — with layered sizes
// and accent colors. It never touches innerHTML, so reply text stays inert.

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'ul'; items: string[][] }
  | { kind: 'ol'; items: string[][] }

const INLINE_CODE = /`([^`]+)`/
const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g

// Inline spans: links, **bold**, *italic*, `code`. A lone unmatched marker
// stays literal text — nothing is ever dropped.
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let buffer = ''
  let key = 0
  const push = (node: ReactNode) => { nodes.push(<Fragment key={`${keyPrefix}-${key++}`}>{node}</Fragment>) }
  const flush = () => { if (buffer) { push(buffer); buffer = '' } }
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    const code = INLINE_CODE.exec(rest)
    if (code && code.index === 0) { flush(); push(<code className="qa-md-code">{code[1]}</code>); i += code[0].length; continue }
    if (rest.startsWith('**')) {
      const close = text.indexOf('**', i + 2)
      if (close > i + 2) { flush(); const inner = text.slice(i + 2, close); push(<strong>{inline(inner, `${keyPrefix}-b${key}`)}</strong>); i = close + 2; continue }
    }
    if (rest[i] === '*') {
      const close = text.indexOf('*', i + 1)
      if (close > i + 1) { flush(); const inner = text.slice(i + 1, close); push(<em className="qa-md-em">{inline(inner, `${keyPrefix}-i${key}`)}</em>); i = close + 1; continue }
    }
    // Markdown citation links [label](url) — longest-match, url must be http(s).
    LINK.lastIndex = 0
    const link = LINK.exec(rest)
    if (link && link.index === 0) {
      flush()
      push(<a className="qa-md-link" href={link[2]} target="_blank" rel="noreferrer noopener">{link[1]}</a>)
      i += link[0].length
      continue
    }
    buffer += text[i]
    i++
  }
  flush()
  return nodes
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = []
  const lines = source.split('\n')
  let paragraph: string[] | null = null
  let quote: string[] | null = null
  let list: { ordered: boolean; items: string[][] } | null = null
  const closeParagraph = () => { if (paragraph?.length) blocks.push({ kind: 'p', lines: paragraph }); paragraph = null }
  const closeQuote = () => { if (quote?.length) blocks.push({ kind: 'quote', lines: quote }); quote = null }
  const closeList = () => { if (list?.items.length) blocks.push(list.ordered ? { kind: 'ol', items: list.items } : { kind: 'ul', items: list.items }); list = null }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) { closeParagraph(); closeQuote(); closeList(); continue }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) { closeParagraph(); closeQuote(); closeList(); blocks.push({ kind: 'h', level: heading[1]!.length, text: heading[2]! }); continue }
    if (/^>\s?/.test(line)) { closeParagraph(); closeList(); quote = quote ?? []; quote.push(line.replace(/^>\s?/, '')); continue }
    const bullet = /^\s*[-•]\s+(.*)$/.exec(line)
    if (bullet) { closeParagraph(); closeQuote(); if (list && list.ordered) closeList(); list = list ?? { ordered: false, items: [] }; list.items.push([bullet[1]!]); continue }
    const numbered = /^\s*(\d{1,2})[.、)]\s+(.*)$/.exec(line)
    if (numbered) { closeParagraph(); closeQuote(); if (list && !list.ordered) closeList(); list = list ?? { ordered: true, items: [] }; list.items.push([numbered[2]!]); continue }
    if (list) { list.items.at(-1)!.push(line); continue }
    if (quote) { quote.push(line); continue }
    paragraph = paragraph ?? []
    paragraph.push(line)
  }
  closeParagraph(); closeQuote(); closeList()
  return blocks
}

export function ReplyMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return <div className="qa-md">
    {blocks.map((block, index) => {
      const key = `b${index}`
      if (block.kind === 'h') return <p key={key} className={`qa-md-h qa-md-h${block.level}`}>{inline(block.text, key)}</p>
      if (block.kind === 'quote') return <blockquote key={key} className="qa-md-quote">{inline(block.lines.join(' '), key)}</blockquote>
      if (block.kind === 'ul') return <ul key={key} className="qa-md-ul">{block.items.map((item, i) => <li key={i}>{inline(item.join(' '), `${key}-${i}`)}</li>)}</ul>
      if (block.kind === 'ol') return <ol key={key} className="qa-md-ol">{block.items.map((item, i) => <li key={i} className="qa-md-li"><span className="qa-md-num">{i + 1}</span><span>{inline(item.join(' '), `${key}-${i}`)}</span></li>)}</ol>
      // A paragraph that is only a bold lead renders as an emphasized lead
      // line — the layered look the replies actually intend.
      const joined = block.lines.join('\n')
      const boldOnly = block.lines.length === 1 && /^\*\*[^*]+\*\*$/.test(joined.trim())
      if (boldOnly) return <p key={key} className="qa-md-lead">{inline(joined, key)}</p>
      return <p key={key}>{inline(joined.replace(/\n/g, ' '), key)}</p>
    })}
  </div>
}
