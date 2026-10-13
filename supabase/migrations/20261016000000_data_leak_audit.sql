-- Issue #49 data-leak audit: lock down raw .fit files (contain GPS), activity_curves and tracks.

-- 1. raw-activity-files: private bucket, owner-only access, one explicit policy per operation.
INSERT INTO storage.buckets (id, name, public)
VALUES ('raw-activity-files', 'raw-activity-files', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

UPDATE storage.buckets SET public = FALSE WHERE id IN ('raw-activity-files', 'activity-photos');

-- Remove any other policy (e.g. created by hand in the dashboard) that references the bucket.
DO $$
DECLARE pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND (COALESCE(qual, '') ILIKE '%raw-activity-files%' OR COALESCE(with_check, '') ILIKE '%raw-activity-files%')
    LOOP
        EXECUTE format('DROP POLICY %I ON storage.objects', pol.policyname);
    END LOOP;
END$$;

CREATE POLICY "raw_files_select_own" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'raw-activity-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "raw_files_insert_own" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'raw-activity-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "raw_files_update_own" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'raw-activity-files' AND auth.uid()::text = (storage.foldername(name))[1])
    WITH CHECK (bucket_id = 'raw-activity-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "raw_files_delete_own" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'raw-activity-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- New activities may only point at a file inside the owner's own folder (existing rows not re-checked).
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_raw_file_owner_folder;
ALTER TABLE public.activities ADD CONSTRAINT activities_raw_file_owner_folder
    CHECK (raw_file_url IS NULL OR raw_file_url LIKE user_id::text || '/%') NOT VALID;

-- 2. activity_curves had no RLS: owner-only through the parent activity.
ALTER TABLE public.activity_curves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_curves FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_curves TO authenticated;

DROP POLICY IF EXISTS "activity_curves_select_own" ON public.activity_curves;
CREATE POLICY "activity_curves_select_own" ON public.activity_curves FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_id AND a.user_id = auth.uid()));
DROP POLICY IF EXISTS "activity_curves_insert_own" ON public.activity_curves;
CREATE POLICY "activity_curves_insert_own" ON public.activity_curves FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_id AND a.user_id = auth.uid()));
DROP POLICY IF EXISTS "activity_curves_update_own" ON public.activity_curves;
CREATE POLICY "activity_curves_update_own" ON public.activity_curves FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_id AND a.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_id AND a.user_id = auth.uid()));
DROP POLICY IF EXISTS "activity_curves_delete_own" ON public.activity_curves;
CREATE POLICY "activity_curves_delete_own" ON public.activity_curves FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_id AND a.user_id = auth.uid()));

-- 3. tracks is shared reference data (velodromes): readable by everyone, writable by nobody via the API.
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.tracks FROM anon, authenticated;
GRANT SELECT ON public.tracks TO anon, authenticated;
DROP POLICY IF EXISTS "tracks_read_all" ON public.tracks;
CREATE POLICY "tracks_read_all" ON public.tracks FOR SELECT TO anon, authenticated USING (TRUE);
