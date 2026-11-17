'use client'

import { useCallback, useEffect, useState } from 'react'
import { AdminPage, AdminMessage, adminCard, adminMuted, adminBtn, adminInput } from '../../../components/admin/AdminUi'
import { supabase } from '../../../lib/supabase'
import { tierLimitLabel } from '../../../lib/coachPlans'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const intOrNull = (v) => (String(v).trim() === '' ? null : Number(v))

export default function AdminCoachPlansPage() {
  const [s, setS] = useState(null)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState(null)
  const [coach, setCoach] = useState('')
  const [tier, setTier] = useState('roster_unlimited')
  const [cap, setCap] = useState('')
  const [edits, setEdits] = useState({})

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('admin_coach_plans_status')
    if (err) return setDenied(true)
    setS(data)
    setCap(String(data.founding_cap))
    setEdits(Object.fromEntries(data.tiers.map((t) => [t.tier_key, { name: t.name, max: t.max_athletes ?? '', price: t.price_cents ?? '' }])))
  }, [])
  useEffect(() => { load() }, [load])

  const run = async (fn, args) => {
    setError(null)
    const { error: err } = await supabase.rpc(fn, args)
    if (err) setError(/cap reached/i.test(err.message) ? 'Founding coach cap reached.' : /coach card/i.test(err.message) ? 'That user has no coach card.' : 'Could not save the change.')
    load()
  }
  if (denied) return <AdminMessage>Admins only.</AdminMessage>
  if (!s) return <AdminMessage>Loading…</AdminMessage>

  return (
    <AdminPage title="Coach plans" description="Limits, founding coaches and enforcement. Nothing is charged; enforcement is off by default.">
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <section className={`${adminCard} space-y-3`}>
        <h2 className="text-lg font-black text-slate-900 dark:text-white">Enforcement</h2>
        <p className={`text-sm ${adminMuted}`}>Currently <strong>{s.enforced ? 'on' : 'off (soft limits only)'}</strong>. When on, only NEW athlete acceptances above a coach&apos;s limit are blocked; existing athletes, chat and exports are never locked. Founders and bot coaches are exempt from the Free limit.</p>
        <button className={s.enforced ? adminBtn.danger : adminBtn.primary} onClick={() => run('admin_set_coach_plans', { p_enforced: !s.enforced, p_founding_cap: null })}>
          {s.enforced ? 'Turn enforcement off' : 'Turn enforcement on'}
        </button>
      </section>
      <section className={`${adminCard} space-y-3`}>
        <h2 className="text-lg font-black text-slate-900 dark:text-white">Tiers</h2>
        <ul className="space-y-2">
          {s.tiers.map((t) => {
            const e = edits[t.tier_key] || {}
            const set = (k, v) => setEdits({ ...edits, [t.tier_key]: { ...e, [k]: v } })
            return (
              <li key={t.tier_key} className="flex flex-wrap items-end gap-2">
                <span className="w-32 text-sm font-bold text-slate-900 dark:text-white">{t.tier_key}</span>
                <label className="text-xs text-slate-700 dark:text-slate-300">Name<input aria-label={`Name ${t.tier_key}`} className={`${adminInput} w-40`} value={e.name ?? ''} onChange={(ev) => set('name', ev.target.value)} /></label>
                <label className="text-xs text-slate-700 dark:text-slate-300">Max athletes (empty = unlimited)<input aria-label={`Max athletes ${t.tier_key}`} className={`${adminInput} w-28`} value={e.max ?? ''} onChange={(ev) => set('max', ev.target.value)} /></label>
                <label className="text-xs text-slate-700 dark:text-slate-300">Price cents (informational)<input aria-label={`Price ${t.tier_key}`} className={`${adminInput} w-28`} value={e.price ?? ''} onChange={(ev) => set('price', ev.target.value)} /></label>
                <button className={adminBtn.primary} onClick={() => run('admin_set_coach_plan_tier', { p_key: t.tier_key, p_name: e.name, p_max_athletes: intOrNull(e.max), p_price_cents: intOrNull(e.price), p_position: t.position, p_active: t.is_active })}>Save</button>
                <span className={`text-xs ${adminMuted}`}>{tierLimitLabel(t)}</span>
              </li>
            )
          })}
        </ul>
      </section>
      <section className={`${adminCard} space-y-3`}>
        <h2 className="text-lg font-black text-slate-900 dark:text-white">Founding coaches ({s.founding_count} of {s.founding_cap})</h2>
        <ul className="space-y-2">
          {s.founders.length === 0 && <li className={`text-sm ${adminMuted}`}>None yet.</li>}
          {s.founders.map((f) => (
            <li key={f.coach_id} className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm text-slate-900 dark:text-white">{f.name || f.coach_id} · {f.tier_key} · {f.locked_max_athletes == null ? 'unlimited' : `${f.locked_max_athletes} athletes`}</span>
              <button className={adminBtn.secondary} onClick={() => run('admin_revoke_founder', { p_coach: f.coach_id })}>Revoke</button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 flex-wrap items-end">
          <input className={`${adminInput} max-w-md`} placeholder="Coach user id (uuid)" value={coach} onChange={(e) => setCoach(e.target.value)} />
          <select className={`${adminInput} w-48`} value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Locked tier">
            {s.tiers.map((t) => <option key={t.tier_key} value={t.tier_key}>{t.name}</option>)}
          </select>
          <button className={adminBtn.primary} disabled={!UUID_RE.test(coach.trim())} onClick={async () => { await run('admin_grant_founder', { p_coach: coach.trim(), p_tier: tier, p_price_cents: null }); setCoach('') }}>Grant</button>
        </div>
        <div className="flex gap-2 items-end">
          <label className="text-xs text-slate-700 dark:text-slate-300">Founding cap<input className={`${adminInput} w-28`} value={cap} onChange={(e) => setCap(e.target.value)} /></label>
          <button className={adminBtn.secondary} disabled={!/^\d+$/.test(cap)} onClick={() => run('admin_set_coach_plans', { p_enforced: null, p_founding_cap: Number(cap) })}>Save cap</button>
        </div>
      </section>
    </AdminPage>
  )
}
