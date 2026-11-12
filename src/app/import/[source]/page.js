import Link from 'next/link'
import ImportCtaRow, { ImportViewTracker } from '../../../components/ImportCtaRow'
import { publicPage, SITE_NAME } from '../../../lib/seo'
import { jsonLdString } from '../../../lib/trackLanding'
import {
  IMPORT_GUIDES,
  IMPORT_PATH,
  guideBySlug,
  guideTitle,
  guideDescription,
  importGuidePath,
  faqJsonLd,
  howToJsonLd,
  breadcrumbJsonLd,
} from '../../../lib/importGuides'
import { notFound } from 'next/navigation'

export const dynamicParams = false
export const generateStaticParams = () => IMPORT_GUIDES.map((g) => ({ source: g.slug }))

export function generateMetadata({ params }) {
  const g = guideBySlug(params.source)
  if (!g) return {}
  return publicPage(importGuidePath(g.slug), guideTitle(g), guideDescription(g))
}

const card = 'glass-dense rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-5'
const h2 = 'text-xl font-black text-slate-900 dark:text-white mb-3'
const link = 'font-semibold text-emerald-600 dark:text-brand-neon hover:underline'

export default function ImportGuidePage({ params }) {
  const g = guideBySlug(params.source)
  if (!g) notFound()
  const ld = [breadcrumbJsonLd(g), howToJsonLd(g), faqJsonLd(g.faq)]
  return (
    <article className="max-w-3xl mx-auto space-y-8 text-sm sm:text-base leading-relaxed text-slate-600 dark:text-slate-300">
      {ld.map((o, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(o) }} />
      ))}
      <ImportViewTracker slug={g.slug} />

      <header className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-brand-neon">
          <Link href={IMPORT_PATH} className="hover:underline">Import</Link> / {g.name}
        </p>
        <h1 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white">{g.heading}</h1>
        <p>{g.intro}</p>
        <ImportCtaRow slug={g.slug} placement="hero" />
      </header>

      {g.sections.map((s) => (
        <section key={s.id} id={s.id} className={card}>
          <h2 className={h2}>{s.title}</h2>
          <ol className="list-decimal pl-5 space-y-2">
            {s.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {s.note && (
            <p className="mt-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">{s.note}</p>
          )}
        </section>
      ))}

      <section className={card}>
        <h2 className={h2}>What happens next</h2>
        <p>
          Once your rides are in, open your feed to see them, your power profile and your Fitness, Fatigue and Form.
          {g.slug === 'fit' && (
            <> Using an SRM? See the <Link className={link} href="/import-help">SRM PC8 guide</Link>.</>
          )}
        </p>
      </section>

      <section aria-labelledby="faq-title">
        <h2 id="faq-title" className={h2}>Frequently asked questions</h2>
        <div className="space-y-3">
          {g.faq.map(([q, a]) => (
            <details key={q} className={card}>
              <summary className="cursor-pointer font-bold text-slate-900 dark:text-white">{q}</summary>
              <p className="mt-2">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={`${card} space-y-3`}>
        <h2 className="text-xl font-black text-slate-900 dark:text-white">Ready to see your rides in {SITE_NAME}?</h2>
        <ImportCtaRow slug={g.slug} placement="footer" />
        <p className="text-xs">
          Other guides:{' '}
          {g.related.map((slug, i) => (
            <span key={slug}>
              {i > 0 && ' · '}
              <Link className={link} href={importGuidePath(slug)}>{guideBySlug(slug).name}</Link>
            </span>
          ))}
        </p>
      </section>
    </article>
  )
}
