import Link from 'next/link'
import Icon from '../../components/Icon'
import CarryLink from '../../components/CarryLink'
import { publicPage } from '../../lib/seo'
import { jsonLdString } from '../../lib/geo'
import { COACHING_PATH, COACHING_TITLE, COACHING_DESCRIPTION, coachingJsonLd } from '../../lib/publicPages'

export const metadata = publicPage(COACHING_PATH, COACHING_TITLE, COACHING_DESCRIPTION)

const card = 'glass-dense rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white/60 dark:bg-surface-darkCard/40 p-5'
const h2 = 'text-2xl font-black text-slate-900 dark:text-white'
const h3 = 'font-bold text-slate-900 dark:text-white'
const link = 'font-semibold text-emerald-600 dark:text-brand-neon hover:underline'
const btnPrimary = 'inline-flex items-center justify-center px-6 py-3 rounded-xl bg-emerald-500 dark:bg-brand-neon text-slate-950 font-bold text-base hover:opacity-90'
const btnSecondary = 'inline-flex items-center justify-center px-6 py-3 rounded-xl border border-slate-300 dark:border-surface-darkBorder font-bold text-base text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5'

const CAN_DO = [
  ['chart', 'See the whole picture', 'An athlete\u2019s activities (including private ones), power and other curves, templates, Personal Bests, fitness and calendar. Privacy-zone areas stay masked on maps.'],
  ['clipboard', 'Run analytic templates', 'Run your own or system templates on the athlete\u2019s rides. The rider sees the result and the template name, not the code behind it.'],
  ['calendar', 'Plan their training', 'Add planned workouts, races and notes to the athlete\u2019s calendar, and push workouts to their Intervals.icu calendar when they have connected it.'],
  ['settings', 'Keep their settings current', 'Edit the athlete\u2019s FTP, weight, lactate thresholds, power zones and training defaults. Derived values follow.'],
  ['trend', 'Follow Fitness, Fatigue and Form', 'Training load over time, from power where available and otherwise estimated from heart rate. Estimates are labelled as estimates.'],
  ['chat', 'Talk and comment', 'Comment on rides and message the athlete in the app.'],
]

const PRIVACY = [
  ['The rider decides', 'A coaching relationship only starts when the rider accepts. Either side can send the invite; accepting (or asking for a coach yourself) is the consent.'],
  ['One active coach', 'A rider has at most one active coach at a time.'],
  ['Revoke any time', 'The rider can end coaching whenever they like and access stops immediately. The coach can also leave.'],
  ['Never shared', 'Connection keys, email addresses and raw GPS files are never visible to a coach.'],
  ['Everything is labelled', 'Coach edits show a \u201cset by coach\u201d badge and the rider is notified.'],
]

const STEPS = [
  ['Create a free account', 'Any account can coach or be coached. There is no separate coach sign-up.'],
  ['Send or accept an invite', 'A coach invites a rider as their athlete, or a rider asks someone to be their coach. Requests land in Settings \u2192 Coaching and in notifications.'],
  ['The rider accepts', 'Accepting is the consent. From then on the coach finds the athlete on their Coach dashboard.'],
]

export default function CoachingPage() {
  return (
    <article className="max-w-5xl mx-auto space-y-14 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(coachingJsonLd()) }} />

      <header className="space-y-4 text-center py-8 sm:py-12">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-brand-neon">
          <Icon name="helmet" /> Coaching on VelocityStack
        </p>
        <h1 className="text-4xl sm:text-5xl font-black leading-tight text-slate-900 dark:text-white">Coach track cyclists, with their consent</h1>
        <p className="max-w-2xl mx-auto text-base sm:text-lg">
          See what your athletes really did, check every effort against the plan with analytic templates, and plan what comes next. Coaching is{' '}
          <strong className="text-slate-900 dark:text-white">free for riders and coaches</strong> for now.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <CarryLink href="/register" className={btnPrimary}>Create a free account</CarryLink>
          <CarryLink href="/login" className={btnSecondary}>Sign in</CarryLink>
        </div>
      </header>

      <section aria-labelledby="can-do" className="space-y-5">
        <h2 id="can-do" className={h2}><Icon name="users" /> What coaches can do</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAN_DO.map(([icon, t, d]) => (
            <li key={t} className={card}>
              <h3 className={h3}><Icon name={icon} /> {t}</h3>
              <p className="mt-1">{d}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="templates" className="space-y-4">
        <h2 id="templates" className={h2}><Icon name="clipboard" /> Analytic templates for coaching</h2>
        <p>
          Instead of scrolling through ride after ride, describe the session in a few plain lines. VelocityStack finds each effort in the ride, checks it against the plan and
          measures it. Statistics build up over all runs, so you can compare any run with the previous one, a personal best or the median of the last five.
        </p>
        <pre className="overflow-x-auto rounded-2xl bg-slate-900 p-4 text-sm font-mono leading-relaxed text-emerald-300"><code>{`4x
work 3min ±30% @ 90-110%FTP
recovery 2min ±50% @ <55%FTP`}</code></pre>
        <p>
          <Link href="/analysis-templates" className={link}>Browse example templates &rarr;</Link>{' '}
          <Link href="/dsl-guide" className={link}>Read the syntax guide &rarr;</Link>
        </p>
      </section>

      <section aria-labelledby="privacy" className="space-y-5">
        <h2 id="privacy" className={h2}><Icon name="lock" /> Privacy model</h2>
        <p>Coaching is built on the rider&apos;s consent. A coach can read everything about the athlete, so the rider stays in control of the relationship.</p>
        <dl className="grid gap-4 sm:grid-cols-2">
          {PRIVACY.map(([t, d]) => (
            <div key={t} className={card}>
              <dt className={h3}>{t}</dt>
              <dd className="mt-1">{d}</dd>
            </div>
          ))}
        </dl>
        <p>
          More in <Link href="/about" className={link}>About</Link> and the <Link href="/privacy" className={link}>privacy policy</Link>.
        </p>
      </section>

      <section aria-labelledby="connect" className="space-y-5">
        <h2 id="connect" className={h2}>How a coach and rider connect</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map(([t, d], i) => (
            <li key={t} className={card}>
              <div className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-brand-neon">Step {i + 1}</div>
              <h3 className={`mt-1 ${h3}`}>{t}</h3>
              <p className="mt-1">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="free" className="space-y-3">
        <h2 id="free" className={h2}>Free for riders and coaches</h2>
        <p>
          Everything on VelocityStack, including coaching, is free for now. See{' '}
          <Link href="/how-it-works" className={link}>how it works</Link>, the <Link href="/track" className={link}>track cycling overview</Link> or the{' '}
          <Link href="/velodromes" className={link}>velodromes directory</Link>.
        </p>
      </section>

      <section className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center space-y-4">
        <h2 className="text-2xl font-black text-slate-900 dark:text-white">Start coaching today</h2>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <CarryLink href="/register" className={btnPrimary}>Create a free account</CarryLink>
        </div>
      </section>
    </article>
  )
}
