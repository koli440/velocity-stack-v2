// Pure helpers for template runs made by a coach on an athlete's activity (see
// supabase/migrations/20261202000000_coach_template_runs.sql). The database enforces every rule;
// this module only derives labels, filters and button visibility from the (server-stamped) run rows.

export const RUN_FILTERS = Object.freeze(['all', 'coach', 'own'])

export function isCoachRun(run) {
  return !!run?.by_coach
}

/** Runs matching the filter: all, only coach runs ('coach') or only the rider's own runs ('own'). */
export function filterRuns(runs, filter = 'all') {
  const list = Array.isArray(runs) ? runs : []
  if (filter === 'coach') return list.filter(isCoachRun)
  if (filter === 'own') return list.filter((r) => !isCoachRun(r))
  return list
}

/** Normalises a user-supplied filter value (query string / select). */
export function parseRunFilter(value) {
  return RUN_FILTERS.includes(value) ? value : 'all'
}

/** Template name of a run: live join when readable, otherwise the stored name snapshot. */
export function runTemplateName(run) {
  return run?.analysis_templates?.name || run?.template_name || 'Template'
}

export function runTemplateSlug(run) {
  return run?.analysis_templates?.slug || run?.template_slug || null
}

/**
 * "run by coach Amy", or "run by former coach" when the coach account is gone / unidentifiable.
 * Returns null for the rider's own runs. `names` maps coach id -> display name.
 */
export function coachRunLabel(run, names = {}) {
  if (!isCoachRun(run)) return null
  const name = run.run_by_coach_id ? names[run.run_by_coach_id] : null
  return name ? `run by coach ${name}` : 'run by former coach'
}

/** Distinct coach ids whose names must be resolved for these runs. */
export function coachRunCoachIds(runs) {
  const ids = new Set()
  for (const r of runs || []) if (isCoachRun(r) && r.run_by_coach_id) ids.add(r.run_by_coach_id)
  return [...ids]
}

/** Templates a coach may run on an athlete: his own and system templates only. */
export function coachRunnableTemplates(templates, coachId) {
  return (templates || []).filter((t) => !t.user_id || (!!coachId && t.user_id === coachId))
}

/** Coach runs can never be sent to the PB Vault. */
export function canSendRunToPbVault(run) {
  return !isCoachRun(run)
}

/**
 * What the viewer may do with a run on the activity page.
 * - rider (activity owner): delete anything; re-run only own runs (a coach template is not readable).
 * - coach in athlete context: delete / re-run only his own runs.
 */
export function runActions(run, { userId, athleteContext }) {
  if (athleteContext) {
    const mine = isCoachRun(run) && !!userId && run.run_by_coach_id === userId
    return { canDelete: mine, canRerun: mine && !!run.template_id }
  }
  return { canDelete: true, canRerun: !isCoachRun(run) && !!run.template_id }
}

/** Shapes a stored run row for the UI: expose the name snapshot as the embedded template (name/slug/category only). */
export function withTemplateSnapshot(row) {
  if (!row) return row
  const embedded = row.analysis_templates
  if (embedded && embedded.name) return row
  return {
    ...row,
    analysis_templates: row.template_slug || row.template_name
      ? { slug: row.template_slug || null, name: row.template_name || null, category: row.template_category || null }
      : embedded ?? null,
  }
}

/** Compare-tab options: one entry per template slug found in the runs (works for templates the viewer cannot read). */
export function compareOptions(runs) {
  const seen = new Map()
  for (const r of runs || []) {
    const slug = runTemplateSlug(r)
    if (slug && !seen.has(slug)) seen.set(slug, { slug, name: runTemplateName(r) })
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}
