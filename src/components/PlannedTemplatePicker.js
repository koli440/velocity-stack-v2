'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import TemplatePickerModal from './TemplatePickerModal'
import { coachRunnableTemplates } from '../lib/coachRuns'
import { getAuthHeader } from '../lib/supabase'

// The "Add template run" picker (search, favorites, recents, preview) reused to pre-fill a planned workout.
// Only the caller's own and system templates are offered (never the rider's templates for a coach).
// Picking only hands the template's DSL text back; nothing references the template afterwards.
export default function PlannedTemplatePicker({ userId, onPick, onClose }) {
  const [templates, setTemplates] = useState([])
  const [favoriteIds, setFavoriteIds] = useState(() => new Set())
  const [recentIds, setRecentIds] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const headers = await getAuthHeader()
      const [tRes, fRes, rRes] = await Promise.all([
        fetch('/api/templates', { headers }),
        fetch('/api/templates/favorites', { headers }),
        fetch('/api/templates/recent', { headers }),
      ])
      if (cancelled) return
      if (tRes.ok) setTemplates(((await tRes.json()).templates) || [])
      else setError('Could not load templates.')
      if (fRes.ok) setFavoriteIds(new Set((await fRes.json()).favoriteIds || []))
      if (rRes.ok) setRecentIds((await rRes.json()).recentIds || [])
    })().catch(() => !cancelled && setError('Could not load templates.'))
    return () => {
      cancelled = true
    }
  }, [])

  const usable = useMemo(() => coachRunnableTemplates(templates, userId).filter((t) => t.dsl_source), [templates, userId])

  const toggleFavorite = useCallback(async (template) => {
    const was = favoriteIds.has(template.id)
    const apply = (on) => setFavoriteIds((prev) => {
      const next = new Set(prev)
      on ? next.add(template.id) : next.delete(template.id)
      return next
    })
    apply(!was)
    try {
      const res = await fetch(`/api/templates/${template.slug}/favorite`, { method: was ? 'DELETE' : 'PUT', headers: await getAuthHeader() })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to update favorite.')
    } catch (err) {
      apply(was)
      setError(err.message || 'Failed to update favorite.')
    }
  }, [favoriteIds])

  return (
    <>
      <TemplatePickerModal
        templates={usable}
        userId={userId}
        favoriteIds={favoriteIds}
        recentIds={recentIds}
        selectedId={selectedId}
        onSelect={setSelectedId}
        title="Choose a template"
        confirmLabel="Use template"
        showDefinition
        onToggleFavorite={toggleFavorite}
        onRun={(id) => {
          const t = usable.find((x) => x.id === id)
          if (t) onPick({ name: t.name, dsl: t.dsl_source })
        }}
        onClose={onClose}
      />
      {error && <div role="alert" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] rounded-lg bg-rose-500 text-white text-xs font-semibold px-3 py-2">{error}</div>}
    </>
  )
}
