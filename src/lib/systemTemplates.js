// System analysis templates catalogue (issues #122, #121, #144). This file is the single place
// system templates are authored: the app reads them at runtime from `analysis_templates`, and the
// rows there come from idempotent migrations generated from this list
// (`node scripts/generate-system-templates-sql.mjs`). Shipped migrations are never edited;
// __tests__/systemTemplates.test.js fails if a seeded slug/DSL/manifest and this list diverge.
import { parseIntervalDsl, buildIntervalManifest } from './intervalDsl.js'

export const SYSTEM_TEMPLATES = [
  {
    slug: 'sys_road_sweet_spot_3x15',
    name: 'Sweet Spot 3x15',
    description: '3 x 15 minutes at 88-94% FTP with 5 minute easy recoveries.',
    category: 'road',
    dsl: '3x\nwork 15min ±15% @ 88-94%FTP\nrecovery 5min ±40% @ <55%FTP',
  },
  {
    slug: 'sys_road_threshold_2x20',
    name: 'Threshold 2x20',
    description: '2 x 20 minutes at 95-105% FTP with 5 minute easy recovery.',
    category: 'road',
    dsl: '2x\nwork 20min ±15% @ 95-105%FTP\nrecovery 5min ±40% @ <55%FTP',
  },
  {
    slug: 'sys_road_vo2max_5x4',
    name: 'VO2max 5x4',
    description: '5 x 4 minutes at 106-120% FTP with 4 minute recoveries.',
    category: 'road',
    dsl: '5x\nwork 4min ±15% @ 106-120%FTP\nrecovery 4min ±40% @ <55%FTP',
  },
  {
    slug: 'sys_road_tabata_8x',
    name: 'Tabata-style 8x20/10',
    description: '8 x 20 seconds above 150% FTP with 10 second recoveries.',
    category: 'road',
    dsl: '8x\nwork 20sec ±20% @ >150%FTP\nrecovery 10sec ±30% @ <55%FTP',
  },
  {
    slug: 'sys_road_30_30_10x',
    name: '30/30 10x',
    description: '10 x 30 seconds above 120% FTP with 30 second recoveries.',
    category: 'road',
    dsl: '10x\nwork 30sec ±20% @ >120%FTP\nrecovery 30sec ±30% @ <55%FTP',
  },
  {
    slug: 'sys_road_sprints_10x10s',
    name: 'Sprints 10x10s',
    description: '10 best-effort 10 second sprints with 3 minute recoveries.',
    category: 'road',
    dsl: '10x\nwork 10sec ±20% @ best\nrecovery 3min ±40% @ <55%FTP',
  },
  {
    slug: 'sys_road_best_20min',
    name: 'Best 20min',
    description: 'Single best 20 minute average power window.',
    category: 'road',
    dsl: '1x\nwork 20min ±10% @ best',
  },
  {
    slug: 'sys_road_best_5min',
    name: 'Best 5min',
    description: 'Single best 5 minute average power window.',
    category: 'road',
    dsl: '1x\nwork 5min ±10% @ best',
  },
  {
    slug: 'sys_road_endurance_60min',
    name: 'Endurance 60min',
    description: 'Steady 60 minute endurance block at 56-75% FTP.',
    category: 'road',
    dsl: '1x\nwork 60min ±15% @ 56-75%FTP',
  },
  {
    slug: 'sys_track_flying_200',
    name: 'Flying 200',
    description: 'Fastest 200m window by average speed.',
    category: 'track',
    dsl: '1x\nwork 200m ±10% @ best speed',
  },
  {
    slug: 'sys_track_pursuit_4km',
    name: 'Pursuit 4km',
    description: 'Best average power over 4km (Individual Pursuit pacing).',
    category: 'track',
    dsl: '1x\nwork 4km ±5% @ best power',
  },
  {
    slug: 'sys_track_pursuit_3km',
    name: 'Pursuit 3km',
    description: 'Best average power over 3km (Individual Pursuit pacing).',
    category: 'track',
    dsl: '1x\nwork 3km ±5% @ best power',
  },
  {
    slug: 'sys_track_pursuit_2km',
    name: 'Pursuit 2km',
    description: 'Best average power over 2km (Team Pursuit-style effort).',
    category: 'track',
    dsl: '1x\nwork 2km ±5% @ best power',
  },
  {
    slug: 'sys_track_500m',
    name: '500m',
    description: 'Best average power over 500m.',
    category: 'track',
    dsl: '1x\nwork 500m ±5% @ best power',
  },
  {
    slug: 'sys_track_kilo',
    name: 'Kilo (1km)',
    description: 'Best average power over 1km.',
    category: 'track',
    dsl: '1x\nwork 1km ±5% @ best power',
  },
  {
    slug: 'sys_track_repeated_flying_200s',
    name: 'Repeated Flying 200s',
    description: '4 x flying 200m by average speed with 10 minute easy recoveries.',
    category: 'track',
    dsl: '4x\nwork 200m ±10% @ best speed\nrecovery 10min ±40% @ <50%FTP',
  },
]

