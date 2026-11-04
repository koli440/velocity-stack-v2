-- Issue #379: provenance of FTP / lactate threshold history entries applied from a threshold-test
-- template estimate. "Applied by" is the existing trigger-stamped changed_by / set_by_coach; these
-- columns add the source (template estimate) and the activity / run it came from. Write access is
-- unchanged: the rider, or the ACTIVE coach (is_coach_of) through the existing RLS policies.

ALTER TABLE public.ftp_history
    ADD COLUMN IF NOT EXISTS source TEXT,
    ADD COLUMN IF NOT EXISTS source_activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_run_id UUID REFERENCES public.template_executions(id) ON DELETE SET NULL;
ALTER TABLE public.lactate_threshold_history
    ADD COLUMN IF NOT EXISTS source TEXT,
    ADD COLUMN IF NOT EXISTS source_activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_run_id UUID REFERENCES public.template_executions(id) ON DELETE SET NULL;

ALTER TABLE public.ftp_history DROP CONSTRAINT IF EXISTS ftp_history_source_check;
ALTER TABLE public.ftp_history
    ADD CONSTRAINT ftp_history_source_check CHECK (source IS NULL OR source = 'template_estimate');
ALTER TABLE public.lactate_threshold_history DROP CONSTRAINT IF EXISTS lt_history_source_check;
ALTER TABLE public.lactate_threshold_history
    ADD CONSTRAINT lt_history_source_check CHECK (source IS NULL OR source = 'template_estimate');

-- The source must point at the rider's own activity / run, so it cannot be forged to reference
-- someone else's data. Without a source the reference columns are cleared.
CREATE OR REPLACE FUNCTION public.validate_history_source()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.source IS NULL THEN
        NEW.source_activity_id := NULL;
        NEW.source_run_id := NULL;
        RETURN NEW;
    END IF;
    IF NEW.source_activity_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.activities a WHERE a.id = NEW.source_activity_id AND a.user_id = NEW.user_id
    ) THEN
        RAISE EXCEPTION 'Source activity does not belong to this rider';
    END IF;
    IF NEW.source_run_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.template_executions e
        WHERE e.id = NEW.source_run_id AND e.activity_id = NEW.source_activity_id
    ) THEN
        RAISE EXCEPTION 'Source run does not belong to the source activity';
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['ftp_history', 'lactate_threshold_history'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_source ON public.%I', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_source BEFORE INSERT OR UPDATE ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION public.validate_history_source()', t, t);
    END LOOP;
END $$;
