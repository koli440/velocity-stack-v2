See [AGENTS.md](../AGENTS.md). Key rules:

- Supabase is integrated with GitHub; migrations in `supabase/migrations` deploy automatically on merge to `main` and are validated by the **Supabase Preview** check.
- Never ask the user to run migrations manually or add Supabase credentials/secrets to GitHub.
- Design features to work without external secrets.
- Verify using PR checks.
