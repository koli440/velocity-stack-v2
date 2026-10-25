import Link from 'next/link'

const POINTS = [
  ['Power profile', 'Best efforts across every duration, from standing starts to flying 200s.'],
  ['Velodrome telemetry', 'Cadence, speed and power per lap, tied to the track you rode.'],
  ['Templates and planning', 'Write intervals in a simple DSL and plan sessions with your coach.'],
]

// Server-rendered so it is present in the initial HTML.
export default function Landing() {
  return (
    <section className="max-w-3xl mx-auto py-16 sm:py-24 text-center space-y-6">
      <h1 className="text-3xl sm:text-5xl font-extrabold text-slate-900 dark:text-white">
        Velodrome telemetry for track cyclists
      </h1>
      <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300">
        VelocityStack turns your rides into pure speed, cadence and power analysis by duration, so you can see what
        changes on the track and train smarter.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/login" className="px-5 py-2.5 rounded-xl bg-emerald-500 dark:bg-brand-neon text-slate-950 font-bold">
          Log in
        </Link>
        <Link
          href="/register"
          className="px-5 py-2.5 rounded-xl border border-slate-300 dark:border-surface-darkBorder font-bold text-slate-800 dark:text-slate-100"
        >
          Register
        </Link>
      </div>
      <ul className="grid gap-4 sm:grid-cols-3 text-left pt-6">
        {POINTS.map(([title, text]) => (
          <li key={title} className="rounded-2xl border border-slate-200 dark:border-surface-darkBorder p-4">
            <h2 className="font-bold text-slate-900 dark:text-white mb-1">{title}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">{text}</p>
          </li>
        ))}
      </ul>
      <p className="text-sm text-slate-500">
        <Link href="/about" className="hover:underline">About</Link> ·{' '}
        <Link href="/dsl-guide" className="hover:underline">DSL guide</Link> ·{' '}
        <Link href="/whats-new" className="hover:underline">What&apos;s new</Link>
      </p>
    </section>
  )
}
