-- VelocityStack: activity photo gallery (issue #49)
--
-- Private bucket; clients read via short-lived signed URLs. Photos are visible to
-- whoever can see the parent activity (own / followers / public, enforced by the
-- activities RLS policies), and only the owner can upload or delete.

CREATE TABLE IF NOT EXISTS public.activity_photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL UNIQUE,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_photos_activity
    ON public.activity_photos(activity_id, position, created_at);

ALTER TABLE public.activity_photos ENABLE ROW LEVEL SECURITY;

-- The subselect is filtered by the activities RLS of the caller.
DROP POLICY IF EXISTS "activity_photos_select_visible" ON public.activity_photos;
CREATE POLICY "activity_photos_select_visible"
    ON public.activity_photos FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_photos.activity_id));

DROP POLICY IF EXISTS "activity_photos_insert_own" ON public.activity_photos;
CREATE POLICY "activity_photos_insert_own"
    ON public.activity_photos FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.activities a
            WHERE a.id = activity_photos.activity_id AND a.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "activity_photos_update_own" ON public.activity_photos;
CREATE POLICY "activity_photos_update_own"
    ON public.activity_photos FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "activity_photos_delete_own" ON public.activity_photos;
CREATE POLICY "activity_photos_delete_own"
    ON public.activity_photos FOR DELETE
    USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_photos TO authenticated;

-- Private bucket, 8 MB per photo, images only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'activity-photos', 'activity-photos', FALSE, 8388608,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Owners manage files under their own user_id/ prefix.
DROP POLICY IF EXISTS "Users manage own activity photos" ON storage.objects;
CREATE POLICY "Users manage own activity photos"
    ON storage.objects FOR ALL
    USING (bucket_id = 'activity-photos' AND auth.uid()::text = (storage.foldername(name))[1])
    WITH CHECK (bucket_id = 'activity-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Anyone who can see the parent activity can read (sign URLs for) its photos.
DROP POLICY IF EXISTS "Shared activity photos readable" ON storage.objects;
CREATE POLICY "Shared activity photos readable"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'activity-photos'
        AND EXISTS (SELECT 1 FROM public.activity_photos p WHERE p.storage_path = objects.name)
    );
