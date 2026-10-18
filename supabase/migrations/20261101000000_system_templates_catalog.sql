-- System analysis templates catalog (issue #122, part of #119).
-- Idempotent upsert: re-running or editing this seed propagates changes via
-- ON CONFLICT (slug) DO UPDATE. DSL source: src/lib/systemTemplates.js
-- (kept in sync by src/lib/__tests__/systemTemplates.test.js). Existing seeded
-- templates (e.g. tpl_road_z2_decoupling) are left untouched.

INSERT INTO public.analysis_templates (slug, name, description, category, manifest, dsl_source, user_id, visibility)
SELECT v.slug, v.name, v.description, v.category, v.manifest, v.dsl_source, NULL, 'public'
FROM (VALUES
(
    $q$sys_road_sweet_spot_3x15$q$,
    $q$Sweet Spot 3x15$q$,
    $q$3 x 15 minutes at 88-94% FTP with 5 minute easy recoveries.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":3,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":900,"targetDistanceM":null,"durationTolerancePct":15,"bandType":"pct_ftp","bestMetric":null,"powerMin":88,"powerMax":94},{"role":"recovery","keyBy":"duration","targetDurationSec":300,"targetDistanceM":null,"durationTolerancePct":40,"bandType":"pct_ftp","bestMetric":null,"powerMin":null,"powerMax":55}]}$q$::jsonb,
    $q$3x
work 15min ±15% @ 88-94%FTP
recovery 5min ±40% @ <55%FTP$q$
),
(
    $q$sys_road_threshold_2x20$q$,
    $q$Threshold 2x20$q$,
    $q$2 x 20 minutes at 95-105% FTP with 5 minute easy recovery.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":2,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":1200,"targetDistanceM":null,"durationTolerancePct":15,"bandType":"pct_ftp","bestMetric":null,"powerMin":95,"powerMax":105},{"role":"recovery","keyBy":"duration","targetDurationSec":300,"targetDistanceM":null,"durationTolerancePct":40,"bandType":"pct_ftp","bestMetric":null,"powerMin":null,"powerMax":55}]}$q$::jsonb,
    $q$2x
work 20min ±15% @ 95-105%FTP
recovery 5min ±40% @ <55%FTP$q$
),
(
    $q$sys_road_vo2max_5x4$q$,
    $q$VO2max 5x4$q$,
    $q$5 x 4 minutes at 106-120% FTP with 4 minute recoveries.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":5,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":240,"targetDistanceM":null,"durationTolerancePct":15,"bandType":"pct_ftp","bestMetric":null,"powerMin":106,"powerMax":120},{"role":"recovery","keyBy":"duration","targetDurationSec":240,"targetDistanceM":null,"durationTolerancePct":40,"bandType":"pct_ftp","bestMetric":null,"powerMin":null,"powerMax":55}]}$q$::jsonb,
    $q$5x
work 4min ±15% @ 106-120%FTP
recovery 4min ±40% @ <55%FTP$q$
),
(
    $q$sys_road_tabata_8x$q$,
    $q$Tabata-style 8x20/10$q$,
    $q$8 x 20 seconds above 150% FTP with 10 second recoveries.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":8,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":20,"targetDistanceM":null,"durationTolerancePct":20,"bandType":"pct_ftp","bestMetric":null,"powerMin":150,"powerMax":null},{"role":"recovery","keyBy":"duration","targetDurationSec":10,"targetDistanceM":null,"durationTolerancePct":30,"bandType":"pct_ftp","bestMetric":null,"powerMin":null,"powerMax":55}]}$q$::jsonb,
    $q$8x
work 20sec ±20% @ >150%FTP
recovery 10sec ±30% @ <55%FTP$q$
),
(
    $q$sys_road_30_30_10x$q$,
    $q$30/30 10x$q$,
    $q$10 x 30 seconds above 120% FTP with 30 second recoveries.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":10,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":30,"targetDistanceM":null,"durationTolerancePct":20,"bandType":"pct_ftp","bestMetric":null,"powerMin":120,"powerMax":null},{"role":"recovery","keyBy":"duration","targetDurationSec":30,"targetDistanceM":null,"durationTolerancePct":30,"bandType":"pct_ftp","bestMetric":null,"powerMin":null,"powerMax":55}]}$q$::jsonb,
    $q$10x
work 30sec ±20% @ >120%FTP
recovery 30sec ±30% @ <55%FTP$q$
),
(
    $q$sys_road_sprints_10x10s$q$,
    $q$Sprints 10x10s$q$,
    $q$10 best-effort 10 second sprints with 3 minute recoveries.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":10,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":10,"targetDistanceM":null,"durationTolerancePct":20,"bandType":"best","bestMetric":"power","powerMin":null,"powerMax":null},{"role":"recovery","keyBy":"duration","targetDurationSec":180,"targetDistanceM":null,"durationTolerancePct":40,"bandType":"pct_ftp","bestMetric":null,"powerMin":null,"powerMax":55}]}$q$::jsonb,
    $q$10x
