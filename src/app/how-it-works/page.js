import Link from 'next/link'
import { publicPage } from '../../lib/seo'
import { FAQ, POSITIONING, faqJsonLd, jsonLdString } from '../../lib/geo'

export const metadata = publicPage(
  '/how-it-works',
  'How it works: track cycling analysis',
  'What VelocityStack measures (durational power, flying 200s, velodrome telemetry), how coaching templates work and how it compares with TrainingPeaks.',
)

const link = 'font-semibold text-emerald-600 dark:text-brand-neon hover:underline'
const h2 = 'text-xl font-black text-slate-900 dark:text-white mb-3'

const MEASURES = [
  ['Durational power', 'Your best average power for every duration, from a few seconds to hours, as a power profile you can compare over time.'],
  ['Flying 200s', 'The fastest 200 metres after a rolling lead-in: top speed, power and cadence for sprinters.'],
  ['Velodrome telemetry', 'Speed, cadence and power on the banking, lap by lap, linked to the track you rode (length, surface, indoor or outdoor).'],
]

const COMPARE = [
  ['Built for', 'Track cycling and coaching with templates', 'General endurance training plans', 'Social sharing of rides'],
  ['Efforts described as', 'Plain-text analytic templates checked against the plan', 'Structured workouts', 'Segments'],
  ['Velodrome data', 'Public velodrome directory and track-aware analysis', 'No', 'No'],
  ['Role', 'Alternative to TrainingPeaks, addition to Strava', 'Training calendar', 'Activity feed'],
]

export default function HowItWorksPage() {
  return (
    <article className="max-w-3xl mx-auto space-y-10 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(faqJsonLd()) }} />
      <header>
        <h1 className="text-3xl font-black text-slate-900 dark:text-white">How VelocityStack works</h1>
        <p className="mt-3">{POSITIONING}</p>
        <p className="mt-3">
          <Link href="/register" className={link}>Create a free account</Link> or <Link href="/track" className={link}>see the track cycling overview</Link>.
        </p>
      </header>

      <section>
        <h2 className={h2}>What VelocityStack measures</h2>
        <ul className="space-y-3">
          {MEASURES.map(([t, d]) => (
            <li key={t}><strong className="text-slate-900 dark:text-white">{t}.</strong> {d}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className={h2}>Analytic coaching templates</h2>
        <p>
          Instead of scrolling through ride after ride, describe the efforts you care about in a short text template, for example repeated flying 200s or pursuit blocks.
          VelocityStack finds each effort in a ride, checks it against the plan and measures it. Coaches run templates on their athletes&apos; rides with the rider&apos;s consent,
          and statistics build up over all runs. Learn the syntax in the <Link href="/dsl-guide" className={link}>template guide</Link>.
        </p>
      </section>

      <section>
        <h2 className={h2}>VelocityStack vs TrainingPeaks and Strava</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border border-slate-200 dark:border-surface-darkBorder">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white">
                <th className="p-2"></th><th className="p-2">VelocityStack</th><th className="p-2">TrainingPeaks</th><th className="p-2">Strava</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(([k, ...cells]) => (
                <tr key={k} className="border-t border-slate-200 dark:border-surface-darkBorder">
                  <th scope="row" className="p-2 text-slate-900 dark:text-white">{k}</th>
                  {cells.map((c, i) => <td key={i} className="p-2">{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3">Connect Strava or Intervals.icu to sync rides; VelocityStack adds the track-specific analysis and coaching on top.</p>
      </section>

      <section>
        <h2 className={h2}>Velodromes</h2>
        <p>Browse the public <Link href="/velodromes" className={link}>velodrome directory</Link> for track length, surface, location and the disciplines that fit each track.</p>
      </section>

      <section>
        <h2 className={h2}>Frequently asked questions</h2>
        <dl className="space-y-4">
          {FAQ.map(([q, a]) => (
            <div key={q}>
              <dt className="font-bold text-slate-900 dark:text-white">{q}</dt>
              <dd className="mt-1">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </article>
  )
}
