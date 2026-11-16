'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { LAB_PROTOCOL_IDS, LAB_PROTOCOLS } from '../lib/labProtocols'
import { fetchLabRuns, labErrorMessage } from '../lib/labRuns'
import { labBasePath } from '../lib/labFeatures'
import { buildTimeline, upcomingDates, validateScheduleForm } from '../lib/labSchedule'
import { ErrorNote, StatusNote, adminBtn, adminCard, adminInput } from './admin/AdminUi'

const primary = adminBtn.primary
const quiet = adminBtn.secondary
const card = adminCard
const input = adminInput
const today = () => new Date().toISOString().slice(0, 10)

// Repeating test blocks with reminders (3 days ahead and on the day, sent by the database) and a timeline.
export default function LabScheduler({ athleteId, riderId = null }) {
  const [schedules, setSchedules] = useState([])
  const [runs, setRuns] = useState([])
  const [protocol, setProtocol] = useState(LAB_PROTOCOL_IDS[0])
  const [weeks, setWeeks] = useState('8')
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([
      supabase.rpc('lab_schedules_list', { p_athlete: athleteId }),
      fetchLabRuns(supabase, athleteId),
    ])
    if (s.error) return setMsg({ error: labErrorMessage(s.error) })
    setSchedules(s.data || [])
    setRuns(r.runs || r.data || [])
  }, [athleteId])
  useEffect(() => { load() }, [load])

  const save = async () => {
    const v = validateScheduleForm({ athleteId, protocol, weeks, start, end })
    if (v.error) return setMsg({ error: v.error })
    setBusy(true)
    const { error } = await supabase.rpc('lab_schedule_save', v.args)
    setBusy(false)
    setMsg(error ? { error: labErrorMessage(error) } : { ok: 'Schedule saved' })
    if (!error) load()
  }
  const stop = async (id) => {
    const { error } = await supabase.rpc('lab_schedule_stop', { p_id: id })
    if (error) setMsg({ error: labErrorMessage(error) })
    else load()
  }

  const timeline = buildTimeline(runs)
  const base = labBasePath(riderId)
  return (
    <div className="space-y-4" data-testid="lab-scheduler">
      <section className={card}>
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white mb-3">Repeat a test</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
          <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1"><span>Test</span><select value={protocol} onChange={(e) => setProtocol(e.target.value)} className={input}>
            {LAB_PROTOCOL_IDS.map((id) => <option key={id} value={id}>{LAB_PROTOCOLS[id].label}</option>)}
          </select></label>
          <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1"><span>Every (weeks)</span><input inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} className={input} /></label>
          <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1"><span>Start</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={input} /></label>
          <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 space-y-1"><span>End (optional)</span><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={input} /></label>
          </div>
        <button className={`${primary} mt-3 w-full sm:w-auto`} disabled={busy} onClick={save}>Save schedule</button>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">The athlete gets a reminder 3 days before and on the day. Plan the test itself in the <Link className="text-orange-700 dark:text-orange-400 font-bold" href={`${base}/protocols`}>protocol runner</Link>.</p>
        {msg?.error && <ErrorNote>{msg.error}</ErrorNote>}
        {msg?.ok && <StatusNote>{msg.ok}</StatusNote>}
      </section>
      <section className={card}>
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white mb-2">Schedules</h2>
        {schedules.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No schedules yet.</p>}
        <ul className="space-y-2">
          {schedules.map((s) => (
            <li key={s.id} className="text-sm text-slate-800 dark:text-slate-200 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 dark:border-slate-600 p-3" data-testid="lab-schedule">
              <span className="font-bold">{LAB_PROTOCOLS[s.protocol]?.label || s.protocol}</span>
              <span>every {s.interval_weeks} wk</span>
              <span>{s.active ? `next: ${upcomingDates(s, today(), 3).join(', ') || 'finished'}` : 'stopped'}</span>
              {s.active && <button className={quiet} onClick={() => stop(s.id)}>Stop</button>}
            </li>
          ))}
        </ul>
      </section>
      <section className={card}>
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white mb-2">Timeline</h2>
        {timeline.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300">No tests yet.</p>}
        <ol className="space-y-1.5 text-sm" data-testid="lab-timeline">
          {timeline.map((t) => (
            <li key={t.id} className="text-slate-800 dark:text-slate-200 break-words">
              {t.date} · {LAB_PROTOCOLS[t.protocol]?.label || t.protocol} · {t.status}
              {t.ftp != null && ` · FTP ${t.ftp} W`}
              {t.delta != null && <span className={t.delta >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-300'}> ({t.delta >= 0 ? '+' : ''}{t.delta} W)</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
