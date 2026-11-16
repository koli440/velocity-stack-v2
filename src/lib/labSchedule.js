// Lab test scheduler helpers (docs/lab/test-scheduler.md). Mirrors lab_schedule_next in the database.
const DAY = 86400000
const parse = (d) => Date.parse(`${d}T00:00:00Z`)
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10)

/** First test date on or after `from` (start + k * interval weeks), null past the end date. */
export function nextDue({ start, weeks, end = null, from }) {
  const s = parse(start)
  const f = parse(from)
  if (Number.isNaN(s) || Number.isNaN(f) || !(weeks >= 1)) return null
  const step = weeks * 7 * DAY
  const d = f <= s ? s : s + Math.ceil((f - s) / step) * step
  if (end && d > parse(end)) return null
  return fmt(d)
}

/** Upcoming test dates (at most `count`) from `from`. */
export function upcomingDates(sched, from, count = 4) {
  const out = []
  let cursor = from
  while (out.length < count) {
    const d = nextDue({ start: sched.start_date, weeks: sched.interval_weeks, end: sched.end_date, from: cursor })
    if (!d) break
    out.push(d)
    cursor = fmt(parse(d) + DAY)
  }
  return out
}

/** Validates the schedule form; returns { error } or { args } for lab_schedule_save. */
export function validateScheduleForm({ athleteId, protocol, weeks, start, end }) {
  const w = Number(weeks)
  if (!Number.isInteger(w) || w < 1 || w > 52) return { error: 'Interval must be 1 to 52 weeks' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || Number.isNaN(parse(start))) return { error: 'Pick a start date' }
  if (end && (!/^\d{4}-\d{2}-\d{2}$/.test(end) || parse(end) < parse(start))) return { error: 'End date must be after the start date' }
  if (!protocol) return { error: 'Pick a test' }
  return { args: { p_athlete: athleteId, p_protocol: protocol, p_weeks: w, p_start: start, p_end: end || null } }
}

/** Timeline of completed/planned runs, oldest first, with the FTP change vs the previous applied/result FTP. */
export function buildTimeline(runs) {
  const rows = [...(runs || [])]
    .filter((r) => r.status !== 'cancelled')
    .sort((a, b) => String(a.planned_date).localeCompare(String(b.planned_date)))
  let prev = null
  return rows.map((r) => {
    const ftp = r.applied?.ftp ?? r.result?.ftp ?? null
    const delta = ftp != null && prev != null ? ftp - prev : null
    if (ftp != null) prev = ftp
    return { id: r.id, date: r.planned_date, protocol: r.protocol, status: r.status, ftp, delta }
  })
}
