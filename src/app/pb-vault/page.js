'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getAuthHeader } from '../../lib/supabase'
import { parseJsonResponse } from '../../lib/httpJson'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { formatTime, formatDate } from '../../lib/pbVault'
import AddPbModal from '../../components/AddPbModal'

// "PB Vault" - migrated from v1's pages/30_PB_vault.py. Requires an authenticated account
// (v1's check_access("PB Vault") gate); unauthenticated visitors are redirected to /login, same
// as the rest of the account-gated flows in this app.
export default function PbVaultPage() {
  const router = useRouter()
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [user, setUser] = useState(null)
  const [personalBests, setPersonalBests] = useState([])
  const [tracks, setTracks] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState(null)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [disciplineFilter, setDisciplineFilter] = useState('All')

  const loadPersonalBests = async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const authHeader = await getAuthHeader()
      const res = await fetch('/api/personal-bests', { headers: authHeader })
      const json = await parseJsonResponse(res)
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to load your PB Vault.')
      }
      setPersonalBests(json.personalBests || [])
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
      setUser(session.user)
      setCheckingAuth(false)
      loadPersonalBests()
    })

    supabase.from('tracks').select('*').order('name').then(({ data }) => {
      setTracks(data || [])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDelete = async (id) => {
    const confirmed = window.confirm('Permanently delete this Personal Best? This cannot be undone.')
    if (!confirmed) return

    try {
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/personal-bests/${id}`, {
        method: 'DELETE',
        headers: authHeader,
      })
      const json = await parseJsonResponse(res)
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to delete record.')
      }
      setPersonalBests((prev) => prev.filter((pb) => pb.id !== id))
    } catch (err) {
      setErrorMsg(err.message)
    }
  }

  const availableDisciplines = useMemo(
    () => ['All', ...new Set(personalBests.map((pb) => pb.discipline))],
    [personalBests]
  )

  const filtered = useMemo(() => {
    if (disciplineFilter === 'All') return personalBests
    return personalBests.filter((pb) => pb.discipline === disciplineFilter)
  }, [personalBests, disciplineFilter])

  // Progress trend chart (v1's plotly line chart), only shown for a specific discipline - same
  // "select a discipline to visualize your progress" gating v1 used.
  const chartData = useMemo(() => {
    if (disciplineFilter === 'All') return []
    return [...filtered]
      .sort((a, b) => new Date(a.achieved_date) - new Date(b.achieved_date))
      .map((pb) => ({
        date: formatDate(pb.achieved_date),
        timeSeconds: pb.time_seconds,
      }))
  }, [filtered, disciplineFilter])

  const ranked = useMemo(() => {
    const copy = [...filtered]
    if (disciplineFilter === 'All') {
      return copy.sort((a, b) => new Date(b.achieved_date) - new Date(a.achieved_date))
    }
    return copy.sort((a, b) => a.time_seconds - b.time_seconds)
  }, [filtered, disciplineFilter])

  if (checkingAuth) {
    return (
      <div className="py-24 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
        Checking your session...
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">🏆 My PB Vault</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Logged in as: <span className="font-semibold">{user?.email}</span>
          </p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold uppercase tracking-wider shadow-lg transition active:scale-[0.98]"
        >
          ➕ Add New Personal Best
        </button>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-semibold">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="py-24 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
          Loading your vault...
        </div>
      ) : personalBests.length === 0 ? (
        <div className="bg-white dark:bg-surface-darkCard p-8 rounded-2xl border border-slate-200 dark:border-surface-darkBorder text-center text-sm text-slate-500 dark:text-slate-400">
          Your vault is empty. Add your first PB above!
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-4">
            <label className="block space-y-1.5 max-w-xs">
              <span className="text-xs uppercase font-bold text-slate-400">
                Filter by discipline
              </span>
              <select
                value={disciplineFilter}
                onChange={(e) => setDisciplineFilter(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
              >
                {availableDisciplines.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>

            {disciplineFilter !== 'All' && chartData.length > 0 && (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} label={{ value: 'Time (s)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="timeSeconds"
                      name="Time (s)"
                      stroke="#10b981"
                      strokeWidth={3}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 uppercase font-bold border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2 pr-3">Event</th>
                    <th className="py-2 pr-3">Date</th>
                    {disciplineFilter === 'All' && <th className="py-2 pr-3">Discipline</th>}
                    <th className="py-2 pr-3">Time</th>
                    <th className="py-2 pr-3">Speed (km/h)</th>
                    <th className="py-2 pr-3">Track</th>
                    <th className="py-2 pr-3">Gear</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((pb) => (
                    <tr
                      key={pb.id}
                      className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-2.5 pr-3 font-semibold text-slate-900 dark:text-white">
                        {pb.event_name || '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-500 dark:text-slate-400">
                        {formatDate(pb.achieved_date)}
                      </td>
                      {disciplineFilter === 'All' && (
                        <td className="py-2.5 pr-3 text-slate-500 dark:text-slate-400">
                          {pb.discipline}
                        </td>
                      )}
                      <td className="py-2.5 pr-3 font-mono font-bold text-emerald-600 dark:text-brand-neon">
                        {formatTime(pb.time_seconds)}
                      </td>
                      <td className="py-2.5 pr-3">{pb.avg_speed_kmh ?? '—'}</td>
                      <td className="py-2.5 pr-3">{pb.track_name || '—'}</td>
                      <td className="py-2.5 pr-3">
                        {pb.chainring && pb.cog ? `${pb.chainring}x${pb.cog}` : '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() => router.push(`/pb-vault/${pb.id}`)}
                          className="font-bold text-sky-600 dark:text-sky-400 hover:underline"
                        >
                          Details
                        </button>
                        <button
                          onClick={() => handleDelete(pb.id)}
                          className="font-bold text-rose-500 hover:underline"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <AddPbModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        tracks={tracks}
        onSaved={() => loadPersonalBests()}
      />
    </div>
  )
}
