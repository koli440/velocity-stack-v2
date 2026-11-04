-- VelocityStack: gym exercise catalogue (shared, searchable, admin-curated).
--  * exercise_catalogue: public rows (owner_id NULL) + a rider's private suggestions (owner_id = rider).
--    Reads: public, own private, coach of the owner, admin. All writes go through the RPCs below.
--  * gym_exercises.catalogue_id links a logged exercise to the catalogue (auto-resolved by name/alias on insert).
--  * Per-set jump height lives in gym_sets.metrics.height_cm (centimetres); weight stays in weight_kg.
--  * suggest_exercise(): private use at once + a pending 'exercise' suggestion for the admin (review_suggestion
--    approves by flipping owner_id to NULL = public).
--  * admin_unmapped_exercises() / admin_map_exercises(): admin maps free-text names to the catalogue.
-- Idempotent; no existing data is changed except the new catalogue_id link and the stale flag on linked sessions.

-- 1. Catalogue ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exercise_key(p_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g')))
$$;

CREATE TABLE IF NOT EXISTS public.exercise_catalogue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    name_key TEXT GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) STORED,
    aliases TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(aliases) <= 20),
    alias_keys TEXT[] NOT NULL DEFAULT '{}',
    movement_type TEXT NOT NULL DEFAULT 'strength' CHECK (movement_type IN ('strength', 'dynamic', 'jump')),
    unilateral BOOLEAN NOT NULL DEFAULT FALSE,
    set_fields TEXT[] NOT NULL DEFAULT '{reps,weight}'
        CHECK (set_fields <@ ARRAY['reps', 'weight', 'height', 'duration']::text[]),
    category TEXT CHECK (category IS NULL OR char_length(category) <= 60),
    owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_exercise_catalogue_public_key
    ON public.exercise_catalogue (name_key) WHERE owner_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_exercise_catalogue_private_key
    ON public.exercise_catalogue (owner_id, name_key) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exercise_catalogue_alias_keys ON public.exercise_catalogue USING GIN (alias_keys);
CREATE INDEX IF NOT EXISTS idx_exercise_catalogue_owner ON public.exercise_catalogue (owner_id) WHERE owner_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.exercise_catalogue_normalise()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.aliases := COALESCE((SELECT array_agg(a ORDER BY o) FROM (
        SELECT btrim(x) AS a, min(ord) AS o FROM unnest(NEW.aliases) WITH ORDINALITY AS u(x, ord)
        WHERE btrim(x) <> '' AND char_length(btrim(x)) <= 120 GROUP BY btrim(x)) q), '{}');
    NEW.alias_keys := COALESCE((SELECT array_agg(DISTINCT public.exercise_key(a)) FROM unnest(NEW.aliases) AS a), '{}');
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_exercise_catalogue_normalise ON public.exercise_catalogue;
CREATE TRIGGER trg_exercise_catalogue_normalise
    BEFORE INSERT OR UPDATE ON public.exercise_catalogue
    FOR EACH ROW EXECUTE FUNCTION public.exercise_catalogue_normalise();

ALTER TABLE public.exercise_catalogue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "exercise_catalogue_select" ON public.exercise_catalogue;
CREATE POLICY "exercise_catalogue_select" ON public.exercise_catalogue FOR SELECT TO authenticated
    USING (owner_id IS NULL OR owner_id = auth.uid() OR public.is_admin() OR public.is_coach_of(owner_id));
REVOKE ALL ON public.exercise_catalogue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.exercise_catalogue TO authenticated;

