'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, getAuthHeader } from '../../lib/supabase'
import { parseJsonResponse } from '../../lib/httpJson'
import TemplateCreatorModal from '../../components/TemplateCreatorModal'
import TemplateRunsModal from '../../components/TemplateRunsModal'
import Icon from '../../components/Icon'
import {
  filterByTab,
  searchTemplates,
  templatePermissions,
  visibleTabs,
} from '../../lib/templateMenu'
import { metricLabel, orderMetricKeys, formatStatValue } from '../../lib/templateStats'


const TAB_LABELS = { mine: 'Mine', favorites: 'Favorites', public: 'Public', system: 'System' }

// Analysis template menu (issue #44): browse and manage analysis templates. Anonymous
// visitors can browse System and Public templates; everything else needs an account.
export default function TemplatesPage() {
  const [userId, setUserId] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [templates, setTemplates] = useState([])
  const [owners, setOwners] = useState({})
  const [favoriteIds, setFavoriteIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState(null)
  const [tab, setTab] = useState('public')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('name')
  const [stats, setStats] = useState({})
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState(null)
  const [runsFor, setRunsFor] = useState(null)
  const [modal, setModal] = useState({ open: false, template: null })

  const load = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const authHeader = await getAuthHeader()
      const [tplRes, favRes] = await Promise.all([
        fetch('/api/templates', { headers: authHeader }),
        authHeader.Authorization ? fetch('/api/templates/favorites', { headers: authHeader }) : null,
      ])
      const tplJson = await parseJsonResponse(tplRes)
      if (!tplRes.ok || tplJson.error) throw new Error(tplJson.error || 'Failed to load templates.')
      setTemplates(tplJson.templates || [])
      setOwners(tplJson.owners || {})
      if (favRes) {
        const favJson = await parseJsonResponse(favRes)
        if (!favRes.ok || favJson.error) throw new Error(favJson.error || 'Failed to load favorites.')
        setFavoriteIds(new Set(favJson.favoriteIds || []))
      } else {
        setFavoriteIds(new Set())
      }
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    setStatsError(null)
    try {
      const authHeader = await getAuthHeader()
      if (!authHeader.Authorization) {
        setStats({})
        return
      }
      const res = await fetch('/api/templates/stats', { headers: authHeader, cache: 'no-store' })
      const json = await parseJsonResponse(res)
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load usage statistics.')
      setStats(json.stats || {})
    } catch (err) {
      setStatsError(err.message)
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const id = session?.user?.id || null
      setUserId(id)
      setTab(id ? 'mine' : 'public')
      setAuthReady(true)
      load()
      loadStats()
    })
  }, [load, loadStats])

  const tabs = visibleTabs(userId)

  const tabItems = useMemo(
    () => filterByTab(templates, tab, { userId, favoriteIds }),
    [templates, tab, userId, favoriteIds]
  )
  const shown = useMemo(() => {
    const list = searchTemplates(tabItems, { query, category, sort: sort === 'usage' ? 'name' : sort })
    if (sort !== 'usage') return list
    return [...list].sort((a, b) => (stats[b.id]?.count || 0) - (stats[a.id]?.count || 0))
  }, [tabItems, query, category, sort, stats])
  const categories = useMemo(() => ['all', ...new Set(templates.map((t) => t.category).filter(Boolean))], [templates])

  const api = async (url, method, body) => {
    const authHeader = await getAuthHeader()
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await parseJsonResponse(res)
    if (!res.ok || json.error) throw new Error(json.error || 'Request failed.')
    return json
  }

  const run = async (fn) => {
    setErrorMsg(null)
    try {
      await fn()
    } catch (err) {
      setErrorMsg(err.message)
    }
  }

  const toggleFavorite = (t) =>
    run(async () => {
      const isFav = favoriteIds.has(t.id)
      await api(`/api/templates/${t.slug}/favorite`, isFav ? 'DELETE' : 'PUT')
      setFavoriteIds((prev) => {
        const next = new Set(prev)
        if (isFav) next.delete(t.id)
        else next.add(t.id)
        return next
      })
    })

  const toggleVisibility = (t) =>
    run(async () => {
      const next = t.visibility === 'public' ? 'private' : 'public'
      const json = await api(`/api/templates/${t.slug}`, 'PATCH', { visibility: next })
      setTemplates((prev) => prev.map((x) => (x.id === t.id ? json.template : x)))
    })

  const remove = (t) => {
    if (!window.confirm(`Permanently delete "${t.name}"? This cannot be undone.`)) return
    run(async () => {
      await api(`/api/templates/${t.slug}`, 'DELETE')
      setTemplates((prev) => prev.filter((x) => x.id !== t.id))
      setFavoriteIds((prev) => {
        const next = new Set(prev)
        next.delete(t.id)
        return next
      })
    })
  }

  const btn =
    'px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition'
  const input =
    'bg-slate-50 dark:bg-surface-darkCard border border-slate-200 dark:border-surface-darkBorder rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500'

  const ownerLabel = (t) => (!t.user_id ? 'System' : t.user_id === userId ? 'You' : owners[t.user_id] || 'Community')

  const renderStats = (t) => {
    if (statsLoading) return <p className="text-[11px] text-slate-400">Loading your usage…</p>
    if (statsError) return <p className="text-[11px] text-red-500">Usage stats unavailable.</p>
    const st = stats[t.id]
    if (!st) return <p className="text-[11px] text-slate-400">Not used yet.</p>
    const keys = orderMetricKeys(Object.keys(st.metrics))
    return (
      <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3 space-y-2 text-[11px]">
        <p className="font-bold text-slate-700 dark:text-slate-200">
          Used {st.count} {st.count === 1 ? 'time' : 'times'}
          {st.last_run_at && <span className="font-normal text-slate-400"> · last {new Date(st.last_run_at).toLocaleDateString()}</span>}
        </p>
        {keys.length > 0 && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-500 dark:text-slate-400">
            {keys.map((k) => (
              <div key={k} className="flex justify-between gap-2">
                <span>{metricLabel(k)}</span>
                <span className="font-mono text-slate-700 dark:text-slate-200">
                  {formatStatValue(k, st.metrics[k].avg)}
                  {st.metrics[k].best != null && st.metrics[k].n > 1 && <span className="text-slate-400"> / {formatStatValue(k, st.metrics[k].best)}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
        {keys.length > 0 && <p className="text-[10px] text-slate-400">Average / best across runs</p>}
        <button onClick={() => setRunsFor(t)} className="font-bold text-emerald-500 hover:underline" aria-haspopup="dialog">
          View {st.count} {st.count === 1 ? 'run' : 'runs'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Analysis Templates</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Browse, favorite and manage interval analysis templates.</p>
        </div>
        {userId && (
          <button
            onClick={() => setModal({ open: true, template: null })}
            className="py-2 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-[11px] uppercase tracking-wider"
          >
            + New template
          </button>
        )}
      </div>

      <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-900/60 rounded-xl w-fit">
        {tabs.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              tab === k ? 'bg-emerald-500 text-white' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {TAB_LABELS[k]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates…" className={`${input} flex-1 min-w-[12rem]`} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={input} aria-label="Category">
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'All categories' : c}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className={input} aria-label="Sort">
          <option value="name">Sort: Name</option>
          <option value="updated">Sort: Last updated</option>
          <option value="category">Sort: Category</option>
          {userId && <option value="usage">Sort: Most used</option>}
        </select>
      </div>

      {errorMsg && (
        <div className="text-xs font-bold text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-center justify-between gap-3">
          <span>{errorMsg}</span>
          <button onClick={load} className="underline">Retry</button>
        </div>
      )}

      {!authReady || loading ? (
        <p className="text-sm text-slate-400">Loading templates…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 text-center">
          {tabItems.length === 0
            ? tab === 'mine'
              ? 'You have not created any templates yet.'
              : tab === 'favorites'
                ? 'No favorites yet. Star a template to find it here.'
                : 'No templates here yet.'
            : 'No templates match your filters.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {shown.map((t) => {
            const perms = templatePermissions(t, userId)
            const isFav = favoriteIds.has(t.id)
            return (
              <div key={t.id} className="bg-white dark:bg-surface-darkCard p-5 rounded-2xl border border-slate-200 dark:border-surface-darkBorder shadow-sm flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-extrabold text-slate-900 dark:text-white">{t.name}</h3>
                  {perms.canFavorite && (
                    <button
                      onClick={() => toggleFavorite(t)}
                      aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                      className={`text-lg leading-none ${isFav ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}`}
                    >
                      <Icon name="star" size={18} className={isFav ? 'fill-current' : ''} />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px] font-black uppercase tracking-wider">
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">{t.category}</span>
                  <span className={`px-2 py-0.5 rounded-full ${!t.user_id ? 'bg-sky-500/10 text-sky-500' : t.visibility === 'public' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-500/10 text-slate-500'}`}>
                    {!t.user_id ? 'system' : t.visibility}
                  </span>
                </div>
                {t.description && <p className="text-xs text-slate-500 dark:text-slate-400">{t.description}</p>}
                {userId && renderStats(t)}
                <p className="text-[11px] text-slate-400 mt-auto">
                  By {ownerLabel(t)}
                  {(t.updated_at || t.created_at) && ` · Updated ${new Date(t.updated_at || t.created_at).toLocaleDateString()}`}
                </p>
                {(perms.canEdit || perms.canToggleVisibility || perms.canDelete) && (
                  <div className="flex flex-wrap gap-2">
                    {perms.canEdit && <button className={btn} onClick={() => setModal({ open: true, template: t })}>Edit</button>}
                    {perms.canToggleVisibility && (
                      <button className={btn} onClick={() => toggleVisibility(t)}>
                        {t.visibility === 'public' ? 'Make private' : 'Make public'}
                      </button>
                    )}
                    {perms.canDelete && <button className={`${btn} text-red-500`} onClick={() => remove(t)}>Delete</button>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {runsFor && (
        <TemplateRunsModal
          template={runsFor}
          metricKeys={orderMetricKeys(Object.keys(stats[runsFor.id]?.metrics || {}))}
          onClose={() => setRunsFor(null)}
        />
      )}

      {modal.open && (
        <TemplateCreatorModal
          isOpen
          editingTemplate={modal.template}
          onClose={() => setModal({ open: false, template: null })}
          onSaved={load}
        />
      )}
    </div>
  )
}
