-- A rider-edited activity name is locked: imports, re-syncs and source upgrades never rename it.
alter table public.activities add column if not exists title_locked boolean not null default false;
comment on column public.activities.title_locked is 'True once the rider edited the name; imports never overwrite it.';
