'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import Icon from './Icon'
import { AdminPage, adminCard, adminMuted } from './admin/AdminUi'
import { LAB_FEATURES, labBasePath, labFeature } from '../lib/labFeatures'
import LabProtocolRunner from './LabProtocolRunner'
import LabLactateTest from './LabLactateTest'
import LabScheduler from './LabScheduler'
import LabPowerProfile from './LabPowerProfile'
import LabDurability from './LabDurability'
import LabDecoupling from './LabDecoupling'
import LabFieldForms from './LabFieldForms'
import { LabBikeFit, LabCadence, LabFueling, LabPedalling } from './LabMeasurements'
import LabReports from './LabReports'
import PageBreadcrumb from './PageBreadcrumb'

const FEATURE_COMPONENTS = { protocols: LabProtocolRunner, lactate: LabLactateTest, schedule: LabScheduler, profile: LabPowerProfile, durability: LabDurability, decoupling: LabDecoupling, forms: LabFieldForms, fueling: LabFueling, fit: LabBikeFit, pedalling: LabPedalling, cadence: LabCadence, reports: LabReports }

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
    <AdminPage
      title={active ? active.label : 'Lab'}
      description={active ? active.desc : 'Field tests, thresholds and reports for your training.'}
      back={active ? { href: base, label: 'All lab tools' } : null}
      width="max-w-4xl"
    >
      <div className="space-y-5" data-testid="lab-shell">
        <PageBreadcrumb items={[{ label: 'Lab', href: active ? base : undefined }, ...(active ? [{ label: active.label }] : [])]} />
        {Feature ? (
          <Feature athleteId={athleteId} viewerId={viewerId} riderId={riderId} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2" data-testid="lab-index">
            {LAB_FEATURES.map((f) => (
              <li key={f.key} className="flex">
                <Link href={`${base}/${f.key}`} className={`${adminCard} w-full flex items-start gap-3 hover:border-orange-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500`}>
                  <span className="shrink-0 mt-0.5 text-orange-600 dark:text-orange-400"><Icon name={f.icon || 'flask'} size={22} /></span>
                  <span className="min-w-0">
                    <span className="block text-base font-black text-slate-900 dark:text-white">{f.label}</span>
                    <span className={`mt-1 block text-sm ${adminMuted}`}>{f.desc}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminPage>
  )
}
