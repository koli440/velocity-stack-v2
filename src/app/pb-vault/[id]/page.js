'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import { supabase, getAuthHeader } from '../../../lib/supabase'
import { parseJsonResponse } from '../../../lib/httpJson'
import {
  formatTime,
  formatDate,
  buildLapAnalysis,
  minutesSecondsToTotalSeconds,
  totalSecondsToMinutesSeconds,
} from '../../../lib/pbVault'

// "PB Detail Analysis" - migrated from v1's pages/31_PB_detail.py: a single record's metrics,
// its lap/split breakdown (if any), in-place editing and deletion. Requires an authenticated
// account (v1's check_access("PB Detail Analysis") gate), same as the vault list page.
export default function PbDetailPage() {
  const router = useRouter()
  const params = useParams()
  const pbId = params?.id

  const [checkingAuth, setCheckingAuth] = useState(true)
  const [loading, setLoading] = useState(true)
  const [pb, setPb] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const [isEditing, setIsEditing] = useState(false)
  const [editEventName, setEditEventName] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editMinutes, setEditMinutes] = useState(0)
  const [editSeconds, setEditSeconds] = useState(0)
  const [editChainring, setEditChainring] = useState(0)
  const [editCog, setEditCog] = useState(0)
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const loadPb = async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/personal-bests/${pbId}`, { headers: authHeader })
      const json = await parseJsonResponse(res)
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Record not found.')
      }
      const record = json.personalBest
      setPb(record)
      setEditEventName(record.event_name || '')
      setEditDate(record.achieved_date)
      const { minutes, seconds } = totalSecondsToMinutesSeconds(record.time_seconds)
      setEditMinutes(minutes)
      setEditSeconds(seconds)
      setEditChainring(record.chainring || 0)
      setEditCog(record.cog || 0)
      setEditNotes(record.notes || '')
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        router.push('/login')
        return
      }
      setCheckingAuth(false)
      loadPb()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pbId])

  const lapAnalysis = useMemo(() => {
    if (!pb || !Array.isArray(pb.lap_times) || pb.lap_times.length === 0) return []
    const segmentLen =
      pb.split_mode === 'laps' ? pb.split_distance_m : pb.split_distance_m || 0
    return buildLapAnalysis(pb.lap_times, segmentLen)
  }, [pb])

  const handleSave = async () => {
    setSaving(true)
    setErrorMsg(null)
    try {
      const authHeader = await getAuthHeader()
      const totalSeconds = minutesSecondsToTotalSeconds(editMinutes, editSeconds)
      const res = await fetch(`/api/personal-bests/${pbId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          eventName: editEventName,
          achievedDate: editDate,
          timeSeconds: totalSeconds,
          chainring: editChainring,
          cog: editCog,
          notes: editNotes,
        }),
      })
      const json = await parseJsonResponse(res)
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to save changes.')
      }
      setPb(json.personalBest)
      setIsEditing(false)
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = window.confirm('Permanently delete this Personal Best? This cannot be undone.')
    if (!confirmed) return

    try {
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/personal-bests/${pbId}`, {
        method: 'DELETE',
        headers: authHeader,
      })
      const json = await parseJsonResponse(res)
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to delete record.')
      }
      router.push('/pb-vault')
    } catch (err) {
      setErrorMsg(err.message)
    }
  }

  if (checkingAuth || loading) {
    return (
      <div className="py-24 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
        Loading Personal Best...
      </div>
    )
  }

  if (errorMsg && !pb) {
    return (
      <div className="w-full space-y-4">
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-semibold">
          {errorMsg}
        </div>
        <Link href="/pb-vault" className="text-sm font-bold text-emerald-600 dark:text-brand-neon hover:underline">
          ⬅️ Back to PB Vault
        </Link>
      </div>
    )
  }

  const metric = (label, value, unit) => (
    <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
      <span className="text-xs uppercase font-bold text-slate-400">{label}</span>
      <div className="text-2xl font-black text-emerald-500 dark:text-brand-neon tracking-tight mt-1">
        {value}
        {unit && <span className="text-base font-bold text-slate-400 ml-1">{unit}</span>}
      </div>
    </div>
  )

  return (
    <div className="w-full space-y-6">
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-semibold">
          {errorMsg}
        </div>
      )}

      <div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
          🏆 {pb.event_name || 'Unnamed Session'}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {pb.discipline} | {pb.track_name || 'No track'} | {formatDate(pb.achieved_date)}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {metric('Final Time', formatTime(pb.time_seconds))}
        {metric('Avg Speed', pb.avg_speed_kmh ?? '—', 'km/h')}
        {metric('Gear', pb.chainring && pb.cog ? `${pb.chainring}x${pb.cog}` : '—')}
        {metric('Distance', pb.discipline_distance_m, 'm')}
      </div>

      {pb.notes && (
        <div className="bg-white dark:bg-surface-darkCard p-4 rounded-2xl border border-slate-200 dark:border-surface-darkBorder text-sm text-slate-600 dark:text-slate-300">
          📝 <span className="font-semibold">Notes:</span> {pb.notes}
        </div>
      )}

      {lapAnalysis.length > 0 && (
        <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            ⏱️ Performance Analysis ({pb.split_mode === 'laps' ? 'Laps' : 'Fixed Distance'})
          </h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={lapAnalysis}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="segment" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="time" name="Split Time (s)" stroke="#ef4444" strokeWidth={3} />
                <Line type="monotone" dataKey="speedKmh" name="Speed (km/h)" stroke="#38bdf8" strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400 uppercase font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 pr-3">Segment</th>
                  <th className="py-2 pr-3">Split Time</th>
                  <th className="py-2 pr-3">Total Time</th>
                  <th className="py-2 pr-3">Speed (km/h)</th>
                  <th className="py-2 pr-3">Distance (m)</th>
                </tr>
              </thead>
              <tbody>
                {lapAnalysis.map((row) => (
                  <tr key={row.segment} className="border-b border-slate-100 dark:border-slate-800/60">
                    <td className="py-2 pr-3 font-semibold">{row.segment}</td>
                    <td className="py-2 pr-3">{formatTime(row.time)}</td>
                    <td className="py-2 pr-3">{formatTime(row.totalTime)}</td>
                    <td className="py-2 pr-3">{row.speedKmh.toFixed(2)}</td>
                    <td className="py-2 pr-3">{row.distanceM.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-surface-darkCard rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
        <button
          onClick={() => setIsEditing((v) => !v)}
          className="w-full text-left px-5 py-4 text-sm font-bold text-slate-900 dark:text-white flex items-center justify-between"
        >
          ✏️ Edit PB Details
          <span className="text-xs">{isEditing ? '▾' : '▸'}</span>
        </button>

        {isEditing && (
          <div className="px-5 pb-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1.5">
                <span className="text-xs uppercase font-bold text-slate-400">Event Name</span>
                <input
                  type="text"
                  value={editEventName}
                  onChange={(e) => setEditEventName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs uppercase font-bold text-slate-400">Date</span>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="block space-y-1.5">
                <span className="text-xs uppercase font-bold text-slate-400">Min</span>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={editMinutes}
                  onChange={(e) => setEditMinutes(Number(e.target.value))}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs uppercase font-bold text-slate-400">Sec</span>
                <input
                  type="number"
                  min={0}
                  max={59.99}
                  step={0.01}
                  value={editSeconds}
                  onChange={(e) => setEditSeconds(Number(e.target.value))}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="block space-y-1.5">
                <span className="text-xs uppercase font-bold text-slate-400">Chainring</span>
                <input
                  type="number"
                  min={30}
                  max={80}
                  value={editChainring}
                  onChange={(e) => setEditChainring(Number(e.target.value))}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs uppercase font-bold text-slate-400">Cog</span>
                <input
                  type="number"
                  min={10}
                  max={25}
                  value={editCog}
                  onChange={(e) => setEditCog(Number(e.target.value))}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </label>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs uppercase font-bold text-slate-400">Notes</span>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </label>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white dark:text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg transition active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save All Changes'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-rose-500/5 border border-rose-500/30 rounded-2xl p-5 space-y-3">
        <p className="text-xs font-bold text-rose-500 uppercase tracking-wider">🗑️ Danger Zone</p>
        <p className="text-xs text-rose-500/80">Are you sure? This cannot be undone.</p>
        <button
          onClick={handleDelete}
          className="w-full py-3 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs uppercase tracking-wider shadow-lg transition active:scale-[0.98]"
        >
          Confirm Permanent Delete
        </button>
      </div>

      <Link
        href="/pb-vault"
        className="block text-center py-3 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition"
      >
        ⬅️ Back to PB Vault
      </Link>
    </div>
  )
}
