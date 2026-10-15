-- Power-to-weight (W/kg) system templates (issue #144, part of #119).
-- Idempotent upsert keyed on slug. DSL source: WKG_SYSTEM_TEMPLATES in
-- src/lib/systemTemplates.js (kept in sync by src/lib/__tests__/wkgDsl.test.js).

INSERT INTO public.analysis_templates (slug, name, description, category, manifest, dsl_source, user_id, visibility)
SELECT v.slug, v.name, v.description, v.category, v.manifest, v.dsl_source, NULL, 'public'
FROM (VALUES
(
    $q$sys_wkg_threshold_2x20$q$,
    $q$Threshold W/kg 2x20$q$,
    $q$2 x 20 minutes at 3.5-4 W/kg with 5 minute easy recoveries. Reports W/kg per effort.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":2,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":1200,"targetDistanceM":null,"durationTolerancePct":15,"bandType":"wkg","bestMetric":null,"powerMin":3.5,"powerMax":4},{"role":"recovery","keyBy":"duration","targetDurationSec":300,"targetDistanceM":null,"durationTolerancePct":40,"bandType":"wkg","bestMetric":null,"powerMin":null,"powerMax":2}],"summary_metrics":[{"id":"avg_power"},{"id":"avg_wkg"},{"id":"np_wkg"}]}$q$::jsonb,
    $q$2x
work 20min ±15% @ 3.5-4W/kg
recovery 5min ±40% @ <2W/kg
metrics avg_power, avg_wkg, np_wkg$q$
),
(
    $q$sys_wkg_climb_4x8$q$,
    $q$Climbing W/kg 4x8$q$,
    $q$4 x 8 minutes climbing at 4-4.5 W/kg with 4 minute recoveries.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":4,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":480,"targetDistanceM":null,"durationTolerancePct":15,"bandType":"wkg","bestMetric":null,"powerMin":4,"powerMax":4.5},{"role":"recovery","keyBy":"duration","targetDurationSec":240,"targetDistanceM":null,"durationTolerancePct":40,"bandType":"wkg","bestMetric":null,"powerMin":null,"powerMax":2}],"summary_metrics":[{"id":"avg_power"},{"id":"avg_wkg"},{"id":"avg_hr"}]}$q$::jsonb,
    $q$4x
work 8min ±15% @ 4-4.5W/kg
recovery 4min ±40% @ <2W/kg
metrics avg_power, avg_wkg, avg_hr$q$
),
(
    $q$sys_wkg_vo2_5x3$q$,
    $q$VO2max W/kg 5x3$q$,
    $q$5 x 3 minutes above 5 W/kg with 3 minute recoveries.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":5,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":180,"targetDistanceM":null,"durationTolerancePct":20,"bandType":"wkg","bestMetric":null,"powerMin":5,"powerMax":null},{"role":"recovery","keyBy":"duration","targetDurationSec":180,"targetDistanceM":null,"durationTolerancePct":40,"bandType":"wkg","bestMetric":null,"powerMin":null,"powerMax":2}],"summary_metrics":[{"id":"avg_power"},{"id":"avg_wkg"},{"id":"max_wkg"}]}$q$::jsonb,
    $q$5x
work 3min ±20% @ >5W/kg
recovery 3min ±40% @ <2W/kg
metrics avg_power, avg_wkg, max_wkg$q$
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
