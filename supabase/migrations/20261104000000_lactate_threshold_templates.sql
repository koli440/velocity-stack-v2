-- Lactate-threshold system templates (issue #121, part of #119).
-- Idempotent upsert keyed on slug. DSL source: LT_SYSTEM_TEMPLATES in
-- src/lib/systemTemplates.js (kept in sync by src/lib/__tests__/ltTemplates.test.js).

INSERT INTO public.analysis_templates (slug, name, description, category, manifest, dsl_source, user_id, visibility)
SELECT v.slug, v.name, v.description, v.category, v.manifest, v.dsl_source, NULL, 'public'
FROM (VALUES
(
    $q$sys_lt_lt2_intervals_4x8$q$,
    $q$LT2 intervals 4x8$q$,
    $q$4 x 8 minutes at 95-105% of LT2 power with 4 minute recoveries below LT1. Reports time between LT1/LT2 and above LT2.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":4,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":480,"targetDistanceM":null,"durationTolerancePct":15,"bandType":"pct_lt2","bestMetric":null,"powerMin":95,"powerMax":105},{"role":"recovery","keyBy":"duration","targetDurationSec":240,"targetDistanceM":null,"durationTolerancePct":40,"bandType":"pct_lt1","bestMetric":null,"powerMin":null,"powerMax":100}],"summary_metrics":[{"id":"avg_power"},{"id":"avg_hr"},{"id":"time_lt1_lt2"},{"id":"time_above_lt2"}]}$q$::jsonb,
    $q$4x
work 8min ±15% @ 95-105%LT2
recovery 4min ±40% @ <100%LT1
metrics avg_power, avg_hr, time_lt1_lt2, time_above_lt2$q$
),
(
    $q$sys_lt_lt2_hr_3x10$q$,
    $q$LT2 heart-rate blocks 3x10$q$,
    $q$3 x 10 minutes at 97-103% of LT2 heart rate with 5 minute recoveries below LT1 heart rate.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":3,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":600,"targetDistanceM":null,"durationTolerancePct":15,"bandType":"pct_lt2_hr","bestMetric":null,"powerMin":97,"powerMax":103},{"role":"recovery","keyBy":"duration","targetDurationSec":300,"targetDistanceM":null,"durationTolerancePct":40,"bandType":"pct_lt1_hr","bestMetric":null,"powerMin":null,"powerMax":100}],"summary_metrics":[{"id":"avg_power"},{"id":"avg_hr"},{"id":"decoupling"},{"id":"time_lt1_lt2_hr"},{"id":"time_above_lt2_hr"}]}$q$::jsonb,
    $q$3x
work 10min ±15% @ 97-103%LT2HR
recovery 5min ±40% @ <100%LT1HR
metrics avg_power, avg_hr, decoupling, time_lt1_lt2_hr, time_above_lt2_hr$q$
),
(
    $q$sys_lt_lt1_endurance_90$q$,
    $q$LT1 endurance 90min$q$,
    $q$One 90 minute steady ride at 85-100% of LT1 power, reporting decoupling and time below/above LT1.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":5400,"targetDistanceM":null,"durationTolerancePct":20,"bandType":"pct_lt1","bestMetric":null,"powerMin":85,"powerMax":100}],"summary_metrics":[{"id":"avg_power"},{"id":"avg_hr"},{"id":"decoupling"},{"id":"time_below_lt1"},{"id":"time_lt1_lt2"}]}$q$::jsonb,
    $q$1x
work 90min ±20% @ 85-100%LT1
metrics avg_power, avg_hr, decoupling, time_below_lt1, time_lt1_lt2$q$
),
(
    $q$sys_lt_over_unders$q$,
    $q$LT2 over-unders 3x(4+2)$q$,
    $q$3 x (4 minutes just under LT2 then 2 minutes just over), 5 minute recoveries below LT1.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":3,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":240,"targetDistanceM":null,"durationTolerancePct":10,"bandType":"pct_lt2","bestMetric":null,"powerMin":92,"powerMax":98},{"role":"work","keyBy":"duration","targetDurationSec":120,"targetDistanceM":null,"durationTolerancePct":10,"bandType":"pct_lt2","bestMetric":null,"powerMin":103,"powerMax":108,"contiguous":true},{"role":"recovery","keyBy":"duration","targetDurationSec":300,"targetDistanceM":null,"durationTolerancePct":40,"bandType":"pct_lt1","bestMetric":null,"powerMin":null,"powerMax":100}],"summary_metrics":[{"id":"avg_power"},{"id":"time_lt1_lt2"},{"id":"time_above_lt2"}]}$q$::jsonb,
    $q$3x
work 4min ±10% @ 92-98%LT2
then work 2min ±10% @ 103-108%LT2
recovery 5min ±40% @ <100%LT1
metrics avg_power, time_lt1_lt2, time_above_lt2$q$
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
