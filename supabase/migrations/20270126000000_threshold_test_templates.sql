-- VelocityStack: threshold test system templates (issue #379, part of #119)
-- Generated: node scripts/generate-system-templates-sql.mjs sys_test_
INSERT INTO public.analysis_templates (slug, name, description, category, manifest, dsl_source, user_id, visibility)
SELECT v.slug, v.name, v.description, v.category, v.manifest, v.dsl_source, NULL, 'public'
FROM (VALUES
(
    $q$sys_test_ftp_20min$q$,
    $q$FTP test 20min$q$,
    $q$Best 20 minutes: FTP = 95% of the average, LT2 HR = average HR of the window. Also shows a labeled LT1 fallback estimate.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":1200,"targetDistanceM":null,"durationTolerancePct":0,"bandType":"best","bestMetric":"power","powerMin":null,"powerMax":null}],"summary_metrics":[{"id":"avg_power"},{"id":"avg_hr"},{"id":"pacing"},{"id":"estimated_ftp","protocol":"20min"},{"id":"estimated_lt2_power","protocol":"20min"},{"id":"estimated_lt2_hr","protocol":"20min"},{"id":"estimated_lt1_power","protocol":"20min"},{"id":"estimated_lt1_hr","protocol":"20min"}]}$q$::jsonb,
    $q$1x
work 20min ±0% @ best
metrics avg_power, avg_hr, pacing, estimated_ftp(20min), estimated_lt2_power(20min), estimated_lt2_hr(20min), estimated_lt1_power(20min), estimated_lt1_hr(20min)$q$
),
(
    $q$sys_test_ftp_8min$q$,
    $q$FTP test 8min$q$,
    $q$Best of two 8 minute efforts: FTP = 90% of the best average.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":2,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":480,"targetDistanceM":null,"durationTolerancePct":0,"bandType":"best","bestMetric":"power","powerMin":null,"powerMax":null}],"summary_metrics":[{"id":"avg_power"},{"id":"avg_hr"},{"id":"pacing"},{"id":"estimated_ftp","protocol":"8min"},{"id":"estimated_lt2_power","protocol":"8min"}]}$q$::jsonb,
    $q$2x
work 8min ±0% @ best
metrics avg_power, avg_hr, pacing, estimated_ftp(8min), estimated_lt2_power(8min)$q$
),
(
    $q$sys_test_ramp$q$,
    $q$Ramp test$q$,
    $q$Ramp to failure: FTP = 75% of the best 1 minute power.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":600,"targetDistanceM":null,"durationTolerancePct":0,"bandType":"best","bestMetric":"power","powerMin":null,"powerMax":null}],"summary_metrics":[{"id":"max_power"},{"id":"avg_hr"},{"id":"estimated_ftp","protocol":"ramp"},{"id":"estimated_lt2_power","protocol":"ramp"}]}$q$::jsonb,
    $q$1x
work 10min ±0% @ best
metrics max_power, avg_hr, estimated_ftp(ramp), estimated_lt2_power(ramp)$q$
),
(
    $q$sys_test_lt2_30min$q$,
    $q$LT2 / LTHR test 30min$q$,
    $q$30 minute all-out test: FTP = average power, LT2 HR = average HR of the last 20 minutes (Friel style).$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":1800,"targetDistanceM":null,"durationTolerancePct":0,"bandType":"best","bestMetric":"power","powerMin":null,"powerMax":null}],"summary_metrics":[{"id":"avg_power"},{"id":"avg_hr"},{"id":"pacing"},{"id":"estimated_ftp","protocol":"30min"},{"id":"estimated_lt2_power","protocol":"30min"},{"id":"estimated_lt2_hr","protocol":"30min"}]}$q$::jsonb,
    $q$1x
work 30min ±0% @ best
metrics avg_power, avg_hr, pacing, estimated_ftp(30min), estimated_lt2_power(30min), estimated_lt2_hr(30min)$q$
),
(
    $q$sys_test_lt1_steady$q$,
    $q$LT1 steady-state test$q$,
    $q$Long steady endurance effort: LT1 = the highest steady power with aerobic decoupling below 5%, with its average heart rate.$q$,
    $q$road$q$,
    $q${"pattern":"custom_intervals","repeat_count":1,"steps":[{"role":"work","keyBy":"duration","targetDurationSec":3600,"targetDistanceM":null,"durationTolerancePct":0,"bandType":"best","bestMetric":"power","powerMin":null,"powerMax":null}],"summary_metrics":[{"id":"avg_power"},{"id":"avg_hr"},{"id":"decoupling"},{"id":"estimated_lt1_power","protocol":"steady"},{"id":"estimated_lt1_hr","protocol":"steady"}]}$q$::jsonb,
    $q$1x
work 60min ±0% @ best
metrics avg_power, avg_hr, decoupling, estimated_lt1_power(steady), estimated_lt1_hr(steady)$q$
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
