import Image from 'next/image'
import Link from 'next/link'
import Icon from '../../components/Icon'
import SupportButton from '../../components/SupportButton'

export const metadata = {
  title: 'About',
  description: 'Precision engineering for the track cycling community: ride analysis, templates, planning and coaching.',
  alternates: { canonical: '/about' },
}

const link = 'font-semibold text-emerald-600 dark:text-brand-neon hover:underline'

const GROUPS = [
  {
    icon: 'refresh',
    title: 'Your rides',
    items: [
      { name: 'Import and sync', text: 'Connect Intervals.icu or Strava and rides sync automatically, or upload FIT files by hand. Duplicates are skipped.', href: '/settings', cta: 'Connect a source' },
      { name: 'Activity analysis', text: 'Power, heart rate and map for every ride, with power, heart rate and other curves, zones and load based on the FTP and weight valid on that day.' },
      { name: 'Comments', text: 'Talk about a ride with the riders who can see it.' },
    ],
  },
  {
    icon: 'clipboard',
    title: 'Templates and records',
    items: [
      { name: 'Templates', text: 'Describe the efforts you care about in plain text, run the template on a ride, and see each effort found, checked against the plan and measured. Statistics build up over all your runs.', href: '/templates', cta: 'Browse templates' },
      { name: 'Template syntax guide', text: 'Repeats, tolerances, hours and nested groups, with examples.', href: '/dsl-guide', cta: 'Read the guide' },
      { name: 'Personal Best Vault', text: 'Lifetime records by distance and discipline across velodromes. Send an effort from a template run straight to the vault.', href: '/pb-vault', cta: 'Open the vault' },
    ],
  },
  {
    icon: 'flask',
    title: 'Track tools',
    items: [
      { name: 'Pursuit Strategist', text: 'Lap-by-lap pacing based on real physics.', href: '/pursuit', cta: 'Plan a pursuit' },
      { name: 'Gear Architect', text: 'Gear inch and development calculations.', href: '/gears', cta: 'Open gears' },
      { name: 'Aero Lab', text: 'Field-test your position and equipment (CdA) without a wind tunnel.', href: '/aero-lab', cta: 'Open Aero Lab' },
      { name: 'Velodromes', text: 'Track details for the velodromes in the database.', href: '/velodromes', cta: 'Browse velodromes' },
    ],
  },
  {
    icon: 'calendar',
    title: 'Plan your training',
    items: [
      { name: 'Calendar', text: 'Rides, planned workouts, races and notes in one place.', href: '/calendar', cta: 'Open the calendar' },
      { name: 'Planned workouts', text: 'Build a workout and see a preview chart. Push it to your Intervals.icu calendar, manually or automatically.' },
      { name: 'Races and notes', text: 'Mark races and keep notes on any day.' },
    ],
  },
  {
    icon: 'users',
    title: 'Riders and privacy',
    items: [
      { name: 'Riders', text: 'Find and follow other riders and see the sessions they share. A rider can require approval for new followers.', href: '/riders', cta: 'Find riders' },
      { name: 'Privacy zone', text: 'Set a zone around home: other riders see rides masked inside it. Your raw GPS file and connection keys are never shared.', href: '/settings', cta: 'Set a zone' },
    ],
  },
  {
    icon: 'bell',
    title: 'Staying up to date',
    items: [
      { name: 'What\u2019s new', text: 'Every notable feature and fix is listed, newest first.', href: '/whats-new', cta: 'See what\u2019s new' },
      { name: 'Getting started', text: 'Reopen the welcome tour any time from Help in the top-right menu.' },
    ],
  },
]

const COACHING = [
  ['You are in control', 'A coaching relationship only starts when the rider accepts. Either side can send the invite; accepting (or asking for a coach yourself) is the consent.'],
  ['One active coach', 'A rider has at most one active coach at a time.'],
  ['Revoke any time', 'The rider can end coaching whenever they like and access stops immediately. The coach can also leave.'],
  ['What a coach sees', 'Everything about the athlete, including private activities, curves, templates and Personal Bests. Privacy-zone areas stay masked on maps, exactly as for other riders. Connection keys, email and raw GPS files are never visible.'],
  ['What a coach can change', 'The athlete\u2019s FTP, weight, lactate thresholds, power zones and training defaults, plus planned workouts, races and notes on their calendar (and pushing workouts to their Intervals.icu).'],
  ['Everything is labelled', 'Coach edits show a \u201cset by coach\u201d badge and the rider is notified. Coaches can also run templates on the athlete\u2019s activities.'],
]

