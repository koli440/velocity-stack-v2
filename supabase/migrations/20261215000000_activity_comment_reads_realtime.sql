-- VelocityStack: realtime + unread indicators for activity comments (issue #225)
--
-- * activity_comments is added to the supabase_realtime publication (RLS still applies).
-- * activity_comment_reads: per-user read marker per activity.
-- * mark_activity_comments_read(activity), activity_comment_unread(ids) and
--   coach_unread_comments() RPCs. Unread = comments by others the viewer can see that are
--   newer than the marker (no marker = everything by others is unread).

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'activity_comments'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_comments;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.activity_comment_reads (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, activity_id)
);
ALTER TABLE public.activity_comment_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_comment_reads_select" ON public.activity_comment_reads;
CREATE POLICY "activity_comment_reads_select" ON public.activity_comment_reads
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.mark_activity_comments_read(p_activity UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.user_can_view_activity(auth.uid(), p_activity) THEN
        RETURN;
    END IF;
    INSERT INTO public.activity_comment_reads (user_id, activity_id, last_read_at)
    VALUES (auth.uid(), p_activity, NOW())
    ON CONFLICT (user_id, activity_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.activity_comment_unread(p_ids UUID[])
RETURNS TABLE (activity_id UUID, unread_count INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT c.activity_id, count(*)::int
    FROM public.activity_comments c
    LEFT JOIN public.activity_comment_reads r
           ON r.activity_id = c.activity_id AND r.user_id = auth.uid()
    WHERE c.activity_id = ANY (p_ids[1:100])
      AND auth.uid() IS NOT NULL
      AND c.user_id <> auth.uid()
      AND (r.last_read_at IS NULL OR c.created_at > r.last_read_at)
      AND public.user_can_view_activity(auth.uid(), c.activity_id)
    GROUP BY c.activity_id
$$;

-- Unread comments per actively coached athlete (own activities only are not special-cased:
-- anything the coach can see on the athlete's activities counts).
CREATE OR REPLACE FUNCTION public.coach_unread_comments()
RETURNS TABLE (rider_id UUID, unread_count INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT a.user_id, count(*)::int
    FROM public.coaching_relationships rel
    JOIN public.activities a ON a.user_id = rel.rider_id
    JOIN public.activity_comments c ON c.activity_id = a.id
    LEFT JOIN public.activity_comment_reads r
           ON r.activity_id = a.id AND r.user_id = auth.uid()
    WHERE rel.coach_id = auth.uid()
      AND rel.status = 'active'
      AND auth.uid() IS NOT NULL
      AND c.user_id <> auth.uid()
      AND (r.last_read_at IS NULL OR c.created_at > r.last_read_at)
      AND public.user_can_view_activity(auth.uid(), a.id)
    GROUP BY a.user_id
$$;

REVOKE ALL ON FUNCTION public.mark_activity_comments_read(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.activity_comment_unread(UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coach_unread_comments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_activity_comments_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activity_comment_unread(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coach_unread_comments() TO authenticated;
