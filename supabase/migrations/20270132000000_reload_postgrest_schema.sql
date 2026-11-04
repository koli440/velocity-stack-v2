-- Harmless no-op: asks PostgREST to reload its schema cache so the partner tables
-- (developer_apps, oauth_*, partner_*) are visible to the API right after they are created.
-- The partner migrations were renumbered (20270129-31) because their versions collided with other
-- migrations (duplicate versions cannot be applied by Supabase); they had never been applied.
NOTIFY pgrst, 'reload schema';
