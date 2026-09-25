'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import Sidebar from '../../../components/Sidebar'
import ThemeToggle from '../../../components/ThemeToggle'
import ProfileSettingsModal from '../../../components/ProfileSettingsModal'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'

export default function ActivityDetailPage() {
  const params = useParams()
  const router = useRouter()
  const activityId = params?.id

  const [user, setUser] = useState(null)
  const [activity, setActivity] = useState(null)
  const [curves, setCurves] = useState({})
  const [activeMetric, setActiveMetric] = useState('Cadence')
  const [loading, setLoading] = useState(true)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)

  const metricColors = {
    Cadence: { stroke: '#F97316', activeTab: 'bg-orange-500 text-white', unit: 'RPM' },
    Speed: { stroke: '#38BDF8', activeTab: 'bg-sky-500 text-slate-900', unit: 'km/h' },
    Power: { stroke: '#A78BFA', activeTab: 'bg-purple-500 text-white', unit: 'W' },
    Torque: { stroke: '#34D399', activeTab: 'bg-emerald-500 text-slate-900', unit: 'Nm' },
    HeartRate: { stroke: '#FB7185', activeTab: 'bg-rose-500 text-white', unit: 'BPM' },
  }

  // 1. Ověření session uživatele
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        router.push('/login')
      } else {
        setUser(session.user)
      }
    })
  }, [router])

  // 2. Načtení dat aktivity a křivek z existující tabulky activity_curves
  useEffect(() => {
    if (!activityId) return

    const loadData = async () => {
      setLoading(true)

      const { data: actData, error: actErr } = await supabase
        .from('activities')
        .select('*, tracks(*)')
        .eq('id', activityId)
        .maybeSingle()

      if (actErr || !actData) {
        setLoading(false)
        return
      }

      setActivity(actData)

      // Načtení křivek ze sloupce data tabulky activity_curves
      const { data: curvesData } = await supabase
        .from('activity_curves')
        .select('*')
        .eq('activity_id', activityId)

      if (curvesData && curvesData.length > 0) {
        const map = {}
        curvesData.forEach((row) => {
          map[row.curve_type] = row.data
        })
        setCurves(map)
        const keys = Object.keys(map)
        if (keys.length > 0 && !map[activeMetric]) {
          setActiveMetric(keys[0])
        }
      }

      setLoading(false)
    }

    loadData()
  }, [activityId])

  const chartData = curves[activeMetric]
    ? Object.entries(curves[activeMetric]).map(([label, value]) => ({
        interval: label,
        value: value,
      }))
    : []

  const currentStroke = metricColors[activeMetric]?.stroke || '#F97316'
  const availableMetricKeys = Object.keys(curves)

  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-surface-dark transition-colors duration-300">
            {/* Metriky */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-4 bg-white dark:bg-surface-darkCard rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
                <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  Max Cadence
                </div>
                <div className="text-3xl font-black text-orange-500 mt-1 font-mono">
                  {activity.max_cadence_rpm ?? '-'}{' '}
                  <span className="text-xs font-normal text-slate-400">RPM</span>
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-surface-darkCard rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
                <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  Max Speed
                </div>
                <div className="text-3xl font-black text-sky-500 mt-1 font-mono">
                  {activity.max_speed_kmh ?? '-'}{' '}
                  <span className="text-xs font-normal text-slate-400">km/h</span>
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-surface-darkCard rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
                <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  Max Power
                </div>
                <div className="text-3xl font-black text-purple-500 mt-1 font-mono">
                  {activity.max_power_w ?? '-'}{' '}
                  <span className="text-xs font-normal text-slate-400">W</span>
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-surface-darkCard rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm">
                <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  Peak Torque
                </div>
                <div className="text-3xl font-black text-emerald-500 mt-1 font-mono">
                  {activity.peak_torque_nm ?? '-'}{' '}
                  <span className="text-xs font-normal text-slate-400">Nm</span>
                </div>
              </div>
            </div>

            {/* Graf křivek */}
            <section className="bg-white dark:bg-surface-darkCard p-6 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-white uppercase tracking-tight">
                  Durational Curves
                </h2>

                <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                  {availableMetricKeys.map((metric) => {
                    const isActive = activeMetric === metric
                    const tabStyle = metricColors[metric]?.activeTab || 'bg-orange-500 text-white'
                    return (
                      <button
                        key={metric}
                        onClick={() => setActiveMetric(metric)}
                        className={`py-1 px-3 rounded-lg text-xs font-bold transition ${
                          isActive
                            ? `${tabStyle} shadow-sm`
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {metric}
                      </button>
                    )
                  })}
                </div>
              </div>

              {chartData.length > 0 ? (
                <div className="h-80 w-full pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 15, left: -15, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                      <XAxis dataKey="interval" stroke="#94A3B8" tick={{ fontSize: 12 }} />
                      <YAxis stroke="#94A3B8" domain={['auto', 'auto']} tick={{ fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(15, 23, 42, 0.95)',
                          borderColor: 'rgba(51, 65, 85, 0.8)',
                          borderRadius: '0.75rem',
                          color: '#F8FAFC',
                          fontSize: '12px',
                        }}
                        formatter={(val) => [
                          `${val} ${metricColors[activeMetric]?.unit || ''}`,
                          activeMetric,
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke={currentStroke}
                        strokeWidth={3}
                        dot={{ fill: currentStroke, r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-400">
                  No curve data available for this metric.
                </div>
              )}
            </section>
          </div>
        
      </main>
    </div>
  )
}
