// System analysis templates catalog (issue #122). Source of truth for the
// DSL strings seeded by supabase/migrations/20261101000000_system_templates_catalog.sql;
// a unit test keeps the migration in sync with this list.
import { parseIntervalDsl } from './intervalDsl.js'

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
