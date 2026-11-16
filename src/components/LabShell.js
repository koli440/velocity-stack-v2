'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { LAB_FEATURES, labBasePath, labFeature } from '../lib/labFeatures'
import LabProtocolRunner from './LabProtocolRunner'
import LabLactateTest from './LabLactateTest'
import LabScheduler from './LabScheduler'
import LabPowerProfile from './LabPowerProfile'
import LabDurability from './LabDurability'

const FEATURE_COMPONENTS = { protocols: LabProtocolRunner, lactate: LabLactateTest, schedule: LabScheduler, profile: LabPowerProfile, durability: LabDurability }

// Lab pages for a coached athlete (riderId set, /coach/<id>/lab) or the signed-in user's own results (/lab).
// Access is decided by the database (is_coach_of / own rows); errors surface in the components.
export default function LabShell({ riderId = null, feature = null }) {
  const [viewerId, setViewerId] = useState(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setViewerId(data?.session?.user?.id || null))
  }, [])
  const athleteId = riderId || viewerId
  const base = labBasePath(riderId)
  const active = feature ? labFeature(feature) : null
  const Feature = active ? FEATURE_COMPONENTS[active.key] : null

  if (!athleteId) return null
  return (
    <div className="space-y-4" data-testid="lab-shell">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
          {active ? active.label : 'Lab'}
        </h1>
        {active && <Link href={base} className="text-xs font-bold text-indigo-600">All lab tools</Link>}
      </div>
      {Feature ? (
        <Feature athleteId={athleteId} viewerId={viewerId} riderId={riderId} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="lab-index">
          {LAB_FEATURES.map((f) => (
            <li key={f.key}>
              <Link href={`${base}/${f.key}`} className="block rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-indigo-400">
                <p className="text-sm font-extrabold text-slate-900 dark:text-white">{f.label}</p>
                <p className="mt-1 text-xs text-slate-500">{f.desc}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