work 10sec ±20% @ best
recovery 3min ±40% @ <55%FTP$q$
),
(
    $q$sys_road_best_20min$q$,
    $q$Best 20min$q$,
    $q$Single best 20 minute average power window.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":1200,"targetDistanceM":null,"durationTolerancePct":10,"bandType":"best","bestMetric":"power","powerMin":null,"powerMax":null}]}$q$::jsonb,
    $q$1x
work 20min ±10% @ best$q$
),
(
    $q$sys_road_best_5min$q$,
    $q$Best 5min$q$,
    $q$Single best 5 minute average power window.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":300,"targetDistanceM":null,"durationTolerancePct":10,"bandType":"best","bestMetric":"power","powerMin":null,"powerMax":null}]}$q$::jsonb,
    $q$1x
work 5min ±10% @ best$q$
),
(
    $q$sys_road_endurance_60min$q$,
    $q$Endurance 60min$q$,
    $q$Steady 60 minute endurance block at 56-75% FTP.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":3600,"targetDistanceM":null,"durationTolerancePct":15,"bandType":"pct_ftp","bestMetric":null,"powerMin":56,"powerMax":75}]}$q$::jsonb,
    $q$1x
work 60min ±15% @ 56-75%FTP$q$
),
(
    $q$sys_track_flying_200$q$,
    $q$Flying 200$q$,
    $q$Fastest 200m window by average speed.$q$,
    $q$track$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"distance","targetDurationSec":null,"targetDistanceM":200,"durationTolerancePct":10,"bandType":"best","bestMetric":"speed","powerMin":null,"powerMax":null}]}$q$::jsonb,
    $q$1x
work 200m ±10% @ best speed$q$
),
(
    $q$sys_track_pursuit_4km$q$,
    $q$Pursuit 4km$q$,
    $q$Best average power over 4km (Individual Pursuit pacing).$q$,
    $q$track$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"distance","targetDurationSec":null,"targetDistanceM":4000,"durationTolerancePct":5,"bandType":"best","bestMetric":"power","powerMin":null,"powerMax":null}]}$q$::jsonb,
    $q$1x
work 4km ±5% @ best power$q$
),
(
    $q$sys_track_pursuit_3km$q$,
    $q$Pursuit 3km$q$,
    $q$Best average power over 3km (Individual Pursuit pacing).$q$,
    $q$track$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"distance","targetDurationSec":null,"targetDistanceM":3000,"durationTolerancePct":5,"bandType":"best","bestMetric":"power","powerMin":null,"powerMax":null}]}$q$::jsonb,
    $q$1x
work 3km ±5% @ best power$q$
),
(
    $q$sys_track_pursuit_2km$q$,
    $q$Pursuit 2km$q$,
    $q$Best average power over 2km (Team Pursuit-style effort).$q$,
    $q$track$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"distance","targetDurationSec":null,"targetDistanceM":2000,"durationTolerancePct":5,"bandType":"best","bestMetric":"power","powerMin":null,"powerMax":null}]}$q$::jsonb,
    $q$1x
work 2km ±5% @ best power$q$
),
(
    $q$sys_track_500m$q$,
    $q$500m$q$,
    $q$Best average power over 500m.$q$,
    $q$track$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"distance","targetDurationSec":null,"targetDistanceM":500,"durationTolerancePct":5,"bandType":"best","bestMetric":"power","powerMin":null,"powerMax":null}]}$q$::jsonb,
    $q$1x
work 500m ±5% @ best power$q$
),
(
    $q$sys_track_kilo$q$,
    $q$Kilo (1km)$q$,
    $q$Best average power over 1km.$q$,
    $q$track$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"distance","targetDurationSec":null,"targetDistanceM":1000,"durationTolerancePct":5,"bandType":"best","bestMetric":"power","powerMin":null,"powerMax":null}]}$q$::jsonb,
    $q$1x
work 1km ±5% @ best power$q$
),
(
    $q$sys_track_repeated_flying_200s$q$,
    $q$Repeated Flying 200s$q$,
    $q$4 x flying 200m by average speed with 10 minute easy recoveries.$q$,
    $q$track$q$,
    $q${"pattern":"custom_intervals","repeat_count":4,"steps":[{"role":"work","keyBy":"distance","targetDurationSec":null,"targetDistanceM":200,"durationTolerancePct":10,"bandType":"best","bestMetric":"speed","powerMin":null,"powerMax":null},{"role":"recovery","keyBy":"duration","targetDurationSec":600,"targetDistanceM":null,"durationTolerancePct":40,"bandType":"pct_ftp","bestMetric":null,"powerMin":null,"powerMax":50}]}$q$::jsonb,
    $q$4x
work 200m ±10% @ best speed
recovery 10min ±40% @ <50%FTP$q$
)
) AS v(slug, name, description, category, manifest, dsl_source)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    manifest = EXCLUDED.manifest,
    dsl_source = EXCLUDED.dsl_source,
    user_id = NULL,
    visibility = 'public';
