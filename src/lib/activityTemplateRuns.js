// Template runs shown on feed hero cards (issue #262): pure helpers + one batched fetch.
// RLS only exposes a rider's own runs (and coach runs on their account), so the badge appears
// only where data is readable.

import { runTemplateName, isCoachRun } from './coachRuns.js'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function fromEfforts(efforts, key) {
  const vals = (Array.isArray(efforts) ? efforts : []).map((e) => num(e?.[key])).filter((v) => v != null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

/** Run row -> { id, name, avgPower, np, byCoach } (watts rounded; null when unavailable). */
export function runDetail(run) {
  const avg = num(run?.summary?.avg_power) ?? fromEfforts(run?.efforts, 'avg_power')
  const np = num(run?.summary?.np_w) ?? fromEfforts(run?.efforts, 'np_w')
  return {
    id: run?.id ?? null,
    name: runTemplateName(run),
    avgPower: avg == null ? null : Math.round(avg),
    np: np == null ? null : Math.round(np),
    byCoach: isCoachRun(run),
  }
}

/** Badge text: the template name for exactly one run, otherwise "N runs". Null without runs. */
export function runsBadgeLabel(details) {
  const n = details?.length || 0
  if (n === 0) return null
  return n === 1 ? details[0].name : `${n} runs`
}

/** Groups run rows by activity id into detail lists (newest first as fetched). */
export function groupRunsByActivity(rows) {
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.activity_id) continue
    if (!map.has(row.activity_id)) map.set(row.activity_id, [])
    map.get(row.activity_id).push(runDetail(row))
  }
  return map
}

/** One request for all visible activities. Failure -> empty map (badge just hidden). */
export async function fetchActivityRuns(supabase, ids) {
  const list = [...new Set(ids || [])].filter(Boolean)
  if (list.length === 0) return new Map()
  try {
    const { data, error } = await supabase
      .from('template_executions')
      .select('id, activity_id, summary, efforts, template_name, by_coach, analysis_templates(name)')
      .in('activity_id', list)
      .order('created_at', { ascending: false })
    if (error) return new Map()
    return groupRunsByActivity(data)
  } catch {
    return new Map()
  }
}
