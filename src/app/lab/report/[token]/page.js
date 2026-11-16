import { notFound } from 'next/navigation'
import LicenceBadge from '../../../../components/LicenceBadge'
import PrintButton from '../../../../components/PrintButton'
import { loadLabReport } from '../../../../lib/server/labReportStore'
import { cardPath, safeCoachMediaUrl } from '../../../../lib/coachCard'

// Token-gated and never cached; revoking a link takes effect immediately.
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Lab report', robots: { index: false, follow: false }, alternates: { canonical: null } }

const Row = ({ label, value }) => (value == null ? null : (
  <div className="flex justify-between border-b border-slate-100 py-1 text-sm gap-3"><dt className="text-slate-600">{label}</dt><dd className="font-bold text-slate-900">{value}</dd></div>
))

export default async function LabReportPage({ params }) {
  const report = await loadLabReport(params.token)
  if (!report) notFound()
  const s = report.snapshot
  const coach = report.coach
  const logo = safeCoachMediaUrl(coach?.logo_url)
  return (
    <article className="max-w-2xl mx-auto p-5 sm:p-8 space-y-5 bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-sm print:p-0 print:border-0 print:shadow-none" data-testid="lab-report">
      <header className="flex items-center gap-3">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-14 w-14 object-contain" data-testid="report-logo" />
        )}
        <div className="min-w-0">
          {coach && <p className="text-sm font-bold">{coach.slug ? <a href={cardPath(coach.slug)}>{coach.name}</a> : coach.name}</p>}
          {coach && <LicenceBadge licence={coach.licence} />}
        </div>
        <div className="ml-auto"><PrintButton /></div>
      </header>
      <div>
        <h1 className="text-2xl font-black break-words">{report.title}</h1>
        <p className="text-sm text-slate-600">{report.athlete_name} · {String(report.created_at).slice(0, 10)}</p>
        {report.note && <p className="mt-2 text-sm whitespace-pre-wrap">{report.note}</p>}
      </div>
      {s.thresholds && (
        <section><h2 className="text-sm font-black uppercase tracking-tight mb-1">Thresholds{s.thresholds.as_of ? ` (as of ${s.thresholds.as_of})` : ''}</h2>
          <dl>
            <Row label="FTP" value={s.thresholds.ftp_w != null ? `${s.thresholds.ftp_w} W` : null} />
            <Row label="LT1" value={s.thresholds.lt1_power_w != null ? `${s.thresholds.lt1_power_w} W${s.thresholds.lt1_hr ? ` · ${s.thresholds.lt1_hr} bpm` : ''}` : null} />
            <Row label="LT2" value={s.thresholds.lt2_power_w != null ? `${s.thresholds.lt2_power_w} W${s.thresholds.lt2_hr ? ` · ${s.thresholds.lt2_hr} bpm` : ''}` : null} />
          </dl></section>
      )}
      {Array.isArray(s.tests) && s.tests.length > 0 && (
        <section><h2 className="text-sm font-black uppercase tracking-tight mb-1">Field tests</h2>
          <ul className="text-sm space-y-1 text-slate-800">{s.tests.map((t, i) => (
            <li key={i}>{t.date} · {t.protocol}{t.ftp != null ? ` · FTP ${t.ftp} W` : ''}{t.cp != null ? ` · CP ${t.cp} W` : ''}</li>
          ))}</ul></section>
      )}
      {s.phenotype && (
        <section><h2 className="text-sm font-black uppercase tracking-tight mb-1">Phenotype: {s.phenotype.label}</h2>
          <dl>
            {['5s', '1m', '5m', '20m'].map((k) => <Row key={k} label={`Best ${k}`} value={s.phenotype[k] != null ? `${s.phenotype[k]} W/kg` : null} />)}
          </dl></section>
      )}
      {s.forms && (
        <section><h2 className="text-sm font-black uppercase tracking-tight mb-1">Body composition</h2>
          <dl>
            <Row label="Weight" value={s.forms.weight_kg != null ? `${s.forms.weight_kg} kg` : null} />
            <Row label="Body fat" value={s.forms.body_fat_pct != null ? `${s.forms.body_fat_pct} %` : null} />
          </dl></section>
      )}
      <footer className="pt-2 text-xs text-slate-600">Shared via VelocityStack. This report is a snapshot and can be revoked by its owner.</footer>
    </article>
  )
}
