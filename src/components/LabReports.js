'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { labErrorMessage, fetchLabRuns } from '../lib/labRuns'
import { fetchFtpHistory, resolveFtpAt } from '../lib/ftpHistory'
import { fetchLtHistory, resolveLtAt } from '../lib/lactateThresholds'
import { fetchWeightHistory, weightAt } from '../lib/weightHistory'
import { computeProfile, mergeBests } from '../lib/labPowerProfile'
import { NOTE_MAX, TITLE_MAX, allowedSections, buildSnapshot, reportUrl, validateReportInput } from '../lib/labReports'

const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition disabled:opacity-50'
const primary = `${btn} bg-indigo-600 border-indigo-600 text-white`
const quiet = `${btn} border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300`
const card = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4'
const input = 'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-sm'
const today = () => new Date().toISOString().slice(0, 10)

// Create, copy and revoke branded report links. The report is a frozen snapshot of the chosen sections;
// anyone with the link can read it until it is revoked.
export default function LabReports({ athleteId, viewerId }) {
  const own = viewerId === athleteId
  const sections = allowedSections(own)
  const [reports, setReports] = useState([])
  const [title, setTitle] = useState('Lab report')
  const [note, setNote] = useState('')
  const [chosen, setChosen] = useState(['thresholds', 'tests', 'phenotype'])
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
    const [ftp, lt, runs, acts, wh] = await Promise.all([
      fetchFtpHistory(supabase, athleteId),
      fetchLtHistory(supabase, athleteId),
      fetchLabRuns(supabase, athleteId),
      chosen.includes('phenotype')
        ? supabase.from('activities').select('curves_data').eq('user_id', athleteId).gte('activity_date', new Date(Date.now() - 365 * 86400000).toISOString()).limit(500)
        : Promise.resolve({ data: [] }),
      fetchWeightHistory(supabase, athleteId),
    ])
    const weight = weightAt(wh.history, today())
    const profile = computeProfile({ bests: mergeBests((acts.data || []).map((a) => a.curves_data?.Power || null)), weightKg: weight })
    const snapshot = buildSnapshot(chosen, {
      ftp: resolveFtpAt(ftp.history, today()),
      lt: resolveLtAt(lt.history, today()),
      runs: runs.runs,
      profile: profile.error ? null : profile,
      body: weight ? { weight_kg: weight } : null,
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
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white mb-1">New shareable report</h2>
        <p className="text-xs text-slate-500 mb-2">A frozen copy of the chosen sections. Anyone with the link can read it until you revoke it. Nothing else is exposed.</p>
        <label className="block text-xs text-slate-500">Title <input value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} className={input} /></label>
        <label className="block mt-2 text-xs text-slate-500">Note (optional) <textarea rows={2} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} className={input} /></label>
        <ul className="mt-2 space-y-1 text-xs text-slate-700 dark:text-slate-300">
          {sections.map((s) => (
            <li key={s.key}><label className="flex items-center gap-2"><input type="checkbox" checked={chosen.includes(s.key)} onChange={() => toggle(s.key)} /> {s.label}</label></li>
          ))}
        </ul>
        {!own && <p className="mt-2 text-[11px] text-slate-500">Health data such as body composition can only be shared by the athlete.</p>}
        <button className={`${primary} mt-3`} disabled={busy} onClick={create}>Create link</button>
        {msg?.error && <p className="mt-2 text-xs text-red-600" role="alert">{msg.error}</p>}
        {msg?.ok && <p className="mt-2 text-xs text-emerald-600 break-all">{msg.ok}</p>}
      </section>
      <section className={card}>
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">Reports</h2>
        {reports.length === 0 && <p className="text-xs text-slate-500">No reports yet.</p>}
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs border-t border-slate-100 dark:border-slate-800 pt-2" data-testid="report-row">
              <span className="font-bold text-slate-800 dark:text-slate-200">{r.title}</span>
              <span className="text-slate-500">{String(r.created_at).slice(0, 10)}{r.revoked_at ? ' · revoked' : ''}</span>
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
