'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { useAthlete } from '../../../../components/AthleteContext'

// Read-only: the athlete's own analysis templates and how often they were run. Coach access
// is SELECT-only (see the coach RLS policies).
export default function AthleteTemplatesPage() {
  const { riderId, athlete } = useAthlete()
  const [state, setState] = useState(null)

  useEffect(() => {
    if (!riderId) return
    ;(async () => {
      const [tpl, runs] = await Promise.all([
        supabase
          .from('analysis_templates')
          .select('id, slug, name, category')
          .eq('user_id', riderId)
          .order('name'),
        supabase.from('template_executions').select('template_id').eq('user_id', riderId).limit(5000),
      ])
      const counts = {}
      for (const r of runs.data || []) counts[r.template_id] = (counts[r.template_id] || 0) + 1
      setState({ templates: tpl.data || [], counts })
    })()
  }, [riderId])

  if (!state) return <p className="text-xs text-slate-400">Loading…</p>
  return (
    <section className="space-y-2" data-testid="athlete-templates">
      <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
        Templates{athlete ? ` · ${athlete.display_name}` : ''}
      </h1>
      {state.templates.length === 0 && <p className="text-xs text-slate-500">No custom templates.</p>}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {state.templates.map((t) => (
          <li key={t.id} className="py-2 text-xs flex justify-between gap-3">
            <span className="font-semibold">
              {t.name}
              {t.category ? <span className="text-slate-500 font-normal"> · {t.category}</span> : null}
            </span>
            <span className="font-mono text-slate-500 shrink-0">{state.counts[t.id] || 0} runs</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
