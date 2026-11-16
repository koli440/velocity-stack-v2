'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { LAB_PROTOCOL_IDS, LAB_PROTOCOLS } from '../lib/labProtocols'
import { fetchLabRuns, labErrorMessage } from '../lib/labRuns'
import { labBasePath } from '../lib/labFeatures'
import { buildTimeline, upcomingDates, validateScheduleForm } from '../lib/labSchedule'

const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition disabled:opacity-50'
const primary = `${btn} bg-indigo-600 border-indigo-600 text-white`
const quiet = `${btn} border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300`
const card = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4'
const input = 'rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-sm'
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
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">Repeat a test</h2>
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label>Test<br /><select value={protocol} onChange={(e) => setProtocol(e.target.value)} className={input}>
            {LAB_PROTOCOL_IDS.map((id) => <option key={id} value={id}>{LAB_PROTOCOLS[id].label}</option>)}
          </select></label>
          <label>Every (weeks)<br /><input inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} className={`${input} w-20`} /></label>
          <label>Start<br /><input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={input} /></label>
          <label>End (optional)<br /><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={input} /></label>
          <button className={primary} disabled={busy} onClick={save}>Save schedule</button>
        </div>
        <p className="mt-2 text-xs text-slate-500">The athlete gets a reminder 3 days before and on the day. Plan the test itself in the <Link className="text-indigo-600 font-bold" href={`${base}/protocols`}>protocol runner</Link>.</p>
        {msg?.error && <p className="mt-2 text-xs text-red-600" role="alert">{msg.error}</p>}
        {msg?.ok && <p className="mt-2 text-xs text-emerald-600">{msg.ok}</p>}
      </section>
      <section className={card}>
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">Schedules</h2>
        {schedules.length === 0 && <p className="text-xs text-slate-500">No schedules yet.</p>}
        <ul className="space-y-2">
          {schedules.map((s) => (
            <li key={s.id} className="text-xs text-slate-700 dark:text-slate-300 flex items-center gap-2" data-testid="lab-schedule">
              <span className="font-bold">{LAB_PROTOCOLS[s.protocol]?.label || s.protocol}</span>
              <span>every {s.interval_weeks} wk</span>
              <span>{s.active ? `next: ${upcomingDates(s, today(), 3).join(', ') || 'finished'}` : 'stopped'}</span>
              {s.active && <button className={quiet} onClick={() => stop(s.id)}>Stop</button>}
            </li>
          ))}
        </ul>
      </section>
      <section className={card}>
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white mb-2">Timeline</h2>
        {timeline.length === 0 && <p className="text-xs text-slate-500">No tests yet.</p>}
        <ol className="space-y-1 text-xs" data-testid="lab-timeline">
          {timeline.map((t) => (
            <li key={t.id} className="text-slate-700 dark:text-slate-300">
              {t.date} · {LAB_PROTOCOLS[t.protocol]?.label || t.protocol} · {t.status}
              {t.ftp != null && ` · FTP ${t.ftp} W`}
              {t.delta != null && <span className={t.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}> ({t.delta >= 0 ? '+' : ''}{t.delta} W)</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
