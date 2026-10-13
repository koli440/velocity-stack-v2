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

/**
 * @param {object[]} history - executions ({activity_id, summary, created_at}) of one template
 * @param {{activityId: string, runAt: string|Date}} run - the run being compared
 * @returns {{previous: object|null, allTime: {summary: object, count: number}, last90: {summary: object, count: number}}}
 */
export function computeBaselines(history = [], { activityId, runAt }) {
  const runTime = new Date(runAt).getTime()
  const prior = history
    .filter((h) => h.activity_id !== activityId && new Date(h.created_at).getTime() <= runTime)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const recent = prior.filter((h) => runTime - new Date(h.created_at).getTime() <= 90 * DAY_MS)
  return {
    previous: prior[0] || null,
    allTime: { summary: averageSummary(prior), count: prior.length },
    last90: { summary: averageSummary(recent), count: recent.length },
  }
}