// Lactate-threshold templates (issue #121), seeded by
// 20261104000000_lactate_threshold_templates.sql. They need LT1/LT2 set in the profile
// for the activity's date; otherwise the run reports a message instead of efforts.
export const LT_SYSTEM_TEMPLATES = [
  {
    slug: 'sys_lt_lt2_intervals_4x8',
    name: 'LT2 intervals 4x8',
    description: '4 x 8 minutes at 95-105% of LT2 power with 4 minute recoveries below LT1. Reports time between LT1/LT2 and above LT2.',
    category: 'road',
    dsl: '4x\nwork 8min ±15% @ 95-105%LT2\nrecovery 4min ±40% @ <100%LT1\nmetrics avg_power, avg_hr, time_lt1_lt2, time_above_lt2',
  },
  {
    slug: 'sys_lt_lt2_hr_3x10',
    name: 'LT2 heart-rate blocks 3x10',
    description: '3 x 10 minutes at 97-103% of LT2 heart rate with 5 minute recoveries below LT1 heart rate.',
    category: 'road',
    dsl: '3x\nwork 10min ±15% @ 97-103%LT2HR\nrecovery 5min ±40% @ <100%LT1HR\nmetrics avg_power, avg_hr, decoupling, time_lt1_lt2_hr, time_above_lt2_hr',
  },
  {
    slug: 'sys_lt_lt1_endurance_90',
    name: 'LT1 endurance 90min',
    description: 'One 90 minute steady ride at 85-100% of LT1 power, reporting decoupling and time below/above LT1.',
    category: 'road',
    dsl: '1x\nwork 90min ±20% @ 85-100%LT1\nmetrics avg_power, avg_hr, decoupling, time_below_lt1, time_lt1_lt2',
  },
  {
    slug: 'sys_lt_over_unders',
    name: 'LT2 over-unders 3x(4+2)',
    description: '3 x (4 minutes just under LT2 then 2 minutes just over), 5 minute recoveries below LT1.',
    category: 'road',
    dsl: '3x\nwork 4min ±10% @ 92-98%LT2\nthen work 2min ±10% @ 103-108%LT2\nrecovery 5min ±40% @ <100%LT1\nmetrics avg_power, time_lt1_lt2, time_above_lt2',
  },
]

// Power-to-weight templates (issue #144), seeded by 20261107000000_wkg_templates.sql. They need a
// body weight in the profile for the activity's date; otherwise the run reports a message.
export const WKG_SYSTEM_TEMPLATES = [
  {
    slug: 'sys_wkg_threshold_2x20',
    name: 'Threshold W/kg 2x20',
    description: '2 x 20 minutes at 3.5-4 W/kg with 5 minute easy recoveries. Reports W/kg per effort.',
    category: 'road',
    dsl: '2x\nwork 20min ±15% @ 3.5-4W/kg\nrecovery 5min ±40% @ <2W/kg\nmetrics avg_power, avg_wkg, np_wkg',
  },
  {
    slug: 'sys_wkg_climb_4x8',
    name: 'Climbing W/kg 4x8',
    description: '4 x 8 minutes climbing at 4-4.5 W/kg with 4 minute recoveries.',
    category: 'road',
    dsl: '4x\nwork 8min ±15% @ 4-4.5W/kg\nrecovery 4min ±40% @ <2W/kg\nmetrics avg_power, avg_wkg, avg_hr',
  },
  {
    slug: 'sys_wkg_vo2_5x3',
    name: 'VO2max W/kg 5x3',
    description: '5 x 3 minutes above 5 W/kg with 3 minute recoveries.',
    category: 'road',
    dsl: '5x\nwork 3min ±20% @ >5W/kg\nrecovery 3min ±40% @ <2W/kg\nmetrics avg_power, avg_wkg, max_wkg',
  },
]

// Power-zone templates (issue #194), seeded by 20261128000000_power_zone_templates.sql. They use
// the activity's zone snapshot (LT-based, or estimated from FTP); without either, the run reports
// a message instead of efforts.
export const ZONE_SYSTEM_TEMPLATES = [
  {
    slug: 'sys_zone_tempo_3x15',
    name: 'Tempo Z3 3x15',
    description: '3 x 15 minutes in power zone Z3 (tempo) with 5 minute recoveries in Z1-Z2. Reports time in each zone.',
    category: 'road',
    dsl: '3x\nwork 15min ±10% @ Z3\nrecovery 5min ±40% @ <Z3\nmetrics avg_power, avg_hr, time_z2, time_z3, time_z4',
  },
  {
    slug: 'sys_zone_endurance_z2_90',
    name: 'Endurance Z2 90min',
    description: 'One 90 minute steady ride in power zone Z2, reporting decoupling and time in Z1-Z3.',
    category: 'road',
    dsl: '1x\nwork 90min ±20% @ Z2\nmetrics avg_power, avg_hr, decoupling, time_z1, time_z2, time_z3',
  },
  {
    slug: 'sys_zone_vo2_5x4',
    name: 'VO2max Z5 5x4',
    description: '5 x 4 minutes in power zone Z5 with 4 minute recoveries below Z3.',
    category: 'road',
    dsl: '5x\nwork 4min ±15% @ Z5\nrecovery 4min ±40% @ <Z3\nmetrics avg_power, avg_hr, time_z4, time_z5, time_z6',
  },
]

