import Image from 'next/image'
import Icon from '../../components/Icon'
import CarryLink from '../../components/CarryLink'
import { publicPage } from '../../lib/seo'
import { TRACK_PATH, TRACK_DESCRIPTION, trackJsonLd, jsonLdString } from '../../lib/trackLanding'

export const metadata = publicPage(TRACK_PATH, 'Track Cycling Analysis App: Gear & Templates', TRACK_DESCRIPTION)

const card = 'glass-dense rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white/60 dark:bg-surface-darkCard/40 p-5'
const h2 = 'text-2xl sm:text-3xl font-black text-slate-900 dark:text-white'
const muted = 'text-sm sm:text-base leading-relaxed text-slate-600 dark:text-slate-300'
const btnPrimary = 'inline-flex items-center justify-center px-6 py-3 rounded-xl bg-emerald-500 dark:bg-brand-neon text-slate-950 font-bold text-base hover:opacity-90'
const btnSecondary = 'inline-flex items-center justify-center px-6 py-3 rounded-xl border border-slate-300 dark:border-surface-darkBorder font-bold text-base text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5'

function Shot({ src, alt, width, height, priority = false }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-slate-900 shadow-xl shadow-slate-900/10 dark:shadow-black/40">
      <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 border-b border-white/10" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
      </div>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes="(min-width: 1024px) 480px, (min-width: 640px) 70vw, 100vw"
        loading={priority ? undefined : 'lazy'}
        className="block w-full h-auto"
      />
    </figure>
  )
}

const split = 'grid gap-8 lg:grid-cols-2 lg:items-center'

const STEPS = [
  ['upload', 'Upload or import a ride', 'Upload FIT files or connect Intervals.icu, Strava or Wahoo and rides sync in.'],
  ['gears', 'Tag gear and race', 'Record the chainring and cog you rode, and mark the ride as a race.'],
  ['clipboard', 'Run a template', 'Run a template on the ride and compare every rep to your reference.'],
]

const TEMPLATE_POINTS = [
  ['Previous run', 'Compare each rep to the last time you did the session.'],
  ['Personal best', 'Measure every rep against your best run of that template.'],
  ['Median of last 5', 'Use the median of your five most recent earlier runs.'],
  ['Custom pick', 'Choose any past run as the reference.'],
]

const FAQ = [
  ['Who can see my rides?', 'You decide. Rides can be shared with other riders, and a privacy zone around home masks the map for everyone but you. Your raw GPS file and connection keys are never shared.'],
  ['How does coach approval work?', 'A coaching relationship only starts when the rider accepts the invite (or asks for a coach themselves). A rider has one active coach at a time and can end coaching whenever they like; access stops immediately.'],
  ['Which files and integrations are supported?', 'You can upload FIT files (including bulk import, with a help page for SRM PowerControl files). Rides also sync from Intervals.icu, Strava and Wahoo once you connect them.'],
  ['Are Fitness, Fatigue and Form exact?', 'No. When a ride has no power data the load is estimated from heart rate, and the app labels it as an estimate.'],
  ['Does gear apply to road rides?', 'No. Gear tracking and gear records apply to track rides only.'],
]

