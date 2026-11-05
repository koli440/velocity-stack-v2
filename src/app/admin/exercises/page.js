'use client'

// Admin: map free-text gym exercise names (not linked to the catalogue) onto catalogue exercises.
// Mapping links every matching row, adds the typed name as an alias, and marks affected sessions for re-scoring.

import { useCallback, useEffect, useState } from 'react'
import Icon from '../../../components/Icon'
import { AdminPage, AdminMessage, EmptyState, StatusNote, adminCard, adminMuted, adminInput, adminBtn } from '../../../components/admin/AdminUi'
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

  if (state.loading) return <AdminMessage>Loading…</AdminMessage>
  if (!state.admin) return <AdminMessage>Admins only.</AdminMessage>

  return (
    <AdminPage
      title="Unmapped exercises"
      description="Free-text names that are not in the catalogue. Map one to an existing exercise (its name is added as an alias), or approve a suggestion to add a new one."
    >
      <datalist id="catalogue-names">{state.catalogue.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <StatusNote>{msg}</StatusNote>
      {state.rows.length === 0 && <EmptyState>Everything is mapped.</EmptyState>}
      <ul className="space-y-3">
        {state.rows.map((r) => (
          <li key={r.name_key} className={`${adminCard} flex flex-col md:flex-row md:items-center gap-3`}>
            <div className="min-w-0 md:flex-1">
              <div className="text-sm font-bold text-slate-900 dark:text-white break-words" title={r.display_name}>{r.display_name}</div>
              <div className={`text-xs ${adminMuted}`}>{r.uses} use(s) · {r.riders} rider(s)</div>
            </div>
            <input
              list="catalogue-names"
              className={`${adminInput} md:w-72`}
              placeholder="Catalogue exercise"
              aria-label={`Map ${r.display_name} to`}
              value={choice[r.name_key] || ''}
              onChange={(e) => setChoice((c) => ({ ...c, [r.name_key]: e.target.value }))}
            />
            <button type="button" onClick={() => map(r)} className={`${adminBtn.primary} w-full md:w-auto`}>
              <Icon name="check" /> Map
            </button>
          </li>
        ))}
      </ul>
    </AdminPage>
  )
}