export function buildLtManifest(dsl) {
  const parsed = parseIntervalDsl(dsl)
  if (parsed.errors.length) throw new Error(`Invalid DSL: ${JSON.stringify(parsed.errors)}`)
  return buildIntervalManifest(parsed)
}

export function buildManifest(dsl) {
  const { repeatCount, steps, errors } = parseIntervalDsl(dsl)
  if (errors.length) throw new Error(`Invalid DSL: ${JSON.stringify(errors)}`)
  return { pattern: 'custom_intervals', repeat_count: repeatCount, steps }
}

// DSL equivalents of the fixed-pattern templates seeded by
// 20260925000000_activity_analyzer.sql (issue #128). Written to dsl_source by
// 20261102000000_legacy_template_dsl_source.sql; their manifests are unchanged.
export const LEGACY_TEMPLATE_DSL = {
  tpl_vo2max_3min: 'pattern repeated_bursts\ncount 3\nduration 3min ±45sec\nrecovery window 1min',
  tpl_track_f200: 'pattern flying_sprint\ndistance 200m',
  tpl_track_pursuit: 'pattern sustained_tt\ndistances 2km, 3km, 4km\nlap 250m',
  tpl_track_standing_start: 'pattern standing_start\ndistance 1km',
  tpl_road_z2_decoupling: 'pattern sustained_tt\nmin duration 20min\nmetrics decoupling',
}

// Manifests exactly as seeded in the database.
export const LEGACY_SEEDED_MANIFESTS = {
  tpl_vo2max_3min: { pattern: 'repeated_bursts', target_count: 3, target_duration_sec: 180, duration_tolerance_sec: 45, metrics: ['avg_power', 'dropoff_pct', 'pacing_index', 'hr_recovery_60s'], recovery_window_sec: 60 },
  tpl_track_f200: { pattern: 'flying_sprint', distance_m: 200, metrics: ['max_cadence', 'max_power', 'estimated_time', 'pacing_index'] },
  tpl_track_pursuit: { pattern: 'sustained_tt', distances_m: [2000, 3000, 4000], lap_length_m: 250, metrics: ['avg_power', 'lap_splits_250m', 'pacing_index', 'dropoff_pct'] },
  tpl_track_standing_start: { pattern: 'standing_start', distance_m: 1000, metrics: ['peak_torque', 'time_to_peak_power_sec', 'max_power', 'avg_power_first_10s'] },
  tpl_road_z2_decoupling: { pattern: 'sustained_tt', min_duration_sec: 1200, metrics: ['pw_hr_decoupling_pct', 'avg_power', 'avg_heartrate'] },
}

export const ALL_SYSTEM_TEMPLATES = [...SYSTEM_TEMPLATES, ...LT_SYSTEM_TEMPLATES, ...WKG_SYSTEM_TEMPLATES, ...ZONE_SYSTEM_TEMPLATES]

/** One `analysis_templates` VALUES row, formatted exactly as in the seed migrations. */
export function systemTemplateRowSql(t, manifest) {
  return `(\n    $q$${t.slug}$q$,\n    $q$${t.name}$q$,\n    $q$${t.description}$q$,\n    $q$${t.category}$q$,\n    $q$${JSON.stringify(manifest)}$q$::jsonb,\n    $q$${t.dsl}$q$\n)`
}

/** Idempotent upsert (keyed on slug) for a list of catalogue templates. Never deletes rows. */
export function manifestBuilderFor(t) {
  return SYSTEM_TEMPLATES.includes(t) ? buildManifest : buildLtManifest
}

export function systemTemplatesUpsertSql(templates, manifestBuilder = null) {
  const rows = templates
    .map((t) => systemTemplateRowSql(t, (manifestBuilder || manifestBuilderFor(t))(t.dsl)))
    .join(',\n')
  return `INSERT INTO public.analysis_templates (slug, name, description, category, manifest, dsl_source, user_id, visibility)
SELECT v.slug, v.name, v.description, v.category, v.manifest, v.dsl_source, NULL, 'public'
FROM (VALUES
${rows}
) AS v(slug, name, description, category, manifest, dsl_source)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    manifest = EXCLUDED.manifest,
    dsl_source = EXCLUDED.dsl_source,
    user_id = NULL,
    visibility = 'public';
`
}
