# Agent instructions

- Supabase is integrated with GitHub. Migrations in `supabase/migrations`
  deploy automatically on merge to `main` and are validated on PRs by the
  **Supabase Preview** check.
- Never ask the user to run migrations manually, and never ask them to add
  Supabase credentials or secrets (service-role keys etc.) to GitHub or the repo.
- Design features to work without external secrets (e.g. logic in SQL/pg_cron
  via migrations rather than external scripts or scheduled workflows).
- Verify database changes through PR checks (`gh pr checks`, check-runs API,
  PR comments); fix SQL errors until Supabase Preview is green, then merge and
  confirm it on `main`.
- Never edit already-applied migrations; add new, idempotent ones.
