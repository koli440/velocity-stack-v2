'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchFtpHistory } from '../lib/ftpHistory'
import { fetchLtHistory } from '../lib/lactateThresholds'
import { fetchZoneHistory } from '../lib/powerZones'

/**
 * The RIDER's FTP / lactate threshold / power zone histories ({ ftpHistory, ltHistory, zoneHistory }), used to
 * estimate the load of planned workouts. `riderId` is the rider shown (an athlete when a coach views them),
 * never the viewer. Null until loaded; a history that fails to load is empty (estimates then fall back).
 */
export function useRiderLoadContext(riderId) {
  const [ctx, setCtx] = useState(null)
  useEffect(() => {
    if (!riderId) return undefined
    let cancelled = false
    const hist = (p) => p.then((r) => r?.history || []).catch(() => [])
    Promise.all([hist(fetchFtpHistory(supabase, riderId)), hist(fetchLtHistory(supabase, riderId)), hist(fetchZoneHistory(supabase, riderId))]).then(
      ([ftpHistory, ltHistory, zoneHistory]) => !cancelled && setCtx({ riderId, ftpHistory, ltHistory, zoneHistory })
    )
    return () => {
      cancelled = true
    }
  }, [riderId])
  return ctx && ctx.riderId === riderId ? ctx : null
}
