-- Import of v1's "PBs" Google Sheet worksheet (34-row export; 3 rows merged with their
-- predecessor during CSV re-parsing due to an embedded newline in one Notes cell, leaving 31
-- distinct PB records) into public.personal_bests (see 20261007000000_personal_bests.sql).
--
-- Must run after 20261009000000_import_v1_tracks.sql so track_name lookups below can resolve
-- against the fuller tracks catalogue.
--
-- user_id resolution: v1 identified riders by a free-text email (its "UserID" column). We
-- resolve this to a v2 auth.users row by exact email match. Each INSERT is individually guarded
-- with `WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = ...)` so a PB for an email with no
-- matching v2 account is silently skipped (not a migration failure) rather than aborting the
-- whole file - safe to re-run once accounts are created.
--
-- track_id resolution: matched by exact name against public.tracks.name. One alias is special-
-- cased: v1's raw "Praha - Trebesin" track string is the same physical velodrome as the existing
-- seed row "Trebesin Velodrome" (see the Tracks dedup migration), so it was never re-inserted
-- under its sheet name and needs an explicit alias to resolve. Every other v1 Track string in
-- this sheet matches a track name inserted by the Tracks migration verbatim. If a track can't be
-- resolved, track_id is left NULL but track_name still stores the raw v1 string (the schema
-- supports logging a PB for a track outside the catalogue).
--
-- Lap_Times (comma-separated, sometimes inconsistently spaced, e.g. "23.0, 18.0,17.9") is parsed
-- into a numeric[] array; blank -> '{}'. Split_Mode ('Laps'/'Distance'/blank) maps to
-- split_mode ('laps'/'distance'), defaulting to 'laps' when blank per the table's default.
--
-- Dropped (no corresponding column): Gear (free-text, sometimes duplicated in Notes) and
-- RecordID (v1's Google Sheets row key).

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '200m Flying',
    200,
    'TTC not race Duben 2025',
    '2025-04-12',
    12.47,
    57.73857257,
    60,
    15,
    'laps',
    NULL,
    '{}',
    'Gearing si nepamatuju přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '1000m TT',
    1000,
    'TTC not race Duben 2025',
    '2025-04-12',
    77.99,
    46.16,
    60,
    15,
    'laps',
    NULL,
    '{}',
    'Gearing si nepamatuju přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '200m Flying',
    200,
    'TTC Race Duben 2025',
    '2025-04-26',
    12.38,
    58.15831987,
    60,
    15,
    'laps',
    NULL,
    '{}',
    'Gearing si nepamatuju přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '666m TT',
    666,
    'TTC Race Duben 2025',
    '2025-04-26',
    50.99,
    47.02098451,
    60,
    16,
    'laps',
    NULL,
    '{}',
    'Gearing si nepamatuju přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '200m Flying',
    200,
    'TTC Race Červen 2025',
    '2025-06-14',
    12.74,
    56.51491366,
    60,
    16,
    'laps',
    NULL,
    '{}',
    'Gearing si nepamatuju přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '666m TT',
    666,
    'TTC Race Červen 2025',
    '2025-06-14',
    51.08,
    46.93813626,
    60,
    16,
    'laps',
    NULL,
    '{}',
    'Gearing si nepamatuju přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '200m Flying',
    200,
    'MČR Masters 2025',
    '2025-08-23',
    12.141,
    59.30318755,
    60,
    16,
    'laps',
    NULL,
    '{}',
    'Gearing si nepamatuju přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Pruskow - Arena'),
    'Pruskow - Arena',
    '200m Flying',
    200,
    'Soustředění Polsko Srpen 2025',
    '2025-08-09',
    12.44,
    57.8778135,
    60,
    16,
    'laps',
    NULL,
    '{}',
    'Gearing si nepamatuju přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Pruskow - Arena'),
    'Pruskow - Arena',
    '750m TT',
    750,
    'Soustředění Polsko Srpen 2025',
    '2025-08-09',
    58,
    46.55172414,
    60,
    16,
    'laps',
    NULL,
    '{}',
    'Gearing si nepamatuju přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Pruskow - Arena'),
    'Pruskow - Arena',
    '200m Flying',
    200,
    'Soustředění Polsko Září 2025',
    '2025-09-20',
    11.93,
    60.35205365,
    60,
    16,
    'laps',
    NULL,
    '{}',
    'Gearing si nepamatuju přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Pruskow - Arena'),
    'Pruskow - Arena',
    '200m Flying',
    200,
    'Soustředění Polsko Leden 2026',
    '2026-01-23',
    12.3,
    58.53658537,
    60,
    16,
    'laps',
    NULL,
    '{}',
    'Gearing si nepamatuju přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Roubaix - Stab Vélodrome'),
    'Roubaix - Stab Vélodrome',
    '750m TT',
    750,
    'World Masters Championship 2025',
    '2025-10-04',
    52.818,
    51.12,
    60,
    16,
    'laps',
    250,
    ARRAY[22.106,15.232,15.480]::numeric[],
    'Gearing si nepamatuju přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Roubaix - Stab Vélodrome'),
    'Roubaix - Stab Vélodrome',
    '3000m Individual Pursuit',
    3000,
    'World Masters Championship 2025',
    '2025-10-05',
    226.567,
    47.67,
    60,
    16,
    'distance',
    1000,
    ARRAY[74.275,73.809,78.483]::numeric[],
    'Gearing si nepamatuju přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '3000m Individual Pursuit',
    3000,
    'Base 3km 2025',
    '2025-07-01',
    225,
    48,
    52,
    14,
    'laps',
    NULL,
    '{}',
    'Převody nevím a nebyl to úplný pevný start, protože mě neměl kdo držet. Měření taky není přesně, ale byla to moje base line'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Roubaix - Stab Vélodrome'),
    'Roubaix - Stab Vélodrome',
    '4000m Team Pursuit',
    4000,
    'MS Masters 2025',
    '2025-10-09',
    291.01,
    49.48,
    58,
    17,
    'distance',
    1000,
    ARRAY[75.229,70.307,70.970,74.503]::numeric[],
    'Gearing je přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Roubaix - Stab Vélodrome'),
    'Roubaix - Stab Vélodrome',
    '750m Team Sprint',
    750,
    'MS Masters 2025',
    '2025-10-08',
    50.596,
    53.36,
    58,
    16,
    'laps',
    250,
    ARRAY[22.192,15.580,15.590]::numeric[],
    'Gearing si nepamatuju - sestava Šipčiak, Čermák, Kolář'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Pruskow - Arena'),
    'Pruskow - Arena',
    '3000m Individual Pursuit',
    3000,
    'Soustředění Polsko, Leden 2026',
    '2026-01-24',
    232,
    46.55,
    58,
    17,
    'laps',
    250,
    ARRAY[19.2,19.1,19.3,19.4,19.7,19.6,19.4,19.6,19.2,19.4,19.3,18.8]::numeric[],
    'Gearing přesně, rozjeto na negative split. Zase tak moc se to nepovedlo, ale na konci jsem zrychlil'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

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
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'jedkornbluh@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '200m Flying',
    200,
    'Ttc duben 2026',
    '2026-04-18',
    12.45,
    57.83,
    58,
    16,
    'laps',
    333.3,
    '{}',
    'Krásný počasí, Gearing přesně. Podle Kellyše to chtělo těžší převod - 60x16 bych příště zkusil'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '666m TT',
    666,
    'Ttc duben 2026',
    '2026-04-18',
    50.23,
    47.73,
    58,
    16,
    'laps',
    333.3,
    '{}',
    'Krásný počasí, Gearing přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Brno - Favorit'),
    'Brno - Favorit',
    '200m Flying',
    200,
    'ADL jaro 2026',
    '2026-04-25',
    12.5,
    57.6,
    58,
    15,
    'laps',
    400,
    '{}',
    'Krásný počasí trošku vitr. Gearing přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Brno - Favorit'),
    'Brno - Favorit',
    '800m TT',
    800,
    'ADL jaro 2026',
    '2026-04-25',
    59.8,
    48.16,
    58,
    16,
    'laps',
    400,
    '{}',
    'Krásný počasí, trochu vitr, gearing přesně'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

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
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'vojta.david@seznam.cz');

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
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'vojta.david@seznam.cz');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '3000m Individual Pursuit',
    3000,
    'Trenink jaro 2026',
    '2026-05-21',
    246,
    43.9,
    59,
    18,
    'laps',
    333.3,
    '{}',
    'Zkouška
