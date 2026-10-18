-- Express the five seeded fixed-pattern templates in the DSL (issue #128, part of #119).
-- Only dsl_source is filled in so the templates can be viewed, copied and shared as
-- DSL; manifests are deliberately left untouched, so evaluation results and stored
-- template_executions are unchanged. Equivalence of each DSL with its manifest is
-- asserted by src/lib/__tests__/legacyPatterns.test.js (DSL source:
-- LEGACY_TEMPLATE_DSL in src/lib/systemTemplates.js). Idempotent.

UPDATE public.analysis_templates AS t
SET dsl_source = v.dsl_source
FROM (VALUES
(
    $q$tpl_vo2max_3min$q$,
    $q$pattern repeated_bursts
count 3
duration 3min ±45sec
recovery window 1min$q$
),
(
    $q$tpl_track_f200$q$,
    $q$pattern flying_sprint
distance 200m$q$
),
(
    $q$tpl_track_pursuit$q$,
    $q$pattern sustained_tt
distances 2km, 3km, 4km
lap 250m$q$
),
(
    $q$tpl_track_standing_start$q$,
    $q$pattern standing_start
distance 1km$q$
),
(
    $q$tpl_road_z2_decoupling$q$,
    $q$pattern sustained_tt
min duration 20min
metrics decoupling$q$
)
) AS v(slug, dsl_source)
WHERE t.slug = v.slug
  AND t.user_id IS NULL
  AND t.dsl_source IS NULL;
