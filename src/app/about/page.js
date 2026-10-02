import Image from 'next/image'
import Link from 'next/link'

export const metadata = {
  title: 'About | VelocityStack',
  description: 'Precision engineering for the track cycling community.',
}

export default function AboutPage() {
  return (
    <section className="max-w-5xl mx-auto space-y-10">
      {/* --- HERO --- */}
      <div>
        <h1 className="text-3xl font-black text-slate-900 dark:text-white">
          📖 About VelocityStack
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
              🏁 The Mission
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

          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
              🛠️ What is here
            </h2>
            <ul className="space-y-1.5 list-disc list-inside">
              <li>
                <strong className="text-slate-900 dark:text-white">Pursuit Strategist:</strong>{' '}
                Advanced lap-by-lap pacing based on real physics.
              </li>
              <li>
                <strong className="text-slate-900 dark:text-white">Gear Architect:</strong>{' '}
                Dynamic gear inch and development calculations.
              </li>
              <li>
                <strong className="text-slate-900 dark:text-white">PB Vault:</strong> A secure
                home for your lifetime records across global velodromes.
              </li>
              <li>
                <strong className="text-slate-900 dark:text-white">Aero Lab:</strong> Field-test
                your position and equipment (CdA) without a wind tunnel.
              </li>
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-surface-darkBorder">
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

      {/* --- THE TECHNOLOGY --- */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
          🧬 Behind the Math
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
          ❤️ Support the Project
        </h2>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          VelocityStack is currently in <strong className="text-slate-900 dark:text-white">Alpha</strong>.
          We are constantly adding new velodromes and features. If this tool helped you win a race
          or set a new PB, consider{' '}
          <Link href="/feedback" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">
            sharing feedback
          </Link>{' '}
          or{' '}
          <Link href="/report-bug" className="font-semibold text-emerald-600 dark:text-brand-neon hover:underline">
            reporting a bug
          </Link>{' '}
          to help us keep improving.
        </p>
      </div>
    </section>
  )
}
