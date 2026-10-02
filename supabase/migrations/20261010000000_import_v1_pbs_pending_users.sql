-- Follow-up import of the 6 v1 "PBs" Google Sheet rows that were skipped by
-- 20261009010000_import_v1_personal_bests.sql because jedkornbluh@gmail.com and
-- vojta.david@seznam.cz had no matching v2 account/profile at that time.
--
-- Run this only after those 2 riders have been invited and have a profiles row
-- (see scripts/invite-v1-users.mjs - not checked in, run locally with the service role key).
-- Each INSERT is still individually guarded with the same
-- `auth.users JOIN public.profiles` WHERE EXISTS pattern, so it's safe to run this migration
-- before the invites land too - unmatched rows are silently skipped and can be retried later.

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'jedkornbluh@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Mattamy National Cycling Centre (Milton)'),
    'Mattamy National Cycling Centre (Milton)',
    '200m Flying',
    200,
    NULL,
    '2026-01-17',
    12.834,
    56.1,
    52,
    14,
    'laps',
    250,
    '{}',
    'Didn''t have a good wind-up.'
WHERE EXISTS (
    SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id = u.id
    WHERE u.email = 'jedkornbluh@gmail.com'
);

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'vojta.david@seznam.cz'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '200m Flying',
    200,
    'TTC',
    '2026-04-18',
    12.53,
    57.46,
    52,
    13,
    'laps',
    333.3,
    '{}',
    NULL
WHERE EXISTS (
    SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id = u.id
    WHERE u.email = 'vojta.david@seznam.cz'
);

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'vojta.david@seznam.cz'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '666m TT',
    666,
    'TTC',
    '2026-04-18',
    51.5,
    46.56,
    52,
    14,
    'laps',
    333.3,
    '{}',
    NULL
WHERE EXISTS (
    SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id = u.id
    WHERE u.email = 'vojta.david@seznam.cz'
);

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'vojta.david@seznam.cz'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '1000m TT',
    1000,
    'training, flying',
    '2026-06-02',
    74.73,
    48.17,
    52,
    15,
    'laps',
    333.3,
    ARRAY[24.98,24.26,25.48]::numeric[],
    NULL
WHERE EXISTS (
    SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id = u.id
    WHERE u.email = 'vojta.david@seznam.cz'
);

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'vojta.david@seznam.cz'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '2000m Individual Pursuit',
    2000,
    'training, flying',
    '2026-06-02',
    153.79,
    46.82,
    52,
    15,
    'laps',
    333.3,
    ARRAY[25.99,25.65,25.29,25.2,25.09,26.54]::numeric[],
    NULL
WHERE EXISTS (
    SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id = u.id
    WHERE u.email = 'vojta.david@seznam.cz'
);

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'vojta.david@seznam.cz'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '3000m Individual Pursuit',
    3000,
    'úterní trénink',
    '2026-07-28',
    235,
    45.96,
    52,
    14,
    'laps',
    333.3,
    '{}',
    'vítr 2,5mps'
WHERE EXISTS (
    SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id = u.id
    WHERE u.email = 'vojta.david@seznam.cz'
);
