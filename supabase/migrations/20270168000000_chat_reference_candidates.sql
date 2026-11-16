-- Chat references: items the sender may mention in a message (the rider's own recent activities and planned
-- workouts). Read-only helper; sending a reference only fills chat_messages.activity_id / planned_workout_id
-- and never touches planned_workouts / activities (no linking, no completion).
CREATE OR REPLACE FUNCTION public.chat_reference_candidates(p_thread UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_rider UUID;
BEGIN
    IF public.chat_thread_access(p_thread) IS DISTINCT FROM 'rw' THEN RETURN NULL; END IF;
    SELECT rider_id INTO v_rider FROM public.coaching_relationships WHERE id = p_thread;
    RETURN jsonb_build_object(
        'activities', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'date', a.activity_date) ORDER BY a.activity_date DESC, a.created_at DESC)
                                FROM (SELECT * FROM public.activities WHERE user_id = v_rider ORDER BY activity_date DESC, created_at DESC LIMIT 20) a), '[]'::JSONB),
        'workouts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'date', w.workout_date) ORDER BY w.workout_date DESC)
                              FROM (SELECT * FROM public.planned_workouts WHERE rider_id = v_rider ORDER BY workout_date DESC LIMIT 20) w), '[]'::JSONB));
END $$;

NOTIFY pgrst, 'reload schema';
