-- Remove the legacy Activity Wizard feature's columns from activities.
-- The wizard (sport/discipline classification + manual effort segmentation)
-- has been superseded by the Phase 2 declarative evaluation templates
-- (see 20260925000000_activity_analyzer.sql / 20260926000000_fix_template_visibility.sql).

alter table public.activities
  drop column if exists sport_type,
  drop column if exists discipline,
  drop column if exists detected_efforts,
  drop column if exists wizard_completed;
