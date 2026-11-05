-- Velodrome info: post-deploy checks. Paste into the Supabase SQL editor (run as postgres); read-only.

-- 1. Are the migrations applied? Expect: ...135_velodrome_track_info, ...136000000_velodrome_info_apply_helper,
--    8 x strict_NN (2027013601xxxx), 4 x relaxed_NN (2027013602xxxx), 20270136030000_velodrome_penrose_notes.
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version >= '20270135000000'
ORDER BY version;

-- 2. How much data is in? (Before the fix: all zero. Expect roughly 100+ tracks with website/operator.)
SELECT count(*)                                           AS tracks,
       count(*) FILTER (WHERE operator IS NOT NULL)       AS with_operator,
       count(*) FILTER (WHERE website_url IS NOT NULL)    AS with_website_url,
       count(*) FILTER (WHERE pricing_url IS NOT NULL)    AS with_pricing_url,
       count(*) FILTER (WHERE booking_url IS NOT NULL)    AS with_booking_url,
       count(*) FILTER (WHERE opening_hours IS NOT NULL)  AS with_opening_hours,
       count(*) FILTER (WHERE price_min IS NOT NULL)      AS with_price,
       count(*) FILTER (WHERE year_built IS NOT NULL)     AS with_year_built,
       count(*) FILTER (WHERE operating_status <> 'unknown') AS with_status,
       count(*) FILTER (WHERE info_verified_at IS NOT NULL)  AS with_info_verified_at
FROM public.tracks;

-- 3. Lee Valley VeloPark should have website, booking, pricing URL, operator, hours and GBP 12.25-47.20.
SELECT name, operator, website_url, booking_url, pricing_url, opening_hours,
       price_min, price_max, price_currency, info_verified_at
FROM public.tracks
WHERE name ILIKE '%Lee Valley%';

-- 4. Provenance rows written (verified are the public ones).
SELECT status, count(*) FROM public.track_info_sources WHERE is_current GROUP BY status ORDER BY status;

-- 5. Summary of the apply log. Empty = every track matched and every field applied.
--    skipped_no_match / skipped_ambiguous = track not found exactly once; field_rejected = a constraint refused a value;
--    field_conflict = an existing different value was kept; track_error / batch_error = unexpected error (see detail).
SELECT outcome, count(*) FROM public.track_info_apply_log GROUP BY outcome ORDER BY outcome;

-- 6. The skipped / failed items in detail (what to fix, and why).
SELECT created_at, batch, track_name, country_code, field, outcome, detail
FROM public.track_info_apply_log
WHERE outcome IN ('skipped_no_match', 'skipped_ambiguous', 'field_rejected', 'track_error', 'batch_error')
ORDER BY batch, track_name, field;

-- 7. Tracks that matched only through the fallback (renamed in production?).
SELECT batch, track_name, country_code, outcome, detail
FROM public.track_info_apply_log
WHERE outcome IN ('matched_by_name_normalised', 'matched_by_coordinates')
ORDER BY track_name;