-- 2. Seed (public, admin-curated; re-runs never overwrite later admin edits) ----------------
INSERT INTO public.exercise_catalogue (name, category, movement_type, unilateral, set_fields, aliases)
SELECT v.name, v.category, v.movement_type, v.unilateral, v.set_fields::text[], v.aliases::text[]
FROM (VALUES
 ('Back squat', 'Squat', 'strength', FALSE, '{reps,weight}', '{squat,barbell squat,high bar squat,low bar squat,kneebøj,knebøj}'),
 ('Front squat', 'Squat', 'strength', FALSE, '{reps,weight}', '{barbell front squat}'),
 ('Goblet squat', 'Squat', 'strength', FALSE, '{reps,weight}', '{dumbbell squat,kettlebell squat}'),
 ('Box squat', 'Squat', 'strength', FALSE, '{reps,weight}', '{squat to box}'),
 ('Hack squat', 'Squat', 'strength', FALSE, '{reps,weight}', '{hack squat machine}'),
 ('Smith machine squat', 'Squat', 'strength', FALSE, '{reps,weight}', '{smith squat}'),
 ('Bodyweight squat', 'Squat', 'strength', FALSE, '{reps,weight}', '{air squat,bw squat}'),
 ('Leg press', 'Squat', 'strength', FALSE, '{reps,weight}', '{legpress,leg-press,seated leg press,benkpres}'),
 ('Single-leg press', 'Squat', 'strength', TRUE, '{reps,weight}', '{one leg press,single leg leg press,unilateral leg press}'),
 ('Lunge', 'Lunge', 'strength', TRUE, '{reps,weight}', '{lunges,barbell lunge,barbell lunges,dumbbell lunge,dumbbell lunges,forward lunge,forward lunges,static lunge}'),
 ('Walking lunge', 'Lunge', 'strength', TRUE, '{reps,weight}', '{walking lunges}'),
 ('Reverse lunge', 'Lunge', 'strength', TRUE, '{reps,weight}', '{reverse lunges,backward lunge,backward lunges}'),
 ('Lateral lunge', 'Lunge', 'strength', TRUE, '{reps,weight}', '{side lunge,side lunges,lateral lunges}'),
 ('Bulgarian split squat', 'Lunge', 'strength', TRUE, '{reps,weight}', '{split squat,rear foot elevated split squat,rfess,bulgarian}'),
 ('Step-up', 'Lunge', 'strength', TRUE, '{reps,weight}', '{step up,step ups,step-ups,box step up,box step-up}'),
 ('Single-leg squat', 'Squat', 'strength', TRUE, '{reps,weight}', '{pistol squat,one leg squat,single leg squat,skater squat}'),
 ('Deadlift', 'Hinge', 'strength', FALSE, '{reps,weight}', '{conventional deadlift,barbell deadlift,dead lift,mark løft}'),
 ('Romanian deadlift', 'Hinge', 'strength', FALSE, '{reps,weight}', '{rdl,romanian dead lift,stiff leg deadlift}'),
 ('Single-leg Romanian deadlift', 'Hinge', 'strength', TRUE, '{reps,weight}', '{single leg rdl,one leg rdl,single-leg rdl}'),
 ('Trap bar deadlift', 'Hinge', 'strength', FALSE, '{reps,weight}', '{hex bar deadlift,trap-bar deadlift}'),
 ('Sumo deadlift', 'Hinge', 'strength', FALSE, '{reps,weight}', '{sumo dead lift}'),
 ('Good morning', 'Hinge', 'strength', FALSE, '{reps,weight}', '{goodmorning,good mornings}'),
 ('Hip thrust', 'Hinge', 'strength', FALSE, '{reps,weight}', '{barbell hip thrust,hip thrusts,glute bridge thrust}'),
 ('Single-leg hip thrust', 'Hinge', 'strength', TRUE, '{reps,weight}', '{single leg hip thrust,one leg hip thrust}'),
 ('Glute bridge', 'Hinge', 'strength', FALSE, '{reps,weight}', '{bridge,glute bridges}'),
 ('Kettlebell swing', 'Hinge', 'dynamic', FALSE, '{reps,weight}', '{kb swing,kettlebell swings,russian swing}'),
 ('Leg curl', 'Accessory', 'strength', FALSE, '{reps,weight}', '{hamstring curl,seated leg curl,lying leg curl}'),
 ('Nordic hamstring curl', 'Accessory', 'strength', FALSE, '{reps,weight}', '{nordic curl,nordics,nordic hamstring}'),
 ('Leg extension', 'Accessory', 'strength', FALSE, '{reps,weight}', '{knee extension,leg extensions}'),
 ('Calf raise', 'Accessory', 'strength', FALSE, '{reps,weight}', '{calf raises,standing calf raise,seated calf raise,heel raise}'),
 ('Single-leg calf raise', 'Accessory', 'strength', TRUE, '{reps,weight}', '{single leg calf raise,one leg calf raise}'),
 ('Box jump', 'Jump', 'jump', FALSE, '{reps,height,weight}', '{box jumps,plyo box jump,jump onto box}'),
 ('Broad jump', 'Jump', 'jump', FALSE, '{reps,weight}', '{standing long jump,long jump,broad jumps}'),
 ('Countermovement jump', 'Jump', 'jump', FALSE, '{reps,height,weight}', '{cmj,vertical jump,jump,jumps,jump squat}'),
 ('Squat jump', 'Jump', 'jump', FALSE, '{reps,height,weight}', '{squat jumps,loaded squat jump}'),
 ('Depth jump', 'Jump', 'jump', FALSE, '{reps,height,weight}', '{drop jump,depth jumps}'),
 ('Single-leg hop', 'Jump', 'jump', TRUE, '{reps,height}', '{single leg hop,one leg hop,hop,hops,single leg jump}'),
 ('Lateral bound', 'Jump', 'jump', TRUE, '{reps,height}', '{skater jump,lateral hop,skater bound}'),
 ('Power clean', 'Olympic', 'dynamic', FALSE, '{reps,weight}', '{clean,hang clean,hang power clean}'),
 ('Snatch', 'Olympic', 'dynamic', FALSE, '{reps,weight}', '{power snatch,hang snatch}'),
 ('Medicine ball throw', 'Throw', 'dynamic', FALSE, '{reps,weight}', '{med ball throw,medball throw,ball slam,medicine ball slam}'),
 ('Bench press', 'Upper push', 'strength', FALSE, '{reps,weight}', '{bench,barbell bench press,flat bench,bænkpres}'),
 ('Dumbbell bench press', 'Upper push', 'strength', FALSE, '{reps,weight}', '{db bench,db bench press,dumbbell press}'),
 ('Incline bench press', 'Upper push', 'strength', FALSE, '{reps,weight}', '{incline press,incline dumbbell press}'),
 ('Overhead press', 'Upper push', 'strength', FALSE, '{reps,weight}', '{ohp,shoulder press,military press,standing press}'),
 ('Push-up', 'Upper push', 'strength', FALSE, '{reps,weight}', '{push up,pushup,push-ups,pushups,press up}'),
 ('Dip', 'Upper push', 'strength', FALSE, '{reps,weight}', '{dips,tricep dip,parallel bar dip}'),
 ('Barbell row', 'Upper pull', 'strength', FALSE, '{reps,weight}', '{bent over row,bent-over row,barbell bent over row,pendlay row}'),
 ('Dumbbell row', 'Upper pull', 'strength', TRUE, '{reps,weight}', '{one arm row,single arm row,db row,one-arm dumbbell row}'),
 ('Seated cable row', 'Upper pull', 'strength', FALSE, '{reps,weight}', '{cable row,seated row,low row}'),
 ('Lat pulldown', 'Upper pull', 'strength', FALSE, '{reps,weight}', '{pulldown,lat pull down,lat pull-down}'),
 ('Pull-up', 'Upper pull', 'strength', FALSE, '{reps,weight}', '{pull up,pullup,pull-ups,pullups,chin-up,chin up,chinup}'),
 ('Face pull', 'Upper pull', 'strength', FALSE, '{reps,weight}', '{face pulls,rear delt pull}'),
 ('Plank', 'Core', 'strength', FALSE, '{duration,weight}', '{planks,front plank,forearm plank}'),
 ('Side plank', 'Core', 'strength', TRUE, '{duration,weight}', '{side planks}'),
 ('Dead bug', 'Core', 'strength', FALSE, '{reps}', '{deadbug,dead bugs}'),
 ('Russian twist', 'Core', 'strength', FALSE, '{reps,weight}', '{russian twists}'),
 ('Hanging leg raise', 'Core', 'strength', FALSE, '{reps,weight}', '{leg raise,leg raises,hanging knee raise,toes to bar}'),
 ('Ab wheel rollout', 'Core', 'strength', FALSE, '{reps}', '{ab roller,ab wheel,rollout,rollouts}'),
 ('Pallof press', 'Core', 'strength', TRUE, '{reps,weight}', '{pallof,cable anti-rotation press}'),
 ('Back extension', 'Core', 'strength', FALSE, '{reps,weight}', '{hyperextension,hyper extension,back extensions,45 degree back extension}'),
 ('Farmer''s carry', 'Core', 'strength', FALSE, '{duration,weight}', '{farmers walk,farmer carry,farmers carry,farmer''s walk,suitcase carry}')
) AS v(name, category, movement_type, unilateral, set_fields, aliases)
ON CONFLICT (name_key) WHERE owner_id IS NULL DO NOTHING;

