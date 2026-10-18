// Minimal, safe markdown for news and onboarding copy: paragraphs, "-" lists, ``` code blocks, "##"/"###" headings,
// **bold**, `code` and [links](/path or https://...). Returns data (never HTML), rendered by components/MarkdownBlocks.

const INLINE_RE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g
const SAFE_HREF = /^(\/(?!\/)[\w\-./?#=&%]*|https:\/\/[^\s<>"']+)$/

export function parseInline(text) {
  const out = []
  let last = 0
  let m
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ type: 'strong', text: m[1] })
    else if (m[2] !== undefined) out.push({ type: 'code', text: m[2] })
    else if (SAFE_HREF.test(m[4])) out.push({ type: 'link', text: m[3], href: m[4], external: m[4].startsWith('https://') })
    else out.push({ type: 'text', text: m[3] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

export function parseMarkdown(src) {
  const blocks = []
  let list = null
  let para = []
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', inline: parseInline(para.join(' ')) })
    para = []
  }
  let fence = null
  for (const line of String(src ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const t = line.trim()
    if (t.startsWith('```')) {
      if (fence) {
        blocks.push({ type: 'pre', text: fence.join('\n') })
        fence = null
      } else {
        flushPara()
        list = null
        fence = []
      }
      continue
    }
    if (fence) {
      fence.push(line)
      continue
    }
    const li = /^[-*]\s+(.*)$/.exec(t)
    const h = /^(#{2,3})\s+(.*)$/.exec(t)
    if (!t) {
      flushPara()
      list = null
    } else if (h) {
      flushPara()
      list = null
      blocks.push({ type: 'h', level: h[1].length, inline: parseInline(h[2]) })
    } else if (li) {
      flushPara()
      if (!list) {
        list = { type: 'ul', items: [] }
        blocks.push(list)
      }
      list.items.push(parseInline(li[1]))
    } else {
      list = null
      para.push(t)
    }
  }
  if (fence) blocks.push({ type: 'pre', text: fence.join('\n') })
  flushPara()
  return blocks
}
