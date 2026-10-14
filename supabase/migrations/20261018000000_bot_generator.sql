-- VelocityStack: database-side synthetic bot riders (issue #80)
--
-- Bots live entirely in the database so they need no external credentials:
--   * bot_personas: persona configuration (gear, power, weekly pattern, fitness trend)
--   * auth users + profiles (is_bot) for every persona, created idempotently here
--   * bots_generate_ride(): seeded, 1 Hz ride simulation -> activities (+ curves, PB, route preview)
--   * bots_run_day(): daily job (pg_cron) that generates yesterday's rides (with 2 days catch-up)
--   * trg_bot_follow_back: a bot follows back every real rider who follows it (blocks respected)
--   * bots_reset(): wipe bot data and regenerate history
-- Output is deterministic per (bot, date); re-running a day never duplicates a ride.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- 1. Personas ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bot_personas (
    key TEXT PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    nickname TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    track_name TEXT NOT NULL,
    chainring INTEGER NOT NULL,
    cog INTEGER NOT NULL,
    ftp_w INTEGER NOT NULL,
    peak_power_w INTEGER NOT NULL,
    cadence_cap INTEGER NOT NULL,
    cda_mod DOUBLE PRECISION NOT NULL DEFAULT 1,
    -- fractional fitness change per week since 2026-01-01 (capped at +-15%)
    weekly_gain DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- probability of riding for Sun..Sat
    weekly DOUBLE PRECISION[] NOT NULL,
    start_hour INTEGER NOT NULL,
    session_weights JSONB NOT NULL
);

-- Internal table: RLS on and no policies, so API roles cannot read it.
ALTER TABLE public.bot_personas ENABLE ROW LEVEL SECURITY;

INSERT INTO public.bot_personas
    (key, user_id, email, nickname, first_name, last_name, track_name, chainring, cog, ftp_w,
     peak_power_w, cadence_cap, cda_mod, weekly_gain, weekly, start_hour, session_weights)
SELECT v.key, md5('velocity-stack-bot:' || v.key)::uuid, 'bot-' || v.key || '@bots.velocity-stack.invalid',
       v.nickname, v.first_name, v.last_name, 'Mattamy National Cycling Centre (Milton)',
       v.chainring, v.cog, v.ftp_w, v.peak_power_w, v.cadence_cap, v.cda_mod, v.weekly_gain,
       v.weekly, v.start_hour, v.session_weights
FROM (VALUES
    ('sprinter',  'Sven Sprint',   'Sven',  'Sprint (bot)',    54, 14, 300, 1000, 150, 1.05, 0.002,  ARRAY[0.1,0.7,0.2,0.7,0.2,0.6,0.3]::float8[], 17, '{"flying":6,"pack":2,"endurance":1}'::jsonb),
    ('endurance', 'Edda Endurance','Edda',  'Endurance (bot)', 50, 15, 260,  600, 125, 1.0,  0.001,  ARRAY[0.6,0.5,0.7,0.2,0.7,0.3,0.8]::float8[],  7, '{"endurance":7,"pack":2,"flying":1}'::jsonb),
    ('beginner',  'Ben Beginner',  'Ben',   'Beginner (bot)',  48, 15, 170,  550, 115, 1.2,  0.006,  ARRAY[0.2,0.3,0.5,0.2,0.5,0.2,0.5]::float8[], 18, '{"pack":5,"endurance":3,"flying":2}'::jsonb),
    ('pursuiter', 'Petra Pursuit', 'Petra', 'Pursuit (bot)',   56, 15, 320,  800, 130, 0.9,  0.002,  ARRAY[0.1,0.6,0.6,0.3,0.6,0.4,0.4]::float8[],  6, '{"endurance":4,"pack":2,"flying":3}'::jsonb),
    ('keirin',    'Kai Keirin',    'Kai',   'Keirin (bot)',    52, 14, 280,  900, 145, 1.0,  0.003,  ARRAY[0.2,0.5,0.5,0.5,0.2,0.7,0.4]::float8[], 19, '{"pack":6,"flying":3,"endurance":1}'::jsonb),
    ('masters',   'Mona Masters',  'Mona',  'Masters (bot)',   48, 16, 200,  600, 115, 1.1, -0.0005, ARRAY[0.4,0.2,0.6,0.1,0.6,0.1,0.5]::float8[],  9, '{"endurance":5,"pack":4,"flying":1}'::jsonb)
) AS v(key, nickname, first_name, last_name, chainring, cog, ftp_w, peak_power_w, cadence_cap, cda_mod, weekly_gain, weekly, start_hour, session_weights)
ON CONFLICT (key) DO NOTHING;

-- 2. Accounts ------------------------------------------------------------------------------
-- The password hash is not a valid hash, so these accounts can never be logged into.
INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
     confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', p.user_id, 'authenticated', 'authenticated', p.email,
       md5(random()::text || p.key), NOW(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, NOW(), NOW(),
       '', '', '', ''
FROM public.bot_personas p
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles
    (id, first_name, last_name, nickname, home_track_id, default_chainring, default_cog, ftp_w,
     is_bot, bot_persona, require_follow_approval)
SELECT p.user_id, p.first_name, p.last_name, p.nickname,
       (SELECT t.id FROM public.tracks t WHERE t.name = p.track_name LIMIT 1),
       p.chainring, p.cog, p.ftp_w, TRUE, p.key, FALSE
FROM public.bot_personas p
ON CONFLICT (id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    nickname = EXCLUDED.nickname,
    home_track_id = EXCLUDED.home_track_id,
    default_chainring = EXCLUDED.default_chainring,
    default_cog = EXCLUDED.default_cog,
    ftp_w = EXCLUDED.ftp_w,
    is_bot = TRUE,
    bot_persona = EXCLUDED.bot_persona,
    require_follow_approval = FALSE;

-- 3. Simulation helpers --------------------------------------------------------------------
DO $$
BEGIN
    CREATE TYPE public.bot_seg AS (sec INTEGER, power DOUBLE PRECISION, draft DOUBLE PRECISION, lbl TEXT);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Deterministic seed in [-1, 1) for setseed()
CREATE OR REPLACE FUNCTION public.bots_seed(p_key TEXT)
RETURNS DOUBLE PRECISION LANGUAGE sql IMMUTABLE AS $$
    SELECT (('x' || substr(md5(p_key), 1, 7))::bit(28)::int)::float8 / 134217728.0 - 1.0
$$;

CREATE OR REPLACE FUNCTION public.bots_normal(p_mean DOUBLE PRECISION, p_sd DOUBLE PRECISION)
RETURNS DOUBLE PRECISION LANGUAGE sql VOLATILE AS $$
    SELECT p_mean + p_sd * sqrt(-2 * ln(greatest(random(), 1e-12))) * cos(2 * pi() * random())
$$;

-- Steady-state speed (m/s) for a power: P = k*v^3 + crr*m*g*v (drafting scales k)
CREATE OR REPLACE FUNCTION public.bots_speed(p_power DOUBLE PRECISION, p_cda_mod DOUBLE PRECISION, p_draft DOUBLE PRECISION)
RETURNS DOUBLE PRECISION LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    k DOUBLE PRECISION := 0.5 * 1.2 * 0.22 * p_cda_mod * p_draft;
    roll DOUBLE PRECISION := 0.003 * 85 * 9.81;
    v DOUBLE PRECISION := 10;
BEGIN
    FOR i IN 1..30 LOOP
        v := greatest(v - (k * v ^ 3 + roll * v - p_power) / (3 * k * v ^ 2 + roll), 1);
    END LOOP;
    RETURN v;
END;
$$;

-- Position {x, y} (metres) on a stadium-shaped track of length p_len at distance p_dist
CREATE OR REPLACE FUNCTION public.bots_track_xy(p_dist DOUBLE PRECISION, p_len DOUBLE PRECISION)
RETURNS DOUBLE PRECISION[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    r DOUBLE PRECISION := p_len / (2 * pi() + 4);
    st DOUBLE PRECISION := 2 * r;
    s DOUBLE PRECISION := p_dist - floor(p_dist / p_len) * p_len;
    a DOUBLE PRECISION;
BEGIN
    IF s < st THEN
        RETURN ARRAY[-r + s, -r];
    ELSIF s < st + pi() * r THEN
        a := (s - st) / r;
        RETURN ARRAY[r + r * sin(a), -r * cos(a)];
    ELSIF s < 2 * st + pi() * r THEN
        RETURN ARRAY[r - (s - st - pi() * r), r];
    ELSE
        a := (s - 2 * st - pi() * r) / r;
        RETURN ARRAY[-r - r * sin(a), r * cos(a)];
    END IF;
END;
$$;

-- Same shape/projection as buildRoutePreview() (100x100 box, 8 padding) for a closed lap
CREATE OR REPLACE FUNCTION public.bots_route_preview(p_len DOUBLE PRECISION)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    r DOUBLE PRECISION := p_len / (2 * pi() + 4);
    scale DOUBLE PRECISION := 84 / (4 * r);
    pts JSONB := '[]'::jsonb;
    xy DOUBLE PRECISION[];
BEGIN
    FOR i IN 0..40 LOOP
        xy := public.bots_track_xy(p_len * i / 40.0, p_len);
        pts := pts || jsonb_build_array(
            round((8 + (xy[1] + 2 * r) * scale)::numeric, 1),
            round((29 + (r - xy[2]) * scale)::numeric, 1));
    END LOOP;
    RETURN jsonb_build_object('kind', 'route', 'points', pts);
END;
$$;

-- Maximal rolling averages like compute_durational_curve() in api/analyze.py
-- (windows of 5 min and longer are sampled every 5 s to keep generation cheap).
CREATE OR REPLACE FUNCTION public.bots_curve(p_series DOUBLE PRECISION[])
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    n INTEGER := coalesce(array_length(p_series, 1), 0);
    cs DOUBLE PRECISION[];
    res JSONB := '{}'::jsonb;
    m DOUBLE PRECISION;
    lbl TEXT;
    w INTEGER;
BEGIN
    IF n = 0 THEN RETURN res; END IF;
    cs := array_fill(0::float8, ARRAY[n + 1]);
    FOR i IN 1..n LOOP
        cs[i + 1] := cs[i] + p_series[i];
    END LOOP;
    FOREACH w IN ARRAY ARRAY[1,5,10,15,30,60,120,180,300,600,900,1200,1800,3600] LOOP
        CONTINUE WHEN n < w;
        m := -1;
        FOR i IN 1..(n - w + 1) BY (CASE WHEN w >= 300 THEN 5 ELSE 1 END) LOOP
            m := greatest(m, cs[i + w] - cs[i]);
        END LOOP;
        lbl := CASE WHEN w < 60 THEN w || 's' WHEN w < 3600 THEN (w / 60) || 'm' ELSE (w / 3600) || 'h' END;
        res := res || jsonb_build_object(lbl, round((m / w)::numeric, 1));
    END LOOP;
    RETURN res;
END;
$$;

-- 4. Ride generator ------------------------------------------------------------------------
-- Returns the new activity id, or NULL if the bot rests that day / already has the ride.
CREATE OR REPLACE FUNCTION public.bots_generate_ride(p public.bot_personas, p_date DATE)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
    marker TEXT := 'bot:' || p.key || ':' || p_date::text;
    trk RECORD;
    track_len DOUBLE PRECISION := 250;
    t_lat DOUBLE PRECISION := 43.4882;
    t_lng DOUBLE PRECISION := -79.8512;
    t_alt DOUBLE PRECISION := 215;
    weeks DOUBLE PRECISION;
    factor DOUBLE PRECISION;
    ftp DOUBLE PRECISION;
    ride_type TEXT;
    pick DOUBLE PRECISION;
    w_total DOUBLE PRECISION;
    kv RECORD;
    segs public.bot_seg[] := ARRAY[]::public.bot_seg[];
    seg public.bot_seg;
    efforts INTEGER;
    blocks INTEGER;
    surges INTEGER;
    peak DOUBLE PRECISION;
    total_sec DOUBLE PRECISION;
    t_acc DOUBLE PRECISION;
    d DOUBLE PRECISION;
    n INTEGER;
    idx INTEGER := 0;
    dev DOUBLE PRECISION := (p.chainring::float8 / p.cog) * 2.096;
    roll DOUBLE PRECISION := 0.003 * 85 * 9.81;
    pw DOUBLE PRECISION;
    noisy DOUBLE PRECISION;
    tau DOUBLE PRECISION;
    kk DOUBLE PRECISION;
    vt DOUBLE PRECISION := 8;
    v DOUBLE PRECISION := 0;
    dist DOUBLE PRECISION := 0;
    hr DOUBLE PRECISION := 90;
    hr_target DOUBLE PRECISION;
    cad DOUBLE PRECISION;
    xy DOUBLE PRECISION[];
    lat_deg DOUBLE PRECISION;
    lng_deg DOUBLE PRECISION;
    a_watts INTEGER[];
    a_cad INTEGER[];
    a_speed DOUBLE PRECISION[];
    a_torque DOUBLE PRECISION[];
    a_hr INTEGER[];
    a_lat DOUBLE PRECISION[];
    a_lng DOUBLE PRECISION[];
    a_alt DOUBLE PRECISION[];
    a_dist DOUBLE PRECISION[];
    a_cw DOUBLE PRECISION[];
    s_watts DOUBLE PRECISION[];
    s_cad DOUBLE PRECISION[];
    s_hr DOUBLE PRECISION[];
    start_ts TIMESTAMPTZ;
    avg_w DOUBLE PRECISION;
    norm_p DOUBLE PRECISION;
    if_val DOUBLE PRECISION;
    curves JSONB;
    act_id UUID;
    best_sec DOUBLE PRECISION;
    cand DOUBLE PRECISION;
    j INTEGER;
    prev_best NUMERIC;
    lbl TEXT;
BEGIN
    PERFORM setseed(public.bots_seed(p.key || '|' || p_date || '|decide'));
    IF random() >= p.weekly[extract(dow FROM p_date)::int + 1] THEN
        RETURN NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM public.activities WHERE user_id = p.user_id AND file_sha256 = marker) THEN
        RETURN NULL;
    END IF;

    SELECT t.id, t.length_m, t.latitude, t.longitude, t.elevation_m INTO trk
    FROM public.tracks t WHERE t.name = p.track_name LIMIT 1;
    IF trk.id IS NOT NULL THEN
        track_len := coalesce(trk.length_m, track_len);
        t_lat := coalesce(trk.latitude, t_lat);
        t_lng := coalesce(trk.longitude, t_lng);
        t_alt := coalesce(trk.elevation_m, t_alt);
    END IF;

    -- Slow fitness trend plus day-to-day form
    weeks := (p_date - DATE '2026-01-01') / 7.0;
    PERFORM setseed(public.bots_seed(p.key || '|' || p_date || '|form'));
    factor := 1 + greatest(-0.15, least(0.15, p.weekly_gain * weeks)) + public.bots_normal(0, 0.04);
    ftp := p.ftp_w * factor;

    PERFORM setseed(public.bots_seed(p.key || '|' || p_date || '|ride'));

    SELECT sum(value::float8) INTO w_total FROM jsonb_each_text(p.session_weights);
    pick := random() * w_total;
    FOR kv IN SELECT key, value::float8 AS w FROM jsonb_each_text(p.session_weights) ORDER BY key LOOP
        ride_type := kv.key;
        pick := pick - kv.w;
        EXIT WHEN pick <= 0;
    END LOOP;

    -- Session plan -------------------------------------------------------------------------
    segs := segs || ROW(round(480 + random() * 240)::int, ftp * 0.5, 0.8, 'warmup')::public.bot_seg;
    IF ride_type = 'flying' THEN
        efforts := 4 + floor(random() * 3)::int;
        FOR i IN 1..efforts LOOP
            peak := p.peak_power_w * factor * (0.85 + random() * 0.15);
            segs := segs || ROW(round(120 + random() * 60)::int, ftp * 0.55, 0.8, 'recovery')::public.bot_seg;
            segs := segs || ROW(round(2 * track_len / 12.0)::int, ftp * 0.9, 0.8, 'build')::public.bot_seg;
            segs := segs || ROW(greatest(round(track_len / public.bots_speed(peak, p.cda_mod, 1) * 1.3)::int, 12), peak, 1, 'flying')::public.bot_seg;
            segs := segs || ROW(round(90 + random() * 60)::int, ftp * 0.35, 0.8, 'cooldown-lap')::public.bot_seg;
        END LOOP;
    ELSIF ride_type = 'pack' THEN
        blocks := 5 + floor(random() * 4)::int;
        FOR i IN 1..blocks LOOP
            segs := segs || ROW(round(240 + random() * 180)::int, ftp * (0.7 + random() * 0.15), 0.6, 'pack')::public.bot_seg;
            surges := 2 + floor(random() * 3)::int;
            FOR s IN 1..surges LOOP
                segs := segs || ROW(round(8 + random() * 12)::int, ftp * (1.5 + random() * 0.9), 0.85, 'surge')::public.bot_seg;
                segs := segs || ROW(round(40 + random() * 50)::int, ftp * 0.65, 0.6, 'pack')::public.bot_seg;
            END LOOP;
            segs := segs || ROW(round(120 + random() * 60)::int, ftp * 0.45, 0.8, 'recovery')::public.bot_seg;
        END LOOP;
    ELSE
        total_sec := 2400 + random() * 3000;
        t_acc := 0;
        WHILE t_acc < total_sec LOOP
            d := 300 + random() * 300;
            segs := segs || ROW(round(d)::int, ftp * (0.62 + random() * 0.18), 0.6, 'endurance')::public.bot_seg;
            t_acc := t_acc + d;
        END LOOP;
    END IF;
    segs := segs || ROW(round(300 + random() * 120)::int, ftp * 0.4, 0.8, 'cooldown')::public.bot_seg;

    SELECT sum(s.sec) INTO n FROM unnest(segs) AS s;
    a_watts := array_fill(0, ARRAY[n]);
    a_cad := array_fill(0, ARRAY[n]);
    a_hr := array_fill(0, ARRAY[n]);
    a_speed := array_fill(0::float8, ARRAY[n]);
    a_torque := array_fill(0::float8, ARRAY[n]);
    a_lat := array_fill(0::float8, ARRAY[n]);
    a_lng := array_fill(0::float8, ARRAY[n]);
    a_alt := array_fill(0::float8, ARRAY[n]);
    a_dist := array_fill(0::float8, ARRAY[n]);
    s_watts := array_fill(0::float8, ARRAY[n]);
    s_cad := array_fill(0::float8, ARRAY[n]);
    s_hr := array_fill(0::float8, ARRAY[n]);

    -- Simulation: lagged power, speed from the power/drag balance, cadence from gearing --------
    pw := segs[1].power;
    FOREACH seg IN ARRAY segs LOOP
        tau := CASE WHEN seg.lbl IN ('flying', 'surge') THEN 1.5 ELSE 4 END;
        kk := 0.5 * 1.2 * 0.22 * p.cda_mod * seg.draft;
        FOR s IN 1..seg.sec LOOP
            idx := idx + 1;
            pw := pw + (seg.power - pw) / tau;
            noisy := greatest(0, pw + public.bots_normal(0, greatest(5, pw * 0.04)));
            FOR it IN 1..5 LOOP
                vt := greatest(vt - (kk * vt ^ 3 + roll * vt - pw) / (3 * kk * vt ^ 2 + roll), 1);
            END LOOP;
            v := v + (vt - v) * 0.15;
            cad := greatest(0, least(p.cadence_cap, v / dev * 60 + public.bots_normal(0, 1.2)));
            dist := dist + v;
            hr_target := 62 + 110 * least(1.1, pw / ftp) * 0.85;
            hr := hr + (hr_target - hr) * 0.03;
            xy := public.bots_track_xy(dist, track_len);
            lat_deg := t_lat + xy[2] / 111320.0;
            lng_deg := t_lng + xy[1] / (111320.0 * cos(radians(t_lat)));

            a_watts[idx] := round(noisy)::int;
            a_cad[idx] := round(cad)::int;
            a_speed[idx] := round((greatest(0, v + public.bots_normal(0, 0.05)) * 3.6)::numeric, 2)::float8;
            a_torque[idx] := CASE WHEN a_cad[idx] > 0
                THEN round((a_watts[idx] * 60 / (2 * pi() * a_cad[idx]))::numeric, 1)::float8 ELSE 0 END;
            a_hr[idx] := round(least(195, hr + public.bots_normal(0, 1)))::int;
            a_lat[idx] := round(lat_deg::numeric, 6)::float8;
            a_lng[idx] := round(lng_deg::numeric, 6)::float8;
            a_alt[idx] := t_alt;
            a_dist[idx] := dist;
            s_watts[idx] := a_watts[idx];
            s_cad[idx] := a_cad[idx];
            s_hr[idx] := a_hr[idx];
        END LOOP;
    END LOOP;

    -- Metrics (same definitions as api/analyze.py) -------------------------------------------
    avg_w := (SELECT avg(x) FROM unnest(s_watts) AS x);
    -- Normalized power: 4th-power mean of the 30 s rolling average
    a_cw := array_fill(0::float8, ARRAY[n + 1]);
    FOR i IN 1..n LOOP
        a_cw[i + 1] := a_cw[i] + s_watts[i];
    END LOOP;
    norm_p := 0;
    FOR i IN 1..(n - 29) LOOP
        norm_p := norm_p + ((a_cw[i + 30] - a_cw[i]) / 30.0) ^ 4;
    END LOOP;
    norm_p := (norm_p / greatest(n - 29, 1)) ^ 0.25;
    if_val := round((norm_p / p.ftp_w)::numeric, 3);

    curves := jsonb_build_object(
        'Power', public.bots_curve(s_watts),
        'Cadence', public.bots_curve(s_cad),
        'Speed', public.bots_curve(a_speed),
        'Torque', public.bots_curve(a_torque),
        'HeartRate', public.bots_curve(s_hr));

    start_ts := (p_date::timestamp + make_interval(hours => p.start_hour, mins => floor(random() * 45)::int,
                                                    secs => floor(random() * 60)::int)) AT TIME ZONE 'UTC';
    lbl := CASE ride_type WHEN 'flying' THEN 'Flying 200s' WHEN 'pack' THEN 'Pack session' ELSE 'Endurance laps' END;

    INSERT INTO public.activities (
        title, user_id, track_id, chainring, cog, crank_length_mm, activity_date, start_time,
        elapsed_time_s, moving_time_s, distance_m, avg_speed_kmh, max_speed_kmh, avg_power_w, max_power_w,
        normalized_power_w, avg_cadence_rpm, max_cadence_rpm, avg_torque_nm, peak_torque_nm,
        avg_hr, max_hr, elevation_gain_m, elevation_loss_m, intensity_factor, training_load,
        speed_source, time_series, route_preview, route_preview_zone, curves_data, file_sha256,
        processing_status, ftp_at_activity_w, visibility, badges)
    VALUES (
        lbl || ' (bot)', p.user_id, trk.id, p.chainring, p.cog, 165.0, start_ts, start_ts,
        n, n, round(dist::numeric, 1),
        round((SELECT avg(x) FROM unnest(a_speed) AS x)::numeric, 2),
        (SELECT max(x) FROM unnest(a_speed) AS x),
        round(avg_w)::int, (SELECT max(x) FROM unnest(a_watts) AS x),
        round(norm_p)::int,
        round((SELECT avg(x) FROM unnest(a_cad) AS x))::int, (SELECT max(x) FROM unnest(a_cad) AS x),
        round((SELECT avg(x) FROM unnest(a_torque) AS x)::numeric, 1),
        (SELECT max(x) FROM unnest(a_torque) AS x),
        round((SELECT avg(x) FROM unnest(a_hr) AS x))::int, (SELECT max(x) FROM unnest(a_hr) AS x),
        0, 0, if_val,
        round(((n * norm_p * if_val) / (p.ftp_w * 3600) * 100)::numeric, 1),
        'sensor',
        jsonb_build_object('watts', to_jsonb(a_watts), 'cadence', to_jsonb(a_cad), 'torque', to_jsonb(a_torque),
                           'speed', to_jsonb(a_speed), 'heartrate', to_jsonb(a_hr), 'latitude', to_jsonb(a_lat),
                           'longitude', to_jsonb(a_lng), 'altitude', to_jsonb(a_alt)),
        public.bots_route_preview(track_len), 'none', curves, marker,
        'baseline_completed', p.ftp_w, 'public', '[]'::jsonb)
    RETURNING id INTO act_id;

    INSERT INTO public.activity_curves (activity_id, curve_type, data)
    SELECT act_id, c.key, c.value FROM jsonb_each(curves) AS c;

    -- Personal best: fastest 200 m (flying) window of the session, interpolated between samples
    IF ride_type = 'flying' THEN
        best_sec := NULL;
        j := 1;
        FOR i IN 1..n LOOP
            WHILE j <= n AND a_dist[j] - a_dist[i] < 200 LOOP
                j := j + 1;
            END LOOP;
            EXIT WHEN j > n;
            IF j > i + 1 THEN
                cand := (j - 1 - i) + (200 - (a_dist[j - 1] - a_dist[i])) / (a_dist[j] - a_dist[j - 1]);
                IF best_sec IS NULL OR cand < best_sec THEN best_sec := cand; END IF;
            END IF;
        END LOOP;
        IF best_sec IS NOT NULL AND best_sec > 0 THEN
            SELECT min(time_seconds) INTO prev_best FROM public.personal_bests
            WHERE user_id = p.user_id AND discipline = '200m Flying';
            IF prev_best IS NULL OR round(best_sec::numeric, 3) < prev_best THEN
                INSERT INTO public.personal_bests
                    (user_id, track_id, track_name, discipline, discipline_distance_m, achieved_date,
                     time_seconds, avg_speed_kmh, chainring, cog, split_mode, lap_times, notes)
                VALUES (p.user_id, trk.id, p.track_name, '200m Flying', 200, p_date,
                        round(best_sec::numeric, 3), round((200 / best_sec * 3.6)::numeric, 2),
                        p.chainring, p.cog, 'laps', '{}', 'Synthetic bot ride');
            END IF;
        END IF;
    END IF;

    RETURN act_id;
END;
$$;

-- 5. Daily job / reset ---------------------------------------------------------------------
-- Generates the rides for each date in [p_from, p_to] for every bot (idempotent).
CREATE OR REPLACE FUNCTION public.bots_run_range(p_from DATE, p_to DATE)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    persona public.bot_personas;
    d DATE;
    created INTEGER := 0;
BEGIN
    FOR d IN SELECT g::date FROM generate_series(p_from, p_to, interval '1 day') AS g LOOP
        FOR persona IN SELECT * FROM public.bot_personas ORDER BY key LOOP
            IF public.bots_generate_ride(persona, d) IS NOT NULL THEN
                created := created + 1;
            END IF;
        END LOOP;
    END LOOP;
    RETURN created;
END;
$$;

-- Yesterday's rides, plus two days of catch-up in case a cron run was missed.
CREATE OR REPLACE FUNCTION public.bots_run_day()
RETURNS INTEGER LANGUAGE sql AS $$
    SELECT public.bots_run_range(CURRENT_DATE - 3, CURRENT_DATE - 1)
$$;

-- Wipes bot rides/PBs/follows and regenerates history: SELECT public.bots_reset(60);
CREATE OR REPLACE FUNCTION public.bots_reset(p_days INTEGER DEFAULT 60)
RETURNS INTEGER LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM public.activities WHERE user_id IN (SELECT user_id FROM public.bot_personas);
    DELETE FROM public.personal_bests WHERE user_id IN (SELECT user_id FROM public.bot_personas);
    DELETE FROM public.follows WHERE follower_id IN (SELECT user_id FROM public.bot_personas);
    RETURN public.bots_run_range(CURRENT_DATE - p_days, CURRENT_DATE - 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bots_generate_ride(public.bot_personas, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bots_run_range(DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bots_run_day() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bots_reset(INTEGER) FROM PUBLIC, anon, authenticated;

-- 6. Follow back ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bots_follow_back()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.followee_id AND is_bot)
       AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.follower_id AND is_bot)
       AND NOT public.is_blocked_between(NEW.followee_id, NEW.follower_id) THEN
        INSERT INTO public.follows (follower_id, followee_id)
        VALUES (NEW.followee_id, NEW.follower_id)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bots_follow_back() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bots_follow_back ON public.follows;
CREATE TRIGGER trg_bots_follow_back
    AFTER INSERT ON public.follows
    FOR EACH ROW EXECUTE FUNCTION public.bots_follow_back();

-- 7. Schedule + initial history ------------------------------------------------------------
SELECT cron.schedule('bots-daily', '30 4 * * *', 'SELECT public.bots_run_day()');

SELECT public.bots_run_range(CURRENT_DATE - 60, CURRENT_DATE - 1);