export default function TrackLandingPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-16 sm:space-y-24">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(trackJsonLd()) }} />

      {/* 1. Hero */}
      <header className="relative isolate overflow-hidden rounded-3xl text-center">
        <Image
          src="/login-bg.jpg"
          alt="Velocity Stack track cycling background" aria-hidden="true"
          fill
          priority
          sizes="(min-width: 1024px) 1024px, 100vw"
          className="absolute inset-0 -z-20 object-cover object-[50%_35%]"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-slate-950/70 via-slate-950/60 to-slate-950/85" aria-hidden="true" />
        <div className="px-5 py-14 sm:px-12 sm:py-24 space-y-6 text-white">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">
            <Icon name="velodrome" /> For track riders and coaches
          </p>
          <h1 className="text-4xl sm:text-6xl font-black leading-tight">
            Track Cycling Analysis App
          </h1>
          <p className="max-w-2xl mx-auto text-lg sm:text-xl text-slate-100">
            Built for track cycling: know what gear you really rode, and analyse every interval.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <CarryLink href="/register" className={btnPrimary}>Sign up</CarryLink>
            <CarryLink href="/login" className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-white/60 font-bold text-base text-white hover:bg-white/10">Sign in with Google</CarryLink>
          </div>
          <p className="text-sm text-slate-200">A free account is required. It powers your personalised analysis.</p>
        </div>
      </header>

      {/* 2. Gear Architect */}
      <section aria-labelledby="gear" className="space-y-6">
        <div className={split}>
          <div className="space-y-4">
            <h2 id="gear" className={h2}><Icon name="gears" /> Gear Architect for Track</h2>
            <p className={muted}>
              Fixed gear means gear matters. Record the chainring and cog on every ride, so your history shows what you
              really rode, not what you meant to ride.
            </p>
          </div>
          <Shot src="/landing/gear-architect.webp" width={1200} height={1235} alt="Gear Architect calculator showing a 60x16 gear with gear inches, ratio, speed at cadence and a table of similar gears" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={card}>
            <div className="font-mono text-2xl font-black text-emerald-600 dark:text-brand-neon">chainring &times; cog</div>
            <h3 className="mt-2 font-bold text-slate-900 dark:text-white">Gear per ride</h3>
            <p className={muted}>Set the gear on each ride, with sensible defaults for the next one.</p>
          </div>
          <div className={card}>
            <h3 className="font-bold text-slate-900 dark:text-white"><Icon name="flag" /> Race rides per gear</h3>
            <p className={muted}>See which gears you raced in. Gear applies to track rides only, so a road race never counts as a gear record.</p>
          </div>
        </div>
        <div className={split}>
          <Shot src="/landing/pb-vault.webp" width={1200} height={1115} alt="PB Vault chart and table of 3000m individual pursuit personal bests with date, time, speed, track and gear" />
          <div className="space-y-3">
            <h3 className="text-xl font-black text-slate-900 dark:text-white"><Icon name="trophy" /> Your PB Vault</h3>
            <p className={muted}>Every personal best by discipline, charted over time with the track and gear you rode.</p>
          </div>
        </div>
        <p><CarryLink href="/gears" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">Try the Gear Architect calculator &rarr;</CarryLink></p>
        <p className={muted}>Racing a pursuit? The <CarryLink href="/pursuit" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">Pursuit Strategist</CarryLink> turns a target time into lap-by-lap splits. Both calculators work without an account; a free account unlocks your saved gear, home track and records.</p>
      </section>

      {/* 3. Analysis templates */}
      <section aria-labelledby="templates" className="space-y-6">
        <div className={split}>
          <div className="space-y-4">
            <h2 id="templates" className={h2}><Icon name="clipboard" /> Compare Reps to Your PB</h2>
            <p className={muted}>
              Describe a session once as a template, run it on a ride and see every rep found and measured. Choose what each
              rep is compared to:
            </p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {TEMPLATE_POINTS.map(([t, d]) => (
                <li key={t} className={card}>
                  <h3 className="font-bold text-slate-900 dark:text-white">{t}</h3>
                  <p className={muted}>{d}</p>
                </li>
              ))}
            </ul>
          </div>
          <Shot src="/landing/template-analysis.webp" width={1200} height={1235} alt="Template rep analysis with fade curve, per-rep times compared to a reference run and consistency score" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className={card}>
            <h3 className="font-bold text-slate-900 dark:text-white"><Icon name="target" /> Headline metric</h3>
            <p className={muted}>Chosen for the template type: average power for intervals, time for time trials and sprints.</p>
          </div>
          <div className={card}>
            <h3 className="font-bold text-slate-900 dark:text-white"><Icon name="trend" /> Spot Fade &amp; HR Recovery</h3>
            <p className={muted}>First vs second half, worst rep, slope and consistency, plus HR recovery between reps and flags on reps that stand out.</p>
          </div>
          <div className={card}>
            <h3 className="font-bold text-slate-900 dark:text-white"><Icon name="chart" /> Trend chart</h3>
            <p className={muted}>Watch the template&apos;s results build up over all your runs.</p>
          </div>
        </div>
        <h3 className="text-xl font-black text-slate-900 dark:text-white">Run Templates on 50 Rides</h3>
        <p className={muted}>Run one template across up to 50 rides in one go, so a whole block of training is analysed the same way.</p>
      </section>

      {/* Analysis */}
      <section aria-labelledby="analysis" className="space-y-6">
        <div className={split}>
          <Shot src="/landing/activity-graph.webp" width={1200} height={1235} alt="Activity graph of speed, heart rate, power, cadence and torque, above durational curves compared to an all-time best" />
          <div className="space-y-4">
            <h2 id="analysis" className={h2}><Icon name="chart" /> See the whole ride</h2>
            <p className={muted}>Speed, heart rate, power, cadence and torque on one zoomable graph, with durational curves that compare the ride against your best.</p>
          </div>
        </div>
      </section>

      {/* Velodromes */}
      <section aria-labelledby="velodromes" className="space-y-6">
        <div className="space-y-3">
          <h2 id="velodromes" className={h2}><Icon name="velodrome" /> Velodromes directory</h2>
          <p className={muted}>A worldwide map of banked tracks with length, surface, type and altitude.</p>
        </div>
        <Shot src="/landing/velodromes-map.webp" width={1200} height={579} alt="Dark world map with pins marking velodromes around the globe" />
      </section>

      {/* 4. Race tagging */}
      <section aria-labelledby="race" className="space-y-4">
        <h2 id="race" className={h2}><Icon name="flag" /> Race tagging</h2>
        <p className={muted}>
          Tag a ride as a race yourself, or link it to a race in your calendar and it is tagged for you. Race badges show up in
          the activity feed and the calendar, so racing and training stay apart in your records.
        </p>
      </section>

      {/* 5. Coaching */}
      <section aria-labelledby="coach" className="space-y-6">
        <h2 id="coach" className={h2}><Icon name="users" /> Coach Riders With Consent</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={card}>
            <h3 className="font-bold text-slate-900 dark:text-white">Only with the rider&apos;s approval</h3>
            <p className={muted}>
              A coach sees a rider&apos;s activities, templates, fitness and calendar only after the rider accepts. The rider can
              revoke access at any time.
            </p>
          </div>
          <div className={card}>
            <h3 className="font-bold text-slate-900 dark:text-white"><Icon name="calendar" /> Planned workouts link to rides</h3>
            <p className={muted}>Planned workouts on the calendar are linked to the ride that completes them.</p>
          </div>
        </div>
        <div className={card}>
          <h3 className="font-bold text-slate-900 dark:text-white">Fitness, Fatigue and Form</h3>
          <p className={muted}>Training load over time, from power where available and otherwise estimated from heart rate. Estimates are labelled as estimates.</p>
        </div>
      </section>

      {/* 6. How it works */}
      <section aria-labelledby="how" className="space-y-6">
        <h2 id="how" className={h2}>How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map(([icon, t, d], i) => (
            <li key={t} className={card}>
              <div className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-brand-neon">Step {i + 1}</div>
              <h3 className="mt-1 font-bold text-slate-900 dark:text-white"><Icon name={icon} /> {t}</h3>
              <p className={muted}>{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 7. FAQ */}
      <section aria-labelledby="faq" className="space-y-4">
        <h2 id="faq" className={h2}>FAQ</h2>
        <div className="space-y-3">
          {FAQ.map(([q, a]) => (
            <details key={q} className={card}>
              <summary className="cursor-pointer font-bold text-slate-900 dark:text-white">{q}</summary>
              <p className={`mt-2 ${muted}`}>{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 8. Final CTA */}
      <section className="relative isolate overflow-hidden rounded-3xl text-center">
        <Image
          src="/login-bg.jpg"
          alt="Velocity Stack track cycling background" aria-hidden="true"
          fill
          loading="lazy"
          sizes="(min-width: 1024px) 1024px, 100vw"
          className="absolute inset-0 -z-20 object-cover object-[50%_60%]"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-slate-950/70 to-slate-950/80" aria-hidden="true" />
        <div className="px-5 py-14 sm:py-20 space-y-5 text-white">
          <h2 className="text-2xl sm:text-3xl font-black">Know your gear. Analyse every interval.</h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <CarryLink href="/register" className={btnPrimary}>Sign up</CarryLink>
            <CarryLink href="/login" className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-white/60 font-bold text-base text-white hover:bg-white/10">Sign in with Google</CarryLink>
          </div>
        </div>
      </section>
      <div className="pb-8" />
    </div>
  )
}
