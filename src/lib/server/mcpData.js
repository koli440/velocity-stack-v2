// src/lib/server/mcpData.js
// Supabase implementation of the MCP tools' data adapter (src/lib/mcp/tools.js, docs/mcp.md).
//
// Runs with the SERVICE client. Planning goes only through the mcp_* SECURITY DEFINER wrappers
// (20270190000000_mcp_connector.sql), which resolve the acting user from the token hash themselves and re-check
// scope, coach relationship and every rule of the existing RPCs. Own-account reads filter every query by the
// token's user id explicitly (the same way /api/v1 does).

import { dayKey } from '../calendar.js'
import { ftpAt, fetchFtpHistory } from '../ftpHistory.js'
import { weightAt, fetchWeightHistory } from '../weightHistory.js'
import { fetchLtHistory, ltFromHistoryEntry, resolveLtAt } from '../lactateThresholds.js'
import { computeZones, fetchZoneHistory, resolveZonesAt, zonePctsFromEntry, zoneRanges, zoneBreakdown, zonesFromActivity, ZONE_SNAPSHOT_COLUMN } from '../powerZones.js'
import { LT_SNAPSHOT_COLUMNS } from '../lactateThresholds.js'
import { fetchFitnessActivities, dailyLoads, fitnessSummary, localDayKey } from '../fitnessForm.js'
import { visibleTemplatesFilter } from '../ownerScope.js'
import { runTemplateBatch, ownStore } from './templateBatchRun.js'
import {
  ACTIVITY_SUMMARY_COLUMNS, activitySummaryView, computeSplits, peaksView, templateRunView, fitnessView, nextDay, safeLike,
} from '../mcp/views.js'
import { ToolError } from '../mcp/tools.js'

const RUN_COLUMNS = 'id, activity_id, template_id, template_name, summary, efforts, by_coach, created_at, analysis_templates(name)'

class DataError extends Error {}

function check({ data, error }) {
  if (error) throw new DataError(error.message || 'Database error')
  return data
}

/**
 * @param {{ service: object, tokenHash: string, userId: string }} args - userId comes from the verified token
 */
