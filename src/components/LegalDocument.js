import Link from 'next/link'
import { Inline } from './MarkdownBlocks'
import { formatLegalDate } from '../lib/legal'

const link = 'underline text-emerald-600 dark:text-brand-neon'

// Server-rendered legal document: title, last-updated date, table of contents and the markdown body.
export default function LegalDocument({ doc }) {
  return (
    <article className="max-w-3xl mx-auto">
      <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">{doc.title}</h1>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Last updated: <time dateTime={doc.updated}>{formatLegalDate(doc.updated)}</time>
      </p>

      <nav aria-label="Table of contents" className="mt-6 rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Contents</p>
        <ol className="list-decimal pl-5 space-y-1 text-sm sm:columns-2 gap-8">
          {doc.toc.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`} className={link}>{t.text.replace(/^\d+\.\s*/, '')}</a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-6 space-y-3 text-sm sm:text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 break-words">
        {doc.blocks.map((b, i) => {
          if (b.type === 'h') {
            const H = b.level === 2 ? 'h2' : 'h3'
            const cls = b.level === 2
              ? 'scroll-mt-20 pt-6 text-lg sm:text-xl font-bold text-slate-900 dark:text-white border-t border-slate-200 dark:border-surface-darkBorder'
              : 'scroll-mt-20 pt-2 font-bold text-slate-900 dark:text-white'
            return <H key={i} id={b.id} className={cls}><Inline nodes={b.inline} /></H>
          }
          if (b.type === 'ul') {
            return (
              <ul key={i} className="list-disc pl-5 space-y-1">
                {b.items.map((item, j) => <li key={j}><Inline nodes={item} /></li>)}
              </ul>
            )
          }
          if (b.type === 'pre') {
            return <pre key={i} className="font-mono text-xs bg-slate-100 dark:bg-slate-900 rounded-xl p-3 overflow-x-auto">{b.text}</pre>
          }
          return <p key={i}><Inline nodes={b.inline} /></p>
        })}
      </div>

      <p className="mt-10 text-xs text-slate-500 dark:text-slate-400">
        <Link href="/privacy" className={link}>Privacy Policy</Link> · <Link href="/terms" className={link}>Terms of Service</Link>
      </p>
    </article>
  )
}
