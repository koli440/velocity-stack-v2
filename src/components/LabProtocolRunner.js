'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LAB_PROTOCOL_IDS, LAB_PROTOCOLS } from '../lib/labProtocols'
import {
  cancelLabRun,
  createLabRun,
  detectFromActivities,
  fetchDetectionActivities,
  fetchLabRuns,
  labErrorMessage,
  markLabRunApplied,
  submitLabRun,
} from '../lib/labRuns'
import { activityDay, applyThreshold } from '../lib/applyThresholds'
import { ErrorNote, StatusNote, adminBtn, adminCard, adminInput } from './admin/AdminUi'

const primary = adminBtn.primary
const quiet = adminBtn.secondary
const card = adminCard

const today = () => new Date().toISOString().slice(0, 10)

// Protocol runner: pick a test, push it to the athlete's calendar, detect the result from the uploaded
// ride, review and apply FTP in one click (writes go through the normal history rules and RLS).
export default function LabProtocolRunner({ athleteId, viewerId }) {
  const [runs, setRuns] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [protocol, setProtocol] = useState(LAB_PROTOCOL_IDS[0])
  const [day, setDay] = useState(today())
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [detected, setDetected] = useState({})

  const load = useCallback(async () => {
    const res = await fetchLabRuns(supabase, athleteId)
    if (res.error) setError(labErrorMessage(res.error))
    setRuns(res.runs)
    setLoaded(true)
  }, [athleteId])

  useEffect(() => {
    if (athleteId) load()
  }, [athleteId, load])

  const run = async (key, fn) => {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  const create = () =>
    run('create', async () => {
      const res = await createLabRun(supabase, { athleteId, protocol, day })
      if (res.error) return setError(labErrorMessage(res.error))
      setNotice('Test pushed to the calendar.')
      await load()
    })

  const detect = (r) =>
    run(`detect-${r.id}`, async () => {
      const res = await fetchDetectionActivities(supabase, { athleteId, day: r.planned_date })
      if (res.error) return setError(labErrorMessage(res.error))
      const { best } = detectFromActivities(r.protocol, res.activities)
      if (!best) return setError('No ride with a matching effort was found around the planned day. Upload the ride first.')
      setDetected((d) => ({ ...d, [r.id]: best }))
    })

  const accept = (r) =>
    run(`accept-${r.id}`, async () => {
      const best = detected[r.id]
      const res = await submitLabRun(supabase, { runId: r.id, activityId: best.activity.id, result: best.result })
      if (res.error) return setError(labErrorMessage(res.error))
      setDetected((d) => ({ ...d, [r.id]: undefined }))
      await load()
    })

  const apply = (r, proposal) =>
    run(`apply-${r.id}`, async () => {
      const date = activityDay({ activity_date: r.activity_date }) || r.planned_date
      const base = { userId: athleteId, actorId: viewerId, field: proposal.field, value: proposal.value, date, source: { activityId: r.activity_id } }
      let res = await applyThreshold(supabase, base)
      if (res.needsConfirm) {
        if (!window.confirm(`An FTP entry already exists on ${date}. Overwrite it with ${proposal.value} W?`)) return
        res = await applyThreshold(supabase, { ...base, confirmOverwrite: true })
      }
      if (res.error) return setError(res.error)
      const marked = await markLabRunApplied(supabase, { runId: r.id, applied: { field: proposal.field, value: proposal.value, date } })
      if (marked.error) return setError(labErrorMessage(marked.error))
      setNotice(`FTP ${proposal.value} W applied from ${date}. Zones follow the FTP unless custom zones are set.`)
      await load()
    })

  const cancel = (r) =>
    run(`cancel-${r.id}`, async () => {
      const res = await cancelLabRun(supabase, r.id)
      if (res.error) return setError(labErrorMessage(res.error))
      await load()
    })

  const p = LAB_PROTOCOLS[protocol]
  return (
    <div className="space-y-4" data-testid="lab-protocols">
      <section className={card}>
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">Plan a field test</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {LAB_PROTOCOL_IDS.map((id) => (
            <button key={id} type="button" onClick={() => setProtocol(id)} className={id === protocol ? primary : quiet} data-testid={`lab-protocol-${id}`}>
              {LAB_PROTOCOLS[id].label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">{p.summary}</p>
        <ol className="mt-2 list-decimal pl-5 space-y-1 text-sm text-slate-700 dark:text-slate-200" data-testid="lab-brief">
          {p.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2">
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Test date" className={`${adminInput} sm:max-w-[11rem]`} />
          <button type="button" onClick={create} disabled={busy === 'create' || !day} className={primary} data-testid="lab-push">
            Push to calendar
          </button>
        </div>
      </section>

      {error && <div data-testid="lab-error"><ErrorNote>{error}</ErrorNote></div>}
      {notice && <StatusNote>{notice}</StatusNote>}

      <section className="space-y-3">
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">Tests</h2>
        {loaded && runs.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="lab-empty">No tests yet. Plan one above; it appears on the athlete&apos;s calendar.</p>}
        {runs.filter((r) => r.status !== 'cancelled').map((r) => {
          const cand = detected[r.id]
          const res = r.result
          return (
            <div key={r.id} className={card} data-testid="lab-run">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{LAB_PROTOCOLS[r.protocol]?.label || r.protocol}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{r.planned_date} · {r.status}{r.activity_title ? ` · ${r.activity_title}` : ''}</p>
                </div>
                {r.status === 'planned' && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => detect(r)} disabled={busy === `detect-${r.id}`} className={quiet}>Detect from ride</button>
                    <button type="button" onClick={() => cancel(r)} disabled={busy === `cancel-${r.id}`} className={quiet}>Cancel</button>
                  </div>
                )}
              </div>
              {cand && (
                <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 p-3 text-sm text-slate-800 dark:text-slate-100" data-testid="lab-candidate">
                  <p className="font-bold">Found in “{cand.activity.title}”: {cand.result.efforts.map((e) => `${Math.round(e.durationSec / 60)} min ${e.avgW} W`).join(', ')}</p>
                  {cand.result.warnings.map((w) => <p key={w} className="text-amber-700 dark:text-amber-300">{w}</p>)}
                  <button type="button" onClick={() => accept(r)} disabled={busy === `accept-${r.id}`} className={`${primary} mt-2`}>Use this result</button>
                </div>
              )}
              {res && (
                <div className="mt-3 text-sm text-slate-800 dark:text-slate-200" data-testid="lab-result">
                  <p>{res.efforts?.map((e) => `${Math.round(e.durationSec / 60)} min: ${e.avgW} W`).join(' · ')}{res.cp ? ` · CP ${res.cp} W, W′ ${(res.wPrime / 1000).toFixed(1)} kJ` : ''}</p>
                  {r.status === 'completed' && (res.proposals || []).map((pr) => (
                    <button key={pr.label} type="button" onClick={() => apply(r, pr)} disabled={busy === `apply-${r.id}`} className={`${primary} mt-2 mr-2`} data-testid="lab-apply">
                      Apply {pr.label}
                    </button>
                  ))}
                  {r.status === 'applied' && r.applied && <p className="mt-1 font-bold text-emerald-700 dark:text-emerald-400">Applied: FTP {r.applied.value} W from {r.applied.date}</p>}
                </div>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}
