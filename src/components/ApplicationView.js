import { AVAILABILITY, SEX_OPTIONS, STRUCTURE_OPTIONS, PARQ_QUESTIONS } from '../lib/coachOnboarding'

const Row = ({ k, v }) => (v === undefined || v === null || v === '' ? null : (
  <div className="flex gap-2 text-sm"><dt className="w-40 shrink-0 text-slate-500">{k}</dt><dd className="text-slate-900 dark:text-white whitespace-pre-line">{String(v)}</dd></div>
))
const Block = ({ title, children }) => (
  <section className="space-y-1"><h2 className="text-sm font-extrabold text-slate-900 dark:text-white">{title}</h2><dl className="space-y-1">{children}</dl></section>
)

/** Read-only rendering of a stored questionnaire (coach application detail, rider "my answers"). */
export default function ApplicationView({ answers = {}, health, healthDeclined, minor, coachAnswers = {}, questions = [] }) {
  const a = answers.about || {}, g = answers.goals || {}, h = answers.history || {}, v = answers.availability || {}, e = answers.equipment || {}
  return (
    <div className="space-y-4" data-testid="application-view">
      <Block title="About">
        <Row k="Date of birth" v={a.dob} /><Row k="Sex" v={SEX_OPTIONS[a.sex]} /><Row k="Height (cm)" v={a.height_cm} /><Row k="Weight (kg)" v={a.weight_kg} />
        <Row k="Country" v={a.country} /><Row k="Language" v={a.language} />
        {minor && <Row k="Note" v="Under 18: involve a parent or guardian." />}
      </Block>
      <Block title="Goals">
        <Row k="Main goal" v={g.main_goal} /><Row k="Details" v={g.goal_text} /><Row k="Why now" v={g.why_now} /><Row k="Timeframe" v={g.timeframe} />
        {(g.events || []).map((ev, i) => <Row key={i} k={`Event ${i + 1}`} v={[ev.name, ev.date, ev.priority && `priority ${ev.priority}`].filter(Boolean).join(' · ')} />)}
      </Block>
      <Block title="Training history">
        <Row k="Years riding" v={h.years_riding} /><Row k="Hours / week" v={h.weekly_hours} /><Row k="Km / week" v={h.weekly_km} /><Row k="Structure" v={STRUCTURE_OPTIONS[h.structure]} />
        <Row k="FTP (W)" v={h.ftp_w} /><Row k="FTP date" v={h.ftp_date} /><Row k="Max HR" v={h.max_hr} /><Row k="LT1 (W)" v={h.lt1_w} /><Row k="LT2 (W)" v={h.lt2_w} />
        <Row k="Indoor %" v={h.indoor_pct} /><Row k="Other sports" v={h.other_sports} />
      </Block>
      <Block title="Availability">
        <Row k="Hours / week" v={v.hours_per_week} /><Row k="Contact style" v={v.contact_style} />
        {Object.entries(v.weekdays || {}).map(([d, x]) => <Row key={d} k={d.toUpperCase()} v={AVAILABILITY[x]} />)}
        {(v.blackout || []).map((b, i) => <Row key={i} k="Unavailable" v={[b.date, b.note].filter(Boolean).join(' · ')} />)}
      </Block>
      <Block title="Equipment">
        <Row k="Power meter" v={e.power_meter} /><Row k="Heart rate" v={e.hr} /><Row k="Smart trainer" v={e.smart_trainer} /><Row k="Head unit" v={e.head_unit} />
        <Row k="Bike" v={e.bike_type} /><Row k="Platforms" v={(e.platforms || []).join(', ')} />
      </Block>
      <Block title="Health">
        {healthDeclined && <Row k="Status" v="Prefers not to share" />}
        {!healthDeclined && !health && <Row k="Status" v={minor ? 'Not collected (under 18)' : 'Not provided'} />}
        {health && PARQ_QUESTIONS.map((q, i) => <Row key={q} k={`Q${i + 1}`} v={`${health.parq?.[i] ? 'YES' : 'no'} — ${q}`} />)}
        {health?.notes && <Row k="Notes" v={health.notes} />}
      </Block>
      {questions.length > 0 && (
        <Block title="Coach questions">
          {questions.map((q) => <Row key={q.position} k={q.question} v={coachAnswers[q.position] || '—'} />)}
        </Block>
      )}
    </div>
  )
}
