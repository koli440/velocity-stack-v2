-- Power-zone system templates (issue #194, part of #119).
-- Idempotent upsert keyed on slug. DSL source: ZONE_SYSTEM_TEMPLATES in
-- src/lib/systemTemplates.js (kept in sync by src/lib/__tests__/zoneTemplates.test.js).

INSERT INTO public.analysis_templates (slug, name, description, category, manifest, dsl_source, user_id, visibility)
SELECT v.slug, v.name, v.description, v.category, v.manifest, v.dsl_source, NULL, 'public'
FROM (VALUES
(
    $q$sys_zone_tempo_3x15$q$,
    $q$Tempo Z3 3x15$q$,
    $q$3 x 15 minutes in power zone Z3 (tempo) with 5 minute recoveries in Z1-Z2. Reports time in each zone.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":3,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":900,"targetDistanceM":null,"durationTolerancePct":10,"bandType":"zone","bestMetric":null,"powerMin":3,"powerMax":3},{"role":"recovery","keyBy":"duration","targetDurationSec":300,"targetDistanceM":null,"durationTolerancePct":40,"bandType":"zone","bestMetric":null,"powerMin":null,"powerMax":3}],"summary_metrics":[{"id":"avg_power"},{"id":"avg_hr"},{"id":"time_z2"},{"id":"time_z3"},{"id":"time_z4"}]}$q$::jsonb,
    $q$3x
work 15min ±10% @ Z3
recovery 5min ±40% @ <Z3
metrics avg_power, avg_hr, time_z2, time_z3, time_z4$q$
),
(
    $q$sys_zone_endurance_z2_90$q$,
    $q$Endurance Z2 90min$q$,
    $q$One 90 minute steady ride in power zone Z2, reporting decoupling and time in Z1-Z3.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":5400,"targetDistanceM":null,"durationTolerancePct":20,"bandType":"zone","bestMetric":null,"powerMin":2,"powerMax":2}],"summary_metrics":[{"id":"avg_power"},{"id":"avg_hr"},{"id":"decoupling"},{"id":"time_z1"},{"id":"time_z2"},{"id":"time_z3"}]}$q$::jsonb,
    $q$1x
work 90min ±20% @ Z2
metrics avg_power, avg_hr, decoupling, time_z1, time_z2, time_z3$q$
),
(
    $q$sys_zone_vo2_5x4$q$,
    $q$VO2max Z5 5x4$q$,
    $q$5 x 4 minutes in power zone Z5 with 4 minute recoveries below Z3.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":5,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":240,"targetDistanceM":null,"durationTolerancePct":15,"bandType":"zone","bestMetric":null,"powerMin":5,"powerMax":5},{"role":"recovery","keyBy":"duration","targetDurationSec":240,"targetDistanceM":null,"durationTolerancePct":40,"bandType":"zone","bestMetric":null,"powerMin":null,"powerMax":3}],"summary_metrics":[{"id":"avg_power"},{"id":"avg_hr"},{"id":"time_z4"},{"id":"time_z5"},{"id":"time_z6"}]}$q$::jsonb,
    $q$5x
work 4min ±15% @ Z5
recovery 4min ±40% @ <Z3
metrics avg_power, avg_hr, time_z4, time_z5, time_z6$q$
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
