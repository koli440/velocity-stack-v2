import Link from 'next/link'
import { parseMarkdown } from '../lib/markdownLite'

function Inline({ nodes, onNavigate }) {
  return nodes.map((n, i) => {
    if (n.type === 'strong') return <strong key={i}>{n.text}</strong>
    if (n.type === 'code') {
      return (
        <code key={i} className="font-mono text-[0.85em] bg-slate-100 dark:bg-slate-800 rounded px-1 py-0.5">
          {n.text}
        </code>
      )
    }
    if (n.type === 'link') {
      return n.external ? (
        <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="underline text-emerald-600 dark:text-brand-neon">
          {n.text}
        </a>
      ) : (
        <Link key={i} href={n.href} onClick={onNavigate} className="underline text-emerald-600 dark:text-brand-neon">
          {n.text}
        </Link>
      )
    }
    return <span key={i}>{n.text}</span>
  })
}

// Renders lib/markdownLite blocks as React elements (no raw HTML is ever injected).
export default function MarkdownBlocks({ source, onNavigate, className = '' }) {
  const blocks = parseMarkdown(source)
  return (
    <div className={`space-y-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300 ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === 'ul') {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {b.items.map((item, j) => (
                <li key={j}>
                  <Inline nodes={item} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          )
        }
        if (b.type === 'pre') {
          return (
            <pre key={i} className="font-mono text-xs bg-slate-100 dark:bg-slate-900 rounded-xl p-3 overflow-x-auto">
              {b.text}
            </pre>
          )
        }
        if (b.type === 'h') {
          return (
            <p key={i} className="font-bold text-slate-900 dark:text-white pt-1">
              <Inline nodes={b.inline} onNavigate={onNavigate} />
            </p>
          )
        }
        return (
          <p key={i}>
            <Inline nodes={b.inline} onNavigate={onNavigate} />
          </p>
        )
      })}
    </div>
  )
}
