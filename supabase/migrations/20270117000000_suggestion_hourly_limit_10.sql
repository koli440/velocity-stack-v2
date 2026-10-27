-- Raise the per-user suggestion rate limit from 5 to 10 per rolling hour.
CREATE OR REPLACE FUNCTION public.validate_suggestion()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_allowed TEXT[];
    v_bad TEXT;
BEGIN
    SELECT allowed_columns INTO v_allowed FROM public.suggestion_targets WHERE entity_type = NEW.entity_type;
    IF v_allowed IS NULL THEN
        RAISE EXCEPTION 'Unknown suggestion type %', NEW.entity_type;
    END IF;

    SELECT k INTO v_bad FROM jsonb_object_keys(NEW.payload) AS k WHERE k <> ALL (v_allowed) LIMIT 1;
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Field "%" cannot be suggested', v_bad;
    END IF;
    IF NEW.payload = '{}'::jsonb THEN
        RAISE EXCEPTION 'Suggestion is empty';
    END IF;

    IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
        IF (SELECT COUNT(*) FROM public.suggestions
            WHERE submitter_id = NEW.submitter_id AND created_at > NOW() - INTERVAL '1 hour') >= 10 THEN
            RAISE EXCEPTION 'Too many suggestions, please try again later';
        END IF;
        IF (SELECT COUNT(*) FROM public.suggestions
            WHERE submitter_id = NEW.submitter_id AND status = 'pending') >= 20 THEN
            RAISE EXCEPTION 'Too many pending suggestions';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
