-- Ensure a given template can only be run once per activity (re-running
-- replaces the previous result instead of accumulating duplicates). Multiple
-- *different* templates may still be applied to the same activity.
--
-- First, deduplicate any pre-existing rows that would violate the new
-- constraint by keeping only the most recent execution per
-- (activity_id, template_id) pair (ties broken by id for determinism).
DELETE FROM public.template_executions
WHERE id IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY activity_id, template_id
            ORDER BY created_at DESC, id DESC
        ) AS rn
        FROM public.template_executions
    ) ranked
    WHERE ranked.rn > 1
);

ALTER TABLE public.template_executions
    ADD CONSTRAINT template_executions_activity_template_unique
    UNIQUE (activity_id, template_id);

-- Track when a (activity, template) execution was last (re-)run, so the UI
-- can still show the most recently run template first even though re-runs
-- now update the existing row in place rather than inserting a new one.
ALTER TABLE public.template_executions
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
