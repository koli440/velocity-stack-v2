// Collapse state for the activity detail "Template Runs" card and the runs inside it.

export const SECTION_COLLAPSED_KEY = 'vs.templateRuns.collapsed'

/** Stored value is "1" when the section was collapsed; anything else (or unreadable storage) means expanded. */
export function readSectionCollapsed(storage) {
  try {
    return storage?.getItem(SECTION_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function writeSectionCollapsed(storage, collapsed) {
  try {
    if (collapsed) storage?.setItem(SECTION_COLLAPSED_KEY, '1')
    else storage?.removeItem(SECTION_COLLAPSED_KEY)
  } catch {
    // storage unavailable (private mode / quota): state just won't persist
  }
}

/** Id of the most recently run entry (by updated_at, then created_at); null when there are none. */
export function latestRunId(runs) {
  let best = null
  let bestT = -Infinity
  for (const r of runs || []) {
    const t = Date.parse(r?.updated_at || r?.created_at || '')
    const v = Number.isFinite(t) ? t : -Infinity
    if (best === null || v > bestT) {
      best = r
      bestT = v
    }
  }
  return best ? best.id : null
}

/**
 * Whether a run is expanded. A user's explicit choice (overrides: { [id]: boolean }) wins;
 * otherwise a single run is open and with several only the most recent one is.
 */
export function isRunOpen(runs, id, overrides = {}) {
  if (Object.prototype.hasOwnProperty.call(overrides, id)) return !!overrides[id]
  if ((runs || []).length <= 1) return true
  return id === latestRunId(runs)
}

/** Compact one-line text for a collapsed run: "headline · verdict". Empty parts are dropped. */
export function collapsedSummary({ headline, verdictLabel } = {}) {
  return [headline, verdictLabel].filter((p) => p && p !== '—').join(' · ')
}
