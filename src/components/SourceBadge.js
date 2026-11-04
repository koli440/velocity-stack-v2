'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { importSourceKey, sourceBadgeLabel } from '../lib/activitySource'

let namesPromise = null
function loadAppNames() {
  if (!namesPromise) {
    namesPromise = supabase.from('developer_apps').select('slug, name').eq('status', 'approved')
      .then(({ data }) => Object.fromEntries((data || []).map((a) => [a.slug, a.name])), () => ({}))
  }
  return namesPromise
}

/** Small "via Garmin" / "via <partner app>" badge. Renders nothing for manual uploads. */
export default function SourceBadge({ act, testId = 'source-badge', className = '' }) {
  const isPartner = importSourceKey(act)?.startsWith('partner:')
  const [names, setNames] = useState({})
  useEffect(() => {
    if (isPartner) loadAppNames().then(setNames)
  }, [isPartner])
  const label = sourceBadgeLabel(act, names)
  if (!label) return null
  return (
    <span data-testid={testId} className={`inline-block px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-600 dark:text-slate-300 text-[10px] font-black uppercase tracking-wider ${className}`}>
      via {label}
    </span>
  )
}
