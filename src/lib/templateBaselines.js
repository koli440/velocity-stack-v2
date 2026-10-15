// Baselines a template run is compared against (issue #68): the last previous
// run, the all-time average and the trailing 90-day average.

const DAY_MS = 86400000

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function averageSummary(executions) {
  const buckets = {}
  for (const ex of executions) {
    for (const [key, value] of Object.entries(ex.summary || {})) {
      if (typeof value === 'number' && !isNaN(value)) (buckets[key] ||= []).push(value)
    }
  }
  const out = {}
  for (const [key, values] of Object.entries(buckets)) out[key] = mean(values)
  return out
}

// Baselines are ordered by when the ride happened, not when the run was created/imported.
function ridden(h) {
  return new Date(h.activities?.activity_date || h.created_at).getTime()
}

/**
 * @param {object[]} history - executions ({activity_id, summary, created_at, activities?: {activity_date}}) of one template
 * @param {{activityId: string, runAt: string|Date}} run - the run being compared (runAt = date of the ride)
 * @returns {{previous: object|null, allTime: {summary: object, count: number}, last90: {summary: object, count: number}}}
 */
export function computeBaselines(history = [], { activityId, runAt }) {
  const runTime = new Date(runAt).getTime()
  const prior = history
    .filter((h) => h.activity_id !== activityId && ridden(h) <= runTime)
    .sort((a, b) => ridden(b) - ridden(a))
  const recent = prior.filter((h) => runTime - ridden(h) <= 90 * DAY_MS)
  return {
    previous: prior[0] || null,
    allTime: { summary: averageSummary(prior), count: prior.length },
    last90: { summary: averageSummary(recent), count: recent.length },
  }
}
