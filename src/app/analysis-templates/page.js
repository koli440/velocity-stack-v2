import Link from 'next/link'
import Icon from '../../components/Icon'
import CarryLink from '../../components/CarryLink'
import { publicPage } from '../../lib/seo'
import { jsonLdString } from '../../lib/geo'
import { TEMPLATES_PATH, TEMPLATES_TITLE, TEMPLATES_DESCRIPTION, templatesJsonLd, galleryTemplates } from '../../lib/publicPages'

export const metadata = publicPage(TEMPLATES_PATH, TEMPLATES_TITLE, TEMPLATES_DESCRIPTION)

const card = 'glass-dense rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white/60 dark:bg-surface-darkCard/40 p-5'
const h2 = 'text-2xl font-black text-slate-900 dark:text-white'
const link = 'font-semibold text-emerald-600 dark:text-brand-neon hover:underline'
const btnPrimary = 'inline-flex items-center justify-center px-6 py-3 rounded-xl bg-emerald-500 dark:bg-brand-neon text-slate-950 font-bold text-base hover:opacity-90'
const btnSecondary = 'inline-flex items-center justify-center px-6 py-3 rounded-xl border border-slate-300 dark:border-surface-darkBorder font-bold text-base text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5'

const BANDS = [
  ['Power', '%FTP, watts, W/kg, %LT1/%LT2 or zones Z1-Z6'],
  ['Heart rate and cadence', 'bpm, %HRmax, %LT1HR/%LT2HR, rpm'],
  ['Speed', 'km/h, or "best speed" over a distance'],
  ['Time or distance', 'steps sized by minutes or by metres, e.g. 4km or 200m'],
]

export default function AnalysisTemplatesPage() {
  const templates = galleryTemplates()
  return (
    <article className="max-w-5xl mx-auto space-y-14 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(templatesJsonLd()) }} />

      <header className="space-y-4 text-center py-8 sm:py-12">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-brand-neon">
          <Icon name="clipboard" /> Analysis templates
        </p>
        <h1 className="text-4xl sm:text-5xl font-black leading-tight text-slate-900 dark:text-white">Cycling analysis templates</h1>
        <p className="max-w-2xl mx-auto text-base sm:text-lg">
          Describe a session once in a few plain lines. VelocityStack finds every rep in a ride, checks it against the plan and measures it. Templates are{' '}
          <strong className="text-slate-900 dark:text-white">free</strong> to use and write.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <CarryLink href="/register" className={btnPrimary}>Create a free account</CarryLink>
          <Link href="/dsl-guide" className={btnSecondary}>Read the syntax guide</Link>
        </div>
      </header>

      <section aria-labelledby="gallery" className="space-y-5">
        <h2 id="gallery" className={h2}>Example templates</h2>
        <p>These ship with VelocityStack as system templates, available to every account. Use one as a starting point in the Template Creator and adjust it to your session.</p>
        <ul className="grid gap-4 md:grid-cols-2">
          {templates.map((t) => (
            <li key={t.slug} className={`${card} space-y-3`}>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white">{t.name}</h3>
                <p>{t.description}</p>
              </div>
              <pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs font-mono leading-relaxed text-emerald-300"><code>{t.dsl}</code></pre>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="syntax" className="space-y-4">
        <h2 id="syntax" className={h2}>How the syntax works</h2>
        <p>
          The first line is the repeat count (<span className="font-mono">4x</span>). Each <span className="font-mono">work</span> or <span className="font-mono">recovery</span> line has a size, an optional tolerance and a band after the <span className="font-mono">@</span>.
          Use <span className="font-mono">best</span> to find your best window of that size. Bands can use:
        </p>
        <ul className="grid gap-4 sm:grid-cols-2">
          {BANDS.map(([t, d]) => (
            <li key={t} className={card}>
              <h3 className="font-bold text-slate-900 dark:text-white">{t}</h3>
              <p>{d}</p>
            </li>
          ))}
        </ul>
        <p>
          Lactate-threshold, power-to-weight and zone bands use the values that were valid on the day of the ride. Full reference with more examples in the{' '}
          <Link href="/dsl-guide" className={link}>template syntax guide</Link>.
        </p>
      </section>

      <section aria-labelledby="use" className="space-y-3">
        <h2 id="use" className={h2}>Run them on your rides</h2>
        <p>
          Sign in, open a ride and run a template, or run one across up to 50 rides at once. Coaches run templates on their athletes&apos; rides with the rider&apos;s consent, see{' '}
          <Link href="/coaching" className={link}>coaching</Link>. New to VelocityStack? Read <Link href="/how-it-works" className={link}>how it works</Link> or the{' '}
          <Link href="/track" className={link}>track cycling overview</Link>. Everything is free for now.
        </p>
      </section>

      <section className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center space-y-4">
        <h2 className="text-2xl font-black text-slate-900 dark:text-white">Run your first template</h2>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <CarryLink href="/register" className={btnPrimary}>Create a free account</CarryLink>
        </div>
      </section>
    </article>
  )
}
