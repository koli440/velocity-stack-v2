'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getAuthHeader } from '../../lib/supabase'
import { parseJsonResponse } from '../../lib/httpJson'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts'
import AeroTestForm from '../../components/AeroTestForm'

// Color scale for the CdA comparison chart: lower CdA (better) is greener, higher (worse) is
// redder - approximates v1's plotly "Reds_r" continuous color scale with a small fixed palette.
const CDA_BAR_COLORS = ['#10b981', '#f59e0b', '#ef4444']

function cdaBarColor(index, total) {
  if (total <= 1) return CDA_BAR_COLORS[0]
  const position = index / (total - 1)
  if (position < 0.34) return CDA_BAR_COLORS[0]
  if (position < 0.67) return CDA_BAR_COLORS[1]
  return CDA_BAR_COLORS[2]
}

// "Aero Lab: CdA Optimization" - migrated from v1's pages/50_aero_lab.py. Requires an
// authenticated account (v1's check_access("Aero Lab") gate); unauthenticated visitors are
// redirected to /login, same as the rest of the account-gated flows in this app (PB Vault, etc).
export default function AeroLabPage() {
  const router = useRouter()
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [user, setUser] = useState(null)
  const [tracks, setTracks] = useState([])
  const [aeroTests, setAeroTests] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState(null)

  const loadAeroTests = async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const authHeader = await getAuthHeader()
      const res = await fetch('/api/aero-tests', { headers: authHeader })
      const json = await parseJsonResponse(res)
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to load your Aero Lab history.')
      }
      setAeroTests(json.aeroTests || [])
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
      loadAeroTests()
    })

    supabase
      .from('tracks')
      .select('*')
      .order('name')
      .then(({ data }) => {
        setTracks(data || [])
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDelete = async (id, positionName) => {
    const confirmed = window.confirm(`Permanently delete the "${positionName}" test? This cannot be undone.`)
    if (!confirmed) return

    try {
      const authHeader = await getAuthHeader()
      const res = await fetch(`/api/aero-tests/${id}`, {
        method: 'DELETE',
        headers: authHeader,
      })
      const json = await parseJsonResponse(res)
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to delete record.')
      }
      setAeroTests((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      setErrorMsg(err.message)
    }
  }

  // CdA comparison chart (v1's horizontal plotly bar chart), sorted lowest (best) to highest.
  const chartData = useMemo(
    () =>
      [...aeroTests]
        .sort((a, b) => a.cda - b.cda)
        .map((t) => ({ name: t.position_name, cda: t.cda })),
    [aeroTests]
  )

  const sortedHistory = useMemo(
    () => [...aeroTests].sort((a, b) => new Date(b.test_date) - new Date(a.test_date)),
    [aeroTests]
  )

  if (checkingAuth) {
    return (
      <div className="py-24 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
        Checking your session...
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
          🧪 Aero Lab: CdA Optimization
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Logged in as: <span className="font-semibold">{user?.email}</span>
        </p>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-semibold">
          {errorMsg}
        </div>
      )}

      <details className="bg-white dark:bg-surface-darkCard rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm p-5">
        <summary className="text-sm font-black uppercase tracking-wide text-slate-900 dark:text-white cursor-pointer">
          📖 READ FIRST: Testing Protocol &amp; Best Practices
        </summary>
        <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <h3 className="font-bold text-slate-900 dark:text-white">
            🎯 Goal: Get consistent and repeatable CdA data
          </h3>
          <p>
            Field testing is based on the <span className="font-semibold">Chung Method</span>{' '}
            logic. We measure how much power is needed to overcome air resistance at a certain
            speed. To make this work, you must be the most consistent variable in the equation.
          </p>
          <h4 className="font-bold text-slate-900 dark:text-white">The Gold Rules of Aero Testing:</h4>
          <ol className="list-decimal list-inside space-y-1.5">
            <li>
              <span className="font-semibold">Freeze Your Position:</span> From the moment you
              start the timed laps, do not move. Even a look down at your bike computer changes
              your CdA.
            </li>
            <li>
              <span className="font-semibold">Line Choice:</span> Stay glued to the black line.
              Any deviation in distance makes the speed data inaccurate.
            </li>
            <li>
              <span className="font-semibold">Constant Effort:</span> Surges in power create
              &apos;noise&apos; in the data. Aim for a &apos;flat&apos; power file.
            </li>
            <li>
              <span className="font-semibold">Equipment Check:</span> Ensure your tires are
              pumped to the exact same PSI for every single test run.
            </li>
          </ol>
          <h4 className="font-bold text-slate-900 dark:text-white">How to use this Lab:</h4>
          <ul className="list-disc list-inside space-y-1.5">
            <li>Perform a Baseline Run first (your current standard setup).</li>
            <li>Change ONLY ONE thing at a time (e.g., just the helmet, or just the hand height).</li>
            <li>Run the test again and compare the CdA in the chart below.</li>
          </ul>
        </div>
      </details>

      <AeroTestForm tracks={tracks} onSaved={() => loadAeroTests()} />

      <div className="space-y-4">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-900 dark:text-white">
          📊 Aero Test Analysis &amp; History
        </h2>

        {loading ? (
          <div className="py-12 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
            Loading your tests...
          </div>
        ) : aeroTests.length === 0 ? (
          <div className="bg-white dark:bg-surface-darkCard p-8 rounded-2xl border border-slate-200 dark:border-surface-darkBorder text-center text-sm text-slate-500 dark:text-slate-400">
            No saved tests found. Perform and save your first test above!
          </div>
        ) : (
          <div className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-6">
            <div>
              <h3 className="text-xs uppercase font-bold text-slate-400 mb-2">
                CdA Comparison (lower is better)
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip formatter={(value) => `${Number(value).toFixed(3)} m²`} />
                    <Bar dataKey="cda" radius={[0, 6, 6, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={entry.name} fill={cdaBarColor(index, chartData.length)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <h3 className="text-xs uppercase font-bold text-slate-400 mb-2">Detailed History</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-400 uppercase font-bold border-b border-slate-200 dark:border-slate-800">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Position</th>
                      <th className="py-2 pr-3">Track</th>
                      <th className="py-2 pr-3">CdA</th>
                      <th className="py-2 pr-3">Speed (km/h)</th>
                      <th className="py-2 pr-3">Power (W)</th>
                      <th className="py-2 pr-3">Bike</th>
                      <th className="py-2 pr-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHistory.map((t) => (
                      <tr
                        key={t.id}
                        className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <td className="py-2.5 pr-3 text-slate-500 dark:text-slate-400">
                          {new Date(t.test_date).toLocaleString()}
                        </td>
                        <td className="py-2.5 pr-3 font-semibold text-slate-900 dark:text-white">
                          {t.position_name}
                        </td>
                        <td className="py-2.5 pr-3">{t.track_name || '—'}</td>
                        <td className="py-2.5 pr-3 font-mono font-bold text-emerald-600 dark:text-brand-neon">
                          {Number(t.cda).toFixed(3)}
                        </td>
                        <td className="py-2.5 pr-3">{t.speed_kmh}</td>
                        <td className="py-2.5 pr-3">{t.power_w}</td>
                        <td className="py-2.5 pr-3">{t.bike || '—'}</td>
                        <td className="py-2.5 pr-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => handleDelete(t.id, t.position_name)}
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
          </div>
        )}
      </div>
    </div>
  )
}
