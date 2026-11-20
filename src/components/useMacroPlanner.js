'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchMacroPlannerEnabled } from '../lib/macroPlannerFlag'

let cache = null // { userId, value, at }

// True when the `macro_planner` flag is on for the signed-in user (false while loading / signed out).
export function useMacroPlanner() {
  const [enabled, setEnabled] = useState(() => (cache && Date.now() - cache.at < 60000 ? cache.value : false))
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id || null
      if (!userId) return !cancelled && setEnabled(false)
      if (cache && cache.userId === userId && Date.now() - cache.at < 60000) return !cancelled && setEnabled(cache.value)
      const value = await fetchMacroPlannerEnabled(supabase)
      cache = { userId, value, at: Date.now() }
      if (!cancelled) setEnabled(value)
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return enabled
}
