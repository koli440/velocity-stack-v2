import { notFound } from 'next/navigation'
import LicenceBadge from '../../../../components/LicenceBadge'
import PrintButton from '../../../../components/PrintButton'
import { loadLabReport } from '../../../../lib/server/labReportStore'
import Icon from '../../../../components/Icon'
import { thresholdTiles, phenotypeRows, testSummary, bodyRows, lactateRows, durabilityLines, decouplingLines, aeroLines, fuelingLines, fitRows, pedallingRows, cadenceRows } from '../../../../lib/labReportView'
import { cardPath, safeCoachMediaUrl } from '../../../../lib/coachCard'

// Token-gated and never cached; revoking a link takes effect immediately.
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Lab report', robots: { index: false, follow: false }, alternates: { canonical: null } }

const CARD = 'glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder p-4 sm:p-5 print:bg-white print:border-slate-300 print:shadow-none break-inside-avoid'
const H2 = 'flex items-center gap-2 text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white mb-3 print:text-black'

const Row = ({ label, value }) => (
  <div className="flex justify-between gap-3 py-2 border-b last:border-0 border-slate-200 dark:border-slate-600 text-sm print:border-slate-300">
    <dt className="text-slate-700 dark:text-slate-300 print:text-slate-700">{label}</dt>
    <dd className="font-bold text-slate-900 dark:text-white print:text-black">{value}</dd>
  </div>
)

export default async function LabReportPage({ params }) {
  const report = await loadLabReport(params.token)
  if (!report) notFound()
  const s = report.snapshot
  const coach = report.coach
  const logo = safeCoachMediaUrl(coach?.logo_url)
  const tiles = thresholdTiles(s.thresholds)
  const pheno = phenotypeRows(s.phenotype)
  const body = bodyRows(s.forms)
  const tests = Array.isArray(s.tests) ? s.tests : []
  const lists = [
    ['Lactate step test', 'flask', lactateRows(s.lactate), null],
    ['Durability', 'bolt', null, durabilityLines(s.durability)],
    ['Efficiency and decoupling', 'bolt', null, decouplingLines(s.decoupling)],
    ['Aero tests', 'bolt', null, aeroLines(s.aero)],
    ['Fueling and glucose', 'flask', null, fuelingLines(s.fueling), 'Performance and fueling insight, not medical advice.'],
    ['Bike fit', 'ruler', fitRows(s.fit), null],
    ['Pedalling efficiency', 'bolt', pedallingRows(s.pedalling), null],
    ['Cadence profile', 'bolt', cadenceRows(s.cadence), null],
  ]
  return (
    <article className="max-w-3xl mx-auto space-y-4 text-slate-900 dark:text-white print:max-w-none print:text-black" data-testid="lab-report">
      <header className="glass-dense rounded-2xl bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder border-t-4 border-t-orange-500 p-4 sm:p-6 space-y-4 print:bg-white print:border-slate-300 break-inside-avoid">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-orange-700 dark:text-orange-400">
            <Icon name="flask" /> VelocityStack Lab report
          </span>
          <div className="ml-auto"><PrintButton /></div>
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-black break-words">{report.title}</h1>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300 print:text-slate-700">
            <b className="text-slate-900 dark:text-white print:text-black">{report.athlete_name}</b> · {String(report.created_at).slice(0, 10)}
          </p>
        </div>
        {coach && (
          <div className="flex items-center gap-3 pt-3 border-t border-slate-200 dark:border-slate-600 print:border-slate-300">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="h-12 w-12 object-contain rounded-lg" data-testid="report-logo" />
            )}
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">Coach</p>
              <p className="text-sm font-black">{coach.slug ? <a className="hover:underline" href={cardPath(coach.slug)}>{coach.name}</a> : coach.name}</p>
              <LicenceBadge licence={coach.licence} />
            </div>
          </div>
        )}
        {report.note && <p className="text-sm whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200 print:text-black">{report.note}</p>}
      </header>

      {tiles.length > 0 && (
        <section aria-label="Key results" data-testid="report-kpis">
          <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
            Thresholds{s.thresholds?.as_of ? ` (as of ${s.thresholds.as_of})` : ''}
          </p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {tiles.map((t) => (
              <li key={t.key} className={`${CARD} !p-4 border-l-4 border-l-orange-500`}>
                <p className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 print:text-slate-700">{t.label}</p>
                <p className="text-3xl font-black text-slate-900 dark:text-white print:text-black">{t.value}<span className="text-base font-bold ml-1">{t.unit}</span></p>
                {t.sub && <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 print:text-slate-700">{t.sub}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {tests.length > 0 && (
        <section className={CARD}>
          <h2 className={H2}><Icon name="stopwatch" /> Field tests</h2>
          <ul className="space-y-2">
            {tests.map((t, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 p-3 text-sm print:border-slate-300">
                <span className="font-bold">{t.date}</span>
                {testSummary(t).map((x, j) => (
                  <span key={j} className="px-2 py-0.5 rounded-full text-xs font-bold bg-sky-100 text-sky-900 border border-sky-300 dark:bg-sky-900/50 dark:text-sky-100 dark:border-sky-700 print:bg-white print:text-black">{x}</span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
      {s.phenotype && pheno.length > 0 && (
        <section className={CARD}>
          <h2 className={H2}><Icon name="bolt" /> Phenotype: {s.phenotype.label}</h2>
          <dl>{pheno.map((r) => <Row key={r.label} {...r} />)}</dl>
          {s.phenotype.age_note && <p className="mt-2 text-xs text-slate-700 dark:text-slate-300 print:text-slate-700" data-testid="report-age-note">{s.phenotype.age_note}</p>}
        </section>
      )}
      {body.length > 0 && (
        <section className={CARD}>
          <h2 className={H2}><Icon name="ruler" /> Body composition</h2>
          <dl>{body.map((r) => <Row key={r.label} {...r} />)}</dl>
        </section>
      )}
      {lists.filter(([, , rows, ls]) => (rows && rows.length) || (ls && ls.length)).map(([title, icon, rows, ls, note]) => (
        <section key={title} className={CARD} data-testid="report-extra">
          <h2 className={H2}><Icon name={icon} /> {title}</h2>
          {rows && <dl>{rows.map((r) => <Row key={r.label} {...r} />)}</dl>}
          {ls && <ul className="space-y-1 text-sm">{ls.map((l) => <li key={l}>{l}</li>)}</ul>}
          {note && <p className="mt-2 text-xs text-slate-700 dark:text-slate-300 print:text-slate-700">{note}</p>}
        </section>
      ))}
      <footer className="px-1 text-xs text-slate-700 dark:text-slate-300 print:text-slate-700">
        Shared via VelocityStack. This report is a snapshot and can be revoked by its owner.
      </footer>
    </article>
  )
}