-- 3. Link from logged exercises ---------------------------------------------------------------
ALTER TABLE public.gym_exercises
    ADD COLUMN IF NOT EXISTS catalogue_id UUID REFERENCES public.exercise_catalogue(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_gym_exercises_catalogue ON public.gym_exercises (catalogue_id) WHERE catalogue_id IS NOT NULL;

-- Resolve a name to the best visible catalogue row for a rider: own private > public; name > alias.
CREATE OR REPLACE FUNCTION public.resolve_catalogue_exercise(p_user UUID, p_name TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT c.id FROM public.exercise_catalogue c
     WHERE (c.owner_id IS NULL OR c.owner_id = p_user)
       AND (c.name_key = public.exercise_key(p_name) OR public.exercise_key(p_name) = ANY (c.alias_keys))
     ORDER BY (c.name_key = public.exercise_key(p_name)) DESC, (c.owner_id IS NOT NULL) DESC, c.created_at
     LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.resolve_catalogue_exercise(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.gym_exercise_autolink()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.catalogue_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.exercise_catalogue c
                        WHERE c.id = NEW.catalogue_id AND (c.owner_id IS NULL OR c.owner_id = NEW.user_id)) THEN
            NEW.catalogue_id := NULL;
        END IF;
    END IF;
    IF NEW.catalogue_id IS NULL THEN
        NEW.catalogue_id := public.resolve_catalogue_exercise(NEW.user_id, NEW.name);
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gym_exercise_autolink ON public.gym_exercises;
CREATE TRIGGER trg_gym_exercise_autolink
    BEFORE INSERT ON public.gym_exercises
    FOR EACH ROW EXECUTE FUNCTION public.gym_exercise_autolink();

-- The write path keeps its contract; the exercise may carry catalogue_id (the trigger vets it) and each
-- set may carry metrics.height_cm (0..400, centimetres).
CREATE OR REPLACE FUNCTION public.save_gym_session(p_activity UUID, p_exercises JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    a public.activities%ROWTYPE;
    ex JSONB;
    s JSONB;
    v_ex_id UUID;
    v_ex_pos INTEGER := 0;
    v_set_pos INTEGER := 0;
    v_old_ex INTEGER;
    v_old_sets INTEGER;
    v_by_coach BOOLEAN;
    v_cat UUID;
    v_h NUMERIC;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
    IF p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array' THEN
        RAISE EXCEPTION 'Exercises must be a list';
    END IF;
    IF jsonb_array_length(p_exercises) > 100 THEN RAISE EXCEPTION 'Too many exercises (max 100)'; END IF;

    SELECT * INTO a FROM public.activities WHERE id = p_activity FOR UPDATE;
    IF NOT FOUND OR NOT (a.user_id = auth.uid() OR public.is_coach_of(a.user_id)) THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;
    IF a.activity_type <> 'gym' THEN RAISE EXCEPTION 'Only gym sessions have exercises and sets'; END IF;
    v_by_coach := a.user_id <> auth.uid();

    SELECT count(*) INTO v_old_ex FROM public.gym_exercises WHERE activity_id = p_activity;
    SELECT count(*) INTO v_old_sets FROM public.gym_sets WHERE activity_id = p_activity AND set_type = 'active';

    DELETE FROM public.gym_exercises WHERE activity_id = p_activity;

    FOR ex IN SELECT value FROM jsonb_array_elements(p_exercises) LOOP
        IF jsonb_typeof(ex) <> 'object' OR jsonb_typeof(COALESCE(ex->'sets', '[]'::jsonb)) <> 'array' THEN
            RAISE EXCEPTION 'Invalid exercise';
        END IF;
        v_cat := NULL;
        IF COALESCE(ex->>'catalogue_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            v_cat := (ex->>'catalogue_id')::uuid;
        END IF;
        INSERT INTO public.gym_exercises (activity_id, user_id, position, name, category, subtype, notes, catalogue_id)
        VALUES (p_activity, a.user_id, v_ex_pos, btrim(ex->>'name'), NULLIF(ex->>'category', ''),
                NULLIF(ex->>'subtype', ''), NULLIF(btrim(COALESCE(ex->>'notes', '')), ''), v_cat)
        RETURNING id INTO v_ex_id;
        v_ex_pos := v_ex_pos + 1;

        FOR s IN SELECT value FROM jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) LOOP
            IF jsonb_typeof(s) <> 'object' OR jsonb_typeof(COALESCE(s->'metrics', '{}'::jsonb)) <> 'object' THEN
                RAISE EXCEPTION 'Invalid set';
            END IF;
            IF v_set_pos >= 1000 THEN RAISE EXCEPTION 'Too many sets (max 1000)'; END IF;
            IF s->'metrics' ? 'height_cm' AND jsonb_typeof(s->'metrics'->'height_cm') <> 'null' THEN
                IF jsonb_typeof(s->'metrics'->'height_cm') <> 'number' THEN
                    RAISE EXCEPTION 'Jump height must be a number (cm)';
                END IF;
                v_h := (s->'metrics'->>'height_cm')::numeric;
                IF v_h < 0 OR v_h > 400 THEN RAISE EXCEPTION 'Jump height must be between 0 and 400 cm'; END IF;
            END IF;
            INSERT INTO public.gym_sets (activity_id, exercise_id, user_id, position, set_type, start_time,
                                         duration_s, reps, weight_kg, kind, rest_s, rpe, rir, tempo, side,
                                         load_mode, notes, metrics)
            VALUES (p_activity, v_ex_id, a.user_id, v_set_pos, 'active',
                    NULLIF(s->>'start_time', '')::timestamptz,
                    NULLIF(s->>'duration_s', '')::numeric,
                    NULLIF(s->>'reps', '')::integer,
                    NULLIF(s->>'weight_kg', '')::numeric,
                    COALESCE(NULLIF(s->>'kind', ''), 'working'),
                    NULLIF(s->>'rest_s', '')::numeric,
                    NULLIF(s->>'rpe', '')::numeric,
                    NULLIF(s->>'rir', '')::numeric,
                    NULLIF(btrim(COALESCE(s->>'tempo', '')), ''),
                    NULLIF(s->>'side', ''),
                    COALESCE(NULLIF(s->>'load_mode', ''), 'weighted'),
                    NULLIF(btrim(COALESCE(s->>'notes', '')), ''),
                    COALESCE(s->'metrics', '{}'::jsonb));
            v_set_pos := v_set_pos + 1;
        END LOOP;
    END LOOP;

    INSERT INTO public.gym_session_edits (activity_id, user_id, edited_at, edited_by, edited_by_coach)
    VALUES (p_activity, a.user_id, NOW(), auth.uid(), v_by_coach)
    ON CONFLICT (activity_id) DO UPDATE
        SET edited_at = EXCLUDED.edited_at, edited_by = EXCLUDED.edited_by,
            edited_by_coach = EXCLUDED.edited_by_coach;

    UPDATE public.activities SET gym_detail_checked_at = COALESCE(gym_detail_checked_at, NOW())
     WHERE id = p_activity;

    IF v_by_coach THEN
        PERFORM public.record_coach_edit(a.user_id, 'gym_sets', p_activity, 'update',
            jsonb_build_object('exercises', v_old_ex, 'sets', v_old_sets),
            jsonb_build_object('exercises', v_ex_pos, 'sets', v_set_pos));
    END IF;

    RETURN jsonb_build_object('exercises', v_ex_pos, 'sets', v_set_pos, 'edited_by_coach', v_by_coach);
END;
$$;
REVOKE ALL ON FUNCTION public.save_gym_session(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_gym_session(UUID, JSONB) TO authenticated;

-- 4. Backfill: link existing rows (name first, then alias); re-score only what newly got a link ---
WITH matches AS (
    SELECT DISTINCT ON (e.id) e.id, e.activity_id, c.id AS cat_id
      FROM public.gym_exercises e
      JOIN public.exercise_catalogue c
        ON c.owner_id IS NULL
       AND (c.name_key = public.exercise_key(e.name) OR public.exercise_key(e.name) = ANY (c.alias_keys))
     WHERE e.catalogue_id IS NULL
     ORDER BY e.id, (c.name_key = public.exercise_key(e.name)) DESC, c.created_at
), linked AS (
    UPDATE public.gym_exercises e SET catalogue_id = m.cat_id
      FROM matches m WHERE e.id = m.id
    RETURNING e.activity_id
)
UPDATE public.activities a SET gym_load_stale = TRUE
 WHERE a.id IN (SELECT activity_id FROM linked) AND a.gym_load_at IS NOT NULL;

-- 5. Suggestions: riders add exercises; the admin approves (owner_id -> NULL = public) -----------
INSERT INTO public.suggestion_targets (entity_type, table_name, id_column, label, allowed_columns)
VALUES ('exercise', 'exercise_catalogue', 'id', 'Gym exercise',
        ARRAY['name', 'aliases', 'movement_type', 'unilateral', 'set_fields', 'category', 'owner_id'])
ON CONFLICT (entity_type) DO UPDATE
    SET table_name = EXCLUDED.table_name, id_column = EXCLUDED.id_column,
        label = EXCLUDED.label, allowed_columns = EXCLUDED.allowed_columns;

-- Non-service submitters may only suggest promoting their own private exercise.
CREATE OR REPLACE FUNCTION public.validate_exercise_suggestion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.entity_type <> 'exercise' THEN RETURN NEW; END IF;
    IF COALESCE(auth.role(), 'service_role') = 'service_role' THEN RETURN NEW; END IF;
    IF NEW.target_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.exercise_catalogue c
         WHERE c.id::text = NEW.target_id AND c.owner_id = NEW.submitter_id) THEN
        RAISE EXCEPTION 'Exercise suggestions must refer to your own private exercise';
    END IF;
    IF NEW.payload ? 'owner_id' AND jsonb_typeof(NEW.payload->'owner_id') <> 'null' THEN
        RAISE EXCEPTION 'Invalid suggestion';
    END IF;
    IF NEW.payload ? 'movement_type' AND NEW.payload->>'movement_type' NOT IN ('strength', 'dynamic', 'jump') THEN
        RAISE EXCEPTION 'Invalid movement type';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_exercise_suggestion ON public.suggestions;
CREATE TRIGGER trg_validate_exercise_suggestion
    BEFORE INSERT ON public.suggestions
    FOR EACH ROW EXECUTE FUNCTION public.validate_exercise_suggestion();

-- p_aliases: list of alternative names. Returns {status: 'exists'|'created', suggested, exercise}.
CREATE OR REPLACE FUNCTION public.suggest_exercise(
    p_name TEXT, p_aliases TEXT[] DEFAULT '{}', p_movement_type TEXT DEFAULT 'strength',
    p_unilateral BOOLEAN DEFAULT FALSE, p_category TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_name TEXT := btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g'));
    v_existing UUID;
    v_row public.exercise_catalogue%ROWTYPE;
    v_fields TEXT[];
    v_suggested BOOLEAN := TRUE;
    v_k TEXT;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
    IF char_length(v_name) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Exercise name must be 1-120 characters'; END IF;
    IF p_movement_type NOT IN ('strength', 'dynamic', 'jump') THEN RAISE EXCEPTION 'Invalid movement type'; END IF;
    p_aliases := COALESCE(p_aliases, '{}');
    IF cardinality(p_aliases) > 20 THEN RAISE EXCEPTION 'Too many aliases (max 20)'; END IF;

    v_existing := public.resolve_catalogue_exercise(v_uid, v_name);
    IF v_existing IS NULL THEN
        FOREACH v_k IN ARRAY p_aliases LOOP
            v_existing := public.resolve_catalogue_exercise(v_uid, v_k);
            EXIT WHEN v_existing IS NOT NULL;
        END LOOP;
    END IF;
    IF v_existing IS NOT NULL THEN
        SELECT * INTO v_row FROM public.exercise_catalogue WHERE id = v_existing;
        RETURN jsonb_build_object('status', 'exists', 'suggested', FALSE, 'exercise', to_jsonb(v_row));
    END IF;

    IF (SELECT count(*) FROM public.exercise_catalogue WHERE owner_id = v_uid) >= 200 THEN
        RAISE EXCEPTION 'Too many private exercises';
    END IF;

    v_fields := CASE p_movement_type
        WHEN 'jump' THEN ARRAY['reps', 'height', 'weight']
        ELSE ARRAY['reps', 'weight'] END;
    INSERT INTO public.exercise_catalogue (name, aliases, movement_type, unilateral, set_fields, category, owner_id)
    VALUES (v_name, p_aliases, p_movement_type, COALESCE(p_unilateral, FALSE), v_fields,
            NULLIF(btrim(COALESCE(p_category, '')), ''), v_uid)
    RETURNING * INTO v_row;

    BEGIN
        INSERT INTO public.suggestions (entity_type, target_id, payload, submitter_id)
        VALUES ('exercise', v_row.id::text,
                jsonb_build_object('name', v_row.name, 'aliases', to_jsonb(v_row.aliases),
                                   'movement_type', v_row.movement_type, 'unilateral', v_row.unilateral,
                                   'set_fields', to_jsonb(v_row.set_fields), 'category', v_row.category,
                                   'owner_id', NULL),
                v_uid);
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE 'Too many%' THEN
            v_suggested := FALSE;
        ELSE
            RAISE;
        END IF;
    END;

    RETURN jsonb_build_object('status', 'created', 'suggested', v_suggested, 'exercise', to_jsonb(v_row));
END;
$$;
REVOKE ALL ON FUNCTION public.suggest_exercise(TEXT, TEXT[], TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_exercise(TEXT, TEXT[], TEXT, BOOLEAN, TEXT) TO authenticated;

-- 6. Admin: map free-text exercise names to the catalogue ------------------------------------
CREATE OR REPLACE FUNCTION public.admin_unmapped_exercises(p_limit INTEGER DEFAULT 200)
RETURNS TABLE (name_key TEXT, display_name TEXT, uses BIGINT, riders BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admin only'; END IF;
    RETURN QUERY
    SELECT e.name_key, min(e.name), count(*), count(DISTINCT e.user_id)
      FROM public.gym_exercises e
     WHERE e.catalogue_id IS NULL
     GROUP BY e.name_key
     ORDER BY count(*) DESC, e.name_key
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_unmapped_exercises(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unmapped_exercises(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_map_exercises(p_name_key TEXT, p_catalogue_id UUID, p_add_alias BOOLEAN DEFAULT TRUE)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_count INTEGER;
    v_alias TEXT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admin only'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.exercise_catalogue WHERE id = p_catalogue_id AND owner_id IS NULL) THEN
        RAISE EXCEPTION 'Catalogue exercise not found';
    END IF;

    WITH linked AS (
        UPDATE public.gym_exercises SET catalogue_id = p_catalogue_id
         WHERE catalogue_id IS NULL AND name_key = p_name_key
        RETURNING activity_id
    ), stale AS (
        UPDATE public.activities SET gym_load_stale = TRUE
         WHERE id IN (SELECT activity_id FROM linked) AND gym_load_at IS NOT NULL
        RETURNING id
    )
    SELECT count(*) INTO v_count FROM linked;

    IF p_add_alias AND v_count > 0 THEN
        SELECT min(name) INTO v_alias FROM public.gym_exercises
         WHERE catalogue_id = p_catalogue_id AND name_key = p_name_key;
        UPDATE public.exercise_catalogue
           SET aliases = aliases || v_alias
         WHERE id = p_catalogue_id AND v_alias IS NOT NULL
           AND name_key <> p_name_key AND NOT (p_name_key = ANY (alias_keys))
           AND cardinality(aliases) < 20;
    END IF;
    RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_map_exercises(TEXT, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_map_exercises(TEXT, UUID, BOOLEAN) TO authenticated;
