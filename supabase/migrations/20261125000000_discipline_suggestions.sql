-- #172: disciplines are admin-managed; users suggest new ones through the generic suggestions flow.
-- Idempotent; safe to re-run.

-- Approved suggestions insert with the default sort_order, so keep them after the seeded list.
ALTER TABLE public.disciplines ALTER COLUMN sort_order SET DEFAULT 1000;

INSERT INTO public.suggestion_targets (entity_type, table_name, id_column, label, allowed_columns)
VALUES (
    'discipline', 'disciplines', 'id', 'Discipline',
    ARRAY['name', 'category', 'distance_m', 'flying_start', 'gender', 'age_group',
          'min_track_length_m', 'max_track_length_m']
)
ON CONFLICT (entity_type) DO UPDATE
    SET table_name = EXCLUDED.table_name,
        id_column = EXCLUDED.id_column,
        label = EXCLUDED.label,
        allowed_columns = EXCLUDED.allowed_columns;