export function createMcpData({ service, tokenHash, userId }) {
  const rpc = async (name, args) => check(await service.rpc(name, { p_token_hash: tokenHash, ...args }))

  return {
    /** { user_id, macro_planner, has_macro_plan, athletes: [{ id, name }] } */
    capabilities: () => rpc('mcp_capabilities', {}),

    async getAthlete() {
      const today = dayKey(new Date())
      const [profile, ftp, weight, lt, zones, races] = await Promise.all([
        service.from('profiles').select('ftp_w').eq('id', userId).maybeSingle(),
        fetchFtpHistory(service, userId),
        fetchWeightHistory(service, userId),
        fetchLtHistory(service, userId),
        fetchZoneHistory(service, userId),
        service.from('calendar_races').select('race_date, name, discipline, priority, location').eq('rider_id', userId).gte('race_date', today).order('race_date', { ascending: true }).limit(10),
      ])
      const ftpW = ftpAt(ftp.history, today) ?? (Number(profile.data?.ftp_w) > 0 ? Number(profile.data.ftp_w) : null)
      const weightKg = weightAt(weight.history, today)
      const thresholds = ltFromHistoryEntry(resolveLtAt(lt.history, today))
      const z = computeZones({ lt: thresholds, ftp: ftpW, pcts: zonePctsFromEntry(resolveZonesAt(zones.history, today)) })
      return {
        ftp_w: ftpW,
        weight_kg: weightKg,
        w_per_kg: ftpW && weightKg ? Math.round((ftpW / weightKg) * 100) / 100 : null,
        lactate_thresholds: thresholds ? { lt1_power_w: thresholds.lt1Power, lt1_hr_bpm: thresholds.lt1Hr, lt2_power_w: thresholds.lt2Power, lt2_hr_bpm: thresholds.lt2Hr } : null,
        power_zones: z ? { estimated: z.estimated, zones: zoneRanges(z).map((r) => ({ zone: r.zone, name: r.name, min_w: r.minW, max_w: r.maxW })) } : null,
        upcoming_races: (races.data || []).map((r) => ({ date: r.race_date, name: r.name, discipline: r.discipline, priority: r.priority, location: r.location || null })),
      }
    },

    listPlanned: ({ riderId, from, to }) => rpc('mcp_planned_list', { p_rider: riderId, p_from: from, p_to: to }).then((r) => r || []),
    createPlanned: ({ riderId, date, discipline, title, description, dsl, manifest }) =>
      rpc('mcp_planned_create', { p_rider: riderId, p_date: date, p_discipline: discipline, p_title: title, p_description: description, p_dsl: dsl, p_manifest: manifest, p_template_name: null }),
    updatePlanned: (id, fields) => rpc('mcp_planned_update', { p_id: id, p_fields: fields }),
    setStructure: (id, { dsl, manifest }) => rpc('mcp_planned_set_structure', { p_id: id, p_dsl: dsl, p_manifest: manifest, p_template_name: null }),
    deletePlanned: (id) => rpc('mcp_planned_delete', { p_id: id }),
    getMacroPlan: ({ riderId }) => rpc('mcp_macro_plan_get', { p_rider: riderId }),

    async listActivities({ from, to, limit }) {
      const rows = check(
        await service.from('activities').select(ACTIVITY_SUMMARY_COLUMNS).eq('user_id', userId)
          .gte('activity_date', `${from}T00:00:00Z`).lt('activity_date', `${nextDay(to)}T00:00:00Z`)
          .order('activity_date', { ascending: false }).limit(limit)
      ) || []
      const linked = await linkedPlanned(rows.map((r) => r.id))
      return rows.map((r) => activitySummaryView(r, linked.get(r.id)))
    },

    async getActivity(id, { splitMinutes }) {
      const cols = `${ACTIVITY_SUMMARY_COLUMNS}, time_series, ${ZONE_SNAPSHOT_COLUMN}, ${LT_SNAPSHOT_COLUMNS.join(', ')}`
      const a = check(await service.from('activities').select(cols).eq('id', id).eq('user_id', userId).maybeSingle())
      if (!a) return null
      const [curves, runs, linked] = await Promise.all([
        service.from('activity_curves').select('curve_type, data').eq('activity_id', id),
        service.from('template_executions').select(RUN_COLUMNS).eq('activity_id', id).eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
        linkedPlanned([id], true),
      ])
      const curveMap = Object.fromEntries((curves.data || []).map((c) => [c.curve_type, c.data]))
      const zones = zonesFromActivity(a)
      const watts = Array.isArray(a.time_series?.watts) ? a.time_series.watts : null
      const plan = linked.get(id) || null
      return {
        ...activitySummaryView(a, plan),
        planned_workout: plan ? { id: plan.id, title: plan.title, date: plan.workout_date, discipline: plan.discipline, structure: plan.structure_dsl || null, description: plan.description || '' } : null,
        peaks: peaksView(curveMap),
        time_in_zones: watts && zones ? zoneBreakdown(watts, zones).map((r) => ({ zone: r.zone, name: r.name, min_w: r.minW, max_w: r.maxW, seconds: r.seconds, pct: r.pct })) : [],
        ...computeSplits(a.time_series, splitMinutes),
        template_results: (runs.data || []).map(templateRunView),
      }
    },

    async listTemplates({ query }) {
      let q = service.from('analysis_templates').select('id, name, category, description, dsl_source, user_id').or(visibleTemplatesFilter(userId)).not('dsl_source', 'is', null)
      const like = safeLike(query)
      if (like) q = q.ilike('name', `%${like}%`)
      const rows = check(await q.order('name', { ascending: true }).limit(100)) || []
      return rows.map((t) => ({ id: t.id, name: t.name, category: t.category || null, description: t.description || null, own: t.user_id === userId, system: !t.user_id, dsl: t.dsl_source }))
    },

    async runTemplate({ activityId, templateId }) {
      const found = check(await service.from('analysis_templates').select('*').or(visibleTemplatesFilter(userId)).eq('id', templateId).limit(1)) || []
      const template = found[0]
      if (!template) throw new ToolError('Template not available (see list_templates)')
      const [item] = await runTemplateBatch([activityId], template, ownStore(service, userId, template.id))
      if (!item || item.status === 'failed') throw new ToolError(`The template run failed: ${item?.reason || 'unknown error'}`)
      if (item.status === 'skipped') throw new ToolError(item.reason === 'No time series data' ? 'The activity has no stream data to analyse' : 'Activity not found')
      let run = null
      if (item.status === 'ok' || item.replaced) {
        const rows = check(await service.from('template_executions').select(RUN_COLUMNS).eq('activity_id', activityId).eq('template_id', template.id).eq('user_id', userId).eq('by_coach', false).limit(1))
        run = rows?.[0] ? templateRunView(rows[0]) : null
      }
      return { status: item.status, message: item.reason || null, template: template.name, result: run }
    },

    async getFitness({ days }) {
      const { data: prof } = await service.from('profiles').select('include_gym_in_fitness').eq('id', userId).maybeSingle()
      const includeGym = prof?.include_gym_in_fitness !== false
      const [acts, lt] = await Promise.all([fetchFitnessActivities(service, { userId, days, includeGym }), fetchLtHistory(service, userId)])
      if (acts.error) throw new DataError(acts.error.message)
      const { days: daily } = dailyLoads(acts.data, lt.error ? [] : lt.history)
      const today = localDayKey(new Date())
      return { today, include_gym: includeGym, ...fitnessView(fitnessSummary(daily, today, acts.firstDay), days) }
    },
  }

  async function linkedPlanned(activityIds, full = false) {
    if (!activityIds.length) return new Map()
    const cols = full ? 'id, activity_id, title, workout_date, discipline, structure_dsl, description' : 'id, activity_id, title, workout_date'
    const { data } = await service.from('planned_workouts').select(cols).eq('rider_id', userId).in('activity_id', activityIds)
    return new Map((data || []).map((w) => [w.activity_id, w]))
  }
}
