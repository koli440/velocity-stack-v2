import Link from 'next/link'
import { loadPartnerDocs } from '../../../lib/server/partnerDocsContent'
import { SITE_URL } from '../../../lib/legal'
import { Inline } from '../../../components/MarkdownBlocks'

const doc = loadPartnerDocs()
const link = 'underline text-emerald-600 dark:text-brand-neon'

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Partner API documentation',
  description: 'OAuth 2.0 and upload API for apps that send rides to Velocity Stack.',
  alternates: { canonical: '/developers/docs' },
  robots: { index: true, follow: true },
}

export default function Page() {
  return (
    <article className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">{doc.title}</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        <a href="/openapi/v1.yaml" className={link}>OpenAPI spec (v1.yaml)</a> · <Link href="/developers" className={link}>Register an app</Link>
      </p>
      <nav aria-label="Table of contents" className="mt-6 rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Contents</p>
        <ul className="list-disc pl-5 space-y-1 text-sm sm:columns-2 gap-8">
          {doc.toc.map((t) => <li key={t.id}><a href={`#${t.id}`} className={link}>{t.text}</a></li>)}
        </ul>
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
          if (b.type === 'ul') return <ul key={i} className="list-disc pl-5 space-y-1">{b.items.map((it, j) => <li key={j}><Inline nodes={it} /></li>)}</ul>
          if (b.type === 'pre') return <pre key={i} className="font-mono text-xs bg-slate-100 dark:bg-slate-900 rounded-xl p-3 overflow-x-auto">{b.text}</pre>
          return <p key={i}><Inline nodes={b.inline} /></p>
        })}
      </div>
    </article>
  )
}
