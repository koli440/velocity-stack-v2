'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { labErrorMessage, fetchLabRuns } from '../lib/labRuns'
import { fetchFtpHistory, resolveFtpAt } from '../lib/ftpHistory'
import { fetchLtHistory, resolveLtAt } from '../lib/lactateThresholds'
import { fetchWeightHistory, weightAt } from '../lib/weightHistory'
import { MOBILITY_ITEMS } from '../lib/labFieldForms'
import { fetchRideStreams } from '../lib/labRides'
import { durabilityTrend } from '../lib/durability'
import { decouplingTrend } from '../lib/decoupling'
import { computeProfile, mergeBests } from '../lib/labPowerProfile'
import { NOTE_MAX, TITLE_MAX, allowedSections, buildSnapshot, reportUrl, validateReportInput } from '../lib/labReports'
import { ErrorNote, StatusNote, adminBtn, adminCard, adminInput } from './admin/AdminUi'

const primary = adminBtn.primary
const quiet = adminBtn.secondary
const card = adminCard
const input = adminInput
const today = () => new Date().toISOString().slice(0, 10)

// Create, copy and revoke branded report links. The report is a frozen snapshot of the chosen sections;
// anyone with the link can read it until it is revoked.
export default function LabReports({ athleteId, viewerId }) {
  const own = viewerId === athleteId
  const sections = allowedSections(own)
  const [reports, setReports] = useState([])
  const [title, setTitle] = useState('Lab report')
  const [note, setNote] = useState('')
  const [chosen, setChosen] = useState(() => allowedSections(viewerId === athleteId).map((x) => x.key))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('lab_reports_list', { p_athlete: athleteId })
    if (error) setMsg({ error: labErrorMessage(error) })
    else setReports(data || [])
  }, [athleteId])
  useEffect(() => { load() }, [load])

  const toggle = (k) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))

  const create = async () => {
    setBusy(true)
    setMsg(null)
    const has = (k) => chosen.includes(k)
    const rpc = async (fn, args) => ((await supabase.rpc(fn, args)).data || [])
    const [ftp, lt, runs, acts, wh, ageRes, lactate, field, entries, dur, dec, aero] = await Promise.all([
      fetchFtpHistory(supabase, athleteId),
      fetchLtHistory(supabase, athleteId),
      fetchLabRuns(supabase, athleteId),
      has('phenotype')
        ? supabase.from('activities').select('curves_data').eq('user_id', athleteId).gte('activity_date', new Date(Date.now() - 365 * 86400000).toISOString()).limit(500)
        : Promise.resolve({ data: [] }),
      fetchWeightHistory(supabase, athleteId),
      has('phenotype') ? supabase.rpc('lab_athlete_age', { p_athlete: athleteId }) : Promise.resolve({ data: null }),
      has('lactate') ? rpc('lab_lactate_list', { p_athlete: athleteId }) : [],
      has('forms') ? rpc('lab_field_list', { p_athlete: athleteId, p_kind: null }) : [],
      ['fueling', 'fit', 'pedalling', 'cadence'].some(has) ? rpc('lab_entry_list', { p_athlete: athleteId, p_kind: null }) : [],
      has('durability') ? fetchRideStreams(supabase, athleteId, { days: 180, limit: 40 }) : { rides: [] },
      has('decoupling') ? fetchRideStreams(supabase, athleteId, { days: 180, limit: 40, hr: true }) : { rides: [] },
      has('aero') && own ? fetch('/api/aero-tests').then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
    ])
    const weight = weightAt(wh.history, today())
    const age = Number(ageRes.data) || null
    const profile = computeProfile({ bests: mergeBests((acts.data || []).map((a) => a.curves_data?.Power || null)), weightKg: weight, age })
    const latest = (kind) => field.find((r) => r.kind === kind)?.data
    const mob = latest('mobility')
    const sprint = latest('sprint')
    const bodyRow = latest('body')
    const snapshot = buildSnapshot(chosen, {
      ftp: resolveFtpAt(ftp.history, today()),
      lt: resolveLtAt(lt.history, today()),
      runs: runs.runs,
      profile: profile.error ? null : profile,
      body: bodyRow || (weight ? { weight_kg: weight } : null),
      mobility: mob ? { mobility_pass: MOBILITY_ITEMS.filter((i) => mob[i.key] === 'pass').length, mobility_total: MOBILITY_ITEMS.length } : null,
      sprint: sprint ? { sprint_distance_m: sprint.distance_m, sprint_time_s: sprint.time_s } : null,
      lactate: lactate[0] || null,
      durability: durabilityTrend(dur.rides || []),
      decoupling: decouplingTrend(dec.rides || []),
      aero: Array.isArray(aero) ? aero : aero?.aeroTests || [],
      entries,
    }, { isOwnAthlete: own })
    const v = validateReportInput({ title, note, snapshot })
    if (v.error) { setBusy(false); return setMsg({ error: v.error }) }
    const { data, error } = await supabase.rpc('lab_report_create', { p_athlete: athleteId, p_title: v.title, p_note: v.note, p_snapshot: v.snapshot })
    setBusy(false)
    if (error) return setMsg({ error: labErrorMessage(error) })
    setMsg({ ok: `Report created: ${reportUrl(data.token, window.location.origin)}` })
    load()
  }

  const copy = async (token) => {
    try {
      await navigator.clipboard.writeText(reportUrl(token, window.location.origin))
      setMsg({ ok: 'Link copied' })
    } catch {
      setMsg({ error: 'Could not copy; open the report and copy its address' })
    }
  }

  const revoke = async (id) => {
    if (!window.confirm('Revoke this link? Anyone holding it loses access.')) return
    const { error } = await supabase.rpc('lab_report_revoke', { p_id: id })
    if (error) setMsg({ error: labErrorMessage(error) })
    else load()
  }

  return (
    <div className="space-y-4" data-testid="lab-reports">
      <section className={card}>
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white mb-1">New shareable report</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-2">A frozen copy of the chosen sections. Anyone with the link can read it until you revoke it. Nothing else is exposed.</p>
        <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1">Title <input value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} className={input} /></label>
        <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1 mt-3">Note (optional) <textarea rows={2} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} className={input} /></label>
        <ul className="mt-3 space-y-1 text-sm text-slate-800 dark:text-slate-200">
          {sections.map((s) => (
            <li key={s.key}><label className="flex items-center gap-3 min-h-[44px] lg:min-h-[32px]"><input className="h-5 w-5 accent-orange-600" type="checkbox" checked={chosen.includes(s.key)} onChange={() => toggle(s.key)} /> {s.label}</label></li>
          ))}
        </ul>
        {!own && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Health data such as body composition can only be shared by the athlete.</p>}
        <button className={`${primary} mt-3 w-full sm:w-auto`} disabled={busy} onClick={create}>Create link</button>
        {msg?.error && <ErrorNote>{msg.error}</ErrorNote>}
        {msg?.ok && <StatusNote>{msg.ok}</StatusNote>}
      </section>
      <section className={card}>
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white mb-2">Reports</h2>
        {reports.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No reports yet.</p>}
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm rounded-xl border border-slate-200 dark:border-slate-600 p-3" data-testid="report-row">
              <span className="font-bold text-slate-900 dark:text-white break-words min-w-0 flex-1 basis-40">{r.title}</span>
              <span className="text-slate-600 dark:text-slate-300">{String(r.created_at).slice(0, 10)}{r.revoked_at ? ' · revoked' : ''}</span>
              {!r.revoked_at && (
                <>
                  <a className={quiet} href={`/lab/report/${r.token}`} target="_blank" rel="noreferrer">Open</a>
                  <button className={quiet} onClick={() => copy(r.token)}>Copy link</button>
                  <button className={quiet} onClick={() => revoke(r.id)}>Revoke</button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
