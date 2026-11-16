'use client'

import { useState } from 'react'
import { adminCard, adminInput, adminBtn } from './admin/AdminUi'
import {
  AVAILABILITY, MAX_BLACKOUT, MAX_EVENTS, PARQ_QUESTIONS, PRIORITIES, SEX_OPTIONS, STRUCTURE_OPTIONS, WEEKDAYS,
  buildAnswers, isMinor, validateForm,
} from '../lib/coachOnboarding'

const field = adminInput
const lbl = 'block text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1'
const h2 = 'text-base font-extrabold text-slate-900 dark:text-white'

function Input({ label, form, set, name, type = 'text', ...rest }) {
  return (
    <label className="block">
      <span className={lbl}>{label}</span>
      <input className={field} type={type} value={form[name] ?? ''} onChange={(e) => set({ [name]: e.target.value })} {...rest} />
    </label>
  )
}

/**
 * Questionnaire used by the apply flow and by "edit my answers".
 * `initial` = { form, health, healthDeclined, coachAnswers }; `onSubmit` receives the RPC payload.
 */
export default function OnboardingForm({ initial, questions = [], consentRequired = true, consentText, submitLabel = 'Submit', onSubmit, onChange }) {
  const [form, setForm] = useState(initial?.form || { events: [], blackout: [], weekdays: {} })
  const [parq, setParq] = useState(initial?.health?.parq || Array(7).fill(false))
  const [healthNotes, setHealthNotes] = useState(initial?.health?.notes || '')
  const [healthMode, setHealthMode] = useState(initial?.healthDeclined ? 'declined' : initial?.health ? 'answer' : 'skip')
  const [coachAnswers, setCoachAnswers] = useState(initial?.coachAnswers || {})
  const [consent, setConsent] = useState(!consentRequired)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const set = (patch) => setForm((f) => {
    const next = { ...f, ...patch }
    onChange?.(next)
    return next
  })
  const minor = isMinor(form.dob)
  const health = !minor && healthMode === 'answer' ? { parq, notes: healthNotes.trim() || undefined } : null
  const healthDeclined = !minor && healthMode === 'declined'
  const listSet = (key, i, patch) => set({ [key]: form[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) })

  const submit = async (e) => {
    e.preventDefault()
    const problem = validateForm(form, { health, healthDeclined, consent })
    if (problem) return setError(problem)
    setError(null)
    setBusy(true)
    const clean = Object.fromEntries(Object.entries(coachAnswers).map(([k, v]) => [k, String(v || '').trim()]).filter(([, v]) => v))
    const res = await onSubmit({ answers: buildAnswers(form), health, healthDeclined, coachAnswers: clean })
    setBusy(false)
    if (res?.error) setError(res.error)
  }

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="onboarding-form">
      <section className={`${adminCard} space-y-3`}>
        <h2 className={h2}>About you</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Date of birth *" type="date" form={form} set={set} name="dob" required />
          <label className="block">
            <span className={lbl}>Sex</span>
            <select className={field} value={form.sex || ''} onChange={(e) => set({ sex: e.target.value })}>
              <option value="">-</option>
              {Object.entries(SEX_OPTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <Input label="Height (cm)" type="number" form={form} set={set} name="height_cm" />
          <Input label="Weight (kg)" type="number" step="0.1" form={form} set={set} name="weight_kg" />
          <Input label="Country" form={form} set={set} name="country" maxLength={60} />
          <Input label="Language" form={form} set={set} name="language" maxLength={40} />
        </div>
        {minor && <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">You are under 18: health questions are skipped and a parent or guardian should be involved.</p>}
      </section>

      <section className={`${adminCard} space-y-3`}>
        <h2 className={h2}>Goals</h2>
        <Input label="Main goal" form={form} set={set} name="main_goal" maxLength={40} placeholder="e.g. race, fitness, weight loss" />
        <label className="block">
          <span className={lbl}>Tell the coach more</span>
          <textarea className={field} rows={3} maxLength={1000} value={form.goal_text || ''} onChange={(e) => set({ goal_text: e.target.value })} />
        </label>
        <Input label="Timeframe" form={form} set={set} name="timeframe" maxLength={100} />
        <div className="space-y-2">
          <span className={lbl}>Target events (max {MAX_EVENTS})</span>
          {form.events.map((ev, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-center">
              <input className={field} placeholder="Name" maxLength={80} value={ev.name || ''} onChange={(e) => listSet('events', i, { name: e.target.value })} />
              <input className={field} type="date" value={ev.date || ''} onChange={(e) => listSet('events', i, { date: e.target.value })} />
              <select className={field} value={ev.priority || 'B'} onChange={(e) => listSet('events', i, { priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
              <button type="button" className={adminBtn.danger} onClick={() => set({ events: form.events.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          {form.events.length < MAX_EVENTS && <button type="button" className={adminBtn.secondary} onClick={() => set({ events: [...form.events, { name: '', date: '', priority: 'B' }] })}>Add event</button>}
        </div>
      </section>

      <section className={`${adminCard} space-y-3`}>
        <h2 className={h2}>Training history</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Years riding" type="number" form={form} set={set} name="years_riding" />
          <Input label="Hours per week now" type="number" form={form} set={set} name="weekly_hours" />
          <label className="block">
            <span className={lbl}>Current structure</span>
            <select className={field} value={form.structure || ''} onChange={(e) => set({ structure: e.target.value })}>
              <option value="">-</option>
              {Object.entries(STRUCTURE_OPTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <Input label="FTP (W)" type="number" form={form} set={set} name="ftp_w" />
          <Input label="FTP test date" type="date" form={form} set={set} name="ftp_date" />
          <Input label="Max heart rate" type="number" form={form} set={set} name="max_hr" />
          <Input label="LT1 (W)" type="number" form={form} set={set} name="lt1_w" />
          <Input label="LT2 (W)" type="number" form={form} set={set} name="lt2_w" />
          <Input label="Indoor share (%)" type="number" form={form} set={set} name="indoor_pct" />
        </div>
        <Input label="Other sports" form={form} set={set} name="other_sports" maxLength={200} />
      </section>

      <section className={`${adminCard} space-y-3`}>
        <h2 className={h2}>Availability</h2>
        <Input label="Hours per week you can train" type="number" form={form} set={set} name="hours_per_week" />
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {WEEKDAYS.map((d) => (
            <label key={d} className="text-center">
              <span className={lbl}>{d.toUpperCase()}</span>
              <select className={field} value={form.weekdays?.[d] || ''} onChange={(e) => set({ weekdays: { ...form.weekdays, [d]: e.target.value } })}>
                <option value="">-</option>
                {Object.entries(AVAILABILITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="space-y-2">
          <span className={lbl}>Days you are unavailable (max {MAX_BLACKOUT})</span>
          {form.blackout.map((b, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-center">
              <input className={field} type="date" value={b.date || ''} onChange={(e) => listSet('blackout', i, { date: e.target.value })} />
              <input className={field} placeholder="Note" maxLength={200} value={b.note || ''} onChange={(e) => listSet('blackout', i, { note: e.target.value })} />
              <button type="button" className={adminBtn.danger} onClick={() => set({ blackout: form.blackout.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          {form.blackout.length < MAX_BLACKOUT && <button type="button" className={adminBtn.secondary} onClick={() => set({ blackout: [...form.blackout, { date: '', note: '' }] })}>Add day</button>}
        </div>
        <Input label="How do you like to communicate?" form={form} set={set} name="contact_style" maxLength={300} />
      </section>

      <section className={`${adminCard} space-y-3`}>
        <h2 className={h2}>Equipment</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Power meter" form={form} set={set} name="power_meter" maxLength={100} />
          <Input label="Heart rate" form={form} set={set} name="hr" maxLength={100} />
          <Input label="Smart trainer" form={form} set={set} name="smart_trainer" maxLength={100} />
          <Input label="Head unit" form={form} set={set} name="head_unit" maxLength={100} />
          <Input label="Bike type" form={form} set={set} name="bike_type" maxLength={100} />
          <Input label="Platforms (comma separated)" form={form} set={set} name="platforms" />
        </div>
      </section>

      {!minor && (
        <section className="space-y-3" data-testid="health-section">
          <h2 className={h2}>Health (optional)</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">Sensitive. Only this coach sees it, you can skip it, and you can delete it anytime.</p>
          <select className={field} value={healthMode} onChange={(e) => setHealthMode(e.target.value)} aria-label="Health answers">
            <option value="skip">Skip for now</option>
            <option value="declined">I prefer not to share health information</option>
            <option value="answer">Answer the PAR-Q questions</option>
          </select>
          {healthMode === 'answer' && (
            <div className="space-y-2">
              {PARQ_QUESTIONS.map((q, i) => (
                <label key={q} className="flex gap-2 text-sm items-start">
                  <input type="checkbox" checked={!!parq[i]} onChange={(e) => setParq(parq.map((v, j) => (j === i ? e.target.checked : v)))} />
                  <span>{q}</span>
                </label>
              ))}
              <p className="text-sm text-slate-600 dark:text-slate-300">Tick the questions you answer YES to.</p>
              <textarea className={field} rows={2} maxLength={1000} placeholder="Injuries or conditions the coach should know" value={healthNotes} onChange={(e) => setHealthNotes(e.target.value)} />
            </div>
          )}
        </section>
      )}

      {questions.length > 0 && (
        <section className={`${adminCard} space-y-3`}>
          <h2 className={h2}>Questions from the coach</h2>
          {questions.map((q) => (
            <label key={q.position} className="block">
              <span className={lbl}>{q.question}</span>
              <textarea className={field} rows={2} maxLength={1000} value={coachAnswers[q.position] || ''} onChange={(e) => setCoachAnswers({ ...coachAnswers, [q.position]: e.target.value })} />
            </label>
          ))}
        </section>
      )}

      {consentRequired && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <h2 className={h2}>Consent</h2>
          <p className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-200">{consentText}</p>
          <label className="flex gap-2 text-sm font-semibold">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I agree
          </label>
        </section>
      )}

      {error && <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">{error}</p>}
      <button type="submit" disabled={busy} className={`${adminBtn.primary} w-full sm:w-auto`}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