- Pevný start z bloku
- Gearing lehký, ale takhle byla kadence optimální = postupně přikládat
- Aero ponožky, silniční kombinéza, POC Tempor helma
- Lehačky asi ještě trošku zkrátíme'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

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
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'vojta.david@seznam.cz');

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
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'vojta.david@seznam.cz');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Pruskow - Arena'),
    'Pruskow - Arena',
    '3000m Individual Pursuit',
    3000,
    'Soustředění červen 2026 #1',
    '2026-06-20',
    220.01,
    49.09,
    57,
    15,
    'laps',
    250,
    ARRAY[23.0,18.0,17.9,17.8,18.0,18.3,18.3,18.5,19.2,19.1,18.8,18.2]::numeric[],
    'Gearing přesně, nácvik rozjet to pod 19vetřin na kolo a pak zrychlovat. Nepodařilo se to úplně, ale je tam progress, takže spokojenost. To líznuté 19s primárně kvůli tomu, že jsem nevěděl kolik kol do konce zbývá a tak jsem to raději zpomalil.'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

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
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'vojta.david@seznam.cz');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Třebešín Velodrome'),
    'Praha - Třebešín',
    '3000m Individual Pursuit',
    3000,
    'Trenink - zavodni pokus',
    '2026-07-28',
    237,
    45.57,
    58,
    16,
    'laps',
    333.3,
    '{}',
    'decentně foukalo na cílovce. Gearing přesně, nezávodní kola, bez návleků na nohy.'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');

INSERT INTO public.personal_bests (user_id, track_id, track_name, discipline, discipline_distance_m, event_name, achieved_date, time_seconds, avg_speed_kmh, chainring, cog, split_mode, split_distance_m, lap_times, notes)
SELECT
    (SELECT id FROM auth.users WHERE email = 'koli440@gmail.com'),
    (SELECT id FROM public.tracks WHERE name = 'Sangalhos - Velódromo Nacional'),
    'Sangalhos - Velódromo Nacional',
    '3000m Individual Pursuit',
    3000,
    'Soustředění 08/2026',
    '2026-08-28',
    228,
    47.37,
    62,
    16,
    'laps',
    250,
    ARRAY[25.96,18.53,17.56,17.71,18.23,18.53,19.01,19.2,19.72,19.5,18.95,19.06]::numeric[],
    'Gearing přesně, únava celkem velká, chtěl jsem to na těch 18 vteřinách zastabilizovat a pak zrychlit, ale už to bylo mimo. Na další pokus dávám 60x16'
WHERE EXISTS (SELECT 1 FROM auth.users WHERE email = 'koli440@gmail.com');
