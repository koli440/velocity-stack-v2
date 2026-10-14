import {
  DSL_BANDS,
  DSL_COMMON_MISTAKES,
  DSL_GUIDE_EXAMPLES,
  DSL_RULES,
  DSL_STEP_PARTS,
} from '../../lib/dslGuide'

export const metadata = {
  title: 'DSL Syntax Guide | VelocityStack',
  description: 'How to write interval templates with the VelocityStack interval DSL.',
}

const CARD = 'glass-dense rounded-2xl border border-slate-200 dark:border-surface-darkBorder bg-white dark:bg-surface-darkCard p-4'
const H2 = 'text-lg font-bold text-slate-900 dark:text-white mb-2'
const CODE = 'font-mono text-xs bg-slate-100 dark:bg-slate-900 rounded px-1.5 py-0.5'

export default function DslGuidePage() {
  return (
    <section className="max-w-4xl mx-auto space-y-8 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      <div>
        <h1 className="text-3xl font-black text-slate-900 dark:text-white">📐 DSL Syntax Guide</h1>
        <p className="mt-2 font-semibold text-slate-500 dark:text-slate-400">
          Describe an interval session as plain text; VelocityStack finds matching efforts in your rides.
        </p>
      </div>

      <div className={CARD}>
        <h2 className={H2}>Structure</h2>
        <pre className="font-mono text-xs bg-slate-50 dark:bg-slate-900 rounded-xl p-3 mb-3">
{`4x
work 3min ±30% @ 90-110%FTP
recovery 2min ±50% @ <55%FTP`}
        </pre>
        <p className="mb-3">
          The first line is the repeat count; each following line is a step in the form{' '}
          <code className={CODE}>role value unit ±tolerance% @ band</code>.
        </p>
        <dl className="space-y-2">
          {DSL_STEP_PARTS.map((p) => (
            <div key={p.part}>
              <dt className="inline font-mono text-xs font-bold text-orange-500">{p.part}</dt>
              <dd className="inline"> — {p.meaning}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className={CARD}>
        <h2 className={H2}>Bands (the part after @)</h2>
        <ul className="space-y-2">
          {DSL_BANDS.map((b) => (
            <li key={b.syntax}>
              <code className={CODE}>{b.syntax}</code> — {b.meaning}
            </li>
          ))}
        </ul>
      </div>

      <div className={CARD}>
        <h2 className={H2}>Duration vs. distance steps</h2>
        <p>
          Use <code className={CODE}>min</code>/<code className={CODE}>sec</code> to match by time, or{' '}
          <code className={CODE}>km</code>/<code className={CODE}>m</code> to match by distance (e.g. a 4km
          individual pursuit or a 200m flying sprint). Because a distance window has no inherent power-vs-speed
          preference, <code className={CODE}>best</code>/<code className={CODE}>max</code> must be written as{' '}
          <code className={CODE}>best power</code> or <code className={CODE}>best speed</code> on those steps.
        </p>
      </div>

      <div>
        <h2 className={H2}>Examples</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {DSL_GUIDE_EXAMPLES.map((ex) => (
            <div key={ex.title} className={CARD}>
              <div className="font-bold text-slate-900 dark:text-white">{ex.title}</div>
              <p className="text-xs mb-2">{ex.description}</p>
              <pre className="whitespace-pre-wrap font-mono text-xs bg-slate-50 dark:bg-slate-900 rounded-xl p-2.5">
                {ex.dsl}
              </pre>
            </div>
          ))}
        </div>
      </div>

      <div className={CARD}>
        <h2 className={H2}>Rules</h2>
        <ul className="list-disc pl-5 space-y-1">
          {DSL_RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className={H2}>Common mistakes</h2>
        <div className="space-y-3">
          {DSL_COMMON_MISTAKES.map((m) => (
            <div key={m.dsl} className={CARD}>
              <pre className="whitespace-pre-wrap font-mono text-xs bg-red-500/10 text-red-500 rounded-xl p-2.5 mb-2">
                {m.dsl}
              </pre>
              <p className="text-xs">{m.fix}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
