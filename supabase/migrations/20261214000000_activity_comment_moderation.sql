-- VelocityStack: activity comment moderation, limits and privacy hardening (issue #226)
--
-- * Blocks: comments of a rider are invisible to the other side of a block (either direction),
--   also in counts, mentions and notifications are already block-aware.
-- * Bodies are stored as plain text: control and bidi-override characters are stripped.
-- * Reports: any rider who can see a comment may report it (not their own, once per comment);
--   admins review them and may delete the comment. Reports keep a snapshot of the text.
-- * Writes to reports only through SECURITY DEFINER RPCs; clients have no table privileges.

-- 1. Blocks hide the other side's comments --------------------------------------------------
DROP POLICY IF EXISTS "activity_comments_select" ON public.activity_comments;
CREATE POLICY "activity_comments_select" ON public.activity_comments
    FOR SELECT TO authenticated
    USING (
        public.can_view_activity_comments(activity_id)
        AND (user_id = auth.uid() OR NOT public.is_blocked_between(auth.uid(), user_id))
    );

DROP POLICY IF EXISTS "activity_comment_mentions_select" ON public.activity_comment_mentions;
CREATE POLICY "activity_comment_mentions_select" ON public.activity_comment_mentions
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.activity_comments c
        WHERE c.id = comment_id
          AND public.can_view_activity_comments(c.activity_id)
          AND (c.user_id = auth.uid() OR NOT public.is_blocked_between(auth.uid(), c.user_id))));

CREATE OR REPLACE FUNCTION public.activity_comment_info(p_ids UUID[])
RETURNS TABLE (
    activity_id UUID,
    owner_id UUID,
    comments_enabled BOOLEAN,
    comment_count INTEGER,
    coach_id UUID,
    viewer_is_coach BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT a.id,
           a.user_id,
           a.comments_enabled,
           (SELECT count(*)::int FROM public.activity_comments c
             WHERE c.activity_id = a.id
               AND (c.user_id = auth.uid() OR NOT public.is_blocked_between(auth.uid(), c.user_id))),
           (SELECT r.coach_id FROM public.coaching_relationships r
             WHERE r.rider_id = a.user_id AND r.status = 'active' LIMIT 1),
           public.is_coach_of(a.user_id)
    FROM public.activities a
    WHERE a.id = ANY (p_ids[1:100])
      AND public.user_can_view_activity(auth.uid(), a.id)
$$;

-- 2. Plain text only ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clean_comment_body()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    -- keep tab (09), line feed (0A); drop other C0/C1 controls, DEL and bidi overrides
    NEW.body := btrim(regexp_replace(
        replace(NEW.body, E'\r', ''),
        E'[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
        '', 'g'));
    IF char_length(NEW.body) NOT BETWEEN 1 AND 2000 THEN
        RAISE EXCEPTION 'A comment must be 1-2000 characters';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clean_comment_body ON public.activity_comments;
CREATE TRIGGER trg_clean_comment_body
    BEFORE INSERT OR UPDATE OF body ON public.activity_comments
    FOR EACH ROW EXECUTE FUNCTION public.clean_comment_body();

-- 3. Reports --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comment_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID REFERENCES public.activity_comments(id) ON DELETE SET NULL,
    activity_id UUID NOT NULL,
    comment_author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    body_snapshot TEXT NOT NULL,
    reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 500),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'removed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_comment_reports_once
    ON public.comment_reports (comment_id, reporter_id) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comment_reports_status ON public.comment_reports (status, created_at DESC);

ALTER TABLE public.comment_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comment_reports FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.report_activity_comment(p_comment UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := auth.uid();
    c public.activity_comments;
    v_reason TEXT := NULLIF(btrim(left(COALESCE(p_reason, ''), 500)), '');
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    SELECT * INTO c FROM public.activity_comments WHERE id = p_comment;
    IF NOT FOUND
       OR NOT public.user_can_view_activity(v_me, c.activity_id)
       OR (c.user_id <> v_me AND public.is_blocked_between(v_me, c.user_id)) THEN
        RAISE EXCEPTION 'Comment not found';
    END IF;
    IF c.user_id = v_me THEN
        RAISE EXCEPTION 'You cannot report your own comment';
    END IF;
    IF (SELECT count(*) FROM public.comment_reports
        WHERE reporter_id = v_me AND created_at > NOW() - INTERVAL '1 hour') >= 20 THEN
        RAISE EXCEPTION 'Report limit reached, try again later';
    END IF;
    INSERT INTO public.comment_reports (comment_id, activity_id, comment_author_id, reporter_id, body_snapshot, reason)
        VALUES (c.id, c.activity_id, c.user_id, v_me, c.body, v_reason)
        ON CONFLICT (comment_id, reporter_id) WHERE comment_id IS NOT NULL DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_comment_reports()
RETURNS TABLE (
    id UUID, status TEXT, created_at TIMESTAMPTZ, reason TEXT, body_snapshot TEXT,
    comment_id UUID, comment_exists BOOLEAN, activity_id UUID,
    author_id UUID, author_name TEXT, reporter_id UUID, reporter_name TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admins only';
    END IF;
    RETURN QUERY
    SELECT r.id, r.status, r.created_at, r.reason, r.body_snapshot,
           r.comment_id, EXISTS (SELECT 1 FROM public.activity_comments c WHERE c.id = r.comment_id),
           r.activity_id, r.comment_author_id,
           public.profile_display_name(a.nickname, a.first_name, a.last_name),
           r.reporter_id,
           public.profile_display_name(b.nickname, b.first_name, b.last_name)
    FROM public.comment_reports r
    LEFT JOIN public.profiles a ON a.id = r.comment_author_id
    LEFT JOIN public.profiles b ON b.id = r.reporter_id
    ORDER BY (r.status = 'open') DESC, r.created_at DESC
    LIMIT 200;
END;
$$;

-- Admin decision: dismiss the report, or remove the reported comment (all reports of that
-- comment are closed together).
CREATE OR REPLACE FUNCTION public.admin_resolve_comment_report(p_report UUID, p_remove BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    r public.comment_reports;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admins only';
    END IF;
    SELECT * INTO r FROM public.comment_reports WHERE id = p_report FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Report not found';
    END IF;
    IF p_remove AND r.comment_id IS NOT NULL THEN
        UPDATE public.comment_reports
            SET status = 'removed', resolved_by = auth.uid(), resolved_at = NOW()
            WHERE comment_id = r.comment_id AND status = 'open';
        DELETE FROM public.activity_comments WHERE id = r.comment_id;
    END IF;
    UPDATE public.comment_reports
        SET status = CASE WHEN p_remove THEN 'removed' ELSE 'dismissed' END,
            resolved_by = auth.uid(), resolved_at = NOW()
        WHERE id = p_report AND status = 'open';
END;
$$;

REVOKE ALL ON FUNCTION public.report_activity_comment(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_comment_reports() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_resolve_comment_report(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_activity_comment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_comment_reports() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_comment_report(UUID, BOOLEAN) TO authenticated;
