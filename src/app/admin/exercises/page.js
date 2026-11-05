'use client'

// Admin: map free-text gym exercise names (not linked to the catalogue) onto catalogue exercises.
// Mapping links every matching row, adds the typed name as an alias, and marks affected sessions for re-scoring.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { normalizeText } from '../../../lib/exerciseCatalogue'

export default function AdminExercisesPage() {
  const [state, setState] = useState({ loading: true, admin: false, rows: [], catalogue: [] })
  const [choice, setChoice] = useState({})
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth?.user?.id
    const { data: prof } = uid ? await supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle() : { data: null }
    if (!prof?.is_admin) return setState({ loading: false, admin: false, rows: [], catalogue: [] })
    const [unmapped, cat] = await Promise.all([
      supabase.rpc('admin_unmapped_exercises', { p_limit: 200 }),
      supabase.from('exercise_catalogue').select('id, name').is('owner_id', null).order('name').limit(2000),
    ])
    setState({ loading: false, admin: true, rows: unmapped.data || [], catalogue: cat.data || [] })
  }, [])

  useEffect(() => { load() }, [load])

  const map = async (row) => {
    const typed = normalizeText(choice[row.name_key])
    const target = state.catalogue.find((c) => normalizeText(c.name) === typed)
    if (!target) return setMsg(`Pick an existing catalogue exercise for “${row.display_name}”.`)
    const { data, error } = await supabase.rpc('admin_map_exercises', { p_name_key: row.name_key, p_catalogue_id: target.id, p_add_alias: true })
    setMsg(error ? error.message : `Linked ${data} row(s) to ${target.name}; their sessions will be re-scored.`)
    if (!error) load()
  }

  if (state.loading) return <p className="p-6 text-sm text-slate-500">Loading…</p>
  if (!state.admin) return <p className="p-6 text-sm text-slate-500">Admins only.</p>

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Unmapped exercises</h1>
        <Link href="/admin/suggestions" className="text-xs underline text-slate-500">Suggestions</Link>
      </div>
      <p className="text-xs text-slate-500">Free-text names that are not in the catalogue. Map one to an existing exercise (its name is added as an alias), or approve a suggestion to add a new one.</p>
      <datalist id="catalogue-names">{state.catalogue.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      {msg && <p className="text-xs font-bold text-emerald-600" role="status">{msg}</p>}
      {state.rows.length === 0 && <p className="text-sm text-slate-500">Everything is mapped.</p>}
      {state.rows.map((r) => (
        <div key={r.name_key} className="p-3 rounded-2xl border border-slate-200 dark:border-surface-darkBorder flex flex-wrap items-center gap-2 text-sm">
          <div className="flex-1 min-w-[10rem]">
            <b>{r.display_name}</b>
            <span className="block text-xs text-slate-400">{r.uses} use(s) · {r.riders} rider(s)</span>
          </div>
          <input
            list="catalogue-names"
            className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 text-xs"
            placeholder="Catalogue exercise"
            aria-label={`Map ${r.display_name} to`}
            value={choice[r.name_key] || ''}
            onChange={(e) => setChoice((c) => ({ ...c, [r.name_key]: e.target.value }))}
          />
          <button type="button" onClick={() => map(r)} className="px-3 py-2 rounded-xl bg-orange-500 text-white text-[11px] font-black uppercase">Map</button>
        </div>
      ))}
    </div>
  )
}