export default function AboutPage() {
  return (
    <section className="max-w-5xl mx-auto space-y-10">
      {/* --- HERO --- */}
      <div>
        <h1 className="text-3xl font-black text-slate-900 dark:text-white">
          <Icon name="book" /> About VelocityStack
        </h1>
        <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
          Precision engineering for the track cycling community.
        </p>
      </div>

      <div className="border-t border-slate-200 dark:border-surface-darkBorder" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
              <Icon name="flag" /> The Mission
            </h2>
            <p>
              <strong className="text-slate-900 dark:text-white">VelocityStack</strong> was born
              on the infield. We saw a gap between high-end professional wind-tunnel testing and
              the everyday needs of track cyclists, pursuiters, and sprinters.
            </p>
            <p className="mt-3">
              Our mission is to bring <strong className="text-slate-900 dark:text-white">World-Tour
              level analytics</strong> to your pocket. Whether you are adjusting your gear ratio
              for a tactical match sprint or shaving off milliseconds in an Individual Pursuit, we
              provide the data to back your decisions.
            </p>
          </div>
          <p>
            Everything below is live today. Several tools work without any data; the rest come
            alive once your rides are in.
          </p>
        </div>
        <div className="space-y-4">
          <div className="glass-dense overflow-hidden rounded-2xl border border-slate-200 dark:border-surface-darkBorder">
            <Image
              src="/about-photo.jpg"
              alt="Built at the Track."
              width={1200}
              height={800}
              className="w-full h-auto object-cover"
            />
            <p className="px-3 py-2 text-xs text-center text-slate-400 dark:text-slate-500">
              Built at the Track.
            </p>
          </div>

          <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-xs text-sky-700 dark:text-sky-300">
            <p className="font-bold uppercase tracking-wider mb-1">Developer Note</p>
            <p>
              VelocityStack is an independent project. It&apos;s built by a track cyclist, for
              track cyclists. No ads, no bloat — just pure performance data.
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 dark:border-surface-darkBorder" />

      {/* --- WHAT IS HERE --- */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-3">
          <Icon name="settings" /> What is here
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {GROUPS.map((g) => (
            <div key={g.title} className="glass-dense rounded-2xl border border-slate-200 dark:border-surface-darkBorder p-4">
              <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                <Icon name={g.icon} /> {g.title}
              </h3>
              <ul className="space-y-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {g.items.map((it) => (
                  <li key={it.name}>
                    <strong className="text-slate-900 dark:text-white">{it.name}:</strong> {it.text}
                    {it.href && (
                      <>
                        {' '}
                        <Link href={it.href} className={link}>{it.cta} &rarr;</Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* --- COACHING --- */}
      <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-5">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
          <Icon name="helmet" /> Coaching mode
        </h2>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300 mb-4">
          Any account can coach, or be coached. It is built on the rider&apos;s consent.
        </p>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {COACHING.map(([t, d]) => (
            <div key={t}>
              <dt className="font-bold text-slate-900 dark:text-white">{t}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm">
          <Link href="/settings" className={link}>Manage coaching in Settings &rarr;</Link>
        </p>
      </div>

      <div className="border-t border-slate-200 dark:border-surface-darkBorder" />

      {/* --- THE TECHNOLOGY --- */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
          <Icon name="trend" /> Behind the Math
        </h2>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Our calculations aren&apos;t just guesses. We use established aerodynamic models (like
          the <strong className="text-slate-900 dark:text-white">Chung Method</strong> for CdA
          estimation) and atmospheric physics (adjusting for altitude and air pressure) to ensure
          that the numbers you see on your screen reflect reality on the boards.
        </p>
      </div>

      {/* --- CALL TO ACTION --- */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
          <Icon name="heart" /> Support the Project
        </h2>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          VelocityStack is still in <strong className="text-slate-900 dark:text-white">Alpha</strong>
          and changing quickly: we keep adding velodromes and features (see{' '}
          <Link href="/whats-new" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">what&apos;s new</Link>). If this tool helped you win a race
          or set a new PB, consider{' '}
          <Link href="/feedback" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">
            sharing feedback
          </Link>{' '}
          or{' '}
          <Link href="/report-bug" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">
            reporting a bug
          </Link>{' '}
          to help us keep improving. If you would like to chip in towards development and hosting
          costs, you can buy us a coffee.
        </p>
        <SupportButton className="mt-3" />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <Link href="/terms" className={link}>Terms of Service</Link>
        {' · '}
        <Link href="/privacy" className={link}>Privacy Policy</Link>
      </p>
    </section>
  )
}
