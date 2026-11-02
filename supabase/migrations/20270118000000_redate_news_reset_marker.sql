-- News ids drifted into the future (2026-12 .. 2027-01) because each entry used "latest date + 1".
-- The entries were redated to their real dates (content/news); this migration fixes the stored
-- "seen up to" markers of users whose marker is a future-dated id (> '2026-11-03').
--
-- Per affected user: the entries they had seen are those whose OLD id <= their marker. The new marker is
-- the highest id that can never hide an entry they had not seen:
--   * all redated entries seen  -> '2026-10-30-calendar-opens-on-today' (newest entry that was never renamed)
--   * otherwise                 -> the date (YYYY-MM-DD, sorts just before every id of that day) of the
--                                  earliest unseen redated entry. Some seen entries from that day on
--                                  may therefore be shown again; nothing unseen is hidden.
-- Markers <= '2026-11-03' (correctly dated) are left alone. Re-running is a no-op.
-- The guard trigger only lets the marker move forward, so it is disabled for this transaction only
-- (DDL is transactional: a failure rolls everything back, trigger state included).

ALTER TABLE public.user_onboarding_state DISABLE TRIGGER user_onboarding_state_guard;

WITH renamed(old_id, new_id) AS (VALUES
    ('2026-12-01-coaching-mode', '2026-10-18-coaching-mode'),
    ('2026-12-04-calendar-notes', '2026-10-18-calendar-notes'),
    ('2026-12-06-planned-workouts', '2026-10-18-planned-workouts'),
    ('2026-12-08-intervals-push', '2026-10-18-intervals-push'),
    ('2026-12-09-template-syntax', '2026-10-18-template-syntax'),
    ('2026-12-10-calendar-races', '2026-10-18-calendar-races'),
    ('2026-12-10-pb-and-data-fixes', '2026-10-18-pb-and-data-fixes'),
    ('2026-12-11-activity-graph-zoom', '2026-10-19-activity-graph-zoom'),
    ('2026-12-11-buy-me-a-coffee', '2026-10-18-buy-me-a-coffee'),
    ('2026-12-11-live-comments', '2026-10-18-live-comments'),
    ('2026-12-20-template-runs-badge', '2026-10-19-template-runs-badge'),
    ('2026-12-21-clickable-request-notifications', '2026-10-19-clickable-request-notifications'),
    ('2026-12-22-email-notification-setting', '2026-10-20-email-notification-setting'),
    ('2026-12-22-email-notifications', '2026-10-20-email-notifications'),
    ('2026-12-22-password-recovery', '2026-10-20-password-recovery'),
    ('2026-12-23-faster-athlete-templates', '2026-10-20-faster-athlete-templates'),
    ('2026-12-24-strava-history-gap-fixed', '2026-10-21-strava-history-gap-fixed'),
    ('2026-12-25-ride-type-and-gears', '2026-10-21-ride-type-and-gears'),
    ('2026-12-26-mobile-calendar-empty-days', '2026-10-22-mobile-calendar-empty-days'),
    ('2026-12-27-fix-template-favorites', '2026-10-22-fix-template-favorites'),
    ('2026-12-28-planned-time-and-links', '2026-10-22-planned-time-and-links'),
    ('2026-12-28-template-rep-analysis', '2026-10-22-template-rep-analysis'),
    ('2026-12-29-collapsible-template-runs', '2026-10-22-collapsible-template-runs'),
    ('2026-12-30-fitness-fatigue-form', '2026-10-22-fitness-fatigue-form'),
    ('2026-12-31-coach-fitness-view', '2026-10-22-coach-fitness-view'),
    ('2026-12-31-gear-architect-records', '2026-10-22-gear-architect-records'),
    ('2027-01-02-races-in-calendar', '2026-10-22-races-in-calendar'),
    ('2027-01-03-activity-back-navigation', '2026-10-22-activity-back-navigation'),
    ('2027-01-04-race-badge-in-feeds', '2026-10-22-race-badge-in-feeds'),
    ('2027-01-05-calendar-race-icons', '2026-10-22-calendar-race-icons'),
    ('2027-01-06-enlarge-activity-graph', '2026-10-23-enlarge-activity-graph'),
    ('2027-01-07-auto-link-planned-workout', '2026-10-23-auto-link-planned-workout'),
    ('2027-01-08-template-stats-single-column', '2026-10-23-template-stats-single-column'),
    ('2027-01-09-continue-with-google', '2026-10-23-continue-with-google'),
    ('2027-01-10-privacy-policy-and-terms', '2026-10-23-privacy-policy-and-terms'),
    ('2027-01-10-wahoo-direct-connection', '2026-10-24-wahoo-direct-connection'),
    ('2027-01-11-wahoo-workout-upload', '2026-10-24-wahoo-workout-upload'),
    ('2027-01-12-srm-pc8-import-help', '2026-10-24-srm-pc8-import-help'),
    ('2027-01-13-intervals-oauth', '2026-10-24-intervals-oauth'),
    ('2027-01-14-install-app', '2026-10-25-install-app'),
    ('2027-01-14-intervals-webhooks', '2026-10-24-intervals-webhooks'),
    ('2027-01-15-gym-sessions', '2026-10-26-gym-sessions'),
    ('2027-01-15-track-landing', '2026-10-26-track-landing'),
    ('2027-01-16-gym-exercises-sets', '2026-10-26-gym-exercises-sets'),
    ('2027-01-17-gym-not-rides', '2026-10-26-gym-not-rides'),
    ('2027-01-18-gym-editing', '2026-10-26-gym-editing'),
    ('2027-01-19-shorter-page-titles', '2026-10-27-shorter-page-titles'),
    ('2027-01-20-velodrome-map-alt-text', '2026-10-27-velodrome-map-alt-text'),
    ('2027-01-21-coach-comment-wording', '2026-10-27-coach-comment-wording'),
    ('2027-01-22-public-gear-and-pursuit', '2026-10-27-public-gear-and-pursuit'),
    ('2027-01-23-fitness-forecast', '2026-10-27-fitness-forecast'),
    ('2027-01-24-aluminium-track-surface', '2026-10-27-aluminium-track-surface'),
    ('2027-01-25-velodrome-edits-show-sooner', '2026-10-27-velodrome-edits-show-sooner'),
    ('2027-01-26-more-suggestions-per-hour', '2026-10-27-more-suggestions-per-hour'),
    ('2027-01-27-load-estimate-lt-zones', '2026-10-28-load-estimate-lt-zones'),
    ('2027-01-28-track-page-templates', '2026-10-28-track-page-templates')
),
target AS (
    SELECT s.user_id,
           COALESCE(
               (SELECT substr(MIN(r.new_id), 1, 10) FROM renamed r WHERE r.old_id > s.news_seen_through),
               '2026-10-30-calendar-opens-on-today'
           ) AS marker
    FROM public.user_onboarding_state s
    WHERE s.news_seen_through > '2026-11-03'
)
UPDATE public.user_onboarding_state s
SET news_seen_through = t.marker
FROM target t
WHERE s.user_id = t.user_id;

ALTER TABLE public.user_onboarding_state ENABLE TRIGGER user_onboarding_state_guard;

-- New accounts start at "today" (real date); the old floor of 2026-12-11 would hide upcoming entries.
CREATE OR REPLACE FUNCTION public.onboarding_news_today()
RETURNS TEXT
LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT GREATEST(to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), '2026-10-30') || '~'
$$;
